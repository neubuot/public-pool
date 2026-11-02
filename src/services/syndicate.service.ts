import { Injectable, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { skip, Subscription } from 'rxjs';

import { BlocksService } from '../ORM/blocks/blocks.service';
import { ClientService } from '../ORM/client/client.service';
import { SyndicatePayoutsService } from '../ORM/syndicate-payouts/syndicate-payouts.service';
import { SyndicateShareDelta, SyndicateSharesService } from '../ORM/syndicate-shares/syndicate-shares.service';
import { AuxPayoutScript, buildAuxBlock, BuiltAuxBlock, serializeAuxBlock } from '../utils/aux-block';
import { splitReward, SyndicatePayout } from '../utils/syndicate-split';
import { DoichainRpcService } from './doichain-rpc.service';
import { NotificationService } from './notification.service';
import { PoolEventsService } from './pool-events.service';

const HOUR_MS = 60 * 60 * 1000;
const COIN = 100_000_000;
const FLUSH_MS = 15 * 1000;
const RETENTION_DAYS = 90;
const ONLINE_MS = 5 * 60 * 1000;

/** The syndicate block as handed to MiningJob: an aux block plus everything needed to submit it. */
export interface SyndicateAuxBlock extends BuiltAuxBlock {
    syndicate: true;
    builtAt: number;
    members: SyndicatePayout[];
    windowWork: number;
    /** the block pays only the requesting address because nobody had work inside the window yet */
    fallback: boolean;
}

export interface SyndicateDistributionEntry {
    address: string;
    work: number;
    percent: number;
    /** integer units of the current block, null before the first block is built */
    amount: number | null;
}

export interface SyndicateStats {
    enabled: boolean;
    windowHours: number;
    minPayoutDoi: number;
    maxMembers: number;
    /** Doichain addresses with work inside the window */
    members: number;
    /** devices in syndicate mode that reported within the last five minutes, and their hash rate */
    devicesOnline: number;
    hashRate: number;
    /** sum of the share work inside the window */
    work: number;
    distribution: SyndicateDistributionEntry[];
    othersPercent: number;
    blocksFound: number;
    paidOutDoi: number;
    membersPaid: number;
    lastBlock: { height: number, blockHash: string, time: number, accepted: boolean, members: number, totalDoi: number, finderWorker: string } | null;
    current: { height: number, hash: string, members: number, coinbaseValueDoi: number, builtAt: number, transactions: number, droppedTransactions: number } | null;
}

export interface SyndicatePayoutView {
    height: number;
    blockHash: string;
    doiAddress: string;
    amountDoi: number;
    percent: number;
    accepted: boolean;
    time: number;
    finderWorker: string;
}

export interface SyndicateMemberInfo {
    /** at least one device of the address mines in syndicate mode right now */
    active: boolean;
    /** has work inside the window (gets paid by the next block) */
    inWindow: boolean;
    work: number;
    percent: number;
    /** expected DOI from the next syndicate block */
    perBlockDoi: number;
    paidOutDoi: number;
    blocksPaid: number;
    payouts: SyndicatePayoutView[];
}

/**
 * Syndicate mode: members share Doichain block rewards in proportion to their share work of the last
 * `SYNDICATE_WINDOW_HOURS`. Non custodial: the pool builds the Doichain block itself with a coinbase that
 * pays every member directly (see utils/aux-block.ts) and submits it with `submitblock`.
 *
 * Share work is summed per address and hour in memory and flushed to the database every 15 seconds.
 */
@Injectable()
export class SyndicateService implements OnModuleInit, OnModuleDestroy {

    public readonly enabled: boolean;
    public readonly windowHours: number;
    public readonly minPayout: number;
    public readonly maxMembers: number;
    private readonly refreshMs: number;
    private readonly tag: string;

    private pending = new Map<string, SyndicateShareDelta>();
    private cache: SyndicateAuxBlock | null = null;
    private building: Promise<SyndicateAuxBlock> | null = null;
    private timers: NodeJS.Timeout[] = [];
    private blockSubscription: Subscription | null = null;
    private lastBuildErrorLog = 0;

    constructor(
        private readonly configService: ConfigService,
        private readonly doichainRpcService: DoichainRpcService,
        private readonly sharesService: SyndicateSharesService,
        private readonly payoutsService: SyndicatePayoutsService,
        private readonly blocksService: BlocksService,
        private readonly clientService: ClientService,
        @Optional() private readonly notificationService?: NotificationService,
        @Optional() private readonly poolEventsService?: PoolEventsService,
    ) {
        const auxpow = `${this.configService.get('AUXPOW_ENABLED') ?? ''}`.toLowerCase() === 'true';
        const flag = `${this.configService.get('SYNDICATE_ENABLED') ?? 'true'}`.toLowerCase();
        this.enabled = auxpow && flag !== 'false' && flag !== '0' && flag !== 'off';
        this.windowHours = Math.max(1, parseFloat(this.configService.get('SYNDICATE_WINDOW_HOURS')) || 24);
        const minPayoutDoi = parseFloat(this.configService.get('SYNDICATE_MIN_PAYOUT_DOI'));
        this.minPayout = Math.max(546, Math.round((Number.isFinite(minPayoutDoi) ? minPayoutDoi : 0.001) * COIN));
        this.maxMembers = Math.min(1000, Math.max(1, parseInt(this.configService.get('SYNDICATE_MAX_MEMBERS')) || 250));
        this.refreshMs = parseInt(this.configService.get('DOICHAIN_AUXBLOCK_REFRESH_MS')) || 10000;
        this.tag = `${this.configService.get('POOL_IDENTIFIER') || 'NerdPool'}/syndicate/`;
    }

    onModuleInit() {
        if (!this.enabled) {
            return;
        }
        console.log(`Syndicate mode on: window ${this.windowHours} h, minimum payout ${this.minPayout / COIN} DOI, up to ${this.maxMembers} members`);
        this.blockSubscription = this.doichainRpcService.newBlock$.pipe(skip(1)).subscribe(() => this.invalidate());
        this.timers.push(setInterval(() => void this.flush(), FLUSH_MS));
        this.timers.push(setInterval(() => void this.cleanup(), 6 * HOUR_MS));
        void this.cleanup();
    }

    async onModuleDestroy() {
        this.timers.forEach(timer => clearInterval(timer));
        this.timers = [];
        this.blockSubscription?.unsubscribe();
        await this.flush();
    }

    private get windowMs(): number {
        return this.windowHours * HOUR_MS;
    }

    /** first bucket inside the window (buckets are hours, so the window is rounded up to whole hours) */
    private sinceBucket(now = Date.now()): number {
        return Math.floor((now - this.windowMs) / HOUR_MS) * HOUR_MS;
    }

    // ---- share accounting ---------------------------------------------------------------------------

    /** Counts an accepted share of a syndicate member (difficulty = the share's target difficulty). */
    public recordShare(doiAddress: string, difficulty: number, now = Date.now()) {
        if (!this.enabled || doiAddress == null || !(difficulty > 0)) {
            return;
        }
        const bucket = Math.floor(now / HOUR_MS) * HOUR_MS;
        const key = `${doiAddress}|${bucket}`;
        const delta = this.pending.get(key);
        if (delta != null) {
            delta.work += difficulty;
            delta.shares++;
        } else {
            this.pending.set(key, { doiAddress, bucket, work: difficulty, shares: 1 });
        }
    }

    public async flush(): Promise<void> {
        if (this.pending.size === 0) {
            return;
        }
        const deltas = Array.from(this.pending.values());
        this.pending = new Map();
        try {
            await this.sharesService.add(deltas);
        } catch (e) {
            console.error('Syndicate share flush failed, keeping the work in memory', e?.message ?? e);
            for (const delta of deltas) {
                this.recordPendingBack(delta);
            }
        }
    }

    private recordPendingBack(delta: SyndicateShareDelta) {
        const key = `${delta.doiAddress}|${delta.bucket}`;
        const existing = this.pending.get(key);
        if (existing != null) {
            existing.work += delta.work;
            existing.shares += delta.shares;
        } else {
            this.pending.set(key, { ...delta });
        }
    }

    private async cleanup() {
        try {
            await this.sharesService.deleteOlderThan(Date.now() - RETENTION_DAYS * 24 * HOUR_MS);
        } catch (e) {
            console.error('Syndicate share cleanup failed', e?.message ?? e);
        }
    }

    /** Work per address inside the window: database buckets plus what is not flushed yet, largest first. */
    public async weights(now = Date.now()): Promise<{ address: string, work: number, shares: number }[]> {
        const since = this.sinceBucket(now);
        const merged = new Map<string, { work: number, shares: number }>();
        for (const row of await this.sharesService.workSince(since)) {
            merged.set(row.doiAddress, { work: row.work, shares: row.shares });
        }
        for (const delta of this.pending.values()) {
            if (delta.bucket < since) {
                continue;
            }
            const entry = merged.get(delta.doiAddress) ?? { work: 0, shares: 0 };
            entry.work += delta.work;
            entry.shares += delta.shares;
            merged.set(delta.doiAddress, entry);
        }
        return Array.from(merged.entries())
            .map(([address, entry]) => ({ address, work: entry.work, shares: entry.shares }))
            .filter(entry => entry.work > 0)
            .sort((a, b) => b.work - a.work || (a.address < b.address ? -1 : 1));
    }

    // ---- the syndicate block ------------------------------------------------------------------------

    public invalidate() {
        this.cache = null;
    }

    /**
     * The aux block every syndicate member merge mines right now. Rebuilt after a Doichain block and when the
     * refresh interval passed (new weights, new transactions). `requester` is paid alone while nobody has work
     * inside the window yet (first minutes of a new syndicate).
     */
    public async getAuxBlock(requester: string): Promise<SyndicateAuxBlock> {
        if (!this.enabled) {
            throw new Error('syndicate mode is off');
        }
        const cached = this.cache;
        if (cached != null && Date.now() - cached.builtAt < this.refreshMs && !(cached.fallback && cached.members[0]?.address !== requester)) {
            return cached;
        }
        if (this.building == null) {
            this.building = this.build(requester)
                .then(block => {
                    this.cache = block;
                    return block;
                })
                .finally(() => {
                    this.building = null;
                });
        }
        return this.building;
    }

    private async build(requester: string): Promise<SyndicateAuxBlock> {
        const template = await this.doichainRpcService.getBlockTemplate();
        const weights = await this.weights();
        const windowWork = weights.reduce((acc, w) => acc + w.work, 0);

        // only addresses the node can pay (validated at login, this guards the cache against odd input)
        const scripts = new Map<string, Buffer>();
        const payable: { address: string, work: number }[] = [];
        for (const weight of weights.slice(0, this.maxMembers * 2)) {
            const script = await this.scriptFor(weight.address);
            if (script != null) {
                scripts.set(weight.address, script);
                payable.push(weight);
            }
        }

        let members = splitReward(payable, template.coinbasevalue, { minPayout: this.minPayout, maxMembers: this.maxMembers });
        let fallback = false;
        if (members.length === 0) {
            const script = await this.scriptFor(requester);
            if (script == null) {
                throw new Error(`no payable syndicate member and requester ${requester} has no script`);
            }
            scripts.set(requester, script);
            members = [{ address: requester, work: 0, percent: 1, amount: template.coinbasevalue }];
            fallback = true;
        }

        const payouts: AuxPayoutScript[] = members.map(member => ({ address: member.address, script: scripts.get(member.address), amount: member.amount }));
        const built = buildAuxBlock(template, payouts, { tag: this.tag });
        if (built.droppedTransactions > 0) {
            console.warn(`Syndicate block ${built.height}: ${built.droppedTransactions} transactions left out to stay within the block limits`);
        }
        return { ...built, syndicate: true, builtAt: Date.now(), members, windowWork, fallback };
    }

    private async scriptFor(address: string): Promise<Buffer | null> {
        try {
            return await this.doichainRpcService.getScriptPubKey(address);
        } catch (e) {
            const now = Date.now();
            if (now - this.lastBuildErrorLog > 60000) {
                this.lastBuildErrorLog = now;
                console.error(`Syndicate: could not resolve the script of ${address}`, e?.message ?? e);
            }
            return null;
        }
    }

    /** Whether an aux block attached to a job is a syndicate block. */
    public static isSyndicateBlock(block: unknown): block is SyndicateAuxBlock {
        return block != null && typeof block === 'object' && (block as SyndicateAuxBlock).syndicate === true && Buffer.isBuffer((block as SyndicateAuxBlock).header);
    }

    /**
     * A share met the Doichain target on a syndicate job: hand the whole block in, record the block and
     * the payouts and tell everybody.
     */
    public async submit(block: SyndicateAuxBlock, auxPowHex: string, finder: { address: string, worker: string, sessionId: string }): Promise<{ accepted: boolean, message: string }> {
        const hex = serializeAuxBlock(block, Buffer.from(auxPowHex, 'hex')).toString('hex');
        const result = await this.doichainRpcService.submitBlock(hex);
        this.invalidate();
        const time = Date.now();

        try {
            await this.blocksService.save({
                chain: 'DOI',
                height: block.height,
                blockHash: block.hash,
                minerAddress: finder.address,
                worker: finder.worker,
                sessionId: finder.sessionId,
                blockData: hex,
                result: result.message,
                syndicateMembers: block.members.length
            });
            await this.payoutsService.saveMany(block.members.map(member => ({
                height: block.height,
                blockHash: block.hash,
                doiAddress: member.address,
                amount: member.amount,
                percent: member.percent,
                work: member.work,
                finderAddress: finder.address,
                finderWorker: finder.worker,
                accepted: result.accepted,
                time
            })));
        } catch (e) {
            console.error('Could not record the syndicate block', e?.message ?? e);
        }

        this.poolEventsService?.emit({
            type: 'block',
            chain: 'DOI',
            address: finder.address,
            worker: finder.worker,
            session: finder.sessionId,
            data: { height: block.height, hash: block.hash, accepted: result.accepted, message: result.message, syndicate: true, members: block.members.length }
        });

        if (this.notificationService != null) {
            try {
                await this.notificationService.notifyDoichainBlockFound(finder.address, finder.worker, block.height, block.hash, result.accepted, result.message,
                    { members: block.members.length, paidOut: block.paidOut });
                if (result.accepted) {
                    await this.notificationService.notifySyndicatePayouts(block.height, block.hash, block.members.map(member => ({ doiAddress: member.address, amount: member.amount, percent: member.percent })), block.paidOut);
                }
            } catch (e) {
                console.error('Syndicate notifications failed', e?.message ?? e);
            }
        }
        return result;
    }

    // ---- statistics ---------------------------------------------------------------------------------

    public async stats(): Promise<SyndicateStats> {
        const base: SyndicateStats = {
            enabled: this.enabled, windowHours: this.windowHours, minPayoutDoi: this.minPayout / COIN, maxMembers: this.maxMembers,
            members: 0, devicesOnline: 0, hashRate: 0, work: 0, distribution: [], othersPercent: 0,
            blocksFound: 0, paidOutDoi: 0, membersPaid: 0, lastBlock: null, current: null
        };
        if (!this.enabled) {
            return base;
        }
        const [weights, clients, totals, recent] = await Promise.all([
            this.weights(),
            this.clientService.getSyndicateClients(),
            this.payoutsService.totals(),
            this.payoutsService.recentBlocks(1)
        ]);
        const now = Date.now();
        const online = clients.filter(client => {
            const seen = client.updatedAt instanceof Date ? client.updatedAt.getTime() : new Date(client.updatedAt as any).getTime();
            return Number.isFinite(seen) && now - seen < ONLINE_MS;
        });
        const work = weights.reduce((acc, w) => acc + w.work, 0);
        const current = this.cache;
        const amounts = new Map((current?.members ?? []).map(member => [member.address, member.amount]));
        const top = weights.slice(0, 10).map(weight => ({ address: weight.address, work: weight.work, percent: work > 0 ? weight.work / work : 0, amount: amounts.get(weight.address) ?? null }));
        const last = recent[0] ?? null;
        return {
            ...base,
            members: weights.length,
            devicesOnline: online.length,
            hashRate: online.reduce((acc, client) => acc + (client.hashRate ?? 0), 0),
            work,
            distribution: top,
            othersPercent: weights.length > top.length ? Math.max(0, 1 - top.reduce((acc, t) => acc + t.percent, 0)) : 0,
            blocksFound: totals.blocks,
            paidOutDoi: totals.amount / COIN,
            membersPaid: totals.members,
            lastBlock: last != null ? { height: last.height, blockHash: last.blockHash, time: last.time, accepted: last.accepted, members: last.members, totalDoi: last.total / COIN, finderWorker: last.finderWorker } : null,
            current: current != null ? { height: current.height, hash: current.hash, members: current.members.length, coinbaseValueDoi: current.paidOut / COIN, builtAt: current.builtAt, transactions: current.transactions.length, droppedTransactions: current.droppedTransactions } : null
        };
    }

    /** What a miner's dashboard shows about the syndicate for the Doichain addresses of its devices. */
    public async memberInfo(doiAddresses: string[], active: boolean): Promise<SyndicateMemberInfo> {
        const empty: SyndicateMemberInfo = { active, inWindow: false, work: 0, percent: 0, perBlockDoi: 0, paidOutDoi: 0, blocksPaid: 0, payouts: [] };
        if (!this.enabled || doiAddresses.length === 0) {
            return empty;
        }
        const [weights, totals, payouts] = await Promise.all([
            this.weights(),
            this.payoutsService.totalsFor(doiAddresses),
            this.payoutsService.forAddresses(doiAddresses, 20)
        ]);
        const total = weights.reduce((acc, w) => acc + w.work, 0);
        const mine = weights.filter(w => doiAddresses.includes(w.address)).reduce((acc, w) => acc + w.work, 0);
        const percent = total > 0 ? mine / total : 0;
        const coinbaseValue = this.cache?.paidOut ?? null;
        return {
            active,
            inWindow: mine > 0,
            work: mine,
            percent,
            perBlockDoi: coinbaseValue != null ? Math.floor(coinbaseValue * percent) / COIN : 0,
            paidOutDoi: totals.amount / COIN,
            blocksPaid: totals.blocks,
            payouts: payouts.map(payout => ({
                height: payout.height, blockHash: payout.blockHash, doiAddress: payout.doiAddress, amountDoi: payout.amount / COIN,
                percent: payout.percent, accepted: payout.accepted, time: payout.time, finderWorker: payout.finderWorker
            }))
        };
    }

    /** Everything for the syndicate page: statistics, the full distribution, the current block, recent blocks. */
    public async detail() {
        const stats = await this.stats();
        if (!this.enabled) {
            return { ...stats, members: [], blocks: [], currentOutputs: [] };
        }
        const [weights, blocks] = await Promise.all([this.weights(), this.payoutsService.recentBlocks(20)]);
        const work = weights.reduce((acc, w) => acc + w.work, 0);
        const current = this.cache;
        const amounts = new Map((current?.members ?? []).map(member => [member.address, member.amount]));
        return {
            ...stats,
            members: weights.slice(0, 100).map(weight => ({ address: weight.address, work: weight.work, shares: weight.shares, percent: work > 0 ? weight.work / work : 0, amountDoi: amounts.has(weight.address) ? amounts.get(weight.address) / COIN : null })),
            blocks: blocks.map(block => ({ ...block, totalDoi: block.total / COIN })),
            currentOutputs: (current?.members ?? []).map(member => ({ address: member.address, amountDoi: member.amount / COIN, percent: member.percent }))
        };
    }

    public async payoutsForBlock(height: number): Promise<SyndicatePayoutView[]> {
        const rows = await this.payoutsService.forBlock(height);
        return rows.map(payout => ({
            height: payout.height, blockHash: payout.blockHash, doiAddress: payout.doiAddress, amountDoi: payout.amount / COIN,
            percent: payout.percent, accepted: payout.accepted, time: payout.time, finderWorker: payout.finderWorker
        }));
    }
}
