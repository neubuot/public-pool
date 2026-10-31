import { BadRequestException, Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Network, validate } from 'bitcoin-address-validation';

import { WebhookEntity } from '../../ORM/webhooks/webhook.entity';
import { WebhooksService } from '../../ORM/webhooks/webhooks.service';
import { WebhookService } from '../../services/webhook.service';
import { maskUrl, MAX_WEBHOOKS_PER_ADDRESS, ntfyTarget, validateWebhookUrl, WEBHOOK_KINDS, WebhookKind } from '../../utils/webhook-targets';

const ADDRESS_RE = /^[A-Za-z0-9]{20,90}$/;

/**
 * Notification targets of a miner address, managed from "Mein Dashboard". There is no login: whoever knows the
 * address can add or remove targets, and a target only receives what the public dashboard shows anyway.
 */
@Controller('webhooks')
export class WebhooksController {

    constructor(
        private readonly webhooksService: WebhooksService,
        private readonly webhookService: WebhookService,
        private readonly configService: ConfigService,
    ) { }

    @Get(':address')
    public async list(@Param('address') address: string) {
        this.checkAddress(address);
        return this.view(address, await this.webhooksService.forAddress(address));
    }

    @Post(':address')
    public async add(@Param('address') address: string, @Body() body: Record<string, unknown>) {
        this.checkAddress(address);
        const { url, kind } = this.checkTarget(body);
        try {
            await this.webhooksService.add(address, url, kind);
        } catch (e) {
            throw new BadRequestException(e?.message ?? 'Speichern fehlgeschlagen');
        }
        return this.view(address, await this.webhooksService.forAddress(address));
    }

    @Delete(':address/:id')
    public async remove(@Param('address') address: string, @Param('id') idParam: string) {
        this.checkAddress(address);
        const id = parseInt(idParam, 10);
        if (!/^\d{1,12}$/.test(idParam ?? '')) {
            throw new BadRequestException('Keine Kennung');
        }
        const removed = await this.webhooksService.remove(address, id);
        return { removed, ...this.view(address, await this.webhooksService.forAddress(address)) };
    }

    /** Sends a test message to the target without storing it. */
    @Post(':address/test')
    public async test(@Param('address') address: string, @Body() body: Record<string, unknown>) {
        this.checkAddress(address);
        const { url, kind } = this.checkTarget(body);
        const result = await this.webhookService.send(kind, url, {
            event: 'test', address, title: 'NerdPool test', text: `Test message for ${address.slice(0, 8)}…${address.slice(-6)}. Notifications work.`,
            url: `${this.publicUrl()}/d/${address}`, time: new Date().toISOString()
        });
        return { ok: result.ok, error: result.error ?? null };
    }

    private view(address: string, hooks: WebhookEntity[]) {
        return {
            address,
            max: MAX_WEBHOOKS_PER_ADDRESS,
            webhooks: hooks.map(hook => ({
                id: hook.id, kind: hook.kind, url: maskUrl(hook.url), enabled: hook.enabled, failures: hook.failures,
                lastError: hook.lastError ?? null, lastDeliveredAt: hook.lastDeliveredAt ?? null, createdAt: hook.createdAt
            }))
        };
    }

    private checkAddress(address: string) {
        const configured = `${this.configService.get('NETWORK') ?? 'mainnet'}`.toLowerCase();
        const network = configured === 'testnet' ? Network.testnet : configured === 'regtest' ? Network.regtest : Network.mainnet;
        if (!ADDRESS_RE.test(address ?? '') || !validate(address, network)) {
            throw new BadRequestException('Keine gültige Bitcoin-Adresse');
        }
    }

    private checkTarget(body: Record<string, unknown>): { url: string; kind: WebhookKind } {
        const kind = `${body?.kind ?? ''}` as WebhookKind;
        if (!WEBHOOK_KINDS.includes(kind)) {
            throw new BadRequestException('Art muss ntfy, discord oder json sein');
        }
        const checked = validateWebhookUrl(body?.url);
        if (checked.ok === false) {
            throw new BadRequestException(checked.reason);
        }
        if (kind === 'ntfy' && ntfyTarget(checked.url) == null) {
            throw new BadRequestException('ntfy-URL braucht ein Thema am Ende, zum Beispiel https://ntfy.sh/mein-thema');
        }
        return { url: checked.url.toString(), kind };
    }

    private publicUrl(): string {
        const configured: string | null = this.configService.get('POOL_PUBLIC_URL');
        return (configured != null && configured.length > 0 ? configured : 'https://pool.doilabs.org').replace(/\/+$/, '');
    }
}
