<script lang="ts">
  // Mein Dashboard: alles zu einer BTC-Adresse (Geräte, Hashrate, Chancen, Best Share, Blöcke, Live-Terminal).
  import { validate } from 'bitcoin-address-validation';
  import { onMount } from 'svelte';

  import { api, type FoundBlock, type MinerInfo } from '../lib/api';
  import { fmtAgo, fmtDate, fmtDifficulty, fmtDuration, fmtHashrate, fmtInt, fmtPercent, shortHash, toMs } from '../lib/format';
  import { t } from '../lib/i18n.svelte';
  import { clock, remember, stats } from '../lib/stats.svelte';
  import BlockFeed from '../components/BlockFeed.svelte';
  import CopyButton from '../components/CopyButton.svelte';
  import LineChart from '../components/LineChart.svelte';
  import LotteryCard from '../components/LotteryCard.svelte';
  import StatusBox from '../components/StatusBox.svelte';
  import Terminal from '../components/Terminal.svelte';

  interface Props { address: string; }
  let { address }: Props = $props();

  const valid = $derived(validate(address));
  let miner = $state<MinerInfo | null>(null);
  let error = $state<string | null>(null);
  let loading = $state(true);
  let workerCharts = $state<Record<string, [number, number | null][]>>({});

  const COLORS = ['#9085E9', '#199E70', '#38BDF8', '#F7931A', '#F472B6', '#A3E635'];
  const snapshot = $derived(stats.data);

  async function load() {
    if (!valid) {
      loading = false;
      return;
    }
    try {
      const info = await api.miner(address);
      miner = info;
      error = null;
      remember('btcAddress', address);
      const names = Array.from(new Set(info.workers.filter(w => w.online).map(w => w.name))).slice(0, 6);
      const charts: Record<string, [number, number | null][]> = {};
      await Promise.all(names.map(async name => {
        try {
          const worker = await api.worker(address, name);
          charts[name] = worker.chart.map(p => [toMs(p.label) ?? 0, p.data] as [number, number | null]);
        } catch {
          // Chart fehlt, Gerät bleibt trotzdem sichtbar
        }
      }));
      workerCharts = charts;
    } catch (e: any) {
      error = e?.message ?? 'Fehler';
    } finally {
      loading = false;
    }
  }

  onMount(() => {
    void load();
    const timer = setInterval(() => { if (document.visibilityState === 'visible') { void load(); } }, 15000);
    return () => clearInterval(timer);
  });

  const series = $derived.by(() => {
    const names = Object.keys(workerCharts);
    if (names.length > 0) {
      return names.map((name, i) => ({ name, color: COLORS[i % COLORS.length], data: workerCharts[name] }));
    }
    return [{ name: t('home.hashrate'), color: '#38BDF8', area: true, data: (miner?.chart ?? []).map(p => [toMs(p.label) ?? 0, p.data] as [number, number | null]) }];
  });
  const online = $derived(miner?.workers.filter(w => w.online) ?? []);
  const closest = $derived.by(() => {
    const recorded = (miner?.topShares ?? []).slice(0, 6).map(s => ({ key: `${s.time}-${s.difficulty}`, difficulty: s.difficulty, worker: s.worker, time: s.time as number | string }));
    if (recorded.length > 0) {
      return recorded;
    }
    return [...(miner?.workers ?? [])].filter(w => w.bestDifficulty > 0).sort((a, b) => b.bestDifficulty - a.bestDifficulty).slice(0, 5)
      .map(w => ({ key: w.sessionId, difficulty: w.bestDifficulty, worker: w.name, time: w.lastSeen as number | string }));
  });
  const doiTarget = $derived(snapshot?.doichain.difficulty ?? null);
  const btcTarget = $derived(snapshot?.bitcoin.difficulty ?? null);
  const best = $derived(miner?.bestDifficulty ?? 0);
  const feed = $derived<FoundBlock[]>((miner?.blocks ?? []).map(b => ({ chain: b.chain, height: b.height, blockHash: b.blockHash, minerAddress: address, worker: b.worker, accepted: b.accepted, result: b.result, time: b.time })));
  const totals = $derived({ BTC: feed.filter(b => b.chain === 'BTC' && b.accepted).length, DOI: feed.filter(b => b.chain === 'DOI' && b.accepted).length });

  function workerColor(name: string): string {
    const index = Object.keys(workerCharts).indexOf(name);
    return index >= 0 ? COLORS[index % COLORS.length] : 'var(--muted-2)';
  }
