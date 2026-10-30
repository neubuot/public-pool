import { Injectable, OnModuleInit } from '@nestjs/common';
import { Block } from 'bitcoinjs-lib';

import { DiscordService } from './discord.service';
import { TelegramService } from './telegram.service';


@Injectable()
export class NotificationService implements OnModuleInit {

    constructor(
        private readonly telegramService: TelegramService,
        private readonly discordService: DiscordService
    ) { }

    async onModuleInit(): Promise<void> {
        await this.discordService.notifyRestarted();
    }

    public async notifySubscribersBlockFound(address: string, height: number, block: Block, message: string) {
        await this.discordService.notifySubscribersBlockFound(height, block, message);
        await this.telegramService.notifySubscribersBlockFound(address, height, block, message);
    }

    /** A merge mined Doichain block: subscribers of the miner's Bitcoin address and the announcement chat. */
    public async notifyDoichainBlockFound(address: string, worker: string, height: number, hash: string, accepted: boolean, message: string) {
        try {
            await this.telegramService.notifyDoichainBlockFound(address, worker, height, hash, accepted, message);
        } catch (e) {
            console.error('Doichain block notification failed', e?.message ?? e);
        }
    }
}