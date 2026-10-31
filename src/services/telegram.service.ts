import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';
import { validate } from 'bitcoin-address-validation';
import { Block } from 'bitcoinjs-lib';

import { ClientService } from '../ORM/client/client.service';
import { TelegramSubscriptionsService } from '../ORM/telegram-subscriptions/telegram-subscriptions.service';
import { composeStatus, offlineAfterMinutes, parseCommand, shortAddress } from '../utils/worker-presence';


@Injectable()
export class TelegramService implements OnModuleInit {

    private bot: AxiosInstance;
    private updateOffset = 0;
    private lastErrorLog = 0;
    /** long polling: Telegram holds the request up to this many seconds, one request in flight at a time */
    private readonly longPollSeconds = 20;

    constructor(
        private readonly configService: ConfigService,
        private readonly telegramSubscriptionsService: TelegramSubscriptionsService,
        private readonly clientService: ClientService,
    ) {
        const token: string | null = this.configService.get('TELEGRAM_BOT_TOKEN');
        if (token == null || token.length < 1) {
            return;
        }
        this.bot = axios.create({
            baseURL: `https://api.telegram.org/bot${token}/`,
            timeout: (this.longPollSeconds + 10) * 1000
        });
        console.log('Telegram bot init');


    }

    /** true when a bot token is configured */
    public get active(): boolean {
        return this.bot != null;
    }

    async onModuleInit(): Promise<void> {

        if (this.bot == null) {
            return;
        }

        // Sequential long polling: overlapping getUpdates calls make Telegram answer 409 to one of them.
        // Don't await, the loop runs for the lifetime of the process.
        this.pollLoop();
    }

    private async pollLoop() {
        while (true) {
            const ok = await this.pollUpdates();
            // back off after an error (e.g. 409 while another instance polls), otherwise poll again right away
            await new Promise(resolve => setTimeout(resolve, ok ? 500 : 5000));
        }
    }

    public async notifySubscribersBlockFound(address: string, height: number, block: Block, message: string) {
        if (this.bot == null) {
            return;
        }

        const text = `⛏️ Bitcoin block found! Height ${height}, result: ${message}\n${this.publicUrl()}/explorer/btc/block/${block.getId()}`;
        const subscribers = await this.telegramSubscriptionsService.getSubscriptions(address);
        await Promise.all(subscribers.map(subscriber => this.notifyChat(subscriber.telegramChatId, text)));
        await this.announce(text);
    }

    /** Merge mined Doichain block: the miner's subscribers (by Bitcoin address) and the announcement chat. */
    public async notifyDoichainBlockFound(address: string, worker: string, height: number, hash: string, accepted: boolean, message: string) {
        if (this.bot == null) {
            return;
        }
        const base = this.publicUrl();
        const text = accepted
            ? `⛏️ Doichain block found! Height ${height}, worker ${worker}\n${base}/explorer/doi/block/${hash}\nShare card: ${base}/s/doi/${height}`
            : `Doichain block ${height} from worker ${worker} was rejected: ${message}`;
        const subscribers = await this.telegramSubscriptionsService.getSubscriptions(address);
        await Promise.all(subscribers.map(subscriber => this.notifyChat(subscriber.telegramChatId, text)));
        if (accepted) {
            await this.announce(text);
        }
    }

    /** Sends a message to one chat; a failure (bot blocked, chat gone) is logged, not thrown. */
    public async notifyChat(chatId: number | string, text: string): Promise<boolean> {
        if (this.bot == null) {
            return false;
        }
        try {
            await this.sendMessage(chatId, text);
            return true;
        } catch (e) {
            console.error(`Telegram message to ${chatId} failed:`, e?.response?.data?.description ?? e?.message ?? e);
            return false;
        }
    }

    /** Sends a picture (Telegram fetches the URL itself) with a caption of at most 1024 characters. */
    public async notifyChatPhoto(chatId: number | string, photoUrl: string, caption: string): Promise<boolean> {
        if (this.bot == null) {
            return false;
        }
        try {
            await this.bot.post('sendPhoto', { chat_id: chatId, photo: photoUrl, caption: caption.slice(0, 1024) });
            return true;
        } catch (e) {
            console.error(`Telegram photo to ${chatId} failed:`, e?.response?.data?.description ?? e?.message ?? e);
            return false;
        }
    }

    /** subscribers of an address with offline alerts on (none when no bot is configured) */
    public async offlineSubscribers(address: string) {
        return this.bot == null ? [] : await this.telegramSubscriptionsService.getOfflineSubscribers(address);
    }

    /** Optional pool wide announcement chat or channel (TELEGRAM_ANNOUNCE_CHAT_ID, the bot must be a member). */
    private async announce(text: string) {
        const chatId = this.configService.get('TELEGRAM_ANNOUNCE_CHAT_ID');
        if (chatId == null || `${chatId}`.length === 0) {
            return;
        }
        await this.notifyChat(chatId, text);
    }

    public publicUrl(): string {
        const configured: string | null = this.configService.get('POOL_PUBLIC_URL');
        return (configured != null && configured.length > 0 ? configured : 'https://pool.doilabs.org').replace(/\/+$/, '');
    }

    private offlineMinutes(): number {
        return offlineAfterMinutes(this.configService.get('OFFLINE_ALERT_MINUTES'));
    }

