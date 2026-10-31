<script lang="ts">
  // Teilen-Karte (1200 × 630) für den Best Share einer Adresse: wie nah der glücklichste Hash an einem Block war.
  import { onMount } from 'svelte';

  import { api, type MinerInfo } from '../lib/api';
  import { poolDomain } from '../lib/config';
  import { fmtDate, fmtDifficulty, fmtPercent, shortHash } from '../lib/format';
  import { t } from '../lib/i18n.svelte';
  import { stats } from '../lib/stats.svelte';
  import CopyButton from '../components/CopyButton.svelte';
  import StatusBox from '../components/StatusBox.svelte';

  interface Props { address: string; }
  let { address }: Props = $props();

  const DOI = '#38BDF8';
  const BTC = '#F7931A';
  let miner = $state<MinerInfo | null>(null);
  let error = $state<string | null>(null);
  let loading = $state(true);
  let scale = $state(1);

  const best = $derived(miner?.bestDifficulty ?? 0);
  const top = $derived(miner?.topShares?.[0] ?? null);
  const worker = $derived(top?.worker ?? '');
  const userAgent = $derived(miner?.bestDifficultyUserAgent ?? top?.userAgent ?? null);
  const time = $derived(top != null && top.difficulty >= best ? top.time : null);
  const doiTarget = $derived(stats.data?.doichain.difficulty ?? null);
  const btcTarget = $derived(stats.data?.bitcoin.difficulty ?? null);
  const doiFraction = $derived(doiTarget != null && doiTarget > 0 ? best / doiTarget : null);
  const btcFraction = $derived(btcTarget != null && btcTarget > 0 ? best / btcTarget : null);

  function width(fraction: number | null): number {
    if (fraction == null || fraction <= 0) {
      return 0;
    }
    return Math.max(6, Math.round(520 * Math.min(1, fraction)));
  }

  async function load() {
    try {
      miner = await api.miner(address);
      error = null;
    } catch (e: any) {
      error = e?.message ?? 'Fehler';
    } finally {
      loading = false;
    }
  }

  function fit() {
    scale = Math.min(1, (window.innerWidth - 32) / 1200);
  }

  onMount(() => {
    void load();
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  });
</script>

