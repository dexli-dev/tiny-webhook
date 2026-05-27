<script lang="ts">
	import { buildHandoffUrl, type HandoffResult } from '@dexli/family';
	import { looksLikeBinary } from '$lib/utils';

	interface Props {
		body: string;
		contentType: string | null;
	}
	let { body, contentType }: Props = $props();

	type Disposition =
		| { kind: 'hidden' }
		| { kind: 'disabled'; reason: string }
		| { kind: 'ready'; url: string };

	let disposition: Disposition = $derived(decide(body, contentType));

	function decide(b: string, ct: string | null): Disposition {
		if (!b) return { kind: 'hidden' };
		if (looksLikeBinary(ct, b)) {
			return {
				kind: 'disabled',
				reason: 'Body looks binary — regex needs UTF-8 text. Use Copy body instead.'
			};
		}
		const result: HandoffResult = buildHandoffUrl({ to: 'regex', inputs: { text: b } });
		if (result.ok) return { kind: 'ready', url: result.url };
		if (result.kind === 'over-cap') {
			return {
				kind: 'disabled',
				reason: `Body is ${result.length} B — over the ${result.cap} B URL cap. Use Copy body instead.`
			};
		}
		// `unknown-recipient`, `unknown-field`, `non-text-value` are
		// engineer-bug shapes for this call site (slug 'regex' is registered,
		// field 'text' is registered, body is typed string). Surface as
		// disabled with the cycle-2 message so it's debuggable in the wild.
		return { kind: 'disabled', reason: `Handoff unavailable: ${result.kind}` };
	}
</script>

{#if disposition.kind === 'ready'}
	<a
		class="handoff"
		href={disposition.url}
		target="_blank"
		rel="noopener"
		title="Open this body in regex.dexli.dev as test text (new tab)"
	>
		<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
			<path
				d="M14 4h6v6M20 4l-9 9M10 6H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4"
				fill="none"
				stroke="currentColor"
				stroke-width="1.8"
				stroke-linecap="round"
				stroke-linejoin="round"
			/>
		</svg>
		<span>Open in regex</span>
	</a>
{:else if disposition.kind === 'disabled'}
	<button
		class="handoff disabled"
		type="button"
		disabled
		aria-disabled="true"
		title={disposition.reason}
	>
		<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
			<path
				d="M14 4h6v6M20 4l-9 9M10 6H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4"
				fill="none"
				stroke="currentColor"
				stroke-width="1.8"
				stroke-linecap="round"
				stroke-linejoin="round"
			/>
		</svg>
		<span>Open in regex</span>
	</button>
{/if}

<style>
	.handoff {
		display: inline-flex;
		align-items: center;
		gap: 7px;
		min-height: 44px;
		padding: 7px 12px;
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		background: var(--surface-2);
		color: var(--text-dim);
		font-size: 12px;
		font-weight: 600;
		font-family: var(--mono);
		text-decoration: none;
		transition:
			border-color 0.15s,
			color 0.15s,
			background 0.15s;
	}
	.handoff:hover:not(.disabled) {
		border-color: var(--accent-dim);
		color: var(--accent);
		background: var(--surface-3);
	}
	.handoff:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
	}
	.handoff.disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
	svg {
		flex: none;
	}
</style>
