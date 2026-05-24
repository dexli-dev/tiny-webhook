// GET /api/inboxes/[id]
//
// Bearer-key gated (cycle-2, bar items 18-20). A caller with the correct
// Authorization: Bearer <key> receives the full inbox view (inbox metadata +
// request summaries). A caller without a valid key — different browser, cleared
// localStorage, etc. — receives the locked-shell view: publicToken, expiresAt,
// requestCount. Truly nonexistent inbox ids respond 404.

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getInbox, inboxShell, listRequests } from '$lib/server/store';
import { isAuthorized } from '$lib/server/auth';
import type { ApiError, GetInboxResponse } from '$lib/types';

export const GET: RequestHandler = (event) => {
	const id = event.params.id!;
	const inbox = getInbox(id);
	if (!inbox) {
		const body: ApiError = { error: 'Inbox not found or expired.' };
		return json(body, { status: 404 });
	}
	if (!isAuthorized(id, event.request)) {
		const shell = inboxShell(id);
		if (!shell) {
			const body: ApiError = { error: 'Inbox not found or expired.' };
			return json(body, { status: 404 });
		}
		const res: GetInboxResponse = { locked: true, shell };
		return json(res, { status: 200 });
	}
	const requests = listRequests(id) ?? [];
	const res: GetInboxResponse = { locked: false, inbox, requests };
	return json(res, { status: 200 });
};
