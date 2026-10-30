<script lang="ts">
  // Explorer-Startseite: Suche und die neuesten Blöcke beider Ketten.
  import { onMount } from 'svelte';

  import { api, type BlockSummary, type Chain, type SearchResult } from '../lib/api';
  import { fmtAgo, fmtBytes, fmtInt } from '../lib/format';
  import { t } from '../lib/i18n.svelte';
  import { navigate } from '../lib/router.svelte';
  import { clock, stats } from '../lib/stats.svelte';

  let query = $state('');
  let searching = $state(false);
  let searchError = $state<string | null>(null);
  let heightChoice = $state<{ height: number, chains: Chain[] } | null>(null);

  let doi = $state<BlockSummary[]>([]);
  let btc = $state<BlockSummary[]>([]);
  let doiError = $state<string | null>(null);
  let btcError = $state<string | null>(null);
  let loadingMore = $state<Record<Chain, boolean>>({ DOI: false, BTC: false });

  async function loadLatest() {
    const [d, b] = await Promise.allSettled([api.blocks('DOI', 12), api.blocks('BTC', 12)]);
    if (d.status === 'fulfilled') { doi = d.value; doiError = null; } else { doiError = d.reason?.message ?? 'Fehler'; }
    if (b.status === 'fulfilled') { btc = b.value; btcError = null; } else { btcError = b.reason?.message ?? 'Fehler'; }
  }

  async function more(chain: Chain) {
    const list = chain === 'DOI' ? doi : btc;
    if (list.length === 0) {
      return;
    }
    loadingMore[chain] = true;
    try {
      const older = await api.blocks(chain, 12, list[list.length - 1].height);
      if (chain === 'DOI') { doi = [...doi, ...older]; } else { btc = [...btc, ...older]; }
    } catch (e: any) {
      if (chain === 'DOI') { doiError = e?.message; } else { btcError = e?.message; }
    } finally {
      loadingMore[chain] = false;
    }
  }

  function go(result: SearchResult) {
    switch (result.type) {
      case 'block': navigate(`/explorer/${result.chain.toLowerCase()}/block/${result.hash}`); break;
      case 'tx': navigate(`/explorer/${result.chain.toLowerCase()}/tx/${result.txid}`); break;
      case 'address': navigate(`/explorer/${result.chain.toLowerCase()}/address/${result.address}`); break;
      case 'height':
        if (result.chains.length === 1) {
          navigate(`/explorer/${result.chains[0].toLowerCase()}/block/${result.height}`);
        } else {
          heightChoice = { height: result.height, chains: result.chains };
        }
        break;
    }
  }

  async function search(event: Event) {
    event.preventDefault();
    const q = query.trim();
    if (q.length === 0) {
      return;
    }
    searching = true;
    searchError = null;
    heightChoice = null;
    try {
      go(await api.search(q));
    } catch (e: any) {
      searchError = e?.message ?? 'Fehler';
    } finally {
      searching = false;
    }
  }

  onMount(() => {
    void loadLatest();
    const timer = setInterval(() => { if (document.visibilityState === 'visible' && doi.length <= 12 && btc.length <= 12) { void loadLatest(); } }, 60000);
    return () => clearInterval(timer);
  });
</script>

<main class="page">
  <h1>{t('explorer.title')}</h1>
  <p class="muted" style="margin-top: 8px; max-width: 760px">{t('explorer.lead')}</p>

  <form class="card" style="margin-top: 20px; display: flex; gap: 10px; align-items: center; flex-wrap: wrap" onsubmit={search} role="search">
    <input class="input" bind:value={query} placeholder={t('explorer.search')} autocomplete="off" spellcheck="false" style="flex: 1 1 320px" aria-label={t('explorer.search')}>
    <button class="btn primary" type="submit" disabled={searching} style="height: 44px; padding: 0 18px">{searching ? t('common.loading') : t('explorer.go')}</button>
    {#if searchError}<div class="red" style="width: 100%; font-size: 13px">{t('explorer.notFound', { message: searchError })}</div>{/if}
    {#if heightChoice}
      <div style="width: 100%; font-size: 13px; display: flex; gap: 12px; align-items: center; flex-wrap: wrap">
        <span class="muted">{t('explorer.chooseChain', { height: fmtInt(heightChoice.height) })}</span>
        {#each heightChoice.chains as chain (chain)}
          <a class="btn small" href={`/explorer/${chain.toLowerCase()}/block/${heightChoice.height}`}><span class={chain === 'DOI' ? 'doi' : 'btc'}>{chain}</span>&nbsp;{fmtInt(heightChoice.height)}</a>
        {/each}
      </div>
    {/if}
  </form>

  <div class="grid12" style="margin-top: 20px">
    {#each [{ chain: 'DOI' as Chain, list: doi, error: doiError, title: t('explorer.latestDoi') }, { chain: 'BTC' as Chain, list: btc, error: btcError, title: t('explorer.latestBtc') }] as col (col.chain)}
      <section class="card span6 table-wrap" aria-label={col.title} style="padding: 14px 16px">
        <div style="display: flex; align-items: center; gap: 10px"><span class="label" style="color: {col.chain === 'DOI' ? 'var(--doi)' : 'var(--btc)'}">{col.title}</span>{#if col.chain === 'BTC' && stats.data?.bitcoin.syncing}<span class="muted-2" style="font-size: 12px">{t('chain.syncing')} …</span>{/if}</div>
        {#if col.error}<p class="red" style="margin-top: 10px; font-size: 13px">{col.error}</p>{/if}
        {#if col.list.length === 0 && !col.error}<p class="muted" style="margin-top: 10px; font-size: 13px">{t('explorer.loading')}</p>{/if}
        {#if col.list.length > 0}
          <table class="data" style="margin-top: 8px">
            <thead><tr><th class="num">{t('blocks.height')}</th><th>{t('explorer.time')}</th><th class="num">{t('explorer.txs')}</th><th class="num">{t('explorer.size')}</th><th></th></tr></thead>
            <tbody>
              {#each col.list as block (block.hash)}
                <tr>
                  <td class="num mono"><a href={`/explorer/${col.chain.toLowerCase()}/block/${block.hash}`}>{fmtInt(block.height)}</a></td>
                  <td class="muted" style="white-space: nowrap">{t('chain.ago', { ago: fmtAgo(block.time, clock.now) })}</td>
                  <td class="num mono">{fmtInt(block.txCount)}</td>
                  <td class="num mono">{fmtBytes(block.size)}</td>
                  <td style="white-space: nowrap; font-size: 11px">{#if block.poolBlock}<span class="green">★ NerdPool</span>{/if}{#if block.auxpow}<span class="muted-2" title={t('explorer.auxpow')}> AuxPoW</span>{/if}</td>
                </tr>
              {/each}
            </tbody>
          </table>
          <button class="btn small" type="button" style="margin-top: 10px" disabled={loadingMore[col.chain]} onclick={() => more(col.chain)}>{loadingMore[col.chain] ? t('common.loading') : t('explorer.more')}</button>
        {/if}
      </section>
    {/each}
  </div>
</main>
