import { Injectable, OnModuleInit } from '@nestjs/common';
import { Block } from 'bitcoinjs-lib';

import { ShareRecord } from '../utils/record-alerts';
import { WorkerTransition } from '../utils/worker-presence';
import { DiscordService } from './discord.service';
import { RecordAlertsService } from './record-alerts.service';
import { TelegramService } from './telegram.service';
import { WebhookService } from './webhook.service';


/** Fans pool happenings out to every channel: Discord (pool wide), Telegram subscribers and webhooks per address. */
@Injectable()
export class NotificationService implements OnModuleInit {

    constructor(
        private readonly telegramService: TelegramService,
        private readonly discordService: DiscordService,
        private readonly webhookService: WebhookService,
        private readonly recordAlertsService: RecordAlertsService,
    ) { }

    async onModuleInit(): Promise<void> {
        await this.discordService.notifyRestarted();
    }

    public publicUrl(): string {
        return this.telegramService.publicUrl();
    }

    public async notifySubscribersBlockFound(address: string, height: number, block: Block, message: string) {
        await this.discordService.notifySubscribersBlockFound(height, block, message);
        await this.telegramService.notifySubscribersBlockFound(address, height, block, message);
        await this.webhooks(address, {
            event: 'block.found', title: 'Bitcoin block found',
            text: `Bitcoin block ${height} found! Result: ${message}`,
            url: `${this.publicUrl()}/explorer/btc/block/${block.getId()}`,
            data: { chain: 'BTC', height, hash: block.getId(), result: message }
        });
    }

    /** A merge mined Doichain block: subscribers of the miner's Bitcoin address and the announcement chat. */
    public async notifyDoichainBlockFound(address: string, worker: string, height: number, hash: string, accepted: boolean, message: string) {
        try {
            await this.telegramService.notifyDoichainBlockFound(address, worker, height, hash, accepted, message);
        } catch (e) {
            console.error('Doichain block notification failed', e?.message ?? e);
        }
        const base = this.publicUrl();
        await this.webhooks(address, {
            event: 'block.found', title: accepted ? 'Doichain block found' : 'Doichain block rejected',
            text: accepted ? `Doichain block ${height} found by worker ${worker}!` : `Doichain block ${height} from worker ${worker} was rejected: ${message}`,
            url: accepted ? `${base}/s/doi/${height}` : `${base}/d/${address}`,
            image: accepted ? `${base}/api/share/doi/${height}` : undefined,
            data: { chain: 'DOI', height, hash, worker, accepted, result: message }
        });
    }

    /** Workers of an address that went offline or came back: one Telegram message, one webhook event per worker. */
    public async workerAlert(address: string, text: string, transitions: WorkerTransition[]): Promise<number> {
        let told = 0;
        for (const subscriber of await this.telegramService.offlineSubscribers(address)) {
            if (await this.telegramService.notifyChat(subscriber.telegramChatId, text)) {
                told++;
            }
        }
        const dashboard = `${this.publicUrl()}/d/${address}`;
        for (const transition of transitions) {
            const offline = transition.kind === 'offline';
            told += await this.webhooks(address, {
                event: offline ? 'worker.offline' : 'worker.online',
                title: offline ? `Worker ${transition.worker} offline` : `Worker ${transition.worker} online`,
                text: text.split('\n').find(line => line.includes(transition.worker)) ?? text,
                url: dashboard,
                data: { worker: transition.worker, userAgent: transition.userAgent, kind: transition.kind, lastSeen: new Date(transition.lastSeen).toISOString(), awayMs: transition.awayMs ?? null }
            });
        }
        return told;
    }

    /** A share that beats the address's best, from the stratum client. Never throws into share handling. */
    public shareRecord(record: ShareRecord): void {
        try {
            this.recordAlertsService.onRecord(record);
        } catch (e) {
            console.error('Best share alert failed', e?.message ?? e);
        }
    }

    private async webhooks(address: string, event: Parameters<WebhookService['deliver']>[1]): Promise<number> {
        try {
            return await this.webhookService.deliver(address, event);
        } catch (e) {
            console.error(`Webhooks for ${address} failed`, e?.message ?? e);
            return 0;
        }
    }
}
