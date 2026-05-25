<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { page } from '$app/stores';
	import type {
		GetInboxResponse,
		Inbox,
		InboxShell,
		RequestSummary,
		WebhookRequest,
		InboxEvent
	} from '$lib/types';
	import { canonicalOriginFromWebhookUrl, exampleCurl } from '$lib/utils';
	import { getStoredInbox, hasSeenFirstWarning } from '$lib/storage';
	import { openSseStream, type SseHandle } from '$lib/sse-stream';
	import CopyButton from '$lib/components/CopyButton.svelte';
	import Countdown from '$lib/components/Countdown.svelte';
	import ConnectionStatus, { type ConnState } from '$lib/components/ConnectionStatus.svelte';
	import RequestRow from '$lib/components/RequestRow.svelte';
	import RequestDetail from '$lib/components/RequestDetail.svelte';
	import LockedShell from '$lib/components/LockedShell.svelte';
	import FirstCreateWarning from '$lib/components/FirstCreateWarning.svelte';
	import Wordmark from '$lib/components/Wordmark.svelte';

	let inboxId = $derived($page.params.id);

	type LoadState = 'loading' | 'ok' | 'locked' | 'notfound' | 'error';
	let loadState = $state<LoadState>('loading');
	let loadError = $state<string | null>(null);

	let inbox = $state<Inbox | null>(null);
	let lockedShell = $state<InboxShell | null>(null);
	let requests = $state<RequestSummary[]>([]);
	let expiredFlag = $state(false);

	let conn = $state<ConnState>('connecting');
	let now = $state(Date.now());
	let freshIds = $state<Set<string>>(new Set());

	let origin = $state('');
	// Cycle-4a: webhookUrl now comes verbatim from the server response so
	// PUBLIC_BASE_URL overrides flow through to the displayed URL, the Copy
	// button, the empty-state example cURL, and the replay tab. The origin
	// derivation below is only a defensive fallback if the response somehow
	// lacks the field.
	let webhookUrl = $state('');
	let canonicalOrigin = $derived(webhookUrl ? canonicalOriginFromWebhookUrl(webhookUrl) : origin);

	// Per-inbox key from localStorage. Only the browser that created the inbox
	// holds it; without it the server returns the locked-shell view.
	let storedKey = $state<string | null>(null);
	let showFirstWarning = $state(false);

	// Detail panel
	let selectedId = $state<string | null>(null);
	let selectedRequest = $state<WebhookRequest | null>(null);
	let detailLoading = $state(false);
	let detailError = $state<string | null>(null);

	let sseHandle: SseHandle | null = null;
	let nowTimer: ReturnType<typeof setInterval> | undefined;
	let networkRetries = 0;
	const MAX_NETWORK_RETRIES = 1;
	const RETRY_DELAY_MS = 3000;

	function authHeaders(): Record<string, string> {
		return storedKey ? { Authorization: `Bearer ${storedKey}` } : {};
	}

	function sortDesc(list: RequestSummary[]): RequestSummary[] {
		return [...list].sort(
			(a, b) => new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime()
		);
	}

	async function loadInbox() {
		loadState = 'loading';
		try {
			const res = await fetch(`/api/inboxes/${inboxId}`, { headers: authHeaders() });
			if (res.status === 404) {
				loadState = 'notfound';
				return;
			}
			if (!res.ok) throw new Error(`Failed to load inbox (${res.status})`);
			// Cycle-4a contract: both branches carry webhookUrl. The intersection
			// type is a no-op once types.ts catches up and stays type-safe either way.
			const data = (await res.json()) as GetInboxResponse & { webhookUrl?: string };
			if (data.locked) {
				lockedShell = data.shell;
				webhookUrl =
					data.webhookUrl ?? `${origin}/in/${data.shell.publicToken}`;
				loadState = 'locked';
				return;
			}
			inbox = data.inbox;
			requests = sortDesc(data.requests);
			webhookUrl = data.webhookUrl ?? `${origin}/in/${data.inbox.publicToken}`;
			loadState = 'ok';
			if (storedKey && !hasSeenFirstWarning()) showFirstWarning = true;
			openStream();
		} catch (e) {
			loadError = e instanceof Error ? e.message : 'Something went wrong.';
			loadState = 'error';
		}
	}

	function markFresh(id: string) {
		const next = new Set(freshIds);
		next.add(id);
		freshIds = next;
		setTimeout(() => {
			const after = new Set(freshIds);
			after.delete(id);
			freshIds = after;
		}, 1600);
	}

	function handleEvent(evt: InboxEvent) {
		if (evt.type === 'request') {
			const incoming = evt.request;
			if (requests.some((r) => r.id === incoming.id)) return;
			requests = [incoming, ...requests];
			markFresh(incoming.id);
		} else if (evt.type === 'expired') {
			expiredFlag = true;
			closeStream();
		}
	}

	function openStream() {
		closeStream();
		conn = 'connecting';
		sseHandle = openSseStream(`/api/inboxes/${inboxId}/events`, {
			headers: { ...authHeaders() },
			handlers: {
				onOpen() {
					conn = 'connected';
					networkRetries = 0;
				},
				onMessage(data) {
					if (data && typeof data === 'object' && 'type' in (data as object)) {
						handleEvent(data as InboxEvent);
					}
				},
				onNamedEvent(name, data) {
					if (name === 'expired') handleEvent({ type: 'expired' });
					if (name === 'request' && data && typeof data === 'object') {
						handleEvent({ type: 'request', request: data as RequestSummary });
					}
				},
				onClose(reason) {
					sseHandle = null;
					if (reason === 'capped') {
						conn = 'capped';
					} else if (reason === 'aborted') {
						// We closed it ourselves — leave conn alone.
					} else if (expiredFlag) {
						conn = 'closed';
					} else if (reason === 'network' && networkRetries < MAX_NETWORK_RETRIES) {
						networkRetries++;
						conn = 'reconnecting';
						setTimeout(() => {
							if (!expiredFlag) openStream();
						}, RETRY_DELAY_MS);
					} else {
						conn = 'closed';
					}
				}
			}
		});
	}

	function closeStream() {
		sseHandle?.abort();
		sseHandle = null;
	}

	async function selectRequest(id: string) {
		selectedId = id;
		detailError = null;
		detailLoading = true;
		selectedRequest = null;
		try {
			const res = await fetch(`/api/inboxes/${inboxId}/requests/${id}`, {
				headers: authHeaders()
			});
			if (!res.ok) throw new Error(`Could not load request (${res.status})`);
			const data = (await res.json()) as WebhookRequest;
			if (selectedId === id) selectedRequest = data;
		} catch (e) {
			if (selectedId === id) detailError = e instanceof Error ? e.message : 'Failed to load request.';
		} finally {
			if (selectedId === id) detailLoading = false;
		}
	}

	function closeDetail() {
		selectedId = null;
		selectedRequest = null;
		detailError = null;
	}

	onMount(() => {
		origin = window.location.origin;
		const record = inboxId ? getStoredInbox(inboxId) : null;
		storedKey = record?.key ?? null;
		nowTimer = setInterval(() => (now = Date.now()), 5000);
		loadInbox();
	});

	onDestroy(() => {
		closeStream();
		clearInterval(nowTimer);
	});
