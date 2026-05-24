// GET /api/inboxes/[id]/requests/[requestId]/raw
//
// Bearer-key gated raw-body download. Three outcomes:
//
//  - Unauth (or wrong key) → 404 with generic plain-text "Not found."
//    (unchanged).
//  - Authed + real-rid    → 200 + the captured bodyText, forced text/plain.
//  - Authed + missing-rid → 200 + empty body (cycle-3a, bar item 14 ext.).
//    Same status / headers / shape as a real-but-empty body, so an authed
//    caller probing random rids on their own inbox cannot enumerate which
//    rids actually exist by shape divergence (200 with bytes vs 404).
//
// Never reflects the captured Content-Type — always text/plain so a browser
// cannot be tricked into interpreting attacker bytes as HTML / script / etc.

import type { RequestHandler } from './$types';
import { getRequest } from '$lib/server/store';
import { isAuthorized } from '$lib/server/auth';

const NOT_FOUND = new Response('Not found.', {
	status: 404,
	headers: {
		'Content-Type': 'text/plain;charset=utf-8',
		'X-Content-Type-Options': 'nosniff',
		'Cache-Control': 'no-store'
	}
});

// Defence in depth: only the store's alphabet should ever produce a request id,
// but the path comes through the URL router, so we strip anything that could
// escape the filename context just in case.
function safeFilename(rid: string): string {
	const cleaned = rid.replace(/[^a-zA-Z0-9_-]/g, '');
	return cleaned.length > 0 ? cleaned : 'request';
}

function rawResponse(bodyText: string, requestId: string): Response {
	return new Response(bodyText, {
		status: 200,
		headers: {
			'Content-Type': 'text/plain;charset=utf-8',
			'X-Content-Type-Options': 'nosniff',
			'Content-Disposition': `attachment; filename="body-${safeFilename(requestId)}.txt"`,
			'Cache-Control': 'no-store'
		}
	});
}

export const GET: RequestHandler = (event) => {
	const id = event.params.id!;
	const requestId = event.params.requestId!;

	if (!isAuthorized(id, event.request)) return NOT_FOUND.clone();

	const r = getRequest(id, requestId);
	// Missing rid (or bogus inbox) under valid auth: empty synthetic body with
	// the same headers as success. Eval checks shape + headers, not bytes.
	return rawResponse(r?.bodyText ?? '', requestId);
};
