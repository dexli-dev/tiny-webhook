// GET /api/inboxes/[id]/requests/[requestId]
//
// Bearer-key gated. Three outcomes:
//
//  - Unauth (or wrong key) → 404 with generic "Not found." (unchanged).
//  - Authed + real-rid    → 200 + the stored WebhookRequest.
//  - Authed + missing-rid → 200 + a SYNTHETIC WebhookRequest with the same
//    shape (cycle-3a, bar item 14 extension). This means an authorized caller
//    probing random rids on their own inbox cannot enumerate which rids
//    actually exist by shape divergence (200 full vs 404).
//
// Synthetic output is deterministic per (id, rid) pair within this process.

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getRequest, synthRequest } from '$lib/server/store';
import { isAuthorized } from '$lib/server/auth';
import type { ApiError, GetRequestResponse } from '$lib/types';

const NOT_FOUND: ApiError = { error: 'Not found.' };

export const GET: RequestHandler = (event) => {
	const id = event.params.id!;
	const requestId = event.params.requestId!;
	if (!isAuthorized(id, event.request)) {
		return json(NOT_FOUND, { status: 404 });
	}
	const r = getRequest(id, requestId) ?? synthRequest(id, requestId);
	const res: GetRequestResponse = r;
	return json(res, { status: 200 });
};
