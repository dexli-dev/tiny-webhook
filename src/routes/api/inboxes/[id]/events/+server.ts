// GET /api/inboxes/[id]/events — Server-Sent Events stream of InboxEvents.
//
// Bearer-key gated (cycle-2). The standard EventSource API cannot send an
// Authorization header, so the browser opens this stream via fetch + manual
// SSE framing parser; the server's auth check is the same as every other
// content endpoint.
//
// Per-inbox and global subscriber caps are enforced via the store's
// SubscribeResult — over-cap streams emit a terminal `event: error` and close
// cleanly rather than hanging open.

import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getInbox, subscribe } from '$lib/server/store';
import { isAuthorized } from '$lib/server/auth';
import type { InboxEvent } from '$lib/types';

const HEARTBEAT_MS = 25_000;

export const GET: RequestHandler = (event) => {
	const id = event.params.id!;

	// Existence + auth checked before the stream is constructed. Unauthorized
	// callers see 404 to avoid leaking inbox existence to anyone who guessed
	// the dashboard id.
	if (!getInbox(id) || !isAuthorized(id, event.request)) {
		throw error(404, 'Not found.');
	}

	const encoder = new TextEncoder();

	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			let closed = false;
			let unsubscribe: () => void = () => {};
			let heartbeat: ReturnType<typeof setInterval> | undefined;

			const send = (chunk: string) => {
				if (closed) return;
				try {
					controller.enqueue(encoder.encode(chunk));
				} catch {
					teardown();
				}
			};

			const teardown = () => {
				if (closed) return;
				closed = true;
				unsubscribe();
				if (heartbeat) clearInterval(heartbeat);
				event.request.signal.removeEventListener('abort', teardown);
				try {
					controller.close();
				} catch {
					// already closed
				}
			};

			send(': connected\n\n');

			const sub = subscribe(id, (ev: InboxEvent) => {
				send(`data: ${JSON.stringify(ev)}\n\n`);
				if (ev.type === 'expired') teardown();
			});
			if (!sub.ok) {
				// Typical case: too many concurrent listeners on this inbox or
				// globally. Signal via terminal SSE event (the body status is
				// already 200) and close the stream cleanly.
				send(`event: error\ndata: ${JSON.stringify({ reason: sub.reason })}\n\n`);
				teardown();
				return;
			}
			unsubscribe = sub.unsubscribe;

			heartbeat = setInterval(() => send(': ping\n\n'), HEARTBEAT_MS);
			if (typeof heartbeat === 'object' && 'unref' in heartbeat) {
				(heartbeat as { unref: () => void }).unref();
			}

			event.request.signal.addEventListener('abort', teardown);
		}
	});

	return new Response(stream, {
		headers: {
			'Content-Type': 'text/event-stream',
			'Cache-Control': 'no-cache',
			Connection: 'keep-alive',
			'X-Accel-Buffering': 'no'
		}
	});
};
