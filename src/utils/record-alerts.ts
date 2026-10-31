/**
 * Best share alerts: when a miner address beats its own best share, subscribers get a message with the share
 * card. Pure helpers: the threshold from the configuration and the wording.
 */

export const DEFAULT_RECORD_MIN_PERCENT = 1;

export interface ShareRecord {
    address: string;
    worker: string;
    userAgent: string | null;
    difficulty: number;
    /** the best share before this one, 0 when there was none */
    previous: number;
    /** unix time in milliseconds */
    time: number;
}

/**
 * RECORD_ALERT_MIN_PERCENT: a new best share is reported once it reaches this share of the Doichain difficulty
 * (default 1 %, 0 reports every new record, "off" switches the alerts off). Returns null when off.
 */
export function recordMinPercent(configured: unknown): number | null {
    if (configured == null || `${configured}`.trim() === '') {
        return DEFAULT_RECORD_MIN_PERCENT;
    }
    const text = `${configured}`.trim().toLowerCase();
    if (text === 'off' || text === 'false' || text === 'no') {
        return null;
    }
    const percent = Number(text);
    return Number.isFinite(percent) && percent >= 0 ? percent : null;
}

/** share difficulty as a percentage of a block's difficulty, null without a target */
export function percentOfTarget(difficulty: number, target: number | null | undefined): number | null {
    if (target == null || !(target > 0) || !(difficulty > 0)) {
        return null;
    }
    return difficulty / target * 100;
}

export function formatDifficultyEn(value: number | null | undefined): string {
    if (value == null || !Number.isFinite(value) || value <= 0) {
        return '–';
    }
    const units = ['', 'k', 'M', 'G', 'T', 'P', 'E'];
    let index = 0;
    let scaled = value;
    while (scaled >= 1000 && index < units.length - 1) {
        scaled /= 1000;
        index++;
    }
    const digits = scaled >= 100 ? 0 : scaled >= 10 ? 1 : 2;
    return `${scaled.toFixed(digits)}${units[index] ? ' ' + units[index] : ''}`;
}

export function formatPercentEn(percent: number | null): string {
    if (percent == null) {
        return '–';
    }
    if (percent >= 10) {
        return `${percent.toFixed(1)} %`;
    }
    if (percent >= 1) {
        return `${percent.toFixed(2)} %`;
    }
    return `${Number(percent.toPrecision(2))} %`;
}

/** The Telegram and webhook text of a new best share. */
export function composeRecordText(record: ShareRecord, doiTarget: number | null, btcTarget: number | null): string {
    const device = record.userAgent ? `${record.worker} (${record.userAgent})` : record.worker;
    const lines = [
        `🏆 New best share: ${formatDifficultyEn(record.difficulty)} from ${device}`,
        `${formatPercentEn(percentOfTarget(record.difficulty, doiTarget))} of a Doichain block · ${formatPercentEn(percentOfTarget(record.difficulty, btcTarget))} of a Bitcoin block`,
    ];
    if (record.previous > 0) {
        lines.push(`Previous best: ${formatDifficultyEn(record.previous)}`);
    }
    return lines.join('\n');
}
