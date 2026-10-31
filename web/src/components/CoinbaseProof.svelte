<script lang="ts">
  // Nachweis: die Coinbase-Transaktion, die der Pool für diese Adresse in die aktuelle Blockvorlage setzt.
  import { onMount } from 'svelte';

  import { api, type CoinbaseProof } from '../lib/api';
  import { fmtCoins, fmtDuration, fmtHashrate, fmtInt, shortHash } from '../lib/format';
  import { t } from '../lib/i18n.svelte';
  import CopyButton from '../components/CopyButton.svelte';

  interface Props { address: string; }
  let { address }: Props = $props();

  let proof = $state<CoinbaseProof | null>(null);
  let error = $state<string | null>(null);
  let loading = $state(false);

  async function load() {
    loading = true;
    try {
      proof = await api.coinbase(address);
      error = null;
    } catch (e: any) {
      error = e?.message ?? 'Fehler';
    } finally {
      loading = false;
    }
  }

  function kindLabel(kind: string): string {
    return t(`proof.kind.${kind}`);
  }

  onMount(() => { void load(); });
</script>

<section class="card span12" aria-label={t('proof.title')}>
  <div style="display: flex; align-items: center; gap: 12px; flex-wrap: wrap">
    <div class="label">{t('proof.title')}</div>
    <button class="btn small ghost" type="button" style="margin-left: auto" onclick={() => void load()} disabled={loading}>{t('proof.reload')}</button>
  </div>
  <p class="text">{t('proof.intro')}</p>

  {#if proof == null}
    <p class="muted" style="margin-top: 10px; font-size: 13px">{error ?? t('proof.loading')}</p>
  {:else}
    <p class="text mono" style="font-size: 12.5px">{t('proof.template', { height: fmtInt(proof.template.height), age: fmtDuration(proof.template.ageMs / 1000), txs: fmtInt(proof.template.transactions), reward: fmtCoins(proof.template.coinbaseValue / 1e8, 'BTC', 8) })}</p>

    <div class="label" style="margin-top: 12px">{t('proof.outputs')}</div>
    <table class="outputs">
      <tbody>
        {#each proof.outputs as out (out.index)}
          <tr class:yours={out.yours}>
            <td class="mono muted-2">#{out.index}</td>
            <td class="mono addr">{out.address ?? '—'}</td>
            <td class="mono amount">{fmtCoins(out.value / 1e8, 'BTC', 8)}</td>
            <td class="kind">{#if out.yours}✅ {/if}{kindLabel(out.kind)}</td>
          </tr>
        {/each}
      </tbody>
    </table>
    <p class="text">
      {#if proof.fee.address == null}{t('proof.feeNone')}
      {:else}{t('proof.feeInfo', { percent: 1.5, threshold: fmtHashrate(proof.fee.thresholdHashRate), address: shortHash(proof.fee.address, 8, 6), applied: proof.fee.percent > 0 ? t('proof.feeApplied') : t('proof.feeNotApplied') })}{/if}
    </p>

    <div class="label" style="margin-top: 12px">{t('proof.doichain')}</div>
    <p class="text">
      {#if proof.doichain.block != null}
        {t('proof.doiBlock', { address: shortHash(proof.doichain.address ?? '', 8, 6), height: fmtInt(proof.doichain.block.height), reward: fmtCoins(proof.doichain.block.coinbaseValue / 1e8, 'DOI', 2) })}
        {#if !proof.auxTag} <span class="warn">{t('proof.auxTagMissing')}</span>{/if}
      {:else if proof.doichain.error}
        {t('proof.doiError', { error: proof.doichain.error })}
      {:else}
        {t('proof.doiNone')}
      {/if}
    </p>

    <details style="margin-top: 12px">
      <summary class="label" style="cursor: pointer">{t('proof.raw')}</summary>
      <p class="text">{t('proof.rawHint')}</p>
      <div style="display: flex; gap: 8px; align-items: center; margin-top: 8px; flex-wrap: wrap">
        <CopyButton text={proof.coinbaseHex} label={t('proof.copyHex')} small={false} />
        <span class="muted-2" style="font-size: 12px">{fmtInt(proof.coinbaseHex.length / 2)} Bytes · {fmtInt(proof.merkleBranches)} Merkle-Branches</span>
      </div>
      <pre class="mono raw">{proof.coinbaseHex}</pre>
      <div class="label" style="margin-top: 10px">coinb1</div>
      <pre class="mono raw">{proof.coinb1}</pre>
      <div class="label" style="margin-top: 10px">coinb2</div>
      <pre class="mono raw">{proof.coinb2}</pre>
    </details>
  {/if}
</section>

<style>
  .text { margin-top: 10px; font-size: 13px; color: var(--text-2); line-height: 1.5; max-width: 900px; }
  .outputs { width: 100%; border-collapse: collapse; margin-top: 8px; font-size: 12.5px; }
  .outputs td { padding: 6px 8px 6px 0; border-top: 1px solid var(--border); vertical-align: top; }
  .outputs tr.yours td { color: var(--text); }
  .outputs .addr { overflow-wrap: anywhere; }
  .outputs .amount { white-space: nowrap; text-align: right; }
  .outputs .kind { white-space: nowrap; color: var(--text-2); }
  .warn { color: var(--red); }
  .raw { margin: 8px 0 0; padding: 10px 12px; border: 1px solid var(--border); border-radius: var(--radius-s); background: var(--input); font-size: 11.5px; line-height: 1.5; overflow-wrap: anywhere; white-space: pre-wrap; color: var(--text-2); }
</style>
