// Global server hook — adds the non-CSP hardening headers required by bar
// item 11 to every response (CSP itself is emitted by SvelteKit per
// svelte.config.js kit.csp configuration). Also forces Cache-Control: no-store
// uniformly so attacker-controlled captured content cannot be cached by any
// downstream party (shared cache, browser back-forward cache, etc.).
//
// Static asset URLs go through this hook too. The (tiny) perf cost of
// no-store on /_app/immutable/* is acceptable for this product; the safety
// guarantee that NO captured content can leak via cache is worth more than the
// optimisation.

import type { Handle } from '@sveltejs/kit';

export const handle: Handle = async ({ event, resolve }) => {
	const response = await resolve(event);

	const path = event.url.pathname;
	const headers = response.headers;

	// Always-on hardening.
	if (!headers.has('X-Content-Type-Options')) {
		headers.set('X-Content-Type-Options', 'nosniff');
	}
	if (!headers.has('Referrer-Policy')) {
		headers.set('Referrer-Policy', 'no-referrer');
	}
	if (!headers.has('X-Frame-Options')) {
		headers.set('X-Frame-Options', 'DENY');
	}

	// Uniform no-store on UI + content. The /in/* receive endpoint is a
	// non-cacheable POST/etc. surface and SSE keeps its own no-cache, so this
	// is effectively about /, /inbox/*, /api/*, and static assets.
	if (!headers.has('Cache-Control') || path.startsWith('/inbox') || path.startsWith('/api')) {
		headers.set('Cache-Control', 'no-store');
	}

	return response;
};
