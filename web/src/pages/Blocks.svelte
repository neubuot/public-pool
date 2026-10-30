<script lang="ts">
  // Gefundene Blöcke des Pools, beide Ketten.
  import { onMount } from 'svelte';

  import { api, type InfoResponse } from '../lib/api';
  import { fmtDate, fmtInt, shortHash } from '../lib/format';
  import { t } from '../lib/i18n.svelte';
  import { stats } from '../lib/stats.svelte';
  import ChainBadge from '../components/ChainBadge.svelte';
  import StatusBox from '../components/StatusBox.svelte';

  let info = $state<InfoResponse | null>(null);
  let error = $state<string | null>(null);
  let loading = $state(true);

  async function load() {
    try {
      info = await api.info();
      error = null;
    } catch (e: any) {
      error = e?.message ?? 'Fehler';
    } finally {
      loading = false;
    }
  }
  onMount(() => { void load(); });

  const accepted = (result: string | null) => result == null || /^(success!|accepted|null)$/i.test(result);
  const blocks = $derived([...(info?.blockData ?? [])].sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? '') || b.height - a.height));
</script>

<main class="page">
  <h1>{t('blocks.title')}</h1>
  <p class="muted" style="margin-top: 8px">{t('blocks.lead')}</p>

  <div style="margin-top: 20px">
    {#if info == null}
      <StatusBox loading={loading} error={error} onretry={load} />
    {:else if blocks.length === 0}
      <div class="card"><p class="muted">{t('blocks.none', { since: fmtDate(stats.data?.pool.since ?? info.uptime) })}</p></div>
    {:else}
      <div class="card table-wrap" style="padding: 8px 10px">
        <table class="data">
          <thead><tr><th>{t('blocks.chain')}</th><th class="num">{t('blocks.height')}</th><th>{t('blocks.hash')}</th><th>{t('blocks.worker')}</th><th>{t('blocks.miner')}</th><th>{t('blocks.result')}</th><th>{t('blocks.time')}</th><th></th></tr></thead>
          <tbody>
            {#each blocks as block (block.chain + block.height + (block.blockHash ?? '') + block.sessionId)}
              <tr>
                <td><ChainBadge chain={block.chain} /></td>
                <td class="num mono">{fmtInt(block.height)}</td>
                <td class="hash">{#if block.blockHash}<a href={`/explorer/${block.chain.toLowerCase()}/block/${block.blockHash}`}>{shortHash(block.blockHash, 12, 8)}</a>{:else}–{/if}</td>
                <td>{block.worker}</td>
                <td class="mono"><a href={`/d/${block.minerAddress}`}>{shortHash(block.minerAddress, 8, 6)}</a></td>
                <td class={accepted(block.result) ? 'green' : 'red'}>{accepted(block.result) ? t('blocks.accepted') : `${t('blocks.rejected')} (${block.result})`}</td>
                <td class="muted" style="white-space: nowrap">{block.createdAt ? fmtDate(block.createdAt) : '–'}</td>
                <td><a href={`/share/${block.chain.toLowerCase()}/${block.height}`}>{t('blocks.share')}</a></td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  </div>
</main>
