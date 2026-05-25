// Adversarial sweep for cycle-2 bar items 10/12/14/15.
//
// These tests do not exercise the network stack end-to-end (Node's HTTP parser
// 431 / 414 / 400 behaviour is its own contract). They exercise the *handler*
// layer: given a request that has already been parsed (or rejected) by the
// platform, our code must store input verbatim, never reflect attacker content
// back as executable text, never crash, and never leak token existence.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CONFIG } from '$lib/config';
import { __resetForTests, createInbox, synthInbox } from '$lib/server/store';
import type { GetInboxResponse, Inbox, WebhookRequest } from '$lib/types';

import { POST as receive } from './in/[token]/+server';
import * as receiveModule from './in/[token]/+server';
import {
	GET as getInboxEndpoint,
	DELETE as deleteInboxEndpoint
} from './api/inboxes/[id]/+server';
import { GET as getRequestEndpoint } from './api/inboxes/[id]/requests/[requestId]/+server';
import { GET as rawEndpoint } from './api/inboxes/[id]/requests/[requestId]/raw/+server';
import { GET as eventsEndpoint } from './api/inboxes/[id]/events/+server';

const KEY = 'k'.repeat(43);
const ORIGIN = 'http://x';
const authHeaders = (extra: Record<string, string> = {}): Record<string, string> => ({
	authorization: `Bearer ${KEY}`,
	...extra
});

interface EventOpts {
	url: string;
	method?: string;
	headers?: Record<string, string>;
	body?: BodyInit;
	params?: Record<string, string>;
	signal?: AbortSignal;
}

// Loose stand-in for RequestEvent — only the four fields our handlers read.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeEvent(opts: EventOpts): any {
	const url = new URL(opts.url);
	const init: RequestInit = { method: opts.method ?? 'GET' };
	if (opts.headers) init.headers = opts.headers;
	if (opts.body !== undefined) init.body = opts.body;
	if (opts.signal) init.signal = opts.signal;
	return {
		request: new Request(url, init),
		url,
		params: opts.params ?? {},
		getClientAddress: () => '203.0.113.9'
	};
}

// Lower-case alphanum, same alphabet as the store — for generating fake tokens
// indistinguishable in shape from real ones.
function randomToken(len: number): string {
	const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
	const bytes = new Uint8Array(len);
	crypto.getRandomValues(bytes);
	let out = '';
	for (let i = 0; i < len; i++) out += alphabet[bytes[i] % alphabet.length];
	return out;
}

interface PostOpts {
	method?: string;
	headers?: Record<string, string>;
	body?: BodyInit;
	queryString?: string;
}

/**
 * POST a webhook into `inbox` and return the stored WebhookRequest for further
 * assertions. Fails the test if the inbox shows as locked, which it won't here
 * (we always read with the matching Bearer key).
 */
async function postAndFetch(inbox: Inbox, opts: PostOpts = {}): Promise<WebhookRequest> {
	const tail = opts.queryString ? `?${opts.queryString}` : '';
	await receive(
		makeEvent({
			url: `${ORIGIN}/in/${inbox.publicToken}${tail}`,
			method: opts.method ?? 'POST',
			headers: opts.headers,
			body: opts.body,
			params: { token: inbox.publicToken }
		})
	);
	const list = await getInboxEndpoint(
		makeEvent({
			url: `${ORIGIN}/api/inboxes/${inbox.id}`,
			params: { id: inbox.id },
			headers: authHeaders()
		})
	);
	const data = (await list.json()) as GetInboxResponse;
	if (data.locked) throw new Error('inbox unexpectedly locked');
	if (data.requests.length === 0) throw new Error('no requests stored');
	const rid = data.requests[0].id;
	const detail = await getRequestEndpoint(
		makeEvent({
			url: `${ORIGIN}/api/inboxes/${inbox.id}/requests/${rid}`,
			params: { id: inbox.id, requestId: rid },
			headers: authHeaders()
		})
	);
	return (await detail.json()) as WebhookRequest;
}

beforeEach(() => __resetForTests());
afterEach(() => __resetForTests());

// -----------------------------------------------------------------------------
// Bar item 12 — XSS payloads survive a server round-trip verbatim
// -----------------------------------------------------------------------------

const XSS_PAYLOADS = [
	'<script>alert(1)</script>',
	'"><img src=x onerror=alert(1)>',
	'javascript:alert(1)',
	'&lt;script&gt;alert(1)&lt;/script&gt;',
	'%3Cscript%3Ealert(1)%3C/script%3E',
	"');DROP TABLE inboxes;--"
];

