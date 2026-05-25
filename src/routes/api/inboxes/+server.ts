// POST /api/inboxes — create a new key-locked inbox.
//
// The caller (browser) supplies a base64url-encoded 256-bit random secret in
// the JSON body: { "key": "<base64url>" }. The server stores only the SHA-256
// hash of this key (see src/lib/server/store.ts) and returns the inbox
// metadata. Subsequent content reads must present the same key as
// Authorization: Bearer <key>.

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createInbox, tryConsumeInboxCreation } from '$lib/server/store';
import { clientIp } from '$lib/server/receive';
import { CONFIG } from '$lib/config';
import type { ApiError, CreateInboxRequest, CreateInboxResponse } from '$lib/types';

/** Defensible bounds on the supplied key string. 256-bit base64url is 43 chars. */
const KEY_MIN_LEN = 16;
const KEY_MAX_LEN = 512;

export const POST: RequestHandler = async (event) => {
	const ip = clientIp(event.request, event.getClientAddress);
	if (!tryConsumeInboxCreation(ip)) {
		const body: ApiError = {
			error: 'Inbox-creation rate limit exceeded for this address. Wait a bit and try again.'
		};
		return json(body, { status: 429 });
	}

	let key: string;
	try {
		const parsed = (await event.request.json()) as Partial<CreateInboxRequest> | null;
		if (
			!parsed ||
			typeof parsed.key !== 'string' ||
			parsed.key.length < KEY_MIN_LEN ||
			parsed.key.length > KEY_MAX_LEN
		) {
			const body: ApiError = {
				error:
					'Request body must be JSON { "key": "<random secret, base64url>" } between 16 and 512 chars.'
			};
			return json(body, { status: 400 });
		}
		key = parsed.key;
	} catch {
		const body: ApiError = { error: 'Request body must be valid JSON.' };
		return json(body, { status: 400 });
	}

	const inbox = createInbox(key);
	// PUBLIC_BASE_URL wins when set (canonical origin even behind weird proxy
	// hops); otherwise fall back to the request origin so local dev / single-
	// host deploys just work without any config.
	const origin = CONFIG.PUBLIC_BASE_URL ?? event.url.origin;
	const res: CreateInboxResponse = {
		inboxId: inbox.id,
		publicToken: inbox.publicToken,
		webhookUrl: `${origin}/in/${inbox.publicToken}`,
		dashboardUrl: `${origin}/inbox/${inbox.id}`,
		expiresAt: inbox.expiresAt
	};
	return json(res, { status: 201 });
};
