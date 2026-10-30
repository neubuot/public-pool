<script lang="ts">
  // Teilen-Karte (1200 × 630) für einen gefundenen Block, wie Artboard "Share" im Mockup.
  import { onMount } from 'svelte';

  import { api, type InfoResponse, type MinerInfo } from '../lib/api';
  import { poolDomain } from '../lib/config';
  import { fmtCoins, fmtDate, fmtDifficulty, fmtInt, shortHash } from '../lib/format';
  import { t } from '../lib/i18n.svelte';
  import { stats } from '../lib/stats.svelte';
  import CopyButton from '../components/CopyButton.svelte';
  import StatusBox from '../components/StatusBox.svelte';

  interface Props { chain: string; height: string; }
  let { chain, height }: Props = $props();

  const chainKey = $derived(chain.toUpperCase() === 'DOI' ? 'DOI' : 'BTC');
  const color = $derived(chainKey === 'DOI' ? '#38BDF8' : '#F7931A');
  let info = $state<InfoResponse | null>(null);
  let miner = $state<MinerInfo | null>(null);
  let error = $state<string | null>(null);
  let loading = $state(true);
  let scale = $state(1);

  const block = $derived(info?.blockData.find(b => b.chain === chainKey && b.height === parseInt(height, 10)) ?? null);
  const subsidy = $derived(chainKey === 'DOI' ? stats.data?.doichain.blockSubsidy : stats.data?.bitcoin.blockSubsidy);
  const poolTotal = $derived(info?.blockData.filter(b => b.chain === chainKey).length ?? 0);

  async function load() {
    try {
      info = await api.info();
      error = null;
      const b = info.blockData.find(x => x.chain === chainKey && x.height === parseInt(height, 10));
      if (b != null) {
        miner = await api.miner(b.minerAddress).catch(() => null);
      }
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
  {#if info == null}
    <div style="width: min(600px, 100%)"><StatusBox loading={loading} error={error} onretry={load} /></div>
  {:else if block == null}
    <div class="card" style="width: min(600px, 100%)"><p class="muted">{t('share.notFound')}</p><p style="margin-top: 8px"><a href="/blocks">{t('share.back')}</a></p></div>
  {:else}
    <div style="width: {1200 * scale}px; height: {630 * scale}px; position: relative">
      <div class="share" style="transform: scale({scale}); transform-origin: top left">
        <svg aria-hidden="true" style="position: absolute; inset: 0" width="1200" height="630" viewBox="0 0 1200 630">
          <g fill={color}><circle cx="880" cy="92" r="5"/><circle cx="1040" cy="150" r="4"/><circle cx="960" cy="260" r="6"/><circle cx="1110" cy="330" r="4"/><circle cx="820" cy="400" r="5"/><circle cx="1000" cy="480" r="4"/></g>
          <g fill="#F7931A"><circle cx="940" cy="60" r="4"/><circle cx="1090" cy="220" r="5"/><circle cx="870" cy="310" r="4"/><circle cx="1130" cy="440" r="6"/><circle cx="920" cy="540" r="4"/></g>
          <g fill="#4ADE80"><circle cx="1010" cy="110" r="3"/><circle cx="850" cy="200" r="4"/><circle cx="1060" cy="380" r="3"/><circle cx="980" cy="590" r="5"/></g>
          <g fill="none" stroke={color} stroke-width="2" opacity="0.9"><path d="M1000 180 l18 -18 l18 18 l-18 18 z"/><path d="M880 480 l14 -14 l14 14 l-14 14 z"/><path d="M1120 120 l10 -10 l10 10 l-10 10 z"/></g>
        </svg>
        <div style="display: flex; align-items: center; gap: 14px; position: relative">
          <div style="width: 40px; height: 40px; border: 2px solid {color}; border-radius: 10px; display: grid; place-items: center">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={color} stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12h4l3-8 4 16 3-8h4"></path></svg>
          </div>
          <span style="font-weight: 700; letter-spacing: 0.16em; font-size: 20px">NERDPOOL</span>
          <span class="mono" style="color: #6B7A8A; font-size: 16px">{poolDomain}</span>
        </div>
        <div style="margin-top: 48px; position: relative">
          <div class="label" style="font-size: 13px; letter-spacing: .16em; color: {color}">{t('share.found', { chain: chainKey === 'DOI' ? 'Doichain' : 'Bitcoin' })}</div>
          <div class="mono" style="font-size: 88px; font-weight: 600; line-height: 1; margin-top: 10px; letter-spacing: -0.02em">+{subsidy != null ? fmtCoins(subsidy, chainKey, chainKey === 'BTC' ? 3 : 1) : chainKey}</div>
          <div class="mono" style="font-size: 30px; color: #C7D2DC; margin-top: 14px">{t('explorer.block')} {fmtInt(block.height)}{#if block.createdAt} · {fmtDate(block.createdAt)}{/if}</div>
        </div>
        <div style="margin-top: auto; display: flex; align-items: flex-end; gap: 40px; position: relative">
          <div style="min-width: 0">
            <div class="label" style="font-size: 13px; letter-spacing: .16em">{t('share.foundWith')}</div>
            <div style="font-size: 24px; font-weight: 600; margin-top: 6px">{t('share.worker', { worker: block.worker })}</div>
            <div class="mono" style="font-size: 17px; color: #9AAABB; margin-top: 2px">{shortHash(block.minerAddress, 10, 8)}{#if miner?.bestDifficultyUserAgent} · {miner.bestDifficultyUserAgent}{/if}</div>
          </div>
          <div style="margin-left: auto; display: flex; gap: 12px">
            <div style="border: 1px solid #1E2A36; border-radius: 10px; padding: 12px 16px; background: #111821"><div class="label">{t('share.bestShare')}</div><div class="mono" style="font-size: 22px; font-weight: 600; margin-top: 2px">{miner != null ? fmtDifficulty(miner.bestDifficulty) : '–'}</div></div>
            <div style="border: 1px solid #1E2A36; border-radius: 10px; padding: 12px 16px; background: #111821"><div class="label">{t('share.poolBlocks', { chain: chainKey })}</div><div class="mono" style="font-size: 22px; font-weight: 600; margin-top: 2px">{fmtInt(poolTotal)}</div></div>
          </div>
        </div>
      </div>
    </div>
    <div style="display: flex; gap: 10px; flex-wrap: wrap; justify-content: center">
      <a class="btn primary" href={`/api/share/${chainKey.toLowerCase()}/${block.height}`} download={`nerdpool-${chainKey.toLowerCase()}-${block.height}.png`} rel="external">{t('share.download')}</a>
      <CopyButton text={`${window.location.origin}/s/${chainKey.toLowerCase()}/${block.height}`} label={t('share.copyLink')} small={false} />
    </div>
    <p class="muted" style="font-size: 13px; text-align: center; max-width: 560px">{t('share.linkHint')}</p>
    <p style="font-size: 13px"><a href="/blocks">{t('share.back')}</a>{#if block.blockHash} · <a href={`/explorer/${chainKey.toLowerCase()}/block/${block.blockHash}`}>{t('blocks.explorer')}</a>{/if}</p>
  {/if}
</main>

<style>
  .share {
    width: 1200px; height: 630px; padding: 56px 64px;
    background-color: #0B0F14; background-image: radial-gradient(#18232E 1px, transparent 1px); background-size: 24px 24px;
    color: #E6EDF3; font-family: Inter, system-ui, sans-serif; display: flex; flex-direction: column; position: relative; overflow: hidden;
    border: 1px solid #1E2A36; border-radius: 16px;
  }
</style>