describe('XSS payloads stored verbatim (bar item 12)', () => {
	for (const payload of XSS_PAYLOADS) {
		it(`body: "${payload.slice(0, 30)}..." stored byte-equal in bodyText and /raw`, async () => {
			const inbox = createInbox(KEY);
			const stored = await postAndFetch(inbox, { body: payload });
			expect(stored.bodyText).toBe(payload);
			// /raw must also return the exact bytes with text/plain — no transformation, no escaping.
			const raw = await rawEndpoint(
				makeEvent({
					url: `${ORIGIN}/api/inboxes/${inbox.id}/requests/${stored.id}/raw`,
					params: { id: inbox.id, requestId: stored.id },
					headers: authHeaders()
				})
			);
			expect(raw.headers.get('content-type')).toBe('text/plain;charset=utf-8');
			expect(await raw.text()).toBe(payload);
		});

		it(`header value: "${payload.slice(0, 30)}..." stored byte-equal`, async () => {
			const inbox = createInbox(KEY);
			const stored = await postAndFetch(inbox, {
				headers: { 'x-evil': payload },
				body: 'ok'
			});
			expect(stored.headers).toContainEqual(['x-evil', payload]);
		});

		it(`query value: "${payload.slice(0, 30)}..." round-trips with no value loss`, async () => {
			const inbox = createInbox(KEY);
			const qs = `payload=${encodeURIComponent(payload)}&other=1`;
			const stored = await postAndFetch(inbox, { queryString: qs, body: 'ok' });
			// The WHATWG URL parser may normalize percent-encoding inside the
			// query of a "special" scheme (e.g. "'" → "%27"). That's a platform
			// layer transformation, NOT a server-side mutation. Our contract is:
			// stored.queryString equals what URL parsing produced (no extra
			// stripping / re-encoding by us), and the decoded value is preserved
			// exactly.
			const platformNormalized = new URL(`${ORIGIN}/in/x?${qs}`).search.slice(1);
			expect(stored.queryString).toBe(platformNormalized);
			expect(new URLSearchParams(stored.queryString).get('payload')).toBe(payload);
		});

		it(`JSON body string value: "${payload.slice(0, 30)}..." preserved`, async () => {
			const inbox = createInbox(KEY);
			const body = JSON.stringify({ evil: payload, n: 42 });
			const stored = await postAndFetch(inbox, {
				headers: { 'content-type': 'application/json' },
				body
			});
			expect(stored.bodyText).toBe(body);
			expect(JSON.parse(stored.bodyText).evil).toBe(payload);
		});
	}

	it('javascript: URI in a query value does not crash and stores verbatim', async () => {
		const inbox = createInbox(KEY);
		const qs = `redirect=${encodeURIComponent('javascript:fetch("//evil")')}`;
		const stored = await postAndFetch(inbox, { queryString: qs, body: 'ok' });
		expect(new URLSearchParams(stored.queryString).get('redirect')).toBe(
			'javascript:fetch("//evil")'
		);
	});
});

// -----------------------------------------------------------------------------
// Bar item 10 — pathological inputs don't crash the handler
// -----------------------------------------------------------------------------

