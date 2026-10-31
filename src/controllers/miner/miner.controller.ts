import { BadRequestException, Controller, Get, Param, Query, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { validate } from 'bitcoin-address-validation';

import { MiningJob } from '../../models/MiningJob';
import { AddressSettingsService } from '../../ORM/address-settings/address-settings.service';
import { BlocksService } from '../../ORM/blocks/blocks.service';
import { ClientStatisticsService } from '../../ORM/client-statistics/client-statistics.service';
import { ClientService } from '../../ORM/client/client.service';
import { TopSharesService } from '../../ORM/top-shares/top-shares.service';
import { ChainStatsService } from '../../services/chain-stats.service';
import { DoichainRpcService } from '../../services/doichain-rpc.service';
import { StratumV1JobsService } from '../../services/stratum-v1-jobs.service';
import { describeCoinbaseOutputs, hasAuxTag, networkFor, payoutsFor } from '../../utils/coinbase-proof';

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
        private readonly topSharesService: TopSharesService,
        private readonly stratumV1JobsService: StratumV1JobsService,
        private readonly doichainRpcService: DoichainRpcService,
        private readonly configService: ConfigService,
    ) { }

    /**
     * The coinbase proof: the coinbase transaction the pool builds for this address from the newest block
     * template, decoded. A found block can only pay the outputs of this transaction, so the miner can check
     * that the reward goes to their own address (and compare coinb1/coinb2 with what their miner receives).
     */
    @Get(':address/coinbase')
    public async coinbase(@Param('address') address: string, @Query('doi') doiQuery?: string) {
        const networkName = `${this.configService.get('NETWORK') ?? 'mainnet'}`.toLowerCase();
        const network = networkFor(networkName);
        if (!ADDRESS_RE.test(address) || !validate(address)) {
            throw new BadRequestException('Keine gültige Bitcoin-Adresse');
        }
        const template = this.stratumV1JobsService.getLatestJobTemplate();
        if (template == null) {
            throw new ServiceUnavailableException('Noch keine Blockvorlage, Bitcoin Core gleicht vermutlich noch ab');
        }
        const clients = await this.clientService.getByAddress(address);
        const hashRate = clients.reduce((acc, client) => acc + (client.hashRate ?? 0), 0);
        const feeAddress = `${this.configService.get('DEV_FEE_ADDRESS') ?? ''}`.trim() || null;
        const payouts = payoutsFor(address, feeAddress, hashRate);

        const doiAddress = doiQuery != null && ADDRESS_RE.test(doiQuery)
            ? doiQuery
            : (clients.find(client => client.doiAddress != null)?.doiAddress ?? `${this.configService.get('DOICHAIN_DEFAULT_ADDRESS') ?? ''}`.trim() ?? null) || null;
        let auxBlock = null;
        let auxError: string | null = null;
        if (this.doichainRpcService.enabled && doiAddress != null) {
            try {
                auxBlock = await this.doichainRpcService.getAuxBlock(doiAddress);
            } catch (e) {
                auxError = e?.message ?? String(e);
            }
        }

        // the same construction as for a real job, just not registered as one
        const job = new MiningJob(this.configService, network, 'proof', payouts, template, auxBlock ?? undefined);
        const tx = job.cloneCoinbaseTransaction();
        const notify = JSON.parse(job.response(template));
        return {
            address,
            network: networkName,
            template: { height: template.blockData.height, ageMs: Math.max(0, Date.now() - template.blockData.creation), coinbaseValue: template.blockData.coinbasevalue, transactions: template.block.transactions.length - 1 },
            fee: { address: feeAddress, percent: payouts.find(p => p.address === feeAddress)?.percent ?? 0, thresholdHashRate: 50_000_000_000_000, hashRate },
            outputs: describeCoinbaseOutputs(tx, network, address, feeAddress),
            coinbaseHex: tx.toHex(),
            coinb1: notify.params[2],
            coinb2: notify.params[3],
            merkleBranches: template.merkle_branch.length,
            auxTag: hasAuxTag(tx),
            doichain: {
                enabled: this.doichainRpcService.enabled,
                address: doiAddress,
                block: auxBlock != null ? { height: auxBlock.height, hash: auxBlock.hash, coinbaseValue: auxBlock.coinbasevalue, chainId: auxBlock.chainid } : null,
                error: auxError
            }
        };
    }

    @Get(':address')
    public async miner(@Param('address') address: string) {
        if (!ADDRESS_RE.test(address)) {
            throw new BadRequestException('Keine Adresse');
        }
        const now = Date.now();
        const [clients, settings, blocks, chart, topShares] = await Promise.all([
            this.clientService.getByAddress(address),
            this.addressSettingsService.getSettings(address, false),
            this.blocksService.getRecentBlocksByAddress(address, 50),
            this.clientStatisticsService.getChartDataForAddress(address),
            this.topSharesService.forAddress(address, 10),
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
                doiAddress: client.doiAddress ?? null,
                shares: { accepted: client.sharesAccepted ?? 0, stale: client.sharesStale ?? 0, duplicate: client.sharesDuplicate ?? 0, lowDifficulty: client.sharesLowDiff ?? 0 },
                lastReject: client.lastRejectAt != null ? { at: client.lastRejectAt, reason: client.lastRejectReason ?? 'other' } : null
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
            bestDifficulty: Math.max(settings?.bestDifficulty ?? 0, topShares[0]?.difficulty ?? 0, ...workers.map(w => w.bestDifficulty)),
            bestDifficultyUserAgent: settings?.bestDifficultyUserAgent ?? topShares[0]?.userAgent ?? null,
            shares: settings?.shares ?? 0,
            topShares: topShares.map(share => ({ worker: share.worker, userAgent: share.userAgent ?? null, difficulty: share.difficulty, time: share.time })),
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