    private async pollUpdates(): Promise<boolean> {
        try {
            const response = await this.bot.get('getUpdates', {
                params: {
                    offset: this.updateOffset,
                    timeout: this.longPollSeconds
                }
            });

            for (const update of response.data.result ?? []) {
                this.updateOffset = update.update_id + 1;
                try {
                    await this.handleMessage(update.message);
                } catch (e) {
                    console.error('Telegram command failed:', e?.response?.data?.description ?? e?.message ?? e);
                }
            }
            return true;
        } catch (e) {
            const now = Date.now();
            if (now - this.lastErrorLog > 60000) {
                this.lastErrorLog = now;
                const detail = e?.response?.data?.description ?? e?.message ?? e;
                console.error(`Telegram polling failed: ${detail}`);
            }
            return false;
        }
    }

    private async handleMessage(msg: any) {
        const command = parseCommand(msg?.text);
        if (command == null || msg?.chat?.id == null) {
            return;
        }
        const chatId: number = msg.chat.id;

        switch (command.name) {
            case 'subscribe': {
                const address = command.args[0];
                if (address == null || validate(address) == false) {
                    await this.sendMessage(chatId, 'Invalid address. Send /subscribe <your BTC address>, the one you use as stratum user name.');
                    return;
                }
                const created = await this.telegramSubscriptionsService.saveSubscription(chatId, address);
                await this.sendMessage(chatId, created
                    ? `Subscribed! You will hear about blocks found with ${shortAddress(address)}, about new best shares (with the share card)`
                    + ` and when one of its workers goes offline or comes back (${this.offlineMinutes()} minutes without a sign of life).`
                    + ' /offline off and /records off mute those.'
                    : `Already subscribed to ${shortAddress(address)}.`);
                return;
            }
            case 'records': {
                const mode = command.args[0]?.toLowerCase();
                const address = command.args[1];
                if ((mode !== 'on' && mode !== 'off') || (address != null && validate(address) == false)) {
                    await this.sendMessage(chatId, 'Send /records off to mute best share messages, /records on to get them again. Add a BTC address to change only that one.');
                    return;
                }
                const changed = await this.telegramSubscriptionsService.setRecordAlerts(chatId, mode === 'on', address);
                await this.sendMessage(chatId, changed > 0
                    ? `Best share messages ${mode} for ${address != null ? shortAddress(address) : 'all your addresses'}.`
                    : 'No subscription found. Send /subscribe <your BTC address> first.');
                return;
            }
            case 'unsubscribe': {
                const address = command.args[0];
                if (address == null || validate(address) == false) {
                    await this.sendMessage(chatId, 'Send /unsubscribe <BTC address>.');
                    return;
                }
                const removed = await this.telegramSubscriptionsService.removeSubscription(chatId, address);
                await this.sendMessage(chatId, removed > 0 ? `Unsubscribed from ${shortAddress(address)}.` : `No subscription for ${shortAddress(address)}.`);
                return;
            }
            case 'offline': {
                const mode = command.args[0]?.toLowerCase();
                const address = command.args[1];
                if ((mode !== 'on' && mode !== 'off') || (address != null && validate(address) == false)) {
                    await this.sendMessage(chatId, 'Send /offline off to mute offline alerts, /offline on to get them again. Add a BTC address to change only that one.');
                    return;
                }
                const changed = await this.telegramSubscriptionsService.setOfflineAlerts(chatId, mode === 'on', address);
                await this.sendMessage(chatId, changed > 0
                    ? `Offline alerts ${mode} for ${address != null ? shortAddress(address) : 'all your addresses'}.`
                    : 'No subscription found. Send /subscribe <your BTC address> first.');
                return;
            }
            case 'status': {
                const subscriptions = await this.telegramSubscriptionsService.forChat(chatId);
                if (subscriptions.length === 0) {
                    await this.sendMessage(chatId, 'No subscriptions. Send /subscribe <your BTC address>.');
                    return;
                }
                const now = Date.now();
                const offlineAfterMs = Math.max(1, this.offlineMinutes()) * 60_000;
                const blocks = await Promise.all(subscriptions.map(async subscription => composeStatus(
                    subscription.address,
                    await this.clientService.getByAddressWithDeleted(subscription.address),
                    now, offlineAfterMs, subscription.offlineAlerts !== false
                )));
                await this.sendMessage(chatId, blocks.join('\n\n'));
                return;
            }
            case 'start':
            case 'help': {
                await this.sendMessage(chatId,
                    'NerdPool bot. The address is the one you use as stratum user name.\n\n'
                    + '/subscribe <BTC address> – messages when a worker of this address finds a Bitcoin or Doichain block, beats its best share, goes offline or comes back\n'
                    + '/unsubscribe <BTC address>\n'
                    + '/offline off [BTC address] – no offline and back online messages, /offline on to get them again\n'
                    + '/records off [BTC address] – no best share messages, /records on to get them again\n'
                    + '/status – your addresses and their workers\n\n'
                    + `A worker counts as offline after ${this.offlineMinutes()} minutes without shares or heartbeat. `
                    + 'Prefer ntfy, Discord or a JSON webhook? Add it on your dashboard under Notifications.');
                return;
            }
            default:
                await this.sendMessage(chatId, 'Unknown command, send /help.');
        }
    }

    private async sendMessage(chatId: number | string, text: string) {
        await this.bot.post('sendMessage', {
            chat_id: chatId,
            text
        });
    }
}
