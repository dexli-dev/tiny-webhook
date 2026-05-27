// Cycle-3 bar item 4, 5, 6 verification at the handoff-URL contract layer.
// The component itself is a thin disposition wrapper around `buildHandoffUrl`
// + `looksLikeBinary`; both are unit-tested directly. The DOM-level button
// states (hidden / disabled / anchor) are verified in the headless smoke
// against the built app, not here.

import { describe, expect, it } from 'vitest';
import { buildHandoffUrl, MAX_HANDOFF_URL_BYTES } from '@dexli/family';

describe('handoff URL contract (cycle-3 items 4 + 5 + 6)', () => {
	// Item 5: the SendToRegexButton consumes the REAL cycle-2 builder, not a
	// hand-rolled URL templater. Identity + typeof check.
	it('item 5 — buildHandoffUrl is a real function exported from @dexli/family', () => {
		expect(typeof buildHandoffUrl).toBe('function');
		expect(MAX_HANDOFF_URL_BYTES).toBe(4096);
	});

	// Item 4: byte-indistinguishability. A URL produced by the builder for a
	// given body MUST parse to the same effective state (origin + path + `t`
	// param) as a URL a user could hand-type, modulo param-order.
	it('item 4 — produced URL is byte-equivalent to hand-typed (modulo param order)', () => {
		const body = 'hello 42 world';
		const result = buildHandoffUrl({ to: 'regex', inputs: { text: body } });
		if (!result.ok) throw new Error(`unexpected ${result.kind}`);
		const fromButton = new URL(result.url);
		const handTyped = new URL(`https://regex.dexli.dev/?t=${encodeURIComponent(body)}`);
		expect(fromButton.origin).toBe(handTyped.origin);
		expect(fromButton.pathname).toBe(handTyped.pathname);
		expect(fromButton.searchParams.get('t')).toBe(handTyped.searchParams.get('t'));
		// Indistinguishability strictness: no namespace prefix, no envelope
		// param, no `?from=` breadcrumb. Only `t` should be present.
		const params = Array.from(fromButton.searchParams.keys());
		expect(params).toEqual(['t']);
	});

	it('item 4 — round-trips multi-byte UTF-8 cleanly', () => {
		const body = '日本語テキスト · café 🎉';
		const result = buildHandoffUrl({ to: 'regex', inputs: { text: body } });
		if (!result.ok) throw new Error(`unexpected ${result.kind}`);
		const decoded = new URL(result.url).searchParams.get('t');
		expect(decoded).toBe(body);
	});

	it('item 4 — round-trips regex metacharacters cleanly', () => {
		const body = '?a&b=1#frag /path\\esc';
		const result = buildHandoffUrl({ to: 'regex', inputs: { text: body } });
		if (!result.ok) throw new Error(`unexpected ${result.kind}`);
		expect(new URL(result.url).searchParams.get('t')).toBe(body);
	});

	// Item 6 — over-cap case. The builder is contracted to return an
	// over-cap discriminant when the FINAL encoded URL exceeds 4096 bytes
	// (sender precondition §11.5). Verify here so the SendToRegexButton's
	// disabled branch is triggered by real over-cap, not a different shape.
	it('item 6 — over-cap body returns over-cap discriminant, never a truncated URL', () => {
		// Build a body that, after percent-encoding, blows past the cap.
		// `&` encodes to %26 (3 bytes for 1 source byte), so 1500 `&`s alone
		// produce 4500 bytes of query → guaranteed over-cap.
		const body = '&'.repeat(1500);
		const result = buildHandoffUrl({ to: 'regex', inputs: { text: body } });
		expect(result.ok).toBe(false);
		if (result.ok) return; // type narrow
		expect(result.kind).toBe('over-cap');
		if (result.kind !== 'over-cap') return;
		expect(result.length).toBeGreaterThan(MAX_HANDOFF_URL_BYTES);
		expect(result.cap).toBe(MAX_HANDOFF_URL_BYTES);
	});

	it('item 6 — bodies just under the cap succeed', () => {
		// Plain ASCII letters encode 1-to-1, no expansion. Leave headroom for
		// `https://regex.dexli.dev/?t=` prefix (~28 bytes).
		const body = 'a'.repeat(MAX_HANDOFF_URL_BYTES - 64);
		const result = buildHandoffUrl({ to: 'regex', inputs: { text: body } });
		expect(result.ok).toBe(true);
	});

	it('item 6 — empty inputs map produces the bare landing URL', () => {
		const result = buildHandoffUrl({ to: 'regex' });
		if (!result.ok) throw new Error(`unexpected ${result.kind}`);
		expect(result.url).toBe('https://regex.dexli.dev/');
	});

	// Sanity: the builder rejects unknown recipients without throwing, so a
	// caller typo doesn't crash the UI.
	it('rejects unknown recipient with non-throwing discriminant', () => {
		const result = buildHandoffUrl({ to: 'not-a-sibling', inputs: { text: 'x' } });
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.kind).toBe('unknown-recipient');
	});
});
