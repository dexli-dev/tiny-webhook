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

beforeEach(() => __resetForTests());
afterEach(() => __resetForTests());

describe('POST /api/inboxes', () => {
	it('creates an inbox and returns absolute URLs built from the request origin', async () => {
		const res = await createInboxEndpoint(
			makeEvent({ url: `${ORIGIN}/api/inboxes`, method: 'POST', ip: '1.1.1.1' })
		);
		expect(res.status).toBe(201);
		const body = (await res.json()) as CreateInboxResponse;
		expect(body.webhookUrl).toBe(`${ORIGIN}/in/${body.publicToken}`);
		expect(body.dashboardUrl).toBe(`${ORIGIN}/inbox/${body.inboxId}`);
		expect(typeof body.expiresAt).toBe('string');
	});

	it('returns 429 once the per-IP creation limit is exceeded', async () => {
		const ip = '2.2.2.2';
		for (let i = 0; i < CONFIG.MAX_INBOXES_PER_IP_PER_HOUR; i++) {
			const ok = await createInboxEndpoint(
				makeEvent({ url: `${ORIGIN}/api/inboxes`, method: 'POST', ip })
			);
			expect(ok.status).toBe(201);
		}
		const limited = await createInboxEndpoint(
			makeEvent({ url: `${ORIGIN}/api/inboxes`, method: 'POST', ip })
		);
		expect(limited.status).toBe(429);
	});
});

describe('receive /in/[token]', () => {
	it('captures a request and returns {ok:true}', async () => {
		const inbox = createInbox();
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
			makeEvent({ url: `${ORIGIN}/api/inboxes/${inbox.id}`, params: { id: inbox.id } })
		);
		const body = (await view.json()) as GetInboxResponse;
		expect(body.requests).toHaveLength(1);
		expect(body.requests[0].method).toBe('POST');
		expect(body.requests[0].path).toBe(`/in/${inbox.publicToken}`);
	});

	it('captures OPTIONS too', async () => {
		const inbox = createInbox();
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

	it('404s for an unknown token', async () => {
		const res = await receive(
			makeEvent({
				url: `${ORIGIN}/in/ghosttoken`,
				method: 'POST',
				body: 'x',
				params: { token: 'ghosttoken' }
			})
		);
		expect(res.status).toBe(404);
	});

	it('413s for an oversize body and stores nothing', async () => {
		const inbox = createInbox();
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
			makeEvent({ url: `${ORIGIN}/api/inboxes/${inbox.id}`, params: { id: inbox.id } })
		);
		expect(((await view.json()) as GetInboxResponse).requests).toHaveLength(0);
	});
});

describe('GET /api/inboxes/[id] and /requests/[requestId]', () => {
	it('returns full request detail and 404s on misses', async () => {
		const inbox = createInbox();
		const stored = recordRequest(inbox.publicToken, input({ method: 'PUT', bodyText: 'payload' }))!;

		const res = await getRequestEndpoint(
			makeEvent({
				url: `${ORIGIN}/api/inboxes/${inbox.id}/requests/${stored.id}`,
				params: { id: inbox.id, requestId: stored.id }
			})
		);
		const full = (await res.json()) as WebhookRequest;
		expect(full.method).toBe('PUT');
		expect(full.bodyText).toBe('payload');

		const miss = await getRequestEndpoint(
			makeEvent({
				url: `${ORIGIN}/api/inboxes/${inbox.id}/requests/nope`,
				params: { id: inbox.id, requestId: 'nope' }
			})
		);
		expect(miss.status).toBe(404);
	});

	it('404s for an unknown inbox', async () => {
		const res = await getInboxEndpoint(
			makeEvent({ url: `${ORIGIN}/api/inboxes/nope`, params: { id: 'nope' } })
		);
		expect(res.status).toBe(404);
	});
});

describe('GET /api/inboxes/[id]/events (SSE)', () => {
	it('opens the stream and pushes a request event', async () => {
		const inbox = createInbox();
		const ac = new AbortController();
		const res = await eventsEndpoint(
			makeEvent({
				url: `${ORIGIN}/api/inboxes/${inbox.id}/events`,
				params: { id: inbox.id },
				signal: ac.signal
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

	it('throws 404 for an unknown inbox', () => {
		expect(() =>
			eventsEndpoint(makeEvent({ url: `${ORIGIN}/api/inboxes/nope/events`, params: { id: 'nope' } }))
		).toThrow();
	});
});
