import * as bitcoinjs from 'bitcoinjs-lib';

import { describeCoinbaseOutputs, hasAuxTag, networkFor, payoutsFor } from './coinbase-proof';

const MINER = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';
const FEE = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq';

function coinbase(outputs: { address?: string; script?: Buffer; value: number }[], scriptSig = Buffer.from('03e0db0e', 'hex')): bitcoinjs.Transaction {
    const tx = new bitcoinjs.Transaction();
    tx.addInput(Buffer.alloc(32, 0), 0xffffffff, 0xffffffff, scriptSig);
    for (const out of outputs) {
        const script = out.script ?? bitcoinjs.payments.p2wpkh({ address: out.address, network: bitcoinjs.networks.bitcoin }).output;
        tx.addOutput(script, out.value);
    }
    return tx;
}

describe('coinbase proof', () => {
    it('tells the miner payout, a fee output and the witness commitment apart', () => {
        const commitment = bitcoinjs.script.compile([bitcoinjs.opcodes.OP_RETURN, Buffer.concat([Buffer.from('aa21a9ed', 'hex'), Buffer.alloc(32, 1)])]);
        const tx = coinbase([
            { address: FEE, value: 4_687_500 },
            { address: MINER, value: 307_812_500 },
            { script: commitment, value: 0 },
        ]);
        const outputs = describeCoinbaseOutputs(tx, bitcoinjs.networks.bitcoin, MINER, FEE);
        expect(outputs).toEqual([
            { index: 0, value: 4_687_500, address: FEE, kind: 'fee', yours: false },
            { index: 1, value: 307_812_500, address: MINER, kind: 'payout', yours: true },
            { index: 2, value: 0, address: null, kind: 'witness-commitment', yours: false },
        ]);
    });

    it('marks an unknown address as other', () => {
        const tx = coinbase([{ address: FEE, value: 1 }]);
        expect(describeCoinbaseOutputs(tx, bitcoinjs.networks.bitcoin, MINER, null)[0].kind).toBe('other');
    });

    it('finds the merged mining tag in the scriptSig', () => {
        const tagged = coinbase([{ address: MINER, value: 1 }], Buffer.from('03e0db0e' + 'fabe6d6d' + '11'.repeat(32) + '0100000000000000', 'hex'));
        expect(hasAuxTag(tagged)).toBe(true);
        expect(hasAuxTag(coinbase([{ address: MINER, value: 1 }]))).toBe(false);
    });

    it('applies the dev fee only above 50 TH/s and with a fee address', () => {
        expect(payoutsFor(MINER, null, 1e15)).toEqual([{ address: MINER, percent: 100 }]);
        expect(payoutsFor(MINER, FEE, 1e12)).toEqual([{ address: MINER, percent: 100 }]);
        expect(payoutsFor(MINER, FEE, 60e12)).toEqual([{ address: FEE, percent: 1.5 }, { address: MINER, percent: 98.5 }]);
        expect(networkFor('regtest')).toBe(bitcoinjs.networks.regtest);
        expect(networkFor(undefined)).toBe(bitcoinjs.networks.bitcoin);
    });
});
