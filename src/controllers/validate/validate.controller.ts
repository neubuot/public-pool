import { Controller, Get, Param } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getAddressInfo, Network, validate } from 'bitcoin-address-validation';

import { DoichainRpcService } from '../../services/doichain-rpc.service';

const ADDRESS_RE = /^[A-Za-z0-9]{10,90}$/;

/** Address checks for the onboarding form: Bitcoin locally, Doichain by the node. */
@Controller('validate')
export class ValidateController {

    constructor(
        private readonly doichainRpcService: DoichainRpcService,
        private readonly configService: ConfigService,
    ) { }

    @Get('btc/:address')
    public btc(@Param('address') address: string) {
        const configured = `${this.configService.get('NETWORK') ?? 'mainnet'}`.toLowerCase();
        const network = configured === 'testnet' ? Network.testnet : configured === 'regtest' ? Network.regtest : Network.mainnet;
        if (!ADDRESS_RE.test(address) || !validate(address, network)) {
            return { chain: 'BTC', address, valid: false, network: configured, type: null, bech32: null };
        }
        const info = getAddressInfo(address);
        return { chain: 'BTC', address, valid: true, network: info.network, type: info.type, bech32: info.bech32 };
    }

    @Get('doi/:address')
    public async doi(@Param('address') address: string) {
        if (!this.doichainRpcService.enabled) {
            return { chain: 'DOI', address, valid: false, enabled: false, type: null, bech32: null };
        }
        if (!ADDRESS_RE.test(address)) {
            return { chain: 'DOI', address, valid: false, enabled: true, type: null, bech32: null };
        }
        try {
            const info = await this.doichainRpcService.rpc<any>('validateaddress', [address]);
            return {
                chain: 'DOI',
                address,
                valid: info?.isvalid === true,
                enabled: true,
                type: info?.isvalid ? (info.iswitness ? (info.witness_version === 1 ? 'p2tr' : (info.isscript ? 'p2wsh' : 'p2wpkh')) : (info.isscript ? 'p2sh' : 'p2pkh')) : null,
                bech32: info?.iswitness === true
            };
        } catch (e) {
            return { chain: 'DOI', address, valid: false, enabled: true, type: null, bech32: null, error: e?.message ?? String(e) };
        }
    }
}
