// Fetch-based Server-Sent Events client.
//
// We can't use the platform's EventSource because it does not accept custom
// request headers, and every content endpoint in cycle 2 is Bearer-key gated.
// This is a small, deliberately-narrow implementation of the SSE wire format
// (https://html.spec.whatwg.org/multipage/server-sent-events.html) — enough
// for the inbox stream, no more.
//
// What it intentionally doesn't do:
//   * It does NOT auto-reconnect. The caller decides whether and when to
//     reopen — the server emits a terminal `event: error` on subscriber-cap
//     and we must NOT thunder back at it.
//   * It does NOT honour `id:` / `retry:` fields. The server doesn't use them.

export type SseCloseReason =
	/** Server closed the stream cleanly. */
	| 'eof'
	/** Caller aborted via the returned handle. */
	| 'aborted'
	/** Non-2xx HTTP response. */
	| 'http'
	/** Network error during streaming. */
	| 'network'
	/** Server emitted `event: error` with reason `capped` — subscriber cap reached. */
	| 'capped'
	/** Server emitted `event: error` with some other reason. */
	| 'error';

export interface SseHandlers {
	/** Fired on the first 2xx response, before any frames are parsed. */
	onOpen?: () => void;
	/** Default (unnamed) `data:` frames, parsed as JSON. */
	onMessage?: (data: unknown) => void;
	/** Named `event:` frames. `data` is the parsed JSON payload (or the raw string if non-JSON). */
	onNamedEvent?: (event: string, data: unknown) => void;
	/** Any error that occurred during open or while reading. */
	onError?: (err: unknown) => void;
	/** Always fired exactly once, last. */
	onClose?: (reason: SseCloseReason) => void;
}

export interface SseHandle {
	abort: () => void;
}

interface InternalFrame {
	event: string | null;
	data: string[];
}

function emptyFrame(): InternalFrame {
	return { event: null, data: [] };
}

function tryParseJson(raw: string): unknown {
	try {
		return JSON.parse(raw);
	} catch {
		return raw;
	}
}

/**
 * Open an SSE stream backed by fetch. Returns a handle whose `abort()` ends
 * the stream and fires onClose('aborted'). The promise itself is not exposed
 * because callers always want to react via handlers, not await completion.
 */
export function openSseStream(
	url: string,
	options: {
		headers?: Record<string, string>;
		handlers: SseHandlers;
		signal?: AbortSignal;
	}
): SseHandle {
	const { handlers, headers, signal: externalSignal } = options;
	const controller = new AbortController();

	// Forward an externally-supplied AbortSignal too, so callers can plumb
	// in component-lifecycle aborts.
	if (externalSignal) {
		if (externalSignal.aborted) controller.abort();
		else externalSignal.addEventListener('abort', () => controller.abort(), { once: true });
	}

	let closed = false;
	function close(reason: SseCloseReason): void {
		if (closed) return;
		closed = true;
		try {
			controller.abort();
		} catch {
			/* ignore */
		}
		handlers.onClose?.(reason);
	}

	function dispatch(frame: InternalFrame): void {
		if (frame.data.length === 0) return;
		const dataStr = frame.data.join('\n');
		const named = frame.event && frame.event !== 'message' ? frame.event : null;
		if (named) {
			const parsed = tryParseJson(dataStr);
			handlers.onNamedEvent?.(named, parsed);
			if (named === 'error') {
				const reason =
					parsed && typeof parsed === 'object' && (parsed as { reason?: unknown }).reason === 'capped'
						? 'capped'
						: 'error';
				close(reason);
			}
		} else {
			handlers.onMessage?.(tryParseJson(dataStr));
		}
	}

	(async () => {
		let response: Response;
		try {
			response = await fetch(url, {
				method: 'GET',
				headers: { Accept: 'text/event-stream', ...(headers ?? {}) },
				signal: controller.signal,
				cache: 'no-store',
				credentials: 'same-origin'
			});
		} catch (err) {
			if (controller.signal.aborted) {
				close('aborted');
			} else {
				handlers.onError?.(err);
				close('network');
			}
			return;
		}

		if (!response.ok || !response.body) {
			handlers.onError?.(new Error(`SSE HTTP ${response.status}`));
			close('http');
			return;
		}

		handlers.onOpen?.();

		const reader = response.body.getReader();
		const decoder = new TextDecoder('utf-8');
		let buffer = '';
		let frame = emptyFrame();

		try {
			while (true) {
				const { value, done } = await reader.read();
				if (done) {
					// Flush any trailing frame the server didn't terminate.
					if (buffer.length) {
						processChunk(buffer + '\n\n');
						buffer = '';
					}
					if (!closed) close('eof');
					return;
				}
				buffer += decoder.decode(value, { stream: true });
				let sepIdx;
				while ((sepIdx = buffer.indexOf('\n\n')) !== -1) {
					const chunk = buffer.slice(0, sepIdx);
					buffer = buffer.slice(sepIdx + 2);
					processChunk(chunk);
					if (closed) return;
				}
			}
		} catch (err) {
			if (controller.signal.aborted) {
				close('aborted');
			} else {
				handlers.onError?.(err);
				close('network');
			}
		}

		function processChunk(raw: string): void {
			frame = emptyFrame();
			const lines = raw.split('\n');
			for (const rawLine of lines) {
				const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
				if (line === '') continue;
				if (line.startsWith(':')) continue; // comment / heartbeat
				const colon = line.indexOf(':');
				const field = colon === -1 ? line : line.slice(0, colon);
				let value = colon === -1 ? '' : line.slice(colon + 1);
				if (value.startsWith(' ')) value = value.slice(1);
				if (field === 'data') frame.data.push(value);
				else if (field === 'event') frame.event = value;
				// id/retry intentionally ignored
			}
			dispatch(frame);
		}
	})();

	return {
		abort() {
			if (!closed) close('aborted');
		}
	};
}
