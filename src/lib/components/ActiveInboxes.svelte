<script lang="ts">
	// Homepage active-inbox list (cycle-2 bar item 21, cycle-5 items 3–8).
	// One card per non-expired inbox the user created in this browser; opens
	// the dashboard on click. Cycle-5 adds:
	//   - per-card delete control with inline two-step confirm
	//   - tag/url truncation so 26-char tokens never break the layout
	//   - empty state with a CTA when the user holds zero inboxes
	import { removeStoredInbox, type StoredInboxEntry } from '$lib/storage';
	import Countdown from './Countdown.svelte';

	interface Props {
		inboxes: StoredInboxEntry[];
		origin: string;
		/** Called after a local key wipe so the parent re-reads storage and
		    re-renders the list. The server DELETE is fire-and-forget. */
		onDelete?: () => void;
		/** Called from the empty-state CTA — same handler as the hero button. */
		onCreate?: () => void;
		/** Mirrors the homepage's creating flag so the empty-state CTA can
		    show a spinner during the round-trip. */
		creating?: boolean;
	}
	let { inboxes, origin, onDelete, onCreate, creating = false }: Props = $props();

	// Two-step delete confirmation. First click on the X arms the row; second
	// click (within the timeout) actually deletes. Auto-reverts after 3s so
	// the row never stays armed if the user wanders off.
	let confirmingId = $state<string | null>(null);
	let confirmTimer: ReturnType<typeof setTimeout> | undefined;

	function armConfirm(id: string) {
		confirmingId = id;
		clearTimeout(confirmTimer);
		confirmTimer = setTimeout(() => {
			if (confirmingId === id) confirmingId = null;
		}, 3000);
	}

	function performDelete(ib: StoredInboxEntry) {
		clearTimeout(confirmTimer);
		confirmingId = null;
		// Local key wipe FIRST — the UI's hard guarantee. Server cleanup is
		// best-effort and never blocks this code path.
		removeStoredInbox(ib.id);
		onDelete?.();
		// Fire-and-forget DELETE. We pass the Bearer because the route checks
		// it; we ignore the response (204 vs 404 vs network failure all look
		// identical from here on out).
		fetch(`/api/inboxes/${ib.id}`, {
			method: 'DELETE',
			headers: { Authorization: `Bearer ${ib.key}` }
		}).catch(() => {
			/* opaque on purpose — the local key is already gone */
		});
	}

	function onDeleteClick(e: MouseEvent, ib: StoredInboxEntry) {
		// The button is a sibling of the <a> card (not nested) but the click
		// can still bubble up to the surrounding <li>; preventDefault here
		// stops accidental navigation to the inbox while the user is in the
		// middle of a delete gesture.
		e.preventDefault();
		e.stopPropagation();
		if (confirmingId === ib.id) {
			performDelete(ib);
		} else {
			armConfirm(ib.id);
		}
	}
</script>

