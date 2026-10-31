import { Injectable } from '@nestjs/common';
import axios, { AxiosInstance } from 'axios';
import * as dns from 'node:dns';
import * as https from 'node:https';

import { WebhooksService } from '../ORM/webhooks/webhooks.service';
import { buildWebhookRequest, isPrivateIp, WebhookEvent, WebhookKind } from '../utils/webhook-targets';

/** DNS lookup for the HTTPS agent that refuses names resolving to private or loopback addresses (SSRF). */
function guardedLookup(hostname: string, options: any, callback: any): void {
    const done = typeof options === 'function' ? options : callback;
    const opts = typeof options === 'function' ? {} : (options ?? {});
    dns.lookup(hostname, { ...opts, all: true }, (error, addresses: any) => {
        if (error) {
            return done(error);
        }
        const list = addresses as { address: string; family: number }[];
        if (list.length === 0 || list.some(entry => isPrivateIp(entry.address))) {
            return done(new Error(`${hostname} ist keine öffentliche Adresse`));
        }
        if (opts.all) {
            return done(null, list);
        }
        done(null, list[0].address, list[0].family);
    });
}

export type OutgoingEvent = Omit<WebhookEvent, 'address' | 'time'>;

/**
 * Delivers pool events to the webhooks of an address: ntfy topics, Discord webhooks and JSON endpoints.
 * Targets are https only, redirects are not followed and private addresses are refused at DNS level.
 */
@Injectable()
export class WebhookService {

    private readonly http: AxiosInstance;

    constructor(private readonly webhooksService: WebhooksService) {
        this.http = axios.create({
            timeout: 10_000,
            maxRedirects: 0,
            maxContentLength: 64 * 1024,
            httpsAgent: new https.Agent({ keepAlive: false, lookup: guardedLookup as any }),
        });
    }

    /** Sends the event to every switched on target of the address, returns how many accepted it. */
    public async deliver(address: string, event: OutgoingEvent): Promise<number> {
        const hooks = (await this.webhooksService.forAddress(address)).filter(hook => hook.enabled);
        let delivered = 0;
        for (const hook of hooks) {
            const result = await this.send(hook.kind, hook.url, { ...event, address, time: new Date().toISOString() });
            await this.webhooksService.recordResult(hook.id, result.ok, result.error);
            if (result.ok) {
                delivered++;
            } else {
                console.error(`Webhook ${hook.kind} for ${address} failed: ${result.error}`);
            }
        }
        return delivered;
    }

    /** One delivery to a target that need not be stored (the "test" button). */
    public async send(kind: WebhookKind, url: string, event: WebhookEvent): Promise<{ ok: boolean; error?: string }> {
        try {
            const request = buildWebhookRequest(kind, url, event);
            await this.http.post(request.url, request.body, { headers: request.headers });
            return { ok: true };
        } catch (e) {
            const status: number | undefined = e?.response?.status;
            const detail = e?.response?.data?.message ?? e?.response?.data?.error ?? e?.response?.data?.code;
            const message = status != null
                ? `HTTP ${status}${detail != null ? `: ${String(detail)}` : ''}`
                : (e?.message ?? String(e));
            return { ok: false, error: `${message}`.slice(0, 200) };
        }
    }
}
