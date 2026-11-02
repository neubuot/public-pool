import * as bitcoinjs from 'bitcoinjs-lib';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Subject } from 'rxjs';

import { SyndicateShareDelta } from '../ORM/syndicate-shares/syndicate-shares.service';
import { IAuxTemplate, parseHeader } from '../utils/aux-block';
import { SyndicateService } from './syndicate.service';

const template: IAuxTemplate = JSON.parse(fs.readFileSync(path.join(__dirname, '../../test/fixtures/doichain-template.json'), 'utf8'));
const HOUR = 60 * 60 * 1000;

/** in-memory stand-in for the share buckets table */
class FakeShares {
    rows = new Map<string, SyndicateShareDelta>();
    async add(deltas: SyndicateShareDelta[]) {
        for (const d of deltas) {
            const key = `${d.doiAddress}|${d.bucket}`;
            const row = this.rows.get(key);
            if (row) {
                row.work += d.work;
                row.shares += d.shares;
            } else {
                this.rows.set(key, { ...d });
            }
        }
    }
    async workSince(since: number) {
        const sums = new Map<string, { work: number, shares: number }>();
        for (const row of this.rows.values()) {
            if (row.bucket < since) continue;
            const s = sums.get(row.doiAddress) ?? { work: 0, shares: 0 };
            s.work += row.work;
            s.shares += row.shares;
            sums.set(row.doiAddress, s);
        }
        return Array.from(sums.entries()).map(([doiAddress, s]) => ({ doiAddress, ...s }));
    }
    async deleteOlderThan() { /* nothing */ }
}

function script(byte: number): Buffer {
    return Buffer.concat([Buffer.from('0014', 'hex'), Buffer.alloc(20, byte)]);
}

function makeService(options: { config?: Record<string, string>, rpc?: Partial<any> } = {}) {
    const config = { AUXPOW_ENABLED: 'true', DOICHAIN_AUXBLOCK_REFRESH_MS: '10000', ...(options.config ?? {}) };
    const configService = { get: (key: string) => config[key] ?? null } as any;
    const newBlock$ = new Subject<number>();
    const rpc = {
        enabled: true,
        newBlock$,
        getBlockTemplate: jest.fn(async () => ({ ...template, transactions: template.transactions.map(tx => ({ ...tx })) })),
        getScriptPubKey: jest.fn(async (address: string) => address.startsWith('dc1') ? script(address.charCodeAt(3)) : null),
        submitBlock: jest.fn(async () => ({ accepted: true, message: 'accepted' })),
        ...(options.rpc ?? {})
    } as any;
    const shares = new FakeShares();
    const payouts = { saveMany: jest.fn(async () => undefined), totals: jest.fn(async () => ({ blocks: 0, amount: 0, members: 0 })), recentBlocks: jest.fn(async () => []), forAddresses: jest.fn(async () => []), totalsFor: jest.fn(async () => ({ amount: 0, blocks: 0 })), forBlock: jest.fn(async () => []) } as any;
    const blocks = { save: jest.fn(async () => undefined) } as any;
    const clients = { getSyndicateClients: jest.fn(async () => []) } as any;
    const notifications = { notifyDoichainBlockFound: jest.fn(async () => undefined), notifySyndicatePayouts: jest.fn(async () => undefined) } as any;
    const events = { emit: jest.fn() } as any;
    const service = new SyndicateService(configService, rpc, shares as any, payouts, blocks, clients, notifications, events);
    return { service, rpc, shares, payouts, blocks, notifications, events, newBlock$ };
}

