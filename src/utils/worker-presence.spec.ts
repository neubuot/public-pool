import {
    composeAlert, composeStatus, evaluateAddress, formatDuration, offlineAfterMinutes, parseCommand, PresenceRow, summarizeSessions
} from './worker-presence';

const MIN = 60_000;
const NOW = Date.UTC(2026, 9, 31, 18, 0, 0);
const TEN = 10 * MIN;
const ADDRESS = 'bc1qexampleaddress0000000000000000000000000';

function row(partial: Partial<PresenceRow> & { worker: string }): PresenceRow {
    return { address: ADDRESS, userAgent: 'BitAxe', lastSeen: NOW - MIN, state: 'online', offlineSince: null, changedAt: NOW - 60 * MIN, ...partial };
}

describe('summarizeSessions', () => {
    it('takes the latest sign of life per worker over all sessions, date strings from SQLite included', () => {
        // the DateTimeTransformer stores toLocaleString() output and hands the string back unchanged
        const asStored = new Date(NOW - MIN).toLocaleString('en-US');
        const summary = summarizeSessions([
            { clientName: 'bitaxe1', userAgent: 'BitAxe', updatedAt: new Date(NOW - 5 * MIN) },
            { clientName: 'bitaxe1', userAgent: 'BitAxe 2', updatedAt: asStored },
            { clientName: 'nerd', userAgent: null, updatedAt: null, createdAt: new Date(NOW - 30 * MIN) },
            { clientName: 'broken', updatedAt: 'not a date' },
        ]);
        expect(summary.map(s => s.worker)).toEqual(['bitaxe1', 'nerd']);
        expect(summary[0].userAgent).toBe('BitAxe 2');
        expect(summary[0].lastSeen).toBe(NOW - MIN);
        expect(summary[1].lastSeen).toBe(NOW - 30 * MIN);
    });
});

describe('evaluateAddress', () => {
    it('records the current state silently when an address is seen for the first time', () => {
        const result = evaluateAddress(ADDRESS, [
            { clientName: 'alive', userAgent: 'BitAxe', updatedAt: new Date(NOW - MIN) },
            { clientName: 'gone', userAgent: 'NerdMiner', updatedAt: new Date(NOW - 3 * 60 * MIN) },
        ], [], NOW, TEN);
        expect(result.transitions).toEqual([]);
        expect(result.rows).toEqual([
            { address: ADDRESS, worker: 'alive', userAgent: 'BitAxe', lastSeen: NOW - MIN, state: 'online', offlineSince: null, changedAt: NOW },
            { address: ADDRESS, worker: 'gone', userAgent: 'NerdMiner', lastSeen: NOW - 3 * 60 * MIN, state: 'offline', offlineSince: NOW - 3 * 60 * MIN, changedAt: NOW },
        ]);
    });

    it('reports a worker offline once nothing arrived for the configured time', () => {
        const known = [row({ worker: 'bitaxe1', lastSeen: NOW - 11 * MIN })];
        const result = evaluateAddress(ADDRESS, [{ clientName: 'bitaxe1', userAgent: 'BitAxe', updatedAt: new Date(NOW - 11 * MIN) }], known, NOW, TEN);
        expect(result.transitions).toEqual([{ kind: 'offline', worker: 'bitaxe1', userAgent: 'BitAxe', lastSeen: NOW - 11 * MIN }]);
        expect(result.rows[0]).toMatchObject({ state: 'offline', offlineSince: NOW - 11 * MIN, changedAt: NOW });
    });

    it('keeps a worker online while heartbeats arrive, even without shares', () => {
        const known = [row({ worker: 'bitaxe1', lastSeen: NOW - 30 * MIN })];
        const result = evaluateAddress(ADDRESS, [{ clientName: 'bitaxe1', userAgent: 'BitAxe', updatedAt: new Date(NOW - MIN) }], known, NOW, TEN);
        expect(result.transitions).toEqual([]);
        expect(result.rows).toEqual([{ ...known[0], lastSeen: NOW - MIN }]);
    });

    it('does not report a worker that was already offline again', () => {
        const known = [row({ worker: 'bitaxe1', state: 'offline', lastSeen: NOW - 60 * MIN, offlineSince: NOW - 60 * MIN })];
        const result = evaluateAddress(ADDRESS, [], known, NOW, TEN);
        expect(result.transitions).toEqual([]);
        expect(result.rows).toEqual([]);
    });

    it('reports the return with the time the worker was away', () => {
        const known = [row({ worker: 'bitaxe1', state: 'offline', lastSeen: NOW - 60 * MIN, offlineSince: NOW - 60 * MIN })];
        const result = evaluateAddress(ADDRESS, [{ clientName: 'bitaxe1', userAgent: 'BitAxe', updatedAt: new Date(NOW - MIN) }], known, NOW, TEN);
        expect(result.transitions).toEqual([{ kind: 'online', worker: 'bitaxe1', userAgent: 'BitAxe', lastSeen: NOW - MIN, awayMs: 59 * MIN }]);
        expect(result.rows[0]).toMatchObject({ state: 'online', offlineSince: null, lastSeen: NOW - MIN, changedAt: NOW });
    });

    it('announces a new worker of a known address and stays quiet about one that is already stale', () => {
        const known = [row({ worker: 'bitaxe1' })];
        const result = evaluateAddress(ADDRESS, [
            { clientName: 'bitaxe1', userAgent: 'BitAxe', updatedAt: new Date(NOW - MIN) },
            { clientName: 'bitaxe2', userAgent: 'BitAxe Gamma', updatedAt: new Date(NOW - 2 * MIN) },
            { clientName: 'old', userAgent: 'NerdMiner', updatedAt: new Date(NOW - 20 * 60 * MIN) },
        ], known, NOW, TEN);
        expect(result.transitions).toEqual([{ kind: 'new', worker: 'bitaxe2', userAgent: 'BitAxe Gamma', lastSeen: NOW - 2 * MIN }]);
        expect(result.rows.map(r => [r.worker, r.state])).toEqual([['bitaxe2', 'online'], ['old', 'offline']]);
    });

    it('keeps the last known user agent when the sessions have none', () => {
        const known = [row({ worker: 'bitaxe1', userAgent: 'BitAxe', lastSeen: NOW - 15 * MIN })];
        const result = evaluateAddress(ADDRESS, [{ clientName: 'bitaxe1', userAgent: null, updatedAt: new Date(NOW - 15 * MIN) }], known, NOW, TEN);
        expect(result.transitions[0]).toMatchObject({ kind: 'offline', userAgent: 'BitAxe' });
    });
});

