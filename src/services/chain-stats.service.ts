import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { AddressSettingsService } from '../ORM/address-settings/address-settings.service';
import { BlocksService } from '../ORM/blocks/blocks.service';
import { ChainSampleService } from '../ORM/chain-sample/chain-sample.service';
import { ClientService } from '../ORM/client/client.service';
import { BitcoinRpcService } from './bitcoin-rpc.service';
import { DoichainRpcService } from './doichain-rpc.service';
import { PoolEventsService } from './pool-events.service';

const DEFAULT_PRICE_URL = 'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,doichain&vs_currencies=eur';
const REFRESH_MS = 30 * 1000;
const SAMPLE_MS = 5 * 60 * 1000;
const SAMPLE_KEEP_MS = 90 * 24 * 60 * 60 * 1000;
const PRICE_MS = 10 * 60 * 1000;
const TWO_POW_32 = 4294967296;

export interface ChainOdds {
    /** mean time between blocks at this hash rate, seconds */
    expectedSeconds: number | null;
    perHour: number | null;
    perDay: number | null;
    per30Days: number | null;
    perYear: number | null;
}

export interface DifficultyAdjustment {
    period: number;
    blocksElapsed: number;
    blocksRemaining: number;
    progress: number;
    /** relative change, 0.05 = +5 %, null while unknown */
    estimatedChange: number | null;
    /** unix seconds */
    estimatedAt: number | null;
}

export interface ChainStats {
    chain: 'BTC' | 'DOI';
    enabled: boolean;
    reachable: boolean;
    syncing: boolean;
    blocks: number | null;
    headers: number | null;
    verificationProgress: number | null;
    difficulty: number | null;
    networkHashPs: number | null;
    mempoolTx: number | null;
    mempoolBytes: number | null;
    /** unix seconds */
    lastBlockTime: number | null;
    lastBlockHash: string | null;
    /** block subsidy in coins at the current height */
    blockSubsidy: number | null;
    /** mean interval of the last 144 blocks, seconds */
    avgBlockIntervalSec: number | null;
    difficultyAdjustment: DifficultyAdjustment | null;
    pruned: boolean;
    network: string | null;
    error: string | null;
}

export interface FoundBlockSummary {
    chain: string;
    height: number;
    blockHash: string | null;
    minerAddress: string;
    worker: string;
    accepted: boolean;
    result: string | null;
    time: string | null;
}

export interface PoolStats {
    hashRate: number;
    miners: number;
    userAgents: { userAgent: string, count: number, bestDifficulty: number, totalHashRate: number }[];
    bestDifficulty: number | null;
    bestDifficultyUserAgent: string | null;
    highScores: { updatedAt: string, bestDifficulty: number, bestDifficultyUserAgent: string }[];
    blocksFound: { BTC: { found: number, accepted: number }, DOI: { found: number, accepted: number } };
    recentBlocks: FoundBlockSummary[];
    since: string;
    jobsActive: boolean;
}

export interface StatsSnapshot {
    time: string;
    bitcoin: ChainStats;
    doichain: ChainStats;
    pool: PoolStats;
    odds: { bitcoin: ChainOdds, doichain: ChainOdds };
    prices: { btcEur: number | null, doiEur: number | null, updatedAt: string } | null;
}

function emptyChain(chain: 'BTC' | 'DOI', enabled: boolean): ChainStats {
    return {
        chain, enabled, reachable: false, syncing: false, blocks: null, headers: null, verificationProgress: null,
        difficulty: null, networkHashPs: null, mempoolTx: null, mempoolBytes: null, lastBlockTime: null, lastBlockHash: null,
        blockSubsidy: null, avgBlockIntervalSec: null, difficultyAdjustment: null, pruned: false, network: null, error: null
    };
}

function isAccepted(result: string | null): boolean {
    if (result == null) {
        return true;
    }
    const lower = result.toLowerCase();
    return lower === 'success!' || lower === 'accepted' || lower === 'null';
}

interface RpcSource {
    rpc<T>(method: string, params?: unknown[]): Promise<T>;
}

/**
 * Keeps a fresh picture of both chains and the pool for the dashboard (/api/stats), stores a sample every
 * five minutes for the history charts (/api/stats/history) and announces new chain tips on the event feed.
 */
@Injectable()
export class ChainStatsService implements OnModuleInit {

    private snapshot: StatsSnapshot | null = null;
    private refreshing = false;
    private lastSampleAt = 0;
    private lastCleanupAt = 0;
    private prices: StatsSnapshot['prices'] = null;
    private pricesFetchedAt = 0;
    private readonly subsidyCache = new Map<string, number>();
    private readonly intervalCache = new Map<string, number>();
    private readonly periodStartCache = new Map<number, number>();
    private readonly uptime = new Date();

