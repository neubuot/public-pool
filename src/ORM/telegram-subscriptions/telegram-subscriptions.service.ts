import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { TelegramSubscriptionsEntity } from './telegram-subscriptions.entity';


@Injectable()
export class TelegramSubscriptionsService {
    constructor(
        @InjectRepository(TelegramSubscriptionsEntity)
        private telegramSubscriptions: Repository<TelegramSubscriptionsEntity>
    ) {

    }

    /** one entry per chat, older rows may contain the same chat twice */
    public async getSubscriptions(address: string): Promise<TelegramSubscriptionsEntity[]> {
        return uniqueChats(await this.telegramSubscriptions.find({ where: { address } }));
    }

    public async getOfflineSubscribers(address: string): Promise<TelegramSubscriptionsEntity[]> {
        return uniqueChats(await this.telegramSubscriptions.find({ where: { address, offlineAlerts: true } }));
    }

    public async getRecordSubscribers(address: string): Promise<TelegramSubscriptionsEntity[]> {
        return uniqueChats(await this.telegramSubscriptions.find({ where: { address, recordAlerts: true } }));
    }

    public async addressesWithOfflineAlerts(): Promise<string[]> {
        const rows: { address: string }[] = await this.telegramSubscriptions
            .createQueryBuilder('subscription')
            .select('DISTINCT subscription.address', 'address')
            .where('subscription.offlineAlerts = 1')
            .getRawMany();
        return rows.map(row => row.address);
    }

    /** the chat's subscriptions, one per address */
    public async forChat(chatId: number): Promise<TelegramSubscriptionsEntity[]> {
        const rows = await this.telegramSubscriptions.find({ where: { telegramChatId: chatId }, order: { id: 'ASC' } });
        const seen = new Set<string>();
        return rows.filter(row => !seen.has(row.address) && seen.add(row.address));
    }

    /** returns whether the subscription is new */
    public async saveSubscription(chatId: number, address: string): Promise<boolean> {
        const existing = await this.telegramSubscriptions.findOne({ where: { telegramChatId: chatId, address } });
        if (existing != null) {
            return false;
        }
        await this.telegramSubscriptions.save({
            telegramChatId: chatId,
            address
        });
        return true;
    }

    /** returns the number of removed rows */
    public async removeSubscription(chatId: number, address: string): Promise<number> {
        const result = await this.telegramSubscriptions.delete({ telegramChatId: chatId, address });
        return result.affected ?? 0;
    }

    /** all subscriptions of the chat, or only the one for the address; returns the number of rows changed */
    public async setOfflineAlerts(chatId: number, enabled: boolean, address?: string): Promise<number> {
        const where = address != null ? { telegramChatId: chatId, address } : { telegramChatId: chatId };
        const result = await this.telegramSubscriptions.update(where, { offlineAlerts: enabled });
        return result.affected ?? 0;
    }

    public async setRecordAlerts(chatId: number, enabled: boolean, address?: string): Promise<number> {
        const where = address != null ? { telegramChatId: chatId, address } : { telegramChatId: chatId };
        const result = await this.telegramSubscriptions.update(where, { recordAlerts: enabled });
        return result.affected ?? 0;
    }
}

function uniqueChats(rows: TelegramSubscriptionsEntity[]): TelegramSubscriptionsEntity[] {
    const seen = new Set<number>();
    return rows.filter(row => !seen.has(row.telegramChatId) && seen.add(row.telegramChatId));
}
