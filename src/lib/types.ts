// Shared data contract between server and client. SPEC §10–§11 + cycle-2 keying.
// These shapes are the API contract — do not change without coordinating
// across backend (producer) and frontend (consumer).

/** A captured HTTP header as a [name, value] pair (order preserved). */
export type HeaderPair = [string, string];

/** A single captured webhook request. */
export interface WebhookRequest {
	id: string;
	inboxId: string;
	/** ISO 8601 UTC timestamp. */
	receivedAt: string;
	method: string;
	/** Path portion hit on the receive endpoint, e.g. "/in/abc123/sub/path". */
	path: string;
	/** Raw query string without leading "?", e.g. "a=1&b=2". May be empty. */
	queryString: string;
	/** Headers in arrival order. */
	headers: HeaderPair[];
	/** Raw request body as text (untrusted; never rendered as HTML). */
	bodyText: string;
	bodySizeBytes: number;
	/** Content-Type header value, or null if absent. */
	contentType: string | null;
	/** Best-effort source IP. */
	sourceIp: string;
	/** User-Agent header value, or null if absent. */
	userAgent: string | null;
	/** HTTP status returned to the caller (200 for MVP). */
	responseStatus: number;
}

/**
 * Public inbox shape returned to clients. The server-side keyHash is intentionally
 * absent here — it never leaves the server.
 */
export interface Inbox {
	id: string;
	publicToken: string;
	/** ISO 8601 UTC. */
	createdAt: string;
	/** ISO 8601 UTC — the real expiry the UI must read for its countdown. */
	expiresAt: string;
	requestLimit: number;
	isPrivate: boolean;
}

/**
 * Minimal inbox view returned when a caller does not present a valid key
 * (different browser, cleared localStorage, etc.). Per bar item 20, the URL,
 * expiration, and request count remain visible so the user understands the
 * inbox exists — but no captured content is included.
 */
export interface InboxShell {
	id: string;
	publicToken: string;
	expiresAt: string;
	requestCount: number;
}

// ---- API request/response shapes ----

/**
 * POST /api/inboxes — request body. `key` is a base64url-encoded 256-bit random
 * value generated in-browser at inbox creation (bar items 18-19). The server
 * stores only its SHA-256 hash.
 */
export interface CreateInboxRequest {
	key: string;
}

/** POST /api/inboxes — success response. */
export interface CreateInboxResponse {
	inboxId: string;
	publicToken: string;
	/** Absolute webhook URL the user sends requests to: {origin}/in/{publicToken} */
	webhookUrl: string;
	/** Absolute dashboard URL: {origin}/inbox/{inboxId} */
	dashboardUrl: string;
	expiresAt: string;
}

/** Compact request shape used in inbox list views. */
export interface RequestSummary {
	id: string;
	receivedAt: string;
	method: string;
	path: string;
	responseStatus: number;
	sourceIp: string;
	contentType: string | null;
	bodySizeBytes: number;
}

/**
 * GET /api/inboxes/{id} — discriminated by `locked`.
 *
 * `locked: false` is returned only to a caller who presented the correct
 * Bearer key (Authorization header). `locked: true` is returned for any inbox
 * that exists without a valid key — different browser, cleared storage, etc.
 * Truly nonexistent inbox ids respond 404.
 */
export type GetInboxResponse =
	| { locked: false; inbox: Inbox; requests: RequestSummary[] }
	| { locked: true; shell: InboxShell };

/** GET /api/inboxes/{id}/requests/{requestId} — full WebhookRequest. Bearer-key gated. */
export type GetRequestResponse = WebhookRequest;

/** The receive endpoint response body (SPEC §5.8). */
export interface ReceiveResponse {
	ok: true;
}

/** SSE event payloads on GET /api/inboxes/{id}/events. */
export type InboxEvent =
	| { type: 'request'; request: RequestSummary }
	| { type: 'expired' };

/** Standard error body. */
export interface ApiError {
	error: string;
}
