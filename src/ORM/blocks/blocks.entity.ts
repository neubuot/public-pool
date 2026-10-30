import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

import { TrackedEntity } from '../utils/TrackedEntity.entity';

@Entity()
export class BlocksEntity extends TrackedEntity {

    @PrimaryGeneratedColumn()
    id: number;

    @Column()
    height: number;

    @Column({ length: 62, type: 'varchar' })
    minerAddress: string;

    @Column()
    worker: string;

    @Column({ length: 8, type: 'varchar' })
    sessionId: string;

    @Column()
    blockData: string;

    /** BTC for the parent chain, DOI for a merge mined Doichain block */
    @Column({ length: 8, type: 'varchar', default: 'BTC' })
    chain: string;

    @Column({ length: 64, type: 'varchar', nullable: true })
    blockHash: string;

    /** node response to the submission */
    @Column({ type: 'varchar', nullable: true })
    result: string;

}