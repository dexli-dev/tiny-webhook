import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CONFIG } from '$lib/config';
import { __resetForTests, createInbox, recordRequest } from '$lib/server/store';
import type { CapturedInput } from '$lib/server/store';
import type { CreateInboxResponse, GetInboxResponse, WebhookRequest } from '$lib/types';
import * as cloudflare from '$lib/server/cloudflare';

import { POST as createInboxEndpoint } from './api/inboxes/+server';
import { POST as receive } from './in/[token]/+server';
import {
	GET as getInboxEndpoint,
	DELETE as deleteInboxEndpoint
} from './api/inboxes/[id]/+server';
import { GET as getRequestEndpoint } from './api/inboxes/[id]/requests/[requestId]/+server';
import { GET as eventsEndpoint } from './api/inboxes/[id]/events/+server';

interface EventOpts {
	url: string;
	method?: string;
	headers?: Record<string, string>;
	body?: string;
	params?: Record<string, string>;
	ip?: string;
	signal?: AbortSignal;
}

// Minimal RequestEvent stand-in: only the fields our handlers read. Typed as
// `any` so one helper can feed handlers whose RouteParams differ.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeEvent(opts: EventOpts): any {
	const url = new URL(opts.url);
	const request = new Request(url, {
		method: opts.method ?? 'GET',
		headers: opts.headers,
		body: opts.body,
		signal: opts.signal
	});
	return {
		request,
		url,
		params: opts.params ?? {},
		getClientAddress: () => opts.ip ?? '203.0.113.9'
	};
}

function input(over: Partial<CapturedInput> = {}): CapturedInput {
	return {
		method: 'POST',
		path: '/in/x',
		queryString: '',
		headers: [],
		bodyText: 'hi',
		bodySizeBytes: 2,
		contentType: 'text/plain',
		sourceIp: '203.0.113.9',
		userAgent: null,
		responseStatus: 200,
		...over
	};
}

const ORIGIN = 'http://localhost:5173';
const TEST_KEY = 'k'.repeat(43);

const authHeaders = (key = TEST_KEY) => ({ authorization: `Bearer ${key}` });

beforeEach(() => __resetForTests());
afterEach(() => __resetForTests());

