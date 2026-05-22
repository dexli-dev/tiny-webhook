// POST /api/inboxes — create a new webhook inbox.

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createInbox, tryConsumeInboxCreation } from '$lib/server/store';
import { clientIp } from '$lib/server/receive';
import type { ApiError, CreateInboxResponse } from '$lib/types';

export const POST: RequestHandler = async (event) => {
	const ip = clientIp(event.request, event.getClientAddress);

	if (!tryConsumeInboxCreation(ip)) {
		const body: ApiError = { error: 'Too many inboxes created from this address. Try again later.' };
		return json(body, { status: 429 });
	}

	const inbox = createInbox();
	const { origin } = event.url;
	const body: CreateInboxResponse = {
		inboxId: inbox.id,
		publicToken: inbox.publicToken,
		webhookUrl: `${origin}/in/${inbox.publicToken}`,
		dashboardUrl: `${origin}/inbox/${inbox.id}`,
		expiresAt: inbox.expiresAt
	};
	return json(body, { status: 201 });
};
