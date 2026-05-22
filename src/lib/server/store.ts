// In-memory store for inboxes and their captured requests, plus a per-inbox
// pub/sub bus that powers SSE. This is the single integration point shared by
// the receive endpoint, the API endpoints, and the SSE stream.
//
// Storage is intentionally in-memory: inboxes are ephemeral (24h) and a process
// restart wipes everything (acceptable for the MVP — swap in Postgres later).
//
// The store is pinned to globalThis so SvelteKit dev HMR does not reset state
// mid-session.

import { CONFIG } from '$lib/config';
import type {
	HeaderPair,
	Inbox,
	InboxEvent,
	RequestSummary,
	WebhookRequest
} from '$lib/types';

type Listener = (event: InboxEvent) => void;

interface InboxRecord {
	inbox: Inbox;
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
	sweepTimer: ReturnType<typeof setInterval> | null;
}

const GLOBAL_KEY = Symbol.for('tinywebhook.store');

function freshState(): StoreState {
	return {
		inboxes: new Map(),
		tokens: new Map(),
		ipCreations: new Map(),
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
	while (state.tokens.has(token)) token = randomToken(CONFIG.TOKEN_LENGTH);
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

// ---- inbox operations ----

export function createInbox(): Inbox {
	const now = Date.now();
	const inbox: Inbox = {
		id: uniqueToken(),
		publicToken: uniqueToken(),
		createdAt: new Date(now).toISOString(),
		expiresAt: new Date(now + CONFIG.INBOX_TTL_MS).toISOString(),
		requestLimit: CONFIG.MAX_REQUESTS_PER_INBOX,
		isPrivate: false
	};
	state.inboxes.set(inbox.id, { inbox, requests: [], listeners: new Set() });
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

export function getInboxByToken(token: string): Inbox | undefined {
	const id = state.tokens.get(token);
	return id ? getInbox(id) : undefined;
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

// ---- pub/sub for SSE ----

/** Subscribe to events for an inbox. Returns an unsubscribe function. */
export function subscribe(id: string, listener: Listener): () => void {
	const rec = state.inboxes.get(id);
	if (!rec) return () => {};
	rec.listeners.add(listener);
	return () => rec.listeners.delete(listener);
}

function emit(rec: InboxRecord, event: InboxEvent): void {
	for (const l of rec.listeners) {
		try {
			l(event);
		} catch {
			// a broken listener must not break delivery to the rest
		}
	}
}

// ---- removal / expiry sweep ----

function removeInbox(id: string): void {
	const rec = state.inboxes.get(id);
	if (!rec) return;
	emit(rec, { type: 'expired' });
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
	// don't keep the process alive purely for the sweep
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
}
