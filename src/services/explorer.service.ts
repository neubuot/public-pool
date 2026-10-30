import { Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { validate as validateBitcoinAddress } from 'bitcoin-address-validation';

import { BlocksService } from '../ORM/blocks/blocks.service';
import { BitcoinRpcService } from './bitcoin-rpc.service';
import { DoichainRpcService } from './doichain-rpc.service';

const DEFAULT_MEMPOOL_API = 'https://mempool.space/api';
const HASH_RE = /^[0-9a-fA-F]{64}$/;
const HEIGHT_RE = /^\d{1,9}$/;
const ADDRESS_RE = /^[A-Za-z0-9]{20,90}$/;

export type Chain = 'BTC' | 'DOI';

export interface BlockSummary {
    chain: Chain;
    height: number;
    hash: string;
    /** unix seconds */
    time: number;
    txCount: number;
    size: number | null;
    weight: number | null;
    difficulty: number | null;
    bits: string | null;
    nonce: number | null;
    version: number | null;
    merkleRoot: string | null;
    previousBlockHash: string | null;
    nextBlockHash: string | null;
    confirmations: number | null;
    /** AuxPoW (merge mined) block: hash of the Bitcoin parent block */
    auxpow: { parentBlockHash: string | null, chainIndex: number | null } | null;
    /** coinbase payout address when known */
    minedTo: string | null;
    /** found by this pool */
    poolBlock: boolean;
    source: 'node' | 'mempool.space';
}

export interface TxSummary {
    txid: string;
    size: number | null;
    vsize: number | null;
    inputs: number;
    outputs: number;
    valueOut: number;
    coinbase: boolean;
    fee: number | null;
    nameOps: Record<string, unknown>[];
    time: number | null;
}

export interface BlockDetail extends BlockSummary {
    txs: TxSummary[];
    txids: string[];
    txsShown: number;
}

export interface TxInput {
    txid: string | null;
    vout: number | null;
    coinbase: string | null;
    address: string | null;
    value: number | null;
    sequence: number | null;
}

export interface TxOutput {
    n: number;
    value: number;
    address: string | null;
    type: string | null;
    nameOp: Record<string, unknown> | null;
    spent: boolean | null;
}

export interface TxDetail {
    chain: Chain;
    txid: string;
    hash: string | null;
    version: number | null;
    size: number | null;
    vsize: number | null;
    weight: number | null;
    locktime: number | null;
    blockHash: string | null;
    blockHeight: number | null;
    confirmations: number | null;
    time: number | null;
    fee: number | null;
    coinbase: boolean;
    valueIn: number | null;
    valueOut: number;
    inputs: TxInput[];
    outputs: TxOutput[];
    nameOps: Record<string, unknown>[];
    source: 'node' | 'mempool.space';
}

export interface AddressInfo {
    chain: Chain;
    address: string;
    valid: boolean;
    balance: number | null;
    utxoCount: number | null;
    txCount: number | null;
    received: number | null;
    spent: number | null;
    unspents: { txid: string, vout: number, value: number, height: number | null }[];
    txs: TxSummary[];
    scannedAt: string | null;
    source: 'node' | 'mempool.space';
    hint: string | null;
}

export type SearchResult =
    | { type: 'height', height: number, chains: Chain[] }
    | { type: 'block', chain: Chain, hash: string, height: number }
    | { type: 'tx', chain: Chain, txid: string }
    | { type: 'address', chain: Chain, address: string };

interface CacheEntry { value: unknown; expires: number; }

function num(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function outputAddress(scriptPubKey: any): string | null {
    if (scriptPubKey == null) {
        return null;
    }
    if (typeof scriptPubKey.address === 'string') {
        return scriptPubKey.address;
    }
    if (Array.isArray(scriptPubKey.addresses) && scriptPubKey.addresses.length > 0) {
        return scriptPubKey.addresses[0];
    }
    return null;
}

/**
 * Block explorer for both chains. Doichain comes fully from the own node (full node, txindex). The Bitcoin
 * node is pruned: recent blocks come from it, everything else (older blocks, transactions, addresses) from
 * the mempool.space API, which every answer marks as its source.
 */
@Injectable()
export class ExplorerService {

    private readonly cache = new Map<string, CacheEntry>();
    private readonly mempoolApi: string;
    private scanQueue: Promise<unknown> = Promise.resolve();

    constructor(
        private readonly bitcoinRpcService: BitcoinRpcService,
        private readonly doichainRpcService: DoichainRpcService,
        private readonly blocksService: BlocksService,
        private readonly configService: ConfigService,
    ) {
        this.mempoolApi = (this.configService.get('MEMPOOL_API_URL') ?? DEFAULT_MEMPOOL_API).replace(/\/+$/, '');
    }

    // ---------------------------------------------------------------- Doichain

    public async doiBlocks(limit = 15, before?: number): Promise<BlockSummary[]> {
        this.requireDoichain();
        const tip = await this.doichainRpcService.rpc<number>('getblockcount');
        const start = before != null && before <= tip ? before - 1 : tip;
        return this.cached(`doi:blocks:${start}:${limit}`, 20_000, async () => {
            const poolHashes = await this.poolBlockHashes();
            const blocks: BlockSummary[] = [];
            for (let height = start; height > Math.max(-1, start - limit); height--) {
                const hash = await this.doichainRpcService.rpc<string>('getblockhash', [height]);
                const block = await this.doichainRpcService.rpc<any>('getblock', [hash, 1]);
                blocks.push(this.mapNodeBlock('DOI', block, poolHashes, null));
            }
            return blocks;
        });
    }

    public async doiBlock(id: string): Promise<BlockDetail> {
        this.requireDoichain();
        const hash = await this.doiHashFor(id);
        return this.cached(`doi:block:${hash}`, 30_000, async () => {
            const block = await this.doichainRpcService.rpc<any>('getblock', [hash, 2]).catch(e => {
                throw this.notFound(e, 'Doichain-Block nicht gefunden');
            });
            const poolHashes = await this.poolBlockHashes();
            const txs: any[] = Array.isArray(block.tx) ? block.tx : [];
            const minedTo = txs.length > 0 ? outputAddress(txs[0]?.vout?.[0]?.scriptPubKey) : null;
            const summary = this.mapNodeBlock('DOI', block, poolHashes, minedTo);
            return {
                ...summary,
                txs: txs.slice(0, 100).map(tx => this.summarizeNodeTx(tx, block.time)),
                txids: txs.map(tx => tx.txid),
                txsShown: Math.min(100, txs.length)
            };
        });
    }

    public async doiTx(txid: string): Promise<TxDetail> {
        this.requireDoichain();
        if (!HASH_RE.test(txid)) {
            throw new NotFoundException('Keine Transaktions-ID');
        }
        return this.cached(`doi:tx:${txid}`, 30_000, async () => {
            let tx: any;
            try {
                tx = await this.doichainRpcService.rpc<any>('getrawtransaction', [txid, 2]);
            } catch (e) {
                try {
                    tx = await this.doichainRpcService.rpc<any>('getrawtransaction', [txid, true]);
                } catch (inner) {
                    throw this.notFound(inner, 'Doichain-Transaktion nicht gefunden (der Transaktionsindex des Nodes wird eventuell noch aufgebaut)');
                }
            }
            let blockHeight: number | null = null;
            if (tx.blockhash != null) {
                const header = await this.doichainRpcService.rpc<any>('getblockheader', [tx.blockhash]).catch(() => null);
                blockHeight = header?.height ?? null;
            }
            return this.mapNodeTx('DOI', tx, blockHeight);
        });
    }

    public async doiAddress(address: string): Promise<AddressInfo> {
        this.requireDoichain();
        if (!ADDRESS_RE.test(address)) {
            throw new NotFoundException('Keine Adresse');
        }
        const valid = await this.doichainRpcService.validateAddress(address);
        if (!valid) {
            throw new NotFoundException('Keine gültige Doichain-Adresse');
        }
        return this.cached(`doi:address:${address}`, 60_000, async () => {
            const scan = await this.serializedScan(address);
            const unspents: any[] = Array.isArray(scan?.unspents) ? scan.unspents : [];
            unspents.sort((a, b) => (b.height ?? 0) - (a.height ?? 0));
            return {
                chain: 'DOI' as Chain,
                address,
                valid: true,
                balance: num(scan?.total_amount) ?? 0,
                utxoCount: unspents.length,
                txCount: null,
                received: null,
                spent: null,
                unspents: unspents.slice(0, 25).map(u => ({ txid: u.txid, vout: u.vout, value: num(u.amount) ?? 0, height: num(u.height) })),
                txs: [],
                scannedAt: new Date().toISOString(),
                source: 'node' as const,
                hint: 'Guthaben aus dem UTXO-Satz des eigenen Nodes. Eine Transaktionsliste je Adresse gibt es ohne Adressindex nicht.'
            };
        });
    }

    // ---------------------------------------------------------------- Bitcoin

    public async btcBlocks(limit = 15, before?: number): Promise<BlockSummary[]> {
        const info = await this.bitcoinRpcService.rpc<any>('getblockchaininfo');
        const tip: number = info.blocks;
        const start = before != null && before <= tip ? before - 1 : tip;
        return this.cached(`btc:blocks:${start}:${limit}`, 20_000, async () => {
            const poolHashes = await this.poolBlockHashes();
            const blocks: BlockSummary[] = [];
            for (let height = start; height > Math.max(-1, start - limit); height--) {
                const hash = await this.bitcoinRpcService.rpc<string>('getblockhash', [height]);
                try {
                    const block = await this.bitcoinRpcService.rpc<any>('getblock', [hash, 1]);
                    blocks.push(this.mapNodeBlock('BTC', block, poolHashes, null));
                } catch (e) {
                    // pruned away: header only
                    const header = await this.bitcoinRpcService.rpc<any>('getblockheader', [hash]);
                    blocks.push(this.mapNodeBlock('BTC', { ...header, tx: [], size: null }, poolHashes, null));
                }
            }
            return blocks;
        });
    }

    public async btcBlock(id: string): Promise<BlockDetail> {
        const hash = await this.btcHashFor(id);
        return this.cached(`btc:block:${hash}`, 60_000, async () => {
            const poolHashes = await this.poolBlockHashes();
            try {
                const block = await this.bitcoinRpcService.rpc<any>('getblock', [hash, 1]);
                const txids: string[] = Array.isArray(block.tx) ? block.tx : [];
                return {
                    ...this.mapNodeBlock('BTC', block, poolHashes, null),
                    txs: [],
                    txids: txids.slice(0, 100),
                    txsShown: Math.min(100, txids.length)
                };
            } catch (e) {
                const block = await this.mempool<any>(`/block/${hash}`).catch(err => {
                    throw this.notFound(err, 'Bitcoin-Block nicht gefunden');
                });
                const txids = await this.mempool<string[]>(`/block/${hash}/txids`).catch(() => []);
                return {
                    ...this.mapMempoolBlock(block, poolHashes),
                    txs: [],
                    txids: txids.slice(0, 100),
                    txsShown: Math.min(100, txids.length)
                };
            }
        });
    }

    public async btcTx(txid: string): Promise<TxDetail> {
        if (!HASH_RE.test(txid)) {
            throw new NotFoundException('Keine Transaktions-ID');
        }
        return this.cached(`btc:tx:${txid}`, 60_000, async () => {
            // the pruned node knows mempool transactions and little else
            try {
                const tx = await this.bitcoinRpcService.rpc<any>('getrawtransaction', [txid, true]);
                return this.mapNodeTx('BTC', tx, null);
            } catch (e) {
                const tx = await this.mempool<any>(`/tx/${txid}`).catch(err => {
                    throw this.notFound(err, 'Bitcoin-Transaktion nicht gefunden');
                });
                return this.mapMempoolTx(tx);
            }
        });
    }

    public async btcAddress(address: string): Promise<AddressInfo> {
        if (!ADDRESS_RE.test(address) || !validateBitcoinAddress(address)) {
            throw new NotFoundException('Keine gültige Bitcoin-Adresse');
        }
        return this.cached(`btc:address:${address}`, 60_000, async () => {
            const info = await this.mempool<any>(`/address/${address}`).catch(err => {
                throw this.notFound(err, 'Adresse bei mempool.space nicht abrufbar');
            });
            const txs = await this.mempool<any[]>(`/address/${address}/txs`).catch(() => []);
            const chain = info?.chain_stats ?? {};
            const mem = info?.mempool_stats ?? {};
            const received = (num(chain.funded_txo_sum) ?? 0) / 1e8;
            const spent = (num(chain.spent_txo_sum) ?? 0) / 1e8;
            return {
                chain: 'BTC' as Chain,
                address,
                valid: true,
                balance: received - spent + ((num(mem.funded_txo_sum) ?? 0) - (num(mem.spent_txo_sum) ?? 0)) / 1e8,
                utxoCount: (num(chain.funded_txo_count) ?? 0) - (num(chain.spent_txo_count) ?? 0),
                txCount: (num(chain.tx_count) ?? 0) + (num(mem.tx_count) ?? 0),
                received,
                spent,
                unspents: [],
                txs: (Array.isArray(txs) ? txs : []).slice(0, 25).map(tx => this.summarizeMempoolTx(tx)),
                scannedAt: new Date().toISOString(),
                source: 'mempool.space' as const,
                hint: 'Bitcoin-Adressdaten kommen von mempool.space, der eigene Node ist beschnitten (pruned).'
            };
        });
    }

    // ---------------------------------------------------------------- Suche

    public async search(query: string): Promise<SearchResult> {
        const q = (query ?? '').trim();
        if (q.length === 0) {
            throw new NotFoundException('Leere Suche');
        }
        if (HEIGHT_RE.test(q)) {
            const height = parseInt(q, 10);
            const chains: Chain[] = [];
            if (this.doichainRpcService.enabled) {
                const doiTip = await this.doichainRpcService.rpc<number>('getblockcount').catch(() => -1);
                if (height <= doiTip) {
                    chains.push('DOI');
                }
            }
            const btcInfo = await this.bitcoinRpcService.rpc<any>('getblockchaininfo').catch(() => null);
            if (btcInfo != null && height <= Math.max(btcInfo.headers ?? 0, btcInfo.blocks ?? 0)) {
                chains.push('BTC');
            } else if (btcInfo == null) {
                chains.push('BTC');
            }
            if (chains.length === 0) {
                throw new NotFoundException('Höhe liegt über beiden Kettenspitzen');
            }
            return { type: 'height', height, chains };
        }
        if (HASH_RE.test(q)) {
            const hash = q.toLowerCase();
            if (this.doichainRpcService.enabled) {
                const block = await this.doichainRpcService.rpc<any>('getblockheader', [hash]).catch(() => null);
                if (block != null) {
                    return { type: 'block', chain: 'DOI', hash, height: block.height };
                }
                const tx = await this.doichainRpcService.rpc<any>('getrawtransaction', [hash, true]).catch(() => null);
                if (tx != null) {
                    return { type: 'tx', chain: 'DOI', txid: hash };
                }
            }
            const btcHeader = await this.bitcoinRpcService.rpc<any>('getblockheader', [hash]).catch(() => null);
            if (btcHeader != null) {
                return { type: 'block', chain: 'BTC', hash, height: btcHeader.height };
            }
            const mempoolBlock = await this.mempool<any>(`/block/${hash}`).catch(() => null);
            if (mempoolBlock != null) {
                return { type: 'block', chain: 'BTC', hash, height: mempoolBlock.height };
            }
            const mempoolTx = await this.mempool<any>(`/tx/${hash}`).catch(() => null);
            if (mempoolTx != null) {
                return { type: 'tx', chain: 'BTC', txid: hash };
            }
            throw new NotFoundException('Weder Block noch Transaktion mit diesem Hash gefunden');
        }
        if (ADDRESS_RE.test(q)) {
            if (validateBitcoinAddress(q)) {
                return { type: 'address', chain: 'BTC', address: q };
            }
            if (this.doichainRpcService.enabled && await this.doichainRpcService.validateAddress(q)) {
                return { type: 'address', chain: 'DOI', address: q };
            }
        }
        throw new NotFoundException('Keine Höhe, kein Hash und keine Adresse');
    }

    // ---------------------------------------------------------------- Hilfen

    private requireDoichain() {
        if (!this.doichainRpcService.enabled) {
            throw new ServiceUnavailableException('Doichain ist auf diesem Pool nicht aktiv');
        }
    }

    private async doiHashFor(id: string): Promise<string> {
        if (HASH_RE.test(id)) {
            return id.toLowerCase();
        }
        if (HEIGHT_RE.test(id)) {
            return this.doichainRpcService.rpc<string>('getblockhash', [parseInt(id, 10)]).catch(e => {
                throw this.notFound(e, 'Doichain-Block nicht gefunden');
            });
        }
        throw new NotFoundException('Weder Höhe noch Hash');
    }

    private async btcHashFor(id: string): Promise<string> {
        if (HASH_RE.test(id)) {
            return id.toLowerCase();
        }
        if (HEIGHT_RE.test(id)) {
            const height = parseInt(id, 10);
            try {
                return await this.bitcoinRpcService.rpc<string>('getblockhash', [height]);
            } catch (e) {
                const response = await fetch(`${this.mempoolApi}/block-height/${height}`, { signal: AbortSignal.timeout(10000), headers: { 'User-Agent': 'NerdPool/1.0' } });
                if (!response.ok) {
                    throw new NotFoundException('Bitcoin-Block nicht gefunden');
                }
                return (await response.text()).trim();
            }
        }
        throw new NotFoundException('Weder Höhe noch Hash');
    }

    private async poolBlockHashes(): Promise<Set<string>> {
        return this.cached('pool:hashes', 60_000, async () => {
            const blocks = await this.blocksService.getRecentBlocks(1000);
            return new Set(blocks.map(b => b.blockHash).filter(h => h != null).map(h => h.toLowerCase()));
        });
    }

    private mapNodeBlock(chain: Chain, block: any, poolHashes: Set<string>, minedTo: string | null): BlockSummary {
        const auxpow = block.auxpow != null
            ? { parentBlockHash: block.auxpow.parentblock?.hash ?? block.auxpow.parentblockhash ?? null, chainIndex: num(block.auxpow.chainindex) }
            : null;
        return {
            chain,
            height: block.height,
            hash: block.hash,
            time: block.time,
            txCount: num(block.nTx) ?? (Array.isArray(block.tx) ? block.tx.length : 0),
            size: num(block.size),
            weight: num(block.weight),
            difficulty: num(block.difficulty),
            bits: block.bits ?? null,
            nonce: num(block.nonce),
            version: num(block.version),
            merkleRoot: block.merkleroot ?? null,
            previousBlockHash: block.previousblockhash ?? null,
            nextBlockHash: block.nextblockhash ?? null,
            confirmations: num(block.confirmations),
            auxpow,
            minedTo,
            poolBlock: poolHashes.has(String(block.hash).toLowerCase()),
            source: 'node'
        };
    }

    private mapMempoolBlock(block: any, poolHashes: Set<string>): BlockSummary {
        return {
            chain: 'BTC',
            height: block.height,
            hash: block.id,
            time: block.timestamp,
            txCount: num(block.tx_count) ?? 0,
            size: num(block.size),
            weight: num(block.weight),
            difficulty: num(block.difficulty),
            bits: block.bits != null ? Number(block.bits).toString(16) : null,
            nonce: num(block.nonce),
            version: num(block.version),
            merkleRoot: block.merkle_root ?? null,
            previousBlockHash: block.previousblockhash ?? null,
            nextBlockHash: null,
            confirmations: null,
            auxpow: null,
            minedTo: block.extras?.coinbaseAddress ?? null,
            poolBlock: poolHashes.has(String(block.id).toLowerCase()),
            source: 'mempool.space'
        };
    }

    private summarizeNodeTx(tx: any, blockTime: number | null): TxSummary {
        const vout: any[] = Array.isArray(tx.vout) ? tx.vout : [];
        const vin: any[] = Array.isArray(tx.vin) ? tx.vin : [];
        return {
            txid: tx.txid,
            size: num(tx.size),
            vsize: num(tx.vsize),
            inputs: vin.length,
            outputs: vout.length,
            valueOut: vout.reduce((acc, o) => acc + (num(o.value) ?? 0), 0),
            coinbase: vin.length > 0 && vin[0].coinbase != null,
            fee: num(tx.fee),
            nameOps: vout.map(o => o.scriptPubKey?.nameOp).filter(op => op != null),
            time: num(tx.time) ?? blockTime
        };
    }

    private summarizeMempoolTx(tx: any): TxSummary {
        const vout: any[] = Array.isArray(tx.vout) ? tx.vout : [];
        const vin: any[] = Array.isArray(tx.vin) ? tx.vin : [];
        return {
            txid: tx.txid,
            size: num(tx.size),
            vsize: tx.weight != null ? Math.ceil(tx.weight / 4) : null,
            inputs: vin.length,
            outputs: vout.length,
            valueOut: vout.reduce((acc, o) => acc + (num(o.value) ?? 0), 0) / 1e8,
            coinbase: vin.some(i => i.is_coinbase === true),
            fee: tx.fee != null ? tx.fee / 1e8 : null,
            nameOps: [],
            time: num(tx.status?.block_time)
        };
    }

    private mapNodeTx(chain: Chain, tx: any, blockHeight: number | null): TxDetail {
        const vin: any[] = Array.isArray(tx.vin) ? tx.vin : [];
        const vout: any[] = Array.isArray(tx.vout) ? tx.vout : [];
        const inputs: TxInput[] = vin.map(i => ({
            txid: i.txid ?? null,
            vout: num(i.vout),
            coinbase: i.coinbase ?? null,
            address: outputAddress(i.prevout?.scriptPubKey),
            value: num(i.prevout?.value),
            sequence: num(i.sequence)
        }));
        const outputs: TxOutput[] = vout.map(o => ({
            n: o.n,
            value: num(o.value) ?? 0,
            address: outputAddress(o.scriptPubKey),
            type: o.scriptPubKey?.type ?? null,
            nameOp: o.scriptPubKey?.nameOp ?? null,
            spent: null
        }));
        const coinbase = inputs.length > 0 && inputs[0].coinbase != null;
        const valueOut = outputs.reduce((acc, o) => acc + o.value, 0);
        const inputValues = inputs.map(i => i.value);
        const valueIn = coinbase ? null : (inputValues.every(v => v != null) ? inputValues.reduce((acc, v) => acc + v, 0) : null);
        return {
            chain,
            txid: tx.txid,
            hash: tx.hash ?? null,
            version: num(tx.version),
            size: num(tx.size),
            vsize: num(tx.vsize),
            weight: num(tx.weight),
            locktime: num(tx.locktime),
            blockHash: tx.blockhash ?? null,
            blockHeight,
            confirmations: num(tx.confirmations),
            time: num(tx.blocktime) ?? num(tx.time),
            fee: num(tx.fee) ?? (valueIn != null ? valueIn - valueOut : null),
            coinbase,
            valueIn,
            valueOut,
            inputs,
            outputs,
            nameOps: outputs.map(o => o.nameOp).filter(op => op != null),
            source: 'node'
        };
    }

    private mapMempoolTx(tx: any): TxDetail {
        const vin: any[] = Array.isArray(tx.vin) ? tx.vin : [];
        const vout: any[] = Array.isArray(tx.vout) ? tx.vout : [];
        const inputs: TxInput[] = vin.map(i => ({
            txid: i.is_coinbase ? null : i.txid ?? null,
            vout: i.is_coinbase ? null : num(i.vout),
            coinbase: i.is_coinbase ? (i.scriptsig ?? '') : null,
            address: i.prevout?.scriptpubkey_address ?? null,
            value: i.prevout?.value != null ? i.prevout.value / 1e8 : null,
            sequence: num(i.sequence)
        }));
        const outputs: TxOutput[] = vout.map((o, n) => ({
            n,
            value: (num(o.value) ?? 0) / 1e8,
            address: o.scriptpubkey_address ?? null,
            type: o.scriptpubkey_type ?? null,
            nameOp: null,
            spent: null
        }));
        const coinbase = vin.some(i => i.is_coinbase === true);
        const valueOut = outputs.reduce((acc, o) => acc + o.value, 0);
        const valueIn = coinbase ? null : inputs.reduce((acc, i) => acc + (i.value ?? 0), 0);
        return {
            chain: 'BTC',
            txid: tx.txid,
            hash: null,
            version: num(tx.version),
            size: num(tx.size),
            vsize: tx.weight != null ? Math.ceil(tx.weight / 4) : null,
            weight: num(tx.weight),
            locktime: num(tx.locktime),
            blockHash: tx.status?.block_hash ?? null,
            blockHeight: num(tx.status?.block_height),
            confirmations: null,
            time: num(tx.status?.block_time),
            fee: tx.fee != null ? tx.fee / 1e8 : null,
            coinbase,
            valueIn,
            valueOut,
            inputs,
            outputs,
            nameOps: [],
            source: 'mempool.space'
        };
    }

    /** scantxoutset refuses parallel scans, so they run one after another. */
    private serializedScan(address: string): Promise<any> {
        const run = this.scanQueue.then(() => this.doichainRpcService.rpc<any>('scantxoutset', ['start', [`addr(${address})`]]));
        this.scanQueue = run.catch(() => undefined);
        return run;
    }

    private async mempool<T>(path: string): Promise<T> {
        return this.cached(`mempool:${path}`, 60_000, async () => {
            const response = await fetch(`${this.mempoolApi}${path}`, {
                signal: AbortSignal.timeout(10000),
                headers: { 'User-Agent': 'NerdPool/1.0', 'Accept': 'application/json' }
            });
            if (!response.ok) {
                throw new Error(`mempool.space ${path}: HTTP ${response.status}`);
            }
            return await response.json() as T;
        });
    }

    private notFound(error: any, message: string): Error {
        const text: string = error?.message ?? '';
        if (error instanceof NotFoundException || /not found|No such|out of range|HTTP 404|Block not available/i.test(text)) {
            return new NotFoundException(message);
        }
        return error instanceof Error ? error : new Error(text || message);
    }

    private async cached<T>(key: string, ttlMs: number, loader: () => Promise<T>): Promise<T> {
        const entry = this.cache.get(key);
        if (entry != null && entry.expires > Date.now()) {
            return entry.value as T;
        }
        const value = await loader();
        this.cache.set(key, { value, expires: Date.now() + ttlMs });
        if (this.cache.size > 2000) {
            const now = Date.now();
            for (const [k, v] of this.cache) {
                if (v.expires <= now) {
                    this.cache.delete(k);
                }
            }
        }
        return value;
    }
}
