// GET /api/inboxes/[id]/requests/[requestId] — full captured request.

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getRequest } from '$lib/server/store';
import type { ApiError, GetRequestResponse } from '$lib/types';

export const GET: RequestHandler = async (event) => {
	const { id, requestId } = event.params as { id: string; requestId: string };
	const request = getRequest(id, requestId);
	if (!request) {
		const body: ApiError = { error: 'Request not found.' };
		return json(body, { status: 404 });
	}
	const body: GetRequestResponse = request;
	return json(body);
};
