import { describe, expect, it } from 'vitest';
import { CONFIG } from '$lib/config';
import { captureRequest, clientIp } from './receive';

const addr = () => '203.0.113.1';

describe('clientIp', () => {
	it('uses the first x-forwarded-for hop when present', () => {
		const req = new Request('http://x/in/t', {
			headers: { 'x-forwarded-for': '70.0.0.9, 10.0.0.1, 10.0.0.2' }
		});
		expect(clientIp(req, addr)).toBe('70.0.0.9');
	});

	it('falls back to the transport address with no XFF', () => {
		const req = new Request('http://x/in/t');
		expect(clientIp(req, addr)).toBe('203.0.113.1');
	});

	it('falls back to "unknown" when the resolver throws', () => {
		const req = new Request('http://x/in/t');
		expect(
			clientIp(req, () => {
				throw new Error('no peer');
			})
		).toBe('unknown');
	});
});

describe('captureRequest', () => {
	it('captures method, path, query, body, content-type and user-agent', async () => {
		const url = new URL('http://host/in/tok/sub/path?a=1&b=2');
		const req = new Request(url, {
			method: 'POST',
			headers: { 'content-type': 'application/json', 'user-agent': 'curl/8.0' },
			body: '{"hello":"world"}'
		});
		const res = await captureRequest(req, url, addr);
		expect(res.ok).toBe(true);
		if (!res.ok) return;
		const i = res.input;
		expect(i.method).toBe('POST');
		expect(i.path).toBe('/in/tok/sub/path');
		expect(i.queryString).toBe('a=1&b=2');
		expect(i.bodyText).toBe('{"hello":"world"}');
		expect(i.bodySizeBytes).toBe(17);
		expect(i.contentType).toBe('application/json');
		expect(i.userAgent).toBe('curl/8.0');
		expect(i.sourceIp).toBe('203.0.113.1');
		expect(i.responseStatus).toBe(200);
		expect(i.headers).toContainEqual(['content-type', 'application/json']);
	});

	it('handles an empty body and absent optional headers', async () => {
		const url = new URL('http://host/in/tok');
		const req = new Request(url, { method: 'GET' });
		const res = await captureRequest(req, url, addr);
		expect(res.ok).toBe(true);
		if (!res.ok) return;
		expect(res.input.bodyText).toBe('');
		expect(res.input.bodySizeBytes).toBe(0);
		expect(res.input.queryString).toBe('');
		expect(res.input.contentType).toBeNull();
		expect(res.input.userAgent).toBeNull();
	});

	it('measures body size in bytes, not characters', async () => {
		const url = new URL('http://host/in/tok');
		// "€" is 3 UTF-8 bytes
		const req = new Request(url, { method: 'POST', body: '€' });
		const res = await captureRequest(req, url, addr);
		expect(res.ok).toBe(true);
		if (!res.ok) return;
		expect(res.input.bodyText).toBe('€');
		expect(res.input.bodySizeBytes).toBe(3);
	});

	it('rejects a body over the limit (actual bytes)', async () => {
		const url = new URL('http://host/in/tok');
		const big = 'x'.repeat(CONFIG.MAX_BODY_BYTES + 1);
		const req = new Request(url, { method: 'POST', body: big });
		const res = await captureRequest(req, url, addr);
		expect(res.ok).toBe(false);
		if (res.ok) return;
		expect(res.tooLarge).toBe(true);
		expect(res.size).toBe(CONFIG.MAX_BODY_BYTES + 1);
	});

	it('short-circuits on a declared oversize content-length', async () => {
		const url = new URL('http://host/in/tok');
		const req = new Request(url, {
			method: 'POST',
			headers: { 'content-length': String(CONFIG.MAX_BODY_BYTES + 100) },
			body: 'small actual body'
		});
		const res = await captureRequest(req, url, addr);
		expect(res.ok).toBe(false);
		if (res.ok) return;
		expect(res.size).toBe(CONFIG.MAX_BODY_BYTES + 100);
	});

	it('accepts a body exactly at the limit', async () => {
		const url = new URL('http://host/in/tok');
		const body = 'x'.repeat(CONFIG.MAX_BODY_BYTES);
		const req = new Request(url, { method: 'POST', body });
		const res = await captureRequest(req, url, addr);
		expect(res.ok).toBe(true);
		if (!res.ok) return;
		expect(res.input.bodySizeBytes).toBe(CONFIG.MAX_BODY_BYTES);
	});
});