<main style="padding: 16px; display: flex; flex-direction: column; align-items: center; gap: 16px; min-height: 100vh">
  {#if miner == null}
    <div style="width: min(600px, 100%)"><StatusBox loading={loading} error={error} onretry={load} /></div>
  {:else if best <= 0}
    <div class="card" style="width: min(600px, 100%)"><p class="muted">{t('share.noBest')}</p><p style="margin-top: 8px"><a href={`/d/${address}`}>{t('share.toMiner')}</a></p></div>
  {:else}
    <div style="width: {1200 * scale}px; height: {630 * scale}px; position: relative">
      <div class="share" style="transform: scale({scale}); transform-origin: top left">
        <svg aria-hidden="true" style="position: absolute; inset: 0" width="1200" height="630" viewBox="0 0 1200 630">
          <g fill={DOI}><circle cx="880" cy="92" r="5"/><circle cx="1040" cy="150" r="4"/><circle cx="960" cy="260" r="6"/><circle cx="1110" cy="330" r="4"/><circle cx="820" cy="400" r="5"/><circle cx="1000" cy="480" r="4"/></g>
          <g fill={BTC}><circle cx="940" cy="60" r="4"/><circle cx="1090" cy="220" r="5"/><circle cx="870" cy="310" r="4"/><circle cx="1130" cy="440" r="6"/><circle cx="740" cy="470" r="4"/></g>
          <g fill="#4ADE80"><circle cx="1010" cy="110" r="3"/><circle cx="850" cy="200" r="4"/><circle cx="1060" cy="380" r="3"/><circle cx="980" cy="590" r="5"/></g>
        </svg>
        <div style="display: flex; align-items: center; gap: 14px; position: relative">
          <div style="width: 40px; height: 40px; border: 2px solid {DOI}; border-radius: 10px; display: grid; place-items: center">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={DOI} stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12h4l3-8 4 16 3-8h4"></path></svg>
          </div>
          <span style="font-weight: 700; letter-spacing: 0.16em; font-size: 20px">NERDPOOL</span>
          <span class="mono" style="color: #6B7A8A; font-size: 16px">{poolDomain}</span>
        </div>
        <div style="margin-top: 40px; position: relative">
          <div class="label" style="font-size: 13px; letter-spacing: .16em; color: {DOI}">{t('share.best')}</div>
          <div style="display: flex; align-items: baseline; gap: 22px; margin-top: 10px">
            <span class="mono" style="font-size: 88px; font-weight: 600; line-height: 1; letter-spacing: -0.02em">{fmtDifficulty(best)}</span>
            {#if time != null}<span class="mono" style="font-size: 26px; color: #9AAABB">{fmtDate(time)}</span>{/if}
          </div>
          <div style="margin-top: 16px; font-size: 17px; color: #C7D2DC">{t('share.doiBlock')}: {fmtPercent(doiFraction, 2)}</div>
          <div class="bar"><span style="width: {width(doiFraction)}px; background: {DOI}"></span></div>
          <div style="margin-top: 16px; font-size: 17px; color: #C7D2DC">{t('share.btcBlock')}: {fmtPercent(btcFraction, 4)}</div>
          <div class="bar"><span style="width: {width(btcFraction)}px; background: {BTC}"></span></div>
        </div>
        <div style="margin-top: auto; display: flex; align-items: flex-end; gap: 40px; position: relative">
          <div style="min-width: 0">
            <div class="label" style="font-size: 13px; letter-spacing: .16em">{t('share.foundWith')}</div>
            <div style="font-size: 24px; font-weight: 600; margin-top: 6px">{worker.length > 0 ? t('share.worker', { worker }) : t('share.noWorker')}</div>
            <div class="mono" style="font-size: 17px; color: #9AAABB; margin-top: 2px">{shortHash(address, 10, 8)}{#if userAgent} · {userAgent}{/if}</div>
          </div>
          <div style="margin-left: auto; display: flex; gap: 12px">
            <div style="border: 1px solid #1E2A36; border-radius: 10px; padding: 12px 16px; background: #111821"><div class="label">{t('share.targetDoi')}</div><div class="mono" style="font-size: 22px; font-weight: 600; margin-top: 2px">{fmtDifficulty(doiTarget)}</div></div>
            <div style="border: 1px solid #1E2A36; border-radius: 10px; padding: 12px 16px; background: #111821"><div class="label">{t('share.targetBtc')}</div><div class="mono" style="font-size: 22px; font-weight: 600; margin-top: 2px">{fmtDifficulty(btcTarget)}</div></div>
          </div>
        </div>
      </div>
    </div>
    <div style="display: flex; gap: 10px; flex-wrap: wrap; justify-content: center">
      <a class="btn primary" href={`/api/share/best/${address}`} download="nerdpool-best-share.png" rel="external">{t('share.download')}</a>
      <CopyButton text={`${window.location.origin}/s/best/${address}`} label={t('share.copyLink')} small={false} />
    </div>
    <p class="muted" style="font-size: 13px; text-align: center; max-width: 560px">{t('share.linkHint')}</p>
    <p style="font-size: 13px"><a href={`/d/${address}`}>{t('share.toMiner')}</a></p>
  {/if}
</main>

<style>
  .share {
    width: 1200px; height: 630px; padding: 56px 64px;
    background-color: #0B0F14; background-image: radial-gradient(#18232E 1px, transparent 1px); background-size: 24px 24px;
    color: #E6EDF3; font-family: Inter, system-ui, sans-serif; display: flex; flex-direction: column; position: relative; overflow: hidden;
    border: 1px solid #1E2A36; border-radius: 16px;
  }
  .bar { width: 520px; height: 10px; border-radius: 5px; background: #1E2A36; margin-top: 8px; overflow: hidden; }
  .bar span { display: block; height: 10px; border-radius: 5px; }
</style>
