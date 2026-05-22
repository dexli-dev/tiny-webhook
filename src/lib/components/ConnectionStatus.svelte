<script lang="ts">
	// Realtime SSE connection indicator.
	export type ConnState = 'connecting' | 'connected' | 'reconnecting' | 'closed';

	interface Props {
		state: ConnState;
	}
	let { state }: Props = $props();

	let labels: Record<ConnState, string> = {
		connecting: 'Connecting',
		connected: 'Live',
		reconnecting: 'Reconnecting',
		closed: 'Offline'
	};
</script>

<span class="conn {state}" title="Realtime: {labels[state]}">
	<span class="dot"></span>
	<span class="label">{labels[state]}</span>
</span>

<style>
	.conn {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		font-size: 12px;
		font-weight: 600;
		padding: 5px 11px;
		border-radius: 999px;
		border: 1px solid var(--border);
		background: var(--surface);
		color: var(--text-dim);
	}
	.dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: var(--text-faint);
	}
	.connected {
		color: var(--accent);
		border-color: var(--accent-dim);
	}
	.connected .dot {
		background: var(--accent);
		box-shadow: 0 0 0 0 var(--accent-glow);
		animation: pulse 1.8s ease-out infinite;
	}
	.connecting .dot,
	.reconnecting .dot {
		background: var(--s-4xx);
		animation: blink 1s steps(2, start) infinite;
	}
	.connecting,
	.reconnecting {
		color: var(--s-4xx);
	}
	.closed {
		color: var(--s-5xx);
	}
	.closed .dot {
		background: var(--s-5xx);
	}

	@keyframes pulse {
		0% {
			box-shadow: 0 0 0 0 var(--accent-glow);
		}
		70% {
			box-shadow: 0 0 0 7px transparent;
		}
		100% {
			box-shadow: 0 0 0 0 transparent;
		}
	}
	@keyframes blink {
		50% {
			opacity: 0.35;
		}
	}
</style>
