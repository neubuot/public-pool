import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { SyndicateShareEntity } from './syndicate-share.entity';

export interface SyndicateShareDelta {
    doiAddress: string;
    bucket: number;
    work: number;
    shares: number;
}

export interface SyndicateWork {
    doiAddress: string;
    work: number;
    shares: number;
}

@Injectable()
export class SyndicateSharesService {

    constructor(
        @InjectRepository(SyndicateShareEntity)
        private readonly repository: Repository<SyndicateShareEntity>,
    ) { }

    /** Adds the deltas to their buckets (insert or add, safe across restarts and processes). */
    public async add(deltas: SyndicateShareDelta[]): Promise<void> {
        if (deltas.length === 0) {
            return;
        }
        await this.repository.manager.transaction(async manager => {
            for (const delta of deltas) {
                await manager.query(
                    `INSERT INTO syndicate_share_entity (doiAddress, bucket, work, shares) VALUES (?, ?, ?, ?)
                     ON CONFLICT(doiAddress, bucket) DO UPDATE SET work = work + excluded.work, shares = shares + excluded.shares`,
                    [delta.doiAddress, delta.bucket, delta.work, delta.shares]
                );
            }
        });
    }

    /** Work per address from `sinceBucket` on, largest first. */
    public async workSince(sinceBucket: number): Promise<SyndicateWork[]> {
        const rows = await this.repository.createQueryBuilder('s')
            .select('s.doiAddress', 'doiAddress')
            .addSelect('SUM(s.work)', 'work')
            .addSelect('SUM(s.shares)', 'shares')
            .where('s.bucket >= :since', { since: sinceBucket })
            .groupBy('s.doiAddress')
            .orderBy('work', 'DESC')
            .getRawMany();
        return rows.map(row => ({ doiAddress: row.doiAddress, work: parseFloat(row.work) || 0, shares: parseInt(row.shares) || 0 }));
    }

    /** Hourly work of one address from `sinceBucket` on, oldest first (for the member's chart). */
    public async bucketsFor(doiAddress: string, sinceBucket: number): Promise<{ bucket: number, work: number, shares: number }[]> {
        const rows = await this.repository.find({ where: { doiAddress }, order: { bucket: 'ASC' } });
        return rows.filter(row => row.bucket >= sinceBucket).map(row => ({ bucket: row.bucket, work: row.work, shares: row.shares }));
    }

    public async deleteOlderThan(bucket: number): Promise<void> {
        await this.repository.createQueryBuilder().delete().where('bucket < :bucket', { bucket }).execute();
    }
}
