// Tests for the env-parsing helpers in $lib/config. The helpers accept an
// EnvSource parameter (default process.env) precisely so tests can exercise
// them with controlled inputs rather than monkey-patching process.env.
//
// The CONFIG object itself is built at module load from process.env; testing
// its end-to-end env-honoring behaviour belongs in the Docker smoke (PORT +
// PUBLIC_BASE_URL set in the runtime, response-asserted), not here.

import { describe, expect, it } from 'vitest';
import { CONFIG, envInt, envUrl, type EnvSource } from './config';

describe('envInt', () => {
	it('returns the default when the var is unset', () => {
		expect(envInt('X', 7, {}, {})).toBe(7);
	});

	it('returns the default when the var is an empty string', () => {
		expect(envInt('X', 7, {}, { X: '' })).toBe(7);
	});

	it('parses a valid integer', () => {
		expect(envInt('X', 7, {}, { X: '42' })).toBe(42);
	});

	it('parses a negative integer', () => {
		expect(envInt('X', 0, {}, { X: '-5' })).toBe(-5);
	});

	it('trims surrounding whitespace', () => {
		expect(envInt('X', 0, {}, { X: '  42  ' })).toBe(42);
	});

	it('throws on a non-integer string', () => {
		expect(() => envInt('X', 0, {}, { X: 'abc' })).toThrow(/must be an integer/);
	});

	it('throws on a float', () => {
		expect(() => envInt('X', 0, {}, { X: '3.14' })).toThrow(/must be an integer/);
	});

	it('throws on a value below min', () => {
		expect(() => envInt('X', 0, { min: 1 }, { X: '0' })).toThrow(/below minimum 1/);
	});

	it('throws on a value above max', () => {
		expect(() => envInt('X', 0, { max: 100 }, { X: '101' })).toThrow(/above maximum 100/);
	});

	it('honors both bounds together', () => {
		expect(envInt('X', 5, { min: 1, max: 10 }, { X: '5' })).toBe(5);
		expect(() => envInt('X', 5, { min: 1, max: 10 }, { X: '11' })).toThrow();
		expect(() => envInt('X', 5, { min: 1, max: 10 }, { X: '0' })).toThrow();
	});

	it('mentions the var name in the error so a deploy log is useful', () => {
		expect(() => envInt('INBOX_TTL_HOURS', 24, { min: 1 }, { INBOX_TTL_HOURS: 'oops' })).toThrow(
			/INBOX_TTL_HOURS/
		);
	});
});

describe('envUrl', () => {
	it('returns undefined when the var is unset', () => {
		expect(envUrl('X', {})).toBeUndefined();
	});

	it('returns undefined for an empty string', () => {
		expect(envUrl('X', { X: '' })).toBeUndefined();
	});

	it('returns the canonical origin (no trailing slash)', () => {
		expect(envUrl('X', { X: 'https://webhook.dexli.dev' })).toBe('https://webhook.dexli.dev');
		expect(envUrl('X', { X: 'https://webhook.dexli.dev/' })).toBe('https://webhook.dexli.dev');
	});

	it('preserves port', () => {
		expect(envUrl('X', { X: 'http://localhost:3000' })).toBe('http://localhost:3000');
	});

	it('throws on an unparseable URL', () => {
		expect(() => envUrl('X', { X: 'not-a-url' })).toThrow(/parseable URL/);
		expect(() => envUrl('X', { X: 'ftp://' })).toThrow(/parseable URL/);
	});

	it('throws when the URL carries a path (origin-only is the contract)', () => {
		expect(() => envUrl('X', { X: 'https://example.com/api' })).toThrow(/origin only/);
	});

	it('mentions the var name in the error', () => {
		expect(() => envUrl('PUBLIC_BASE_URL', { PUBLIC_BASE_URL: 'nope' })).toThrow(
			/PUBLIC_BASE_URL/
		);
	});
});

describe('CONFIG (module-load defaults)', () => {
	// Smoke-check that the live CONFIG object built from the running process.env
	// has plausible shape. End-to-end env-override behaviour is verified by the
	// Docker smoke in the deploy gate, not here (that would require module
	// reload mid-test).
	it('exposes all expected keys with the right types', () => {
		expect(typeof CONFIG.MAX_BODY_BYTES).toBe('number');
		expect(typeof CONFIG.MAX_REQUESTS_PER_INBOX).toBe('number');
		expect(typeof CONFIG.INBOX_TTL_MS).toBe('number');
		expect(typeof CONFIG.MAX_INBOXES_PER_IP_PER_HOUR).toBe('number');
		expect(typeof CONFIG.SWEEP_INTERVAL_MS).toBe('number');
		expect(typeof CONFIG.TOKEN_LENGTH).toBe('number');
		expect(typeof CONFIG.KEY_BYTES).toBe('number');
		expect(typeof CONFIG.SSE_MAX_PER_INBOX).toBe('number');
		expect(typeof CONFIG.SSE_MAX_GLOBAL).toBe('number');
		expect(Array.isArray(CONFIG.ACCEPTED_METHODS)).toBe(true);
		// PUBLIC_BASE_URL is undefined unless deploy-set.
		const ub = CONFIG.PUBLIC_BASE_URL;
		expect(ub === undefined || typeof ub === 'string').toBe(true);
	});

	it('INBOX_TTL_MS is the configured hours converted to ms', () => {
		// Default 24h, so the ms value is a positive multiple of 3_600_000.
		expect(CONFIG.INBOX_TTL_MS % 3_600_000).toBe(0);
		expect(CONFIG.INBOX_TTL_MS / 3_600_000).toBeGreaterThanOrEqual(1);
	});

	it('is frozen (Object.freeze) so handlers cannot mutate it mid-run', () => {
		expect(Object.isFrozen(CONFIG)).toBe(true);
	});
});

describe('env source type compatibility', () => {
	// Spot check that an EnvSource works whether you pass a real process.env
	// shape or a plain object literal.
	it('accepts an arbitrary record', () => {
		const fake: EnvSource = { FOO: '1', BAR: undefined };
		expect(envInt('FOO', 0, {}, fake)).toBe(1);
		expect(envInt('BAR', 99, {}, fake)).toBe(99);
		expect(envInt('MISSING', 99, {}, fake)).toBe(99);
	});
});