    constructor(
        private readonly bitcoinRpcService: BitcoinRpcService,
        private readonly doichainRpcService: DoichainRpcService,
        private readonly clientService: ClientService,
        private readonly addressSettingsService: AddressSettingsService,
        private readonly blocksService: BlocksService,
        private readonly chainSampleService: ChainSampleService,
        private readonly poolEventsService: PoolEventsService,
        private readonly configService: ConfigService,
    ) { }

    onModuleInit() {
        // the RPC clients are created in their own onModuleInit, give them a moment
        setTimeout(() => this.refresh(), 4000);
        setInterval(() => this.refresh(), REFRESH_MS);
        this.bitcoinRpcService.newBlock$.subscribe(() => this.refresh());
        if (this.doichainRpcService.enabled) {
            this.doichainRpcService.newBlock$.subscribe(() => this.refresh());
        }
    }

    public current(): StatsSnapshot | null {
        return this.snapshot;
    }

    /** Chance of finding a block with hashRate H/s at a difficulty: 1 - exp(-T / expected). */
    public oddsFor(hashRate: number | null, difficulty: number | null): ChainOdds {
        if (hashRate == null || difficulty == null || hashRate <= 0 || difficulty <= 0) {
            return { expectedSeconds: null, perHour: null, perDay: null, per30Days: null, perYear: null };
        }
        const expectedSeconds = difficulty * TWO_POW_32 / hashRate;
        const p = (seconds: number) => 1 - Math.exp(-seconds / expectedSeconds);
        return {
            expectedSeconds,
            perHour: p(3600),
            perDay: p(86400),
            per30Days: p(30 * 86400),
            perYear: p(365.25 * 86400)
        };
    }

    public async refresh() {
        if (this.refreshing) {
            return;
        }
        this.refreshing = true;
        try {
            const previous = this.snapshot;
            const [bitcoin, doichain, pool] = await Promise.all([
                this.refreshBitcoin(previous?.bitcoin),
                this.refreshDoichain(previous?.doichain),
                this.refreshPool(),
            ]);
            await this.refreshPrices();

            this.snapshot = {
                time: new Date().toISOString(),
                bitcoin,
                doichain,
                pool,
                odds: {
                    bitcoin: this.oddsFor(pool.hashRate, bitcoin.syncing ? null : bitcoin.difficulty),
                    doichain: this.oddsFor(pool.hashRate, doichain.difficulty)
                },
                prices: this.prices
            };

            this.announceTips(previous, this.snapshot);
            await this.sample(this.snapshot);
        } catch (e) {
            console.error('Chain stats refresh failed:', e?.message ?? e);
        } finally {
            this.refreshing = false;
        }
    }

    private announceTips(previous: StatsSnapshot | null, next: StatsSnapshot) {
        if (previous == null) {
            return;
        }
        for (const [key, chain] of [['bitcoin', 'BTC'], ['doichain', 'DOI']] as const) {
            const before = previous[key];
            const after = next[key];
            if (after.blocks != null && before.blocks != null && after.blocks !== before.blocks && !after.syncing) {
                this.poolEventsService.emit({
                    type: 'tip', chain,
                    data: { height: after.blocks, hash: after.lastBlockHash, difficulty: after.difficulty }
                });
            }
        }
    }

    private async refreshBitcoin(previous?: ChainStats): Promise<ChainStats> {
        const base = previous ?? emptyChain('BTC', true);
        try {
            const info = await this.bitcoinRpcService.rpc<any>('getblockchaininfo');
            const mining = this.bitcoinRpcService.miningInfo ?? await this.bitcoinRpcService.rpc<any>('getmininginfo').catch(() => null);
            const mempool = await this.bitcoinRpcService.rpc<any>('getmempoolinfo').catch(() => null);
            const header = await this.bitcoinRpcService.rpc<any>('getblockheader', [info.bestblockhash]).catch(() => null);
            const syncing = info.initialblockdownload === true;
            const subsidy = await this.subsidy(this.bitcoinRpcService, 'BTC', info.blocks, h => 50 * Math.pow(0.5, Math.floor(h / 210000)));
            const avgInterval = await this.averageInterval(this.bitcoinRpcService, 'BTC', info.blocks, header?.time ?? null, 144);
            const adjustment = await this.bitcoinAdjustment(info.blocks, header?.time ?? null, avgInterval);
            return {
                chain: 'BTC', enabled: true, reachable: true, syncing,
                blocks: info.blocks, headers: info.headers, verificationProgress: info.verificationprogress,
                difficulty: info.difficulty, networkHashPs: mining?.networkhashps ?? null,
                mempoolTx: mempool?.size ?? null, mempoolBytes: mempool?.bytes ?? null,
                lastBlockTime: header?.time ?? null, lastBlockHash: info.bestblockhash,
                blockSubsidy: subsidy, avgBlockIntervalSec: avgInterval, difficultyAdjustment: adjustment,
                pruned: info.pruned === true, network: info.chain, error: null
            };
        } catch (e) {
            return { ...base, reachable: false, error: e?.message ?? String(e) };
        }
    }

