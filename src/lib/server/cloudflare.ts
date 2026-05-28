// Soft mitigation for the CF-Connecting-IP trust chain (vector 5 option 1
// per the 2026-05-28 standing-mandate audit).
//
// The app trusts CF-Connecting-IP for per-IP rate limit attribution
// (POST /api/inboxes) and recorded source-IP on captured webhooks
// (/in/[token]). On the CF-fronted path that trust is sound — CF's edge
// rejects user-supplied CF-Connecting-IP at the proxy layer. But if an
// attacker discovers the origin IP and POSTs directly to origin, no
// edge-side rejection happens — the attacker can spoof CF-Connecting-IP
// freely.
//
// This guard is the SOFT layer of the trust ladder. When
// CONFIG.REQUIRE_CLOUDFLARE_HEADERS is true, direct-origin requests are
// rejected with 403 unless they carry a CF-RAY header. CF sets CF-RAY on
// every proxied request, so the CF-fronted path passes naturally.
//
// What this guard does NOT do:
//   - Validate that CF-RAY is actually from CF (header is forgeable by an
//     attacker who knows the guard exists). The structural close is option 3
//     (CF Authenticated Origin Pulls / mTLS) which closes at the TLS layer
//     before HTTP semantics. See [[feedback_cf_connecting_ip_trust_chain]].
//   - Validate CF-RAY shape ([0-9a-f]{16}-XXX). Syntax validation creates
//     false confidence ("I checked the format!") without authenticity.
//   - Bypass loopback/RFC1918 peers. Route placement (per-route, not global)
//     is the carveout mechanism so health-check paths aren't affected.

import { CONFIG } from '$lib/config';

/**
 * Returns null if the request should proceed, or a 403 Response if the
 * Cloudflare-fronting guard is active and the request is missing CF-RAY.
 *
 * Call at the top of any handler that trusts CF-Connecting-IP, BEFORE any
 * per-IP rate-limit check (a missing-CF-RAY request should not consume a
 * victim-attributed quota slot).
 *
 * The `enabled` parameter exposes the on/off toggle for direct testing
 * without process.env mutation — production callers omit it and inherit
 * CONFIG.REQUIRE_CLOUDFLARE_HEADERS.
 */
export function requireCloudflareEdge(
	request: Request,
	enabled: boolean = CONFIG.REQUIRE_CLOUDFLARE_HEADERS
): Response | null {
	if (!enabled) return null;
	const cfRay = request.headers.get('cf-ray');
	if (cfRay && cfRay.length > 0) return null;
	return new Response(JSON.stringify({ error: 'Origin access requires Cloudflare-edge headers.' }), {
		status: 403,
		headers: { 'Content-Type': 'application/json' }
	});
}
