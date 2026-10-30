import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';
import * as fs from 'node:fs';
import { BehaviorSubject, filter, shareReplay } from 'rxjs';
import * as zmq from 'zeromq';

import { IAuxBlock } from '../models/auxpow';

interface CachedAuxBlock {
    block: IAuxBlock;
    fetchedAt: number;
}

/**
 * RPC client for the Doichain node used for merged mining (AuxPoW).
 *
 * - `createauxblock <address>` returns a prepared Doichain block paying to the address; its hash goes into the
 *   Bitcoin coinbase of every job built for that address.
 * - `submitauxblock <hash> <auxpow>` hands in the proof once a share satisfies the Doichain target.
 * - new Doichain blocks are detected via ZMQ hashblock or polling; the aux block cache is dropped then.
 */
@Injectable()
export class DoichainRpcService implements OnModuleInit {

    public readonly enabled: boolean;
    public chain: string = 'unknown';
    public blockHeight = 0;

    private client: AxiosInstance;
    private rpcRequestId = 0;
    private readonly refreshMs: number;
    private auxBlockCache = new Map<string, CachedAuxBlock>();
    private pendingAuxBlock = new Map<string, Promise<IAuxBlock>>();
    private addressCache = new Map<string, boolean>();
    private lastPollErrorLog = 0;

    private _newBlock$: BehaviorSubject<number> = new BehaviorSubject(undefined);
    public newBlock$ = this._newBlock$.pipe(filter(height => height != null), shareReplay({ refCount: true, bufferSize: 1 }));

    constructor(
        private readonly configService: ConfigService
    ) {
        this.enabled = `${this.configService.get('AUXPOW_ENABLED') ?? ''}`.toLowerCase() === 'true';
        this.refreshMs = parseInt(this.configService.get('DOICHAIN_AUXBLOCK_REFRESH_MS')) || 10000;
    }

    async onModuleInit() {
        if (!this.enabled) {
            console.log('Merged mining (AuxPoW) disabled, set AUXPOW_ENABLED=true to mine Doichain');
            return;
        }

        const url = this.configService.get('DOICHAIN_RPC_URL');
        let user = this.configService.get('DOICHAIN_RPC_USER');
        let pass = this.configService.get('DOICHAIN_RPC_PASSWORD');
        const port = parseInt(this.configService.get('DOICHAIN_RPC_PORT'));
        const timeout = parseInt(this.configService.get('DOICHAIN_RPC_TIMEOUT')) || 10000;
        const cookiefile = this.configService.get('DOICHAIN_RPC_COOKIEFILE');

        if (cookiefile != undefined && cookiefile != '') {
            const cookie = fs.readFileSync(cookiefile).toString().trim().split(':');
            user = cookie[0];
            pass = cookie[1];
        }

        this.client = axios.create({
            baseURL: this.buildRpcUrl(url, port),
            timeout,
            auth: {
                username: user,
                password: pass
            }
        });

        try {
            const info = await this.callRpc<{ chain: string, blocks: number }>('getblockchaininfo');
            this.chain = info.chain;
            this.blockHeight = info.blocks;
            console.log(`Doichain RPC connected (chain ${info.chain}, height ${info.blocks})`);
            this._newBlock$.next(info.blocks);
        } catch (e) {
            console.error('Could not reach Doichain RPC host:', e?.message ?? e);
        }

        const zmqHost = this.configService.get('DOICHAIN_ZMQ_HOST');
        if (zmqHost) {
            console.log('Doichain: using ZMQ hashblock');
            const sock = new zmq.Subscriber;
            sock.connectTimeout = 1000;
            sock.events.on('connect', () => {
                console.log('Doichain ZMQ connected');
            });
            sock.events.on('connect:retry', () => {
                console.log('Doichain ZMQ unable to connect, retrying');
            });
            sock.connect(zmqHost);
            sock.subscribe('hashblock');
            this.listenForNewBlocks(sock);
        }

        // Polling stays on as a fallback (cheap: getblockcount), also covers reorgs seen as a height change.
        const pollMs = parseInt(this.configService.get('DOICHAIN_POLL_INTERVAL_MS')) || 2000;
        setInterval(this.pollBlockCount.bind(this), pollMs);
    }

