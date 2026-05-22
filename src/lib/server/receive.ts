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
	| { ok: false; tooLarge: true; size: number };

/**
 * Best-effort source IP: first hop of x-forwarded-for, else the transport peer.
 * The first XFF entry is the closest-to-client address a proxy appended.
 */
export function clientIp(request: Request, getClientAddress: () => string): string {
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
