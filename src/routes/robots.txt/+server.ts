// robots.txt for webhook.dexli.dev. Permissive (crawlers welcome on the
// homepage and any public surface); points crawlers at the sitemap.
//
// Operator-canonical origin via PUBLIC_BASE_URL with request-origin fallback.

import { CONFIG } from '$lib/config';

export const prerender = false;

export function GET({ url }: { url: URL }): Response {
	const origin = CONFIG.PUBLIC_BASE_URL || url.origin;
	const body = `User-agent: *
Allow: /

Sitemap: ${origin}/sitemap.xml
`;
	return new Response(body, {
		headers: {
			'content-type': 'text/plain; charset=utf-8',
			'cache-control': 'public, max-age=3600'
		}
	});
}
