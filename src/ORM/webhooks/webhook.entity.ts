import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

import { WebhookKind } from '../../utils/webhook-targets';

/** A notification target of one miner address: an ntfy topic, a Discord webhook or a JSON endpoint. */
@Entity()
@Index(['address'])
export class WebhookEntity {

    @PrimaryGeneratedColumn()
    id: number;

    @Column({ length: 62, type: 'varchar' })
    address: string;

    @Column({ length: 512, type: 'varchar' })
    url: string;

    @Column({ length: 16, type: 'varchar' })
    kind: WebhookKind;

    /** switched off after too many failed deliveries in a row, switched on again by saving the URL once more */
    @Column({ default: true })
    enabled: boolean;

    @Column({ type: 'integer', default: 0 })
    failures: number;

    @Column({ length: 200, type: 'varchar', nullable: true })
    lastError: string | null;

    /** unix time in milliseconds */
    @Column({ type: 'integer', nullable: true })
    lastDeliveredAt: number | null;

    /** unix time in milliseconds */
    @Column({ type: 'integer' })
    createdAt: number;
}
