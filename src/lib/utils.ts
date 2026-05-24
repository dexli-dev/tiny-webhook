// Presentation helpers shared across the inbox UI. Pure functions only —
// no rendering of untrusted data here; callers interpolate as text.

import type { HeaderPair, WebhookRequest } from './types';

/** Human-readable byte size, e.g. 0 B, 812 B, 1.4 KB, 3.2 MB. */
export function formatBytes(bytes: number): string {
	if (!Number.isFinite(bytes) || bytes < 0) return '—';
	if (bytes < 1024) return `${bytes} B`;
	const units = ['KB', 'MB', 'GB'];
	let value = bytes / 1024;
	let i = 0;
	while (value >= 1024 && i < units.length - 1) {
		value /= 1024;
		i++;
	}
	return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[i]}`;
}

/** Compact "time ago" string from an ISO timestamp. */
export function relativeTime(iso: string, now: number = Date.now()): string {
	const then = new Date(iso).getTime();
	if (!Number.isFinite(then)) return '';
	const diff = Math.max(0, now - then);
	const s = Math.floor(diff / 1000);
	if (s < 5) return 'just now';
	if (s < 60) return `${s}s ago`;
	const m = Math.floor(s / 60);
	if (m < 60) return `${m}m ago`;
	const h = Math.floor(m / 60);
	if (h < 24) return `${h}h ago`;
	const d = Math.floor(h / 24);
	return `${d}d ago`;
}

/** Absolute local time, e.g. "14:03:22.481". */
export function clockTime(iso: string): string {
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return '';
	const pad = (n: number, w = 2) => String(n).padStart(w, '0');
	return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(
		d.getMilliseconds(),
		3
	)}`;
}

/** Full local date-time for tooltips/detail, e.g. "2026-05-23 14:03:22". */
export function fullTime(iso: string): string {
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return iso;
	const pad = (n: number) => String(n).padStart(2, '0');
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(
		d.getHours()
	)}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** CSS var name for an HTTP method badge. */
export function methodVar(method: string): string {
	const m = method.toUpperCase();
	const known: Record<string, string> = {
		GET: '--m-get',
		POST: '--m-post',
		PUT: '--m-put',
		PATCH: '--m-patch',
		DELETE: '--m-delete',
		OPTIONS: '--m-options',
		HEAD: '--m-head'
	};
	return known[m] ?? '--m-options';
}

/** CSS var name for an HTTP status badge, by status class. */
export function statusVar(status: number): string {
	if (status >= 500) return '--s-5xx';
	if (status >= 400) return '--s-4xx';
	if (status >= 300) return '--s-3xx';
	return '--s-2xx';
}

/** True when content-type or body looks like JSON. */
export function looksLikeJson(contentType: string | null, body: string): boolean {
	if (contentType && /json/i.test(contentType)) return true;
	const t = body.trim();
	if (!t) return false;
	return (t.startsWith('{') && t.endsWith('}')) || (t.startsWith('[') && t.endsWith(']'));
}

/** Pretty-print JSON; returns null if it does not parse. */
export function tryPrettyJson(body: string): string | null {
	try {
		return JSON.stringify(JSON.parse(body), null, 2);
	} catch {
		return null;
	}
}

/** Parse a raw query string ("a=1&b=2") into ordered pairs. */
export function parseQuery(queryString: string): HeaderPair[] {
	if (!queryString) return [];
	const params = new URLSearchParams(queryString);
	return [...params.entries()];
}

/** Wrap a value in single quotes, escaped for POSIX shells. */
function shellQuote(value: string): string {
	return `'${value.replace(/'/g, `'\\''`)}'`;
}

// Headers curl manages itself, plus auth/cookie material the caller may have
// sent. Omitting `authorization` and `cookie` prevents the copy-curl button
// from handing a stranger ready-to-replay credentials lifted from a webhook.
const SKIP_REPLAY_HEADERS = new Set([
	'host',
	'content-length',
	'connection',
	'accept-encoding',
	'authorization',
	'cookie'
]);

/**
 * Build a runnable curl command that replays the request against `origin`.
 * `origin` is the current page origin; req.path already includes /in/{token}.
 */
export function buildCurl(req: WebhookRequest, origin: string): string {
	const qs = req.queryString ? `?${req.queryString}` : '';
	const url = `${origin}${req.path}${qs}`;
	const lines: string[] = [`curl -X ${req.method.toUpperCase()} ${shellQuote(url)}`];

	for (const [name, value] of req.headers) {
		if (SKIP_REPLAY_HEADERS.has(name.toLowerCase())) continue;
		lines.push(`  -H ${shellQuote(`${name}: ${value}`)}`);
	}

	if (req.bodyText) {
		lines.push(`  --data-raw ${shellQuote(req.bodyText)}`);
	}

	return lines.join(' \\\n');
}

/** A short, copyable example curl for a given webhook URL (empty-state / homepage). */
export function exampleCurl(webhookUrl: string): string {
	return `curl -X POST ${webhookUrl} \\
  -H 'Content-Type: application/json' \\
  -d '{"hello":"world"}'`;
}
