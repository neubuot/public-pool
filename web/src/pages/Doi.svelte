<script lang="ts">
  // Was mache ich mit DOI: Belohnung, Wallet, Explorer, Nutzen, Tauschen.
  import { walletsUrl } from '../lib/config';
  import { fmtCoins, fmtEur } from '../lib/format';
  import { t } from '../lib/i18n.svelte';
  import { stats } from '../lib/stats.svelte';

  const snapshot = $derived(stats.data);
  const subsidy = $derived(snapshot?.doichain.blockSubsidy ?? 12.5);
  const eur = $derived(snapshot?.prices?.doiEur != null ? subsidy * snapshot.prices.doiEur : null);
</script>

<main class="page">
  <h1>{t('doi.title')}</h1>
  <p class="muted" style="margin-top: 8px; max-width: 760px">{t('doi.intro')}</p>

  <div class="grid12" style="margin-top: 20px">
    <section class="card span6">
      <div class="label">{t('doi.reward')}</div>
      <div class="mono" style="font-size: 30px; font-weight: 600; margin-top: 8px"><span class="doi">{fmtCoins(subsidy, 'DOI', 1)}</span></div>
      <p class="text">{t('doi.rewardText', { reward: fmtCoins(subsidy, 'DOI', 1), eur: eur != null ? fmtEur(eur) : '–' })}</p>
    </section>

    <section class="card span6">
      <div class="label">{t('doi.wallet')}</div>
      <p class="text">{t('doi.walletText')}</p>
      <p style="margin-top: 10px"><a class="btn primary" href={walletsUrl} target="_blank" rel="noopener noreferrer">{t('doi.walletLink')}</a></p>
    </section>

    <section class="card span4">
      <div class="label">{t('doi.see')}</div>
      <p class="text">{t('doi.seeText')}</p>
      <p style="margin-top: 10px"><a class="btn" href="/explorer">{t('doi.seeLink')}</a></p>
    </section>

    <section class="card span4">
      <div class="label">{t('doi.use')}</div>
      <p class="text">{t('doi.useText')}</p>
      <p style="margin-top: 10px"><a class="btn" href="https://www.doilabs.org/" target="_blank" rel="noopener noreferrer">{t('doi.useLink')}</a></p>
    </section>

    <section class="card span4">
      <div class="label">{t('doi.trade')}</div>
      <p class="text">{t('doi.tradeText')}</p>
      <p style="margin-top: 10px"><a class="btn" href="https://community.doilabs.org/" target="_blank" rel="noopener noreferrer">{t('doi.tradeLink')}</a></p>
    </section>
  </div>
</main>

<style>
  .text { margin-top: 10px; font-size: 13.5px; color: var(--text-2); line-height: 1.55; }
</style>