describe('POST /api/inboxes', () => {
	it('creates an inbox and returns absolute URLs built from the request origin', async () => {
		const res = await createInboxEndpoint(
			makeEvent({
				url: `${ORIGIN}/api/inboxes`,
				method: 'POST',
				ip: '1.1.1.1',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ key: TEST_KEY })
			})
		);
		expect(res.status).toBe(201);
		const body = (await res.json()) as CreateInboxResponse;
		expect(body.webhookUrl).toBe(`${ORIGIN}/in/${body.publicToken}`);
		expect(body.dashboardUrl).toBe(`${ORIGIN}/inbox/${body.inboxId}`);
		expect(typeof body.expiresAt).toBe('string');
		expect(body.inboxId).toHaveLength(CONFIG.TOKEN_LENGTH);
		expect(body.publicToken).toHaveLength(CONFIG.TOKEN_LENGTH);
	});

	it('rejects a body missing the key with 400', async () => {
		const res = await createInboxEndpoint(
			makeEvent({
				url: `${ORIGIN}/api/inboxes`,
				method: 'POST',
				ip: '1.1.1.2',
				headers: { 'content-type': 'application/json' },
				body: '{}'
			})
		);
		expect(res.status).toBe(400);
	});

	it('rejects non-application/json Content-Type with 415 (CSRF guard)', async () => {
		// Cross-origin form-encoded / text-plain reaches the handler because the
		// receiver path forces kit.csrf.checkOrigin=false globally. Per-route
		// Content-Type guard closes the CSRF surface on this JSON-API endpoint.
		for (const ct of ['text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data']) {
			const res = await createInboxEndpoint(
				makeEvent({
					url: `${ORIGIN}/api/inboxes`,
					method: 'POST',
					ip: '3.3.3.3',
					headers: { 'content-type': ct },
					body: JSON.stringify({ key: TEST_KEY })
				})
			);
			expect(res.status).toBe(415);
		}
	});

	it('rejects requests with no Content-Type header with 415', async () => {
		const res = await createInboxEndpoint(
			makeEvent({
				url: `${ORIGIN}/api/inboxes`,
				method: 'POST',
				ip: '3.3.3.4',
				body: JSON.stringify({ key: TEST_KEY })
			})
		);
		expect(res.status).toBe(415);
	});

	it('accepts application/json with a charset parameter', async () => {
		const res = await createInboxEndpoint(
			makeEvent({
				url: `${ORIGIN}/api/inboxes`,
				method: 'POST',
				ip: '3.3.3.5',
				headers: { 'content-type': 'application/json; charset=utf-8' },
				body: JSON.stringify({ key: TEST_KEY })
			})
		);
		expect(res.status).toBe(201);
	});

	it('Content-Type guard fires before rate-limit (CSRF cannot exhaust victim quota)', async () => {
		// CSRF runs in the victim's browser, so attacker-driven cross-origin
		// POSTs would otherwise count against the victim's per-IP creation
		// budget. Guard must reject the request before consuming a slot so the
		// victim can still legitimately create inboxes.
		const ip = '4.4.4.4';
		for (let i = 0; i < CONFIG.MAX_INBOXES_PER_IP_PER_HOUR + 5; i++) {
			const rejected = await createInboxEndpoint(
				makeEvent({
					url: `${ORIGIN}/api/inboxes`,
					method: 'POST',
					ip,
					headers: { 'content-type': 'text/plain' },
					body: JSON.stringify({ key: TEST_KEY })
				})
			);
			expect(rejected.status).toBe(415);
		}
		// Legitimate JSON POST from same IP still succeeds — quota intact.
		const ok = await createInboxEndpoint(
			makeEvent({
				url: `${ORIGIN}/api/inboxes`,
				method: 'POST',
				ip,
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ key: TEST_KEY })
			})
		);
		expect(ok.status).toBe(201);
	});

	describe('CF-edge guard scope + ordering (vector 5 option 1)', () => {
		afterEach(() => vi.restoreAllMocks());

		it('Content-Type guard fires BEFORE CF-edge guard (information-disclosure hygiene)', async () => {
			// Lead's ordering ask: bad CT + missing CF-RAY should return 415,
			// not 403. A 415 reveals nothing about CF-edge policy; a 403 does.
			// Recon attackers probing with arbitrary CT should learn nothing
			// about the security posture. Spy is set to "block" so if the CF
			// guard fires at all, the response would be 403 — but we expect
			// 415, proving CT guard ran first AND short-circuited before CF.
			const spy = vi.spyOn(cloudflare, 'requireCloudflareEdge');
			spy.mockReturnValue(
				new Response(JSON.stringify({ error: 'cf-blocked' }), { status: 403 })
			);
			const res = await createInboxEndpoint(
				makeEvent({
					url: `${ORIGIN}/api/inboxes`,
					method: 'POST',
					ip: '5.5.5.1',
					headers: { 'content-type': 'text/plain' },
					body: JSON.stringify({ key: TEST_KEY })
				})
			);
			expect(res.status).toBe(415);
			expect(spy).not.toHaveBeenCalled();
		});

		it('CF-edge guard fires when Content-Type is valid (env-on simulation)', async () => {
			const spy = vi.spyOn(cloudflare, 'requireCloudflareEdge');
			spy.mockReturnValue(
				new Response(JSON.stringify({ error: 'cf-blocked' }), {
					status: 403,
					headers: { 'Content-Type': 'application/json' }
				})
			);
			const res = await createInboxEndpoint(
				makeEvent({
					url: `${ORIGIN}/api/inboxes`,
					method: 'POST',
					ip: '5.5.5.2',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ key: TEST_KEY })
				})
			);
			expect(res.status).toBe(403);
			expect(spy).toHaveBeenCalledTimes(1);
		});

		it('CF-edge guard fires BEFORE rate-limit (same victim-quota invariant as vector 1)', async () => {
			// Spy unconditionally blocks → if guard came after rate-limit,
			// MAX+5 attempts from same IP would burn the budget and a
			// legitimate (spy-restored) call would get 429. We assert quota
			// intact post-attack.
			const ip = '5.5.5.3';
			const spy = vi.spyOn(cloudflare, 'requireCloudflareEdge');
			spy.mockReturnValue(
				new Response(JSON.stringify({ error: 'cf-blocked' }), {
					status: 403,
					headers: { 'Content-Type': 'application/json' }
				})
			);
			for (let i = 0; i < CONFIG.MAX_INBOXES_PER_IP_PER_HOUR + 5; i++) {
				const rejected = await createInboxEndpoint(
					makeEvent({
						url: `${ORIGIN}/api/inboxes`,
						method: 'POST',
						ip,
						headers: { 'content-type': 'application/json' },
						body: JSON.stringify({ key: TEST_KEY })
					})
				);
				expect(rejected.status).toBe(403);
			}
			spy.mockRestore();
			const ok = await createInboxEndpoint(
				makeEvent({
					url: `${ORIGIN}/api/inboxes`,
					method: 'POST',
					ip,
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ key: TEST_KEY })
				})
			);
			expect(ok.status).toBe(201);
		});

		it('GET routes do NOT call CF-edge guard (scope-of-guard is two POST routes only)', async () => {
			// Lead's flex (b): guard must not creep into reads/SSE. Spy on the
			// helper and exercise representative GET surfaces. Spy must never
			// be invoked.
			const ip = '5.5.5.4';
			const created = (await (
				await createInboxEndpoint(
					makeEvent({
						url: `${ORIGIN}/api/inboxes`,
						method: 'POST',
						ip,
						headers: { 'content-type': 'application/json' },
						body: JSON.stringify({ key: TEST_KEY })
					})
				)
			).json()) as CreateInboxResponse;

			const spy = vi.spyOn(cloudflare, 'requireCloudflareEdge');
			spy.mockReturnValue(
				new Response(JSON.stringify({ error: 'cf-blocked' }), { status: 403 })
			);
			const getRes = await getInboxEndpoint(
				makeEvent({
					url: `${ORIGIN}/api/inboxes/${created.inboxId}`,
					method: 'GET',
					params: { id: created.inboxId },
					headers: authHeaders()
				})
			);
			expect(getRes.status).toBe(200);
			expect(spy).not.toHaveBeenCalled();
		});
	});

	it('returns 429 once the per-IP creation limit is exceeded', async () => {
		const ip = '2.2.2.2';
		const goodBody = {
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ key: TEST_KEY })
		};
		for (let i = 0; i < CONFIG.MAX_INBOXES_PER_IP_PER_HOUR; i++) {
			const ok = await createInboxEndpoint(
				makeEvent({ url: `${ORIGIN}/api/inboxes`, method: 'POST', ip, ...goodBody })
			);
			expect(ok.status).toBe(201);
		}
		const limited = await createInboxEndpoint(
			makeEvent({ url: `${ORIGIN}/api/inboxes`, method: 'POST', ip, ...goodBody })
		);
		expect(limited.status).toBe(429);
	});
});