    private async listenForNewBlocks(sock: zmq.Subscriber) {
        for await (const [topic, msg] of sock) {
            await this.pollBlockCount();
        }
    }

    public async pollBlockCount() {
        try {
            const count = await this.callRpc<number>('getblockcount');
            if (count !== this.blockHeight) {
                console.log(`Doichain block height change: ${this.blockHeight} -> ${count}`);
                this.blockHeight = count;
                this.auxBlockCache.clear();
                this._newBlock$.next(count);
            }
        } catch (e) {
            const now = Date.now();
            if (now - this.lastPollErrorLog > 60000) {
                this.lastPollErrorLog = now;
                console.error('Doichain getblockcount failed:', e?.message ?? e);
            }
        }
    }

    /**
     * Returns the aux block to merge mine for an address. Cached per address until a new Doichain block arrives or
     * the refresh interval passes (the node rebuilds its template with new transactions after 60 seconds anyway).
     */
    public async getAuxBlock(address: string): Promise<IAuxBlock> {
        const cached = this.auxBlockCache.get(address);
        if (cached != null && Date.now() - cached.fetchedAt < this.refreshMs) {
            return cached.block;
        }

        let pending = this.pendingAuxBlock.get(address);
        if (pending == null) {
            pending = this.callRpc<IAuxBlock>('createauxblock', [address])
                .then(block => {
                    this.auxBlockCache.set(address, { block, fetchedAt: Date.now() });
                    return block;
                })
                .finally(() => {
                    this.pendingAuxBlock.delete(address);
                });
            this.pendingAuxBlock.set(address, pending);
        }
        return pending;
    }

    public invalidateAuxBlock(address: string) {
        this.auxBlockCache.delete(address);
    }

    public async submitAuxBlock(hash: string, auxpowHex: string): Promise<{ accepted: boolean, message: string }> {
        try {
            const result = await this.callRpc<boolean>('submitauxblock', [hash, auxpowHex]);
            console.log(`DOICHAIN AUXPOW SUBMISSION RESPONSE: ${JSON.stringify(result)} (aux block ${hash})`);
            return { accepted: result === true, message: result === true ? 'accepted' : `rejected: ${JSON.stringify(result)}` };
        } catch (e) {
            const message = e?.message ?? JSON.stringify(e);
            console.error(`DOICHAIN AUXPOW SUBMISSION ERROR: ${message} (aux block ${hash})`);
            return { accepted: false, message: `error: ${message}` };
        }
    }

    /** Validates a Doichain address with the node (covers legacy, P2SH and bech32 for the configured network). */
    public async validateAddress(address: string): Promise<boolean> {
        if (!this.enabled || address == null || address.length === 0) {
            return false;
        }
        if (this.addressCache.has(address)) {
            return this.addressCache.get(address);
        }
        try {
            const result = await this.callRpc<{ isvalid: boolean }>('validateaddress', [address]);
            const valid = result?.isvalid === true;
            this.addressCache.set(address, valid);
            return valid;
        } catch (e) {
            console.error('Doichain validateaddress failed:', e?.message ?? e);
            return false;
        }
    }

    public async getBlockCount(): Promise<number> {
        return this.callRpc<number>('getblockcount');
    }

    private async callRpc<T>(method: string, params: unknown[] = []): Promise<T> {
        const response = await this.client.post('', {
            jsonrpc: '1.0',
            id: ++this.rpcRequestId,
            method,
            params
        });

        if (response.data.error != null) {
            throw response.data.error;
        }

        return response.data.result;
    }

    private buildRpcUrl(url: string, port: number): string {
        const normalizedUrl = /^https?:\/\//i.test(url) ? url : `http://${url}`;
        const rpcUrl = new URL(normalizedUrl);
        if (Number.isFinite(port) && port > 0) {
            rpcUrl.port = port.toString();
        }
        return rpcUrl.toString();
    }
}
