<script lang="ts">
	import type { WebhookRequest } from '$lib/types';
	import {
		buildCurl,
		clockTime,
		fullTime,
		formatBytes,
		looksLikeJson,
		tryPrettyJson,
		parseQuery
	} from '$lib/utils';
	import MethodBadge from './MethodBadge.svelte';
	import StatusBadge from './StatusBadge.svelte';
	import CopyButton from './CopyButton.svelte';

	type Tab = 'overview' | 'headers' | 'query' | 'body' | 'curl';

	interface Props {
		request: WebhookRequest | null;
		loading?: boolean;
		error?: string | null;
		origin: string;
		onclose: () => void;
	}
	let { request, loading = false, error = null, origin, onclose }: Props = $props();

	let tab = $state<Tab>('overview');

	// Reset to overview whenever a different request is opened.
	let currentId = $state<string | null>(null);
	$effect(() => {
		if (request && request.id !== currentId) {
			currentId = request.id;
			tab = 'overview';
			bodyPretty = true;
		}
	});

	let queryPairs = $derived(request ? parseQuery(request.queryString) : []);
	let isJson = $derived(request ? looksLikeJson(request.contentType, request.bodyText) : false);
	let prettied = $derived(request && isJson ? tryPrettyJson(request.bodyText) : null);
	let bodyPretty = $state(true);
	let bodyView = $derived(
		request ? (bodyPretty && prettied ? prettied : request.bodyText) : ''
	);

	let curlText = $derived(request ? buildCurl(request, origin) : '');
	let headersText = $derived(
		request ? request.headers.map(([k, v]) => `${k}: ${v}`).join('\n') : ''
	);

	const tabs: { id: Tab; label: string }[] = [
		{ id: 'overview', label: 'Overview' },
		{ id: 'headers', label: 'Headers' },
		{ id: 'query', label: 'Query' },
		{ id: 'body', label: 'Body' },
		{ id: 'curl', label: 'cURL' }
	];

	function onKey(e: KeyboardEvent) {
		if (e.key === 'Escape') onclose();
	}
</script>

<svelte:window onkeydown={onKey} />

