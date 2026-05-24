<script lang="ts">
	// Locked-inbox view per bar item 20. Rendered when GET /api/inboxes/{id}
	// returns { locked: true, shell } — the caller (different browser / cleared
	// storage) can see the URL, expiry, and request count, but no content.
	// Crucially, the webhook URL is read-only — we do NOT encourage them to
	// send live traffic somewhere they can't see it.
	import type { InboxShell } from '$lib/types';
	import Countdown from './Countdown.svelte';

	interface Props {
		shell: InboxShell;
		origin: string;
	}
	let { shell, origin }: Props = $props();

	let webhookUrl = $derived(`${origin}/in/${shell.publicToken}`);
	let countLabel = $derived(
		`${shell.requestCount} ${shell.requestCount === 1 ? 'request' : 'requests'} received`
	);
</script>

<section class="wrap locked">
	<div class="card">
		<div class="badge" aria-hidden="true">
			<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
				<rect x="5" y="11" width="14" height="9" rx="2" fill="none" stroke="currentColor" stroke-width="1.8" />
				<path
					d="M8 11V8a4 4 0 0 1 8 0v3"
					fill="none"
					stroke="currentColor"
					stroke-width="1.8"
					stroke-linecap="round"
				/>
			</svg>
			<span>Locked</span>
		</div>

		<h2>This inbox is locked to the browser that created it.</h2>
		<p class="lede">
			It exists and is still accepting requests. Past content can't be opened from this browser —
			only the browser that created it holds the key, and the key never leaves that browser.
		</p>

		<dl class="kv">
			<dt>Webhook URL</dt>
			<dd><code class="url" title={webhookUrl}>{webhookUrl}</code></dd>
			<dt>Expires</dt>
			<dd><Countdown expiresAt={shell.expiresAt} /></dd>
			<dt>Activity</dt>
			<dd>{countLabel}</dd>
		</dl>

		<div class="actions">
			<a class="btn btn-primary" href="/">Create your own inbox</a>
		</div>
	</div>
</section>

<style>
	.locked {
		flex: 1;
		display: grid;
		place-items: center;
		padding: 56px 24px;
	}
	.card {
		width: 100%;
		max-width: 560px;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		padding: 28px 28px 24px;
		box-shadow: var(--shadow);
	}
	.badge {
		display: inline-flex;
		align-items: center;
		gap: 7px;
		padding: 4px 10px;
		border-radius: 999px;
		font-size: 11px;
		font-weight: 700;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		border: 1px solid color-mix(in srgb, var(--s-4xx) 40%, var(--border));
		color: var(--s-4xx);
		background: color-mix(in srgb, var(--s-4xx) 8%, transparent);
	}
	h2 {
		font-size: 22px;
		margin: 14px 0 0;
	}
	.lede {
		margin: 12px 0 22px;
		color: var(--text-dim);
		font-size: 13.5px;
		line-height: 1.65;
	}
	.kv {
		display: grid;
		grid-template-columns: 110px 1fr;
		gap: 10px 16px;
		margin: 0 0 22px;
		padding: 14px 16px;
		background: var(--surface-2);
		border: 1px solid var(--border-soft);
		border-radius: var(--radius-sm);
	}
	.kv dt {
		font-size: 11px;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: var(--text-faint);
		padding-top: 2px;
	}
	.kv dd {
		margin: 0;
		color: var(--text);
		min-width: 0;
		word-break: break-all;
	}
	.url {
		font-family: var(--mono);
		font-size: 13px;
		color: var(--accent);
		/* read-only on purpose — no copy button per the threat model. */
		user-select: text;
	}
	.actions {
		display: flex;
		justify-content: flex-end;
	}
</style>
