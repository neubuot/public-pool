import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { ChainSampleEntity } from './chain-sample.entity';

export interface ChainSamplePoint {
    t: number;
    height: number | null;
    difficulty: number | null;
    networkHashPs: number | null;
    mempoolTx: number | null;
    hashRate: number | null;
    miners: number | null;
}

@Injectable()
export class ChainSampleService {

    constructor(
        @InjectRepository(ChainSampleEntity)
        private readonly repository: Repository<ChainSampleEntity>,
    ) { }

    public async insert(sample: Partial<ChainSampleEntity>) {
        await this.repository.insert(sample);
    }

    /** Samples of one chain since a point in time, averaged into buckets of bucketMs milliseconds. */
    public async history(chain: string, sinceMs: number, bucketMs: number): Promise<ChainSamplePoint[]> {
        const rows: any[] = await this.repository.query(`
            SELECT
                (time / ?) * ? AS t,
                MAX(height) AS height,
                AVG(difficulty) AS difficulty,
                AVG(networkHashPs) AS networkHashPs,
                AVG(mempoolTx) AS mempoolTx,
                AVG(hashRate) AS hashRate,
                MAX(miners) AS miners
            FROM chain_sample_entity
            WHERE chain = ? AND time >= ?
            GROUP BY t
            ORDER BY t
        `, [Math.floor(bucketMs), Math.floor(bucketMs), chain, Math.floor(sinceMs)]);

        return rows.map(row => ({
            t: Number(row.t),
            height: row.height == null ? null : Number(row.height),
            difficulty: row.difficulty == null ? null : Number(row.difficulty),
            networkHashPs: row.networkHashPs == null ? null : Number(row.networkHashPs),
            mempoolTx: row.mempoolTx == null ? null : Math.round(Number(row.mempoolTx)),
            hashRate: row.hashRate == null ? null : Number(row.hashRate),
            miners: row.miners == null ? null : Number(row.miners),
        }));
    }

    public async deleteOlderThan(ms: number) {
        return await this.repository
            .createQueryBuilder()
            .delete()
            .from(ChainSampleEntity)
            .where('time < :time', { time: Date.now() - ms })
            .execute();
    }
}
