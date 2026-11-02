import * as bitcoinjs from 'bitcoinjs-lib';

import { encodeVarInt, IAuxBlock } from '../models/auxpow';

/**
 * Builds a complete Doichain (aux chain) block from `getblocktemplate` with a coinbase that pays several
 * outputs: the syndicate block. `createauxblock` can only pay one address, so for shared rewards the pool
 * assembles the block itself and hands it in with `submitblock` (header, AuxPoW proof, transactions).
 *
 * Block layout as Doichain Core serialises it (src/primitives/block.h, CBlockHeader with auxpow):
 *   80 byte header | CAuxPow (when version has the auxpow flag) | varint tx count | coinbase | transactions
 */

/** version bit that announces an AuxPoW proof after the header (Doichain Core: VERSION_AUXPOW = 1 << 8) */
export const VERSION_AUXPOW_FLAG = 0x100;
/** chain ID lives in the upper 16 bits of the version (VERSION_CHAIN_START = 1 << 16) */
export const VERSION_CHAIN_START = 0x10000;
const WITNESS_COMMITMENT_HEADER = Buffer.from('aa21a9ed', 'hex');
const DEFAULT_WEIGHT_LIMIT = 4_000_000;
const DEFAULT_SIGOP_LIMIT = 80_000;
const MAX_COINBASE_SCRIPT = 100;
const MAX_AUX_BLOCK_TIME_SKEW = 2 * 60 * 60;

export interface IAuxTemplateTx {
    /** complete transaction, witness serialisation, hex */
    data: string;
    txid: string;
    /** wtxid (same as txid without witness) */
    hash: string;
    weight?: number;
    sigops?: number;
    fee?: number;
    depends?: number[];
}

/** the parts of `getblocktemplate` the block builder uses */
export interface IAuxTemplate {
    version: number;
    previousblockhash: string;
    transactions: IAuxTemplateTx[];
    coinbasevalue: number;
    bits: string;
    height: number;
    curtime: number;
    mintime?: number;
    weightlimit?: number;
    sigoplimit?: number;
    default_witness_commitment?: string;
}

export interface AuxPayoutScript {
    address: string;
    /** scriptPubKey */
    script: Buffer;
    /** integer coin units */
    amount: number;
}

export interface BuiltAuxBlock extends IAuxBlock {
    /** 80 byte header, nonce 0 */
    header: Buffer;
    /** header hash in internal byte order */
    hashLE: Buffer;
    version: number;
    time: number;
    merkleRoot: Buffer;
    /** scriptPubKey of the witness commitment output (hex) */
    witnessCommitment: string;
    /** complete coinbase transaction, witness serialisation */
    coinbaseTx: Buffer;
    coinbaseTxid: string;
    transactions: IAuxTemplateTx[];
    droppedTransactions: number;
    payouts: AuxPayoutScript[];
    /** sum of the payouts, the full coinbase value */
    paidOut: number;
    weight: number;
}

export interface BuildOptions {
    /** ASCII tag written into the coinbase scriptSig after the height */
    tag?: string;
    /** unix seconds, defaults to now */
    now?: number;
}

/** Doichain-style txid strings are display order; the merkle tree works on internal order. */
export function hashFromHex(displayHex: string): Buffer {
    const buffer = Buffer.from(displayHex, 'hex');
    if (buffer.length !== 32) {
        throw new Error(`hash must be 32 bytes, got ${buffer.length}`);
    }
    return Buffer.from(buffer).reverse();
}

/** merkle root over hashes in internal byte order, odd levels duplicate the last entry */
export function merkleRoot(hashes: Buffer[]): Buffer {
    if (hashes.length === 0) {
        throw new Error('merkle root of nothing');
    }
    let level = hashes;
    while (level.length > 1) {
        const next: Buffer[] = [];
        for (let i = 0; i < level.length; i += 2) {
            const left = level[i];
            const right = i + 1 < level.length ? level[i + 1] : level[i];
            next.push(bitcoinjs.crypto.hash256(Buffer.concat([left, right])));
        }
        level = next;
    }
    return level[0];
}

