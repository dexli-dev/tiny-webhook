import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CONFIG } from '$lib/config';
import { __resetForTests, createInbox, recordRequest } from '$lib/server/store';
import type { CapturedInput } from '$lib/server/store';
import type { CreateInboxResponse, GetInboxResponse, WebhookRequest } from '$lib/types';

import { POST as createInboxEndpoint } from './api/inboxes/+server';
import { POST as receive } from './in/[token]/+server';
import { GET as getInboxEndpoint } from './api/inboxes/[id]/+server';
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
		expect(body.shell.requestCount).toBe(0);
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
