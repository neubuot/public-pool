import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { WorkerPresenceEntity } from './worker-presence.entity';


@Injectable()
export class WorkerPresenceService {

    constructor(
        @InjectRepository(WorkerPresenceEntity)
        private readonly repository: Repository<WorkerPresenceEntity>,
    ) { }

    public async forAddress(address: string): Promise<WorkerPresenceEntity[]> {
        return await this.repository.find({ where: { address }, order: { worker: 'ASC' } });
    }

    /** Inserts or updates by address and worker. */
    public async save(rows: Partial<WorkerPresenceEntity>[]): Promise<void> {
        if (rows.length === 0) {
            return;
        }
        await this.repository.upsert(rows, ['address', 'worker']);
    }

    /** Forgets workers whose last sign of life is older than the given unix time (milliseconds). */
    public async deleteNotSeenSince(lastSeenBefore: number): Promise<number> {
        const result = await this.repository
            .createQueryBuilder()
            .delete()
            .from(WorkerPresenceEntity)
            .where('lastSeen < :lastSeenBefore', { lastSeenBefore })
            .execute();
        return result.affected ?? 0;
    }
}
