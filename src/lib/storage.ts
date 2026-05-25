// Browser-side persistence for per-inbox keys (bar items 18-22).
//
// Each inbox the user creates in this browser is recorded under a single
// localStorage object, keyed by inboxId. The `key` field is the base64url
// secret the server only ever sees a SHA-256 of — losing it (clearing
// storage, switching browser) is unrecoverable by design, which is the
// point of the locked-shell flow.

const STORAGE_KEY = 'tinywebhook.inboxes';
const WARN_KEY = 'tinywebhook.warn-shown';

/** Persisted record for one inbox this browser created. */
export interface StoredInbox {
	/** Base64url secret (no padding). Held in plaintext locally; never sent except as Bearer. */
	key: string;
	publicToken: string;
	/**
	 * Server-canonical webhook URL from CreateInboxResponse — uses PUBLIC_BASE_URL
	 * when the operator set one. The UI displays this verbatim instead of
	 * re-deriving from window.location.origin (cycle-4 bar 9). Older records
	 * may not have this field; callers should fall back to origin + publicToken.
	 */
	webhookUrl?: string;
	/** ISO 8601 UTC — used for pruning + countdown. */
	expiresAt: string;
	/** ISO 8601 UTC — used to sort the active-inbox list newest-first. */
	createdAt: string;
}

/** As above but with the inbox id attached, for list rendering. */
export interface StoredInboxEntry extends StoredInbox {
	id: string;
}

type StoredMap = Record<string, StoredInbox>;

function safeWindow(): typeof globalThis | null {
	return typeof window === 'undefined' ? null : (window as unknown as typeof globalThis);
}

function readAll(): StoredMap {
	const w = safeWindow();
	if (!w) return {};
	try {
		const raw = window.localStorage.getItem(STORAGE_KEY);
		if (!raw) return {};
		const parsed = JSON.parse(raw);
		if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
			return parsed as StoredMap;
		}
	} catch {
		/* corrupt entry — fall through to empty */
	}
	return {};
}

function writeAll(map: StoredMap): void {
	const w = safeWindow();
	if (!w) return;
	try {
		window.localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
	} catch {
		/* quota / privacy mode — silently degrade */
	}
}

/** Look up the secret + metadata for one inbox in this browser, if present. */
export function getStoredInbox(inboxId: string): StoredInbox | null {
	const all = readAll();
	const entry = all[inboxId];
	return entry ?? null;
}

/** Record a freshly created inbox in this browser. Overwrites any prior entry. */
export function saveStoredInbox(inboxId: string, record: StoredInbox): void {
	const all = readAll();
	all[inboxId] = record;
	writeAll(all);
}

/** Drop one inbox from storage (e.g. after the user confirms it's expired). */
export function removeStoredInbox(inboxId: string): void {
	const all = readAll();
	if (inboxId in all) {
		delete all[inboxId];
		writeAll(all);
	}
}

/**
 * Return all locally stored inboxes whose expiresAt is still in the future,
 * sorted newest-first. Side effect: prunes expired entries from storage so
 * the list does not grow forever.
 */
export function listActiveInboxes(now: number = Date.now()): StoredInboxEntry[] {
	const all = readAll();
	let mutated = false;
	const active: StoredInboxEntry[] = [];
	for (const [id, rec] of Object.entries(all)) {
		const expires = new Date(rec.expiresAt).getTime();
		if (!Number.isFinite(expires) || expires <= now) {
			delete all[id];
			mutated = true;
			continue;
		}
		active.push({ id, ...rec });
	}
	if (mutated) writeAll(all);
	active.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
	return active;
}

/** True once the per-browser first-creation warning has been dismissed. */
export function hasSeenFirstWarning(): boolean {
	const w = safeWindow();
	if (!w) return true;
	try {
		return window.localStorage.getItem(WARN_KEY) === '1';
	} catch {
		return true;
	}
}

export function markFirstWarningSeen(): void {
	const w = safeWindow();
	if (!w) return;
	try {
		window.localStorage.setItem(WARN_KEY, '1');
	} catch {
		/* ignore */
	}
}

/**
 * Generate a fresh 256-bit per-inbox secret, base64url-encoded without padding.
 * Output length is 43 chars (32 bytes → 43 base64 chars). Server stores only
 * its SHA-256 hash; the raw value lives only in this browser's localStorage.
 */
export function generateInboxKey(): string {
	const w = safeWindow();
	if (!w || !window.crypto || !window.crypto.getRandomValues) {
		throw new Error('Secure random not available in this environment.');
	}
	const bytes = new Uint8Array(32);
	window.crypto.getRandomValues(bytes);
	let binary = '';
	for (const b of bytes) binary += String.fromCharCode(b);
	// btoa → base64 → translate to base64url and strip padding.
	return window
		.btoa(binary)
		.replace(/\+/g, '-')
		.replace(/\//g, '_')
		.replace(/=+$/, '');
}