</script>

<main class="page">
  <div style="display: flex; align-items: center; gap: 14px; flex-wrap: wrap">
    <h1>{t('miner.title')}</h1>
    <span class="mono muted" style="font-size: 13px; overflow: hidden; text-overflow: ellipsis; max-width: 100%">{address}</span>
    <CopyButton text={address} ariaLabel="Adresse kopieren" />
  </div>

  {#if !valid}
    <div class="card" style="margin-top: 20px"><p class="red">{t('miner.invalid')}</p></div>
  {:else if miner == null}
    <div style="margin-top: 20px"><StatusBox loading={loading} error={error} onretry={load} /></div>
  {:else}
    {#if snapshot != null && !snapshot.pool.jobsActive}
      <div class="card" style="margin-top: 20px; border-color: var(--warn-border); display: flex; gap: 12px; align-items: center">
        <span class="dot warn pulse"></span>
        <span style="font-size: 13px; color: var(--text-2)">{t('pool.noJobs', { percent: Math.round((snapshot.bitcoin.verificationProgress ?? 0) * 100) })}</span>
      </div>
    {/if}
    <div class="grid12" style="margin-top: 20px">

      <section class="card span8" aria-label={t('miner.hashrate24')}>
        <div style="display: flex; align-items: baseline; gap: 16px; flex-wrap: wrap">
          <div>
            <div class="label">{t('miner.hashrate24')}</div>
            <div style="display: flex; align-items: baseline; gap: 10px; margin-top: 6px">
              <span class="mono" style="font-size: 34px; font-weight: 600; letter-spacing: -0.01em">{fmtHashrate(miner.hashRate)}</span>
              <span class="muted" style="font-size: 13px">{t('miner.devices', { online: fmtInt(miner.workersOnline) })}</span>
            </div>
          </div>
        </div>
        <div style="margin-top: 12px">
          <LineChart {series} height={236} format={v => fmtHashrate(v)} empty={t('miner.noDevices')} />
        </div>
      </section>

      <section class="card span4" aria-label={t('miner.lottery')} style="display: flex; flex-direction: column; gap: 14px">
        <LotteryCard odds={miner.odds} snapshot={snapshot} title={t('miner.lottery')} hint={t('miner.lotteryHint')} />
      </section>

      <section class="card span8" aria-label={t('miner.devices', { online: miner.workersOnline })}>
        <div style="display: flex; align-items: center; gap: 12px">
          <div class="label">{t('miner.devices', { online: fmtInt(miner.workersOnline) })}</div>
          <a href="/" style="margin-left: auto; font-size: 12.5px">{t('miner.addDevice')}</a>
        </div>
        {#if miner.workers.length === 0}
          <p class="muted" style="margin-top: 12px; font-size: 13px">{t('miner.noDevices')}</p>
        {/if}
        <div class="devices">
          {#each miner.workers as worker (worker.sessionId)}
            <article class="card-inner" style="display: flex; flex-direction: column; gap: 10px; opacity: {worker.online ? 1 : 0.6}">
              <div style="display: flex; align-items: center; gap: 8px"><span class="dot" class:off={!worker.online} style="background: {worker.online ? workerColor(worker.name) : ''}; box-shadow: none"></span><strong style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap">{worker.name}</strong><span class="muted-2" style="margin-left: auto; font-size: 11.5px; white-space: nowrap">{worker.online ? t('miner.lastSeen', { ago: fmtAgo(worker.lastSeen, clock.now) }) : t('miner.offline')}</span></div>
              <div class="muted" style="font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap">{worker.userAgent ?? '?'}</div>
              <div class="mono" style="font-size: 24px; font-weight: 600">{fmtHashrate(worker.hashRate)}</div>
              <div style="display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px 10px; font-size: 12px; color: var(--text-2)">
                <span>{t('miner.best', { difficulty: fmtDifficulty(worker.bestDifficulty) })}</span>
                <span>{t('miner.uptime', { duration: fmtDuration((clock.now - (toMs(worker.startTime) ?? clock.now)) / 1000) })}</span>
                <span class="mono" style="grid-column: 1 / -1; color: var(--muted)" title={worker.doiAddress ?? ''}>{worker.doiAddress ? `DOI ${shortHash(worker.doiAddress, 8, 6)}` : t('miner.doiDefault')}</span>
              </div>
            </article>
          {/each}
        </div>
      </section>

      <section class="card span4" aria-label={t('miner.bestShare')} style="display: flex; flex-direction: column; gap: 14px">
        <div class="label">{t('miner.bestShare')}</div>
        <div>
          <div style="display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap">
            <span class="mono" style="font-size: 30px; font-weight: 600">{fmtDifficulty(best)}</span>
            {#if miner.bestDifficultyUserAgent}<span class="muted" style="font-size: 12.5px">{miner.bestDifficultyUserAgent}</span>{/if}
          </div>
          <div style="margin-top: 10px; font-size: 12.5px; color: var(--text-2); display: flex; justify-content: space-between"><span>{t('miner.ofDoiTarget', { p: doiTarget ? fmtPercent(best / doiTarget, 2) : '–' })}</span><span class="mono">{fmtDifficulty(doiTarget)}</span></div>
          <div class="bar" style="margin-top: 6px"><span style="width: {doiTarget ? Math.min(100, best / doiTarget * 100) : 0}%"></span></div>
          <div style="margin-top: 8px; font-size: 12.5px; color: var(--text-2); display: flex; justify-content: space-between"><span>{t('miner.ofBtcTarget', { p: btcTarget ? fmtPercent(best / btcTarget, 4) : '–' })}</span><span class="mono">{fmtDifficulty(btcTarget)}</span></div>
          <div class="bar" style="margin-top: 6px"><span style="width: {btcTarget ? Math.min(100, best / btcTarget * 100) : 0}%; background: var(--btc)"></span></div>
        </div>
        <div class="label" style="margin-top: 4px">{t('miner.closest')}</div>
        {#if closest.length === 0}<p class="muted" style="font-size: 13px">{t('pool.noShares')}</p>{/if}
        <ol class="mono" style="list-style: none; margin: 0; padding: 0; font-size: 12.5px; display: flex; flex-direction: column; gap: 6px">
          {#each closest as share (share.key)}
            <li style="display: flex; gap: 10px"><span class="doi" style="width: 72px; flex: none">{fmtDifficulty(share.difficulty)}</span><span style="color: var(--text-2); flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap">{share.worker}</span><span class="muted-2" style="white-space: nowrap">{fmtDate(share.time)}</span></li>
          {/each}
        </ol>
      </section>

      <section class="card span8" aria-label={t('pool.terminal')}>
        <Terminal {address} height={300} />
      </section>

      <section class="card span4" aria-label={t('miner.blockFeed')} style="display: flex; flex-direction: column; gap: 14px">
        <BlockFeed blocks={feed} {totals} title={t('miner.blockFeed')} subsidy={{ BTC: snapshot?.bitcoin.blockSubsidy ?? null, DOI: snapshot?.doichain.blockSubsidy ?? null }} />
      </section>

      <section class="card span12" aria-label={t('miner.doiTo')} style="display: flex; gap: 24px; flex-wrap: wrap; align-items: center">
        <div><div class="label">{t('miner.doiTo')}</div><div class="mono" style="margin-top: 4px; font-size: 14px; overflow-wrap: anywhere">{miner.doiAddress ?? t('miner.doiDefault')}</div></div>
        <div><div class="label">{t('miner.sharesLabel')}</div><div class="mono" style="margin-top: 4px; font-size: 14px">{fmtInt(miner.shares)}</div></div>
        <div><div class="label">{t('miner.targetDoi')}</div><div class="mono" style="margin-top: 4px; font-size: 14px">{fmtDifficulty(doiTarget)}</div></div>
        <div><div class="label">{t('miner.targetBtc')}</div><div class="mono" style="margin-top: 4px; font-size: 14px">{fmtDifficulty(btcTarget)}</div></div>
        {#if snapshot?.pool.telegramBot}
          <div style="flex: 1 1 100%; font-size: 13px; color: var(--text-2)">
            <a href={`https://t.me/${snapshot.pool.telegramBot}`} target="_blank" rel="noopener noreferrer" style="color: var(--accent)">{t('miner.telegram', { bot: snapshot.pool.telegramBot })}</a>
          </div>
        {/if}
      </section>
    </div>
  {/if}
</main>

<style>
  .devices { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; margin-top: 14px; }
  @media (max-width: 1200px) { .devices { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
  @media (max-width: 600px) { .devices { grid-template-columns: 1fr; } }
</style>
