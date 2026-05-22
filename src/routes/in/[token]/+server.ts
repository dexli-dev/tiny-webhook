// Receive endpoint: /in/[token]
//
// Accepts any of CONFIG.ACCEPTED_METHODS, captures the request, and stores it
// against the inbox identified by the public token. A sibling catch-all route
// ([...rest]) handles subpaths like /in/abc/x/y.

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { recordRequest } from '$lib/server/store';
import { captureRequest } from '$lib/server/receive';
import { CONFIG } from '$lib/config';
import type { ApiError, ReceiveResponse } from '$lib/types';

const handle: RequestHandler = async (event) => {
	const token = event.params.token!;

	const result = await captureRequest(event.request, event.url, event.getClientAddress);
	if (!result.ok) {
		const body: ApiError = {
			error: `Request body exceeds the limit of ${CONFIG.MAX_BODY_BYTES} bytes (got ${result.size}).`
		};
		return json(body, { status: 413 });
	}

	const stored = recordRequest(token, result.input);
	if (!stored) {
		const body: ApiError = { error: 'Inbox not found or expired.' };
		return json(body, { status: 404 });
	}

	const ok: ReceiveResponse = { ok: true };
	return json(ok, { status: 200 });
};

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
export const OPTIONS = handle;
