// Receive endpoint: /in/[token]
//
// Accepts any of CONFIG.ACCEPTED_METHODS, captures the request, and stores it
// against the inbox identified by the public token. A sibling catch-all route
// ([...rest]) handles subpaths like /in/abc/x/y.
//
// Per cycle-2 bar item 14, the response shape is UNIFORM whether or not the
// token belongs to a real inbox: 200 {"ok":true} either way. Real tokens
// record; nonexistent tokens are silently discarded. This defeats token
// enumeration via response signal.

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { recordRequest } from '$lib/server/store';
import { captureRequest } from '$lib/server/receive';
import { requireCloudflareEdge } from '$lib/server/cloudflare';
import { CONFIG } from '$lib/config';
import type { ApiError, ReceiveResponse } from '$lib/types';

const handle: RequestHandler = async (event) => {
	// CF-edge guard: when active, a direct-origin probe is rejected before
	// any token resolution. Because the response is 403 (not 200) and fires
	// regardless of token validity, the bar item 14 token-enumeration defense
	// is preserved — an attacker who reaches origin direct learns "this
	// server requires CF" but not "this token exists or not."
	const blocked = requireCloudflareEdge(event.request);
	if (blocked) return blocked;

	const token = event.params.token!;

	const result = await captureRequest(event.request, event.url, event.getClientAddress);
	if (!result.ok) {
		if ('tooLarge' in result) {
			const body: ApiError = {
				error: `Request body exceeds the limit of ${CONFIG.MAX_BODY_BYTES} bytes (got ${result.size}).`
			};
			return json(body, { status: 413 });
		}
		// badHeaders (CRLF in value) and headerInjection (response-only header
		// name present) both collapse to a generic 400 — the response shape
		// must not leak which guard tripped. Never record.
		const body: ApiError = { error: 'Request contains an invalid header.' };
		return json(body, { status: 400 });
	}

	// recordRequest returns null for unknown/expired tokens. We deliberately
	// discard that information and respond identically — see bar item 14.
	recordRequest(token, result.input);

	const ok: ReceiveResponse = { ok: true };
	return json(ok, { status: 200 });
};

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
export const OPTIONS = handle;
