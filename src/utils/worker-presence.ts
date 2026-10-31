/**
 * Offline alerts: which workers of an address are alive, which state changes to report and how to word them.
 * Pure functions, no database and no Telegram, so they can be tested on their own.
 */

export const DEFAULT_OFFLINE_MINUTES = 10;

/** the fields of a stratum session (client_entity row) the alerts look at */
export interface WorkerSession {
    clientName: string;
    userAgent?: string | null;
    updatedAt?: Date | string | number | null;
    createdAt?: Date | string | number | null;
    startTime?: Date | string | number | null;
}

/** what the subscribers were last told about one worker (worker_presence_entity row) */
export interface PresenceRow {
    address: string;
    worker: string;
    userAgent: string | null;
    lastSeen: number;
    state: 'online' | 'offline';
    offlineSince: number | null;
    changedAt: number;
}

export interface WorkerSummary {
    worker: string;
    userAgent: string | null;
    /** unix time in milliseconds of the last heartbeat or share */
    lastSeen: number;
}

export interface WorkerTransition {
    kind: 'offline' | 'online' | 'new';
    worker: string;
    userAgent: string | null;
    lastSeen: number;
    /** how long the worker was away, for 'online' */
    awayMs?: number;
}

/** OFFLINE_ALERT_MINUTES as minutes, the default when unset, 0 when disabled or not a number */
export function offlineAfterMinutes(configured: unknown): number {
    if (configured == null || `${configured}`.trim() === '') {
        return DEFAULT_OFFLINE_MINUTES;
    }
    const minutes = Number(configured);
    return Number.isFinite(minutes) && minutes > 0 ? minutes : 0;
}

/** Dates arrive from SQLite as strings (DateTimeTransformer hands them through), from code as Date objects. */
export function toMs(value: Date | string | number | null | undefined): number | null {
    if (value == null) {
        return null;
    }
    const ms = value instanceof Date ? value.getTime() : typeof value === 'number' ? value : new Date(value).getTime();
    return Number.isFinite(ms) ? ms : null;
}

/** One entry per worker name with the latest sign of life over all its sessions, ended ones included. */
export function summarizeSessions(sessions: WorkerSession[]): WorkerSummary[] {
    const byWorker = new Map<string, WorkerSummary>();
    for (const session of sessions) {
        const worker = session.clientName ?? '';
        const lastSeen = toMs(session.updatedAt) ?? toMs(session.createdAt) ?? toMs(session.startTime);
        if (lastSeen == null) {
            continue;
        }
        const current = byWorker.get(worker);
        if (current == null || lastSeen > current.lastSeen) {
            byWorker.set(worker, { worker, userAgent: session.userAgent ?? current?.userAgent ?? null, lastSeen });
        }
    }
    return [...byWorker.values()].sort((a, b) => a.worker.localeCompare(b.worker));
}

/**
 * Compares the sessions of one address with what the subscribers were last told. Returns the rows to store and
 * the changes to report. The first run for an address only records the current state: nobody wants a message
 * for every device that was already running when they subscribed.
 */
