// Operator-tunable runtime config. Every value here defaults to a safe
// production setting; each can be overridden by an environment variable read
// once at module load. See .env.example and the README "Configuration"
// section for the full list and prod-target hints.
//
// Misconfiguration is loud, not silent: an unparseable / out-of-bounds env
// value throws at startup so a typo in deploy config fails fast instead of
// quietly running with the wrong limit.
//
// This file is server-only (read via $lib/config from +server.ts handlers and
// $lib/server/* code). No frontend module imports it; process.env access here
// is safe.

export type EnvSource = Record<string, string | undefined>;

const PROCESS_ENV: EnvSource =
	typeof process !== 'undefined' && process.env ? (process.env as EnvSource) : {};

export interface IntBounds {
	min?: number;
	max?: number;
}

/**
 * Parse an integer env var with a default. Throws a descriptive error if the
 * value is set but not a valid integer or falls outside provided bounds.
 *
 * Exported so tests can exercise the parser directly with a controlled env
 * object, rather than mutating process.env at runtime.
 */
export function envInt(
	name: string,
	defaultValue: number,
	bounds: IntBounds = {},
	env: EnvSource = PROCESS_ENV
): number {
	const raw = env[name];
	if (raw === undefined || raw === '') return defaultValue;
	const trimmed = raw.trim();
	if (!/^-?\d+$/.test(trimmed)) {
		throw new Error(`config: env ${name}=${JSON.stringify(raw)} must be an integer`);
	}
	const n = Number(trimmed);
	if (!Number.isFinite(n)) {
		throw new Error(`config: env ${name}=${JSON.stringify(raw)} is not a finite number`);
	}
	if (bounds.min !== undefined && n < bounds.min) {
		throw new Error(`config: env ${name}=${n} is below minimum ${bounds.min}`);
	}
	if (bounds.max !== undefined && n > bounds.max) {
		throw new Error(`config: env ${name}=${n} is above maximum ${bounds.max}`);
	}
	return n;
}

/**
 * Parse a boolean env var. Accepts case-insensitive 'true'/'false'/'1'/'0'.
 * Returns the default when unset or empty. Throws on any other value so
 * misconfiguration is loud at startup.
 *
 * Exported for the same test reasons as envInt — caller passes a controlled
 * env object instead of mutating process.env.
 */
export function envBool(
	name: string,
	defaultValue: boolean,
	env: EnvSource = PROCESS_ENV
): boolean {
	const raw = env[name];
	if (raw === undefined || raw === '') return defaultValue;
	const lower = raw.trim().toLowerCase();
	if (lower === 'true' || lower === '1') return true;
	if (lower === 'false' || lower === '0') return false;
	throw new Error(
		`config: env ${name}=${JSON.stringify(raw)} must be 'true'|'false'|'1'|'0'`
	);
}

/**
 * Parse a URL env var. Returns the canonical origin (scheme + host + port,
 * no trailing slash) or undefined if unset. Throws if set-but-unparseable or
 * if the operator pasted a URL with a path on it (origin-only is what
 * downstream URL concatenation expects).
 */
export function envUrl(name: string, env: EnvSource = PROCESS_ENV): string | undefined {
	const raw = env[name];
	if (raw === undefined || raw === '') return undefined;
	let u: URL;
	try {
		u = new URL(raw);
	} catch {
		throw new Error(`config: env ${name}=${JSON.stringify(raw)} is not a parseable URL`);
	}
	if (u.pathname !== '/' && u.pathname !== '') {
		throw new Error(
			`config: env ${name}=${JSON.stringify(raw)} must be an origin only ` +
				`(no path); got pathname=${JSON.stringify(u.pathname)}`
		);
	}
	return u.origin;
}

const HOUR_MS = 60 * 60 * 1000;

