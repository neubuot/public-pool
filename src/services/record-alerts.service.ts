import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { TelegramSubscriptionsService } from '../ORM/telegram-subscriptions/telegram-subscriptions.service';
import { TopSharesService } from '../ORM/top-shares/top-shares.service';
import { composeRecordText, percentOfTarget, recordMinPercent, ShareRecord } from '../utils/record-alerts';
import { ChainStatsService } from './chain-stats.service';
import { TelegramService } from './telegram.service';
import { WebhookService } from './webhook.service';

/** a burst of records (a fresh miner beats itself every few minutes) becomes one message */
const COALESCE_MS = 90_000;

interface Pending {
    record: ShareRecord;
    /** time of the first record of the burst: the best before it is the "previous best" in the message */
    firstTime: number;
    timer: NodeJS.Timeout;
}

/**
 * Reports a new best share of an address to its Telegram subscribers (as photo with the share card) and
 * webhooks once it reaches RECORD_ALERT_MIN_PERCENT of the Doichain difficulty. Records arriving within
 * 90 seconds of each other are sent as one message with the highest of them.
 */
@Injectable()
export class RecordAlertsService {

    private readonly minPercent: number | null;
    private readonly pending = new Map<string, Pending>();

    constructor(
        private readonly configService: ConfigService,
        private readonly chainStatsService: ChainStatsService,
        private readonly telegramService: TelegramService,
        private readonly webhookService: WebhookService,
        private readonly subscriptionsService: TelegramSubscriptionsService,
        private readonly topSharesService: TopSharesService,
    ) {
        this.minPercent = recordMinPercent(this.configService.get('RECORD_ALERT_MIN_PERCENT'));
        if (this.minPercent != null) {
            console.log(`Best share alerts from ${this.minPercent} % of the Doichain difficulty`);
        }
    }

    public get enabled(): boolean {
        return this.minPercent != null;
    }

    /** Called for every share that beats the address's best; decides whether and when to tell anyone. */
    public onRecord(record: ShareRecord): boolean {
        if (this.minPercent == null || !(record.difficulty > 0)) {
            return false;
        }
        const doiTarget = this.chainStatsService.current()?.doichain?.difficulty ?? null;
        const percent = percentOfTarget(record.difficulty, doiTarget);
        if (this.minPercent > 0 && (percent == null || percent < this.minPercent)) {
            return false;
        }
        const existing = this.pending.get(record.address);
        if (existing != null) {
            if (record.difficulty > existing.record.difficulty) {
                existing.record = { ...record, previous: existing.record.previous };
            }
            return true;
        }
        const timer = setTimeout(() => {
            this.flush(record.address).catch(e => console.error('Best share alert failed', e?.message ?? e));
        }, COALESCE_MS);
        timer.unref?.();
        this.pending.set(record.address, { record, firstTime: record.time, timer });
        return true;
    }

    /** The best share before the burst, from the address's top shares (0 when unknown). */
    private async previousBest(address: string, entry: Pending): Promise<number> {
        if (entry.record.previous > 0) {
            return entry.record.previous;
        }
        try {
            const earlier = (await this.topSharesService.forAddress(address, 25))
                .filter(share => share.time < entry.firstTime && share.difficulty < entry.record.difficulty);
            return earlier.reduce((best, share) => Math.max(best, share.difficulty), 0);
        } catch {
            return 0;
        }
    }

    /** Sends the pending record of an address now, returns the number of Telegram chats told. */
    public async flush(address: string): Promise<number> {
        const entry = this.pending.get(address);
        if (entry == null) {
            return 0;
        }
        this.pending.delete(address);
        clearTimeout(entry.timer);

        const snapshot = this.chainStatsService.current();
        const record = { ...entry.record, previous: await this.previousBest(address, entry) };
        const text = composeRecordText(record, snapshot?.doichain?.difficulty ?? null, snapshot?.bitcoin?.difficulty ?? null);
        const base = this.telegramService.publicUrl();
        const image = `${base}/api/share/best/${address}?v=${Math.round(entry.record.difficulty)}`;
        const page = `${base}/s/best/${address}`;
        console.log(`Best share alert for ${address}: ${entry.record.worker} ${entry.record.difficulty}`);

        let told = 0;
        for (const subscriber of await this.subscriptionsService.getRecordSubscribers(address)) {
            const sent = await this.telegramService.notifyChatPhoto(subscriber.telegramChatId, image, `${text}\n${page}`)
                || await this.telegramService.notifyChat(subscriber.telegramChatId, `${text}\n${page}`);
            if (sent) {
                told++;
            }
        }
        await this.webhookService.deliver(address, {
            event: 'share.record', title: 'New best share', text, url: page, image,
            data: { worker: record.worker, userAgent: record.userAgent, difficulty: record.difficulty, previous: record.previous }
        });
        return told;
    }
}
