<script lang="ts">
  // Kettenkarte: Instrumente und Kennzahlen einer Kette (Bitcoin oder Doichain).
  import type { ChainStats } from '../lib/api';
  import { fmtAgo, fmtBytes, fmtCoins, fmtDate, fmtDifficulty, fmtDuration, fmtHashrate, fmtInt, fmtPercent, fmtSignedPercent, shortHash } from '../lib/format';
  import { t } from '../lib/i18n.svelte';
  import { clock } from '../lib/stats.svelte';
  import Gauge from './Gauge.svelte';

  interface Props {
    chain: ChainStats | null;
    poolHashRate: number;
  }
  let { chain, poolHashRate }: Props = $props();

  const isBtc = $derived(chain?.chain === 'BTC');
  const color = $derived(isBtc ? 'var(--btc)' : 'var(--doi)');
  const name = $derived(isBtc ? 'Bitcoin' : 'Doichain');
  const unit = $derived(isBtc ? 'BTC' : 'DOI');
  const poolShare = $derived(chain?.networkHashPs != null && chain.networkHashPs > 0 && !chain.syncing ? poolHashRate / chain.networkHashPs : null);
  const blockAgoSeconds = $derived(chain?.lastBlockTime != null ? (clock.now / 1000 - chain.lastBlockTime) : null);
  const intervalFraction = $derived(chain?.avgBlockIntervalSec != null && blockAgoSeconds != null ? Math.min(1, blockAgoSeconds / chain.avgBlockIntervalSec) : null);
  const adjustment = $derived(chain?.difficultyAdjustment ?? null);
</script>

<div style="display: flex; align-items: center; gap: 10px; flex-wrap: wrap">
  <span class="label" style="color: {color}; font-size: 12px">{name}</span>
  {#if chain?.network && chain.network !== 'main'}<span class="chip" style="height: 24px; font-size: 11px">{chain.network}</span>{/if}
  {#if chain?.pruned}<span class="chip" style="height: 24px; font-size: 11px">{t('chain.pruned')}</span>{/if}
  <span style="margin-left: auto" class="muted-2 mono">{chain?.lastBlockHash ? shortHash(chain.lastBlockHash, 8, 8) : ''}</span>
</div>

{#if chain == null}
  <p class="muted" style="margin-top: 12px">{t('common.loading')}</p>
{:else if !chain.reachable}
  <p class="red" style="margin-top: 12px">{t('chain.unreachable')}</p>
  {#if chain.error}<p class="muted-2" style="font-size: 12px; margin-top: 4px; overflow-wrap: anywhere">{chain.error}</p>{/if}
{:else}
  <div class="gauges">
    {#if chain.syncing}
      <div class="gauge-box">
        <Gauge value={chain.verificationProgress} label={fmtPercent(chain.verificationProgress, 0)} sub={t('chain.syncing')} color={color} size={104} fontSize={18} pulse={true} />
        <div class="muted" style="font-size: 12px; max-width: 220px">{t('chain.syncingHint', { blocks: fmtInt(chain.blocks), headers: fmtInt(chain.headers) })}</div>
      </div>
    {:else}
      <div class="gauge-box">
        <Gauge value={intervalFraction} label={blockAgoSeconds != null ? fmtDuration(blockAgoSeconds) : '–'} sub={t('chain.lastBlock')} color={color} size={104} fontSize={15} />
        <div class="muted" style="font-size: 12px">{chain.avgBlockIntervalSec != null ? t('pool.blockEvery', { duration: fmtDuration(chain.avgBlockIntervalSec) }) : ''}</div>
      </div>
      {#if isBtc && adjustment != null}
        <div class="gauge-box">
          <Gauge value={adjustment.progress} label={fmtPercent(adjustment.progress, 0)} sub={t('chain.adjustmentProgress')} color={color} size={104} fontSize={16} />
          <div class="muted" style="font-size: 12px; max-width: 220px">
            {t('pool.adjustment', { blocks: fmtInt(adjustment.blocksRemaining), when: adjustment.estimatedAt != null ? fmtDate(adjustment.estimatedAt) : '–' })}
            {#if adjustment.estimatedChange != null}<br>{t('pool.adjustmentChange', { change: fmtSignedPercent(adjustment.estimatedChange, 1) })}{/if}
          </div>
        </div>
      {:else}
        <div class="gauge-box">
          <Gauge value={poolShare} label={poolShare != null ? (poolShare * 100 < 0.01 ? '<0,01 %' : fmtPercent(poolShare, 2)) : '–'} sub={t('chain.poolShare')} color={color} size={104} fontSize={poolShare != null && poolShare * 100 >= 10 ? 16 : 14} />
          <div class="muted" style="font-size: 12px">{fmtHashrate(poolHashRate)} / {fmtHashrate(chain.networkHashPs)}</div>
        </div>
      {/if}
    {/if}
  </div>

  <div class="tiles">
    <div><div class="label">{t('chain.height')}</div><div class="mono val">{fmtInt(chain.blocks)}</div></div>
    <div><div class="label">{t('chain.difficulty')}</div><div class="mono val">{fmtDifficulty(chain.difficulty)}</div></div>
    <div><div class="label">{t('chain.networkHashrate')}</div><div class="mono val">{chain.syncing ? '–' : fmtHashrate(chain.networkHashPs)}</div></div>
    <div><div class="label">{t('chain.mempool')}</div><div class="mono val">{chain.mempoolTx != null ? `${fmtInt(chain.mempoolTx)} tx` : '–'}</div><div class="muted-2" style="font-size: 11.5px">{fmtBytes(chain.mempoolBytes)}</div></div>
    <div><div class="label">{t('chain.subsidy')}</div><div class="mono val">{fmtCoins(chain.blockSubsidy, unit, isBtc ? 3 : 2)}</div></div>
    <div><div class="label">{t('chain.lastBlock')}</div><div class="mono val" style="font-size: 15px">{chain.lastBlockTime != null ? fmtDate(chain.lastBlockTime) : '–'}</div><div class="muted-2" style="font-size: 11.5px">{chain.lastBlockTime != null ? t('chain.ago', { ago: fmtAgo(chain.lastBlockTime, clock.now) }) : ''}</div></div>
  </div>
{/if}

<style>
  .gauges { display: flex; gap: 20px; margin-top: 14px; flex-wrap: wrap; }
  .gauge-box { display: flex; align-items: center; gap: 14px; flex: 1 1 240px; min-width: 0; }
  .tiles { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px 16px; margin-top: 16px; }
  .val { font-size: 18px; font-weight: 600; margin-top: 3px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  @media (max-width: 600px) { .tiles { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
</style>
