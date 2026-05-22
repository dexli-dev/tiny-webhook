// Shared data contract between server and client. SPEC §10 + §11.
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

/** A webhook inbox. */
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

// ---- API response shapes (SPEC §11) ----

/** POST /api/inboxes */
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

/** GET /api/inboxes/{id} */
export interface GetInboxResponse {
	inbox: Inbox;
	requests: RequestSummary[];
}

/** GET /api/inboxes/{id}/requests/{requestId} — full WebhookRequest. */
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
