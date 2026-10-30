<script lang="ts">
  import { onMount } from 'svelte';

  import { api, type Chain, type TxDetail } from '../lib/api';
  import { mempoolSpace } from '../lib/config';
  import { fmtBytes, fmtCoins, fmtDate, fmtInt, shortHash } from '../lib/format';
  import { t } from '../lib/i18n.svelte';
  import ChainBadge from '../components/ChainBadge.svelte';
  import CopyButton from '../components/CopyButton.svelte';
  import StatusBox from '../components/StatusBox.svelte';

  interface Props { chain: string; txid: string; }
  let { chain, txid }: Props = $props();

  const chainKey = $derived<Chain>(chain.toUpperCase() === 'DOI' ? 'DOI' : 'BTC');
  let tx = $state<TxDetail | null>(null);
  let error = $state<string | null>(null);
  let loading = $state(true);

  async function load() {
    loading = true;
    try {
      tx = await api.tx(chainKey, txid);
      error = null;
    } catch (e: any) {
      error = e?.message ?? 'Fehler';
    } finally {
      loading = false;
    }
  }
  onMount(() => { void load(); });

  const base = $derived(`/explorer/${chainKey.toLowerCase()}`);
  const pretty = (value: unknown) => JSON.stringify(value, null, 1);
</script>

<main class="page" style="max-width: 1200px">
  {#if tx == null}
    <StatusBox loading={loading} error={error} onretry={load} />
  {:else}
    <div style="display: flex; align-items: center; gap: 12px; flex-wrap: wrap">
      <ChainBadge chain={tx.chain} />
      <h1>{t('explorer.tx')}</h1>
      {#if tx.coinbase}<span class="chip">{t('explorer.coinbase')}</span>{/if}
      {#if tx.nameOps.length > 0}<span class="chip" style="color: var(--doi)">{t('explorer.nameOp')}</span>{/if}
      <span class="muted-2" style="margin-left: auto; font-size: 12px">{t('explorer.source', { source: tx.source === 'node' ? t('explorer.sourceNode') : tx.source })}</span>
    </div>
    <div style="display: flex; align-items: center; gap: 8px; margin-top: 6px"><span class="hash" style="font-size: 13px">{tx.txid}</span><CopyButton text={tx.txid} /></div>

    <div class="grid12" style="margin-top: 20px">
      <section class="card span6">
        <dl class="kv">
          <dt>{t('explorer.inBlock')}</dt><dd>{#if tx.blockHash}<a class="hash" href={`${base}/block/${tx.blockHash}`} style="display: block">{tx.blockHeight != null ? `${fmtInt(tx.blockHeight)} · ` : ''}{shortHash(tx.blockHash, 14, 10)}</a>{:else}<span class="warn">{t('explorer.unconfirmed')}</span>{/if}</dd>
          <dt>{t('explorer.time')}</dt><dd class="mono">{tx.time != null ? fmtDate(tx.time, true) : '–'}</dd>
          <dt>{t('explorer.confirmations')}</dt><dd class="mono">{tx.confirmations != null ? fmtInt(tx.confirmations) : '–'}</dd>
          <dt>{t('explorer.fee')}</dt><dd class="mono">{tx.coinbase ? '–' : fmtCoins(tx.fee, tx.chain)}</dd>
          <dt>{t('explorer.valueIn')}</dt><dd class="mono">{tx.coinbase ? '–' : fmtCoins(tx.valueIn, tx.chain)}</dd>
          <dt>{t('explorer.valueOut')}</dt><dd class="mono">{fmtCoins(tx.valueOut, tx.chain)}</dd>
        </dl>
      </section>
      <section class="card span6">
        <dl class="kv">
          <dt>{t('explorer.size')}</dt><dd class="mono">{fmtBytes(tx.size)}{#if tx.vsize} · {fmtInt(tx.vsize)} vB{/if}{#if tx.weight} · {fmtInt(tx.weight)} WU{/if}</dd>
          <dt>{t('explorer.version')}</dt><dd class="mono">{tx.version ?? '–'}</dd>
          <dt>{t('explorer.locktime')}</dt><dd class="mono">{tx.locktime != null ? fmtInt(tx.locktime) : '–'}</dd>
          {#if tx.hash && tx.hash !== tx.txid}<dt>wtxid</dt><dd class="hash">{tx.hash}</dd>{/if}
          {#if chainKey === 'BTC'}<dt></dt><dd><a href={`${mempoolSpace}/tx/${tx.txid}`} target="_blank" rel="noopener noreferrer">{t('explorer.openMempool')} ↗</a></dd>{/if}
        </dl>
      </section>

      <section class="card span6 table-wrap" style="padding: 14px 16px">
        <div class="label">{t('explorer.inputs')} · {fmtInt(tx.inputs.length)}</div>
        <table class="data" style="margin-top: 8px">
          <tbody>
            {#each tx.inputs as input, i (i)}
              <tr>
                <td>
                  {#if input.coinbase != null}
                    <span class="muted">{t('explorer.coinbase')}</span>
                  {:else}
                    <a class="hash" href={`${base}/tx/${input.txid}`} style="display: block">{shortHash(input.txid, 12, 8)}:{input.vout}</a>
                    {#if input.address}<a class="hash" href={`${base}/address/${input.address}`} style="display: block; color: var(--muted)">{input.address}</a>{/if}
                  {/if}
                </td>
                <td class="num mono" style="white-space: nowrap">{input.value != null ? fmtCoins(input.value, tx.chain) : ''}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </section>
      <section class="card span6 table-wrap" style="padding: 14px 16px">
        <div class="label">{t('explorer.outputs')} · {fmtInt(tx.outputs.length)}</div>
        <table class="data" style="margin-top: 8px">
          <tbody>
            {#each tx.outputs as output (output.n)}
              <tr>
                <td>
                  <span class="muted-2 mono" style="font-size: 11px">#{output.n}</span>
                  {#if output.address}<a class="hash" href={`${base}/address/${output.address}`} style="display: block">{output.address}</a>{:else}<span class="muted mono" style="font-size: 12px">{output.type ?? 'script'}</span>{/if}
                  {#if output.nameOp}<pre class="mono doi" style="margin: 4px 0 0; font-size: 11.5px; white-space: pre-wrap; overflow-wrap: anywhere">{pretty(output.nameOp)}</pre>{/if}
                </td>
                <td class="num mono" style="white-space: nowrap">{fmtCoins(output.value, tx.chain)}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </section>
    </div>
  {/if}
</main>
