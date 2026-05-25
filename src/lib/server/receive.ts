// Request-capture helper for the receive endpoint (/in/[token] and subpaths).
//
// Factored out of the route handler so the capture logic is unit-testable with a
// plain `Request`/`URL` and a fake address resolver — no full SvelteKit
// RequestEvent needed.

import { CONFIG } from '$lib/config';
import type { CapturedInput } from '$lib/server/store';
import type { HeaderPair } from '$lib/types';

export type CaptureResult =
	| { ok: true; input: CapturedInput }
	/** Body exceeded CONFIG.MAX_BODY_BYTES. Handler should return 413 and not record. */
	| { ok: false; tooLarge: true; size: number }
	/**
	 * A captured header value contained CR or LF — either the platform's parser
	 * let it through or a downstream caller fabricated a Request. We refuse the
	 * capture: the handler returns 400 with a generic body and does NOT record.
	 * Defence in depth against in-value CR/LF (cycle-3, bar item 12).
	 */
	| { ok: false; badHeaders: true }
	/**
	 * A captured header name belongs to the response-only header blocklist
	 * (Set-Cookie, Server, WWW-Authenticate, etc.). The practical reason
	 * CRLF-in-headers matters is that an attacker wants to influence response
	 * headers; legitimate webhooks never send these names TO us. A wire-level
	 * `\r\n` smuggling probe (e.g. `X-Test: a\r\nSet-Cookie: pwn=1`) is split
	 * by Node's HTTP parser into two well-formed headers before our handler
	 * sees it, so the in-value scan above is blind to it — this blocklist is
	 * what catches it (cycle-3a, bar item 12).
	 */
	| { ok: false; headerInjection: true };

/**
 * Response-only / smuggled-header names that should never appear on an inbound
 * webhook. Lowercased; comparison is case-insensitive because the platform
 * lowercases header names during parsing.
 */
const RESPONSE_ONLY_HEADERS: ReadonlySet<string> = new Set([
	'set-cookie',
	'set-cookie2',
	'server',
	'www-authenticate',
	'proxy-authenticate',
	'strict-transport-security',
	'content-security-policy',
	'content-security-policy-report-only',
	'x-frame-options',
	'x-content-type-options',
	'x-xss-protection',
	'public-key-pins',
	'location'
]);

/**
 * Best-effort source IP. Fallback chain (cycle-5, bar item 9a):
 *
 *   1. `cf-connecting-ip` — Cloudflare-injected single-value true client IP.
 *      We're behind Cloudflare in production (webhook.dexli.dev), and CF
 *      strips/overrides any client-supplied `cf-connecting-ip`, so when this
 *      header is present we trust it as the closest-to-client address. It
 *      wins over XFF because XFF can be appended-to by any intermediate proxy
 *      but only CF writes `cf-connecting-ip` at the edge.
 *
 *   2. Leftmost `x-forwarded-for` hop — for non-CF deployments and legacy
 *      reverse-proxy chains. The first XFF entry is the closest-to-client
 *      address a proxy appended.
 *
 *   3. `getClientAddress()` — the transport peer (i.e. whatever the platform
 *      adapter knows about the socket).
 *
 *   4. Literal `"unknown"` — when the adapter has no peer info (unit tests).
 *
 * Empty/whitespace values are skipped at each step, falling through to the
 * next. Adding cf-connecting-ip is ADDITIVE: pre-existing XFF behavior is
 * unchanged when cf-connecting-ip is absent.
 */
export function clientIp(request: Request, getClientAddress: () => string): string {
	const cfIp = request.headers.get('cf-connecting-ip');
	if (cfIp) {
		const trimmed = cfIp.trim();
		if (trimmed) return trimmed;
	}
	const xff = request.headers.get('x-forwarded-for');
	if (xff) {
		const first = xff.split(',')[0]?.trim();
		if (first) return first;
	}
	try {
		return getClientAddress();
	} catch {
		// Some adapters throw when no peer address is available (e.g. unit tests).
		return 'unknown';
	}
}

/**
 * Capture an incoming webhook request into the store's input shape.
 *
 * Body handling: bodies larger than CONFIG.MAX_BODY_BYTES are rejected with a
 * `tooLarge` result (the handler returns 413 and records nothing) rather than
 * silently truncated — the WebhookRequest contract has no truncation flag, so a
 * partial body stored under an honest size would be misleading. A declared
 * Content-Length over the limit short-circuits before the body is buffered.
 *
 * Header order: headers are returned as the platform `Headers` iterator yields
 * them (lowercased; the Fetch/undici layer does not preserve raw wire order).
 */
export async function captureRequest(
	request: Request,
	url: URL,
	getClientAddress: () => string
): Promise<CaptureResult> {
	const declared = request.headers.get('content-length');
	if (declared) {
		const n = Number(declared);
		if (Number.isFinite(n) && n > CONFIG.MAX_BODY_BYTES) {
			return { ok: false, tooLarge: true, size: n };
		}
	}

	const buf = await request.arrayBuffer();
	const bytes = new Uint8Array(buf);
	const bodySizeBytes = bytes.byteLength;
	if (bodySizeBytes > CONFIG.MAX_BODY_BYTES) {
		return { ok: false, tooLarge: true, size: bodySizeBytes };
	}
	const bodyText = bodySizeBytes > 0 ? new TextDecoder().decode(bytes) : '';

	const headers: HeaderPair[] = [...request.headers];

	// Header guards (cycle-3 + cycle-3a). Two separate checks against two
	// different attacker pathways:
	//
	//   1. CR/LF inside a single header value — the platform parser would
	//      normally reject this, but defence in depth covers any future adapter
	//      or hand-built Request that bypasses validation.
	//
	//   2. A response-only header name on an inbound request. This is what
	//      catches a wire-level `X-Test: a\r\nSet-Cookie: pwn=1` probe: Node's
	//      HTTP parser splits at the CRLF and presents Set-Cookie as a normal
	//      header, so check (1) sees nothing. Legitimate webhooks never send
	//      response-only headers to us; flagging them is both correct and
	//      sufficient to defeat the practical attack (response-header smuggling).
	//
	// Both refusals are non-recording: 400 + generic body, no inbox write, no
	// SSE emission.
	for (const [name, value] of headers) {
		if (value.includes('\r') || value.includes('\n')) {
			return { ok: false, badHeaders: true };
		}
		if (RESPONSE_ONLY_HEADERS.has(name.toLowerCase())) {
			return { ok: false, headerInjection: true };
		}
	}

	const input: CapturedInput = {
		method: request.method,
		// Full path hit on the receive endpoint, e.g. "/in/abc123/sub/path".
		path: url.pathname,
		// Query string without the leading "?"; empty when none.
		queryString: url.search.startsWith('?') ? url.search.slice(1) : url.search,
		headers,
		bodyText,
		bodySizeBytes,
		contentType: request.headers.get('content-type'),
		sourceIp: clientIp(request, getClientAddress),
		userAgent: request.headers.get('user-agent'),
		responseStatus: 200
	};

	return { ok: true, input };
}
