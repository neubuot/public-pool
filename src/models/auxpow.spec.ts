import * as bitcoinjs from 'bitcoinjs-lib';

import {
    AUX_TAG_SIZE_BYTES,
    buildAuxTag,
    difficultyFromBits,
    encodeVarInt,
    findAuxTag,
    hashMeetsTarget,
    hashToBigInt,
    serializeAuxPow,
    targetFromBits
} from './auxpow';

describe('auxpow', () => {

    const auxHash = 'b197bddaadd0cb2d3d761f7d2e288aa250e536ee2790f710cbb577a51759f241';

    describe('buildAuxTag', () => {
        it('is 44 bytes: magic, hash in display order, size 1, nonce 0', () => {
            const tag = buildAuxTag(auxHash);
            expect(tag.length).toBe(AUX_TAG_SIZE_BYTES);
            expect(tag.subarray(0, 4).toString('hex')).toBe('fabe6d6d');
            expect(tag.subarray(4, 36).toString('hex')).toBe(auxHash);
            expect(tag.subarray(36, 40).toString('hex')).toBe('01000000');
            expect(tag.subarray(40, 44).toString('hex')).toBe('00000000');
        });

        it('rejects hashes that are not 32 bytes', () => {
            expect(() => buildAuxTag('abcd')).toThrow();
        });

        it('is found inside a coinbase script', () => {
            const script = Buffer.concat([Buffer.from('03aabbcc', 'hex'), Buffer.from('NerdPool'), buildAuxTag(auxHash), Buffer.alloc(12, 0)]);
            expect(findAuxTag(script)).toBe(4 + 8);
        });
    });

    describe('targetFromBits', () => {
        it('decodes the difficulty 1 target', () => {
            expect(targetFromBits('1d00ffff')).toBe(BigInt('0xffff') << BigInt(208));
            expect(difficultyFromBits('1d00ffff')).toBe(1);
        });

        it('decodes the Doichain regtest limit', () => {
            // regtest powLimit 7fff...: bits 207fffff
            expect(targetFromBits('207fffff')).toBe(BigInt('0x7fffff') << BigInt(8 * 29));
        });

        it('decodes a mainnet Doichain target', () => {
            // bits 19008879 -> target 0000000000000000887900000000000000000000000000000000000000000000
            expect(targetFromBits('19008879').toString(16).padStart(64, '0')).toBe('0000000000000000887900000000000000000000000000000000000000000000');
            expect(Math.round(difficultyFromBits('19008879'))).toBe(8056521217);
        });
    });

    describe('hashMeetsTarget', () => {
        it('compares the hash as little-endian integer', () => {
            const target = targetFromBits('1d00ffff');
            const low = Buffer.alloc(32, 0);
            low[0] = 1;
            expect(hashToBigInt(low)).toBe(BigInt(1));
            expect(hashMeetsTarget(low, target)).toBe(true);

            const high = Buffer.alloc(32, 0);
            high[31] = 0x01;
            expect(hashMeetsTarget(high, target)).toBe(false);
        });
    });

    describe('encodeVarInt', () => {
        it('encodes the usual ranges', () => {
            expect(encodeVarInt(0).toString('hex')).toBe('00');
            expect(encodeVarInt(252).toString('hex')).toBe('fc');
            expect(encodeVarInt(253).toString('hex')).toBe('fdfd00');
            expect(encodeVarInt(0x10000).toString('hex')).toBe('fe00000100');
        });
    });

    describe('serializeAuxPow', () => {
        it('lays out coinbase, zero hash, branch, index, empty chain branch, chain index and header', () => {
            const coinbase = new bitcoinjs.Transaction();
            coinbase.version = 2;
            coinbase.addInput(Buffer.alloc(32, 0), 0xffffffff, 0xffffffff);
            coinbase.ins[0].script = Buffer.concat([Buffer.from('0301000000', 'hex'), buildAuxTag(auxHash), Buffer.alloc(12, 0)]);
            coinbase.ins[0].witness = [Buffer.alloc(32, 0)];
            coinbase.addOutput(Buffer.from('6a', 'hex'), 0);
            const coinbaseBytes = coinbase.toBuffer();

            const branch = [Buffer.alloc(32, 0xaa), Buffer.alloc(32, 0xbb)];
            const header = Buffer.alloc(80, 0xcc);

            const auxpow = serializeAuxPow(coinbaseBytes, branch, header);

            let offset = 0;
            expect(auxpow.subarray(offset, offset + coinbaseBytes.length).equals(coinbaseBytes)).toBe(true);
            offset += coinbaseBytes.length;
            expect(auxpow.subarray(offset, offset + 32).equals(Buffer.alloc(32, 0))).toBe(true);
            offset += 32;
            expect(auxpow[offset]).toBe(2);
            offset += 1;
            expect(auxpow.subarray(offset, offset + 32).equals(branch[0])).toBe(true);
            offset += 32;
            expect(auxpow.subarray(offset, offset + 32).equals(branch[1])).toBe(true);
            offset += 32;
            expect(auxpow.readInt32LE(offset)).toBe(0);
            offset += 4;
            expect(auxpow[offset]).toBe(0);
            offset += 1;
            expect(auxpow.readInt32LE(offset)).toBe(0);
            offset += 4;
            expect(auxpow.subarray(offset, offset + 80).equals(header)).toBe(true);
            offset += 80;
            expect(auxpow.length).toBe(offset);

            // the coinbase inside the proof keeps its witness serialization (marker 00, flag 01)
            expect(coinbaseBytes.subarray(4, 6).toString('hex')).toBe('0001');
        });

        it('rejects a wrong header length', () => {
            expect(() => serializeAuxPow(Buffer.alloc(10), [], Buffer.alloc(79))).toThrow();
        });
    });
});
