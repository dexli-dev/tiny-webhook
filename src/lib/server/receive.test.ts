import { describe, expect, it } from 'vitest';
import { CONFIG } from '$lib/config';
import { captureRequest, clientIp } from './receive';

const addr = () => '203.0.113.1';

describe('clientIp / cf-connecting-ip (cycle-5, bar item 9a)', () => {
	it('cf-connecting-ip alone → used', () => {
		const req = new Request('http://x/in/t', {
			headers: { 'cf-connecting-ip': '1.2.3.4' }
		});
		expect(clientIp(req, addr)).toBe('1.2.3.4');
	});

	it('cf-connecting-ip WINS over x-forwarded-for', () => {
		// The exact probe from the cycle-5 brief: cf-ip 1.2.3.4 vs xff 9.9.9.9.
		// CF is the trusted edge writing cf-connecting-ip; XFF can be appended
		// by any intermediate proxy, including the same hop CF prepends to.
		const req = new Request('http://x/in/t', {
			headers: {
				'cf-connecting-ip': '1.2.3.4',
				'x-forwarded-for': '9.9.9.9'
			}
		});
		expect(clientIp(req, addr)).toBe('1.2.3.4');
	});

	it('cf-connecting-ip WINS over xff AND getClientAddress', () => {
		const req = new Request('http://x/in/t', {
			headers: {
				'cf-connecting-ip': '1.2.3.4',
				'x-forwarded-for': '9.9.9.9, 10.0.0.1'
			}
		});
		expect(clientIp(req, () => '203.0.113.1')).toBe('1.2.3.4');
	});

	it('cf-connecting-ip with surrounding whitespace is trimmed', () => {
		const req = new Request('http://x/in/t', {
			headers: { 'cf-connecting-ip': '  1.2.3.4  ' }
		});
		expect(clientIp(req, addr)).toBe('1.2.3.4');
	});

	it('whitespace-only cf-connecting-ip → falls through to xff', () => {
		const req = new Request('http://x/in/t', {
			headers: { 'cf-connecting-ip': '   ', 'x-forwarded-for': '5.6.7.8' }
		});
		expect(clientIp(req, addr)).toBe('5.6.7.8');
	});

	it('whitespace-only cf-connecting-ip AND no xff → falls through to getClientAddress', () => {
		const req = new Request('http://x/in/t', {
			headers: { 'cf-connecting-ip': '   ' }
		});
		expect(clientIp(req, addr)).toBe('203.0.113.1');
	});

	it('cf-connecting-ip header IS regression-safe: absent header → identical XFF behavior', () => {
		// Sanity guard that cycle-5 is additive on the left of XFF, not a
		// replacement. The CTO directive: "the fallback chain is additive on
		// the LEFT of XFF, not a replacement." This duplicates an XFF test
		// here to make the invariant visible inline.
		const req = new Request('http://x/in/t', {
			headers: { 'x-forwarded-for': '1.2.3.4, 5.6.7.8, 10.0.0.1' }
		});
		expect(clientIp(req, addr)).toBe('1.2.3.4');
	});
});

describe('clientIp / X-Forwarded-For (bar item 23)', () => {
	it('no XFF header → falls back to getClientAddress', () => {
		const req = new Request('http://x/in/t');
		expect(clientIp(req, addr)).toBe('203.0.113.1');
	});

	it('single-hop XFF "1.2.3.4" → captured as "1.2.3.4"', () => {
		const req = new Request('http://x/in/t', {
			headers: { 'x-forwarded-for': '1.2.3.4' }
		});
		expect(clientIp(req, addr)).toBe('1.2.3.4');
	});

	it('multi-hop XFF takes the leftmost (closest-to-client) hop', () => {
		const req = new Request('http://x/in/t', {
			headers: { 'x-forwarded-for': '1.2.3.4, 5.6.7.8, 10.0.0.1' }
		});
		expect(clientIp(req, addr)).toBe('1.2.3.4');
	});

	it('whitespace-only XFF → falls back to getClientAddress', () => {
		const req = new Request('http://x/in/t', {
			headers: { 'x-forwarded-for': '   ' }
		});
		expect(clientIp(req, addr)).toBe('203.0.113.1');
	});

	it('leading-comma XFF (first hop empty) → falls back to getClientAddress', () => {
		const req = new Request('http://x/in/t', {
			headers: { 'x-forwarded-for': ', 10.0.0.1' }
		});
		expect(clientIp(req, addr)).toBe('203.0.113.1');
	});

	it('XFF present but getClientAddress would throw → returns the XFF hop (no fallback needed)', () => {
		const req = new Request('http://x/in/t', {
			headers: { 'x-forwarded-for': '70.0.0.9' }
		});
		expect(
			clientIp(req, () => {
				throw new Error('no peer');
			})
		).toBe('70.0.0.9');
	});

	it('no XFF + getClientAddress throws → returns "unknown"', () => {
		const req = new Request('http://x/in/t');
		expect(
			clientIp(req, () => {
				throw new Error('no peer');
			})
		).toBe('unknown');
	});

	it('whitespace around an XFF hop is trimmed', () => {
		const req = new Request('http://x/in/t', {
			headers: { 'x-forwarded-for': '  198.51.100.42  , 10.0.0.1' }
		});
		expect(clientIp(req, addr)).toBe('198.51.100.42');
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
		if (res.ok || !('tooLarge' in res)) throw new Error('expected tooLarge');
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
		if (res.ok || !('tooLarge' in res)) throw new Error('expected tooLarge');
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