describe('receive /in/[token]', () => {
	it('captures a request and returns {ok:true}', async () => {
		const inbox = createInbox(TEST_KEY);
		const res = await receive(
			makeEvent({
				url: `${ORIGIN}/in/${inbox.publicToken}?q=1`,
				method: 'POST',
				headers: { 'content-type': 'application/json', 'user-agent': 'jest' },
				body: '{"a":1}',
				params: { token: inbox.publicToken }
			})
		);
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ ok: true });

		const view = await getInboxEndpoint(
			makeEvent({
				url: `${ORIGIN}/api/inboxes/${inbox.id}`,
				params: { id: inbox.id },
				headers: authHeaders()
			})
		);
		const body = (await view.json()) as GetInboxResponse;
		expect(body.locked).toBe(false);
		if (body.locked === false) {
			expect(body.requests).toHaveLength(1);
			expect(body.requests[0].method).toBe('POST');
			expect(body.requests[0].path).toBe(`/in/${inbox.publicToken}`);
		}
	});

	it('captures OPTIONS too', async () => {
		const inbox = createInbox(TEST_KEY);
		const res = await receive(
			makeEvent({
				url: `${ORIGIN}/in/${inbox.publicToken}`,
				method: 'OPTIONS',
				params: { token: inbox.publicToken }
			})
		);
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ ok: true });
	});

	it('responds 200 {ok:true} for unknown tokens too (item 14 — indistinguishable)', async () => {
		const res = await receive(
			makeEvent({
				url: `${ORIGIN}/in/ghosttoken`,
				method: 'POST',
				body: 'x',
				params: { token: 'ghosttoken' }
			})
		);
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ ok: true });
	});

	it('413s for an oversize body and stores nothing', async () => {
		const inbox = createInbox(TEST_KEY);
		const res = await receive(
			makeEvent({
				url: `${ORIGIN}/in/${inbox.publicToken}`,
				method: 'POST',
				body: 'x'.repeat(CONFIG.MAX_BODY_BYTES + 1),
				params: { token: inbox.publicToken }
			})
		);
		expect(res.status).toBe(413);
		const view = await getInboxEndpoint(
			makeEvent({
				url: `${ORIGIN}/api/inboxes/${inbox.id}`,
				params: { id: inbox.id },
				headers: authHeaders()
			})
		);
		const body = (await view.json()) as GetInboxResponse;
		expect(body.locked).toBe(false);
		if (body.locked === false) {
			expect(body.requests).toHaveLength(0);
		}
	});
});

