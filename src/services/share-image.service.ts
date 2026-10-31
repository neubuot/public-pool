import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as satoriModule from 'satori';

import { AddressSettingsService } from '../ORM/address-settings/address-settings.service';
import { BlocksService } from '../ORM/blocks/blocks.service';
import { ClientService } from '../ORM/client/client.service';
import { TopSharesService } from '../ORM/top-shares/top-shares.service';
import { percentOfTarget } from '../utils/record-alerts';
import { ChainStatsService } from './chain-stats.service';

const satori: (element: unknown, options: unknown) => Promise<string> = (satoriModule as any).default ?? (satoriModule as any);

const WIDTH = 1200;
const HEIGHT = 630;
const COLORS = { bg: '#0B0F14', dot: '#18232E', text: '#E6EDF3', text2: '#C7D2DC', muted: '#9AAABB', muted2: '#6B7A8A', border: '#1E2A36', card: '#111821', doi: '#38BDF8', btc: '#F7931A', green: '#4ADE80' };
const MONO = 'IBM Plex Mono';

export interface ShareCardData {
    chain: 'BTC' | 'DOI';
    height: number;
    hash: string | null;
    worker: string;
    minerAddress: string;
    userAgent: string | null;
    time: Date | null;
    accepted: boolean;
    subsidy: number | null;
    bestShare: number | null;
    poolBlocks: number;
    domain: string;
}

/** the best share of an address, for the record card */
export interface BestShareCardData {
    address: string;
    worker: string;
    userAgent: string | null;
    difficulty: number;
    time: Date | null;
    doiTarget: number | null;
    btcTarget: number | null;
    domain: string;
}

interface CacheEntry { png: Buffer | null; expires: number; }

function el(type: string, style: Record<string, unknown>, children?: unknown): unknown {
    return { type, props: { style, children } };
}

