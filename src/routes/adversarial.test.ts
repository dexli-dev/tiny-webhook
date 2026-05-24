// Adversarial sweep for cycle-2 bar items 10/12/14/15.
//
// These tests do not exercise the network stack end-to-end (Node's HTTP parser
// 431 / 414 / 400 behaviour is its own contract). They exercise the *handler*
// layer: given a request that has already been parsed (or rejected) by the
// platform, our code must store input verbatim, never reflect attacker content
// back as executable text, never crash, and never leak token existence.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CONFIG } from '$lib/config';
import { __resetForTests, createInbox } from '$lib/server/store';
import type { GetInboxResponse, Inbox, WebhookRequest } from '$lib/types';

import { POST as receive } from './in/[token]/+server';
import * as receiveModule from './in/[token]/+server';
import { GET as getInboxEndpoint } from './api/inboxes/[id]/+server';
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
	it('a CRLF-injection attempt in a header value is rejected by the platform before reaching the handler', () => {
		// undici's Request constructor validates header field-values and refuses
		// any embedded CR/LF — this is the very rejection we rely on. In a real
		// HTTP request, Node's parser performs the equivalent check. Either way,
		// our handler is never invoked with a malformed header.
		expect(
			() =>
				new Request(`${ORIGIN}/in/anything`, {
					method: 'POST',
					headers: { 'x-test': 'value\r\nX-Injected: yes' }
				})
		).toThrow();
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
