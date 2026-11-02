import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/** One coinbase output of a syndicate Doichain block: who got how much and why. */
@Entity()
@Index(['doiAddress', 'id'])
@Index(['height'])
export class SyndicatePayoutEntity {

    @PrimaryGeneratedColumn()
    id: number;

    @Column({ type: 'integer' })
    height: number;

    @Column({ length: 64, type: 'varchar' })
    blockHash: string;

    @Column({ length: 90, type: 'varchar' })
    doiAddress: string;

    /** integer coin units (1e-8 DOI) */
    @Column({ type: 'integer' })
    amount: number;

    /** share of the reward, 0..1 */
    @Column({ type: 'real' })
    percent: number;

    /** the member's share work inside the window when the block was built */
    @Column({ type: 'real', default: 0 })
    work: number;

    /** Bitcoin address and worker of the device that found the block */
    @Column({ length: 62, type: 'varchar' })
    finderAddress: string;

    @Column({ length: 64, type: 'varchar', default: '' })
    finderWorker: string;

    @Column({ type: 'boolean', default: true })
    accepted: boolean;

    /** unix time in milliseconds */
    @Column({ type: 'integer' })
    time: number;
}
