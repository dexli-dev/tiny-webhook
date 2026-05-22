// GET /api/inboxes/[id]/events — Server-Sent Events stream of InboxEvents.
//
// Streams each store event as `data: <json InboxEvent>\n\n`, with a heartbeat
// comment every ~25s to keep proxies from idling the connection. The stream
// closes after an `expired` event and tears down its subscription + heartbeat
// when the client disconnects (stream cancel or request abort).

import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getInbox, subscribe } from '$lib/server/store';
import type { InboxEvent } from '$lib/types';

const HEARTBEAT_MS = 25_000;

export const GET: RequestHandler = (event) => {
	const id = event.params.id!;
	if (!getInbox(id)) {
		throw error(404, 'Inbox not found or expired.');
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
					// Controller already closed (client gone mid-write).
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
					// Already closed.
				}
			};

			// Open the stream immediately so the client's onopen fires promptly.
			send(': connected\n\n');

			unsubscribe = subscribe(id, (ev: InboxEvent) => {
				send(`data: ${JSON.stringify(ev)}\n\n`);
				if (ev.type === 'expired') teardown();
			});

			heartbeat = setInterval(() => send(': ping\n\n'), HEARTBEAT_MS);
			if (typeof heartbeat === 'object' && 'unref' in heartbeat) {
				(heartbeat as { unref: () => void }).unref();
			}

			// Client disconnect (e.g. EventSource.close) aborts the request.
			event.request.signal.addEventListener('abort', teardown);
		}
	});

	return new Response(stream, {
		headers: {
			'Content-Type': 'text/event-stream',
			'Cache-Control': 'no-cache',
			Connection: 'keep-alive'
		}
	});
};
