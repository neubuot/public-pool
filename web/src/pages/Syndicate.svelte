<script lang="ts">
  // Syndikat-Modus: Erklärung, Mitmachen, Live-Zahlen, Verteilung des nächsten Blocks und die gefundenen Syndikat-Blöcke.
  import { onMount } from 'svelte';

  import { api, type SyndicateDetail } from '../lib/api';
  import { fmtAgo, fmtCoins, fmtDate, fmtDuration, fmtHashrate, fmtInt, fmtPercent, shortHash } from '../lib/format';
  import { t } from '../lib/i18n.svelte';
  import { clock, saved, stats } from '../lib/stats.svelte';
  import CopyButton from '../components/CopyButton.svelte';
  import StatusBox from '../components/StatusBox.svelte';

  let detail = $state<SyndicateDetail | null>(null);
  let error = $state<string | null>(null);
  let loading = $state(true);

  async function load() {
    try {
      detail = await api.syndicate();
      error = null;
    } catch (e: any) {
      error = e?.message ?? 'Fehler';
    } finally {
      loading = false;
    }
  }

  onMount(() => {
    void load();
    const timer = setInterval(() => { if (document.visibilityState === 'visible') { void load(); } }, 30000);
    return () => clearInterval(timer);
  });

  const snapshot = $derived(stats.data);
  const difficulty = $derived(snapshot?.doichain.difficulty ?? null);
  const subsidy = $derived(snapshot?.doichain.blockSubsidy ?? 12.5);
  const TWO_POW_32 = 4294967296;
  /** erwartete Sekunden bis zum nächsten Block bei dieser Hashrate */
  function expectedSeconds(hashRate: number | null): number | null {
    if (hashRate == null || difficulty == null || hashRate <= 0 || difficulty <= 0) {
      return null;
    }
    return difficulty * TWO_POW_32 / hashRate;
  }
  function perYear(seconds: number | null): number | null {
    return seconds == null ? null : 1 - Math.exp(-(365.25 * 86400) / seconds);
  }
  const expected = $derived(expectedSeconds(detail?.hashRate ?? null));
  const gammaCount = 100;
  const gammaHashRate = 1.2e12;
  const exampleSeconds = $derived(expectedSeconds(gammaCount * gammaHashRate));
  const myDoi = $derived(saved.doiAddress.trim());
  const password = $derived(myDoi.length > 0 ? `${myDoi},syndicate` : '');
  const mine = $derived(detail?.members.find(m => m.address === myDoi) ?? null);
  const maxWork = $derived(Math.max(1, ...(detail?.members.map(m => m.work) ?? [1])));
</script>

