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
    public async notifyDoichainBlockFound(address: string, worker: string, height: number, hash: string, accepted: boolean, message: string, syndicate?: { members: number, paidOut: number }) {
        try {
            await this.telegramService.notifyDoichainBlockFound(address, worker, height, hash, accepted, message, syndicate);
        } catch (e) {
            console.error('Doichain block notification failed', e?.message ?? e);
        }
        const base = this.publicUrl();
        const shared = syndicate != null ? ` Syndicate block, shared among ${syndicate.members} members.` : '';
        await this.webhooks(address, {
            event: 'block.found', title: accepted ? 'Doichain block found' : 'Doichain block rejected',
            text: accepted ? `Doichain block ${height} found by worker ${worker}!${shared}` : `Doichain block ${height} from worker ${worker} was rejected: ${message}`,
            url: accepted ? `${base}/s/doi/${height}` : `${base}/d/${address}`,
            image: accepted ? `${base}/api/share/doi/${height}` : undefined,
            data: { chain: 'DOI', height, hash, worker, accepted, result: message, syndicate: syndicate != null, members: syndicate?.members ?? null }
        });
    }

    /**
     * A syndicate block paid these Doichain addresses: every Bitcoin address whose devices use one of them
     * gets a Telegram message (subscribers) and its webhooks fired. `members` holds the whole payout list.
     */
    public async notifySyndicatePayouts(height: number, hash: string, members: { doiAddress: string, amount: number, percent: number }[], paidOut: number) {
        if (typeof this.telegramService.btcAddressesFor !== 'function') {
            return;
        }
        const byDoi = await this.telegramService.btcAddressesFor(members.map(m => m.doiAddress));
        const base = this.publicUrl();
        const perBtc = new Map<string, { doiAddress: string, amount: number, percent: number }[]>();
        for (const member of members) {
            for (const btc of byDoi.get(member.doiAddress) ?? []) {
                const list = perBtc.get(btc) ?? [];
                list.push(member);
                perBtc.set(btc, list);
            }
        }
        for (const [btcAddress, payouts] of perBtc.entries()) {
            const total = payouts.reduce((acc, p) => acc + p.amount, 0);
            const percent = payouts.reduce((acc, p) => acc + p.percent, 0);
            const text = `💰 Syndicate payout: Doichain block ${height} pays ${(total / 1e8).toFixed(4)} DOI (${(percent * 100).toFixed(2)} % of ${(paidOut / 1e8).toFixed(2)} DOI, ${members.length} members) to ${payouts.map(p => p.doiAddress).join(', ')}\n${base}/explorer/doi/block/${hash}`;
            try {
                await this.telegramService.notifyAddress(btcAddress, text);
            } catch (e) {
                console.error('Syndicate payout notification failed', e?.message ?? e);
            }
            await this.webhooks(btcAddress, {
                event: 'syndicate.payout', title: 'Syndicate payout',
                text: `Doichain block ${height} pays ${(total / 1e8).toFixed(4)} DOI to your address (${(percent * 100).toFixed(2)} %, ${members.length} members).`,
                url: `${base}/explorer/doi/block/${hash}`,
                data: { chain: 'DOI', height, hash, amount: total, percent, members: members.length, paidOut, addresses: payouts.map(p => p.doiAddress) }
            });
        }
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
