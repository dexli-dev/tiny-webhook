// Bearer-key authorization for the per-inbox content endpoints (cycle-2,
// bar items 18-19). Keys are 256-bit random secrets generated in-browser
// at inbox creation; the server stores only their SHA-256 hash. Every
// content read (GET inbox, GET request detail, GET raw body, SSE) presents
// `Authorization: Bearer <key>`; verifyKey() compares in constant time.

import { verifyKey } from '$lib/server/store';

/** Extract the raw bearer token from an Authorization header, or null. */
export function extractBearer(request: Request): string | null {
	const header = request.headers.get('authorization');
	if (!header) return null;
	// Tolerate any whitespace and case in the scheme; the bearer value is
	// whatever follows the first run of whitespace.
	const match = /^bearer\s+(\S+)\s*$/i.exec(header);
	return match ? match[1] : null;
}

/**
 * Returns true if the request carries a Bearer key that matches the inbox.
 * Handles missing/malformed/expired/nonexistent uniformly — never throws.
 */
export function isAuthorized(inboxId: string, request: Request): boolean {
	const key = extractBearer(request);
	return verifyKey(inboxId, key);
}