describe('GET /api/inboxes/[id] auth gating', () => {
	it('returns locked shell without a key', async () => {
		const inbox = createInbox(TEST_KEY);
		recordRequest(inbox.publicToken, input());
		recordRequest(inbox.publicToken, input());
		const res = await getInboxEndpoint(
			makeEvent({ url: `${ORIGIN}/api/inboxes/${inbox.id}`, params: { id: inbox.id } })
		);
		const body = (await res.json()) as GetInboxResponse;
		expect(body.locked).toBe(true);
		if (body.locked === true) {
			expect(body.shell.requestCount).toBe(2);
			expect(body.shell.publicToken).toBe(inbox.publicToken);
		}
	});

	it('returns locked shell with a WRONG key (constant-time, no enumeration)', async () => {
		const inbox = createInbox(TEST_KEY);
		const res = await getInboxEndpoint(
			makeEvent({
				url: `${ORIGIN}/api/inboxes/${inbox.id}`,
				params: { id: inbox.id },
				headers: { authorization: 'Bearer wrongkey' }
			})
		);
		expect((await res.json()).locked).toBe(true);
	});

	it('returns full data with the correct key', async () => {
		const inbox = createInbox(TEST_KEY);
		const res = await getInboxEndpoint(
			makeEvent({
				url: `${ORIGIN}/api/inboxes/${inbox.id}`,
				params: { id: inbox.id },
				headers: authHeaders()
			})
		);
		expect((await res.json()).locked).toBe(false);
	});

	it('webhookUrl present on the unlocked branch (cycle-4a bar 9)', async () => {
		const inbox = createInbox(TEST_KEY);
		const res = await getInboxEndpoint(
			makeEvent({
				url: `${ORIGIN}/api/inboxes/${inbox.id}`,
				params: { id: inbox.id },
				headers: authHeaders()
			})
		);
		const body = (await res.json()) as GetInboxResponse;
		expect(body.locked).toBe(false);
		if (body.locked === false) {
			// PUBLIC_BASE_URL is unset in the test process → falls back to
			// request origin (= ORIGIN). End-to-end env override is verified by
			// the Docker smoke gate.
			expect(body.webhookUrl).toBe(`${ORIGIN}/in/${inbox.publicToken}`);
		}
	});

	it('webhookUrl present on the locked branch and matches the shell publicToken', async () => {
		const inbox = createInbox(TEST_KEY);
		const res = await getInboxEndpoint(
			makeEvent({ url: `${ORIGIN}/api/inboxes/${inbox.id}`, params: { id: inbox.id } })
		);
		const body = (await res.json()) as GetInboxResponse;
		expect(body.locked).toBe(true);
		if (body.locked === true) {
			expect(body.webhookUrl).toBe(`${ORIGIN}/in/${body.shell.publicToken}`);
		}
	});

	it('webhookUrl present on the locked-bogus branch (synthetic shell publicToken)', async () => {
		const res = await getInboxEndpoint(
			makeEvent({ url: `${ORIGIN}/api/inboxes/totallybogus`, params: { id: 'totallybogus' } })
		);
		const body = (await res.json()) as GetInboxResponse;
		expect(body.locked).toBe(true);
		if (body.locked === true) {
			// Synth publicToken is deterministic per process; webhookUrl pairs
			// with whatever the synthShell produced.
			expect(body.webhookUrl).toBe(`${ORIGIN}/in/${body.shell.publicToken}`);
		}
	});
});

