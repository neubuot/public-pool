import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/** Best shares per miner address (the "closest calls"), kept to the top 25 per address. */
@Entity()
@Index(['address', 'difficulty'])
@Index(['difficulty'])
export class TopShareEntity {

    @PrimaryGeneratedColumn()
    id: number;

    @Column({ length: 62, type: 'varchar' })
    address: string;

    @Column({ length: 64, type: 'varchar' })
    worker: string;

    @Column({ length: 8, type: 'varchar' })
    sessionId: string;

    @Column({ length: 128, type: 'varchar', nullable: true })
    userAgent: string;

    @Column({ type: 'real' })
    difficulty: number;

    /** unix time in milliseconds */
    @Column({ type: 'integer' })
    time: number;
}
