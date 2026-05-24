// Central configuration / limits. Shared by server and (where useful) client.
// Values chosen per SPEC §13 and cycle-2 bar items 11/12/14/15.

export const CONFIG = {
	/** Max accepted request body size, in bytes (256 KB). Larger bodies are rejected with 413. */
	MAX_BODY_BYTES: 256 * 1024,
	/** Max number of stored requests per inbox. Oldest are evicted past this. */
	MAX_REQUESTS_PER_INBOX: 50,
	/** Inbox lifetime in milliseconds (24 hours). */
	INBOX_TTL_MS: 24 * 60 * 60 * 1000,
	/** Max inbox creations allowed per source IP per hour. */
	MAX_INBOXES_PER_IP_PER_HOUR: 20,
	/** How often the background sweep removes expired inboxes (5 min). */
	SWEEP_INTERVAL_MS: 5 * 60 * 1000,
	/**
	 * Length of generated public tokens and inbox ids, in characters from a
	 * 36-char alphabet. 26 chars → ~134 bits of entropy, exceeding bar item 14
	 * (≥128 bits) and defeating realistic brute-force enumeration.
	 */
	TOKEN_LENGTH: 26,
	/** Inbox-key length in bytes. 32 = 256 bits, generated browser-side. */
	KEY_BYTES: 32,
	/** Max concurrent SSE streams per inbox (bar item 15 — flooding cap). */
	SSE_MAX_PER_INBOX: 8,
	/** Max concurrent SSE streams globally (bar item 15). */
	SSE_MAX_GLOBAL: 256,
	/** HTTP methods accepted by the receive endpoint. */
	ACCEPTED_METHODS: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'] as const
} as const;
