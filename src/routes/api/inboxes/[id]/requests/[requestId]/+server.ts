// GET /api/inboxes/[id]/requests/[requestId]
//
// Bearer-key gated. Returns the full WebhookRequest if the caller is
// authorized and the request exists. Without a valid key, responds 404 with a
// generic body — indistinguishable from a missing request id, so a caller
// without the key cannot probe which request ids exist.

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getRequest } from '$lib/server/store';
import { isAuthorized } from '$lib/server/auth';
import type { ApiError, GetRequestResponse } from '$lib/types';

const NOT_FOUND: ApiError = { error: 'Not found.' };

export const GET: RequestHandler = (event) => {
	const id = event.params.id!;
	const requestId = event.params.requestId!;
	if (!isAuthorized(id, event.request)) {
		return json(NOT_FOUND, { status: 404 });
	}
	const r = getRequest(id, requestId);
	if (!r) return json(NOT_FOUND, { status: 404 });
	const res: GetRequestResponse = r;
	return json(res, { status: 200 });
};