describe('Malformed / abusive request inputs (bar item 10)', () => {
	it('platform-layer guard: undici/Request rejects any CRLF in a header value', () => {
		// undici's Request constructor validates header field-values and refuses
		// any embedded CR/LF. Node's HTTP parser performs the equivalent check on
		// a real socket. This is the first line of defence.
		expect(
			() =>
				new Request(`${ORIGIN}/in/anything`, {
					method: 'POST',
					headers: { 'x-test': 'value\r\nX-Injected: yes' }
				})
		).toThrow();
	});

	it('server-side guard, in-value CR/LF (cycle-3): hand-built Request bypassing undici → strict 400', async () => {
		// Defence in depth: even if a future adapter or proxy bypasses the
		// platform header validator, captureRequest scans values for CR/LF.
		const inbox = createInbox(KEY);
		const fakeReq = {
			method: 'POST',
			headers: {
				get(name: string): string | null {
					const lower = name.toLowerCase();
					if (lower === 'x-evil') return 'value\r\nX-Injected: yes';
					return null;
				},
				*[Symbol.iterator]() {
					yield ['x-evil', 'value\r\nX-Injected: yes'] as [string, string];
				}
			},
			arrayBuffer: async () => new ArrayBuffer(0),
			signal: new AbortController().signal
		};
		const res = await receive({
			request: fakeReq as unknown as Request,
			url: new URL(`${ORIGIN}/in/${inbox.publicToken}`),
			params: { token: inbox.publicToken },
			getClientAddress: () => '1.1.1.1'
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
		} as any);
		expect(res.status).toBe(400);
	});

	it('response-only header blocklist (cycle-3a, item 12): Set-Cookie on an inbound request → strict 400', async () => {
		// This is the case the eval actually probes: a wire-level
		// `X-Test: a\r\nSet-Cookie: pwn=1` gets split by Node's HTTP parser
		// into TWO well-formed headers, so the in-value scan above sees
		// nothing. The blocklist catches Set-Cookie as a name that has no
		// business arriving on an inbound webhook.
		const inbox = createInbox(KEY);
		const res = await receive(
			makeEvent({
				url: `${ORIGIN}/in/${inbox.publicToken}`,
				method: 'POST',
				body: 'a',
				headers: { 'x-test': 'a', 'set-cookie': 'pwn=1' },
				params: { token: inbox.publicToken }
			})
		);
		expect(res.status).toBe(400);

		// Nothing recorded — verify via the authed inbox view.
		const view = await getInboxEndpoint(
			makeEvent({
				url: `${ORIGIN}/api/inboxes/${inbox.id}`,
				params: { id: inbox.id },
				headers: authHeaders()
			})
		);
		const body = (await view.json()) as GetInboxResponse;
		if (body.locked) throw new Error('unexpectedly locked');
		expect(body.requests).toHaveLength(0);
	});

	it('response-only blocklist covers other smuggling targets (Server, WWW-Authenticate, Location, CSP)', async () => {
		const inbox = createInbox(KEY);
		for (const name of [
			'server',
			'www-authenticate',
			'location',
			'content-security-policy',
			'x-frame-options'
		]) {
			const res = await receive(
				makeEvent({
					url: `${ORIGIN}/in/${inbox.publicToken}`,
					method: 'POST',
					body: 'a',
					headers: { [name]: 'evil' },
					params: { token: inbox.publicToken }
				})
			);
			expect(res.status, `blocked: ${name}`).toBe(400);
		}
		// Final inbox view: zero captured.
		const view = await getInboxEndpoint(
			makeEvent({
				url: `${ORIGIN}/api/inboxes/${inbox.id}`,
				params: { id: inbox.id },
				headers: authHeaders()
			})
		);
		const body = (await view.json()) as GetInboxResponse;
		if (body.locked) throw new Error('unexpectedly locked');
		expect(body.requests).toHaveLength(0);
	});

	it('a ~100 KB header value: handler accepts cleanly and stores it (real-network 431 is Node\'s job)', async () => {
		const inbox = createInbox(KEY);
		const big = 'a'.repeat(100_000);
		const stored = await postAndFetch(inbox, {
			headers: { 'x-big': big },
			body: 'ok'
		});
		const found = stored.headers.find(([k]) => k === 'x-big');
		expect(found?.[1]).toBe(big);
		// No 500, no crash — the handler treated the oversize header as ordinary
		// content. Node's HTTP parser is the layer that enforces the 431-class
		// reject on a real socket; in-process there is no parser to invoke.
	});

	it('malformed JSON body is stored as raw text (we do not parse server-side)', async () => {
		const inbox = createInbox(KEY);
		const malformed = '{"a":';
		const stored = await postAndFetch(inbox, {
			headers: { 'content-type': 'application/json' },
			body: malformed
		});
		expect(stored.bodyText).toBe(malformed);
		expect(stored.bodySizeBytes).toBe(malformed.length);
		expect(stored.contentType).toBe('application/json');
		// Sanity: still actually unparseable
		expect(() => JSON.parse(stored.bodyText)).toThrow();
	});

	it('binary non-UTF-8 payload decodes with replacement chars without crashing', async () => {
		const inbox = createInbox(KEY);
		const binary = new Uint8Array([0xff, 0xfe, 0x00, 0xc0, 0xc1, 0x80, 0x81]);
		const stored = await postAndFetch(inbox, {
			headers: { 'content-type': 'application/octet-stream' },
			body: binary
		});
		expect(stored.bodySizeBytes).toBe(binary.byteLength);
		expect(typeof stored.bodyText).toBe('string');
		// 0xFF/0xFE/0xC0/0xC1 are invalid as UTF-8 starts; we expect at least
		// one Unicode replacement character (U+FFFD).
		expect(stored.bodyText).toContain('�');
	});

	it('methods outside ACCEPTED_METHODS are not exported (SvelteKit returns 405 for missing exports)', () => {
		// Trust SvelteKit's per-route method routing: an unsupported method on a
		// +server.ts becomes 405. We verify the contract from our side — that
		// TRACE / CONNECT / arbitrary verbs are NOT exported.
		const mod = receiveModule as unknown as Record<string, unknown>;
		expect(mod.TRACE).toBeUndefined();
		expect(mod.CONNECT).toBeUndefined();
		expect(mod.PROPFIND).toBeUndefined();
		// And the accepted ones are all present.
		for (const m of CONFIG.ACCEPTED_METHODS) {
			expect(typeof mod[m]).toBe('function');
		}
	});
});