/** BIP141 witness commitment scriptPubKey for a block with the given coinbase and transactions */
export function witnessCommitmentScript(transactions: IAuxTemplateTx[], witnessReservedValue: Buffer): Buffer {
    const root = merkleRoot([Buffer.alloc(32, 0), ...transactions.map(tx => hashFromHex(tx.hash))]);
    const commitment = bitcoinjs.crypto.hash256(Buffer.concat([root, witnessReservedValue]));
    return bitcoinjs.script.compile([bitcoinjs.opcodes.OP_RETURN, Buffer.concat([WITNESS_COMMITMENT_HEADER, commitment])]);
}

/** scriptSig: BIP34 height push, then an ASCII tag (kept within the 100 byte consensus limit) */
export function coinbaseScript(height: number, tag: string): Buffer {
    const heightBytes = bitcoinjs.script.number.encode(height);
    const heightPush = Buffer.concat([Buffer.from([heightBytes.length]), heightBytes]);
    let tagBytes = Buffer.from(tag, 'ascii');
    const room = MAX_COINBASE_SCRIPT - heightPush.length;
    if (tagBytes.length > room) {
        tagBytes = tagBytes.subarray(0, room);
    }
    return Buffer.concat([heightPush, tagBytes]);
}

/** Converts the built block into the shape MiningJob expects (same fields as createauxblock). */
function asAuxBlock(built: Omit<BuiltAuxBlock, keyof IAuxBlock>, template: IAuxTemplate, hashLE: Buffer, paidOut: number): BuiltAuxBlock {
    return {
        hash: Buffer.from(hashLE).reverse().toString('hex'),
        chainid: built.version >>> 16,
        previousblockhash: template.previousblockhash,
        coinbasevalue: paidOut,
        bits: template.bits,
        height: template.height,
        ...built
    };
}

/**
 * Assembles the block. Transactions are dropped from the end while the block would exceed the weight or
 * sigop limit (the template lists dependencies before dependants, so cutting the tail stays valid).
 */
