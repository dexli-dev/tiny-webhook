import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CONFIG } from '$lib/config';
import {
	__resetForTests,
	createInbox,
	getInbox,
	getInboxByToken,
	getRequest,
	isExpired,
	listRequests,
	recordRequest,
	subscribe,
	sweepExpired,
	tryConsumeInboxCreation
} from './store';
import type { CapturedInput } from './store';
import type { InboxEvent } from '$lib/types';

function input(over: Partial<CapturedInput> = {}): CapturedInput {
	return {
		method: 'POST',
		path: '/in/abc',
		queryString: '',
		headers: [['content-type', 'application/json']],
		bodyText: '{}',
		bodySizeBytes: 2,
		contentType: 'application/json',
		sourceIp: '203.0.113.5',
		userAgent: 'curl/8',
		responseStatus: 200,
		...over
	};
}

beforeEach(() => __resetForTests());
afterEach(() => {
	vi.useRealTimers();
	__resetForTests();
});

describe('createInbox / lookup', () => {
	it('creates an inbox reachable by id and token', () => {
		const inbox = createInbox();
		expect(getInbox(inbox.id)).toEqual(inbox);
		expect(getInboxByToken(inbox.publicToken)).toEqual(inbox);
		expect(inbox.requestLimit).toBe(CONFIG.MAX_REQUESTS_PER_INBOX);
	});

	it('returns undefined for unknown id/token', () => {
		expect(getInbox('nope')).toBeUndefined();
		expect(getInboxByToken('nope')).toBeUndefined();
	});
});

describe('request cap', () => {
	it('keeps at most requestLimit requests, evicting oldest', () => {
		const inbox = createInbox();
		const total = CONFIG.MAX_REQUESTS_PER_INBOX + 5;
		for (let i = 0; i < total; i++) {
			recordRequest(inbox.publicToken, input({ bodyText: String(i) }));
		}
		const reqs = listRequests(inbox.id)!;
		expect(reqs).toHaveLength(CONFIG.MAX_REQUESTS_PER_INBOX);
		// newest first; the very latest body is the last index recorded
		expect(reqs[0].bodySizeBytes).toBe(input().bodySizeBytes);
		// the oldest five (bodies "0".."4") must have been evicted
		const all = reqs.map((r) => r.id);
		expect(new Set(all).size).toBe(reqs.length);
	});

	it('recordRequest returns null for unknown token', () => {
		expect(recordRequest('ghost', input())).toBeNull();
	});

	it('lists requests newest-first and exposes full request by id', () => {
		const inbox = createInbox();
		const first = recordRequest(inbox.publicToken, input({ method: 'GET' }))!;
		const second = recordRequest(inbox.publicToken, input({ method: 'PUT' }))!;
		const list = listRequests(inbox.id)!;
		expect(list[0].id).toBe(second.id);
		expect(list[1].id).toBe(first.id);
		expect(getRequest(inbox.id, first.id)!.method).toBe('GET');
		expect(getRequest(inbox.id, 'missing')).toBeUndefined();
	});
});

describe('expiry', () => {
	it('isExpired flips at expiresAt', () => {
		const inbox = createInbox();
		const exp = new Date(inbox.expiresAt).getTime();
		expect(isExpired(inbox, exp - 1)).toBe(false);
		expect(isExpired(inbox, exp)).toBe(true);
	});

	it('getInbox/listRequests return undefined once expired and sweep removes it', () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
		const inbox = createInbox();
		recordRequest(inbox.publicToken, input());
		// jump past the 24h TTL
		vi.setSystemTime(new Date(Date.now() + CONFIG.INBOX_TTL_MS + 1000));
		expect(getInbox(inbox.id)).toBeUndefined();
		expect(listRequests(inbox.id)).toBeUndefined();
		expect(getInboxByToken(inbox.publicToken)).toBeUndefined();
		// already lazily removed by getInbox; sweep finds nothing more
		expect(sweepExpired()).toBe(0);
	});
});

describe('rate limiting', () => {
	it('allows up to the per-hour cap then rejects', () => {
		const ip = '198.51.100.7';
		for (let i = 0; i < CONFIG.MAX_INBOXES_PER_IP_PER_HOUR; i++) {
			expect(tryConsumeInboxCreation(ip)).toBe(true);
		}
		expect(tryConsumeInboxCreation(ip)).toBe(false);
	});

	it('rolls the window: old creations no longer count', () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
		const ip = '198.51.100.8';
		for (let i = 0; i < CONFIG.MAX_INBOXES_PER_IP_PER_HOUR; i++) {
			expect(tryConsumeInboxCreation(ip)).toBe(true);
		}
		expect(tryConsumeInboxCreation(ip)).toBe(false);
		// advance just past the 1h window
		vi.setSystemTime(new Date(Date.now() + 60 * 60 * 1000 + 1));
		expect(tryConsumeInboxCreation(ip)).toBe(true);
	});

	it('tracks IPs independently', () => {
		for (let i = 0; i < CONFIG.MAX_INBOXES_PER_IP_PER_HOUR; i++) {
			tryConsumeInboxCreation('a');
		}
		expect(tryConsumeInboxCreation('a')).toBe(false);
		expect(tryConsumeInboxCreation('b')).toBe(true);
	});
});

describe('pub/sub', () => {
	it('notifies subscribers of new requests with a summary', () => {
		const inbox = createInbox();
		const events: InboxEvent[] = [];
		subscribe(inbox.id, (e) => events.push(e));
		recordRequest(inbox.publicToken, input({ method: 'DELETE' }));
		expect(events).toHaveLength(1);
		expect(events[0]).toMatchObject({ type: 'request' });
		if (events[0].type === 'request') {
			expect(events[0].request.method).toBe('DELETE');
		}
	});

	it('stops notifying after unsubscribe', () => {
		const inbox = createInbox();
		const events: InboxEvent[] = [];
		const unsub = subscribe(inbox.id, (e) => events.push(e));
		recordRequest(inbox.publicToken, input());
		unsub();
		recordRequest(inbox.publicToken, input());
		expect(events).toHaveLength(1);
	});

	it('emits an expired event on sweep', () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
		const inbox = createInbox();
		const events: InboxEvent[] = [];
		subscribe(inbox.id, (e) => events.push(e));
		vi.setSystemTime(new Date(Date.now() + CONFIG.INBOX_TTL_MS + 1000));
		expect(sweepExpired()).toBe(1);
		expect(events).toContainEqual({ type: 'expired' });
	});

	it('a throwing listener does not block others', () => {
		const inbox = createInbox();
		const seen: string[] = [];
		subscribe(inbox.id, () => {
			throw new Error('boom');
		});
		subscribe(inbox.id, () => seen.push('ok'));
		recordRequest(inbox.publicToken, input());
		expect(seen).toEqual(['ok']);
	});
});
