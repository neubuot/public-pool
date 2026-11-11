import { Expose, Transform } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsNumber, IsOptional, IsString, MaxLength } from 'class-validator';

import { eRequestMethod } from '../enums/eRequestMethod';
import { IsBitcoinAddress } from '../validators/bitcoin-address.validator';
import { StratumBaseMessage } from './StratumBaseMessage';

/** "syndicate", "syndikat", "syn" or "syndicate=1" / "s=1" (also true, on, yes) switch syndicate mode on */
const SYNDICATE_TOKEN = /^(?:syndicate|syndikat|syn|(?:syndicate|syndikat|syn|s)=(?:1|true|on|yes))$/i;
const TOKEN_SEPARATOR = /[,;\s]+/;

function isSyndicateToken(part: string): boolean {
    return SYNDICATE_TOKEN.test(part);
}

/** Whether a password ("dc1q...,syndicate,d=512") asks for syndicate mode. */
export function passwordAsksForSyndicate(password: string | null | undefined): boolean {
    return password != null && password.split(TOKEN_SEPARATOR).some(isSyndicateToken);
}

/**
 * Splits the stratum user name "<btc address>.<worker>" into address and worker. Rental platforms and some
 * firmwares only let the miner edit the user name, so the syndicate word may sit there too
 * ("bc1q....bitaxe1,syndicate"): it is taken out and reported, the worker name stays clean.
 */
export function parseStratumUser(raw: unknown): { address: string, worker: string, syndicate: boolean } {
    const text = typeof raw === 'string' ? raw : '';
    const parts = text.split(TOKEN_SEPARATOR).filter(part => part.length > 0);
    const kept = parts.filter(part => !isSyndicateToken(part));
    const syndicate = kept.length < parts.length;
    // without the syndicate word the user name stays exactly as the miner sent it (stats are keyed by it)
    const user = syndicate ? kept.join(',') : text;
    const dot = user.indexOf('.');
    const address = dot < 0 ? user : user.slice(0, dot);
    const rest = dot < 0 ? '' : user.slice(dot + 1);
    // as before: only the first segment after the address is the worker name
    const worker = rest.split('.')[0];
    return { address, worker: dot < 0 ? 'worker' : worker, syndicate };
}

export class AuthorizationMessage extends StratumBaseMessage {

    @IsArray()
    @ArrayMinSize(1)
    @ArrayMaxSize(2)
    params: string[];

    @Expose()
    @IsString()
    @Transform(({ value, key, obj, type }) => {
        return parseStratumUser(obj.params?.[0]).address;
    })
    @IsBitcoinAddress()
    public address: string;

    @Expose()
    @IsString()
    @MaxLength(64)
    @Transform(({ value, key, obj, type }) => {
        return parseStratumUser(obj.params?.[0]).worker;
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

    /**
     * Syndicate mode: "dc1q...,syndicate" (also "syndikat", "syn" or "s=1") asks to share Doichain block
     * rewards with the other members in proportion to the shares. Accepted in the password and, for miners
     * that only let you edit the user name, after the user name ("bc1q....bitaxe1,syndicate").
     * Only meaningful with a Doichain address.
     */
    @Expose()
    @IsOptional()
    @Transform(({ value, key, obj, type }) => {
        return passwordAsksForSyndicate(obj.params?.[1]) || parseStratumUser(obj.params?.[0]).syndicate;
    })
    public syndicate?: boolean;

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
