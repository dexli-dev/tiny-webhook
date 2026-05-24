<script lang="ts">
	// Dismissible per-browser warning (bar item 22). Shown once on the inbox
	// page on the first successful creation; the flag lives in localStorage so
	// it doesn't reappear after the user closes it.
	import { markFirstWarningSeen } from '$lib/storage';

	interface Props {
		ondismiss?: () => void;
	}
	let { ondismiss }: Props = $props();

	let leaving = $state(false);

	function dismiss() {
		if (leaving) return;
		leaving = true;
		markFirstWarningSeen();
		// Allow the exit transition to play before unmounting.
		setTimeout(() => ondismiss?.(), 180);
	}
</script>

<div class="wrap warn-wrap" class:leaving role="region" aria-label="First-time inbox notice">
	<div class="card">
		<div class="ico" aria-hidden="true">
			<svg viewBox="0 0 24 24" width="18" height="18">
				<path
					d="M12 9v4M12 17h.01M10.3 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.7 3.86a2 2 0 0 0-3.4 0Z"
					fill="none"
					stroke="currentColor"
					stroke-width="1.8"
					stroke-linecap="round"
					stroke-linejoin="round"
				/>
			</svg>
		</div>
		<div class="body">
			<strong>Your inbox is locked to this browser.</strong>
			<span>
				The key never leaves this device. If you clear browser data, switch browsers, or open the
				dashboard URL elsewhere, the past content is unrecoverable from here.
			</span>
		</div>
		<button class="close" onclick={dismiss} type="button" aria-label="Got it">
			Got it
		</button>
	</div>
</div>

<style>
	.warn-wrap {
		padding-top: 12px;
	}
	.card {
		display: flex;
		align-items: flex-start;
		gap: 14px;
		padding: 14px 14px 14px 16px;
		border: 1px solid color-mix(in srgb, var(--s-4xx) 35%, var(--border));
		background: color-mix(in srgb, var(--s-4xx) 8%, var(--surface));
		border-radius: var(--radius-sm);
	}
	.ico {
		color: var(--s-4xx);
		flex: none;
		padding-top: 1px;
	}
	.body {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 4px;
		font-size: 12.5px;
		line-height: 1.55;
		color: var(--text);
	}
	.body strong {
		font-weight: 700;
	}
	.body span {
		color: var(--text-dim);
	}
	.close {
		flex: none;
		border: 1px solid var(--border);
		background: var(--surface-2);
		color: var(--text);
		padding: 7px 14px;
		font-family: var(--mono);
		font-size: 12px;
		font-weight: 600;
		border-radius: var(--radius-sm);
		transition: border-color 0.15s, color 0.15s, background 0.15s;
	}
	.close:hover {
		border-color: var(--accent-dim);
		color: var(--accent);
		background: var(--surface-3);
	}
	.leaving {
		opacity: 0;
		transform: translateY(-4px);
		transition: opacity 0.18s ease, transform 0.18s ease;
	}
</style>
