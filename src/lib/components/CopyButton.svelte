<script lang="ts">
	// Copy-to-clipboard button with a transient "copied" confirmation.
	interface Props {
		text: string;
		label?: string;
		compact?: boolean;
		title?: string;
	}
	let { text, label = 'Copy', compact = false, title }: Props = $props();

	let copied = $state(false);
	let timer: ReturnType<typeof setTimeout> | undefined;

	async function copy() {
		try {
			await navigator.clipboard.writeText(text);
		} catch {
			// Fallback for non-secure contexts.
			const ta = document.createElement('textarea');
			ta.value = text;
			ta.style.position = 'fixed';
			ta.style.opacity = '0';
			document.body.appendChild(ta);
			ta.select();
			try {
				document.execCommand('copy');
			} catch {
				/* give up silently */
			}
			document.body.removeChild(ta);
		}
		copied = true;
		clearTimeout(timer);
		timer = setTimeout(() => (copied = false), 1400);
	}
</script>

<button
	class="copy"
	class:compact
	class:copied
	onclick={copy}
	title={title ?? label}
	aria-label={label}
	type="button"
>
	{#if copied}
		<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
			<path
				d="M5 13l4 4L19 7"
				fill="none"
				stroke="currentColor"
				stroke-width="2.2"
				stroke-linecap="round"
				stroke-linejoin="round"
			/>
		</svg>
		{#if !compact}<span>Copied</span>{/if}
	{:else}
		<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
			<rect x="9" y="9" width="11" height="11" rx="2" fill="none" stroke="currentColor" stroke-width="1.8" />
			<path
				d="M5 15V5a2 2 0 0 1 2-2h10"
				fill="none"
				stroke="currentColor"
				stroke-width="1.8"
				stroke-linecap="round"
			/>
		</svg>
		{#if !compact}<span>{label}</span>{/if}
	{/if}
</button>

<style>
	.copy {
		display: inline-flex;
		align-items: center;
		gap: 7px;
		border: 1px solid var(--border);
		background: var(--surface-2);
		color: var(--text-dim);
		padding: 7px 12px;
		border-radius: var(--radius-sm);
		font-size: 12px;
		font-weight: 600;
		font-family: var(--mono);
		transition: border-color 0.15s, color 0.15s, background 0.15s;
	}
	.copy:hover {
		border-color: #39414d;
		color: var(--text);
		background: var(--surface-3);
	}
	.copy.compact {
		padding: 6px;
	}
	.copy.copied {
		color: var(--accent);
		border-color: var(--accent-dim);
	}
	svg {
		flex: none;
	}
</style>