<main class="page">
  <h1>{t('syn.title')}</h1>
  <p class="muted" style="margin-top: 8px; max-width: 760px">{t('syn.lead')}</p>

  {#if detail == null}
    <div style="margin-top: 20px"><StatusBox loading={loading} error={error} onretry={load} /></div>
  {:else if !detail.enabled}
    <div class="card" style="margin-top: 20px"><p class="muted">{t('syn.off')}</p></div>
  {:else}
    <div class="grid12" style="margin-top: 20px">

      <section class="card span12 tiles" aria-label={t('syn.members')}>
        <div>
          <div class="label">{t('syn.members')}</div>
          <div class="mono val">{fmtInt(detail.members.length)}</div>
          <div class="muted" style="font-size: 12px">{t('syn.membersHint', { hours: detail.windowHours })} · {t('syn.devices', { n: fmtInt(detail.devicesOnline) })}</div>
        </div>
        <div>
          <div class="label">{t('syn.hashrate')}</div>
          <div class="mono val">{fmtHashrate(detail.hashRate)}</div>
          <div class="muted" style="font-size: 12px">{snapshot?.pool.hashRate ? fmtPercent(detail.hashRate / snapshot.pool.hashRate, 0) : '–'} {t('syn.ofPool')}</div>
        </div>
        <div>
          <div class="label doi">{t('syn.expected')}</div>
          <div class="mono val">{expected != null ? t('pool.every', { duration: fmtDuration(expected) }) : '–'}</div>
          <div class="muted" style="font-size: 12px">{expected != null ? t('syn.perYear', { p: fmtPercent(perYear(expected), 0) }) : t('syn.expectedHint')}</div>
        </div>
        <div>
          <div class="label">{t('syn.blocks')}</div>
          <div class="mono val">{fmtInt(detail.blocksFound)}</div>
          <div class="muted" style="font-size: 12px">{detail.blocksFound > 0 ? t('syn.paidOut', { amount: fmtCoins(detail.paidOutDoi, 'DOI', 2), n: fmtInt(detail.membersPaid) }) : t('syn.noBlocksShort')}</div>
        </div>
      </section>

      <section class="card span7" aria-label={t('syn.how')}>
        <div class="label">{t('syn.how')}</div>
        <ol class="how">
          <li>{t('syn.how1')}</li>
          <li>{t('syn.how2', { hours: detail.windowHours })}</li>
          <li>{t('syn.how3', { min: detail.minPayoutDoi, max: fmtInt(detail.maxMembers) })}</li>
          <li>{t('syn.how4')}</li>
          <li>{t('syn.how5', { hours: detail.windowHours })}</li>
        </ol>
        <p class="muted" style="font-size: 12.5px; margin-top: 12px; line-height: 1.5">
          {t('syn.example', { n: gammaCount, duration: exampleSeconds != null ? fmtDuration(exampleSeconds) : '–', amount: fmtCoins(subsidy / gammaCount, 'DOI', 3) })}
        </p>
      </section>

      <section class="card span5" aria-label={t('syn.password')} style="display: flex; flex-direction: column; gap: 12px">
        <div class="label">{t('syn.password')}</div>
        <div class="row"><span class="label key">{t('home.password')}</span><span class="mono val-row">{#if password}{myDoi}<span class="doi">,syndicate</span>{:else}<span class="muted-2">dc1q…<span class="doi">,syndicate</span></span>{/if}</span><CopyButton text={password} label={t('home.copy')} disabled={!password} /></div>
        <p class="muted" style="font-size: 12.5px; line-height: 1.5; margin: 0">{t('syn.passwordHint')}</p>
        <a href="/" class="btn primary" style="width: 100%; height: 40px">{t('syn.toHome')}</a>
        {#if mine != null}
          <div class="card-inner" style="border-color: #1E5A7A">
            <div class="label doi">{t('syn.yourShare')}</div>
            <div class="mono" style="font-size: 24px; font-weight: 600; margin-top: 4px">{fmtPercent(mine.percent, 2)}</div>
            <div class="muted" style="font-size: 12px">{mine.amountDoi != null ? `≈ ${fmtCoins(mine.amountDoi, 'DOI', 4)}` : ''} · {fmtInt(mine.shares)} {t('miner.sharesLabel')}</div>
          </div>
        {/if}
      </section>

      <section class="card span7" aria-label={t('syn.distribution')}>
        <div style="display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap">
          <div class="label">{t('syn.distribution')}</div>
          {#if detail.current}<span class="muted-2" style="font-size: 12px">{t('syn.currentHint', { height: fmtInt(detail.current.height), members: fmtInt(detail.current.members), reward: fmtCoins(detail.current.coinbaseValueDoi, 'DOI', 2), ago: fmtAgo(detail.current.builtAt, clock.now) })}</span>{/if}
        </div>
        <p class="muted" style="font-size: 12.5px; margin-top: 6px">{t('syn.distributionHint')}</p>
        {#if detail.members.length === 0}
          <p class="muted" style="margin-top: 12px; font-size: 13px">{t('syn.noMembers')}</p>
        {:else}
          <div class="dist">
            {#each detail.members.slice(0, 25) as member (member.address)}
              <div class:mine={member.address === myDoi}>
                <div class="line">
                  <a class="mono addr" href={`/explorer/doi/address/${member.address}`} title={member.address}>{shortHash(member.address, 10, 6)}</a>
                  <span class="mono muted" style="white-space: nowrap">{fmtPercent(member.percent, 2)}{#if member.amountDoi != null} · {fmtCoins(member.amountDoi, 'DOI', 4)}{/if}</span>
                </div>
                <div class="bar" style="margin-top: 4px"><span style="width: {Math.max(1, member.work / maxWork * 100)}%"></span></div>
              </div>
            {/each}
            {#if detail.members.length > 25}<p class="muted-2" style="font-size: 12px">{t('syn.others', { n: fmtInt(detail.members.length - 25) })}</p>{/if}
          </div>
        {/if}
      </section>

      <section class="card span5" aria-label={t('syn.history')} style="display: flex; flex-direction: column; gap: 10px">
        <div class="label">{t('syn.history')}</div>
        {#if detail.blocks.length === 0}
          <p class="muted" style="font-size: 13px">{t('syn.noBlocks')}</p>
        {:else}
          {#each detail.blocks as block (block.blockHash)}
            <article class="card-inner" style="border-color: {block.accepted ? 'var(--doi)' : 'var(--red)'}">
              <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap">
                <span class="label doi">DOI</span>
                <a class="mono" style="font-weight: 600" href={`/explorer/doi/block/${block.blockHash}`}>{t('explorer.block')} {fmtInt(block.height)}</a>
                {#if !block.accepted}<span class="red" style="font-size: 12px">{t('blocks.rejected')}</span>{/if}
                <span class="muted-2" style="margin-left: auto; font-size: 12px">{fmtDate(block.time)}</span>
              </div>
              <div class="mono" style="font-size: 18px; font-weight: 600; margin-top: 4px">+{fmtCoins(block.totalDoi, 'DOI', 2)} <span class="muted" style="font-size: 12.5px; font-weight: 400">· {t('syn.sharedAmong', { n: fmtInt(block.members) })}</span></div>
              <div class="muted" style="font-size: 12px; margin-top: 2px">{t('syn.foundBy', { worker: block.finderWorker || '?' })} · <a href={`/share/doi/${block.height}`}>{t('blocks.share')}</a></div>
            </article>
          {/each}
        {/if}
      </section>
    </div>
  {/if}
</main>

<style>
  .tiles { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 20px; }
  .val { font-size: 22px; font-weight: 600; margin-top: 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .how { margin: 12px 0 0; padding-left: 20px; color: var(--text-2); font-size: 13px; line-height: 1.55; display: flex; flex-direction: column; gap: 8px; }
  .row { display: flex; align-items: center; gap: 10px; padding: 10px 12px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface-2); }
  .key { width: 80px; flex: none; }
  .val-row { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; }
  .dist { margin-top: 12px; display: flex; flex-direction: column; gap: 10px; }
  .dist .line { display: flex; justify-content: space-between; gap: 10px; font-size: 13px; }
  .dist .addr { color: var(--text-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .dist .mine .addr { color: var(--doi); }
  :global(.span7) { grid-column: span 7; }
  :global(.span5) { grid-column: span 5; }
  @media (max-width: 980px) {
    .tiles { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    :global(.span7), :global(.span5) { grid-column: span 12; }
  }
</style>
