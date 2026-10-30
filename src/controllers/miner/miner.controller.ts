import { BadRequestException, Controller, Get, Param } from '@nestjs/common';

import { AddressSettingsService } from '../../ORM/address-settings/address-settings.service';
import { BlocksService } from '../../ORM/blocks/blocks.service';
import { ClientStatisticsService } from '../../ORM/client-statistics/client-statistics.service';
import { ClientService } from '../../ORM/client/client.service';
import { ChainStatsService } from '../../services/chain-stats.service';

const ADDRESS_RE = /^[A-Za-z0-9]{20,90}$/;
const ONLINE_MS = 5 * 60 * 1000;

/** Everything one miner's dashboard needs, keyed by the Bitcoin address used as stratum user name. */
@Controller('miner')
export class MinerController {

    constructor(
        private readonly clientService: ClientService,
        private readonly clientStatisticsService: ClientStatisticsService,
        private readonly addressSettingsService: AddressSettingsService,
        private readonly blocksService: BlocksService,
        private readonly chainStatsService: ChainStatsService,
    ) { }

    @Get(':address')
    public async miner(@Param('address') address: string) {
        if (!ADDRESS_RE.test(address)) {
            throw new BadRequestException('Keine Adresse');
        }
        const now = Date.now();
        const [clients, settings, blocks, chart] = await Promise.all([
            this.clientService.getByAddress(address),
            this.addressSettingsService.getSettings(address, false),
            this.blocksService.getRecentBlocksByAddress(address, 50),
            this.clientStatisticsService.getChartDataForAddress(address),
        ]);

        const workers = clients.map(client => {
            const lastSeen = client.updatedAt instanceof Date ? client.updatedAt : new Date(client.updatedAt as any);
            return {
                name: client.clientName,
                sessionId: client.sessionId,
                userAgent: client.userAgent,
                hashRate: client.hashRate ?? 0,
                bestDifficulty: client.bestDifficulty ?? 0,
                startTime: client.startTime,
                lastSeen,
                online: Number.isFinite(lastSeen.getTime()) && now - lastSeen.getTime() < ONLINE_MS,
                doiAddress: client.doiAddress ?? null
            };
        }).sort((a, b) => b.hashRate - a.hashRate);

        const hashRate = workers.reduce((acc, worker) => acc + (worker.online ? worker.hashRate : 0), 0);
        const doiAddresses = Array.from(new Set(workers.map(w => w.doiAddress).filter(a => a != null)));
        const snapshot = this.chainStatsService.current();

        return {
            address,
            doiAddress: doiAddresses[0] ?? null,
            doiAddresses,
            hashRate,
            workersOnline: workers.filter(w => w.online).length,
            workersCount: workers.length,
            bestDifficulty: settings?.bestDifficulty ?? workers.reduce((acc, w) => Math.max(acc, w.bestDifficulty), 0),
            bestDifficultyUserAgent: settings?.bestDifficultyUserAgent ?? null,
            shares: settings?.shares ?? 0,
            workers,
            blocks: blocks.map(block => ({
                chain: block.chain,
                height: block.height,
                blockHash: block.blockHash,
                worker: block.worker,
                result: block.result,
                accepted: block.result == null || /^(success!|accepted)$/i.test(block.result),
                time: block.createdAt
            })),
            odds: {
                bitcoin: this.chainStatsService.oddsFor(hashRate, snapshot?.bitcoin?.syncing ? null : snapshot?.bitcoin?.difficulty ?? null),
                doichain: this.chainStatsService.oddsFor(hashRate, snapshot?.doichain?.difficulty ?? null)
            },
            chart
        };
    }

    @Get(':address/worker/:name')
    public async worker(@Param('address') address: string, @Param('name') name: string) {
        if (!ADDRESS_RE.test(address) || name.length === 0 || name.length > 64) {
            throw new BadRequestException('Keine Adresse oder kein Worker-Name');
        }
        const clients = await this.clientService.getByName(address, name);
        const chart = await this.clientStatisticsService.getChartDataForGroup(address, name);
        return {
            address,
            name,
            sessions: clients.map(client => ({
                sessionId: client.sessionId,
                userAgent: client.userAgent,
                hashRate: client.hashRate ?? 0,
                bestDifficulty: client.bestDifficulty ?? 0,
                startTime: client.startTime,
                lastSeen: client.updatedAt,
                doiAddress: client.doiAddress ?? null
            })),
            bestDifficulty: clients.reduce((acc, c) => Math.max(acc, c.bestDifficulty ?? 0), 0),
            chart
        };
    }
}
