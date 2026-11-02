import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';

import { SyndicatePayoutEntity } from './syndicate-payout.entity';

export interface SyndicateBlockSummary {
    height: number;
    blockHash: string;
    time: number;
    accepted: boolean;
    finderAddress: string;
    finderWorker: string;
    members: number;
    /** sum of all outputs, integer units */
    total: number;
}

@Injectable()
export class SyndicatePayoutsService {

    constructor(
        @InjectRepository(SyndicatePayoutEntity)
        private readonly repository: Repository<SyndicatePayoutEntity>,
    ) { }

    public async saveMany(rows: Partial<SyndicatePayoutEntity>[]): Promise<void> {
        if (rows.length === 0) {
            return;
        }
        await this.repository.insert(rows);
    }

    /** All outputs of one block, largest first. */
    public async forBlock(height: number, blockHash?: string): Promise<SyndicatePayoutEntity[]> {
        return await this.repository.find({ where: blockHash != null ? { height, blockHash } : { height }, order: { amount: 'DESC' } });
    }

    /** Newest payouts of the given Doichain addresses. */
    public async forAddresses(doiAddresses: string[], limit = 20): Promise<SyndicatePayoutEntity[]> {
        if (doiAddresses.length === 0) {
            return [];
        }
        return await this.repository.find({ where: { doiAddress: In(doiAddresses) }, order: { id: 'DESC' }, take: limit });
    }

    /** Sum of the accepted payouts to the given addresses (integer units) and how many blocks paid them. */
    public async totalsFor(doiAddresses: string[]): Promise<{ amount: number, blocks: number }> {
        if (doiAddresses.length === 0) {
            return { amount: 0, blocks: 0 };
        }
        const row = await this.repository.createQueryBuilder('p')
            .select('COALESCE(SUM(p.amount), 0)', 'amount')
            .addSelect('COUNT(DISTINCT p.blockHash)', 'blocks')
            .where('p.doiAddress IN (:...addresses)', { addresses: doiAddresses })
            .andWhere('p.accepted = 1')
            .getRawOne();
        return { amount: parseInt(row?.amount) || 0, blocks: parseInt(row?.blocks) || 0 };
    }

    /** Syndicate blocks newest first, one row per block. */
    public async recentBlocks(limit = 20): Promise<SyndicateBlockSummary[]> {
        const rows = await this.repository.createQueryBuilder('p')
            .select('p.height', 'height')
            .addSelect('p.blockHash', 'blockHash')
            .addSelect('MAX(p.time)', 'time')
            .addSelect('MIN(p.accepted)', 'accepted')
            .addSelect('MAX(p.finderAddress)', 'finderAddress')
            .addSelect('MAX(p.finderWorker)', 'finderWorker')
            .addSelect('COUNT(*)', 'members')
            .addSelect('SUM(p.amount)', 'total')
            .groupBy('p.height')
            .addGroupBy('p.blockHash')
            .orderBy('time', 'DESC')
            .limit(limit)
            .getRawMany();
        return rows.map(row => ({
            height: parseInt(row.height), blockHash: row.blockHash, time: parseInt(row.time) || 0,
            accepted: `${row.accepted}` === '1' || row.accepted === true,
            finderAddress: row.finderAddress, finderWorker: row.finderWorker ?? '',
            members: parseInt(row.members) || 0, total: parseInt(row.total) || 0
        }));
    }

    /** Accepted syndicate blocks and the total paid out, for the pool statistics. */
    public async totals(): Promise<{ blocks: number, amount: number, members: number }> {
        const row = await this.repository.createQueryBuilder('p')
            .select('COUNT(DISTINCT p.blockHash)', 'blocks')
            .addSelect('COALESCE(SUM(p.amount), 0)', 'amount')
            .addSelect('COUNT(DISTINCT p.doiAddress)', 'members')
            .where('p.accepted = 1')
            .getRawOne();
        return { blocks: parseInt(row?.blocks) || 0, amount: parseInt(row?.amount) || 0, members: parseInt(row?.members) || 0 };
    }
}
