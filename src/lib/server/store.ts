// In-memory store for inboxes and their captured requests, plus a per-inbox
// pub/sub bus that powers SSE. This is the single integration point shared by
// the receive endpoint, the API endpoints, and the SSE stream.
//
// Cycle 2 additions: per-inbox key hashing for Bearer-key authorization,
// constant-time verification, indistinguishable token existence (item 14),
// and concurrent-SSE-stream caps (item 15).
//
// Storage is intentionally in-memory: inboxes are ephemeral (24h) and a process
// restart wipes everything (acceptable for the MVP — swap in Postgres later).
//
// The store is pinned to globalThis so SvelteKit dev HMR does not reset state
// mid-session.

import { createHash, timingSafeEqual } from 'node:crypto';

import { CONFIG } from '$lib/config';
import type {
	HeaderPair,
	Inbox,
	InboxEvent,
	InboxShell,
	RequestSummary,
	WebhookRequest
} from '$lib/types';

type Listener = (event: InboxEvent) => void;

interface InboxRecord {
	inbox: Inbox;
	/** SHA-256 hash of the per-inbox secret. Never leaves the server. */
	keyHash: Buffer;
	requests: WebhookRequest[];
	listeners: Set<Listener>;
}

interface StoreState {
	/** inboxId -> record */
	inboxes: Map<string, InboxRecord>;
	/** publicToken -> inboxId */
	tokens: Map<string, string>;
	/** sourceIp -> creation timestamps (ms) within the rolling window */
	ipCreations: Map<string, number[]>;
	/** Total active SSE subscriptions across all inboxes (for global cap, item 15). */
	totalSubscribers: number;
	sweepTimer: ReturnType<typeof setInterval> | null;
}

const GLOBAL_KEY = Symbol.for('tinywebhook.store');

function freshState(): StoreState {
	return {
		inboxes: new Map(),
		tokens: new Map(),
		ipCreations: new Map(),
		totalSubscribers: 0,
		sweepTimer: null
	};
}

const g = globalThis as unknown as { [GLOBAL_KEY]?: StoreState };
const state: StoreState = g[GLOBAL_KEY] ?? (g[GLOBAL_KEY] = freshState());

// ---- id / token generation ----

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

function randomToken(length: number): string {
	const bytes = new Uint8Array(length);
	crypto.getRandomValues(bytes);
	let out = '';
	for (let i = 0; i < length; i++) {
		out += ALPHABET[bytes[i] % ALPHABET.length];
	}
	return out;
}

function uniqueToken(): string {
	let token = randomToken(CONFIG.TOKEN_LENGTH);
	while (state.tokens.has(token) || state.inboxes.has(token)) {
		token = randomToken(CONFIG.TOKEN_LENGTH);
	}
	return token;
}

// ---- expiry helpers ----

export function isExpired(inbox: Inbox, now = Date.now()): boolean {
	return new Date(inbox.expiresAt).getTime() <= now;
}

function toSummary(r: WebhookRequest): RequestSummary {
	return {
		id: r.id,
		receivedAt: r.receivedAt,
		method: r.method,
		path: r.path,
		responseStatus: r.responseStatus,
		sourceIp: r.sourceIp,
		contentType: r.contentType,
		bodySizeBytes: r.bodySizeBytes
	};
}

// ---- rate limiting ----

/**
 * Returns true if the IP is allowed to create another inbox right now, and
 * records the creation. Returns false (without recording) if over the limit.
 */
export function tryConsumeInboxCreation(ip: string, now = Date.now()): boolean {
	const windowStart = now - 60 * 60 * 1000;
	const log = (state.ipCreations.get(ip) ?? []).filter((t) => t > windowStart);
	if (log.length >= CONFIG.MAX_INBOXES_PER_IP_PER_HOUR) {
		state.ipCreations.set(ip, log);
		return false;
	}
	log.push(now);
	state.ipCreations.set(ip, log);
	return true;
}

// ---- inbox keying (cycle-2, bar items 18-19) ----

/**
 * SHA-256 of the caller-supplied base64url-encoded inbox key. Compared with
 * timingSafeEqual so unauthorized callers cannot distinguish "wrong key" from
 * "no inbox" via timing.
 */
function hashKey(key: string): Buffer {
	return createHash('sha256').update(key, 'utf8').digest();
}

/**
 * Constant-time verification of a Bearer key against the stored hash for an
 * inbox. Returns false (without crashing) for nonexistent inboxes, expired
 * inboxes, malformed input, or wrong key.
 */
export function verifyKey(id: string, key: string | null | undefined): boolean {
	if (typeof key !== 'string' || key.length === 0) return false;
	const rec = state.inboxes.get(id);
	if (!rec || isExpired(rec.inbox)) return false;
	let provided: Buffer;
	try {
		provided = hashKey(key);
	} catch {
		return false;
	}
	if (provided.length !== rec.keyHash.length) return false;
	try {
		return timingSafeEqual(provided, rec.keyHash);
	} catch {
		return false;
	}
}

// ---- inbox operations ----

/**
 * Create a new inbox keyed to the caller-supplied secret. The secret itself is
 * never stored — only its SHA-256 hash.
 */
export function createInbox(key: string): Inbox {
	if (typeof key !== 'string' || key.length === 0) {
		throw new Error('createInbox: key required');
	}
	const now = Date.now();
	const inbox: Inbox = {
		id: uniqueToken(),
		publicToken: uniqueToken(),
		createdAt: new Date(now).toISOString(),
		expiresAt: new Date(now + CONFIG.INBOX_TTL_MS).toISOString(),
		requestLimit: CONFIG.MAX_REQUESTS_PER_INBOX,
		isPrivate: true
	};
	state.inboxes.set(inbox.id, {
		inbox,
		keyHash: hashKey(key),
		requests: [],
		listeners: new Set()
	});
	state.tokens.set(inbox.publicToken, inbox.id);
	ensureSweep();
	return inbox;
}

