/**
 * AuxPoW (merged mining) helpers for a Namecoin-style auxiliary chain such as Doichain.
 *
 * The parent chain (Bitcoin) coinbase scriptSig carries a 44 byte tag:
 *   fa be 6d 6d | aux block hash (32 bytes, display byte order) | merkle size (uint32 LE) | merkle nonce (uint32 LE)
 * When the parent block header hash is below the aux chain target, the proof (CAuxPow) is submitted to the
 * aux chain with `submitauxblock <hash> <auxpow hex>`.
 *
 * Reference: Doichain Core src/auxpow.h (serialization) and src/auxpow.cpp (CAuxPow::check).
 */

export const MERGED_MINING_HEADER = Buffer.from('fabe6d6d', 'hex');

/** magic (4) + root hash (32) + merkle size (4) + merkle nonce (4) */
export const AUX_TAG_SIZE_BYTES = 44;

/** Result of `createauxblock <address>` */
export interface IAuxBlock {
    hash: string;               // aux block hash, display byte order (as printed by the node)
    chainid: number;
    previousblockhash: string;
    coinbasevalue: number;      // satoshi-like units of the aux chain
    bits: string;               // compact target, 8 hex characters
    height: number;
    _target?: string;           // deprecated, reversed byte order
}

/**
 * Builds the merged mining tag for a single aux chain (merkle size 1, nonce 0).
 * With one chain the chain merkle root is the aux block hash itself and the expected slot index is 0.
 */
export function buildAuxTag(auxBlockHash: string): Buffer {
    const hash = Buffer.from(auxBlockHash, 'hex');
    if (hash.length !== 32) {
        throw new Error(`aux block hash must be 32 bytes, got ${hash.length}`);
    }
    const merkleSize = Buffer.alloc(4);
    merkleSize.writeUInt32LE(1, 0);
    const merkleNonce = Buffer.alloc(4, 0);
    return Buffer.concat([MERGED_MINING_HEADER, hash, merkleSize, merkleNonce]);
}

/** Position of the merged mining tag inside a coinbase scriptSig, -1 if absent. */
export function findAuxTag(script: Buffer): number {
    return script.indexOf(MERGED_MINING_HEADER);
}

/** Decodes a compact target ("bits") into a 256 bit integer. */
export function targetFromBits(bits: number | string): bigint {
    const nBits = typeof bits === 'string' ? parseInt(bits, 16) : bits;
    const exponent = nBits >>> 24;
    const mantissa = BigInt(nBits & 0x007fffff);
    if (exponent <= 3) {
        return mantissa >> BigInt(8 * (3 - exponent));
    }
    return mantissa << BigInt(8 * (exponent - 3));
}

const MAX_TARGET_DIFF_ONE = BigInt('0xffff') << BigInt(208);

/** Difficulty relative to the Bitcoin difficulty-1 target (same convention the node uses for display). */
export function difficultyFromBits(bits: number | string): number {
    const target = targetFromBits(bits);
    if (target === BigInt(0)) {
        return Number.POSITIVE_INFINITY;
    }
    // keep a few decimal digits for small regtest difficulties
    return Number((MAX_TARGET_DIFF_ONE * BigInt(1_000_000)) / target) / 1_000_000;
}

/** Interprets a 32 byte hash in internal (little-endian) byte order as an integer. */
export function hashToBigInt(hashLE: Buffer): bigint {
    let value = BigInt(0);
    for (let i = hashLE.length - 1; i >= 0; i--) {
        value = (value << BigInt(8)) | BigInt(hashLE[i]);
    }
    return value;
}

/** True when the header hash (internal byte order, as returned by hash256) satisfies the target. */
export function hashMeetsTarget(hashLE: Buffer, target: bigint): boolean {
    return hashToBigInt(hashLE) <= target;
}

export function encodeVarInt(n: number): Buffer {
    if (n < 0xfd) {
        return Buffer.from([n]);
    }
    if (n <= 0xffff) {
        const b = Buffer.alloc(3);
        b[0] = 0xfd;
        b.writeUInt16LE(n, 1);
        return b;
    }
    if (n <= 0xffffffff) {
        const b = Buffer.alloc(5);
        b[0] = 0xfe;
        b.writeUInt32LE(n, 1);
        return b;
    }
    const b = Buffer.alloc(9);
    b[0] = 0xff;
    b.writeBigUInt64LE(BigInt(n), 1);
    return b;
}

/**
 * Serializes a CAuxPow for a single aux chain:
 *   coinbase tx (with witness) | hashBlock (32 zero bytes) | coinbase merkle branch | nIndex (0)
 *   | chain merkle branch (empty) | nChainIndex (0) | parent block header (80 bytes)
 *
 * @param coinbaseTx     the complete parent coinbase transaction as mined (extranonces filled in), witness serialization
 * @param coinbaseBranch merkle branch from the coinbase (index 0) to the parent merkle root, internal byte order
 * @param parentHeader   the 80 byte parent block header as mined
 */
export function serializeAuxPow(coinbaseTx: Buffer, coinbaseBranch: Buffer[], parentHeader: Buffer): Buffer {
    if (parentHeader.length !== 80) {
        throw new Error(`parent header must be 80 bytes, got ${parentHeader.length}`);
    }
    for (const branch of coinbaseBranch) {
        if (branch.length !== 32) {
            throw new Error('merkle branch entries must be 32 bytes');
        }
    }
    const zero32 = Buffer.alloc(32, 0);
    const int32Zero = Buffer.alloc(4, 0);
    return Buffer.concat([
        coinbaseTx,
        zero32,
        encodeVarInt(coinbaseBranch.length),
        ...coinbaseBranch,
        int32Zero,            // nIndex: coinbase is always index 0
        encodeVarInt(0),      // vChainMerkleBranch: empty for a single aux chain
        int32Zero,            // nChainIndex: getExpectedIndex(nonce 0, chainId, height 0) == 0
        parentHeader
    ]);
}
