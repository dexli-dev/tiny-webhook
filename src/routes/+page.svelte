<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { goto } from '$app/navigation';
	import type { CreateInboxRequest, CreateInboxResponse, ApiError } from '$lib/types';
	import {
		generateInboxKey,
		listActiveInboxes,
		saveStoredInbox,
		type StoredInboxEntry
	} from '$lib/storage';
	import CopyButton from '$lib/components/CopyButton.svelte';
	import ActiveInboxes from '$lib/components/ActiveInboxes.svelte';
	import Wordmark from '$lib/components/Wordmark.svelte';

	/** Per-browser cap on concurrent active inboxes (bar item 6). Surfaced only
	    at creation time so a fresh user with 0 inboxes never sees a number. */
	const MAX_ACTIVE = 3;

	let creating = $state(false);
	let errorMsg = $state<string | null>(null);
	let activeInboxes = $state<StoredInboxEntry[]>([]);
	let origin = $state('');
	let pruneTimer: ReturnType<typeof setInterval> | undefined;

	// Marketing example. Static brand URL — does NOT derive from window.location
	// so the demo reads the same on previews, mirrors, and forks as it does in
	// prod. The /in/abc123 token is illustrative; real tokens are 26 chars.
	const sampleCurl = `curl -X POST https://webhook.dexli.dev/in/abc123 \\
  -H 'Content-Type: application/json' \\
  -d '{"event":"checkout.completed","amount":4200}'`;

	function refreshActive() {
		activeInboxes = listActiveInboxes();
	}

	async function createInbox() {
		if (creating) return;
		// Cap check happens HERE, at click time — not by pre-disabling the
		// Create button. The 30-second-product-rule: a first-time visitor with
		// zero inboxes must see no friction or cap-related copy.
		if (activeInboxes.length >= MAX_ACTIVE) {
			errorMsg = `You have ${MAX_ACTIVE} active inboxes. Delete one to create another.`;
			return;
		}
		creating = true;
		errorMsg = null;
		try {
			const key = generateInboxKey();
			const body: CreateInboxRequest = { key };
			const res = await fetch('/api/inboxes', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body)
			});
			if (!res.ok) {
				let detail = `Request failed (${res.status})`;
				try {
					const errBody = (await res.json()) as ApiError;
					if (errBody?.error) detail = errBody.error;
				} catch {
					/* keep default */
				}
				throw new Error(detail);
			}
			const data = (await res.json()) as CreateInboxResponse;
			saveStoredInbox(data.inboxId, {
				key,
				publicToken: data.publicToken,
				webhookUrl: data.webhookUrl,
				expiresAt: data.expiresAt,
				createdAt: new Date().toISOString()
			});
			refreshActive();
			await goto(`/inbox/${data.inboxId}`);
		} catch (e) {
			errorMsg = e instanceof Error ? e.message : 'Could not create an inbox. Try again.';
			creating = false;
		}
	}

	onMount(() => {
		origin = window.location.origin;
		refreshActive();
		// Re-prune every 30s so cards drop when their countdowns hit zero
		// while the user lingers on the homepage.
		pruneTimer = setInterval(refreshActive, 30_000);
	});

	onDestroy(() => clearInterval(pruneTimer));
</script>

<script lang="ts" module>
	const SEO = {
		title: 'webhook.dexli.dev — temporary HTTP inbox for testing webhooks',
		description:
			'Spin up a temporary URL, send HTTP requests, and inspect headers, body, query, and source IP in real time. No signup, 24-hour inboxes.',
		url: 'https://webhook.dexli.dev/',
		ogImage: 'https://webhook.dexli.dev/og-card.png'
	};
	const JSON_LD = {
		'@context': 'https://schema.org',
		'@type': 'WebApplication',
		name: 'webhook.dexli.dev',
		url: SEO.url,
		description:
			'Temporary HTTP inbox for testing webhooks. Captures incoming requests and surfaces headers, body, query parameters, and source IP for inspection.',
		applicationCategory: 'DeveloperApplication',
		operatingSystem: 'Any',
		offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' }
	};
</script>