{#if inboxes.length === 0}
	<section class="wrap empty">
		<div class="empty-card">
			<span class="empty-text">
				<span class="empty-dot" aria-hidden="true">·</span>
				Your active inboxes will appear here.
			</span>
			{#if onCreate}
				<button class="empty-cta" onclick={onCreate} disabled={creating} type="button">
					{#if creating}
						<span class="spinner" aria-hidden="true"></span> Creating…
					{:else}
						Create your first inbox
						<svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true">
							<path
								d="M5 12h14M13 6l6 6-6 6"
								fill="none"
								stroke="currentColor"
								stroke-width="2"
								stroke-linecap="round"
								stroke-linejoin="round"
							/>
						</svg>
					{/if}
				</button>
			{/if}
		</div>
	</section>
{:else}
	<section class="wrap active">
		<header class="ahead">
			<h2>Your inboxes</h2>
			<span class="hint">Active in this browser · {inboxes.length}</span>
		</header>
		<ul class="grid">
			{#each inboxes as ib (ib.id)}
				<!-- Cycle-4a: prefer the server-canonical URL captured at create
				     time so PUBLIC_BASE_URL overrides flow through to the card.
				     Older records (created pre-v4a) may lack it; fall back to
				     origin derivation. -->
				{@const url = ib.webhookUrl ?? `${origin}/in/${ib.publicToken}`}
				{@const isConfirming = confirmingId === ib.id}
				<li class="cell">
					<a class="card" href="/inbox/{ib.id}">
						<div class="cardhead">
							<!-- Tag pill truncates from the trailing edge; title
							     attribute carries the full token for hover-reveal,
							     and the parent <a>'s href stays untouched. -->
							<span class="tag" title={`/${ib.publicToken}`}>/{ib.publicToken}</span>
							<Countdown expiresAt={ib.expiresAt} />
						</div>
						<!-- URL line uses a trailing mask-image fade so a 26-char
						     token doesn't bulldoze the card width. The displayed
						     string is the full URL — fade is presentational only;
						     copy / link targets see the original. -->
						<code class="url" title={url}>{url}</code>
						<span class="open">
							Open dashboard
							<svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true">
								<path
									d="M5 12h14M13 6l6 6-6 6"
									fill="none"
									stroke="currentColor"
									stroke-width="2"
									stroke-linecap="round"
									stroke-linejoin="round"
								/>
							</svg>
						</span>
					</a>
					<button
						class="delete"
						class:confirming={isConfirming}
						onclick={(e) => onDeleteClick(e, ib)}
						title={isConfirming ? 'Click again to confirm' : 'Delete inbox'}
						aria-label={isConfirming ? 'Confirm delete inbox' : 'Delete inbox'}
						type="button"
					>
						{#if isConfirming}
							<svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true">
								<path
									d="M5 13l4 4L19 7"
									fill="none"
									stroke="currentColor"
									stroke-width="2.2"
									stroke-linecap="round"
									stroke-linejoin="round"
								/>
							</svg>
							<span class="delete-label">Confirm</span>
						{:else}
							<svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true">
								<path
									d="M6 6l12 12M6 18L18 6"
									fill="none"
									stroke="currentColor"
									stroke-width="2"
									stroke-linecap="round"
								/>
							</svg>
						{/if}
					</button>
				</li>
			{/each}
		</ul>
	</section>
{/if}

<style>
	.active {
		padding-top: 10px;
		padding-bottom: 6px;
	}
	.ahead {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		margin-bottom: 14px;
	}
	.ahead h2 {
		font-size: 16px;
		font-family: var(--display);
		font-weight: 700;
	}
	.hint {
		font-size: 11.5px;
		color: var(--text-faint);
	}
	.grid {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
		gap: 12px;
	}
	.cell {
		position: relative;
	}
	.card {
		display: flex;
		flex-direction: column;
		gap: 10px;
		padding: 14px 14px 12px;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		color: var(--text);
		text-decoration: none;
		transition: border-color 0.15s, background 0.15s, transform 0.05s;
	}
	.card:hover {
		border-color: var(--accent-dim);
		background: var(--surface-2);
		text-decoration: none;
	}
	.card:active {
		transform: translateY(1px);
	}
	.cardhead {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
		/* Reserve corner space for the absolute-positioned delete control so
		   the tag pill never collides with it. */
		padding-right: 28px;
	}
	.tag {
		font-family: var(--mono);
		font-size: 12px;
		font-weight: 600;
		color: var(--accent);
		background: var(--accent-glow);
		border-radius: 4px;
		padding: 2px 7px;
		/* Cap pill width and truncate from the trailing edge — the discriminating
		   prefix of the token stays visible, the rest goes to title attr. */
		max-width: 120px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.url {
		font-family: var(--mono);
		font-size: 12px;
		color: var(--text-dim);
		overflow: hidden;
		white-space: nowrap;
		/* Trailing fade-out instead of a sharp clip. The string is laid out
		   in full; the mask only hides the visual edge. */
		mask-image: linear-gradient(to right, #000 calc(100% - 28px), transparent 100%);
		-webkit-mask-image: linear-gradient(to right, #000 calc(100% - 28px), transparent 100%);
	}
	.open {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		margin-top: 2px;
		font-size: 11.5px;
		color: var(--text-faint);
		font-weight: 600;
		letter-spacing: 0.02em;
	}
	.card:hover .open {
		color: var(--accent);
	}

	/* Delete control overlay. Sibling of the <a>, not nested — keeps the HTML
	   valid (no interactive-inside-interactive) and lets the click handler
	   stop propagation cleanly. */
	.delete {
		position: absolute;
		top: 8px;
		right: 8px;
		display: inline-flex;
		align-items: center;
		gap: 5px;
		padding: 5px 6px;
		border: 1px solid transparent;
		background: transparent;
		color: var(--text-faint);
		border-radius: var(--radius-sm);
		font-family: var(--mono);
		font-size: 11px;
		font-weight: 600;
		cursor: pointer;
		opacity: 0;
		transition: opacity 0.15s, background 0.15s, color 0.15s, border-color 0.15s;
	}
	.cell:hover .delete,
	.delete:focus-visible,
	.delete.confirming {
		opacity: 1;
	}
	.delete:hover {
		color: var(--s-4xx);
		background: color-mix(in srgb, var(--s-4xx) 10%, transparent);
		border-color: color-mix(in srgb, var(--s-4xx) 35%, var(--border));
	}
	.delete.confirming {
		color: #0a0b0d;
		background: var(--s-5xx);
		border-color: var(--s-5xx);
		padding-right: 9px;
	}
	.delete.confirming:hover {
		background: color-mix(in srgb, var(--s-5xx) 88%, #fff);
	}
	.delete-label {
		letter-spacing: 0.04em;
	}

	/* Empty state — single intentional card with a CTA. Doesn't mention the
	   3-inbox cap (30-second-rule from cycle 1, still ruling). */
	.empty {
		padding-top: 6px;
		padding-bottom: 6px;
	}
	.empty-card {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 16px;
		padding: 14px 18px;
		background: var(--surface);
		border: 1px dashed var(--border-soft);
		border-radius: var(--radius-sm);
		flex-wrap: wrap;
	}
	.empty-text {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		font-size: 13px;
		color: var(--text-dim);
	}
	.empty-dot {
		color: var(--accent);
		font-weight: 700;
	}
	.empty-cta {
		display: inline-flex;
		align-items: center;
		gap: 7px;
		padding: 7px 12px;
		border: 1px solid var(--border);
		background: var(--surface-2);
		color: var(--text);
		border-radius: var(--radius-sm);
		font-size: 12px;
		font-weight: 600;
		font-family: var(--mono);
		cursor: pointer;
		transition: border-color 0.15s, color 0.15s, background 0.15s;
	}
	.empty-cta:hover {
		border-color: var(--accent-dim);
		color: var(--accent);
		background: var(--surface-3);
	}
	.empty-cta:disabled {
		opacity: 0.7;
		cursor: progress;
	}
	.spinner {
		width: 11px;
		height: 11px;
		border-radius: 50%;
		border: 2px solid rgba(255, 255, 255, 0.18);
		border-top-color: var(--accent);
		animation: spin 0.7s linear infinite;
	}
	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
</style>
