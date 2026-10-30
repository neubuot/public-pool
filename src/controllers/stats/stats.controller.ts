import { BadRequestException, Controller, Get, Query, Req, Res, ServiceUnavailableException } from '@nestjs/common';
import { FastifyReply, FastifyRequest } from 'fastify';
import { filter } from 'rxjs';

import { ChainSampleService } from '../../ORM/chain-sample/chain-sample.service';
import { ChainStatsService } from '../../services/chain-stats.service';
import { PoolEvent, PoolEventsService } from '../../services/pool-events.service';

const RANGES: Record<string, { sinceMs: number, bucketMs: number }> = {
    '24h': { sinceMs: 24 * 60 * 60 * 1000, bucketMs: 5 * 60 * 1000 },
    '7d': { sinceMs: 7 * 24 * 60 * 60 * 1000, bucketMs: 30 * 60 * 1000 },
    '30d': { sinceMs: 30 * 24 * 60 * 60 * 1000, bucketMs: 2 * 60 * 60 * 1000 },
    '90d': { sinceMs: 90 * 24 * 60 * 60 * 1000, bucketMs: 6 * 60 * 60 * 1000 },
};

const ADDRESS_RE = /^[A-Za-z0-9]{20,90}$/;

@Controller('stats')
export class StatsController {

    constructor(
        private readonly chainStatsService: ChainStatsService,
        private readonly chainSampleService: ChainSampleService,
        private readonly poolEventsService: PoolEventsService,
    ) { }

    /** Everything the dashboard shows at once: both chains, pool, odds, prices. Refreshed every 30 s. */
    @Get()
    public stats() {
        const snapshot = this.chainStatsService.current();
        if (snapshot == null) {
            throw new ServiceUnavailableException('Statistik wird gerade zum ersten Mal erhoben');
        }
        return snapshot;
    }

    /** Time series for the charts. range: 24h (5 min), 7d (30 min), 30d (2 h), 90d (6 h). */
    @Get('history')
    public async history(@Query('range') range = '24h') {
        const spec = RANGES[range];
        if (spec == null) {
            throw new BadRequestException(`range muss eines von ${Object.keys(RANGES).join(', ')} sein`);
        }
        const since = Date.now() - spec.sinceMs;
        const [bitcoin, doichain, pool] = await Promise.all([
            this.chainSampleService.history('BTC', since, spec.bucketMs),
            this.chainSampleService.history('DOI', since, spec.bucketMs),
            this.chainSampleService.history('POOL', since, spec.bucketMs),
        ]);
        return { range, bucketMs: spec.bucketMs, since: new Date(since).toISOString(), bitcoin, doichain, pool };
    }

    /**
     * Server-sent events: shares, blocks, connects, difficulty changes and chain tips. With ?address= only that
     * miner's events plus the pool wide ones. Without an address, shares are throttled to 10 per second.
     */
    @Get('events')
    public events(@Req() request: FastifyRequest, @Res() reply: FastifyReply, @Query('address') address?: string) {
        const filterAddress = address != null && ADDRESS_RE.test(address) ? address : null;

        reply.hijack();
        const raw = reply.raw;
        raw.writeHead(200, {
            'Content-Type': 'text/event-stream; charset=utf-8',
            'Cache-Control': 'no-cache, no-transform',
            'Connection': 'keep-alive',
            'X-Accel-Buffering': 'no',
            'Access-Control-Allow-Origin': '*'
        });
        raw.write(': nerdpool events\n\n');

        const send = (event: PoolEvent) => {
            raw.write(`data: ${JSON.stringify(event)}\n\n`);
        };

        for (const event of this.poolEventsService.recent(filterAddress ?? undefined)) {
            send(event);
        }

        let windowStart = Date.now();
        let sharesInWindow = 0;
        const subscription = this.poolEventsService.stream$
            .pipe(filter(event => {
                if (filterAddress != null) {
                    return event.address == null || event.address === filterAddress;
                }
                if (event.type !== 'share') {
                    return true;
                }
                const now = Date.now();
                if (now - windowStart >= 1000) {
                    windowStart = now;
                    sharesInWindow = 0;
                }
                sharesInWindow++;
                return sharesInWindow <= 10;
            }))
            .subscribe(send);

        const ping = setInterval(() => raw.write(': ping\n\n'), 25000);
        const close = () => {
            clearInterval(ping);
            subscription.unsubscribe();
        };
        request.raw.on('close', close);
        request.raw.on('error', close);
    }
}
