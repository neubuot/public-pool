<script lang="ts">
  import { onMount } from 'svelte';

  import { api, type AddressInfo, type Chain } from '../lib/api';
  import { mempoolSpace } from '../lib/config';
  import { fmtCoins, fmtDate, fmtInt, shortHash } from '../lib/format';
  import { t } from '../lib/i18n.svelte';
  import ChainBadge from '../components/ChainBadge.svelte';
  import CopyButton from '../components/CopyButton.svelte';
  import StatusBox from '../components/StatusBox.svelte';

  interface Props { chain: string; address: string; }
  let { chain, address }: Props = $props();

  const chainKey = $derived<Chain>(chain.toUpperCase() === 'DOI' ? 'DOI' : 'BTC');
  let info = $state<AddressInfo | null>(null);
  let error = $state<string | null>(null);
  let loading = $state(true);

  async function load() {
    loading = true;
    try {
      info = await api.address(chainKey, address);
      error = null;
    } catch (e: any) {
      error = e?.message ?? 'Fehler';
    } finally {
      loading = false;
    }
  }
  onMount(() => { void load(); });

  const base = $derived(`/explorer/${chainKey.toLowerCase()}`);
</script>

<main class="page" style="max-width: 1200px">
  {#if info == null}
    <StatusBox loading={loading} error={error} onretry={load} />
  {:else}
    <div style="display: flex; align-items: center; gap: 12px; flex-wrap: wrap">
      <ChainBadge chain={info.chain} />
      <h1>{t('explorer.address')}</h1>
      <span class="muted-2" style="margin-left: auto; font-size: 12px">{t('explorer.source', { source: info.source === 'node' ? t('explorer.sourceNode') : info.source })}</span>
    </div>
    <div style="display: flex; align-items: center; gap: 8px; margin-top: 6px"><span class="hash" style="font-size: 13px">{info.address}</span><CopyButton text={info.address} /></div>

    <div class="grid12" style="margin-top: 20px">
      <section class="card span6">
        <dl class="kv">
          <dt>{t('explorer.balance')}</dt><dd class="mono" style="font-size: 20px; font-weight: 600">{fmtCoins(info.balance, info.chain)}</dd>
          <dt>{t('explorer.utxos')}</dt><dd class="mono">{info.utxoCount != null ? fmtInt(info.utxoCount) : '–'}</dd>
          {#if info.txCount != null}<dt>{t('explorer.txCount')}</dt><dd class="mono">{fmtInt(info.txCount)}</dd>{/if}
          {#if info.received != null}<dt>{t('explorer.received')}</dt><dd class="mono">{fmtCoins(info.received, info.chain)}</dd>{/if}
          {#if info.spent != null}<dt>{t('explorer.spent')}</dt><dd class="mono">{fmtCoins(info.spent, info.chain)}</dd>{/if}
        </dl>
        {#if info.hint}<p class="muted-2" style="font-size: 12px; margin-top: 12px">{info.hint}</p>{/if}
        <div style="display: flex; gap: 14px; margin-top: 12px; font-size: 13px; flex-wrap: wrap">
          {#if chainKey === 'BTC'}
            <a href={`/d/${info.address}`}>{t('nav.mine')} →</a>
            <a href={`${mempoolSpace}/address/${info.address}`} target="_blank" rel="noopener noreferrer">{t('explorer.openMempool')} ↗</a>
          {/if}
        </div>
      </section>

      <section class="card span6 table-wrap" style="padding: 14px 16px">
        {#if info.unspents.length > 0}
          <div class="label">{t('explorer.utxos')}</div>
          <table class="data" style="margin-top: 8px">
            <thead><tr><th>Txid</th><th class="num">{t('blocks.height')}</th><th class="num">{t('explorer.valueOut')}</th></tr></thead>
            <tbody>
              {#each info.unspents as u (u.txid + ':' + u.vout)}
                <tr><td class="hash"><a href={`${base}/tx/${u.txid}`}>{shortHash(u.txid, 14, 8)}:{u.vout}</a></td><td class="num mono">{u.height != null ? fmtInt(u.height) : '–'}</td><td class="num mono">{fmtCoins(u.value, info.chain)}</td></tr>
              {/each}
            </tbody>
          </table>
        {:else if info.txs.length > 0}
          <div class="label">{t('explorer.txs')}</div>
          <table class="data" style="margin-top: 8px">
            <thead><tr><th>Txid</th><th>{t('explorer.time')}</th><th class="num">{t('explorer.valueOut')}</th></tr></thead>
            <tbody>
              {#each info.txs as tx (tx.txid)}
                <tr><td class="hash"><a href={`${base}/tx/${tx.txid}`}>{shortHash(tx.txid, 14, 8)}</a></td><td class="muted" style="white-space: nowrap">{tx.time != null ? fmtDate(tx.time) : t('explorer.unconfirmed')}</td><td class="num mono">{fmtCoins(tx.valueOut, info.chain)}</td></tr>
              {/each}
            </tbody>
          </table>
        {:else}
          <p class="muted" style="font-size: 13px">–</p>
        {/if}
      </section>
    </div>
  {/if}
</main>
