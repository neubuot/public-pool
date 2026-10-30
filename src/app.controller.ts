import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Controller, Get, Inject, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cache } from 'cache-manager';
import { FastifyReply } from 'fastify';
import { firstValueFrom } from 'rxjs';

import { AddressSettingsService } from './ORM/address-settings/address-settings.service';
import { BlocksService } from './ORM/blocks/blocks.service';
import { ClientStatisticsService } from './ORM/client-statistics/client-statistics.service';
import { ClientService } from './ORM/client/client.service';
import { BitcoinRpcService } from './services/bitcoin-rpc.service';
import { DoichainRpcService } from './services/doichain-rpc.service';

const DEFAULT_BITCOIN_PUBLIC_HEIGHT_URL = 'https://mempool.space/api/blocks/tip/height';
const DEFAULT_DOICHAIN_PUBLIC_HEALTH_URL = 'https://doi-api.sendlabs.de/health';
/** how far behind the public tip a node may be before the health check complains */
const MAX_BLOCKS_BEHIND = 2;

interface PublicHeightCacheEntry {
  value: number | null;
  fetchedAt: number;
}

@Controller()
export class AppController {

  private uptime = new Date();
  private publicHeights = new Map<string, PublicHeightCacheEntry>();

  constructor(
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
    private readonly clientService: ClientService,
    private readonly clientStatisticsService: ClientStatisticsService,
    private readonly blocksService: BlocksService,
    private readonly bitcoinRpcService: BitcoinRpcService,
    private readonly addressSettingsService: AddressSettingsService,
    private readonly doichainRpcService: DoichainRpcService,
    private readonly configService: ConfigService,
  ) { }

  /**
   * Health for monitoring (Uptime Kuma keyword "ok":true, status.sh). ok only when both nodes answer,
   * Bitcoin Core is synced and neither chain trails the public tip by more than MAX_BLOCKS_BEHIND.
   */
  @Get('health')
  public async health(@Res({ passthrough: true }) reply: FastifyReply) {
    const CACHE_KEY = 'HEALTH';
    let data: any = await this.cacheManager.get(CACHE_KEY);

    if (data == null) {
      const problems: string[] = [];

      const miningInfo = await this.bitcoinRpcService.getMiningInfo();
      const bitcoin = {
        reachable: miningInfo != null,
        syncing: this.bitcoinRpcService.syncing ?? null,
        blocks: miningInfo?.blocks ?? null,
        publicHeight: null as number | null,
        behind: null as number | null
      };
      if (miningInfo == null) {
        problems.push('bitcoin rpc unreachable');
      } else if (this.bitcoinRpcService.syncing) {
        problems.push(`bitcoin syncing: ${miningInfo.blocks}`);
      }
      const bitcoinPublic = await this.publicHeight(
        this.configService.get('BITCOIN_PUBLIC_HEIGHT_URL') ?? DEFAULT_BITCOIN_PUBLIC_HEIGHT_URL,
        text => parseInt(text, 10)
      );
      if (bitcoinPublic != null && miningInfo != null) {
        bitcoin.publicHeight = bitcoinPublic;
        bitcoin.behind = bitcoinPublic - miningInfo.blocks;
        if (bitcoin.behind > MAX_BLOCKS_BEHIND) {
          problems.push(`bitcoin behind public tip by ${bitcoin.behind}`);
        }
      }

      const doichain = {
        enabled: this.doichainRpcService.enabled,
        reachable: null as boolean | null,
        blocks: null as number | null,
        publicHeight: null as number | null,
        behind: null as number | null
      };
      if (doichain.enabled) {
        try {
          doichain.blocks = await this.doichainRpcService.getBlockCount();
          doichain.reachable = true;
        } catch (e) {
          doichain.reachable = false;
          problems.push('doichain rpc unreachable');
        }
        const doichainPublic = await this.publicHeight(
          this.configService.get('DOICHAIN_PUBLIC_HEALTH_URL') ?? DEFAULT_DOICHAIN_PUBLIC_HEALTH_URL,
          text => JSON.parse(text).blocks
        );
        if (doichainPublic != null && doichain.blocks != null) {
          doichain.publicHeight = doichainPublic;
          doichain.behind = doichainPublic - doichain.blocks;
          if (doichain.behind > MAX_BLOCKS_BEHIND) {
            problems.push(`doichain behind public tip by ${doichain.behind}`);
          }
        }
      }

      const userAgents = await this.clientService.getUserAgents();
      const pool = {
        miners: userAgents.reduce((acc, userAgent) => acc + parseInt(userAgent.count), 0),
        hashRate: userAgents.reduce((acc, userAgent) => acc + parseFloat(userAgent.totalHashRate), 0),
        since: this.uptime
      };

      data = {
        ok: problems.length === 0,
        time: new Date().toISOString(),
        bitcoin,
        doichain,
        pool,
        problems
      };
      // 15 s: monitors poll every minute, several of them must not hammer the nodes
      await this.cacheManager.set(CACHE_KEY, data, 15 * 1000);
    }

    if (!data.ok) {
      reply.status(503);
    }
    return data;
  }

