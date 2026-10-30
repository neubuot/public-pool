import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Periodic sample of chain and pool figures for the dashboard charts (every 5 minutes, kept 90 days).
 * chain: BTC, DOI or POOL.
 */
@Entity()
@Index(['chain', 'time'])
export class ChainSampleEntity {

    @PrimaryGeneratedColumn()
    id: number;

    @Column({ length: 8, type: 'varchar' })
    chain: string;

    /** unix time in milliseconds */
    @Column({ type: 'integer' })
    time: number;

    @Column({ type: 'integer', nullable: true })
    height: number;

    @Column({ type: 'real', nullable: true })
    difficulty: number;

    @Column({ type: 'real', nullable: true })
    networkHashPs: number;

    @Column({ type: 'integer', nullable: true })
    mempoolTx: number;

    /** pool hash rate in H/s (chain POOL) */
    @Column({ type: 'real', nullable: true })
    hashRate: number;

    /** connected miners (chain POOL) */
    @Column({ type: 'integer', nullable: true })
    miners: number;
}
