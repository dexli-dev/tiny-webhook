<script lang="ts">
	import { methodVar } from '$lib/utils';

	interface Props {
		method: string;
	}
	let { method }: Props = $props();

	let color = $derived(`var(${methodVar(method)})`);
</script>

<span class="method" style="--c: {color}">{method.toUpperCase()}</span>

<style>
	.method {
		display: inline-block;
		min-width: 58px;
		text-align: center;
		font-size: 11px;
		font-weight: 700;
		letter-spacing: 0.05em;
		padding: 3px 8px;
		border-radius: 5px;
		color: var(--c);
		background: color-mix(in srgb, var(--c) 14%, transparent);
		border: 1px solid color-mix(in srgb, var(--c) 35%, transparent);
	}
</style>
