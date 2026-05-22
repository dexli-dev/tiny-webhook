import adapter from '@sveltejs/adapter-node';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: vitePreprocess(),
	kit: {
		adapter: adapter(),
		// This product exists to receive arbitrary cross-origin HTTP requests
		// (webhooks from external services, form posts, text/plain, etc.). It has
		// no auth, cookies, or sessions, so SvelteKit's origin-based CSRF check is
		// both meaningless here and actively breaks the core use case (it 403s
		// POST/PUT/PATCH/DELETE with form/text-plain bodies from foreign origins).
		csrf: { checkOrigin: false }
	}
};

export default config;
