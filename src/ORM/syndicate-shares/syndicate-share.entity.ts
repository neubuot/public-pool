import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

/**
 * Share work of syndicate members, summed per Doichain address and hour (bucket = unix ms of the hour).
 * The payout split reads the buckets inside the window, so no single share has to be stored.
 */
@Entity({ withoutRowid: true })
@Index(['bucket'])
export class SyndicateShareEntity {

    @PrimaryColumn({ length: 90, type: 'varchar' })
    doiAddress: string;

    /** start of the hour, unix time in milliseconds */
    @PrimaryColumn({ type: 'integer' })
    bucket: number;

    /** sum of the share difficulty (the work the shares stand for) */
    @Column({ type: 'real', default: 0 })
    work: number;

    @Column({ type: 'integer', default: 0 })
    shares: number;
}