// -----------------------------------------------------------------------------
// Bar item 14 — receive endpoint is indistinguishable for real / fake tokens
// -----------------------------------------------------------------------------

describe('Token enumeration resistance (bar item 14)', () => {
	it('100 random unguessable tokens produce byte-equal responses to a real token', async () => {
		const inbox = createInbox(KEY);
		const realRes = await receive(
			makeEvent({
				url: `${ORIGIN}/in/${inbox.publicToken}`,
				method: 'POST',
				body: 'real',
				params: { token: inbox.publicToken }
			})
		);
		expect(realRes.status).toBe(200);
		const realBody = await realRes.text();
		const realCT = realRes.headers.get('content-type');

		for (let i = 0; i < 100; i++) {
			const fake = randomToken(CONFIG.TOKEN_LENGTH);
			const fakeRes = await receive(
				makeEvent({
					url: `${ORIGIN}/in/${fake}`,
					method: 'POST',
					body: 'fake',
					params: { token: fake }
				})
			);
			expect(fakeRes.status).toBe(realRes.status);
			expect(fakeRes.headers.get('content-type')).toBe(realCT);
			expect(await fakeRes.text()).toBe(realBody);
		}
	});
});

// -----------------------------------------------------------------------------
// Bar item 15 — SSE subscriber caps (per-inbox and global)
// -----------------------------------------------------------------------------

describe('SSE subscriber caps (bar item 15)', () => {
	async function openStream(
		id: string,
		ac: AbortController
	): Promise<{ res: Response; reader: ReadableStreamDefaultReader<Uint8Array> }> {
		const res = await eventsEndpoint(
			makeEvent({
				url: `${ORIGIN}/api/inboxes/${id}/events`,
				params: { id },
				headers: authHeaders(),
				signal: ac.signal
			})
		);
		const reader = res.body!.getReader();
		return { res, reader };
	}

	it('per-inbox cap: the (cap+1)-th stream emits an error frame and closes; existing streams unaffected', async () => {
		const inbox = createInbox(KEY);
		const controllers: AbortController[] = [];
		const readers: ReadableStreamDefaultReader<Uint8Array>[] = [];

		for (let i = 0; i < CONFIG.SSE_MAX_PER_INBOX; i++) {
			const ac = new AbortController();
			controllers.push(ac);
			const { reader } = await openStream(inbox.id, ac);
			readers.push(reader);
		}

		const acOver = new AbortController();
		const { reader: overReader } = await openStream(inbox.id, acOver);
		const dec = new TextDecoder();
		const opening = await overReader.read();
		expect(dec.decode(opening.value)).toContain(': connected');
		const errFrame = await overReader.read();
		const txt = dec.decode(errFrame.value);
		expect(txt).toContain('event: error');
		expect(txt).toContain('"reason":"capped"');
		const done = await overReader.read();
		expect(done.done).toBe(true);

		// The first existing stream still has its `: connected` opening chunk
		// available — proves the over-cap attempt did not tear it down.
		const existing0 = await readers[0].read();
		expect(dec.decode(existing0.value)).toContain(': connected');

		controllers.forEach((c) => c.abort());
		acOver.abort();
	});

	it('global cap: opening SSE_MAX_GLOBAL streams across many inboxes caps the next one anywhere', async () => {
		const perInbox = CONFIG.SSE_MAX_PER_INBOX;
		const inboxCount = Math.ceil(CONFIG.SSE_MAX_GLOBAL / perInbox);
		const controllers: AbortController[] = [];

		for (let i = 0; i < inboxCount; i++) {
			const inbox = createInbox(KEY);
			for (let j = 0; j < perInbox; j++) {
				const ac = new AbortController();
				controllers.push(ac);
				await openStream(inbox.id, ac);
			}
		}

		// inboxCount * perInbox >= SSE_MAX_GLOBAL by construction; the next
		// subscription on a fresh inbox (well under its per-inbox cap) must
		// trip the global cap, not the per-inbox one.
		const fresh = createInbox(KEY);
		const ac = new AbortController();
		controllers.push(ac);
		const { reader } = await openStream(fresh.id, ac);
		const dec = new TextDecoder();
		await reader.read(); // : connected
		const errFrame = await reader.read();
		expect(dec.decode(errFrame.value)).toContain('"reason":"capped"');

		controllers.forEach((c) => c.abort());
	});
});

