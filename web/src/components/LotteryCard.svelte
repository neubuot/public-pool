<script lang="ts">
  // Lotterie-Cockpit: Chancen auf einen Block je Kette aus Hashrate und Difficulty.
  import type { ChainOdds, StatsSnapshot } from '../lib/api';
  import { fmtCoins, fmtDifficulty, fmtDuration, fmtPercent } from '../lib/format';
  import { t } from '../lib/i18n.svelte';
  import Gauge from './Gauge.svelte';

  interface Props {
    odds: { bitcoin: ChainOdds, doichain: ChainOdds } | null;
    snapshot: StatsSnapshot | null;
    title: string;
    hint: string;
  }
  let { odds, snapshot, title, hint }: Props = $props();

  function yearLabel(o: ChainOdds | undefined): string {
    if (o?.perYear == null) {
      return '–';
    }
    const p = o.perYear * 100;
    if (p >= 99.95) {
      return '>99 %';
    }
    if (p >= 1) {
      return `${Math.round(p)} %`;
    }
    return fmtPercent(o.perYear, 2);
  }
</script>

<div class="label">{title}</div>
<div class="card-inner" style="display: flex; gap: 16px; align-items: center">
  <Gauge value={odds?.doichain?.perYear ?? null} label={yearLabel(odds?.doichain)} sub={t('pool.perYear')} color="var(--doi)" ariaLabel={`Doichain ${t('home.doiChance')}: ${yearLabel(odds?.doichain)}`} />
  <div style="min-width: 0">
    <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap"><span class="label doi">Doichain</span><span class="muted-2" style="font-size: 12px">{t('pool.target', { difficulty: fmtDifficulty(snapshot?.doichain?.difficulty) })}</span></div>
    <div class="mono" style="font-size: 22px; font-weight: 600; margin-top: 4px">{odds?.doichain?.expectedSeconds != null ? t('pool.every', { duration: fmtDuration(odds.doichain.expectedSeconds) }) : '–'}</div>
    <div class="muted" style="font-size: 12.5px; margin-top: 4px">{t('pool.today', { p: fmtPercent(odds?.doichain?.perDay, 2) })} · {t('pool.days30', { p: fmtPercent(odds?.doichain?.per30Days, 1) })}</div>
    <div style="font-size: 12.5px; color: var(--text-2); margin-top: 2px">{t('pool.reward', { amount: fmtCoins(snapshot?.doichain?.blockSubsidy, 'DOI', 2) })}</div>
  </div>
</div>
<div class="card-inner" style="display: flex; gap: 16px; align-items: center">
  <Gauge value={odds?.bitcoin?.perYear ?? null} label={yearLabel(odds?.bitcoin)} sub={t('pool.perYear')} color="var(--btc)" fontSize={15} ariaLabel={`Bitcoin ${t('home.btcChance')}: ${yearLabel(odds?.bitcoin)}`} />
  <div style="min-width: 0">
    <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap"><span class="label btc">Bitcoin</span><span class="muted-2" style="font-size: 12px">{t('pool.target', { difficulty: fmtDifficulty(snapshot?.bitcoin?.difficulty) })}</span></div>
    <div class="mono" style="font-size: 22px; font-weight: 600; margin-top: 4px">
      {#if snapshot?.bitcoin?.syncing}
        <span class="muted" style="font-size: 14px; font-weight: 500">{t('chain.syncing')} …</span>
      {:else}
        {odds?.bitcoin?.expectedSeconds != null ? t('pool.every', { duration: fmtDuration(odds.bitcoin.expectedSeconds) }) : '–'}
      {/if}
    </div>
    <div class="muted" style="font-size: 12.5px; margin-top: 4px">{t('pool.today', { p: fmtPercent(odds?.bitcoin?.perDay, 5) })}</div>
    <div style="font-size: 12.5px; color: var(--text-2); margin-top: 2px">{t('pool.reward', { amount: fmtCoins(snapshot?.bitcoin?.blockSubsidy, 'BTC', 3) })} + fees</div>
  </div>
</div>
<p class="muted-2" style="font-size: 12px">{hint}</p>
