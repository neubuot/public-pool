import { RecordAlertsService } from './record-alerts.service';

const ADDRESS = 'bc1qexampleaddress0000000000000000000000000';
const G = 1_000_000_000;

function build(options: { minPercent?: string; doi?: number | null; photoOk?: boolean; topShares?: { difficulty: number; time: number }[] } = {}) {
    const photos: { chatId: number; image: string; caption: string }[] = [];
    const texts: { chatId: number; text: string }[] = [];
    const hooks: { address: string; event: any }[] = [];
    const service = new RecordAlertsService(
        { get: (key: string) => key === 'RECORD_ALERT_MIN_PERCENT' ? options.minPercent : undefined } as any,
        { current: () => ({ doichain: { difficulty: options.doi === undefined ? 8 * G : options.doi }, bitcoin: { difficulty: 148.4e12 } }) } as any,
        {
            publicUrl: () => 'https://pool.test',
            notifyChatPhoto: async (chatId: number, image: string, caption: string) => { photos.push({ chatId, image, caption }); return options.photoOk ?? true; },
            notifyChat: async (chatId: number, text: string) => { texts.push({ chatId, text }); return true; },
        } as any,
        { deliver: async (address: string, event: any) => { hooks.push({ address, event }); return 1; } } as any,
        { getRecordSubscribers: async () => [{ telegramChatId: 7 }] } as any,
        { forAddress: async () => options.topShares ?? [] } as any,
    );
    return { service, photos, texts, hooks };
}

describe('RecordAlertsService', () => {
    it('ignores records below the threshold and everything when switched off', async () => {
        const { service, photos } = build();
        expect(service.onRecord({ address: ADDRESS, worker: 'w', userAgent: null, difficulty: 0.005 * 8 * G, previous: 0, time: 0 })).toBe(false);
        expect(await service.flush(ADDRESS)).toBe(0);
        expect(photos).toEqual([]);
        const off = build({ minPercent: 'off' });
        expect(off.service.enabled).toBe(false);
        expect(off.service.onRecord({ address: ADDRESS, worker: 'w', userAgent: null, difficulty: 100 * G, previous: 0, time: 0 })).toBe(false);
    });

    it('sends one photo message and one webhook for a burst of records, with the highest of them and the best before the burst', async () => {
        // the top shares at sending time: both records of the burst and the best from before it
        const topShares = [{ difficulty: 3.626 * G, time: 2000 }, { difficulty: 0.2 * G, time: 1000 }, { difficulty: 0.05 * G, time: 500 }];
        const { service, photos, texts, hooks } = build({ topShares });
        expect(service.onRecord({ address: ADDRESS, worker: 'bitaxe1', userAgent: 'BitAxe', difficulty: 0.2 * G, previous: 0, time: 1000 })).toBe(true);
        expect(service.onRecord({ address: ADDRESS, worker: 'bitaxe2', userAgent: 'BitAxe', difficulty: 3.626 * G, previous: 0, time: 2000 })).toBe(true);
        expect(await service.flush(ADDRESS)).toBe(1);
        expect(photos).toHaveLength(1);
        expect(photos[0].chatId).toBe(7);
        expect(photos[0].image).toBe(`https://pool.test/api/share/best/${ADDRESS}?v=3626000000`);
        expect(photos[0].caption).toContain('3.63 G from bitaxe2 (BitAxe)');
        expect(photos[0].caption).toContain('45.3 % of a Doichain block');
        expect(photos[0].caption).toContain('Previous best: 50.0 M');
        expect(photos[0].caption).toContain(`https://pool.test/s/best/${ADDRESS}`);
        expect(texts).toEqual([]);
        expect(hooks).toHaveLength(1);
        expect(hooks[0].event.event).toBe('share.record');
        expect(hooks[0].event.data.difficulty).toBe(3.626 * G);
        expect(hooks[0].event.data.previous).toBe(0.05 * G);
        // nothing left pending
        expect(await service.flush(ADDRESS)).toBe(0);
    });

    it('falls back to a text message when the photo cannot be sent', async () => {
        const { service, photos, texts } = build({ photoOk: false });
        service.onRecord({ address: ADDRESS, worker: 'w', userAgent: null, difficulty: G, previous: 0, time: 0 });
        expect(await service.flush(ADDRESS)).toBe(1);
        expect(photos).toHaveLength(1);
        expect(texts).toHaveLength(1);
    });

    it('reports every record when the threshold is zero, even without a Doichain difficulty', () => {
        const { service } = build({ minPercent: '0', doi: null });
        expect(service.onRecord({ address: ADDRESS, worker: 'w', userAgent: null, difficulty: 1, previous: 0, time: 0 })).toBe(true);
    });
});