describe('messages', () => {
    it('puts every change of an address into one message with the dashboard link', () => {
        const text = composeAlert(ADDRESS, [
            { kind: 'offline', worker: 'bitaxe1', userAgent: 'BitAxe', lastSeen: NOW - 12 * MIN },
            { kind: 'online', worker: 'nerd', userAgent: null, lastSeen: NOW - MIN, awayMs: 125 * MIN },
            { kind: 'new', worker: '', userAgent: 'Antminer', lastSeen: NOW },
        ], NOW, 'https://pool.test/d/' + ADDRESS);
        expect(text.split('\n')).toEqual([
            '🔌 bitaxe1 (BitAxe) is offline, nothing from the device for 12 min.',
            '✅ nerd is back online after 2 h 5 min.',
            '🟢 New device online: (no worker name) (Antminer).',
            `bc1qexam…000000 · https://pool.test/d/${ADDRESS}`,
        ]);
    });

    it('lists the workers of an address for /status', () => {
        const text = composeStatus(ADDRESS, [
            { clientName: 'bitaxe1', userAgent: 'BitAxe', updatedAt: new Date(NOW - MIN) },
            { clientName: 'nerd', userAgent: 'NerdMiner', updatedAt: new Date(NOW - 3 * 60 * MIN) },
        ], NOW, TEN, false);
        expect(text.split('\n')).toEqual([
            'bc1qexam…000000 · offline alerts off',
            '  ✅ bitaxe1 (BitAxe) online',
            '  🔌 nerd (NerdMiner) offline, last seen 3 h ago',
        ]);
        expect(composeStatus(ADDRESS, [], NOW, TEN, true)).toContain('no device seen');
    });

    it('formats durations in minutes, hours and days', () => {
        expect(formatDuration(20_000)).toBe('1 min');
        expect(formatDuration(12 * MIN)).toBe('12 min');
        expect(formatDuration(60 * MIN)).toBe('1 h');
        expect(formatDuration(125 * MIN)).toBe('2 h 5 min');
        expect(formatDuration(49 * 60 * MIN)).toBe('2 d 1 h');
        expect(formatDuration(72 * 60 * MIN)).toBe('3 d');
    });
});

describe('configuration and commands', () => {
    it('reads OFFLINE_ALERT_MINUTES with a default and an off switch', () => {
        expect(offlineAfterMinutes(undefined)).toBe(10);
        expect(offlineAfterMinutes('')).toBe(10);
        expect(offlineAfterMinutes('15')).toBe(15);
        expect(offlineAfterMinutes('0')).toBe(0);
        expect(offlineAfterMinutes('soon')).toBe(0);
    });

    it('parses bot commands, with the bot name suffix used in groups', () => {
        expect(parseCommand('/offline@NerdPoolBot off bc1qabc')).toEqual({ name: 'offline', args: ['off', 'bc1qabc'] });
        expect(parseCommand('  /Status ')).toEqual({ name: 'status', args: [] });
        expect(parseCommand('hello')).toBeNull();
        expect(parseCommand(undefined)).toBeNull();
    });
});
