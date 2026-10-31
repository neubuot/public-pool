import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, Repository } from 'typeorm';

import { TopShareEntity } from './top-share.entity';

export const TOP_SHARES_PER_ADDRESS = 25;

export interface TopShare {
    address: string;
    worker: string;
    sessionId: string;
    userAgent: string | null;
    difficulty: number;
    time: number;
}

/**
 * Records a miner's best shares without touching the database for ordinary shares: per address the
 * difficulty of the 25th best share is cached, only a share above it is written.
 */
@Injectable()
export class TopSharesService {

    private readonly thresholds = new Map<string, number>();
    private readonly loading = new Map<string, Promise<number>>();

    constructor(
        @InjectRepository(TopShareEntity)
        private readonly repository: Repository<TopShareEntity>,
    ) { }

    /** Stores the share if it belongs to the address's top list. Cheap when it does not. */
    public async maybeRecord(share: TopShare): Promise<boolean> {
        if (!(share.difficulty > 0)) {
            return false;
        }
        const threshold = await this.threshold(share.address);
        if (share.difficulty <= threshold) {
            return false;
        }
        await this.repository.insert({ ...share, userAgent: share.userAgent ?? null });
        await this.prune(share.address);
        return true;
    }

    public async forAddress(address: string, limit = 10): Promise<TopShareEntity[]> {
        return await this.repository.find({ where: { address }, order: { difficulty: 'DESC' }, take: limit });
    }

    public async overall(limit = 10): Promise<TopShareEntity[]> {
        return await this.repository.find({ order: { difficulty: 'DESC' }, take: limit });
    }

    /** best shares across all miners within [fromMs, toMs), the closest calls of a month */
    public async between(fromMs: number, toMs: number, limit = 10): Promise<TopShareEntity[]> {
        return await this.repository.find({ where: { time: Between(fromMs, toMs - 1) }, order: { difficulty: 'DESC' }, take: limit });
    }

    public async bestForAddress(address: string): Promise<TopShareEntity | null> {
        return await this.repository.findOne({ where: { address }, order: { difficulty: 'DESC' } });
    }

    private async threshold(address: string): Promise<number> {
        const cached = this.thresholds.get(address);
        if (cached != null) {
            return cached;
        }
        let pending = this.loading.get(address);
        if (pending == null) {
            pending = this.loadThreshold(address).finally(() => this.loading.delete(address));
            this.loading.set(address, pending);
        }
        return pending;
    }

    private async loadThreshold(address: string): Promise<number> {
        const rows = await this.repository.find({ select: { difficulty: true }, where: { address }, order: { difficulty: 'DESC' }, take: TOP_SHARES_PER_ADDRESS });
        const threshold = rows.length >= TOP_SHARES_PER_ADDRESS ? rows[rows.length - 1].difficulty : 0;
        this.thresholds.set(address, threshold);
        return threshold;
    }

    private async prune(address: string) {
        const rows = await this.repository.find({ select: { id: true, difficulty: true }, where: { address }, order: { difficulty: 'DESC' } });
        if (rows.length > TOP_SHARES_PER_ADDRESS) {
            const surplus = rows.slice(TOP_SHARES_PER_ADDRESS).map(r => r.id);
            await this.repository.delete(surplus);
            this.thresholds.set(address, rows[TOP_SHARES_PER_ADDRESS - 1].difficulty);
        } else {
            this.thresholds.set(address, rows.length >= TOP_SHARES_PER_ADDRESS ? rows[rows.length - 1].difficulty : 0);
        }
    }
}