describe('DELETE /api/inboxes/[id] (cycle-5, bar item 9b)', () => {
	/** Snapshot a Response's externally-observable parts. */
	async function snapshot(res: Response): Promise<{
		status: number;
		body: string;
		headers: Record<string, string>;
	}> {
		const body = await res.text();
		const headers: Record<string, string> = {};
		for (const [k, v] of res.headers) headers[k.toLowerCase()] = v;
		// Drop the X-SvelteKit-Page header SvelteKit may attach in some
		// adapter combinations — it's the same across responses if present
		// anyway, but normalising removes one source of harness noise.
		return { status: res.status, body, headers };
	}

	it('bogus id + any key → 204 + empty body', async () => {
		const res = await deleteInboxEndpoint(
			makeEvent({
				url: `${ORIGIN}/api/inboxes/totallybogus`,
				method: 'DELETE',
				params: { id: 'totallybogus' },
				headers: authHeaders('anykeyatall')
			})
		);
		const snap = await snapshot(res);
		expect(snap.status).toBe(204);
		expect(snap.body).toBe('');
	});

	it('real id + no key → 204 + empty body + no state change', async () => {
		const inbox = createInbox(TEST_KEY);
		const res = await deleteInboxEndpoint(
			makeEvent({
				url: `${ORIGIN}/api/inboxes/${inbox.id}`,
				method: 'DELETE',
				params: { id: inbox.id }
			})
		);
		const snap = await snapshot(res);
		expect(snap.status).toBe(204);
		expect(snap.body).toBe('');
		// Inbox is still alive — a GET with the right key still unlocks.
		const post = await getInboxEndpoint(
			makeEvent({
				url: `${ORIGIN}/api/inboxes/${inbox.id}`,
				params: { id: inbox.id },
				headers: authHeaders()
			})
		);
		expect((await post.json()).locked).toBe(false);
	});

	it('real id + wrong key → 204 + empty body + no state change', async () => {
		const inbox = createInbox(TEST_KEY);
		const res = await deleteInboxEndpoint(
			makeEvent({
				url: `${ORIGIN}/api/inboxes/${inbox.id}`,
				method: 'DELETE',
				params: { id: inbox.id },
				headers: authHeaders('wrongkey')
			})
		);
		const snap = await snapshot(res);
		expect(snap.status).toBe(204);
		expect(snap.body).toBe('');
		const post = await getInboxEndpoint(
			makeEvent({
				url: `${ORIGIN}/api/inboxes/${inbox.id}`,
				params: { id: inbox.id },
				headers: authHeaders()
			})
		);
		expect((await post.json()).locked).toBe(false);
	});

	it('real id + correct key → 204 + empty body + inbox ACTUALLY deleted', async () => {
		const inbox = createInbox(TEST_KEY);
		const res = await deleteInboxEndpoint(
			makeEvent({
				url: `${ORIGIN}/api/inboxes/${inbox.id}`,
				method: 'DELETE',
				params: { id: inbox.id },
				headers: authHeaders()
			})
		);
		const snap = await snapshot(res);
		expect(snap.status).toBe(204);
		expect(snap.body).toBe('');
		// Subsequent GET with the same correct key returns a SYNTH locked shell
		// (the deterministic-bogus view), NOT an unlocked real view — proof of
		// actual server-side deletion. The synth publicToken is different from
		// the real one we just deleted.
		const post = await getInboxEndpoint(
			makeEvent({
				url: `${ORIGIN}/api/inboxes/${inbox.id}`,
				params: { id: inbox.id },
				headers: authHeaders()
			})
		);
		const body = (await post.json()) as GetInboxResponse;
		expect(body.locked).toBe(true);
		if (body.locked === true) {
			expect(body.shell.publicToken).not.toBe(inbox.publicToken);
		}
	});

	it('INDISTINGUISHABILITY: all 4 cases produce byte-identical 204 + empty body + matching headers', async () => {
		// The product invariant: an external observer (no other side-channel
		// access) cannot tell which of the four DELETE cases occurred from the
		// response alone. This is the same shape-indistinguishability we run on
		// GET, extended to DELETE per the CEO ruling 2026-05-25.
		const inbox = createInbox(TEST_KEY);

		const calls = [
			{
				label: 'bogus-id + anykey',
				params: { id: 'totallybogus-other' },
				headers: authHeaders('anykey')
			},
			{ label: 'real-id + nokey', params: { id: inbox.id }, headers: undefined },
			{ label: 'real-id + wrongkey', params: { id: inbox.id }, headers: authHeaders('wrongkey') },
			// IMPORTANT: real + correct key is the state-changing case. Run it
			// LAST so the preceding three see the inbox still alive (state-check
			// happens implicitly: if the wrong-key call had deleted, the next
			// real+correct call wouldn't return a different shape, but the
			// state-change ASSERT in the dedicated test above already verified
			// deletion against the same handler).
			{ label: 'real-id + correctkey', params: { id: inbox.id }, headers: authHeaders() }
		];

		const snaps = [];
		for (const c of calls) {
			const res = await deleteInboxEndpoint(
				makeEvent({
					url: `${ORIGIN}/api/inboxes/${c.params.id}`,
					method: 'DELETE',
					params: c.params,
					headers: c.headers
				})
			);
			snaps.push({ label: c.label, snap: await snapshot(res) });
		}

		// Status + body equal across all four.
		const base = snaps[0].snap;
		for (const s of snaps) {
			expect(s.snap.status, `status diverged at ${s.label}`).toBe(base.status);
			expect(s.snap.body, `body diverged at ${s.label}`).toBe(base.body);
		}
		// Headers equal across all four (every key/value pair). content-length
		// (if the platform sets it) must be the same value — '0' or absent in
		// the same way — across cases.
		for (const s of snaps) {
			expect(
				Object.keys(s.snap.headers).sort(),
				`header keys diverged at ${s.label}`
			).toEqual(Object.keys(base.headers).sort());
			for (const k of Object.keys(base.headers)) {
				expect(s.snap.headers[k], `header "${k}" diverged at ${s.label}`).toBe(
					base.headers[k]
				);
			}
		}
		// Concrete shape: 204 + empty body.
		expect(base.status).toBe(204);
		expect(base.body).toBe('');
	});

	it('DELETE on a real id is idempotent (second call still 204, no throw)', async () => {
		const inbox = createInbox(TEST_KEY);
		const first = await deleteInboxEndpoint(
			makeEvent({
				url: `${ORIGIN}/api/inboxes/${inbox.id}`,
				method: 'DELETE',
				params: { id: inbox.id },
				headers: authHeaders()
			})
		);
		expect(first.status).toBe(204);
		// Second call with the same key — inbox no longer exists, so auth check
		// passes through to the bogus-path, no-op branch. Still 204, no leak.
		const second = await deleteInboxEndpoint(
			makeEvent({
				url: `${ORIGIN}/api/inboxes/${inbox.id}`,
				method: 'DELETE',
				params: { id: inbox.id },
				headers: authHeaders()
			})
		);
		expect(second.status).toBe(204);
		expect(await second.text()).toBe('');
	});
});

