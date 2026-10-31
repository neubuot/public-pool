import { isIP } from 'node:net';

/**
 * Webhooks: ntfy topics, Discord webhooks and plain JSON endpoints as an alternative to the Telegram bot.
 * Pure helpers for validation, masking and building the HTTP request, tested on their own.
 */

export type WebhookKind = 'ntfy' | 'discord' | 'json';
export const WEBHOOK_KINDS: WebhookKind[] = ['ntfy', 'discord', 'json'];
export const MAX_WEBHOOKS_PER_ADDRESS = 3;
/** a target is switched off after this many deliveries in a row failed */
export const DISABLE_AFTER_FAILURES = 10;

export type WebhookEventName = 'test' | 'block.found' | 'worker.offline' | 'worker.online' | 'share.record';

export interface WebhookEvent {
    event: WebhookEventName;
    address: string;
    title: string;
    text: string;
    /** a link worth opening: the dashboard, the explorer or the share card */
    url?: string;
    /** an image worth attaching: the share card PNG */
    image?: string;
    data?: Record<string, unknown>;
    /** ISO 8601 */
    time: string;
}

export interface WebhookRequest {
    url: string;
    headers: Record<string, string>;
    body: string;
}

/** 0/8, 10/8, 100.64/10, 127/8, 169.254/16, 172.16/12, 192.168/16, ::, ::1, fc00::/7, fe80::/10 and IPv4 mapped forms */
export function isPrivateIp(ip: string): boolean {
    const v4 = ip.match(/^(?:::ffff:)?(\d+)\.(\d+)\.(\d+)\.(\d+)$/i);
    if (v4 != null) {
        const a = Number(v4[1]);
        const b = Number(v4[2]);
        return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
            || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
    }
    const lower = ip.toLowerCase();
    if (lower === '::1' || lower === '::') {
        return true;
    }
    const first = parseInt(lower.split(':')[0] || '0', 16);
    return (first & 0xfe00) === 0xfc00 || (first & 0xffc0) === 0xfe80;
}

/** https only, a public host name or address, no credentials in the URL, at most 512 characters */
export function validateWebhookUrl(raw: unknown): { ok: true; url: URL } | { ok: false; reason: string } {
    if (typeof raw !== 'string' || raw.trim().length === 0) {
        return { ok: false, reason: 'URL fehlt' };
    }
    if (raw.length > 512) {
        return { ok: false, reason: 'URL zu lang (höchstens 512 Zeichen)' };
    }
    let url: URL;
    try {
        url = new URL(raw.trim());
    } catch {
        return { ok: false, reason: 'keine gültige URL' };
    }
    if (url.protocol !== 'https:') {
        return { ok: false, reason: 'nur https-Adressen' };
    }
    if (url.username.length > 0 || url.password.length > 0) {
        return { ok: false, reason: 'keine Zugangsdaten in der URL' };
    }
    const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    const literal = isIP(host) !== 0;
    if (literal ? isPrivateIp(host) : (host === 'localhost' || !host.includes('.') || /\.(localhost|local|internal|lan|home|arpa)$/.test(host))) {
        return { ok: false, reason: 'nur öffentlich erreichbare Hosts' };
    }
    return { ok: true, url };
}

/** "https://ntfy.sh/mein-thema" publishes as JSON to "https://ntfy.sh/" with topic "mein-thema" (keeps UTF-8 titles intact) */
export function ntfyTarget(url: URL): { publishUrl: string; topic: string } | null {
    const parts = url.pathname.split('/').filter(part => part.length > 0);
    if (parts.length === 0) {
        return null;
    }
    const topic = parts[parts.length - 1];
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(topic)) {
        return null;
    }
    const base = `${url.origin}/${parts.slice(0, -1).join('/')}`.replace(/\/+$/, '');
    return { publishUrl: `${base}/`, topic };
}

/** the host stays readable, the path (topic, token) is mostly hidden */
export function maskUrl(raw: string): string {
    try {
        const url = new URL(raw);
        const path = url.pathname.length > 1 ? url.pathname : '';
        const shown = path.length <= 4 ? path : `${path.slice(0, 4)}…${path.slice(-2)}`;
        return `${url.protocol}//${url.host}${shown}${url.search.length > 0 ? '?…' : ''}`;
    } catch {
        return '…';
    }
}

function tagFor(event: WebhookEventName): string {
    switch (event) {
        case 'block.found': return 'pick';
        case 'worker.offline': return 'electric_plug';
        case 'worker.online': return 'white_check_mark';
        case 'share.record': return 'trophy';
        default: return 'bell';
    }
}

export function buildWebhookRequest(kind: WebhookKind, rawUrl: string, event: WebhookEvent): WebhookRequest {
    const headers: Record<string, string> = { 'User-Agent': 'NerdPool-Webhook/1', 'Content-Type': 'application/json', 'X-NerdPool-Event': event.event };
    if (kind === 'ntfy') {
        const target = ntfyTarget(new URL(rawUrl));
        if (target == null) {
            throw new Error('ntfy-URL braucht ein Thema am Ende, zum Beispiel https://ntfy.sh/mein-thema');
        }
        const payload: Record<string, unknown> = { topic: target.topic, title: event.title, message: event.text, tags: [tagFor(event.event)] };
        if (event.url) {
            payload.click = event.url;
        }
        if (event.image) {
            payload.attach = event.image;
        }
        if (event.event === 'worker.offline') {
            payload.priority = 4;
        }
        return { url: target.publishUrl, headers, body: JSON.stringify(payload) };
    }
    if (kind === 'discord') {
        const content = `**${event.title}**\n${event.text}${event.url ? `\n${event.url}` : ''}`.slice(0, 1900);
        const payload: Record<string, unknown> = { username: 'NerdPool', content };
        if (event.image) {
            payload.embeds = [{ image: { url: event.image } }];
        }
        return { url: rawUrl, headers, body: JSON.stringify(payload) };
    }
    return { url: rawUrl, headers, body: JSON.stringify(event) };
}
