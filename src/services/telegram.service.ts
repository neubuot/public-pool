import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';
import { validate } from 'bitcoin-address-validation';
import { Block } from 'bitcoinjs-lib';

import { TelegramSubscriptionsService } from '../ORM/telegram-subscriptions/telegram-subscriptions.service';


@Injectable()
export class TelegramService implements OnModuleInit {

    private bot: AxiosInstance;
    private updateOffset = 0;
    private lastErrorLog = 0;
    /** long polling: Telegram holds the request up to this many seconds, one request in flight at a time */
    private readonly longPollSeconds = 20;

    constructor(
        private readonly configService: ConfigService,
        private readonly telegramSubscriptionsService: TelegramSubscriptionsService
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
        await Promise.all(subscribers.map(subscriber => this.sendMessage(subscriber.telegramChatId, text)));
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
        await Promise.all(subscribers.map(subscriber => this.sendMessage(subscriber.telegramChatId, text)));
        if (accepted) {
            await this.announce(text);
        }
    }

    /** Optional pool wide announcement chat or channel (TELEGRAM_ANNOUNCE_CHAT_ID, the bot must be a member). */
    private async announce(text: string) {
        const chatId = this.configService.get('TELEGRAM_ANNOUNCE_CHAT_ID');
        if (chatId == null || `${chatId}`.length === 0) {
            return;
        }
        try {
            await this.sendMessage(chatId, text);
        } catch (e) {
            console.error('Telegram announcement failed:', e?.response?.data?.description ?? e?.message ?? e);
        }
    }

    private publicUrl(): string {
        const configured: string | null = this.configService.get('POOL_PUBLIC_URL');
        return (configured != null && configured.length > 0 ? configured : 'https://pool.doilabs.org').replace(/\/+$/, '');
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
                await this.handleMessage(update.message);
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
        if (msg?.text == null) {
            return;
        }

        if (msg.text.startsWith('/subscribe')) {
            const address = msg.text.split('/subscribe ')[1];
            if (validate(address) == false) {
                await this.sendMessage(msg.chat.id, 'Invalid address.');
                return;
            }
            await this.telegramSubscriptionsService.saveSubscription(msg.chat.id, address);
            await this.sendMessage(msg.chat.id, 'Subscribed!');
            return;
        }

        if (msg.text.startsWith('/start') || msg.text.startsWith('/help')) {
            await this.sendMessage(msg.chat.id,
                'Welcome to the NerdPool bot. Send /subscribe <your BTC address> to get a message whenever one of your miners '
                + 'finds a Bitcoin or Doichain block. The address is the one you use as stratum user name.');
            return;
        }

        console.log(msg);
    }

    private async sendMessage(chatId: number | string, text: string) {
        await this.bot.post('sendMessage', {
            chat_id: chatId,
            text
        });
    }
}
