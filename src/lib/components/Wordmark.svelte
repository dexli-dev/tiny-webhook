<script lang="ts">
	// Parametric site wordmark. The dexli.dev tiny-tools family shares this
	// shape — sibling sites (regex.dexli.dev, json.dexli.dev, …) just swap
	// `name` / `domain` props. Keep typography and spacing identical across
	// the family so the brand reads as one collection of small tools.
	interface Props {
		name?: string;
		domain?: string;
		/** Glyph in the logo tile. Defaults to the lightning-fork used site-wide. */
		glyph?: string;
		/** Where the wordmark links to. Root of the site by default. */
		href?: string;
	}
	let { name = 'webhook', domain = '.dexli.dev', glyph = '⌁', href = '/' }: Props = $props();
</script>

<a class="brand" {href}>
	<span class="logo" aria-hidden="true">{glyph}</span>
	<span class="text">{name}<span class="tld">{domain}</span></span>
</a>

<style>
	.brand {
		display: inline-flex;
		align-items: center;
		gap: 10px;
		color: var(--text);
		font-weight: 700;
		font-size: 15px;
		letter-spacing: -0.01em;
	}
	.brand:hover {
		text-decoration: none;
	}
	.logo {
		display: grid;
		place-items: center;
		width: 30px;
		height: 30px;
		border-radius: 8px;
		background: var(--accent);
		color: #0a0b0d;
		font-size: 18px;
		box-shadow: 0 0 24px -6px var(--accent-glow);
	}
	.tld {
		color: var(--text-faint);
	}
</style>
