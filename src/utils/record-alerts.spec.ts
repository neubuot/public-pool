import { composeRecordText, formatDifficultyEn, formatPercentEn, percentOfTarget, recordMinPercent } from './record-alerts';

describe('record alert helpers', () => {
    it('reads RECORD_ALERT_MIN_PERCENT with default, zero and off', () => {
        expect(recordMinPercent(undefined)).toBe(1);
        expect(recordMinPercent('')).toBe(1);
        expect(recordMinPercent('5')).toBe(5);
        expect(recordMinPercent('0')).toBe(0);
        expect(recordMinPercent('off')).toBeNull();
        expect(recordMinPercent('-1')).toBeNull();
        expect(recordMinPercent('x')).toBeNull();
    });

    it('formats difficulties and percentages in English', () => {
        expect(formatDifficultyEn(3_626_000_000)).toBe('3.63 G');
        expect(formatDifficultyEn(148_400_000_000_000)).toBe('148 T');
        expect(formatDifficultyEn(0)).toBe('–');
        expect(formatPercentEn(43.58)).toBe('43.6 %');
        expect(formatPercentEn(2.345)).toBe('2.35 %');
        expect(formatPercentEn(0.002443)).toBe('0.0024 %');
        expect(formatPercentEn(null)).toBe('–');
        expect(percentOfTarget(3_626_000_000, 8_320_000_000)).toBeCloseTo(43.58, 1);
        expect(percentOfTarget(1, null)).toBeNull();
    });

    it('words the record message with both chains and the previous best', () => {
        const text = composeRecordText(
            { address: 'bc1q', worker: 'bitaxe1', userAgent: 'BitAxe', difficulty: 3_626_000_000, previous: 1_426_000_000, time: 0 },
            8_320_000_000, 148_400_000_000_000
        );
        expect(text.split('\n')).toEqual([
            '🏆 New best share: 3.63 G from bitaxe1 (BitAxe)',
            '43.6 % of a Doichain block · 0.0024 % of a Bitcoin block',
            'Previous best: 1.43 G',
        ]);
        expect(composeRecordText({ address: 'bc1q', worker: 'w', userAgent: null, difficulty: 10, previous: 0, time: 0 }, null, null).split('\n')).toHaveLength(2);
    });
});
