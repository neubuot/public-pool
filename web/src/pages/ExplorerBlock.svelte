<script lang="ts">
  import { onMount } from 'svelte';

  import { api, type BlockDetail, type Chain } from '../lib/api';
  import { mempoolSpace } from '../lib/config';
  import { fmtBytes, fmtCoins, fmtDate, fmtDifficulty, fmtInt, shortHash } from '../lib/format';
  import { t } from '../lib/i18n.svelte';
  import ChainBadge from '../components/ChainBadge.svelte';
  import CopyButton from '../components/CopyButton.svelte';
  import StatusBox from '../components/StatusBox.svelte';

  interface Props { chain: string; id: string; }
  let { chain, id }: Props = $props();

  const chainKey = $derived<Chain>(chain.toUpperCase() === 'DOI' ? 'DOI' : 'BTC');
  let block = $state<BlockDetail | null>(null);
  let error = $state<string | null>(null);
  let loading = $state(true);

  async function load() {
    loading = true;
    try {
      block = await api.block(chainKey, id);
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
  {#if block == null}
    <StatusBox loading={loading} error={error} onretry={load} />
  {:else}
    <div style="display: flex; align-items: center; gap: 12px; flex-wrap: wrap">
      <ChainBadge chain={block.chain} />
      <h1>{t('explorer.block')} {fmtInt(block.height)}</h1>
      {#if block.poolBlock}<span class="chip" style="border-color: #1F4D37; color: var(--green)">★ {t('explorer.poolBlock')}</span>{/if}
      {#if block.auxpow}<span class="chip">{t('explorer.auxpow')}</span>{/if}
      <span class="muted-2" style="margin-left: auto; font-size: 12px">{t('explorer.source', { source: block.source === 'node' ? t('explorer.sourceNode') : block.source })}</span>
    </div>
    <div style="display: flex; align-items: center; gap: 8px; margin-top: 6px"><span class="hash" style="font-size: 13px">{block.hash}</span><CopyButton text={block.hash} /></div>

    <div class="grid12" style="margin-top: 20px">
      <section class="card span6">
        <dl class="kv">
          <dt>{t('explorer.time')}</dt><dd class="mono">{fmtDate(block.time, true)}</dd>
          <dt>{t('explorer.txs')}</dt><dd class="mono">{fmtInt(block.txCount)}</dd>
          <dt>{t('explorer.size')}</dt><dd class="mono">{fmtBytes(block.size)}{#if block.weight} · {fmtInt(block.weight)} WU{/if}</dd>
          <dt>{t('explorer.confirmations')}</dt><dd class="mono">{block.confirmations != null ? fmtInt(block.confirmations) : '–'}</dd>
          <dt>{t('chain.difficulty')}</dt><dd class="mono">{fmtDifficulty(block.difficulty)}</dd>
          <dt>{t('explorer.bits')} / {t('explorer.nonce')}</dt><dd class="mono">{block.bits ?? '–'} / {block.nonce != null ? fmtInt(block.nonce) : '–'}</dd>
          <dt>{t('explorer.version')}</dt><dd class="mono">{block.version != null ? `0x${block.version.toString(16)}` : '–'}</dd>
          {#if block.minedTo}<dt>{t('explorer.minedTo')}</dt><dd><a class="mono" href={`${base}/address/${block.minedTo}`} style="color: var(--text)">{block.minedTo}</a></dd>{/if}
        </dl>
      </section>
      <section class="card span6">
        <dl class="kv">
          <dt>{t('explorer.previous')}</dt><dd>{#if block.previousBlockHash}<a class="hash" href={`${base}/block/${block.previousBlockHash}`} style="display: block">{block.previousBlockHash}</a>{:else}–{/if}</dd>
          <dt>{t('explorer.next')}</dt><dd>{#if block.nextBlockHash}<a class="hash" href={`${base}/block/${block.nextBlockHash}`} style="display: block">{block.nextBlockHash}</a>{:else}<a href={`${base}/block/${block.height + 1}`}>{fmtInt(block.height + 1)} →</a>{/if}</dd>
          <dt>{t('explorer.merkle')}</dt><dd class="hash">{block.merkleRoot ?? '–'}</dd>
          {#if block.auxpow}
            <dt>{t('explorer.parentBlock')}</dt>
            <dd>
              {#if block.auxpow.parentBlockHash}<a class="hash" href={`/explorer/btc/block/${block.auxpow.parentBlockHash}`} style="display: block">{block.auxpow.parentBlockHash}</a>{:else}–{/if}
              <div class="muted-2" style="font-size: 12px; margin-top: 2px">{t('explorer.auxpowHint')}</div>
            </dd>
          {/if}
          {#if chainKey === 'BTC'}
            <dt></dt><dd><a href={`${mempoolSpace}/block/${block.hash}`} target="_blank" rel="noopener noreferrer">{t('explorer.openMempool')} ↗</a></dd>
          {/if}
        </dl>
      </section>

      <section class="card span12 table-wrap" style="padding: 14px 16px">
        <div class="label">{t('explorer.txs')} · {t('explorer.txidsShown', { shown: fmtInt(block.txsShown), total: fmtInt(block.txCount) })}</div>
        {#if block.txs.length > 0}
          <table class="data" style="margin-top: 8px">
            <thead><tr><th>Txid</th><th class="num">{t('explorer.inputs')}</th><th class="num">{t('explorer.outputs')}</th><th class="num">{t('explorer.valueOut')}</th><th>{t('explorer.nameOp')}</th></tr></thead>
            <tbody>
              {#each block.txs as tx (tx.txid)}
                <tr>
                  <td class="hash"><a href={`${base}/tx/${tx.txid}`}>{shortHash(tx.txid, 16, 10)}</a>{#if tx.coinbase}<span class="muted-2" style="font-size: 11px"> coinbase</span>{/if}</td>
                  <td class="num mono">{fmtInt(tx.inputs)}</td>
                  <td class="num mono">{fmtInt(tx.outputs)}</td>
                  <td class="num mono">{fmtCoins(tx.valueOut, block.chain)}</td>
                  <td class="mono" style="font-size: 12px">{#each tx.nameOps as op, i (i)}<span class="doi">{String((op as any).op ?? 'name')}</span> {String((op as any).name ?? '')} {/each}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        {:else if block.txids.length > 0}
          <div style="margin-top: 8px; display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 4px 16px">
            {#each block.txids as txid (txid)}<a class="hash" href={`${base}/tx/${txid}`}>{txid}</a>{/each}
          </div>
        {:else}
          <p class="muted" style="margin-top: 8px; font-size: 13px">–</p>
        {/if}
      </section>
    </div>
  {/if}
</main>