// -----------------------------------------------------------------------------
// Cycle-3 item 14 extension — GET /api/inboxes/[id] is always 200, with shape
// parity between a real-but-locked inbox and a bogus id (synthetic shell).
// -----------------------------------------------------------------------------

describe('Inbox-read indistinguishability (cycle-3 item 14 extension)', () => {
	it('bogus id and real-but-locked id return identical response shapes', async () => {
		const real = createInbox(KEY);

		const realLocked = await getInboxEndpoint(
			makeEvent({ url: `${ORIGIN}/api/inboxes/${real.id}`, params: { id: real.id } })
		);
		const bogus = await getInboxEndpoint(
			makeEvent({
				url: `${ORIGIN}/api/inboxes/totallybogusid`,
				params: { id: 'totallybogusid' }
			})
		);

		expect(realLocked.status).toBe(bogus.status);
		expect(realLocked.headers.get('content-type')).toBe(bogus.headers.get('content-type'));

		const realBody = (await realLocked.json()) as GetInboxResponse;
		const bogusBody = (await bogus.json()) as GetInboxResponse;
		expect(realBody.locked).toBe(true);
		expect(bogusBody.locked).toBe(true);
		if (!realBody.locked || !bogusBody.locked) return;

		// Structural parity — same keys at both levels, same value-domain types.
		expect(Object.keys(realBody).sort()).toEqual(Object.keys(bogusBody).sort());
		expect(Object.keys(realBody.shell).sort()).toEqual(Object.keys(bogusBody.shell).sort());
		expect(typeof realBody.shell.publicToken).toBe('string');
		expect(typeof bogusBody.shell.publicToken).toBe('string');
		expect(bogusBody.shell.publicToken).toHaveLength(CONFIG.TOKEN_LENGTH);
		expect(bogusBody.shell.id).toBe('totallybogusid');
		// requestCount is seed-derived in [0, MAX_REQUESTS_PER_INBOX] for bogus,
		// matches the value domain of real shells. The old always-0 was a leak.
		expect(bogusBody.shell.requestCount).toBeGreaterThanOrEqual(0);
		expect(bogusBody.shell.requestCount).toBeLessThanOrEqual(CONFIG.MAX_REQUESTS_PER_INBOX);
		expect(new Date(bogusBody.shell.expiresAt).getTime()).toBeGreaterThan(Date.now());
	});

	it('STABILITY (cycle-3a): two probes of the same bogus id return byte-identical synthetic shells', async () => {
		const a = await getInboxEndpoint(
			makeEvent({ url: `${ORIGIN}/api/inboxes/probe-x`, params: { id: 'probe-x' } })
		);
		const b = await getInboxEndpoint(
			makeEvent({ url: `${ORIGIN}/api/inboxes/probe-x`, params: { id: 'probe-x' } })
		);
		const ja = (await a.json()) as GetInboxResponse;
		const jb = (await b.json()) as GetInboxResponse;
		if (!ja.locked || !jb.locked) throw new Error('both should be locked');
		// Deterministic per-process synthesis: every field byte-equal for the
		// same id, so an attacker cannot use drift to distinguish.
		expect(jb).toEqual(ja);
	});

	it('TIME-DOMAIN (cycle-3a-followup): synthetic locked-shell expiresAt is strictly in the FUTURE, never in the past', async () => {
		// Bug surface this regression-tests: an earlier synth formula could place
		// expiresAt before now (when offset > container uptime). A real inbox would
		// have been swept by then — so expiresAt < now is a trivial "this is bogus"
		// oracle. The fix anchors synth times to a small window before/after
		// PROCESS_BOOT so they always look temporally plausible.
		const res = await getInboxEndpoint(
			makeEvent({ url: `${ORIGIN}/api/inboxes/time-domain-probe-1`, params: { id: 'time-domain-probe-1' } })
		);
		const body = (await res.json()) as GetInboxResponse;
		if (!body.locked) throw new Error('should be locked');
		expect(new Date(body.shell.expiresAt).getTime()).toBeGreaterThan(Date.now());
	});

	it('TIME-DOMAIN: synthInbox helper exposes createdAt < now AND expiresAt > now AND expiresAt = createdAt + INBOX_TTL_MS', async () => {
		// synthInbox is still used by synthRequest.path derivation. The
		// authed-bogus /api/inboxes/[id] path now returns the locked shell, but
		// the helper's time-domain invariants still need to hold for any code
		// that calls synthInbox directly.
		const inbox = synthInbox('time-domain-probe-2');
		const created = new Date(inbox.createdAt).getTime();
		const expires = new Date(inbox.expiresAt).getTime();
		expect(created).toBeLessThan(Date.now());
		expect(expires).toBeGreaterThan(Date.now());
		expect(expires - created).toBe(CONFIG.INBOX_TTL_MS);
	});

	it('TIME-DOMAIN: synthetic WebhookRequest (real inbox + bogus rid) has receivedAt < now', async () => {
		// synthRequest only fires when auth succeeds (real inbox + correct key)
		// AND the rid is missing — that's the auth'd-bogus-rid enumeration case.
		const real = createInbox(KEY);
		const res = await getRequestEndpoint(
			makeEvent({
				url: `${ORIGIN}/api/inboxes/${real.id}/requests/synthrid-zzz`,
				params: { id: real.id, requestId: 'synthrid-zzz' },
				headers: authHeaders()
			})
		);
		expect(res.status).toBe(200);
		const body = (await res.json()) as WebhookRequest;
		expect(new Date(body.receivedAt).getTime()).toBeLessThan(Date.now());
	});

	it('STABILITY across different bogus ids: outputs DIFFER (no degenerate "same shell for all" case)', async () => {
		const a = await getInboxEndpoint(
			makeEvent({ url: `${ORIGIN}/api/inboxes/probe-a`, params: { id: 'probe-a' } })
		);
		const b = await getInboxEndpoint(
			makeEvent({ url: `${ORIGIN}/api/inboxes/probe-b`, params: { id: 'probe-b' } })
		);
		const ja = (await a.json()) as GetInboxResponse;
		const jb = (await b.json()) as GetInboxResponse;
		if (!ja.locked || !jb.locked) throw new Error('both should be locked');
		expect(ja.shell.publicToken).not.toBe(jb.shell.publicToken);
	});

	it('authed-bogus on /api/inboxes/[id] returns the LOCKED shell — same shape as wrong-key-on-real (no wrong-key oracle)', async () => {
		// Earlier cycle-3a returned UNLOCKED-synthetic for authed-bogus, which
		// created an inverted oracle: presenting a wrong key on a bogus id
		// produced an unlocked shape, while the same wrong key on a real id
		// stayed locked — so wrong-key responses alone distinguished real vs
		// bogus. Restoring "any non-owner state → locked shell" eliminates that
		// path entirely. The remaining unlocked-vs-locked divergence is
		// owner-with-correct-key vs everyone-else, which is structural.
		const real = createInbox(KEY);
		const realWrongKey = await getInboxEndpoint(
			makeEvent({
				url: `${ORIGIN}/api/inboxes/${real.id}`,
				params: { id: real.id },
				headers: { authorization: 'Bearer wrongkey-doesnt-match' }
			})
		);
		const bogusWrongKey = await getInboxEndpoint(
			makeEvent({
				url: `${ORIGIN}/api/inboxes/probe-z`,
				params: { id: 'probe-z' },
				headers: { authorization: 'Bearer wrongkey-doesnt-match' }
			})
		);
		expect(realWrongKey.status).toBe(bogusWrongKey.status);
		const rj = (await realWrongKey.json()) as GetInboxResponse;
		const bj = (await bogusWrongKey.json()) as GetInboxResponse;
		expect(rj.locked).toBe(true);
		expect(bj.locked).toBe(true);
		if (!rj.locked || !bj.locked) return;
		// Top-level + nested-shell key parity, value-domain match.
		expect(Object.keys(rj).sort()).toEqual(Object.keys(bj).sort());
		expect(Object.keys(rj.shell).sort()).toEqual(Object.keys(bj.shell).sort());
		expect(bj.shell.publicToken).toHaveLength(CONFIG.TOKEN_LENGTH);
		expect(bj.shell.requestCount).toBeGreaterThanOrEqual(0);
		expect(bj.shell.requestCount).toBeLessThanOrEqual(CONFIG.MAX_REQUESTS_PER_INBOX);
		// Stability across probes of the same bogus id under wrong-key auth.
		const bj2 = (await (
			await getInboxEndpoint(
				makeEvent({
					url: `${ORIGIN}/api/inboxes/probe-z`,
					params: { id: 'probe-z' },
					headers: { authorization: 'Bearer wrongkey-doesnt-match' }
				})
			)
		).json()) as GetInboxResponse;
		expect(bj2).toEqual(bj);
	});

	it('authed-bogus on /requests/[rid] returns 200 + WebhookRequest-shape parity with authed-real', async () => {
		const inbox = createInbox(KEY);
		// real path
		await receive(
			makeEvent({
				url: `${ORIGIN}/in/${inbox.publicToken}`,
				method: 'POST',
				body: 'hi',
				params: { token: inbox.publicToken }
			})
		);
		const list = await getInboxEndpoint(
			makeEvent({
				url: `${ORIGIN}/api/inboxes/${inbox.id}`,
				params: { id: inbox.id },
				headers: authHeaders()
			})
		);
		const ld = (await list.json()) as GetInboxResponse;
		if (ld.locked) throw new Error('locked');
		const realRid = ld.requests[0].id;
		const realDetail = await getRequestEndpoint(
			makeEvent({
				url: `${ORIGIN}/api/inboxes/${inbox.id}/requests/${realRid}`,
				params: { id: inbox.id, requestId: realRid },
				headers: authHeaders()
			})
		);
		const bogusDetail = await getRequestEndpoint(
			makeEvent({
				url: `${ORIGIN}/api/inboxes/${inbox.id}/requests/never-happened`,
				params: { id: inbox.id, requestId: 'never-happened' },
				headers: authHeaders()
			})
		);
		expect(realDetail.status).toBe(200);
		expect(bogusDetail.status).toBe(200);
		const rd = (await realDetail.json()) as WebhookRequest;
		const bd = (await bogusDetail.json()) as WebhookRequest;
		expect(Object.keys(rd).sort()).toEqual(Object.keys(bd).sort());
		expect(bd.id).toBe('never-happened');
		expect(bd.inboxId).toBe(inbox.id);
		// Stability across probes.
		const bd2 = (await (
			await getRequestEndpoint(
				makeEvent({
					url: `${ORIGIN}/api/inboxes/${inbox.id}/requests/never-happened`,
					params: { id: inbox.id, requestId: 'never-happened' },
					headers: authHeaders()
				})
			)
		).json()) as WebhookRequest;
		expect(bd2).toEqual(bd);
	});

	it('authed-bogus on /raw returns 200 + text/plain + attachment headers (empty body is fine)', async () => {
		const inbox = createInbox(KEY);
		const res = await rawEndpoint(
			makeEvent({
				url: `${ORIGIN}/api/inboxes/${inbox.id}/requests/missing/raw`,
				params: { id: inbox.id, requestId: 'missing' },
				headers: authHeaders()
			})
		);
		expect(res.status).toBe(200);
		expect(res.headers.get('content-type')).toBe('text/plain;charset=utf-8');
		expect(res.headers.get('x-content-type-options')).toBe('nosniff');
		expect(res.headers.get('content-disposition')).toBe(
			'attachment; filename="body-missing.txt"'
		);
		expect(await res.text()).toBe('');
	});
});

