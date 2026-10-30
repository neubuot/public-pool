// Zahlen, Einheiten und Zeiten in der aktiven Sprache.
import { lang, locale, t } from './i18n.svelte';

const UNITS = ['', 'k', 'M', 'G', 'T', 'P', 'E', 'Z'];

export function fmtNum(value: number | null | undefined, digits = 0): string {
    if (value == null || !Number.isFinite(value)) {
        return t('common.na');
    }
    return new Intl.NumberFormat(locale(), { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(value);
}

export function fmtInt(value: number | null | undefined): string {
    return fmtNum(value, 0);
}

/** 1234567 → "1,23 M" (SI prefixes, three significant digits) */
export function fmtSi(value: number | null | undefined, digits = 2, unit = ''): string {
    if (value == null || !Number.isFinite(value)) {
        return t('common.na');
    }
    if (value === 0) {
        return `0${unit ? ' ' + unit : ''}`;
    }
    const abs = Math.abs(value);
    let index = 0;
    let scaled = abs;
    while (scaled >= 1000 && index < UNITS.length - 1) {
        scaled /= 1000;
        index++;
    }
    const fraction = scaled >= 100 ? Math.max(0, digits - 2) : scaled >= 10 ? Math.max(0, digits - 1) : digits;
    const text = new Intl.NumberFormat(locale(), { maximumFractionDigits: fraction, minimumFractionDigits: fraction }).format(scaled * Math.sign(value));
    const suffix = UNITS[index] + unit;
    return suffix.length > 0 ? `${text} ${suffix}` : text;
}

export function fmtHashrate(hps: number | null | undefined): string {
    if (hps == null || !Number.isFinite(hps)) {
        return t('common.na');
    }
    return fmtSi(hps, 2, 'H/s');
}

export function fmtDifficulty(difficulty: number | null | undefined): string {
    if (difficulty == null || !Number.isFinite(difficulty)) {
        return t('common.na');
    }
    if (difficulty < 1000) {
        return fmtNum(difficulty, difficulty < 10 ? 3 : 0);
    }
    return fmtSi(difficulty, 3);
}

export function fmtBytes(bytes: number | null | undefined): string {
    if (bytes == null || !Number.isFinite(bytes)) {
        return t('common.na');
    }
    if (bytes < 1024) {
        return `${fmtInt(bytes)} B`;
    }
    if (bytes < 1024 * 1024) {
        return `${fmtNum(bytes / 1024, 1)} kB`;
    }
    return `${fmtNum(bytes / 1024 / 1024, 2)} MB`;
}

export function fmtCoins(value: number | null | undefined, chain: 'BTC' | 'DOI' | string, digits?: number): string {
    if (value == null || !Number.isFinite(value)) {
        return t('common.na');
    }
    const d = digits ?? (chain === 'BTC' ? (value >= 1 ? 4 : 8) : (value >= 100 ? 2 : 4));
    return `${fmtNum(value, d)} ${chain}`;
}

export function fmtPercent(fraction: number | null | undefined, digits = 1): string {
    if (fraction == null || !Number.isFinite(fraction)) {
        return t('common.na');
    }
    const percent = fraction * 100;
    let d = digits;
    if (percent > 0 && percent < 0.01) {
        d = Math.min(7, Math.max(digits, 2 - Math.floor(Math.log10(percent))));
    }
    return `${fmtNum(percent, d)} %`;
}

export function fmtSignedPercent(fraction: number | null | undefined, digits = 1): string {
    if (fraction == null || !Number.isFinite(fraction)) {
        return t('common.na');
    }
    const text = fmtNum(Math.abs(fraction) * 100, digits);
    return `${fraction < 0 ? '-' : '+'}${text} %`;
}

/** seconds → "3 min", "2 h 10 min", "167 Tage", "8.400 Jahre"; dative for "vor 3 Tagen" */
export function fmtDuration(seconds: number | null | undefined, dative = false): string {
    if (seconds == null || !Number.isFinite(seconds)) {
        return t('common.na');
    }
    const de = lang.current === 'de';
    const s = Math.max(0, seconds);
    if (s < 60) {
        return `${Math.round(s)} s`;
    }
    if (s < 3600) {
        return `${Math.round(s / 60)} min`;
    }
    if (s < 86400) {
        const h = Math.floor(s / 3600);
        const m = Math.round((s % 3600) / 60);
        return m > 0 ? `${h} h ${m} min` : `${h} h`;
    }
    const days = s / 86400;
    if (days < 365.25 * 2) {
        const d = Math.round(days);
        if (de) {
            return `${fmtInt(d)} ${d === 1 ? 'Tag' : (dative ? 'Tagen' : 'Tage')}`;
        }
        return `${fmtInt(d)} ${d === 1 ? 'day' : 'days'}`;
    }
    const years = days / 365.25;
    const y = years >= 100 ? Math.round(years) : Math.round(years * 10) / 10;
    const text = fmtNum(y, years >= 100 ? 0 : 1);
    return de ? `${text} ${dative ? 'Jahren' : 'Jahre'}` : `${text} years`;
}

/** unix seconds or ms or ISO → "4 s" since then (the caller wraps with chain.ago: "vor 4 s" / "4 s ago") */
export function fmtAgo(time: number | string | Date | null | undefined, now = Date.now()): string {
    const ms = toMs(time);
    if (ms == null) {
        return t('common.na');
    }
    return fmtDuration((now - ms) / 1000, true);
}

export function toMs(time: number | string | Date | null | undefined): number | null {
    if (time == null) {
        return null;
    }
    if (time instanceof Date) {
        return time.getTime();
    }
    if (typeof time === 'number') {
        return time < 1e12 ? time * 1000 : time;
    }
    const parsed = Date.parse(time);
    return Number.isFinite(parsed) ? parsed : null;
}

export function fmtDate(time: number | string | Date | null | undefined, withSeconds = false): string {
    const ms = toMs(time);
    if (ms == null) {
        return t('common.na');
    }
    return new Intl.DateTimeFormat(locale(), {
        day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
        ...(withSeconds ? { second: '2-digit' } : {})
    }).format(new Date(ms));
}

export function fmtTime(time: number | string | Date | null | undefined, withSeconds = true): string {
    const ms = toMs(time);
    if (ms == null) {
        return t('common.na');
    }
    return new Intl.DateTimeFormat(locale(), { hour: '2-digit', minute: '2-digit', ...(withSeconds ? { second: '2-digit' } : {}) }).format(new Date(ms));
}

export function fmtDayTime(time: number | string | Date | null | undefined): string {
    const ms = toMs(time);
    if (ms == null) {
        return t('common.na');
    }
    return new Intl.DateTimeFormat(locale(), { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(ms));
}

export function shortHash(value: string | null | undefined, head = 6, tail = 5): string {
    if (value == null) {
        return t('common.na');
    }
    if (value.length <= head + tail + 1) {
        return value;
    }
    return `${value.slice(0, head)}…${value.slice(-tail)}`;
}

export function fmtEur(value: number | null | undefined, digits = 2): string {
    if (value == null || !Number.isFinite(value)) {
        return t('common.na');
    }
    return new Intl.NumberFormat(locale(), { style: 'currency', currency: 'EUR', maximumFractionDigits: digits, minimumFractionDigits: digits }).format(value);
}
