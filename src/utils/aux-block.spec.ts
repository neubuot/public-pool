import * as bitcoinjs from 'bitcoinjs-lib';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { serializeAuxPow } from '../models/auxpow';
import { buildAuxBlock, coinbaseScript, hashFromHex, IAuxTemplate, merkleRoot, parseHeader, serializeAuxBlock, VERSION_AUXPOW_FLAG, witnessCommitmentScript } from './aux-block';

/** a real Doichain mainnet template (height 439094, one transaction) recorded on 2026-11-02 */
const template: IAuxTemplate = JSON.parse(fs.readFileSync(path.join(__dirname, '../../test/fixtures/doichain-template.json'), 'utf8'));

function p2wpkh(byte: number): Buffer {
    return Buffer.concat([Buffer.from('0014', 'hex'), Buffer.alloc(20, byte)]);
}

describe('aux-block', () => {

    describe('merkleRoot', () => {
        it('returns the only hash unchanged', () => {
            const h = Buffer.alloc(32, 7);
            expect(merkleRoot([h])).toEqual(h);
        });

        it('matches bitcoinjs for a two leaf tree', () => {
            const a = Buffer.alloc(32, 1);
            const b = Buffer.alloc(32, 2);
            expect(merkleRoot([a, b])).toEqual(bitcoinjs.crypto.hash256(Buffer.concat([a, b])));
        });

        it('duplicates the last entry on odd levels', () => {
            const a = Buffer.alloc(32, 1);
            const b = Buffer.alloc(32, 2);
            const c = Buffer.alloc(32, 3);
            const left = bitcoinjs.crypto.hash256(Buffer.concat([a, b]));
            const right = bitcoinjs.crypto.hash256(Buffer.concat([c, c]));
            expect(merkleRoot([a, b, c])).toEqual(bitcoinjs.crypto.hash256(Buffer.concat([left, right])));
        });
    });

    describe('witnessCommitmentScript', () => {
        it('reproduces the commitment Doichain Core put into the template', () => {
            const script = witnessCommitmentScript(template.transactions, Buffer.alloc(32, 0));
            expect(script.toString('hex')).toBe(template.default_witness_commitment);
        });
    });

    describe('coinbaseScript', () => {
        it('starts with the BIP34 height push', () => {
            // 439094 = 0x06b336 -> push 3 bytes 36 b3 06 (block 438820 = 0x06b224 carried 0324b206 the same way)
            const script = coinbaseScript(439094, 'NerdPool/syndicate/');
            expect(script.subarray(0, 4).toString('hex')).toBe('0336b306');
            expect(coinbaseScript(438820, '').toString('hex')).toBe('0324b206');
            expect(script.subarray(4).toString('ascii')).toBe('NerdPool/syndicate/');
        });

        it('never exceeds 100 bytes', () => {
            expect(coinbaseScript(439094, 'x'.repeat(200)).length).toBe(100);
        });
    });

    describe('buildAuxBlock', () => {
        const payouts = [
            { address: 'member-a', script: p2wpkh(0xaa), amount: 1_000_000_000 },
            { address: 'member-b', script: p2wpkh(0xbb), amount: 250_046_128 }
        ];

        it('builds a header with the auxpow flag, the chain id and the template fields', () => {
            const block = buildAuxBlock(template, payouts, { now: template.curtime + 5 });
            const header = parseHeader(block.header);
            expect(header.version).toBe(template.version | VERSION_AUXPOW_FLAG);
            expect(header.version).toBe(0x00020104);
            expect(block.chainid).toBe(2);
            expect(header.previousblockhash).toBe(template.previousblockhash);
            expect(header.bits).toBe(template.bits);
            expect(header.nonce).toBe(0);
            expect(header.time).toBe(template.curtime + 5);
            expect(block.height).toBe(template.height);
            expect(block.hash).toBe(Buffer.from(block.hashLE).reverse().toString('hex'));
            expect(block.hash.length).toBe(64);
        });

        it('pays every member and ends with the node\'s witness commitment', () => {
            const block = buildAuxBlock(template, payouts);
            const coinbase = bitcoinjs.Transaction.fromBuffer(block.coinbaseTx);
            expect(coinbase.ins.length).toBe(1);
            expect(coinbase.ins[0].witness[0]).toEqual(Buffer.alloc(32, 0));
            expect(coinbase.ins[0].script.subarray(0, 4).toString('hex')).toBe('0336b306');
            expect(coinbase.outs.length).toBe(3);
            expect(coinbase.outs[0]).toEqual({ script: p2wpkh(0xaa), value: 1_000_000_000 });
            expect(coinbase.outs[1]).toEqual({ script: p2wpkh(0xbb), value: 250_046_128 });
            expect(coinbase.outs[2].value).toBe(0);
            expect(coinbase.outs[2].script.toString('hex')).toBe(template.default_witness_commitment);
            expect(block.witnessCommitment).toBe(template.default_witness_commitment);
            expect(block.paidOut).toBe(template.coinbasevalue);
            expect(block.coinbasevalue).toBe(template.coinbasevalue);
            expect(block.coinbaseTxid).toBe(Buffer.from(coinbase.getHash(false)).reverse().toString('hex'));
        });

        it('commits to the coinbase and the template transactions in the merkle root', () => {
            const block = buildAuxBlock(template, payouts);
            const expected = merkleRoot([hashFromHex(block.coinbaseTxid), ...template.transactions.map(tx => hashFromHex(tx.txid))]);
            expect(block.merkleRoot).toEqual(expected);
            expect(parseHeader(block.header).merkleRoot).toBe(Buffer.from(expected).reverse().toString('hex'));
            expect(block.droppedTransactions).toBe(0);
            expect(block.transactions.length).toBe(template.transactions.length);
        });

        it('drops transactions from the end when the block would be too heavy and recomputes the commitment', () => {
            const block = buildAuxBlock({ ...template, weightlimit: 2000 }, payouts);
            expect(block.droppedTransactions).toBe(1);
            expect(block.transactions.length).toBe(0);
            expect(block.witnessCommitment).toBe(witnessCommitmentScript([], Buffer.alloc(32, 0)).toString('hex'));
            expect(block.witnessCommitment).not.toBe(template.default_witness_commitment);
            expect(block.merkleRoot).toEqual(hashFromHex(block.coinbaseTxid));
            expect(block.weight).toBeLessThanOrEqual(2000);
        });

        it('keeps the block time within the template limits', () => {
            const early = buildAuxBlock(template, payouts, { now: template.mintime - 100 });
            expect(early.time).toBe(Math.max(template.curtime, template.mintime));
            const late = buildAuxBlock(template, payouts, { now: template.curtime + 10 * 24 * 3600 });
            expect(late.time).toBe(template.curtime + 10 * 24 * 3600);
        });

        it('refuses payouts above the coinbase value, zero amounts and missing payouts', () => {
            expect(() => buildAuxBlock(template, [{ address: 'a', script: p2wpkh(1), amount: template.coinbasevalue + 1 }])).toThrow(/exceed/);
            expect(() => buildAuxBlock(template, [{ address: 'a', script: p2wpkh(1), amount: 0 }])).toThrow(/invalid payout/);
            expect(() => buildAuxBlock(template, [])).toThrow(/at least one/);
        });
    });

    describe('serializeAuxBlock', () => {
        it('concatenates header, proof, count, coinbase and transactions', () => {
            const block = buildAuxBlock(template, [{ address: 'a', script: p2wpkh(1), amount: template.coinbasevalue }]);
            const parentCoinbase = Buffer.from('02000000010000000000000000000000000000000000000000000000000000000000000000ffffffff0100ffffffff0100f2052a01000000160014aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa00000000', 'hex');
            const proof = serializeAuxPow(parentCoinbase, [Buffer.alloc(32, 9)], Buffer.alloc(80, 1));
            const hex = serializeAuxBlock(block, proof);
            const txData = Buffer.from(template.transactions[0].data, 'hex');
            expect(hex.length).toBe(80 + proof.length + 1 + block.coinbaseTx.length + txData.length);
            expect(hex.subarray(0, 80)).toEqual(block.header);
            expect(hex.subarray(80, 80 + proof.length)).toEqual(proof);
            expect(hex[80 + proof.length]).toBe(2);
            expect(hex.subarray(hex.length - txData.length)).toEqual(txData);
        });
    });
});
