import { describe, expect, it } from 'vitest';
import { requireCloudflareEdge } from './cloudflare';

function makeRequest(headers: Record<string, string> = {}): Request {
	return new Request('https://example.com/api/inboxes', {
		method: 'POST',
		headers
	});
}

describe('requireCloudflareEdge', () => {
	describe('enabled=false (default / dev)', () => {
		it('returns null when CF-RAY missing — request proceeds', () => {
			expect(requireCloudflareEdge(makeRequest(), false)).toBeNull();
		});

		it('returns null when CF-RAY present — request proceeds', () => {
			expect(
				requireCloudflareEdge(makeRequest({ 'cf-ray': '0000000000000000-LAX' }), false)
			).toBeNull();
		});
	});

	describe('enabled=true (production posture)', () => {
		it('returns null when CF-RAY present — request proceeds', () => {
			expect(
				requireCloudflareEdge(makeRequest({ 'cf-ray': '7d9e2f8a1b3c4d5e-ARN' }), true)
			).toBeNull();
		});

		it('returns 403 when CF-RAY missing entirely', async () => {
			const blocked = requireCloudflareEdge(makeRequest(), true);
			expect(blocked).not.toBeNull();
			expect(blocked!.status).toBe(403);
			const body = await blocked!.json();
			expect(body.error).toMatch(/cloudflare/i);
		});

		it('returns 403 when CF-RAY present but empty string', () => {
			const blocked = requireCloudflareEdge(makeRequest({ 'cf-ray': '' }), true);
			expect(blocked).not.toBeNull();
			expect(blocked!.status).toBe(403);
		});

		it('accepts a CF-RAY of any non-empty shape (intentional: no syntax check)', () => {
			// Documented design choice: shape validation creates false confidence
			// in authenticity without providing it. Presence-only.
			for (const stub of ['x', 'made-up', 'forged-by-attacker', '0000-XXX']) {
				expect(requireCloudflareEdge(makeRequest({ 'cf-ray': stub }), true)).toBeNull();
			}
		});
	});

	describe('response shape (when 403 fires)', () => {
		it('returns application/json body', async () => {
			const blocked = requireCloudflareEdge(makeRequest(), true);
			expect(blocked!.headers.get('content-type')).toBe('application/json');
		});

		it('body is the documented error string (post-deploy verification depends on it)', async () => {
			const blocked = requireCloudflareEdge(makeRequest(), true);
			const body = await blocked!.json();
			expect(body).toEqual({ error: 'Origin access requires Cloudflare-edge headers.' });
		});
	});
});
