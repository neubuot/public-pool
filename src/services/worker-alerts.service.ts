import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Interval } from '@nestjs/schedule';

import { ClientService } from '../ORM/client/client.service';
import { TelegramSubscriptionsService } from '../ORM/telegram-subscriptions/telegram-subscriptions.service';
import { WorkerPresenceService } from '../ORM/worker-presence/worker-presence.service';
import { composeAlert, evaluateAddress, offlineAfterMinutes } from '../utils/worker-presence';
import { TelegramService } from './telegram.service';

/** presence rows of workers without a sign of life for this long are dropped */
const FORGET_AFTER_MS = 30 * 24 * 60 * 60 * 1000;
const CLEANUP_EVERY_MS = 24 * 60 * 60 * 1000;

/**
 * Tells Telegram subscribers when one of their workers stops sending shares or heartbeats and when it is back.
 * Runs once a minute for every address somebody subscribed with offline alerts on. A worker counts as offline
 * after OFFLINE_ALERT_MINUTES (default 10, 0 switches the alerts off) without a heartbeat; connected miners
 * heartbeat every minute even without shares, so an idle rig stays online, a disconnected one does not.
 */
@Injectable()
export class WorkerAlertsService {

    private readonly startedAt = Date.now();
    private readonly offlineAfterMs: number;
    private running = false;
    private lastCleanup = 0;

    constructor(
        private readonly configService: ConfigService,
        private readonly clientService: ClientService,
        private readonly subscriptionsService: TelegramSubscriptionsService,
        private readonly presenceService: WorkerPresenceService,
        private readonly telegramService: TelegramService,
    ) {
        this.offlineAfterMs = offlineAfterMinutes(this.configService.get('OFFLINE_ALERT_MINUTES')) * 60_000;
        if (this.enabled) {
            console.log(`Worker offline alerts after ${this.offlineAfterMs / 60_000} minutes`);
        }
    }

    public get enabled(): boolean {
        const firstInstance = process.env.NODE_APP_INSTANCE == null || process.env.NODE_APP_INSTANCE === '0';
        return this.offlineAfterMs > 0 && this.telegramService.active && firstInstance;
    }

    @Interval(60_000)
    public async tick(): Promise<void> {
        try {
            await this.check(Date.now());
        } catch (e) {
            console.error('Worker offline alerts failed', e);
        }
    }

    /** Checks every subscribed address, returns the number of messages sent. */
    public async check(now: number = Date.now()): Promise<number> {
        if (!this.enabled || this.running) {
            return 0;
        }
        // after a restart every miner reconnects within a minute or two, the gap is not an outage of their rig
        if (now - this.startedAt < this.offlineAfterMs) {
            return 0;
        }
        this.running = true;
        let sent = 0;
        try {
            for (const address of await this.subscriptionsService.addressesWithOfflineAlerts()) {
                try {
                    sent += await this.checkAddress(address, now);
                } catch (e) {
                    console.error(`Worker offline alerts for ${address} failed`, e);
                }
            }
            if (now - this.lastCleanup > CLEANUP_EVERY_MS) {
                this.lastCleanup = now;
                await this.presenceService.deleteNotSeenSince(now - FORGET_AFTER_MS);
            }
        } finally {
            this.running = false;
        }
        return sent;
    }

    private async checkAddress(address: string, now: number): Promise<number> {
        const [sessions, known] = await Promise.all([
            this.clientService.getByAddressWithDeleted(address),
            this.presenceService.forAddress(address),
        ]);
        const { rows, transitions } = evaluateAddress(address, sessions, known, now, this.offlineAfterMs);
        await this.presenceService.save(rows);
        if (transitions.length === 0) {
            return 0;
        }
        const text = composeAlert(address, transitions, now, `${this.telegramService.publicUrl()}/d/${address}`);
        const subscribers = await this.subscriptionsService.getOfflineSubscribers(address);
        console.log(`Worker alert for ${address}: ${transitions.map(t => `${t.worker} ${t.kind}`).join(', ')} (${subscribers.length} chats)`);
        for (const subscriber of subscribers) {
            await this.telegramService.notifyChat(subscriber.telegramChatId, text);
        }
        return subscribers.length;
    }
}