describe('GET /api/inboxes/[id]/requests/[requestId]', () => {
	it('returns full request detail with correct auth; authed-bogus rid → 200 synthetic (cycle-3a item 14)', async () => {
		const inbox = createInbox(TEST_KEY);
		const stored = recordRequest(inbox.publicToken, input({ method: 'PUT', bodyText: 'payload' }))!;

		const res = await getRequestEndpoint(
			makeEvent({
				url: `${ORIGIN}/api/inboxes/${inbox.id}/requests/${stored.id}`,
				params: { id: inbox.id, requestId: stored.id },
				headers: authHeaders()
			})
		);
		const full = (await res.json()) as WebhookRequest;
		expect(full.method).toBe('PUT');
		expect(full.bodyText).toBe('payload');

		// Authed + missing rid → 200 + synthetic WebhookRequest (same shape),
		// so authed callers cannot enumerate which rids exist.
		const miss = await getRequestEndpoint(
			makeEvent({
				url: `${ORIGIN}/api/inboxes/${inbox.id}/requests/nope`,
				params: { id: inbox.id, requestId: 'nope' },
				headers: authHeaders()
			})
		);
		expect(miss.status).toBe(200);
		const synth = (await miss.json()) as WebhookRequest;
		expect(synth.id).toBe('nope');
		expect(synth.inboxId).toBe(inbox.id);
		expect(synth.bodyText).toBe('');
	});

	it('404s without auth (no leak of which request ids exist)', async () => {
		const inbox = createInbox(TEST_KEY);
		const stored = recordRequest(inbox.publicToken, input())!;
		const res = await getRequestEndpoint(
			makeEvent({
				url: `${ORIGIN}/api/inboxes/${inbox.id}/requests/${stored.id}`,
				params: { id: inbox.id, requestId: stored.id }
			})
		);
		expect(res.status).toBe(404);
	});

	it('returns 200 + synthetic locked shell for an unknown inbox (cycle-3 item 14)', async () => {
		const res = await getInboxEndpoint(
			makeEvent({ url: `${ORIGIN}/api/inboxes/nope`, params: { id: 'nope' } })
		);
		expect(res.status).toBe(200);
		const body = (await res.json()) as GetInboxResponse;
		expect(body.locked).toBe(true);
		if (!body.locked) return;
		expect(body.shell.id).toBe('nope');
		// publicToken is a fresh random of the configured length; expiresAt is
		// a fresh ISO timestamp. Caller can't distinguish from a real locked shell.
		expect(body.shell.publicToken).toHaveLength(CONFIG.TOKEN_LENGTH);
		// requestCount is seed-derived in [0, MAX_REQUESTS_PER_INBOX] — matches
		// the value domain of real shells. The old always-0 was a leak (real
		// inboxes with traffic showed count>0, bogus stayed at 0).
		expect(body.shell.requestCount).toBeGreaterThanOrEqual(0);
		expect(body.shell.requestCount).toBeLessThanOrEqual(CONFIG.MAX_REQUESTS_PER_INBOX);
		expect(new Date(body.shell.expiresAt).getTime()).toBeGreaterThan(Date.now());
	});
});

