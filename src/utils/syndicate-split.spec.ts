import { splitReward } from './syndicate-split';

describe('splitReward', () => {
    const reward = 1_250_000_000; // 12.5 DOI
    const options = { minPayout: 100_000, maxMembers: 250 };

    it('pays the whole reward to a single member', () => {
        const payouts = splitReward([{ address: 'a', work: 5 }], reward, options);
        expect(payouts).toEqual([{ address: 'a', work: 5, percent: 1, amount: reward }]);
    });

    it('splits in proportion to the work and gives rounding dust to the largest member', () => {
        const payouts = splitReward([{ address: 'a', work: 2 }, { address: 'b', work: 1 }], 1000, options);
        expect(payouts.map(p => p.address)).toEqual(['a', 'b']);
        expect(payouts[0].amount + payouts[1].amount).toBe(1000);
        expect(payouts[1].amount).toBe(333);
        expect(payouts[0].amount).toBe(667);
        expect(payouts[0].percent).toBeCloseTo(2 / 3);
    });

    it('merges repeated addresses and ignores members without work', () => {
        const payouts = splitReward([{ address: 'a', work: 1 }, { address: 'a', work: 1 }, { address: 'b', work: 0 }, { address: 'c', work: NaN }], 1000, options);
        expect(payouts).toEqual([{ address: 'a', work: 2, percent: 1, amount: 1000 }]);
    });

    it('drops members below the minimum payout and splits again', () => {
        const payouts = splitReward([{ address: 'a', work: 999_999 }, { address: 'b', work: 1 }], reward, options);
        expect(payouts.map(p => p.address)).toEqual(['a']);
        expect(payouts[0].amount).toBe(reward);
    });

    it('keeps at most the configured number of members, largest first', () => {
        const weights = Array.from({ length: 10 }, (_, i) => ({ address: `m${i}`, work: i + 1 }));
        const payouts = splitReward(weights, reward, { minPayout: 0, maxMembers: 3 });
        expect(payouts.map(p => p.address)).toEqual(['m9', 'm8', 'm7']);
        expect(payouts.reduce((acc, p) => acc + p.amount, 0)).toBe(reward);
    });

    it('falls back to the largest member when nobody reaches the minimum', () => {
        const payouts = splitReward([{ address: 'a', work: 1 }, { address: 'b', work: 1 }], 100, { minPayout: 60, maxMembers: 10 });
        expect(payouts).toEqual([{ address: 'a', work: 1, percent: 1, amount: 100 }]);
    });

    it('returns nothing without reward or members', () => {
        expect(splitReward([{ address: 'a', work: 1 }], 0, options)).toEqual([]);
        expect(splitReward([], reward, options)).toEqual([]);
    });

    it('always pays out the full reward with many members', () => {
        const weights = Array.from({ length: 120 }, (_, i) => ({ address: `m${i}`, work: 1 + (i * 7919) % 97 }));
        const payouts = splitReward(weights, reward, options);
        expect(payouts.length).toBe(120);
        expect(payouts.reduce((acc, p) => acc + p.amount, 0)).toBe(reward);
        expect(payouts.every(p => p.amount >= options.minPayout)).toBe(true);
        expect(Math.abs(payouts.reduce((acc, p) => acc + p.percent, 0) - 1)).toBeLessThan(1e-9);
    });
});
