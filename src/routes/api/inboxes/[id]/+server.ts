// GET /api/inboxes/[id]
//
// Always 200. Four response shapes, all matching the GetInboxResponse union,
// chosen so every authed-vs-unauth × real-vs-bogus combination produces a
// response shape indistinguishable from at least one other combination:
//
//  - authed + real  → locked:false, real inbox + real requests
//  - authed + bogus → locked:false, SYNTHETIC inbox + empty requests
//  - unauth + real  → locked:true,  REAL shell
//  - unauth + bogus → locked:true,  SYNTHETIC shell
//
// The synthetic outputs are deterministic per-id-per-process (see
// store.ts synth* helpers), so repeat-probing the same bogus id returns
// byte-identical responses — eval probes can't differentiate via drift either.

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	getInbox,
	inboxShell,
	listRequests,
	synthInbox,
	synthShell
} from '$lib/server/store';
import { extractBearer, isAuthorized } from '$lib/server/auth';
import type { GetInboxResponse } from '$lib/types';

export const GET: RequestHandler = (event) => {
	const id = event.params.id!;
	const inbox = getInbox(id);
	const authed = isAuthorized(id, event.request);
	const hasBearer = extractBearer(event.request) !== null;

	if (inbox && authed) {
		const requests = listRequests(id) ?? [];
		const res: GetInboxResponse = { locked: false, inbox, requests };
		return json(res, { status: 200 });
	}
	if (!inbox && hasBearer) {
		// Authed-bogus: mirror the shape an authed caller would see for their
		// own real-but-empty inbox, so a key-holder cannot enumerate live ids
		// by shape divergence on the unlocked path.
		const res: GetInboxResponse = { locked: false, inbox: synthInbox(id), requests: [] };
		return json(res, { status: 200 });
	}
	const shell = inbox ? inboxShell(id) : undefined;
	const res: GetInboxResponse = { locked: true, shell: shell ?? synthShell(id) };
	return json(res, { status: 200 });
};
