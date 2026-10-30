// Zugriff auf die Pool-API (/api, gleiche Herkunft). Typen spiegeln die Antworten des Backends.

export class ApiError extends Error {
    constructor(public readonly status: number, message: string) {
        super(message);
    }
}

export interface ChainOdds {
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
    estimatedChange: number | null;
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
    lastBlockTime: number | null;
    lastBlockHash: string | null;
    blockSubsidy: number | null;
    avgBlockIntervalSec: number | null;
    difficultyAdjustment: DifficultyAdjustment | null;
    pruned: boolean;
    network: string | null;
    error: string | null;
}

export interface FoundBlock {
    chain: string;
    height: number;
    blockHash: string | null;
    minerAddress: string;
    worker: string;
    accepted: boolean;
    result: string | null;
    time: string | null;
}

export interface TopShare {
    address?: string;
    worker: string;
    userAgent: string | null;
    difficulty: number;
    time: number;
}

export interface PoolStats {
    hashRate: number;
    miners: number;
    userAgents: { userAgent: string, count: number, bestDifficulty: number, totalHashRate: number }[];
    bestDifficulty: number | null;
    bestDifficultyUserAgent: string | null;
    highScores: { updatedAt: string, bestDifficulty: number, bestDifficultyUserAgent: string }[];
    topShares: TopShare[];
    blocksFound: { BTC: { found: number, accepted: number }, DOI: { found: number, accepted: number } };
    recentBlocks: FoundBlock[];
    since: string;
    jobsActive: boolean;
    telegramBot: string | null;
}

export interface StatsSnapshot {
    time: string;
    bitcoin: ChainStats;
    doichain: ChainStats;
    pool: PoolStats;
    odds: { bitcoin: ChainOdds, doichain: ChainOdds };
    prices: { btcEur: number | null, doiEur: number | null, updatedAt: string } | null;
}

export interface SamplePoint {
    t: number;
    height: number | null;
    difficulty: number | null;
    networkHashPs: number | null;
    mempoolTx: number | null;
    hashRate: number | null;
    miners: number | null;
}

export interface History {
    range: string;
    bucketMs: number;
    since: string;
    bitcoin: SamplePoint[];
    doichain: SamplePoint[];
    pool: SamplePoint[];
}

export type PoolEventType = 'share' | 'block' | 'connect' | 'disconnect' | 'vardiff' | 'tip';

export interface PoolEvent {
    t: number;
    type: PoolEventType;
    chain?: 'BTC' | 'DOI';
    address?: string;
    worker?: string;
    session?: string;
    data?: Record<string, any>;
}

export interface ChartPoint {
    label: string;
    data: number;
}

export interface MinerWorker {
    name: string;
    sessionId: string;
    userAgent: string | null;
    hashRate: number;
    bestDifficulty: number;
    startTime: string;
    lastSeen: string;
    online: boolean;
    doiAddress: string | null;
}

export interface MinerInfo {
    address: string;
    doiAddress: string | null;
    doiAddresses: string[];
    hashRate: number;
    workersOnline: number;
    workersCount: number;
    bestDifficulty: number;
    bestDifficultyUserAgent: string | null;
    shares: number;
    topShares: TopShare[];
    workers: MinerWorker[];
    blocks: { chain: string, height: number, blockHash: string | null, worker: string, result: string | null, accepted: boolean, time: string }[];
    odds: { bitcoin: ChainOdds, doichain: ChainOdds };
    chart: ChartPoint[];
}

export interface WorkerInfo {
    address: string;
    name: string;
    sessions: { sessionId: string, userAgent: string | null, hashRate: number, bestDifficulty: number, startTime: string, lastSeen: string, doiAddress: string | null }[];
    bestDifficulty: number;
    chart: ChartPoint[];
}

export interface AddressCheck {
    chain: 'BTC' | 'DOI';
    address: string;
    valid: boolean;
    network?: string;
    type: string | null;
    bech32: boolean | null;
    enabled?: boolean;
}

