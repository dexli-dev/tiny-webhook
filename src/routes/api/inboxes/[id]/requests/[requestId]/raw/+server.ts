// GET /api/inboxes/[id]/requests/[requestId]/raw  (cycle-2, bar item 13)
//
// Bearer-key gated raw-body download. The response body is the captured
// `bodyText` exactly as stored — never the attacker-controlled Content-Type
// that came in. We force text/plain;charset=utf-8 and Content-Disposition
// attachment so a browser never interprets the bytes as HTML / script / etc.
//
// Auth failures and missing-inbox / missing-request cases all respond 404 with
// the same generic plain-text body "Not found.", indistinguishable to a
// caller without the key.

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

export const GET: RequestHandler = (event) => {
	const id = event.params.id!;
	const requestId = event.params.requestId!;

	// Auth is checked first. Order is irrelevant to correctness here because
	// both isAuthorized and getRequest fail closed for nonexistent ids; the
	// uniform 404 body keeps the two indistinguishable.
	if (!isAuthorized(id, event.request)) return NOT_FOUND.clone();

	const r = getRequest(id, requestId);
	if (!r) return NOT_FOUND.clone();

	return new Response(r.bodyText, {
		status: 200,
		headers: {
			'Content-Type': 'text/plain;charset=utf-8',
			'X-Content-Type-Options': 'nosniff',
			'Content-Disposition': `attachment; filename="body-${safeFilename(requestId)}.txt"`,
			'Cache-Control': 'no-store'
		}
	});
};
