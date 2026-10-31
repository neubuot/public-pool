import { monthRanges } from './months';

describe('monthRanges', () => {
    it('gives the UTC month of a point in time and the month before, across a year boundary too', () => {
        const october = monthRanges(Date.UTC(2026, 9, 31, 23, 30));
        expect(october.current).toEqual({ key: '2026-10', fromMs: Date.UTC(2026, 9, 1), toMs: Date.UTC(2026, 10, 1) });
        expect(october.previous).toEqual({ key: '2026-09', fromMs: Date.UTC(2026, 8, 1), toMs: Date.UTC(2026, 9, 1) });

        const january = monthRanges(Date.UTC(2027, 0, 1, 0, 0, 1));
        expect(january.current.key).toBe('2027-01');
        expect(january.previous).toEqual({ key: '2026-12', fromMs: Date.UTC(2026, 11, 1), toMs: Date.UTC(2027, 0, 1) });
    });
});