export type Chain = 'BTC' | 'DOI';

export interface BlockSummary {
    chain: Chain;
    height: number;
    hash: string;
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
    auxpow: { parentBlockHash: string | null, chainIndex: number | null } | null;
    minedTo: string | null;
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
    inputs: { txid: string | null, vout: number | null, coinbase: string | null, address: string | null, value: number | null, sequence: number | null }[];
    outputs: { n: number, value: number, address: string | null, type: string | null, nameOp: Record<string, unknown> | null, spent: boolean | null }[];
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

export interface InfoResponse {
    blockData: { height: number, minerAddress: string, worker: string, sessionId: string, chain: string, blockHash: string | null, result: string | null, createdAt?: string }[];
    userAgents: { userAgent: string, count: string, bestDifficulty: string, totalHashRate: string }[];
    highScores: { updatedAt: string, bestDifficulty: number, bestDifficultyUserAgent: string }[];
    uptime: string;
}

async function get<T>(path: string, timeoutMs = 20000): Promise<T> {
    let response: Response;
    try {
        response = await fetch(`/api${path}`, { signal: AbortSignal.timeout(timeoutMs), headers: { Accept: 'application/json' } });
    } catch (e: any) {
        throw new ApiError(0, e?.name === 'TimeoutError' ? 'Zeitüberschreitung' : (e?.message ?? 'Netzwerkfehler'));
    }
    let body: any = null;
    try {
        body = await response.json();
    } catch {
        body = null;
    }
    if (!response.ok) {
        const message = body?.message ?? body?.error ?? `HTTP ${response.status}`;
        throw new ApiError(response.status, Array.isArray(message) ? message.join(', ') : String(message));
    }
    return body as T;
}

export const api = {
    stats: () => get<StatsSnapshot>('/stats'),
    history: (range: string) => get<History>(`/stats/history?range=${encodeURIComponent(range)}`),
    info: () => get<InfoResponse>('/info'),
    miner: (address: string) => get<MinerInfo>(`/miner/${encodeURIComponent(address)}`),
    worker: (address: string, name: string) => get<WorkerInfo>(`/miner/${encodeURIComponent(address)}/worker/${encodeURIComponent(name)}`),
    validateBtc: (address: string) => get<AddressCheck>(`/validate/btc/${encodeURIComponent(address)}`),
    validateDoi: (address: string) => get<AddressCheck>(`/validate/doi/${encodeURIComponent(address)}`),
    search: (q: string) => get<SearchResult>(`/explorer/search?q=${encodeURIComponent(q)}`),
    blocks: (chain: Chain, limit = 15, before?: number) =>
        get<BlockSummary[]>(`/explorer/${chain.toLowerCase()}/blocks?limit=${limit}${before != null ? `&before=${before}` : ''}`),
    block: (chain: Chain, id: string) => get<BlockDetail>(`/explorer/${chain.toLowerCase()}/block/${encodeURIComponent(id)}`),
    tx: (chain: Chain, txid: string) => get<TxDetail>(`/explorer/${chain.toLowerCase()}/tx/${encodeURIComponent(txid)}`),
    address: (chain: Chain, address: string) => get<AddressInfo>(`/explorer/${chain.toLowerCase()}/address/${encodeURIComponent(address)}`),
};

/** Server-sent events of the pool; returns a closer. */
export function subscribeEvents(onEvent: (event: PoolEvent) => void, address?: string, onState?: (open: boolean) => void): () => void {
    const url = `/api/stats/events${address != null ? `?address=${encodeURIComponent(address)}` : ''}`;
    const source = new EventSource(url);
    source.onmessage = message => {
        try {
            onEvent(JSON.parse(message.data));
        } catch {
            // kaputte Zeile, ignorieren
        }
    };
    source.onopen = () => onState?.(true);
    source.onerror = () => onState?.(false);
    return () => source.close();
}