describe('SyndicateService', () => {
    const now = Date.parse('2026-11-02T20:00:00Z');

    it('is off without merged mining or when switched off', () => {
        expect(makeService({ config: { AUXPOW_ENABLED: 'false' } }).service.enabled).toBe(false);
        expect(makeService({ config: { SYNDICATE_ENABLED: 'false' } }).service.enabled).toBe(false);
        expect(makeService().service.enabled).toBe(true);
    });

    it('reads window, minimum payout and member cap from the configuration', () => {
        const { service } = makeService({ config: { SYNDICATE_WINDOW_HOURS: '48', SYNDICATE_MIN_PAYOUT_DOI: '0.01', SYNDICATE_MAX_MEMBERS: '50' } });
        expect(service.windowHours).toBe(48);
        expect(service.minPayout).toBe(1_000_000);
        expect(service.maxMembers).toBe(50);
        const defaults = makeService().service;
        expect(defaults.windowHours).toBe(24);
        expect(defaults.minPayout).toBe(100_000);
        expect(defaults.maxMembers).toBe(250);
    });

    it('sums share work per address and hour, pending work counts before the flush', async () => {
        const { service, shares } = makeService();
        service.recordShare('dc1a', 1000, now);
        service.recordShare('dc1a', 1000, now + 1000);
        service.recordShare('dc1b', 500, now);
        expect(await service.weights(now)).toEqual([
            { address: 'dc1a', work: 2000, shares: 2 },
            { address: 'dc1b', work: 500, shares: 1 }
        ]);
        await service.flush();
        expect(shares.rows.size).toBe(2);
        expect(await service.weights(now)).toEqual([
            { address: 'dc1a', work: 2000, shares: 2 },
            { address: 'dc1b', work: 500, shares: 1 }
        ]);
        // work older than the window is left out
        service.recordShare('dc1c', 9999, now - 30 * HOUR);
        expect((await service.weights(now)).map(w => w.address)).toEqual(['dc1a', 'dc1b']);
    });

    it('pays the requesting address alone while nobody has work yet', async () => {
        const { service, rpc } = makeService();
        const block = await service.getAuxBlock('dc1zfirst');
        expect(block.fallback).toBe(true);
        expect(block.members).toEqual([{ address: 'dc1zfirst', work: 0, percent: 1, amount: template.coinbasevalue }]);
        expect(block.hash.length).toBe(64);
        expect(parseHeader(block.header).version).toBe(0x00020104);
        expect(rpc.getBlockTemplate).toHaveBeenCalledTimes(1);
        // a second member asking for a job gets its own fallback block instead of the first member's
        const other = await service.getAuxBlock('dc1zother');
        expect(other.members[0].address).toBe('dc1zother');
        expect(rpc.getBlockTemplate).toHaveBeenCalledTimes(2);
    });

    it('splits the coinbase between the members by their work and caches the block', async () => {
        const { service, rpc } = makeService();
        service.recordShare('dc1a', 3000, now);
        service.recordShare('dc1b', 1000, now);
        const block = await service.getAuxBlock('dc1a');
        expect(block.fallback).toBe(false);
        expect(block.members.map(m => m.address)).toEqual(['dc1a', 'dc1b']);
        expect(block.members[0].amount + block.members[1].amount).toBe(template.coinbasevalue);
        expect(block.members[1].amount).toBe(Math.floor(template.coinbasevalue / 4));
        const coinbase = bitcoinjs.Transaction.fromBuffer(block.coinbaseTx);
        expect(coinbase.outs.length).toBe(3);
        expect(coinbase.outs[0].script).toEqual(script('a'.charCodeAt(0)));
        expect(coinbase.outs[1].script).toEqual(script('b'.charCodeAt(0)));
        expect(coinbase.outs[2].script.toString('hex')).toBe(template.default_witness_commitment);

        // the same block is handed out again within the refresh interval
        expect(await service.getAuxBlock('dc1b')).toBe(block);
        expect(rpc.getBlockTemplate).toHaveBeenCalledTimes(1);

        // a new Doichain block invalidates it
        service.invalidate();
        const next = await service.getAuxBlock('dc1b');
        expect(next).not.toBe(block);
        expect(rpc.getBlockTemplate).toHaveBeenCalledTimes(2);
    });

    it('leaves out members whose address the node cannot pay', async () => {
        const { service } = makeService();
        service.recordShare('dc1a', 1000, now);
        service.recordShare('bogus', 5000, now);
        const block = await service.getAuxBlock('dc1a');
        expect(block.members.map(m => m.address)).toEqual(['dc1a']);
        expect(block.members[0].amount).toBe(template.coinbasevalue);
    });

    it('submits the serialised block and records block, payouts and notifications', async () => {
        const { service, rpc, blocks, payouts, notifications, events } = makeService();
        service.recordShare('dc1a', 1000, now);
        service.recordShare('dc1b', 1000, now);
        const block = await service.getAuxBlock('dc1a');
        const proof = Buffer.alloc(200, 7).toString('hex');
        const result = await service.submit(block, proof, { address: 'bc1qfinder', worker: 'axe', sessionId: 'abcd1234' });
        expect(result.accepted).toBe(true);
        const hex: string = rpc.submitBlock.mock.calls[0][0];
        expect(hex.startsWith(block.header.toString('hex'))).toBe(true);
        expect(hex.includes(proof)).toBe(true);
        expect(hex.endsWith(template.transactions[0].data)).toBe(true);
        expect(blocks.save).toHaveBeenCalledWith(expect.objectContaining({ chain: 'DOI', height: template.height, blockHash: block.hash, minerAddress: 'bc1qfinder', worker: 'axe', syndicateMembers: 2, result: 'accepted' }));
        expect(payouts.saveMany).toHaveBeenCalledTimes(1);
        const rows = payouts.saveMany.mock.calls[0][0];
        expect(rows.map((r: any) => r.doiAddress)).toEqual(['dc1a', 'dc1b']);
        expect(rows.reduce((acc: number, r: any) => acc + r.amount, 0)).toBe(template.coinbasevalue);
        expect(notifications.notifyDoichainBlockFound).toHaveBeenCalledWith('bc1qfinder', 'axe', template.height, block.hash, true, 'accepted', { members: 2, paidOut: template.coinbasevalue });
        expect(notifications.notifySyndicatePayouts).toHaveBeenCalledTimes(1);
        expect(events.emit).toHaveBeenCalledWith(expect.objectContaining({ type: 'block', chain: 'DOI', data: expect.objectContaining({ syndicate: true, members: 2 }) }));
        // the next job needs a fresh block
        await service.getAuxBlock('dc1a');
        expect(rpc.getBlockTemplate).toHaveBeenCalledTimes(2);
    });

    it('recognises its own blocks', async () => {
        const { service } = makeService();
        const block = await service.getAuxBlock('dc1a');
        expect(SyndicateService.isSyndicateBlock(block)).toBe(true);
        expect(SyndicateService.isSyndicateBlock({ hash: 'x', chainid: 2, previousblockhash: 'y', coinbasevalue: 1, bits: '1d00ffff', height: 1 })).toBe(false);
        expect(SyndicateService.isSyndicateBlock(null)).toBe(false);
    });

    it('reports statistics and member information', async () => {
        const { service } = makeService();
        service.recordShare('dc1a', 3000, now);
        service.recordShare('dc1b', 1000, now);
        await service.getAuxBlock('dc1a');
        const stats = await service.stats();
        expect(stats.enabled).toBe(true);
        expect(stats.members).toBe(2);
        expect(stats.work).toBe(4000);
        expect(stats.distribution[0]).toEqual(expect.objectContaining({ address: 'dc1a', percent: 0.75 }));
        expect(stats.current?.members).toBe(2);
        const info = await service.memberInfo(['dc1b'], true);
        expect(info.inWindow).toBe(true);
        expect(info.percent).toBe(0.25);
        expect(info.perBlockDoi).toBeCloseTo(template.coinbasevalue * 0.25 / 1e8, 6);
        const stranger = await service.memberInfo(['dc1zzz'], false);
        expect(stranger.inWindow).toBe(false);
        expect(stranger.percent).toBe(0);
    });
});