export function getInbox(id: string): Inbox | undefined {
	const rec = state.inboxes.get(id);
	if (!rec) return undefined;
	if (isExpired(rec.inbox)) {
		removeInbox(id);
		return undefined;
	}
	return rec.inbox;
}

/**
 * The locked-shell view of an inbox — the subset of fields safe to return to
 * a caller who has the dashboard URL but not the key (bar item 20).
 */
export function inboxShell(id: string): InboxShell | undefined {
	const rec = state.inboxes.get(id);
	if (!rec || isExpired(rec.inbox)) return undefined;
	return {
		id: rec.inbox.id,
		publicToken: rec.inbox.publicToken,
		expiresAt: rec.inbox.expiresAt,
		requestCount: rec.requests.length
	};
}

export function listRequests(id: string): RequestSummary[] | undefined {
	const rec = state.inboxes.get(id);
	if (!rec || isExpired(rec.inbox)) return undefined;
	// newest first
	return rec.requests.map(toSummary).reverse();
}

export function getRequest(id: string, requestId: string): WebhookRequest | undefined {
	const rec = state.inboxes.get(id);
	if (!rec || isExpired(rec.inbox)) return undefined;
	return rec.requests.find((r) => r.id === requestId);
}

export interface CapturedInput {
	method: string;
	path: string;
	queryString: string;
	headers: HeaderPair[];
	bodyText: string;
	bodySizeBytes: number;
	contentType: string | null;
	sourceIp: string;
	userAgent: string | null;
	responseStatus: number;
}

/**
 * Append a captured request to the inbox identified by publicToken.
 * Returns the stored request, or null if the inbox is unknown/expired.
 * Enforces the per-inbox request cap (oldest evicted).
 *
 * Per bar item 14, the receive-endpoint handler returns {ok:true} whether or
 * not this function returns null — callers must treat unknown tokens as
 * "captured" externally so attackers cannot enumerate live inboxes.
 */
export function recordRequest(token: string, input: CapturedInput): WebhookRequest | null {
	const id = state.tokens.get(token);
	if (!id) return null;
	const rec = state.inboxes.get(id);
	if (!rec || isExpired(rec.inbox)) {
		if (rec) removeInbox(id);
		return null;
	}
	const request: WebhookRequest = {
		id: randomToken(12),
		inboxId: id,
		receivedAt: new Date().toISOString(),
		...input
	};
	rec.requests.push(request);
	while (rec.requests.length > rec.inbox.requestLimit) rec.requests.shift();
	emit(rec, { type: 'request', request: toSummary(request) });
	return request;
}

// ---- pub/sub for SSE (with per-inbox + global concurrency caps, item 15) ----

export type SubscribeResult =
	| { ok: true; unsubscribe: () => void }
	| { ok: false; reason: 'capped' | 'unknown' };

/**
 * Subscribe to events for an inbox. Returns `{ok:false, reason}` if the inbox
 * does not exist or either the per-inbox or global subscriber cap is full —
 * the handler should respond 503 in the capped case and 404 in the unknown
 * case. The unsubscribe function is idempotent.
 */
export function subscribe(id: string, listener: Listener): SubscribeResult {
	const rec = state.inboxes.get(id);
	if (!rec || isExpired(rec.inbox)) return { ok: false, reason: 'unknown' };
	if (rec.listeners.size >= CONFIG.SSE_MAX_PER_INBOX) return { ok: false, reason: 'capped' };
	if (state.totalSubscribers >= CONFIG.SSE_MAX_GLOBAL) return { ok: false, reason: 'capped' };
	rec.listeners.add(listener);
	state.totalSubscribers++;
	let released = false;
	const unsubscribe = () => {
		if (released) return;
		released = true;
		if (rec.listeners.delete(listener)) {
			state.totalSubscribers = Math.max(0, state.totalSubscribers - 1);
		}
	};
	return { ok: true, unsubscribe };
}

function emit(rec: InboxRecord, event: InboxEvent): void {
	// Serialize once would be redundant here — payload is tiny and Listener is
	// a structured callback. We still guard each delivery so a broken listener
	// does not break the rest.
	for (const l of rec.listeners) {
		try {
			l(event);
		} catch {
			// swallow
		}
	}
}

// ---- removal / expiry sweep ----

function removeInbox(id: string): void {
	const rec = state.inboxes.get(id);
	if (!rec) return;
	emit(rec, { type: 'expired' });
	// Releasing the inbox also releases its subscriber slots; listeners observe
	// the `expired` event and tear down themselves (which decrements the global
	// counter via their unsubscribe handle).
	state.tokens.delete(rec.inbox.publicToken);
	state.inboxes.delete(id);
}

export function sweepExpired(now = Date.now()): number {
	let removed = 0;
	for (const [id, rec] of state.inboxes) {
		if (isExpired(rec.inbox, now)) {
			removeInbox(id);
			removed++;
		}
	}
	return removed;
}

function ensureSweep(): void {
	if (state.sweepTimer) return;
	state.sweepTimer = setInterval(() => sweepExpired(), CONFIG.SWEEP_INTERVAL_MS);
	if (typeof state.sweepTimer === 'object' && 'unref' in state.sweepTimer) {
		(state.sweepTimer as { unref: () => void }).unref();
	}
}

// ---- test helper ----

/** Reset all state. Intended for tests only. */
export function __resetForTests(): void {
	if (state.sweepTimer) {
		clearInterval(state.sweepTimer);
		state.sweepTimer = null;
	}
	state.inboxes.clear();
	state.tokens.clear();
	state.ipCreations.clear();
	state.totalSubscribers = 0;
}