</script>

<svelte:head>
	<title>Inbox · webhook · dexli.dev</title>
</svelte:head>

<div class="page">
	<header class="topbar wrap">
		<Wordmark />
		{#if loadState === 'ok'}
			<div class="head-right">
				<Countdown expiresAt={inbox!.expiresAt} onExpire={() => (expiredFlag = true)} />
				<ConnectionStatus state={expiredFlag ? 'closed' : conn} />
			</div>
		{/if}
	</header>

	{#if loadState === 'loading'}
		<main class="wrap state-wrap">
			<div class="bigstate">
				<span class="spinner big" aria-hidden="true"></span>
				<p>Loading inbox…</p>
			</div>
		</main>
	{:else if loadState === 'notfound'}
		<main class="wrap state-wrap">
			<div class="bigstate">
				<div class="glyph">∅</div>
				<h2>Inbox not found</h2>
				<p>This inbox has expired or never existed. Inboxes are temporary and clear after 24 hours.</p>
				<a class="btn btn-primary" href="/">Create a new inbox</a>
			</div>
		</main>
	{:else if loadState === 'error'}
		<main class="wrap state-wrap">
			<div class="bigstate">
				<div class="glyph err">!</div>
				<h2>Something went wrong</h2>
				<p>{loadError}</p>
				<button class="btn" onclick={loadInbox} type="button">Retry</button>
			</div>
		</main>
	{:else if loadState === 'locked' && lockedShell}
		<LockedShell shell={lockedShell} {webhookUrl} />
	{:else if inbox}
		<!-- URL bar -->
		<section class="wrap urlbar">
			<div class="url-card" class:expired={expiredFlag}>
				<span class="url-label">Your webhook URL</span>
				<code class="url" title={webhookUrl}>{webhookUrl}</code>
				<CopyButton text={webhookUrl} label="Copy URL" />
			</div>
			{#if expiredFlag}
				<p class="expired-note" role="status">
					This inbox has expired — it no longer accepts requests. <a href="/">Create a new one.</a>
				</p>
			{/if}
		</section>

		{#if showFirstWarning}
			<FirstCreateWarning ondismiss={() => (showFirstWarning = false)} />
		{/if}

		<!-- Body: list + detail -->
		<main class="wrap board" class:has-detail={selectedId !== null}>
			<section class="list-pane">
				<div class="list-head">
					<h2>Requests</h2>
					<span class="count">{requests.length}{requests.length === 1 ? ' request' : ' requests'}</span>
				</div>

				{#if requests.length === 0}
					<div class="empty">
						<div class="radar" aria-hidden="true"><span class="ring"></span><span class="ring"></span><span class="core"></span></div>
						<h3>Waiting for your first request…</h3>
						<p>Send anything to your webhook URL and it appears here instantly. Try this:</p>
						<div class="empty-curl">
							<pre class="code">{exampleCurl(webhookUrl)}</pre>
							<div class="empty-curl-foot">
								<CopyButton text={exampleCurl(webhookUrl)} label="Copy curl" />
							</div>
						</div>
					</div>
				{:else}
					<div class="list-cols">
						<span>Method</span>
						<span>Path</span>
						<span>Status</span>
						<span class="hide-sm">Source IP</span>
						<span class="hide-sm">Content-Type</span>
						<span class="hide-sm">Size</span>
						<span class="ta-right">Received</span>
					</div>
					<div class="rows">
						{#each requests as req (req.id)}
							<RequestRow
								request={req}
								selected={selectedId === req.id}
								isNew={freshIds.has(req.id)}
								compact={selectedId !== null}
								{now}
								onselect={selectRequest}
							/>
						{/each}
					</div>
				{/if}
			</section>

			{#if selectedId !== null}
				<section class="detail-pane">
					<RequestDetail
						request={selectedRequest}
						loading={detailLoading}
						error={detailError}
						origin={canonicalOrigin}
						onclose={closeDetail}
					/>
				</section>
			{/if}
		</main>
	{/if}
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
		padding-top: 20px;
		padding-bottom: 20px;
		border-bottom: 1px solid var(--border-soft);
	}
	.head-right {
		display: flex;
		align-items: center;
		gap: 16px;
	}

	/* URL bar */
	.urlbar {
		padding-top: 22px;
	}
	.url-card {
		display: flex;
		align-items: center;
		gap: 16px;
		padding: 14px 16px;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		box-shadow: var(--shadow);
	}
	.url-card.expired {
		opacity: 0.6;
	}
	.url-label {
		font-size: 11px;
		letter-spacing: 0.14em;
		text-transform: uppercase;
		color: var(--text-faint);
		white-space: nowrap;
	}
	.url {
		flex: 1;
		min-width: 0;
		font-size: 15px;
		font-weight: 600;
		color: var(--accent);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.expired-note {
		margin: 12px 2px 0;
		font-size: 13px;
		color: var(--s-4xx);
	}

	/* Board */
	.board {
		flex: 1;
		min-height: 0;
		padding-top: 24px;
		padding-bottom: 40px;
		display: grid;
		grid-template-columns: 1fr;
		gap: 22px;
		align-items: start;
	}
	.board.has-detail {
		grid-template-columns: minmax(0, 1fr) minmax(380px, 460px);
	}

	.list-pane {
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		overflow: hidden;
		min-width: 0;
	}
	.list-head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		padding: 16px 18px 12px;
	}
	.list-head h2 {
		font-size: 17px;
	}
	.count {
		font-size: 12px;
		color: var(--text-faint);
	}
	.list-cols {
		display: grid;
		grid-template-columns: 68px minmax(0, 1fr) 64px 120px 150px 64px 132px;
		gap: 14px;
		padding: 8px 18px;
		border-top: 1px solid var(--border-soft);
		border-bottom: 1px solid var(--border);
		background: var(--surface-2);
		font-size: 10.5px;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: var(--text-faint);
	}
	.ta-right {
		text-align: right;
	}
	/* Match RequestRow's condensed layout when the detail panel is open. */
	.board.has-detail .list-cols {
		grid-template-columns: 68px minmax(0, 1fr) 64px 132px;
	}
	.board.has-detail .list-cols .hide-sm {
		display: none;
	}
	.rows {
		max-height: calc(100vh - 280px);
		overflow: auto;
	}

	.detail-pane {
		position: sticky;
		top: 18px;
		height: calc(100vh - 130px);
		min-height: 420px;
	}

	/* Empty state */
	.empty {
		text-align: center;
		padding: 54px 22px 60px;
	}
	.empty h3 {
		font-size: 18px;
		margin-top: 24px;
	}
	.empty p {
		color: var(--text-dim);
		font-size: 13.5px;
		margin: 10px 0 0;
	}
	.empty-curl {
		max-width: 560px;
		margin: 22px auto 0;
		text-align: left;
	}
	.empty-curl .code {
		white-space: pre-wrap;
		word-break: break-word;
	}
	.empty-curl-foot {
		display: flex;
		justify-content: flex-end;
		margin-top: 10px;
	}

	.radar {
		position: relative;
		width: 64px;
		height: 64px;
		margin: 0 auto;
	}
	.radar .core {
		position: absolute;
		inset: 0;
		margin: auto;
		width: 12px;
		height: 12px;
		border-radius: 50%;
		background: var(--accent);
		box-shadow: 0 0 16px -2px var(--accent);
	}
	.radar .ring {
		position: absolute;
		inset: 0;
		border-radius: 50%;
		border: 1.5px solid var(--accent);
		opacity: 0;
		animation: ping 2.4s ease-out infinite;
	}
	.radar .ring:nth-child(2) {
		animation-delay: 1.2s;
	}
	@keyframes ping {
		0% {
			transform: scale(0.25);
			opacity: 0.7;
		}
		100% {
			transform: scale(1);
			opacity: 0;
		}
	}

	/* Big states */
	.state-wrap {
		flex: 1;
		display: grid;
		place-items: center;
		padding: 80px 24px;
	}
	.bigstate {
		text-align: center;
		max-width: 440px;
	}
	.bigstate h2 {
		font-size: 24px;
		margin-bottom: 10px;
	}
	.bigstate p {
		color: var(--text-dim);
		font-size: 14px;
		margin: 0 0 22px;
	}
	.glyph {
		font-size: 52px;
		color: var(--text-faint);
		font-family: var(--display);
		margin-bottom: 8px;
	}
	.glyph.err {
		color: var(--s-5xx);
	}

	.spinner {
		display: inline-block;
		border-radius: 50%;
		border: 2px solid var(--surface-3);
		border-top-color: var(--accent);
		animation: spin 0.7s linear infinite;
	}
	.spinner.big {
		width: 30px;
		height: 30px;
		border-width: 3px;
		margin-bottom: 16px;
	}
	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	@media (max-width: 820px) {
		.list-cols {
			grid-template-columns: 60px minmax(0, 1fr) 56px auto;
		}
		.hide-sm {
			display: none;
		}
		.board.has-detail {
			grid-template-columns: 1fr;
		}
		.detail-pane {
			position: fixed;
			inset: 0;
			z-index: 50;
			height: 100vh;
			min-height: 0;
			padding: 12px;
			background: rgba(8, 9, 11, 0.7);
			backdrop-filter: blur(3px);
		}
	}
</style>
