<script lang="ts">
  // Öffentliches Pool-Dashboard: Instrumente und Charts für Bitcoin, Doichain und den Pool.
  import { onMount } from 'svelte';

  import { api, type History } from '../lib/api';
  import { fmtCoins, fmtDate, fmtDifficulty, fmtEur, fmtHashrate, fmtInt, fmtNum, fmtPercent, fmtSignedPercent } from '../lib/format';
  import { lang, t } from '../lib/i18n.svelte';
  import { stats } from '../lib/stats.svelte';
  import BlockFeed from '../components/BlockFeed.svelte';
  import ChainCard from '../components/ChainCard.svelte';
  import LineChart from '../components/LineChart.svelte';
  import LotteryCard from '../components/LotteryCard.svelte';
  import StatusBox from '../components/StatusBox.svelte';
  import Terminal from '../components/Terminal.svelte';
  import WalletNotice from '../components/WalletNotice.svelte';

  const snapshot = $derived(stats.data);
  let range = $state<'24h' | '7d' | '30d'>('24h');
  let history = $state<History | null>(null);
  let historyError = $state<string | null>(null);
  let networkChain = $state<'DOI' | 'BTC'>('DOI');

  /** "2026-10" → "Oktober 2026" / "October 2026" */
  function monthName(month: string): string {
    const date = new Date(`${month}-01T00:00:00Z`);
    return Number.isNaN(date.getTime()) ? month : date.toLocaleDateString(lang.current === 'de' ? 'de-DE' : 'en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  }

  async function loadHistory() {
    try {
      history = await api.history(range);
      historyError = null;
    } catch (e: any) {
      historyError = e?.message ?? 'Fehler';
    }
  }

  onMount(() => {
    void loadHistory();
    const timer = setInterval(() => { if (document.visibilityState === 'visible') { void loadHistory(); } }, 5 * 60 * 1000);
    return () => clearInterval(timer);
  });
  $effect(() => {
    void range;
    void loadHistory();
  });

  const poolSeries = $derived([
    { name: t('pool.hashrate'), color: '#38BDF8', area: true, data: (history?.pool ?? []).map(p => [p.t, p.hashRate] as [number, number | null]) },
    { name: t('status.minersOnline'), color: '#9085E9', yAxis: 1 as const, dashed: true, data: (history?.pool ?? []).map(p => [p.t, p.miners] as [number, number | null]) },
  ]);
  const networkSeries = $derived.by(() => {
    const points = networkChain === 'DOI' ? (history?.doichain ?? []) : (history?.bitcoin ?? []);
    const color = networkChain === 'DOI' ? '#38BDF8' : '#F7931A';
    return [
      { name: t('pool.networkHashrate'), color, area: true, data: points.map(p => [p.t, p.networkHashPs] as [number, number | null]) },
      { name: t('pool.difficulty'), color: '#C7D2DC', yAxis: 1 as const, dashed: true, data: points.map(p => [p.t, p.difficulty] as [number, number | null]) },
    ];
  });
  const totalDevices = $derived(snapshot?.pool.userAgents.reduce((acc, a) => acc + a.count, 0) ?? 0);
  const maxAgentHash = $derived(Math.max(1, ...(snapshot?.pool.userAgents.map(a => a.totalHashRate) ?? [1])));
  const doiShare = $derived(snapshot?.doichain.networkHashPs ? snapshot.pool.hashRate / snapshot.doichain.networkHashPs : null);
</script>

<main class="page">
  <div style="display: flex; align-items: baseline; gap: 14px; flex-wrap: wrap">
    <h1>{t('pool.title')}</h1>
    {#if snapshot}<span class="muted" style="font-size: 13px">{fmtDate(snapshot.time, true)}</span>{/if}
  </div>

  {#if snapshot == null}
    <div style="margin-top: 20px"><StatusBox loading={stats.error == null} error={stats.error} /></div>
  {:else}
    {#if !snapshot.pool.jobsActive}
      <div class="card" style="margin-top: 20px; border-color: var(--warn-border); display: flex; gap: 12px; align-items: center">
        <span class="dot warn pulse"></span>
        <span style="font-size: 13px; color: var(--text-2)">{t('pool.noJobs', { percent: Math.round((snapshot.bitcoin.verificationProgress ?? 0) * 100) })}</span>
      </div>
    {/if}
    <div style="margin-top: 20px"><WalletNotice compact /></div>
    <div class="grid12" style="margin-top: 20px">

      <section class="card span8" aria-label={t('pool.hashrate')}>
        <div style="display: flex; align-items: baseline; gap: 16px; flex-wrap: wrap">
          <div>
            <div class="label">{t('pool.hashrate')} · {t(`pool.range.${range}`)}</div>
            <div style="display: flex; align-items: baseline; gap: 10px; margin-top: 6px">
              <span class="mono" style="font-size: 34px; font-weight: 600; letter-spacing: -0.01em">{fmtHashrate(snapshot.pool.hashRate)}</span>
              <span class="muted" style="font-size: 13px">{t('pool.miners', { n: fmtInt(snapshot.pool.miners) })}</span>
            </div>
          </div>
          <div style="margin-left: auto; display: flex; gap: 4px" role="group">
            {#each ['24h', '7d', '30d'] as r (r)}
              <button class="btn small ghost" class:active={range === r} type="button" onclick={() => { range = r as typeof range; }}>{t(`pool.range.${r}`)}</button>
            {/each}
          </div>
        </div>
        <div style="margin-top: 12px">
          <LineChart series={poolSeries} height={236} format={v => fmtHashrate(v)} formatRight={v => fmtInt(v)} dayFormat={range !== '24h'} empty={historyError ?? t('term.empty')} />
        </div>
      </section>

      <section class="card span4" aria-label={t('pool.lottery')} style="display: flex; flex-direction: column; gap: 14px">
        <LotteryCard odds={snapshot.odds} snapshot={snapshot} title={t('pool.lottery')} hint={t('pool.lotteryHint')} />
      </section>

      <section class="card span6" aria-label="Bitcoin"><ChainCard chain={snapshot.bitcoin} poolHashRate={snapshot.pool.hashRate} /></section>
      <section class="card span6" aria-label="Doichain"><ChainCard chain={snapshot.doichain} poolHashRate={snapshot.pool.hashRate} /></section>

      <section class="card span8" aria-label={t('pool.history')}>
        <div style="display: flex; align-items: center; gap: 12px; flex-wrap: wrap">
          <div class="label">{t('pool.history')} · {t(`pool.range.${range}`)}</div>
          <div style="margin-left: auto; display: flex; gap: 4px" role="group">
            <button class="btn small ghost" class:active={networkChain === 'DOI'} type="button" onclick={() => { networkChain = 'DOI'; }}><span class="doi">DOI</span></button>
            <button class="btn small ghost" class:active={networkChain === 'BTC'} type="button" onclick={() => { networkChain = 'BTC'; }}><span class="btc">BTC</span></button>
          </div>
        </div>
        <div style="margin-top: 12px">
          <LineChart series={networkSeries} height={220} format={v => fmtHashrate(v)} formatRight={v => fmtDifficulty(v)} dayFormat={range !== '24h'} empty={snapshot.bitcoin.syncing && networkChain === 'BTC' ? t('chain.syncing') + ' …' : t('term.empty')} />
        </div>
      </section>

      <section class="card span4" aria-label={t('pool.devices')} style="display: flex; flex-direction: column; gap: 12px">
        <div class="label">{t('pool.devices')} · {fmtInt(totalDevices)}</div>
        {#if snapshot.pool.userAgents.length === 0}
          <p class="muted" style="font-size: 13px">{t('pool.noDevices')}</p>
        {/if}
        {#each snapshot.pool.userAgents.slice(0, 8) as agent (agent.userAgent)}
          <div>
            <div style="display: flex; justify-content: space-between; gap: 10px; font-size: 13px"><span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap">{agent.userAgent || '?'}</span><span class="mono muted" style="white-space: nowrap">{fmtInt(agent.count)} · {fmtHashrate(agent.totalHashRate)}</span></div>
            <div class="bar" style="margin-top: 4px"><span style="width: {Math.max(2, agent.totalHashRate / maxAgentHash * 100)}%"></span></div>
          </div>
        {/each}
        <div class="label" style="margin-top: 6px">{t('pool.bestShares')}</div>
        {#if snapshot.pool.topShares.length === 0 && snapshot.pool.highScores.length === 0}
          <p class="muted" style="font-size: 13px">{t('pool.noShares')}</p>
        {/if}
        <ol class="mono" style="list-style: none; margin: 0; padding: 0; font-size: 12.5px; display: flex; flex-direction: column; gap: 6px">
          {#if snapshot.pool.topShares.length > 0}
            {#each snapshot.pool.topShares.slice(0, 6) as share, i (i)}
              <li style="display: flex; gap: 10px"><span class="doi" style="width: 72px; flex: none">{fmtDifficulty(share.difficulty)}</span><span style="color: var(--text-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1">{#if share.address}<a href={`/d/${share.address}`} style="color: inherit">{share.worker}</a>{:else}{share.worker}{/if}</span><span class="muted-2" style="white-space: nowrap">{fmtDate(share.time)}</span></li>
            {/each}
          {:else}
            {#each snapshot.pool.highScores.slice(0, 6) as score, i (i)}
              <li style="display: flex; gap: 10px"><span class="doi" style="width: 72px; flex: none">{fmtDifficulty(score.bestDifficulty)}</span><span style="color: var(--text-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1">{score.bestDifficultyUserAgent || '?'}</span><span class="muted-2" style="white-space: nowrap">{fmtDate(score.updatedAt)}</span></li>
            {/each}
          {/if}
        </ol>
      </section>

      <section class="card span8" aria-label={t('pool.terminal')}>
        <Terminal height={300} />
      </section>

      <section class="card span4" aria-label={t('pool.blockFeed')} style="display: flex; flex-direction: column; gap: 14px">
        <BlockFeed blocks={snapshot.pool.recentBlocks} totals={{ BTC: snapshot.pool.blocksFound.BTC.accepted, DOI: snapshot.pool.blocksFound.DOI.accepted }} title={t('pool.blockFeed')} subsidy={{ BTC: snapshot.bitcoin.blockSubsidy, DOI: snapshot.doichain.blockSubsidy }} />
      </section>

      {#if snapshot.pool.monthly}
        <section class="card span12" aria-label={t('pool.monthly')}>
          <div style="display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap">
            <div class="label">{t('pool.monthly')} · {monthName(snapshot.pool.monthly.month)}</div>
            <span class="muted" style="font-size: 12.5px">{t('pool.monthlyHint')}</span>
          </div>
          {#if snapshot.pool.monthly.top.length === 0}
            <p class="muted" style="margin-top: 10px; font-size: 13px">{t('pool.monthlyNone')}</p>
          {:else}
            <ol class="mono monthly">
              {#each snapshot.pool.monthly.top.slice(0, 5) as share, i (i)}
                <li>
                  <span class="muted-2 rank">{i + 1}.</span>
                  <span class="doi diff">{fmtDifficulty(share.difficulty)}</span>
                  <span class="muted pct">{snapshot.doichain.difficulty ? fmtPercent(share.difficulty / snapshot.doichain.difficulty, 2) : '–'}</span>
                  <span class="who">{#if share.address}<a href={`/d/${share.address}`} style="color: inherit">{share.worker}</a>{:else}{share.worker}{/if}{#if share.userAgent} <span class="muted-2">· {share.userAgent}</span>{/if}</span>
                  <span class="muted-2 when">{fmtDate(share.time)}</span>
                </li>
              {/each}
            </ol>
          {/if}
          <p class="muted-2" style="margin-top: 10px; font-size: 12.5px">
            {#if snapshot.pool.monthly.previous.top.length > 0}
              {t('pool.monthlyPrevious', { month: monthName(snapshot.pool.monthly.previous.month), worker: snapshot.pool.monthly.previous.top[0].worker, difficulty: fmtDifficulty(snapshot.pool.monthly.previous.top[0].difficulty) })}
            {:else}
              {t('pool.monthlyPreviousNone', { month: monthName(snapshot.pool.monthly.previous.month) })}
            {/if}
          </p>
        </section>
      {/if}

      <section class="card span12 tiles" aria-label={t('pool.network')}>
        <div>
          <div class="label">BTC-{t('pool.difficulty')}</div>
          <div class="mono val">{fmtDifficulty(snapshot.bitcoin.difficulty)}</div>
          <div class="muted" style="font-size: 12px">
            {#if snapshot.bitcoin.syncing}{t('chain.syncing')} …{:else if snapshot.bitcoin.difficultyAdjustment}{t('pool.adjustment', { blocks: fmtInt(snapshot.bitcoin.difficultyAdjustment.blocksRemaining), when: snapshot.bitcoin.difficultyAdjustment.estimatedAt ? fmtDate(snapshot.bitcoin.difficultyAdjustment.estimatedAt) : '–' })}{#if snapshot.bitcoin.difficultyAdjustment.estimatedChange != null}, {t('pool.adjustmentChange', { change: fmtSignedPercent(snapshot.bitcoin.difficultyAdjustment.estimatedChange) })}{/if}{/if}
          </div>
        </div>
        <div>
          <div class="label">DOI-{t('pool.difficulty')}</div>
          <div class="mono val">{fmtDifficulty(snapshot.doichain.difficulty)}</div>
          <div class="muted" style="font-size: 12px">{t('pool.networkHashrate')} {fmtHashrate(snapshot.doichain.networkHashPs)} · {snapshot.doichain.avgBlockIntervalSec != null ? t('pool.blockEvery', { duration: `${fmtNum(snapshot.doichain.avgBlockIntervalSec / 60, 1)} min` }) : ''}</div>
        </div>
        <div>
          <div class="label">{t('pool.poolShare')}</div>
          <div class="mono val">{doiShare != null ? (doiShare * 100 < 0.01 ? '<0,01 %' : fmtPercent(doiShare, 2)) : '–'}</div>
          <div class="muted" style="font-size: 12px">{t('pool.poolShareHint', { hashrate: fmtHashrate(snapshot.pool.hashRate), n: fmtInt(totalDevices) })}</div>
        </div>
        <div>
          <div class="label">{t('pool.price')}</div>
          <div class="mono val">{snapshot.prices?.doiEur != null ? fmtEur(snapshot.prices.doiEur, 4) : '–'}</div>
          <div class="muted" style="font-size: 12px">
            {#if snapshot.prices?.doiEur != null && snapshot.doichain.blockSubsidy != null}
              {t('pool.priceHint', { reward: fmtCoins(snapshot.doichain.blockSubsidy, 'DOI', 1), eur: fmtEur(snapshot.prices.doiEur * snapshot.doichain.blockSubsidy) })}
            {:else}
              {t('pool.noPrice')}
            {/if}
          </div>
        </div>
      </section>
    </div>
  {/if}
</main>

<style>
  .tiles { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 20px; }
  .val { font-size: 20px; font-weight: 600; margin-top: 4px; }
  @media (max-width: 980px) { .tiles { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
</style>
