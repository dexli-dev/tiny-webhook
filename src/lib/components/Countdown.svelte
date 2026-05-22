<script lang="ts">
	// Live countdown to inbox expiry. Reads the real expiresAt; emits onExpire once.
	interface Props {
		expiresAt: string;
		onExpire?: () => void;
	}
	let { expiresAt, onExpire }: Props = $props();

	let now = $state(Date.now());
	let target = $derived(new Date(expiresAt).getTime());
	let remaining = $derived(Math.max(0, target - now));
	let expired = $derived(Number.isFinite(target) && remaining <= 0);
	let firedExpire = false;

	$effect(() => {
		const id = setInterval(() => (now = Date.now()), 1000);
		return () => clearInterval(id);
	});

	$effect(() => {
		if (expired && !firedExpire) {
			firedExpire = true;
			onExpire?.();
		}
	});

	function fmt(ms: number): string {
		const total = Math.floor(ms / 1000);
		const h = Math.floor(total / 3600);
		const m = Math.floor((total % 3600) / 60);
		const s = total % 60;
		const pad = (n: number) => String(n).padStart(2, '0');
		if (h > 0) return `${h}h ${pad(m)}m ${pad(s)}s`;
		return `${pad(m)}m ${pad(s)}s`;
	}

	// Warn (amber) under 1 hour remaining.
	let warning = $derived(!expired && remaining < 60 * 60 * 1000);
</script>

<span class="countdown" class:expired class:warning title="Inbox expires at {expiresAt}">
	<svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true">
		<circle cx="12" cy="13" r="8" fill="none" stroke="currentColor" stroke-width="1.7" />
		<path d="M12 9v4l2.5 2" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" />
		<path d="M9 2h6" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" />
	</svg>
	{#if !Number.isFinite(target)}
		<span>expires soon</span>
	{:else if expired}
		<span>expired</span>
	{:else}
		<span class="value">{fmt(remaining)}</span><span class="suffix">left</span>
	{/if}
</span>

<style>
	.countdown {
		display: inline-flex;
		align-items: center;
		gap: 7px;
		font-size: 12.5px;
		font-weight: 600;
		color: var(--text-dim);
		font-variant-numeric: tabular-nums;
	}
	.value {
		color: var(--text);
	}
	.suffix {
		color: var(--text-faint);
		font-weight: 500;
	}
	.warning {
		color: var(--s-4xx);
	}
	.warning .value {
		color: var(--s-4xx);
	}
	.expired {
		color: var(--s-5xx);
	}
</style>
