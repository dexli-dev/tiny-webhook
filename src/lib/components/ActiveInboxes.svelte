<script lang="ts">
	// Homepage active-inbox list (bar item 21). One card per non-expired inbox
	// the user has created in this browser; opens the dashboard on click.
	import type { StoredInboxEntry } from '$lib/storage';
	import Countdown from './Countdown.svelte';

	interface Props {
		inboxes: StoredInboxEntry[];
		origin: string;
	}
	let { inboxes, origin }: Props = $props();
</script>

{#if inboxes.length > 0}
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
				<li>
					<a class="card" href="/inbox/{ib.id}">
						<div class="cardhead">
							<span class="tag">/{ib.publicToken}</span>
							<Countdown expiresAt={ib.expiresAt} />
						</div>
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
	}
	.tag {
		font-family: var(--mono);
		font-size: 12px;
		font-weight: 600;
		color: var(--accent);
		background: var(--accent-glow);
		border-radius: 4px;
		padding: 2px 7px;
	}
	.url {
		font-family: var(--mono);
		font-size: 12px;
		color: var(--text-dim);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
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
</style>
