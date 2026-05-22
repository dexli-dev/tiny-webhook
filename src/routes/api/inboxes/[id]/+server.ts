// GET /api/inboxes/[id] — inbox metadata + request summaries (newest first).

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getInbox, listRequests } from '$lib/server/store';
import type { ApiError, GetInboxResponse } from '$lib/types';

export const GET: RequestHandler = async (event) => {
	const id = event.params.id!;
	const inbox = getInbox(id);
	const requests = listRequests(id);
	if (!inbox || !requests) {
		const body: ApiError = { error: 'Inbox not found or expired.' };
		return json(body, { status: 404 });
	}
	const body: GetInboxResponse = { inbox, requests };
	return json(body);
};
