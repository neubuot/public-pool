<script lang="ts">
  // Block-Feed: zuletzt gefundene Blöcke, Zähler je Kette.
  import type { FoundBlock } from '../lib/api';
  import { fmtCoins, fmtDate, fmtInt } from '../lib/format';
  import { t } from '../lib/i18n.svelte';
  import ChainBadge from './ChainBadge.svelte';

  interface Props {
    blocks: FoundBlock[];
    totals: { BTC: number, DOI: number } | null;
    title: string;
    subsidy?: { BTC: number | null, DOI: number | null };
  }
  let { blocks, totals, title, subsidy = { BTC: null, DOI: null } }: Props = $props();

  const shown = $derived(blocks.slice(0, 4));
</script>

<div class="label">{title}</div>
{#if shown.length === 0}
  <article style="border: 1px dashed var(--border-2); border-radius: 10px; padding: 14px">
    <div style="display: flex; align-items: center; gap: 8px"><ChainBadge chain="DOI" /><span class="muted" style="font-size: 13px">{t('pool.noBlocks')}</span></div>
    <div style="display: flex; align-items: center; gap: 8px; margin-top: 6px"><ChainBadge chain="BTC" /><span class="muted" style="font-size: 13px">{t('pool.noBlocks')}</span></div>
    <div class="muted-2" style="font-size: 12px; margin-top: 8px">{t('pool.noBlocksHint')}</div>
  </article>
{/if}
{#each shown as block (block.chain + block.height + (block.blockHash ?? ''))}
  {@const reward = block.chain === 'DOI' ? subsidy.DOI : subsidy.BTC}
  <article class="card-inner" style="border-color: {block.accepted ? (block.chain === 'DOI' ? 'var(--doi)' : 'var(--btc)') : 'var(--red)'}; display: flex; gap: 14px; align-items: center">
    <div style="min-width: 0; flex: 1">
      <div style="display: flex; align-items: center; gap: 8px"><ChainBadge chain={block.chain} /><span class="mono" style="font-weight: 600">{t('explorer.block')} {fmtInt(block.height)}</span>{#if !block.accepted}<span class="red" style="font-size: 12px">{t('blocks.rejected')}</span>{/if}</div>
      {#if reward != null}
        <div class="mono" style="font-size: 20px; font-weight: 600; margin-top: 2px">+{fmtCoins(reward, block.chain, block.chain === 'BTC' ? 3 : 1)}</div>
      {/if}
      <div class="muted" style="font-size: 12px; margin-top: 2px">{fmtDate(block.time)} · {block.worker}</div>
      <div style="display: flex; gap: 12px; margin-top: 6px; font-size: 12.5px">
        {#if block.blockHash}<a href={`/explorer/${block.chain.toLowerCase()}/block/${block.blockHash}`}>{t('blocks.explorer')}</a>{/if}
        <a href={`/share/${block.chain.toLowerCase()}/${block.height}`}>{t('blocks.share')}</a>
      </div>
    </div>
  </article>
{/each}
{#if totals != null}
  <div style="margin-top: auto; display: flex; justify-content: space-between; font-size: 12.5px; color: var(--muted)">
    <span>{t('pool.poolTotal')}</span><span class="mono">DOI {fmtInt(totals.DOI)} · BTC {fmtInt(totals.BTC)}</span>
  </div>
{/if}
