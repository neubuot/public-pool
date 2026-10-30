import { NotFoundException } from '@nestjs/common';

import { ExplorerService } from './explorer.service';

const HASH = 'b73b413faf623573da7d488b6d7bfec1fd1db297951a6c2d6bd1dd14a1b75501';
const PARENT = '00000000000000003e2877e5cdfc6258e6f298cde8f29799175cb146d9570351';
const COINBASE_TXID = '39f46a22def463b0fb717e61479f8b8d698c7c1327320d1d4ae3187761c59c13';
const NAME_TXID = 'ce89a97c0eb618ad90a2261961a55d71ea153730ab2d83629bc9ded66b42172f';

function doiBlockFixture() {
    return {
        hash: HASH, height: 438658, time: 1793393465, nTx: 2, size: 1319, weight: 5168, difficulty: 9605320818.3, bits: '1872779f',
        nonce: 0, version: 131332, merkleroot: 'ac31', previousblockhash: 'e76b', nextblockhash: null, confirmations: 1,
        auxpow: { chainindex: 24, parentblock: { hash: PARENT } },
        tx: [
            { txid: COINBASE_TXID, size: 200, vsize: 180, vin: [{ coinbase: '03' }], vout: [{ value: 12.5, n: 0, scriptPubKey: { address: 'MxoYD2HRBW9HRKZdozDZ3i9KUYrdyc1anN', type: 'scripthash' } }] },
            {
                txid: NAME_TXID, size: 461, vsize: 461, vin: [{ txid: '7667', vout: 0 }],
                vout: [
                    { value: 0.01, n: 0, scriptPubKey: { address: 'NBEt', type: 'pubkeyhash', nameOp: { op: 'name_doi', name: 'poe/abc', value: '{}' } } },
                    { value: 19.436, n: 1, scriptPubKey: { address: 'NCmS', type: 'pubkeyhash' } }
                ]
            }
        ]
    };
}

function build(overrides: { doiEnabled?: boolean } = {}) {
    const doiRpc = jest.fn();
    const btcRpc = jest.fn();
    const service = new ExplorerService(
        { rpc: btcRpc } as any,
        { enabled: overrides.doiEnabled ?? true, rpc: doiRpc, validateAddress: jest.fn().mockResolvedValue(false) } as any,
        { getRecentBlocks: jest.fn().mockResolvedValue([{ blockHash: HASH }]) } as any,
        { get: () => undefined } as any,
    );
    return { service, doiRpc, btcRpc };
}

describe('ExplorerService', () => {
    it('maps a Doichain block with AuxPoW, coinbase payout and name operations', async () => {
        const { service, doiRpc } = build();
        doiRpc.mockImplementation(async (method: string) => {
            if (method === 'getblockhash') return HASH;
            if (method === 'getblock') return doiBlockFixture();
            throw new Error('unexpected ' + method);
        });
        const block = await service.doiBlock('438658');
        expect(block.chain).toBe('DOI');
        expect(block.height).toBe(438658);
        expect(block.auxpow).toEqual({ parentBlockHash: PARENT, chainIndex: 24 });
        expect(block.minedTo).toBe('MxoYD2HRBW9HRKZdozDZ3i9KUYrdyc1anN');
        expect(block.poolBlock).toBe(true);
        expect(block.txCount).toBe(2);
        expect(block.txs[0].coinbase).toBe(true);
        expect(block.txs[1].nameOps).toEqual([{ op: 'name_doi', name: 'poe/abc', value: '{}' }]);
        expect(block.txs[1].valueOut).toBeCloseTo(19.446, 6);
        // second call comes from the cache, no further RPC
        const calls = doiRpc.mock.calls.length;
        await service.doiBlock(HASH);
        expect(doiRpc.mock.calls.length).toBe(calls);
    });

    it('turns an unknown block into a 404', async () => {
        const { service, doiRpc } = build();
        doiRpc.mockRejectedValue(new Error('Doichain RPC getblock: Block not found (code -5)'));
        await expect(service.doiBlock(HASH)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('refuses Doichain lookups when merged mining is off', async () => {
        const { service } = build({ doiEnabled: false });
        await expect(service.doiBlocks()).rejects.toThrow('nicht aktiv');
    });

    it('classifies a height, a hash and an address in search', async () => {
        const { service, doiRpc, btcRpc } = build();
        doiRpc.mockImplementation(async (method: string, params: unknown[]) => {
            if (method === 'getblockcount') return 438700;
            if (method === 'getblockheader' && params[0] === HASH) return { height: 438658 };
            throw new Error('nope');
        });
        btcRpc.mockImplementation(async (method: string) => {
            if (method === 'getblockchaininfo') return { blocks: 800000, headers: 973000 };
            throw new Error('nope');
        });
        expect(await service.search('438600')).toEqual({ type: 'height', height: 438600, chains: ['DOI', 'BTC'] });
        expect(await service.search('900000')).toEqual({ type: 'height', height: 900000, chains: ['BTC'] });
        expect(await service.search(HASH)).toEqual({ type: 'block', chain: 'DOI', hash: HASH, height: 438658 });
        expect(await service.search('bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh')).toEqual({ type: 'address', chain: 'BTC', address: 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh' });
        await expect(service.search('???')).rejects.toBeInstanceOf(NotFoundException);
    });
});
