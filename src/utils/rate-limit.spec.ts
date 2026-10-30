import { RateLimiter } from './rate-limit';

describe('RateLimiter', () => {
    let now = 1_000_000;
    const realNow = Date.now;

    beforeEach(() => {
        now = 1_000_000;
        Date.now = () => now;
    });

    afterAll(() => {
        Date.now = realNow;
    });

    it('lets a burst up to the capacity through and blocks the next request', () => {
        const limiter = new RateLimiter(3, 1);
        expect(limiter.take('a')).toBe(true);
        expect(limiter.take('a')).toBe(true);
        expect(limiter.take('a')).toBe(true);
        expect(limiter.take('a')).toBe(false);
        // another client has its own bucket
        expect(limiter.take('b')).toBe(true);
    });

    it('refills over time at the configured rate', () => {
        const limiter = new RateLimiter(2, 1);
        expect(limiter.take('a')).toBe(true);
        expect(limiter.take('a')).toBe(true);
        expect(limiter.take('a')).toBe(false);
        now += 1000;
        expect(limiter.take('a')).toBe(true);
        expect(limiter.take('a')).toBe(false);
        now += 10_000;
        // never above the capacity
        expect(limiter.take('a')).toBe(true);
        expect(limiter.take('a')).toBe(true);
        expect(limiter.take('a')).toBe(false);
    });

    it('charges expensive calls more', () => {
        const limiter = new RateLimiter(10, 1);
        expect(limiter.take('a', 6)).toBe(true);
        expect(limiter.take('a', 6)).toBe(false);
        expect(limiter.take('a', 4)).toBe(true);
    });
});