// -----------------------------------------------------------------------------
// Cycle-3 item 23 — XFF integration: stored sourceIp comes from X-Forwarded-For
// (the unit cases live in src/lib/server/receive.test.ts).
// -----------------------------------------------------------------------------

describe('X-Forwarded-For end-to-end (cycle-3 item 23)', () => {
	it('captured sourceIp = XFF leftmost when the header is present', async () => {
		const inbox = createInbox(KEY);
		const stored = await postAndFetch(inbox, {
			headers: { 'x-forwarded-for': '203.0.113.42, 10.0.0.1, 10.0.0.2' },
			body: 'ok'
		});
		expect(stored.sourceIp).toBe('203.0.113.42');
	});

	it('captured sourceIp = getClientAddress() fallback when XFF is absent', async () => {
		const inbox = createInbox(KEY);
		const stored = await postAndFetch(inbox, { body: 'ok' });
		// postAndFetch uses the makeEvent default getClientAddress.
		expect(stored.sourceIp).toBe('203.0.113.9');
	});
});

// -----------------------------------------------------------------------------
// Cycle-5 item 9a — cf-connecting-ip end-to-end. The exact probe from the
// CTO brief: cf-connecting-ip 1.2.3.4 vs x-forwarded-for 9.9.9.9. Captured
// sourceIp must be the cf-ip, not the xff. cf-connecting-ip wins because
// we're behind Cloudflare in production (webhook.dexli.dev) and CF rewrites
// it at the edge — XFF can be appended by any intermediate proxy.
// -----------------------------------------------------------------------------

