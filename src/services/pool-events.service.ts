import { Injectable } from '@nestjs/common';
import { Observable, Subject } from 'rxjs';

export type PoolEventType = 'share' | 'block' | 'connect' | 'disconnect' | 'vardiff' | 'tip';

export interface PoolEvent {
    /** unix time in milliseconds */
    t: number;
    type: PoolEventType;
    chain?: 'BTC' | 'DOI';
    address?: string;
    worker?: string;
    session?: string;
    data?: Record<string, unknown>;
}

/**
 * Live feed of pool happenings for the dashboard terminal (served as server-sent events by StatsController).
 * Keeps a short ring buffer so a new listener sees the recent past at once.
 */
@Injectable()
export class PoolEventsService {

    private static readonly BUFFER_SIZE = 400;

    private readonly subject = new Subject<PoolEvent>();
    private readonly buffer: PoolEvent[] = [];

    public get stream$(): Observable<PoolEvent> {
        return this.subject.asObservable();
    }

    public emit(event: Omit<PoolEvent, 't'> & { t?: number }) {
        const full: PoolEvent = { t: event.t ?? Date.now(), ...event } as PoolEvent;
        this.buffer.push(full);
        if (this.buffer.length > PoolEventsService.BUFFER_SIZE) {
            this.buffer.splice(0, this.buffer.length - PoolEventsService.BUFFER_SIZE);
        }
        this.subject.next(full);
    }

    /** Most recent events, oldest first. With an address only that miner's events plus pool wide ones. */
    public recent(address?: string, limit = 80): PoolEvent[] {
        const events = address == null
            ? this.buffer
            : this.buffer.filter(e => e.address == null || e.address === address);
        return events.slice(Math.max(0, events.length - limit));
    }
}