export const CONFIG = Object.freeze({
	/** Max accepted request body size, in bytes. 413 above this. */
	MAX_BODY_BYTES: envInt('MAX_BODY_BYTES', 256 * 1024, { min: 1, max: 16 * 1024 * 1024 }),

	/** Max stored requests per inbox; oldest evicted past this. */
	MAX_REQUESTS_PER_INBOX: envInt('MAX_REQUESTS_PER_INBOX', 50, { min: 1, max: 10_000 }),

	/**
	 * Inbox lifetime in ms. Operator sets INBOX_TTL_HOURS in hours; we convert
	 * internally so downstream code keeps the same ms-shaped value it always had.
	 */
	INBOX_TTL_MS: envInt('INBOX_TTL_HOURS', 24, { min: 1, max: 24 * 365 }) * HOUR_MS,

	/** Max inbox creations per source IP per hour. */
	MAX_INBOXES_PER_IP_PER_HOUR: envInt('MAX_INBOXES_PER_IP_PER_HOUR', 20, {
		min: 1,
		max: 100_000
	}),

	/** Background sweep interval for expired inboxes. Fixed; not operator-tuned. */
	SWEEP_INTERVAL_MS: 5 * 60 * 1000,

	/**
	 * Length of generated public tokens and inbox ids, in characters from a
	 * 36-char alphabet. 26 chars → ~134 bits of entropy. Fixed (changing breaks
	 * shape parity with synthetic shells).
	 */
	TOKEN_LENGTH: 26,

	/** Inbox-key length in bytes (256 bits, generated browser-side). Fixed. */
	KEY_BYTES: 32,

	/** Max concurrent SSE streams per inbox (flooding cap). */
	SSE_MAX_PER_INBOX: envInt('SSE_MAX_PER_INBOX', 8, { min: 1, max: 1024 }),

	/** Max concurrent SSE streams globally (flooding cap). */
	SSE_MAX_GLOBAL: envInt('SSE_MAX_GLOBAL', 256, { min: 1, max: 100_000 }),

	/**
	 * Public origin used server-side when generating webhookUrl / dashboardUrl
	 * in the POST /api/inboxes response. When undefined, the handler derives
	 * the origin from the incoming request (works behind a reverse proxy that
	 * forwards Host correctly). When set, this overrides — operator's word is
	 * final.
	 */
	PUBLIC_BASE_URL: envUrl('PUBLIC_BASE_URL'),

	/** HTTP methods accepted by the receive endpoint. Fixed. */
	ACCEPTED_METHODS: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'] as const,

	/**
	 * When true, IP-trusting routes (POST /api/inboxes, /in/[token] receive)
	 * reject requests that lack a CF-RAY header with 403. This is a SOFT
	 * mitigation for the CF-Connecting-IP trust chain: it raises the bar from
	 * "discover origin IP and spoof CF-Connecting-IP" to "discover origin IP,
	 * spoof CF-Connecting-IP, AND forge a CF-RAY header." A determined attacker
	 * who knows about this guard simply adds the forgery; the structural close
	 * is CF Authenticated Origin Pulls (mTLS at TLS layer), which lives
	 * outside the app and is operator-routed.
	 *
	 * Default false so local dev / Vitest / docker-without-CF all work
	 * unchanged. Production deploy sets true via Dokploy env panel.
	 */
	REQUIRE_CLOUDFLARE_HEADERS: envBool('REQUIRE_CLOUDFLARE_HEADERS', false)
});

// Boot-time observability: WARN when running in production without the
// CF-edge guard enabled. "Forgot to set env in prod" is the most likely
// failure mode for soft mitigations; logging at boot makes it loud at
// deploy time rather than silent until the next audit.
//
// Side-effect at module load is intentional. Read from PROCESS_ENV
// directly (not CONFIG) so this works whatever the prod-indicator shape.
if (PROCESS_ENV.NODE_ENV === 'production' && !CONFIG.REQUIRE_CLOUDFLARE_HEADERS) {
	// eslint-disable-next-line no-console
	console.warn(
		'[tinywebhook] WARN: REQUIRE_CLOUDFLARE_HEADERS is unset/false in a ' +
			'production environment. The CF-edge guard is the soft layer of the ' +
			'CF-Connecting-IP trust chain (vector 5 option 1); without it, an ' +
			'attacker who discovers origin IP can spoof rate-limit attribution. ' +
			'Set REQUIRE_CLOUDFLARE_HEADERS=true and verify via the post-deploy ' +
			'curl probe documented in .env.example.'
	);
}