describe('cf-connecting-ip end-to-end (cycle-5 item 9a)', () => {
	it('captured sourceIp = cf-connecting-ip when present alone', async () => {
		const inbox = createInbox(KEY);
		const stored = await postAndFetch(inbox, {
			headers: { 'cf-connecting-ip': '1.2.3.4' },
			body: 'ok'
		});
		expect(stored.sourceIp).toBe('1.2.3.4');
	});

	it('CTO brief probe: cf-ip 1.2.3.4 + xff 9.9.9.9 → captured IP = 1.2.3.4', async () => {
		const inbox = createInbox(KEY);
		const stored = await postAndFetch(inbox, {
			headers: {
				'cf-connecting-ip': '1.2.3.4',
				'x-forwarded-for': '9.9.9.9'
			},
			body: 'ok'
		});
		expect(stored.sourceIp).toBe('1.2.3.4');
		expect(stored.sourceIp).not.toBe('9.9.9.9');
	});

	it('xff still works when cf-connecting-ip absent (regression guard)', async () => {
		// Additive-on-the-left property. The cycle-3 item-23 XFF behavior is
		// unchanged for non-CF deployments.
		const inbox = createInbox(KEY);
		const stored = await postAndFetch(inbox, {
			headers: { 'x-forwarded-for': '198.51.100.7' },
			body: 'ok'
		});
		expect(stored.sourceIp).toBe('198.51.100.7');
	});
});

