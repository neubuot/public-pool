/** Calendar months in UTC for the monthly closest calls. */

export interface MonthRange {
    /** YYYY-MM */
    key: string;
    fromMs: number;
    /** exclusive */
    toMs: number;
}

export function monthRanges(now: number = Date.now()): { current: MonthRange; previous: MonthRange } {
    const date = new Date(now);
    const year = date.getUTCFullYear();
    const month = date.getUTCMonth();
    const start = Date.UTC(year, month, 1);
    const next = Date.UTC(year, month + 1, 1);
    const previousStart = Date.UTC(year, month - 1, 1);
    const key = (ms: number) => new Date(ms).toISOString().slice(0, 7);
    return {
        current: { key: key(start), fromMs: start, toMs: next },
        previous: { key: key(previousStart), fromMs: previousStart, toMs: start },
    };
}
