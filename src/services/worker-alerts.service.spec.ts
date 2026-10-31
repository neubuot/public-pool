import { PresenceRow, WorkerSession, WorkerTransition } from '../utils/worker-presence';
import { WorkerAlertsService } from './worker-alerts.service';

const MIN = 60_000;
const ADDRESS = 'bc1qexampleaddress0000000000000000000000000';

interface Options {
    minutes?: string;
    addresses?: string[];
    webhookAddresses?: string[];
}

/** the service with in-memory stand-ins for the database and the notification channels */
function build(options: Options = {}) {
    const sessions = new Map<string, WorkerSession[]>();
    const presence = new Map<string, PresenceRow[]>();
    const sent: { address: string; text: string; transitions: WorkerTransition[] }[] = [];
    const service = new WorkerAlertsService(
        { get: (key: string) => key === 'OFFLINE_ALERT_MINUTES' ? options.minutes : undefined } as any,
        { getByAddressWithDeleted: async (address: string) => sessions.get(address) ?? [] } as any,
        { addressesWithOfflineAlerts: async () => options.addresses ?? [ADDRESS] } as any,
        { addresses: async () => options.webhookAddresses ?? [] } as any,
        {
            forAddress: async (address: string) => [...(presence.get(address) ?? [])],
            save: async (rows: PresenceRow[]) => {
                for (const row of rows) {
                    const list = (presence.get(row.address) ?? []).filter(r => r.worker !== row.worker);
                    presence.set(row.address, [...list, row]);
                }
            },
            deleteNotSeenSince: async () => 0,
        } as any,
        {
            publicUrl: () => 'https://pool.test',
            workerAlert: async (address: string, text: string, transitions: WorkerTransition[]) => { sent.push({ address, text, transitions }); return 2; },
        } as any,
    );
    return { service, sessions, presence, sent };
}

describe('WorkerAlertsService', () => {
    it('stays quiet right after a start, while the miners reconnect', async () => {
        const { service, sessions, sent } = build();
        const start = Date.now();
        sessions.set(ADDRESS, [{ clientName: 'bitaxe1', updatedAt: new Date(start - 30 * MIN) }]);
        expect(await service.check(start + 2 * MIN)).toBe(0);
        expect(sent).toEqual([]);
    });

    it('does nothing when switched off', async () => {
        const off = build({ minutes: '0' });
        expect(off.service.enabled).toBe(false);
        expect(await off.service.check(Date.now() + 60 * MIN)).toBe(0);
    });

    it('reports a worker going offline and its return once', async () => {
        const { service, sessions, sent } = build();
        let now = Date.now() + 11 * MIN;
        sessions.set(ADDRESS, [{ clientName: 'bitaxe1', userAgent: 'BitAxe', updatedAt: new Date(now - MIN) }]);

        // first run only records the state
        expect(await service.check(now)).toBe(0);

        now += 5 * MIN;
        expect(await service.check(now)).toBe(0);

        now += 7 * MIN;
        expect(await service.check(now)).toBe(2);
        expect(sent).toHaveLength(1);
        expect(sent[0].address).toBe(ADDRESS);
        expect(sent[0].text).toContain('bitaxe1 (BitAxe) is offline, nothing from the device for 13 min.');
        expect(sent[0].text).toContain(`https://pool.test/d/${ADDRESS}`);
        expect(sent[0].transitions.map(t => t.kind)).toEqual(['offline']);

        // still offline: no repeat
        now += 10 * MIN;
        expect(await service.check(now)).toBe(0);

        // back: away from the last sign of life (now - 23 min) until the new session (now - 1 min)
        sessions.set(ADDRESS, [
            { clientName: 'bitaxe1', userAgent: 'BitAxe', updatedAt: new Date(now - 30 * MIN) },
            { clientName: 'bitaxe1', userAgent: 'BitAxe', updatedAt: new Date(now - MIN) },
        ]);
        expect(await service.check(now)).toBe(2);
        expect(sent[1].text).toContain('bitaxe1 (BitAxe) is back online after 22 min.');
        expect(sent).toHaveLength(2);
    });

    it('watches addresses that only have webhooks and keeps going when one address fails', async () => {
        const { service, sessions, sent } = build({ addresses: ['broken'], webhookAddresses: [ADDRESS] });
        const now = Date.now() + 11 * MIN;
        sessions.set(ADDRESS, [{ clientName: 'bitaxe1', updatedAt: new Date(now - MIN) }]);
        (service as any).clientService.getByAddressWithDeleted = async (address: string) => {
            if (address === 'broken') {
                throw new Error('database locked');
            }
            return sessions.get(address) ?? [];
        };
        const errors = jest.spyOn(console, 'error').mockImplementation(() => undefined);
        await service.check(now);
        expect(await service.check(now + 12 * MIN)).toBe(2);
        expect(sent).toHaveLength(1);
        expect(sent[0].text).toContain('bitaxe1 is offline');
        expect(errors).toHaveBeenCalledTimes(2);
        errors.mockRestore();
    });
});