describe('GET /api/inboxes/[id]/events (SSE)', () => {
	it('opens the stream and pushes a request event with auth', async () => {
		const inbox = createInbox(TEST_KEY);
		const ac = new AbortController();
		const res = await eventsEndpoint(
			makeEvent({
				url: `${ORIGIN}/api/inboxes/${inbox.id}/events`,
				params: { id: inbox.id },
				signal: ac.signal,
				headers: authHeaders()
			})
		);
		expect(res.headers.get('content-type')).toBe('text/event-stream');
		expect(res.headers.get('cache-control')).toBe('no-cache');

		const reader = res.body!.getReader();
		const dec = new TextDecoder();

		const opening = await reader.read();
		expect(dec.decode(opening.value)).toContain(': connected');

		recordRequest(inbox.publicToken, input({ method: 'DELETE' }));
		const evt = await reader.read();
		const text = dec.decode(evt.value);
		expect(text.startsWith('data: ')).toBe(true);
		expect(JSON.parse(text.slice('data: '.length).trim())).toMatchObject({
			type: 'request',
			request: { method: 'DELETE' }
		});

		ac.abort();
		await reader.read().catch(() => {});
	});

	it('throws 404 without auth', () => {
		const inbox = createInbox(TEST_KEY);
		expect(() =>
			eventsEndpoint(
				makeEvent({
					url: `${ORIGIN}/api/inboxes/${inbox.id}/events`,
					params: { id: inbox.id }
				})
			)
		).toThrow();
	});

	it('throws 404 for an unknown inbox', () => {
		expect(() =>
			eventsEndpoint(
				makeEvent({
					url: `${ORIGIN}/api/inboxes/nope/events`,
					params: { id: 'nope' },
					headers: authHeaders()
				})
			)
		).toThrow();
	});
});