    private async refreshDoichain(previous?: ChainStats): Promise<ChainStats> {
        const base = previous ?? emptyChain('DOI', this.doichainRpcService.enabled);
        if (!this.doichainRpcService.enabled) {
            return base;
        }
        try {
            const info = await this.doichainRpcService.rpc<any>('getblockchaininfo');
            const mining = await this.doichainRpcService.rpc<any>('getmininginfo').catch(() => null);
            const mempool = await this.doichainRpcService.rpc<any>('getmempoolinfo').catch(() => null);
            const header = await this.doichainRpcService.rpc<any>('getblockheader', [info.bestblockhash]).catch(() => null);
            const subsidy = await this.subsidy(this.doichainRpcService, 'DOI', info.blocks, () => null);
            const avgInterval = await this.averageInterval(this.doichainRpcService, 'DOI', info.blocks, header?.time ?? null, 144);
            return {
                chain: 'DOI', enabled: true, reachable: true, syncing: info.initialblockdownload === true,
                blocks: info.blocks, headers: info.headers, verificationProgress: info.verificationprogress,
                difficulty: info.difficulty, networkHashPs: mining?.networkhashps ?? null,
                mempoolTx: mempool?.size ?? null, mempoolBytes: mempool?.bytes ?? null,
                lastBlockTime: header?.time ?? null, lastBlockHash: info.bestblockhash,
                blockSubsidy: subsidy, avgBlockIntervalSec: avgInterval, difficultyAdjustment: null,
                pruned: info.pruned === true, network: info.chain, error: null
            };
        } catch (e) {
            return { ...base, reachable: false, error: e?.message ?? String(e) };
        }
    }

    private async refreshPool(): Promise<PoolStats> {
        const userAgents = await this.clientService.getUserAgents();
        const highScores = await this.addressSettingsService.getHighScores();
        const blocks = await this.blocksService.getRecentBlocks(500);

        const blocksFound = { BTC: { found: 0, accepted: 0 }, DOI: { found: 0, accepted: 0 } };
        for (const block of blocks) {
            const key = block.chain === 'DOI' ? 'DOI' : 'BTC';
            blocksFound[key].found++;
            if (isAccepted(block.result)) {
                blocksFound[key].accepted++;
            }
        }
        const agents = userAgents.map(agent => ({
            userAgent: agent.userAgent,
            count: parseInt(agent.count) || 0,
            bestDifficulty: parseFloat(agent.bestDifficulty) || 0,
            totalHashRate: parseFloat(agent.totalHashRate) || 0
        }));
        const best = highScores[0];

        return {
            hashRate: agents.reduce((acc, agent) => acc + agent.totalHashRate, 0),
            miners: agents.reduce((acc, agent) => acc + agent.count, 0),
            userAgents: agents,
            bestDifficulty: best?.bestDifficulty ?? null,
            bestDifficultyUserAgent: best?.bestDifficultyUserAgent ?? null,
            highScores,
            blocksFound,
            recentBlocks: blocks.slice(0, 10).map(block => ({
                chain: block.chain,
                height: block.height,
                blockHash: block.blockHash,
                minerAddress: block.minerAddress,
                worker: block.worker,
                accepted: isAccepted(block.result),
                result: block.result,
                time: block.createdAt instanceof Date ? block.createdAt.toISOString() : (block.createdAt as any) ?? null
            })),
            since: this.uptime.toISOString(),
            jobsActive: this.bitcoinRpcService.syncing === false
        };
    }