<aside class="detail" aria-label="Request detail">
	<header class="d-head">
		<div class="d-title">
			{#if request}
				<MethodBadge method={request.method} />
				<span class="d-path" title={request.path}>{request.path}</span>
			{:else}
				<span class="d-path muted">Request</span>
			{/if}
		</div>
		<button class="close" onclick={onclose} aria-label="Close detail" type="button">
			<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
				<path
					d="M6 6l12 12M18 6L6 18"
					fill="none"
					stroke="currentColor"
					stroke-width="1.8"
					stroke-linecap="round"
				/>
			</svg>
		</button>
	</header>

	{#if loading}
		<div class="d-state">Loading request…</div>
	{:else if error}
		<div class="d-state err">{error}</div>
	{:else if request}
		<div class="tabs" role="tablist">
			{#each tabs as t (t.id)}
				<button
					class="tab"
					class:active={tab === t.id}
					role="tab"
					aria-selected={tab === t.id}
					onclick={() => (tab = t.id)}
					type="button"
				>
					{t.label}
					{#if t.id === 'headers' && request.headers.length}<span class="badge">{request.headers.length}</span>{/if}
					{#if t.id === 'query' && queryPairs.length}<span class="badge">{queryPairs.length}</span>{/if}
				</button>
			{/each}
		</div>

		<div class="d-body">
			{#if tab === 'overview'}
				<dl class="kv">
					<dt>Status</dt>
					<dd><StatusBadge status={request.responseStatus} /></dd>
					<dt>Method</dt>
					<dd>{request.method.toUpperCase()}</dd>
					<dt>Path</dt>
					<dd class="break">{request.path}</dd>
					<dt>Received</dt>
					<dd>{fullTime(request.receivedAt)} <span class="muted">({clockTime(request.receivedAt)})</span></dd>
					<dt>Source IP</dt>
					<dd>{request.sourceIp}</dd>
					<dt>Content-Type</dt>
					<dd class="break">{request.contentType ?? '—'}</dd>
					<dt>Body size</dt>
					<dd>{formatBytes(request.bodySizeBytes)}</dd>
					<dt>User-Agent</dt>
					<dd class="break">{request.userAgent ?? '—'}</dd>
				</dl>
			{:else if tab === 'headers'}
				{#if request.headers.length}
					<div class="row-actions">
						<CopyButton text={headersText} label="Copy headers" />
					</div>
					<table class="pairs">
						<tbody>
							{#each request.headers as [name, value], i (i)}
								<tr>
									<td class="k">{name}</td>
									<td class="v">{value}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				{:else}
					<div class="d-state">No headers.</div>
				{/if}
			{:else if tab === 'query'}
				{#if queryPairs.length}
					<table class="pairs">
						<tbody>
							{#each queryPairs as [name, value], i (i)}
								<tr>
									<td class="k">{name}</td>
									<td class="v">{value}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				{:else}
					<div class="d-state">No query parameters.</div>
				{/if}
			{:else if tab === 'body'}
				{#if request.bodyText}
					<div class="row-actions">
						{#if prettied}
							<div class="toggle" role="group" aria-label="Body view">
								<button class:on={bodyPretty} onclick={() => (bodyPretty = true)} type="button">Pretty</button>
								<button class:on={!bodyPretty} onclick={() => (bodyPretty = false)} type="button">Raw</button>
							</div>
						{/if}
						<CopyButton text={request.bodyText} label="Copy body" />
					</div>
					<pre class="code block">{bodyView}</pre>
				{:else}
					<div class="d-state">Empty body.</div>
				{/if}
			{:else if tab === 'curl'}
				<div class="row-actions">
					<span class="hint">Replays method, headers and body against this inbox.</span>
					<CopyButton text={curlText} label="Copy curl" />
				</div>
				<pre class="code block">{curlText}</pre>
			{/if}
		</div>
	{:else}
		<div class="d-state">Select a request to inspect it.</div>
	{/if}
</aside>

<style>
	.detail {
		display: flex;
		flex-direction: column;
		height: 100%;
		min-height: 0;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		overflow: hidden;
	}
	.d-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		padding: 14px 16px;
		border-bottom: 1px solid var(--border);
		background: var(--surface-2);
	}
	.d-title {
		display: flex;
		align-items: center;
		gap: 10px;
		min-width: 0;
	}
	.d-path {
		font-size: 13px;
		font-weight: 600;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.muted {
		color: var(--text-faint);
	}
	.close {
		flex: none;
		display: grid;
		place-items: center;
		width: 32px;
		height: 32px;
		border-radius: var(--radius-sm);
		border: 1px solid var(--border);
		background: var(--surface);
		color: var(--text-dim);
	}
	.close:hover {
		color: var(--text);
		border-color: #39414d;
	}

	.tabs {
		display: flex;
		gap: 2px;
		padding: 0 10px;
		border-bottom: 1px solid var(--border);
		background: var(--surface-2);
		overflow-x: auto;
	}
	.tab {
		position: relative;
		display: inline-flex;
		align-items: center;
		gap: 6px;
		background: transparent;
		border: none;
		color: var(--text-dim);
		padding: 12px 12px;
		font-size: 12.5px;
		font-weight: 600;
		white-space: nowrap;
		border-bottom: 2px solid transparent;
		transition: color 0.12s, border-color 0.12s;
	}
	.tab:hover {
		color: var(--text);
	}
	.tab.active {
		color: var(--accent);
		border-bottom-color: var(--accent);
	}
	.badge {
		font-size: 10px;
		font-weight: 700;
		color: var(--text-faint);
		background: var(--surface-3);
		border-radius: 999px;
		padding: 1px 6px;
	}
	.tab.active .badge {
		color: var(--accent);
	}

	.d-body {
		flex: 1;
		min-height: 0;
		overflow: auto;
		padding: 16px;
	}
	.d-state {
		padding: 28px 16px;
		color: var(--text-faint);
		text-align: center;
		font-size: 13px;
	}
	.d-state.err {
		color: var(--s-5xx);
	}

	.kv {
		display: grid;
		grid-template-columns: 116px 1fr;
		gap: 10px 16px;
		margin: 0;
		font-size: 13px;
	}
	.kv dt {
		color: var(--text-faint);
		font-size: 11px;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		padding-top: 2px;
	}
	.kv dd {
		margin: 0;
		color: var(--text);
	}
	.break {
		word-break: break-all;
	}

	.row-actions {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: 12px;
		margin-bottom: 12px;
	}
	.hint {
		margin-right: auto;
		font-size: 11.5px;
		color: var(--text-faint);
	}

	.pairs {
		width: 100%;
		border-collapse: collapse;
		font-size: 12.5px;
	}
	.pairs td {
		padding: 8px 10px;
		border-bottom: 1px solid var(--border-soft);
		vertical-align: top;
		word-break: break-all;
	}
	.pairs .k {
		color: var(--accent-dim);
		font-weight: 600;
		width: 38%;
		white-space: nowrap;
	}
	.pairs .v {
		color: var(--text);
	}

	.block {
		margin: 0;
		max-height: none;
		white-space: pre-wrap;
		word-break: break-word;
	}

	.toggle {
		display: inline-flex;
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		overflow: hidden;
		margin-right: auto;
	}
	.toggle button {
		background: var(--surface-2);
		border: none;
		color: var(--text-dim);
		padding: 6px 12px;
		font-size: 12px;
		font-weight: 600;
		font-family: var(--mono);
	}
	.toggle button.on {
		background: var(--surface-3);
		color: var(--accent);
	}
</style>
