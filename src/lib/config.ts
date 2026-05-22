// Central configuration / limits. Shared by server and (where useful) client.
// Values chosen per SPEC §13 "Recommended MVP limits".

export const CONFIG = {
	/** Max accepted request body size, in bytes (256 KB). Larger bodies are rejected/truncated. */
	MAX_BODY_BYTES: 256 * 1024,
	/** Max number of stored requests per inbox. Oldest are evicted past this. */
	MAX_REQUESTS_PER_INBOX: 50,
	/** Inbox lifetime in milliseconds (24 hours). */
	INBOX_TTL_MS: 24 * 60 * 60 * 1000,
	/** Max inbox creations allowed per source IP per hour. */
	MAX_INBOXES_PER_IP_PER_HOUR: 20,
	/** How often the background sweep removes expired inboxes (5 min). */
	SWEEP_INTERVAL_MS: 5 * 60 * 1000,
	/** Length of the generated public token. */
	TOKEN_LENGTH: 10,
	/** HTTP methods accepted by the receive endpoint. */
	ACCEPTED_METHODS: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'] as const
} as const;