  /** Public chain height from an external source, cached for 5 minutes; null when unavailable. */
  private async publicHeight(url: string, parse: (text: string) => number): Promise<number | null> {
    if (url == null || url.length === 0 || url === 'off') {
      return null;
    }
    const cached = this.publicHeights.get(url);
    if (cached != null && Date.now() - cached.fetchedAt < 5 * 60 * 1000) {
      return cached.value;
    }
    let value: number | null = null;
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (response.ok) {
        const parsed = parse(await response.text());
        value = Number.isFinite(parsed) ? parsed : null;
      }
    } catch (e) {
      value = null;
    }
    this.publicHeights.set(url, { value, fetchedAt: Date.now() });
    return value;
  }

  @Get('info')
  public async info() {


    const CACHE_KEY = 'SITE_INFO';
    const cachedResult = await this.cacheManager.get(CACHE_KEY);

    if (cachedResult != null) {
      return cachedResult;
    }


    const blockData = await this.blocksService.getFoundBlocks();
    const userAgents = await this.clientService.getUserAgents();
    const highScores = await this.addressSettingsService.getHighScores();

    const data = {
      blockData,
      userAgents,
      highScores,
      uptime: this.uptime
    };

    //1 min
    await this.cacheManager.set(CACHE_KEY, data, 1 * 60 * 1000);

    return data;

  }

  @Get('pool')
  public async pool() {

    const CACHE_KEY = 'POOL_INFO';
    const cachedResult = await this.cacheManager.get(CACHE_KEY);

    if (cachedResult != null) {
      return cachedResult;
    }


    const userAgents = await this.clientService.getUserAgents();
    const totalHashRate = userAgents.reduce((acc, userAgent) => acc + parseFloat(userAgent.totalHashRate), 0);
    const totalMiners = userAgents.reduce((acc, userAgent) => acc + parseInt(userAgent.count), 0);
    // must not block while the node is still syncing (newBlock$ emits only once synced)
    const blockHeight = this.bitcoinRpcService.miningInfo?.blocks ?? 0;
    const blocksFound = await this.blocksService.getFoundBlocks();

    const data = {
      totalHashRate,
      blockHeight,
      totalMiners,
      blocksFound,
      fee: 0
    }

    //5 min
    await this.cacheManager.set(CACHE_KEY, data, 5 * 60 * 1000);

    return data;
  }

  @Get('network')
  public async network() {
    // latest known mining info; while syncing this is the node's current (partial) height
    return this.bitcoinRpcService.miningInfo ?? await this.bitcoinRpcService.getMiningInfo();
  }

  @Get('info/chart')
  public async infoChart() {


    const CACHE_KEY = 'SITE_HASHRATE_GRAPH';
    const cachedResult = await this.cacheManager.get(CACHE_KEY);

    if (cachedResult != null) {
      return cachedResult;
    }

    const chartData = await this.clientStatisticsService.getChartDataForSite();

    //10 min
    await this.cacheManager.set(CACHE_KEY, chartData, 10 * 60 * 1000);

    return chartData;


  }

}
