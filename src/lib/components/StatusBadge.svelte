<script lang="ts">
	import { statusVar } from '$lib/utils';

	interface Props {
		status: number;
	}
	let { status }: Props = $props();

	let color = $derived(`var(${statusVar(status)})`);
</script>

<span class="status" style="--c: {color}">
	<span class="dot"></span>{status}
</span>

<style>
	.status {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-size: 12px;
		font-weight: 600;
		color: var(--c);
		font-variant-numeric: tabular-nums;
	}
	.dot {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: var(--c);
		box-shadow: 0 0 8px -1px var(--c);
	}
</style>