function fmtDe(value: number, digits = 0): string {
    return new Intl.NumberFormat('de-DE', { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value);
}

export function fmtDifficultyDe(value: number | null): string {
    if (value == null || !Number.isFinite(value) || value <= 0) {
        return '–';
    }
    const units = ['', 'k', 'M', 'G', 'T', 'P', 'E'];
    let index = 0;
    let scaled = value;
    while (scaled >= 1000 && index < units.length - 1) {
        scaled /= 1000;
        index++;
    }
    const digits = scaled >= 100 ? 0 : scaled >= 10 ? 1 : 2;
    return `${fmtDe(scaled, digits)}${units[index] ? ' ' + units[index] : ''}`;
}

export function fmtPercentDe(percent: number | null): string {
    if (percent == null) {
        return '–';
    }
    if (percent >= 10) {
        return `${fmtDe(percent, 1)} %`;
    }
    if (percent >= 1) {
        return `${fmtDe(percent, 2)} %`;
    }
    return `${new Intl.NumberFormat('de-DE', { maximumSignificantDigits: 2 }).format(percent)} %`;
}

function fmtDate(time: Date | null): string {
    if (time == null) {
        return '';
    }
    return new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin' }).format(time);
}

function shortAddress(address: string): string {
    return address.length > 18 ? `${address.slice(0, 8)}…${address.slice(-6)}` : address;
}

function label(text: string, color = COLORS.muted): unknown {
    return el('div', { display: 'flex', fontSize: 13, letterSpacing: 2, textTransform: 'uppercase', color, fontWeight: 600 }, text);
}

function stat(title: string, value: string): unknown {
    return el('div', {
        display: 'flex', flexDirection: 'column', border: `1px solid ${COLORS.border}`, borderRadius: 10, padding: '12px 16px', backgroundColor: COLORS.card
    }, [label(title), el('div', { display: 'flex', fontFamily: MONO, fontSize: 22, fontWeight: 600, marginTop: 2 }, value)]);
}

/** a progress bar: how far a share got towards a block */
function bar(color: string, percent: number | null): unknown {
    const width = percent == null ? 0 : Math.max(percent > 0 ? 6 : 0, Math.round(520 * Math.min(1, percent / 100)));
    return el('div', { display: 'flex', width: 520, height: 10, borderRadius: 5, backgroundColor: COLORS.border, marginTop: 8 },
        el('div', { display: 'flex', width, height: 10, borderRadius: 5, backgroundColor: color }));
}

/**
 * Renders share cards as 1200 × 630 PNGs (the same cards the dashboard shows under /share/...): satori lays
 * the card out and turns text into paths, resvg rasterises it, so the server needs no installed fonts.
 * Block cards are cached for ten minutes, best share cards per difficulty.
 */
@Injectable()
export class ShareImageService {

    private readonly cache = new Map<string, CacheEntry>();
    private fonts: Promise<unknown[]> | null = null;

    constructor(
        private readonly blocksService: BlocksService,
        private readonly addressSettingsService: AddressSettingsService,
        private readonly topSharesService: TopSharesService,
        private readonly chainStatsService: ChainStatsService,
        private readonly clientService: ClientService,
        private readonly configService: ConfigService,
    ) { }

    public publicUrl(hostname?: string): string {
        const configured: string | null = this.configService.get('POOL_PUBLIC_URL');
        if (configured != null && configured.length > 0) {
            return configured.replace(/\/+$/, '');
        }
        return `https://${hostname ?? 'pool.doilabs.org'}`;
    }

    public async data(chain: 'BTC' | 'DOI', height: number, hostname?: string): Promise<ShareCardData | null> {
        const block = await this.blocksService.findBlock(chain, height);
        if (block == null) {
            return null;
        }
        const snapshot = this.chainStatsService.current();
        const subsidy = chain === 'DOI' ? snapshot?.doichain?.blockSubsidy ?? null : snapshot?.bitcoin?.blockSubsidy ?? null;
        const [best, settings, clients, poolBlocks] = await Promise.all([
            this.topSharesService.bestForAddress(block.minerAddress),
            this.addressSettingsService.getSettings(block.minerAddress, false),
            this.clientService.getByName(block.minerAddress, block.worker),
            this.blocksService.countAccepted(chain),
        ]);
        const result = block.result ?? null;
        return {
            chain,
            height: block.height,
            hash: block.blockHash ?? null,
            worker: block.worker,
            minerAddress: block.minerAddress,
            userAgent: clients.find(c => c.userAgent != null)?.userAgent ?? null,
            time: block.createdAt instanceof Date ? block.createdAt : (block.createdAt != null ? new Date(block.createdAt as any) : null),
            accepted: result == null || /^(success!|accepted|null)$/i.test(result),
            subsidy,
            bestShare: best?.difficulty ?? settings?.bestDifficulty ?? null,
            poolBlocks,
            domain: this.publicUrl(hostname).replace(/^https?:\/\//, ''),
        };
    }

    public async render(chain: 'BTC' | 'DOI', height: number, hostname?: string): Promise<Buffer | null> {
        const key = `${chain}:${height}`;
        const cached = this.cache.get(key);
        if (cached != null && cached.expires > Date.now()) {
            return cached.png;
        }
        const data = await this.data(chain, height, hostname);
        const png = data == null ? null : await this.draw(this.card(data));
        this.cache.set(key, { png, expires: Date.now() + (png == null ? 60_000 : 10 * 60_000) });
        return png;
    }

    /** The best share of an address, null while it has none. */
    public async bestData(address: string, hostname?: string): Promise<BestShareCardData | null> {
        const [best, settings] = await Promise.all([
            this.topSharesService.bestForAddress(address),
            this.addressSettingsService.getSettings(address, false),
        ]);
        const difficulty = Math.max(best?.difficulty ?? 0, settings?.bestDifficulty ?? 0);
        if (!(difficulty > 0)) {
            return null;
        }
        const snapshot = this.chainStatsService.current();
        return {
            address,
            worker: best?.worker ?? '',
            userAgent: best?.userAgent ?? settings?.bestDifficultyUserAgent ?? null,
            difficulty,
            time: best?.time != null ? new Date(best.time) : null,
            doiTarget: snapshot?.doichain?.difficulty ?? null,
            btcTarget: snapshot?.bitcoin?.difficulty ?? null,
            domain: this.publicUrl(hostname).replace(/^https?:\/\//, ''),
        };
    }

    public async renderBest(address: string, hostname?: string): Promise<Buffer | null> {
        const data = await this.bestData(address, hostname);
        if (data == null) {
            return null;
        }
        const key = `best:${address}:${Math.round(data.difficulty)}`;
        const cached = this.cache.get(key);
        if (cached != null && cached.expires > Date.now()) {
            return cached.png;
        }
        const png = await this.draw(this.cardBest(data));
        this.cache.set(key, { png, expires: Date.now() + 10 * 60_000 });
        return png;
    }

    public async draw(card: unknown): Promise<Buffer> {
        const svg = await satori(card, { width: WIDTH, height: HEIGHT, fonts: await this.loadFonts() });
        // the native rasteriser is loaded late: a missing platform binary must not take the whole pool down
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { Resvg } = require('@resvg/resvg-js');
        const resvg = new Resvg(svg, { fitTo: { mode: 'width', value: WIDTH }, background: COLORS.bg });
        return resvg.render().asPng();
    }

    /** The card of a found block. */
    private card(d: ShareCardData): unknown {
        const accent = d.chain === 'DOI' ? COLORS.doi : COLORS.btc;
        const chainName = d.chain === 'DOI' ? 'Doichain' : 'Bitcoin';
        const reward = d.subsidy != null ? `+${fmtDe(d.subsidy, d.chain === 'BTC' ? 3 : 1)} ${d.chain}` : `+${d.chain}`;
        return this.frame(accent, d.domain,
            el('div', { display: 'flex', flexDirection: 'column' }, [
                label(`Block gefunden · ${chainName}${d.accepted ? '' : ' · abgelehnt'}`, accent),
                el('div', { display: 'flex', fontFamily: MONO, fontSize: 88, fontWeight: 600, lineHeight: 1, marginTop: 10, letterSpacing: -2 }, reward),
                el('div', { display: 'flex', fontFamily: MONO, fontSize: 30, color: COLORS.text2, marginTop: 14 }, `Block ${fmtDe(d.height)}${d.time ? ` · ${fmtDate(d.time)}` : ''}`),
            ]),
            this.foundWith(d.worker, d.minerAddress, d.userAgent, [
                stat('Best Share', fmtDifficultyDe(d.bestShare)),
                stat(`Pool-Blöcke ${d.chain}`, fmtDe(d.poolBlocks)),
            ]));
    }

    /** The card of an address's best share: how close the luckiest hash came to a block. */
    private cardBest(d: BestShareCardData): unknown {
        const doiPercent = percentOfTarget(d.difficulty, d.doiTarget);
        const btcPercent = percentOfTarget(d.difficulty, d.btcTarget);
        const row = (title: string, color: string, percent: number | null) => el('div', { display: 'flex', flexDirection: 'column', marginTop: 16 }, [
            el('div', { display: 'flex', fontSize: 17, color: COLORS.text2 }, `${title}: ${fmtPercentDe(percent)}`),
            bar(color, percent),
        ]);
        return this.frame(COLORS.doi, d.domain,
            el('div', { display: 'flex', flexDirection: 'column' }, [
                label('Best Share · persönlicher Rekord', COLORS.doi),
                el('div', { display: 'flex', alignItems: 'baseline', marginTop: 10 }, [
                    el('div', { display: 'flex', fontFamily: MONO, fontSize: 88, fontWeight: 600, lineHeight: 1, letterSpacing: -2 }, fmtDifficultyDe(d.difficulty)),
                    el('div', { display: 'flex', fontFamily: MONO, fontSize: 26, color: COLORS.muted, marginLeft: 22 }, d.time ? fmtDate(d.time) : ''),
                ]),
                row('Doichain-Block', COLORS.doi, doiPercent),
                row('Bitcoin-Block', COLORS.btc, btcPercent),
            ]),
            this.foundWith(d.worker, d.address, d.userAgent, [
                stat('Doichain-Ziel', fmtDifficultyDe(d.doiTarget)),
                stat('Bitcoin-Ziel', fmtDifficultyDe(d.btcTarget)),
            ]));
    }

    private foundWith(worker: string, address: string, userAgent: string | null, stats: unknown[]): unknown {
        return el('div', { display: 'flex', alignItems: 'flex-end' }, [
            el('div', { display: 'flex', flexDirection: 'column' }, [
                label('Gefunden mit'),
                el('div', { display: 'flex', fontSize: 24, fontWeight: 600, marginTop: 6 }, worker.length > 0 ? `Worker ${worker}` : 'Worker ohne Namen'),
                el('div', { display: 'flex', fontFamily: MONO, fontSize: 17, color: COLORS.muted, marginTop: 2 }, `${shortAddress(address)}${userAgent ? ` · ${userAgent}` : ''}`),
            ]),
            el('div', { display: 'flex', marginLeft: 'auto', gap: 12 }, stats),
        ]);
    }

    /** Background, dots, header with logo and domain; the middle and the bottom part are the card's own. */
    private frame(accent: string, domain: string, middle: unknown, bottom: unknown): unknown {
        const dots = [
            [accent, 880, 92, 5], [accent, 1040, 150, 4], [accent, 960, 260, 6], [accent, 1110, 330, 4], [accent, 820, 400, 5], [accent, 1000, 480, 4],
            [COLORS.btc, 940, 60, 4], [COLORS.btc, 1090, 220, 5], [COLORS.btc, 870, 310, 4], [COLORS.btc, 1130, 440, 6], [COLORS.btc, 740, 470, 4],
            [COLORS.green, 1010, 110, 3], [COLORS.green, 850, 200, 4], [COLORS.green, 1060, 380, 3], [COLORS.green, 980, 590, 5],
        ] as [string, number, number, number][];
        const logo = {
            type: 'svg',
            props: {
                width: 22, height: 22, viewBox: '0 0 24 24',
                children: { type: 'path', props: { d: 'M3 12h4l3-8 4 16 3-8h4', fill: 'none', stroke: accent, strokeWidth: 2.2, strokeLinecap: 'round', strokeLinejoin: 'round' } }
            }
        };
        // a dotted ground like the dashboard: a 24 px grid of faint dots behind everything
        const grid: unknown[] = [];
        for (let y = 12; y < HEIGHT; y += 24) {
            for (let x = 12; x < WIDTH; x += 24) {
                grid.push(el('div', { position: 'absolute', left: x, top: y, width: 2, height: 2, borderRadius: 1, backgroundColor: COLORS.dot, display: 'flex' }));
            }
        }

        // satori sizes width/height as content box: the padded layer gets no height of its own and fills the card
        return el('div', {
            width: WIDTH, height: HEIGHT, display: 'flex', flexDirection: 'column', position: 'relative',
            backgroundColor: COLORS.bg, color: COLORS.text, fontFamily: 'Inter'
        }, [
            ...grid,
            ...dots.map(([color, x, y, r]) => el('div', { position: 'absolute', left: x - r, top: y - r, width: r * 2, height: r * 2, borderRadius: r, backgroundColor: color, display: 'flex' })),
            el('div', { display: 'flex', flexDirection: 'column', justifyContent: 'space-between', flexGrow: 1, padding: '56px 64px' }, [
                el('div', { display: 'flex', alignItems: 'center' }, [
                    el('div', { display: 'flex', width: 40, height: 40, border: `2px solid ${accent}`, borderRadius: 10, alignItems: 'center', justifyContent: 'center' }, logo),
                    el('div', { display: 'flex', fontWeight: 700, letterSpacing: 3, fontSize: 20, marginLeft: 14 }, 'NERDPOOL'),
                    el('div', { display: 'flex', fontFamily: MONO, color: COLORS.muted2, fontSize: 16, marginLeft: 14 }, domain),
                ]),
                middle,
                bottom,
            ]),
        ]);
    }

    private loadFonts(): Promise<unknown[]> {
        if (this.fonts == null) {
            this.fonts = (async () => {
                const inter = path.dirname(require.resolve('@fontsource/inter/package.json'));
                const plex = path.dirname(require.resolve('@fontsource/ibm-plex-mono/package.json'));
                const read = (dir: string, file: string) => fs.promises.readFile(path.join(dir, 'files', file));
                return [
                    { name: 'Inter', data: await read(inter, 'inter-latin-400-normal.woff'), weight: 400, style: 'normal' },
                    { name: 'Inter', data: await read(inter, 'inter-latin-600-normal.woff'), weight: 600, style: 'normal' },
                    { name: 'Inter', data: await read(inter, 'inter-latin-700-normal.woff'), weight: 700, style: 'normal' },
                    { name: 'IBM Plex Mono', data: await read(plex, 'ibm-plex-mono-latin-500-normal.woff'), weight: 500, style: 'normal' },
                    { name: 'IBM Plex Mono', data: await read(plex, 'ibm-plex-mono-latin-600-normal.woff'), weight: 600, style: 'normal' },
                ];
            })();
        }
        return this.fonts;
    }
}
