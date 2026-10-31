import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { DISABLE_AFTER_FAILURES, MAX_WEBHOOKS_PER_ADDRESS, WebhookKind } from '../../utils/webhook-targets';
import { WebhookEntity } from './webhook.entity';


@Injectable()
export class WebhooksService {

    constructor(
        @InjectRepository(WebhookEntity)
        private readonly repository: Repository<WebhookEntity>,
    ) { }

    public async forAddress(address: string): Promise<WebhookEntity[]> {
        return await this.repository.find({ where: { address }, order: { id: 'ASC' } });
    }

    /** addresses with at least one switched on target */
    public async addresses(): Promise<string[]> {
        const rows: { address: string }[] = await this.repository
            .createQueryBuilder('hook')
            .select('DISTINCT hook.address', 'address')
            .where('hook.enabled = 1')
            .getRawMany();
        return rows.map(row => row.address);
    }

    /** Saves a target; an existing URL of the address is switched on again instead of stored twice. */
    public async add(address: string, url: string, kind: WebhookKind): Promise<WebhookEntity> {
        const existing = await this.repository.findOne({ where: { address, url } });
        if (existing != null) {
            await this.repository.update({ id: existing.id }, { kind, enabled: true, failures: 0, lastError: null });
            return { ...existing, kind, enabled: true, failures: 0, lastError: null };
        }
        const count = await this.repository.count({ where: { address } });
        if (count >= MAX_WEBHOOKS_PER_ADDRESS) {
            throw new Error(`Höchstens ${MAX_WEBHOOKS_PER_ADDRESS} Webhooks je Adresse`);
        }
        return await this.repository.save({ address, url, kind, enabled: true, failures: 0, lastError: null, lastDeliveredAt: null, createdAt: Date.now() });
    }

    public async remove(address: string, id: number): Promise<number> {
        const result = await this.repository.delete({ id, address });
        return result.affected ?? 0;
    }

    /** Resets the failure count on success, counts up on failure and switches the target off after too many in a row. */
    public async recordResult(id: number, ok: boolean, error?: string): Promise<void> {
        if (ok) {
            await this.repository.update({ id }, { failures: 0, lastError: null, lastDeliveredAt: Date.now() });
            return;
        }
        const hook = await this.repository.findOne({ where: { id } });
        if (hook == null) {
            return;
        }
        const failures = (hook.failures ?? 0) + 1;
        await this.repository.update({ id }, { failures, lastError: (error ?? 'Fehler').slice(0, 200), enabled: failures < DISABLE_AFTER_FAILURES });
    }
}