export function evaluateAddress(address: string, sessions: WorkerSession[], known: PresenceRow[], now: number, offlineAfterMs: number): { rows: PresenceRow[]; transitions: WorkerTransition[] } {
    const seen = new Map(summarizeSessions(sessions).map(summary => [summary.worker, summary]));
    const knownByWorker = new Map(known.map(row => [row.worker, row]));
    const seeding = known.length === 0;
    const rows: PresenceRow[] = [];
    const transitions: WorkerTransition[] = [];

    for (const worker of new Set([...knownByWorker.keys(), ...seen.keys()])) {
        const row = knownByWorker.get(worker);
        const fresh = seen.get(worker);
        const lastSeen = Math.max(row?.lastSeen ?? 0, fresh?.lastSeen ?? 0);
        if (lastSeen === 0) {
            continue;
        }
        const userAgent = fresh?.userAgent ?? row?.userAgent ?? null;
        const alive = now - lastSeen < offlineAfterMs;

        if (row == null) {
            rows.push({ address, worker, userAgent, lastSeen, state: alive ? 'online' : 'offline', offlineSince: alive ? null : lastSeen, changedAt: now });
            if (!seeding && alive) {
                transitions.push({ kind: 'new', worker, userAgent, lastSeen });
            }
            continue;
        }
        if (row.state === 'online' && !alive) {
            rows.push({ ...row, userAgent, lastSeen, state: 'offline', offlineSince: lastSeen, changedAt: now });
            transitions.push({ kind: 'offline', worker, userAgent, lastSeen });
        } else if (row.state === 'offline' && alive) {
            rows.push({ ...row, userAgent, lastSeen, state: 'online', offlineSince: null, changedAt: now });
            transitions.push({ kind: 'online', worker, userAgent, lastSeen, awayMs: Math.max(0, lastSeen - (row.offlineSince ?? row.lastSeen)) });
        } else if (lastSeen !== row.lastSeen || userAgent !== row.userAgent) {
            rows.push({ ...row, userAgent, lastSeen });
        }
    }
    return { rows, transitions };
}

export function formatDuration(ms: number): string {
    const minutes = Math.round(Math.max(0, ms) / 60_000);
    if (minutes < 60) {
        return `${Math.max(1, minutes)} min`;
    }
    const hours = Math.floor(minutes / 60);
    if (hours < 48) {
        const rest = minutes % 60;
        return rest > 0 ? `${hours} h ${rest} min` : `${hours} h`;
    }
    const days = Math.floor(hours / 24);
    const restHours = hours % 24;
    return restHours > 0 ? `${days} d ${restHours} h` : `${days} d`;
}

export function shortAddress(address: string): string {
    return address.length > 16 ? `${address.slice(0, 8)}…${address.slice(-6)}` : address;
}

function deviceLabel(worker: string, userAgent: string | null): string {
    const name = worker.length > 0 ? worker : '(no worker name)';
    return userAgent ? `${name} (${userAgent})` : name;
}

/** One Telegram message for all changes of an address found in one run. */
export function composeAlert(address: string, transitions: WorkerTransition[], now: number, dashboardUrl: string): string {
    const lines = transitions.map(transition => {
        const device = deviceLabel(transition.worker, transition.userAgent);
        switch (transition.kind) {
            case 'offline':
                return `🔌 ${device} is offline, nothing from the device for ${formatDuration(now - transition.lastSeen)}.`;
            case 'online':
                return `✅ ${device} is back online after ${formatDuration(transition.awayMs ?? 0)}.`;
            case 'new':
                return `🟢 New device online: ${device}.`;
        }
    });
    return `${lines.join('\n')}\n${shortAddress(address)} · ${dashboardUrl}`;
}

/** The /status reply for one address, from the live sessions. */
export function composeStatus(address: string, sessions: WorkerSession[], now: number, offlineAfterMs: number, offlineAlerts: boolean): string {
    const header = `${shortAddress(address)} · offline alerts ${offlineAlerts ? 'on' : 'off'}`;
    const workers = summarizeSessions(sessions);
    if (workers.length === 0) {
        return `${header}\n  no device seen in the last 24 hours`;
    }
    const lines = workers.map(summary => {
        const alive = now - summary.lastSeen < offlineAfterMs;
        const device = deviceLabel(summary.worker, summary.userAgent);
        return alive ? `  ✅ ${device} online` : `  🔌 ${device} offline, last seen ${formatDuration(now - summary.lastSeen)} ago`;
    });
    return [header, ...lines].join('\n');
}

export interface BotCommand {
    name: string;
    args: string[];
}

/** "/offline@NerdPoolBot off bc1q..." gives { name: 'offline', args: ['off', 'bc1q...'] }, null for ordinary text */
export function parseCommand(text: string | null | undefined): BotCommand | null {
    const trimmed = (text ?? '').trim();
    if (!trimmed.startsWith('/')) {
        return null;
    }
    const [first, ...args] = trimmed.split(/\s+/);
    return { name: first.slice(1).replace(/@.*$/, '').toLowerCase(), args };
}
