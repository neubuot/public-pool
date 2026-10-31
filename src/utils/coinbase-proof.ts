import * as bitcoinjs from 'bitcoinjs-lib';

/**
 * The coinbase proof: what the pool puts into a miner's block template, decoded so the miner can check that a
 * found block pays their own address. Pure helpers, the controller feeds them the real template.
 */

export interface CoinbaseOutput {
    index: number;
    /** satoshi */
    value: number;
    address: string | null;
    kind: 'payout' | 'fee' | 'witness-commitment' | 'other';
    /** pays the miner's own address */
    yours: boolean;
}

const WITNESS_COMMITMENT_PREFIX = '6a24aa21a9ed';
/** merged mining tag in the coinbase scriptSig ("\xfa\xbemm") */
const AUX_TAG = 'fabe6d6d';

export function networkFor(name: string | null | undefined): bitcoinjs.Network {
    switch ((name ?? 'mainnet').toLowerCase()) {
        case 'testnet': return bitcoinjs.networks.testnet;
        case 'regtest': return bitcoinjs.networks.regtest;
        default: return bitcoinjs.networks.bitcoin;
    }
}

export function describeCoinbaseOutputs(tx: bitcoinjs.Transaction, network: bitcoinjs.Network, minerAddress: string, feeAddress: string | null): CoinbaseOutput[] {
    return tx.outs.map((out, index) => {
        let address: string | null = null;
        try {
            address = bitcoinjs.address.fromOutputScript(out.script, network);
        } catch {
            address = null;
        }
        const script = out.script.toString('hex');
        let kind: CoinbaseOutput['kind'] = 'other';
        if (address == null) {
            kind = script.startsWith(WITNESS_COMMITMENT_PREFIX) ? 'witness-commitment' : 'other';
        } else if (address === minerAddress) {
            kind = 'payout';
        } else if (feeAddress != null && address === feeAddress) {
            kind = 'fee';
        }
        return { index, value: Number(out.value), address, kind, yours: address === minerAddress };
    });
}

/** whether the coinbase scriptSig carries the merged mining tag (the Doichain block hash commitment) */
export function hasAuxTag(tx: bitcoinjs.Transaction): boolean {
    return tx.ins.length > 0 && tx.ins[0].script.toString('hex').includes(AUX_TAG);
}

/** Mirrors StratumV1Client: the dev fee (1.5 %) applies only with DEV_FEE_ADDRESS set and at least 50 TH/s. */
export function payoutsFor(minerAddress: string, feeAddress: string | null, hashRate: number): { address: string; percent: number }[] {
    const feeApplies = feeAddress != null && feeAddress.length > 0 && hashRate >= 50_000_000_000_000;
    return feeApplies
        ? [{ address: feeAddress, percent: 1.5 }, { address: minerAddress, percent: 98.5 }]
        : [{ address: minerAddress, percent: 100 }];
}
