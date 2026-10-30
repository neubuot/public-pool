import { Expose, Transform } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsNumber, IsOptional, IsString, MaxLength } from 'class-validator';

import { eRequestMethod } from '../enums/eRequestMethod';
import { IsBitcoinAddress } from '../validators/bitcoin-address.validator';
import { StratumBaseMessage } from './StratumBaseMessage';

export class AuthorizationMessage extends StratumBaseMessage {

    @IsArray()
    @ArrayMinSize(1)
    @ArrayMaxSize(2)
    params: string[];

    @Expose()
    @IsString()
    @Transform(({ value, key, obj, type }) => {
        return obj.params[0].split('.')[0];
    })
    @IsBitcoinAddress()
    public address: string;

    @Expose()
    @IsString()
    @MaxLength(64)
    @Transform(({ value, key, obj, type }) => {
        return obj.params[0].split('.')[1] == null ? 'worker' : obj.params[0].split('.')[1];
    })
    public worker: string;

    @Expose()
    @IsNumber()
    @Transform(({ value, key, obj, type }) => {
        const password: string | null = obj.params[1];
        const difficultyMatch = password?.match(/(?:^|,)d=(\d+)(?:,|$)/);
        if (difficultyMatch != null) {
            const startingDiff = Number.parseInt(difficultyMatch[1], 10);
            return Number.isFinite(startingDiff) ? startingDiff : null;
        }
        return null;
    })
    @IsOptional()
    public startingDiff?: number;

    @Expose()
    @IsString()
    @Transform(({ value, key, obj, type }) => {
        return obj.params[1];
    })
    @MaxLength(64)
    @IsOptional()
    public password?: string;

    /**
     * Merged mining: the Doichain payout address travels in the stratum password, either bare
     * ("dc1q...") or as "doi=dc1q...", optionally combined with "d=<difficulty>". Validated against
     * the Doichain node later, here only the candidate is extracted.
     */
    @Expose()
    @IsString()
    @MaxLength(90)
    @IsOptional()
    @Transform(({ value, key, obj, type }) => {
        const password: string | null = obj.params[1];
        if (password == null) {
            return null;
        }
        const explicitMatch = password.match(/(?:^|[,\s])doi=([A-Za-z0-9]+)(?:[,\s]|$)/);
        if (explicitMatch != null) {
            return explicitMatch[1];
        }
        const candidate = password
            .split(/[,\s]+/)
            .filter(part => part.length > 0 && !part.includes('='))
            .find(part => /^[A-Za-z0-9]{26,90}$/.test(part));
        return candidate ?? null;
    })
    public doiAddress?: string;

    constructor() {
        super();
        this.method = eRequestMethod.AUTHORIZE;

    }


    public response() {
        return {
            id: this.id,
            error: null,
            result: true
        };
    }
}