<svelte:head>
	<title>{SEO.title}</title>
	<meta name="description" content={SEO.description} />

	<!-- Open Graph (X / HN / Discord / Slack unfurling) -->
	<meta property="og:type" content="website" />
	<meta property="og:site_name" content="dexli.dev" />
	<meta property="og:url" content={SEO.url} />
	<meta property="og:title" content={SEO.title} />
	<meta property="og:description" content={SEO.description} />
	<meta property="og:image" content={SEO.ogImage} />
	<meta property="og:image:width" content="1200" />
	<meta property="og:image:height" content="630" />

	<!-- Twitter / X — mirrors OG, summary_large_image card -->
	<meta name="twitter:card" content="summary_large_image" />
	<meta name="twitter:title" content={SEO.title} />
	<meta name="twitter:description" content={SEO.description} />
	<meta name="twitter:image" content={SEO.ogImage} />

	<!-- Schema.org structured data -->
	{@html `<script type="application/ld+json">${JSON.stringify(JSON_LD)}</script>`}
</svelte:head>

<div class="page">
	<header class="topbar wrap">
		<Wordmark />
		<span class="chip">no signup · 24h inboxes</span>
	</header>

	<ActiveInboxes inboxes={activeInboxes} {origin} onDelete={refreshActive} onCreate={createInbox} {creating} />

	<main class="hero wrap">
		<div class="hero-copy">
			<p class="eyebrow reveal" style="--d: 0ms">Webhook inbox for developers</p>
			<h1 class="reveal" style="--d: 60ms">
				Test webhooks<br /><span class="accent">in seconds.</span>
			</h1>
			<p class="sub reveal" style="--d: 140ms">
				Create a temporary endpoint, receive HTTP requests, and inspect payloads instantly —
				headers, query, body, source IP. No server, no tunnel, no deploy.
			</p>

			<div class="cta reveal" style="--d: 220ms">
				<button class="btn btn-primary big" onclick={createInbox} disabled={creating} type="button">
					{#if creating}
						<span class="spinner" aria-hidden="true"></span> Creating…
					{:else}
						Create Inbox
						<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
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
				<span class="cta-note">Free · expires in 24h · live updates</span>
			</div>

			{#if errorMsg}
				<p class="error" role="alert">{errorMsg}</p>
			{/if}

			<ul class="features reveal" style="--d: 300ms">
				<li><span class="tick">▸</span> Real-time delivery over SSE</li>
				<li><span class="tick">▸</span> Pretty JSON + raw body view</li>
				<li><span class="tick">▸</span> One-click curl replay</li>
				<li><span class="tick">▸</span> Locked to your browser — keys never leave the device</li>
			</ul>
		</div>

		<aside class="hero-demo reveal" style="--d: 360ms">
			<div class="terminal">
				<div class="term-bar">
					<span class="d-dot"></span><span class="d-dot"></span><span class="d-dot"></span>
					<span class="term-title">send a test webhook</span>
				</div>
				<pre class="term-body"><span class="prompt">$</span> {sampleCurl}</pre>
				<div class="term-foot">
					<CopyButton text={sampleCurl} label="Copy example" />
				</div>
			</div>

			<div class="privacy">
				<span class="warn-ico" aria-hidden="true">⚠</span>
				<p>
					Do not send passwords, API keys, production secrets, or personal data. Temporary inboxes
					are for testing only.
				</p>
			</div>
		</aside>
	</main>

	<footer class="foot wrap">
		<span>A tiny tool for inspecting HTTP callbacks.</span>
		<span class="family">
			Part of the
			<a href="https://dexli.dev">dexli.dev</a>
			tiny-tools family —
			<a href="https://cron.dexli.dev" rel="external">cron.dexli.dev</a>
			·
			<a href="https://regex.dexli.dev" rel="external">regex.dexli.dev</a>
		</span>
		<span class="dim">2026 · webhook · dexli.dev</span>
	</footer>
</div>

<style>
	.page {
		display: flex;
		flex-direction: column;
		min-height: 100vh;
	}

	.topbar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding-top: 22px;
		padding-bottom: 22px;
	}

	.hero {
		flex: 1;
		display: grid;
		grid-template-columns: 1.05fr 0.95fr;
		gap: 56px;
		align-items: center;
		padding-top: 40px;
		padding-bottom: 64px;
	}
	.hero-copy h1 {
		font-size: clamp(44px, 6.4vw, 82px);
		margin: 16px 0 0;
	}
	.accent {
		color: var(--accent);
		text-shadow: 0 0 38px var(--accent-glow);
	}
	.sub {
		margin: 22px 0 0;
		max-width: 30em;
		color: var(--text-dim);
		font-size: 15px;
		line-height: 1.7;
	}

	.cta {
		display: flex;
		align-items: center;
		gap: 18px;
		margin-top: 34px;
		flex-wrap: wrap;
	}
	.big {
		font-size: 15px;
		padding: 15px 26px;
		border-radius: 8px;
	}
	.cta-note {
		font-size: 12.5px;
		color: var(--text-faint);
	}
	.error {
		margin: 16px 0 0;
		color: var(--s-5xx);
		font-size: 13px;
	}

	.features {
		list-style: none;
		margin: 36px 0 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 9px;
		color: var(--text-dim);
		font-size: 13.5px;
	}
	.features .tick {
		color: var(--accent);
		margin-right: 10px;
	}

	/* Terminal demo card */
	.terminal {
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		overflow: hidden;
		box-shadow: var(--shadow);
	}
	.term-bar {
		display: flex;
		align-items: center;
		gap: 7px;
		padding: 11px 14px;
		background: var(--surface-2);
		border-bottom: 1px solid var(--border);
	}
	.d-dot {
		width: 11px;
		height: 11px;
		border-radius: 50%;
		background: var(--surface-3);
	}
	.term-title {
		margin-left: 10px;
		font-size: 11.5px;
		color: var(--text-faint);
		letter-spacing: 0.04em;
	}
	.term-body {
		margin: 0;
		padding: 18px 16px;
		/* <pre>'s UA stylesheet sets font-family: monospace, which would mask
		   the body's JetBrains Mono declaration via the cascade. Re-declare. */
		font-family: var(--mono);
		font-size: 12.5px;
		line-height: 1.7;
		white-space: pre-wrap;
		word-break: break-word;
		color: var(--text);
	}
	.prompt {
		color: var(--accent);
		margin-right: 8px;
		user-select: none;
	}
	.term-foot {
		display: flex;
		justify-content: flex-end;
		padding: 12px 14px;
		border-top: 1px solid var(--border-soft);
		background: var(--surface-2);
	}

	.privacy {
		display: flex;
		gap: 12px;
		margin-top: 20px;
		padding: 14px 16px;
		border: 1px solid color-mix(in srgb, var(--s-4xx) 30%, var(--border));
		background: color-mix(in srgb, var(--s-4xx) 7%, var(--surface));
		border-radius: var(--radius-sm);
	}
	.privacy p {
		margin: 0;
		font-size: 12.5px;
		line-height: 1.6;
		color: var(--text-dim);
	}
	.warn-ico {
		color: var(--s-4xx);
		font-size: 15px;
		flex: none;
	}

	.foot {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 16px;
		flex-wrap: wrap;
		padding-top: 20px;
		padding-bottom: 28px;
		border-top: 1px solid var(--border-soft);
		font-size: 12px;
		color: var(--text-dim);
	}
	.foot .family {
		color: var(--text-dim);
	}
	.foot .family a {
		color: var(--accent);
	}
	.foot .dim {
		color: var(--text-faint);
	}
	@media (max-width: 640px) {
		.foot {
			flex-direction: column;
			align-items: flex-start;
			gap: 6px;
		}
	}

	.spinner {
		width: 14px;
		height: 14px;
		border-radius: 50%;
		border: 2px solid rgba(10, 11, 13, 0.35);
		border-top-color: #0a0b0d;
		animation: spin 0.7s linear infinite;
	}
	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	.reveal {
		opacity: 0;
		transform: translateY(14px);
		animation: rise 0.6s cubic-bezier(0.22, 1, 0.36, 1) forwards;
		animation-delay: var(--d, 0ms);
	}
	@keyframes rise {
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	@media (max-width: 880px) {
		.hero {
			grid-template-columns: 1fr;
			gap: 36px;
			padding-top: 24px;
		}
	}
</style>
