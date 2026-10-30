import { ChainStatsService } from './chain-stats.service';

describe('ChainStatsService.oddsFor', () => {
    const service = new ChainStatsService(null, null, null, null, null, null, null, null, null);

    it('turns hash rate and difficulty into a mean time and probabilities', () => {
        const odds = service.oddsFor(1.2e12, 10e9);
        // difficulty * 2^32 / hashrate
        expect(odds.expectedSeconds).toBeCloseTo(10e9 * 4294967296 / 1.2e12, -3);
        expect(odds.expectedSeconds / 86400).toBeCloseTo(414.3, 0);
        expect(odds.perDay).toBeGreaterThan(0.002);
        expect(odds.perDay).toBeLessThan(0.003);
        expect(odds.perYear).toBeGreaterThan(0.58);
        expect(odds.perYear).toBeLessThan(0.59);
    });

    it('answers nulls without a hash rate or difficulty', () => {
        expect(service.oddsFor(0, 10e9).expectedSeconds).toBeNull();
        expect(service.oddsFor(1e12, null).perYear).toBeNull();
        expect(service.oddsFor(null, 5).perDay).toBeNull();
    });

    it('never exceeds a probability of one', () => {
        const odds = service.oddsFor(1e18, 1);
        expect(odds.perHour).toBeLessThanOrEqual(1);
        expect(odds.perYear).toBeLessThanOrEqual(1);
    });
});
