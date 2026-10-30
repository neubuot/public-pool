import { PoolEvent, PoolEventsService } from './pool-events.service';

describe('PoolEventsService', () => {
    it('delivers events to subscribers with a timestamp', () => {
        const service = new PoolEventsService();
        const received: PoolEvent[] = [];
        service.stream$.subscribe(e => received.push(e));
        service.emit({ type: 'share', address: 'bc1qa', worker: 'w1', data: { difficulty: 100 } });
        expect(received).toHaveLength(1);
        expect(received[0].type).toBe('share');
        expect(typeof received[0].t).toBe('number');
    });

    it('keeps recent events and filters them by address, pool wide ones included', () => {
        const service = new PoolEventsService();
        service.emit({ type: 'tip', chain: 'DOI', data: { height: 1 } });
        service.emit({ type: 'share', address: 'bc1qa', worker: 'a' });
        service.emit({ type: 'share', address: 'bc1qb', worker: 'b' });
        expect(service.recent()).toHaveLength(3);
        const forA = service.recent('bc1qa');
        expect(forA.map(e => e.type)).toEqual(['tip', 'share']);
        expect(forA[1].worker).toBe('a');
    });

    it('caps the buffer', () => {
        const service = new PoolEventsService();
        for (let i = 0; i < 1000; i++) {
            service.emit({ type: 'share', address: 'bc1qa', worker: `w${i}` });
        }
        const all = service.recent(undefined, 10_000);
        expect(all.length).toBeLessThanOrEqual(400);
        expect(all[all.length - 1].worker).toBe('w999');
    });
});
