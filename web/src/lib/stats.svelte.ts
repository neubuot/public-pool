// Gemeinsamer Zustand: Pool-Statistik alle 15 Sekunden, zuletzt genutzte Adresse.
import { api, ApiError, type StatsSnapshot } from './api';

export const stats = $state<{
    data: StatsSnapshot | null;
    error: string | null;
    loading: boolean;
    updatedAt: number;
    latencyMs: number | null;
}>({ data: null, error: null, loading: false, updatedAt: 0, latencyMs: null });

let timer: ReturnType<typeof setInterval> | null = null;

export async function refreshStats() {
    if (stats.loading) {
        return;
    }
    stats.loading = true;
    const started = performance.now();
    try {
        stats.data = await api.stats();
        stats.error = null;
        stats.latencyMs = Math.round(performance.now() - started);
        stats.updatedAt = Date.now();
    } catch (e: any) {
        stats.error = e instanceof ApiError ? e.message : (e?.message ?? 'Fehler');
        if (e instanceof ApiError && e.status === 0) {
            stats.latencyMs = null;
        }
    } finally {
        stats.loading = false;
    }
}

export function startStatsPolling(intervalMs = 15000) {
    if (timer != null) {
        return;
    }
    void refreshStats();
    timer = setInterval(() => {
        if (document.visibilityState === 'visible') {
            void refreshStats();
        }
    }, intervalMs);
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && Date.now() - stats.updatedAt > intervalMs) {
            void refreshStats();
        }
    });
}

const ADDRESS_KEY = 'nerdpool.btcAddress';
const DOI_KEY = 'nerdpool.doiAddress';
const WORKER_KEY = 'nerdpool.worker';

export const saved = $state({
    btcAddress: read(ADDRESS_KEY) ?? '',
    doiAddress: read(DOI_KEY) ?? '',
    worker: read(WORKER_KEY) ?? 'bitaxe1',
});

export function remember(key: 'btcAddress' | 'doiAddress' | 'worker', value: string) {
    saved[key] = value;
    const storageKey = key === 'btcAddress' ? ADDRESS_KEY : key === 'doiAddress' ? DOI_KEY : WORKER_KEY;
    try {
        window.localStorage.setItem(storageKey, value);
    } catch {
        // kein Speicher, egal
    }
}

function read(key: string): string | null {
    try {
        return window.localStorage.getItem(key);
    } catch {
        return null;
    }
}

/** A ticking clock for "vor 4 s" labels (once a second). */
export const clock = $state({ now: Date.now() });
setInterval(() => { clock.now = Date.now(); }, 1000);
