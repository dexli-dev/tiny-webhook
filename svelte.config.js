import adapter from '@sveltejs/adapter-node';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: vitePreprocess(),
	kit: {
		adapter: adapter(),
		// This product exists to receive arbitrary cross-origin HTTP requests
		// (webhooks from external services, form posts, text/plain, etc.). It
		// has no auth/cookies/sessions, so SvelteKit's origin-based CSRF check
		// is both meaningless here and actively breaks the receive endpoint.
		// All state-changing UI surfaces are key-authenticated separately.
		csrf: { checkOrigin: false },
		// Strict CSP — bar item 11. SvelteKit's `mode: 'auto'` emits hashes
		// for the inline <script> blocks SvelteKit injects for hydration, so
		// `script-src 'self'` is sufficient (no 'unsafe-inline' for scripts).
		// Inline style attributes used by Svelte components require
		// 'unsafe-inline' for style only — non-exploitable when all rendered
		// captured content is text-escaped.
		csp: {
			mode: 'auto',
			directives: {
				'default-src': ['self'],
				'script-src': ['self'],
				'style-src': ['self', 'unsafe-inline'],
				'img-src': ['self', 'data:'],
				'font-src': ['self', 'data:'],
				'connect-src': ['self'],
				'object-src': ['none'],
				'frame-ancestors': ['none'],
				'base-uri': ['none'],
				'form-action': ['self']
			}
		}
	}
};

export default config;