export function buildAuxBlock(template: IAuxTemplate, payouts: AuxPayoutScript[], options: BuildOptions = {}): BuiltAuxBlock {
    if (payouts.length === 0) {
        throw new Error('aux block needs at least one payout');
    }
    const paidOut = payouts.reduce((acc, p) => acc + p.amount, 0);
    if (paidOut > template.coinbasevalue) {
        throw new Error(`payouts (${paidOut}) exceed the coinbase value (${template.coinbasevalue})`);
    }
    for (const payout of payouts) {
        if (!Number.isInteger(payout.amount) || payout.amount <= 0) {
            throw new Error(`invalid payout amount for ${payout.address}: ${payout.amount}`);
        }
        if (!Buffer.isBuffer(payout.script) || payout.script.length === 0) {
            throw new Error(`missing script for ${payout.address}`);
        }
    }

    const witnessReservedValue = Buffer.alloc(32, 0);
    const weightLimit = template.weightlimit ?? DEFAULT_WEIGHT_LIMIT;
    const sigopLimit = template.sigoplimit ?? DEFAULT_SIGOP_LIMIT;

    const makeCoinbase = (transactions: IAuxTemplateTx[]): bitcoinjs.Transaction => {
        const tx = new bitcoinjs.Transaction();
        tx.version = 1;
        tx.addInput(Buffer.alloc(32, 0), 0xffffffff, 0xffffffff, coinbaseScript(template.height, options.tag ?? 'NerdPool/syndicate/'));
        tx.ins[0].witness = [witnessReservedValue];
        for (const payout of payouts) {
            tx.addOutput(payout.script, payout.amount);
        }
        // the commitment is the last output, Doichain Core looks for the last one matching the pattern
        const untouched = transactions.length === template.transactions.length;
        const commitment = untouched && template.default_witness_commitment
            ? Buffer.from(template.default_witness_commitment, 'hex')
            : witnessCommitmentScript(transactions, witnessReservedValue);
        tx.addOutput(commitment, 0);
        return tx;
    };

    let transactions = template.transactions.slice();
    let coinbase = makeCoinbase(transactions);
    // coinbase outputs are counted like legacy sigops (4 weight units each); P2WPKH outputs carry none,
    // an over estimate here only costs a transaction in a full block
    const coinbaseSigops = payouts.length * 4;
    const totalWeight = () => coinbase.weight() + transactions.reduce((acc, tx) => acc + (tx.weight ?? 0), 0);
    const totalSigops = () => coinbaseSigops + transactions.reduce((acc, tx) => acc + (tx.sigops ?? 0), 0);
    while (transactions.length > 0 && (totalWeight() > weightLimit || totalSigops() > sigopLimit)) {
        transactions.pop();
        coinbase = makeCoinbase(transactions);
    }
    if (totalWeight() > weightLimit) {
        throw new Error(`coinbase alone exceeds the block weight limit (${coinbase.weight()} > ${weightLimit})`);
    }

    const coinbaseTx = coinbase.toBuffer();
    const coinbaseTxidLE = coinbase.getHash(false);
    const root = merkleRoot([coinbaseTxidLE, ...transactions.map(tx => hashFromHex(tx.txid))]);

    const now = options.now ?? Math.floor(Date.now() / 1000);
    const time = Math.min(Math.max(template.curtime, template.mintime ?? 0, now), now + MAX_AUX_BLOCK_TIME_SKEW);
    const version = (template.version | VERSION_AUXPOW_FLAG) >>> 0;

    const header = Buffer.alloc(80);
    header.writeInt32LE(version | 0, 0);
    hashFromHex(template.previousblockhash).copy(header, 4);
    root.copy(header, 36);
    header.writeUInt32LE(time, 68);
    header.writeUInt32LE(parseInt(template.bits, 16) >>> 0, 72);
    header.writeUInt32LE(0, 76);
    const hashLE = bitcoinjs.crypto.hash256(header);

    return asAuxBlock({
        header,
        hashLE,
        version: version | 0,
        time,
        merkleRoot: root,
        witnessCommitment: coinbase.outs[coinbase.outs.length - 1].script.toString('hex'),
        coinbaseTx,
        coinbaseTxid: Buffer.from(coinbaseTxidLE).reverse().toString('hex'),
        transactions,
        droppedTransactions: template.transactions.length - transactions.length,
        payouts,
        paidOut,
        weight: totalWeight()
    }, template, hashLE, paidOut);
}

/** The block as `submitblock` wants it: header, AuxPoW proof, transaction count, coinbase, transactions. */
export function serializeAuxBlock(block: BuiltAuxBlock, auxPow: Buffer): Buffer {
    if (block.header.length !== 80) {
        throw new Error('header must be 80 bytes');
    }
    return Buffer.concat([
        block.header,
        auxPow,
        encodeVarInt(block.transactions.length + 1),
        block.coinbaseTx,
        ...block.transactions.map(tx => Buffer.from(tx.data, 'hex'))
    ]);
}

/** Reads the 80 byte header back (for tests and the proof endpoint). */
export function parseHeader(header: Buffer): { version: number, previousblockhash: string, merkleRoot: string, time: number, bits: string, nonce: number } {
    if (header.length < 80) {
        throw new Error('header too short');
    }
    return {
        version: header.readInt32LE(0),
        previousblockhash: Buffer.from(header.subarray(4, 36)).reverse().toString('hex'),
        merkleRoot: Buffer.from(header.subarray(36, 68)).reverse().toString('hex'),
        time: header.readUInt32LE(68),
        bits: header.readUInt32LE(72).toString(16).padStart(8, '0'),
        nonce: header.readUInt32LE(76)
    };
}
