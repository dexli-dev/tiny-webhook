// GET /api/inboxes/[id]
//
// Always 200. Two response shapes, both matching the GetInboxResponse union:
//
//  - locked:false — caller presents the right key for an existing inbox.
//    Returns the real inbox + real request summaries (the owner's view).
//  - locked:true  — every other case: missing key, wrong key, nonexistent
//    inbox, or any combination of those. Returns a locked shell — the REAL
//    shell when the inbox exists, a SYNTHETIC shell when it doesn't.
//
// Why uniformly-locked-for-anything-but-owner: the eval team showed that any
// branching of "auth bypasses shell-vs-unlocked" — including the cycle-3a
// "Authed-bogus → unlocked synthetic" model — creates a wrong-key oracle:
// presenting a wrong key against a bogus id would unlock, while the same
// wrong key against a real id stays locked, so wrong-key responses alone
// distinguish real from bogus ids. Restoring "any non-owner state → locked
// shell" eliminates that. The remaining unlocked-vs-locked divergence is
// owner-with-correct-key vs everyone-else, which is structurally inherent to
// the product's auth model — a caller still cannot enumerate other real
// inboxes because all non-owned ids (real-other AND bogus) respond uniformly
// with the locked shell shape, and the deterministic synthetic shell field
// values match the domain of real shell field values.

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
	// inboxShell can return undefined if the inbox expired between the getInbox
	// call and here — fall through to synthShell to keep the response uniform.
	const shell = (inbox ? inboxShell(id) : undefined) ?? synthShell(id);
	const res: GetInboxResponse = { locked: true, shell };
	return json(res, { status: 200 });
};
