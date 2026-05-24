// GET /api/inboxes/[id]
//
// Always 200. Three response shapes, all matching the GetInboxResponse union:
//
//  - locked:false (full inbox + requests)  — caller presented the right key
//    AND the inbox really exists
//  - locked:true with the REAL shell       — caller missing/wrong key but
//    the inbox really exists
//  - locked:true with a SYNTHETIC shell    — id does not match any inbox
//    (cycle-3, bar item 14 extension)
//
// Returning 200+synthetic-shell for unknown ids means a probe cannot tell
// "this dashboard URL points to a live inbox" from "this is a random string."
// The synthetic publicToken drifts per call; eval checks shape parity, not
// byte-equality across probes.

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getInbox, inboxShell, listRequests, synthShell } from '$lib/server/store';
import { isAuthorized } from '$lib/server/auth';
import type { GetInboxResponse } from '$lib/types';

export const GET: RequestHandler = (event) => {
	const id = event.params.id!;
	const inbox = getInbox(id);
	if (inbox && isAuthorized(id, event.request)) {
		const requests = listRequests(id) ?? [];
		const res: GetInboxResponse = { locked: false, inbox, requests };
		return json(res, { status: 200 });
	}
	// Either no key (real or bogus id) — return a locked shell either way.
	const shell = inbox ? inboxShell(id) : undefined;
	const res: GetInboxResponse = { locked: true, shell: shell ?? synthShell(id) };
	return json(res, { status: 200 });
};
