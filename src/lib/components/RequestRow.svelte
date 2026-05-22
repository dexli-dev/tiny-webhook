<script lang="ts">
	import type { RequestSummary } from '$lib/types';
	import { clockTime, relativeTime, formatBytes } from '$lib/utils';
	import MethodBadge from './MethodBadge.svelte';
	import StatusBadge from './StatusBadge.svelte';

	interface Props {
		request: RequestSummary;
		selected?: boolean;
		isNew?: boolean;
		now: number;
		onselect: (id: string) => void;
	}
	let { request, selected = false, isNew = false, now, onselect }: Props = $props();
</script>

<button
	class="row"
	class:selected
	class:fresh={isNew}
	onclick={() => onselect(request.id)}
	type="button"
	aria-pressed={selected}
>
	<MethodBadge method={request.method} />
	<span class="path" title={request.path}>{request.path}</span>
	<StatusBadge status={request.responseStatus} />
	<span class="meta ip" title="Source IP">{request.sourceIp}</span>
	<span class="meta ct" title="Content-Type">{request.contentType ?? '—'}</span>
	<span class="meta size" title="Body size">{formatBytes(request.bodySizeBytes)}</span>
	<span class="meta time" title={request.receivedAt}>
		<span class="clock">{clockTime(request.receivedAt)}</span>
		<span class="ago">{relativeTime(request.receivedAt, now)}</span>
	</span>
</button>

<style>
	.row {
		display: grid;
		grid-template-columns: 68px minmax(0, 1fr) 64px 120px 150px 64px 132px;
		align-items: center;
		gap: 14px;
		width: 100%;
		text-align: left;
		background: transparent;
		border: none;
		border-bottom: 1px solid var(--border-soft);
		padding: 11px 18px;
		color: var(--text);
		font-family: var(--mono);
		transition: background 0.12s;
	}
	.row:hover {
		background: var(--surface-2);
	}
	.row.selected {
		background: var(--surface-3);
		box-shadow: inset 3px 0 0 var(--accent);
	}
	.path {
		font-size: 13px;
		font-weight: 500;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.meta {
		font-size: 12px;
		color: var(--text-dim);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.size,
	.ip {
		font-variant-numeric: tabular-nums;
	}
	.time {
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		line-height: 1.3;
	}
	.clock {
		color: var(--text);
		font-variant-numeric: tabular-nums;
	}
	.ago {
		font-size: 10.5px;
		color: var(--text-faint);
	}

	/* Highlight a freshly arrived row. */
	.fresh {
		animation: flash 1.6s ease-out;
	}
	@keyframes flash {
		0% {
			background: var(--accent-glow);
		}
		100% {
			background: transparent;
		}
	}

	@media (max-width: 820px) {
		.row {
			grid-template-columns: 60px minmax(0, 1fr) 56px auto;
		}
		.ip,
		.ct,
		.size {
			display: none;
		}
	}
</style>