    private async refreshPrices() {
        const url = this.configService.get('PRICE_URL') ?? DEFAULT_PRICE_URL;
        if (url === 'off' || url.length === 0 || Date.now() - this.pricesFetchedAt < PRICE_MS) {
            return;
        }
        this.pricesFetchedAt = Date.now();
        try {
            const response = await fetch(url, { signal: AbortSignal.timeout(8000), headers: { 'User-Agent': 'NerdPool/1.0' } });
            if (!response.ok) {
                return;
            }
            const data: any = await response.json();
            this.prices = {
                btcEur: Number.isFinite(data?.bitcoin?.eur) ? data.bitcoin.eur : null,
                doiEur: Number.isFinite(data?.doichain?.eur) ? data.doichain.eur : null,
                updatedAt: new Date().toISOString()
            };
        } catch (e) {
            // prices are decoration, stay quiet
        }
    }

    private async sample(snapshot: StatsSnapshot) {
        const now = Date.now();
        if (now - this.lastSampleAt < SAMPLE_MS) {
            return;
        }
        this.lastSampleAt = now;
        try {
            for (const chain of [snapshot.bitcoin, snapshot.doichain]) {
                if (chain.reachable && !chain.syncing) {
                    await this.chainSampleService.insert({
                        chain: chain.chain, time: now, height: chain.blocks, difficulty: chain.difficulty,
                        networkHashPs: chain.networkHashPs, mempoolTx: chain.mempoolTx
                    });
                }
            }
            await this.chainSampleService.insert({
                chain: 'POOL', time: now, hashRate: snapshot.pool.hashRate, miners: snapshot.pool.miners
            });
            if (now - this.lastCleanupAt > 24 * 60 * 60 * 1000) {
                this.lastCleanupAt = now;
                await this.chainSampleService.deleteOlderThan(SAMPLE_KEEP_MS);
            }
        } catch (e) {
            console.error('Chain sample failed:', e?.message ?? e);
        }
    }

    /** Block subsidy in coins via getblockstats, cached per height; fallback formula for Bitcoin. */
    private async subsidy(source: RpcSource, chain: string, height: number, fallback: (h: number) => number | null): Promise<number | null> {
        const key = `${chain}:${height}`;
        if (this.subsidyCache.has(key)) {
            return this.subsidyCache.get(key);
        }
        let value: number | null = null;
        try {
            const stats = await source.rpc<{ subsidy: number }>('getblockstats', [height, ['subsidy']]);
            value = stats?.subsidy != null ? stats.subsidy / 1e8 : null;
        } catch (e) {
            value = fallback(height);
        }
        if (value != null) {
            this.subsidyCache.clear();
            this.subsidyCache.set(key, value);
        }
        return value;
    }

    /** Mean block interval over the last n blocks, cached per tip height. */
    private async averageInterval(source: RpcSource, chain: string, height: number, tipTime: number | null, n: number): Promise<number | null> {
        if (tipTime == null || height == null || height <= n) {
            return null;
        }
        const key = `${chain}:${height}`;
        if (this.intervalCache.has(key)) {
            return this.intervalCache.get(key);
        }
        try {
            const hash = await source.rpc<string>('getblockhash', [height - n]);
            const header = await source.rpc<{ time: number }>('getblockheader', [hash]);
            const value = (tipTime - header.time) / n;
            this.intervalCache.clear();
            this.intervalCache.set(key, value);
            return value;
        } catch (e) {
            return null;
        }
    }

    private async bitcoinAdjustment(height: number, tipTime: number | null, avgInterval: number | null): Promise<DifficultyAdjustment | null> {
        const period = 2016;
        if (height == null) {
            return null;
        }
        const periodStart = height - (height % period);
        const blocksElapsed = height - periodStart;
        const blocksRemaining = period - blocksElapsed;
        let estimatedChange: number | null = null;
        try {
            if (blocksElapsed >= 10 && tipTime != null) {
                let startTime = this.periodStartCache.get(periodStart);
                if (startTime == null) {
                    const hash = await this.bitcoinRpcService.rpc<string>('getblockhash', [periodStart]);
                    const header = await this.bitcoinRpcService.rpc<{ time: number }>('getblockheader', [hash]);
                    startTime = header.time;
                    this.periodStartCache.clear();
                    this.periodStartCache.set(periodStart, startTime);
                }
                const actual = tipTime - startTime;
                if (actual > 0) {
                    estimatedChange = Math.max(-0.75, Math.min(3, (blocksElapsed * 600) / actual - 1));
                }
            }
        } catch (e) {
            estimatedChange = null;
        }
        const interval = avgInterval ?? 600;
        return {
            period,
            blocksElapsed,
            blocksRemaining,
            progress: blocksElapsed / period,
            estimatedChange,
            estimatedAt: Math.floor(Date.now() / 1000) + Math.round(blocksRemaining * interval)
        };
    }
}
