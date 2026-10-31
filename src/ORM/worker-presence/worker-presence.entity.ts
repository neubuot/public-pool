import { Column, Entity, PrimaryColumn } from 'typeorm';

/**
 * Last known state of one worker (address + worker name) for the Telegram offline alerts. Kept apart from
 * client_entity, whose rows come and go with every stratum session and are purged after a day.
 */
@Entity({ withoutRowid: true })
export class WorkerPresenceEntity {

    @PrimaryColumn({ length: 62, type: 'varchar' })
    address: string;

    @PrimaryColumn({ length: 64, type: 'varchar' })
    worker: string;

    @Column({ length: 128, type: 'varchar', nullable: true })
    userAgent: string | null;

    /** unix time in milliseconds of the last heartbeat or share of any session of this worker */
    @Column({ type: 'integer' })
    lastSeen: number;

    /** the state the subscribers were last told about */
    @Column({ length: 8, type: 'varchar' })
    state: 'online' | 'offline';

    /** unix time in milliseconds of the last sign of life before the worker was reported offline, null while online */
    @Column({ type: 'integer', nullable: true })
    offlineSince: number | null;

    /** unix time in milliseconds of the last state change */
    @Column({ type: 'integer' })
    changedAt: number;
}