// -----------------------------------------------------------------------------
// Cycle-5 item 9b — DELETE indistinguishability. Same shape-equivalence
// discipline the GET endpoints carry, extended to a state-changing verb. An
// external observer cannot distinguish the four DELETE cases (bogus, real-
// nokey, real-wrongkey, real-rightkey) from the response alone.
// -----------------------------------------------------------------------------

describe('DELETE /api/inboxes/[id] indistinguishability (cycle-5 item 9b)', () => {
	async function snapshot(res: Response): Promise<{
		status: number;
		body: string;
		headers: Record<string, string>;
	}> {
		const body = await res.text();
		const headers: Record<string, string> = {};
		for (const [k, v] of res.headers) headers[k.toLowerCase()] = v;
		return { status: res.status, body, headers };
	}

	it('all 4 DELETE cases produce byte-identical responses', async () => {
		const inbox = createInbox(KEY);
		const cases = [
			{
				label: 'bogus-id + anykey',
				params: { id: randomToken(CONFIG.TOKEN_LENGTH) },
				headers: authHeaders()
			},
			{
				label: 'real-id + nokey',
				params: { id: inbox.id },
				headers: undefined as Record<string, string> | undefined
			},
			{
				label: 'real-id + wrongkey',
				params: { id: inbox.id },
				headers: { authorization: 'Bearer wrongkey' }
			},
			// state-changing case last
			{
				label: 'real-id + correctkey',
				params: { id: inbox.id },
				headers: authHeaders()
			}
		];

		const snaps: { label: string; snap: Awaited<ReturnType<typeof snapshot>> }[] = [];
		for (const c of cases) {
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

		const base = snaps[0].snap;
		expect(base.status).toBe(204);
		expect(base.body).toBe('');
		for (const s of snaps) {
			expect(s.snap.status, `status diverged at ${s.label}`).toBe(204);
			expect(s.snap.body, `body diverged at ${s.label}`).toBe('');
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
	});

	it('STABILITY: repeated DELETE probes against the same bogus id are byte-identical', async () => {
		// Defence against per-call response drift (random nonces, varying
		// timestamps, etc.). The handler has none today, but make the invariant
		// explicit so a future refactor cannot regress it silently.
		const id = randomToken(CONFIG.TOKEN_LENGTH);
		const first = await deleteInboxEndpoint(
			makeEvent({
				url: `${ORIGIN}/api/inboxes/${id}`,
				method: 'DELETE',
				params: { id }
			})
		);
		const second = await deleteInboxEndpoint(
			makeEvent({
				url: `${ORIGIN}/api/inboxes/${id}`,
				method: 'DELETE',
				params: { id }
			})
		);
		const a = await snapshot(first);
		const b = await snapshot(second);
		expect(a).toEqual(b);
	});

	it('correct-key DELETE flips state: subsequent GET returns synth (not real) shell', async () => {
		const inbox = createInbox(KEY);
		await deleteInboxEndpoint(
			makeEvent({
				url: `${ORIGIN}/api/inboxes/${inbox.id}`,
				method: 'DELETE',
				params: { id: inbox.id },
				headers: authHeaders()
			})
		);
		// Probe with the correct key — would unlock if the inbox still existed.
		// After DELETE it doesn't, so the locked-bogus path returns a synth
		// shell. The synth publicToken differs from the real one we just deleted.
		const get = await getInboxEndpoint(
			makeEvent({
				url: `${ORIGIN}/api/inboxes/${inbox.id}`,
				params: { id: inbox.id },
				headers: authHeaders()
			})
		);
		const body = (await get.json()) as GetInboxResponse;
		expect(body.locked).toBe(true);
		if (body.locked === true) {
			expect(body.shell.publicToken).not.toBe(inbox.publicToken);
		}
	});
});
