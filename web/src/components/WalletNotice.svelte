<script lang="ts">
  // Hinweis, dass die geschürften DOI nur mit einem eigenen Doichain-Wallet verwaltet werden können,
  // mit Link auf die Download-Seite des Doichain Hub. `compact` ist die einzeilige Form für Statistikseiten.
  import { walletsUrl } from '../lib/config';
  import { t } from '../lib/i18n.svelte';

  let { compact = false }: { compact?: boolean } = $props();
</script>

{#if compact}
  <div class="notice compact" role="note">
    <span class="ico" aria-hidden="true">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18M16 15h2"/></svg>
    </span>
    <span class="text">{t('wallet.compact')}</span>
    <a class="btn small" href={walletsUrl} target="_blank" rel="noopener noreferrer">{t('wallet.compactLink')}</a>
  </div>
{:else}
  <section class="notice" aria-label={t('wallet.title')}>
    <span class="ico big" aria-hidden="true">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18M16 15h2"/></svg>
    </span>
    <div class="body">
      <div class="title">{t('wallet.title')}</div>
      <p>{t('wallet.text')}</p>
      <p class="muted">{t('wallet.list')}</p>
      <div class="actions">
        <a class="btn primary" href={walletsUrl} target="_blank" rel="noopener noreferrer">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v11m0 0 4-4m-4 4-4-4M4 19h16"/></svg>
          {t('wallet.download')}
        </a>
        <span class="url mono">doilabs.org/downloads</span>
      </div>
    </div>
  </section>
{/if}

<style>
  .notice {
    display: flex;
    gap: 16px;
    align-items: flex-start;
    border: 1px solid #1E5A7A;
    border-radius: var(--radius);
    background: linear-gradient(135deg, rgba(56, 189, 248, 0.14), rgba(56, 189, 248, 0.04));
    padding: 18px 20px;
    min-width: 0;
  }
  .notice.compact {
    align-items: center;
    gap: 12px;
    padding: 10px 14px;
    border-radius: var(--radius-s);
    flex-wrap: wrap;
  }
  .ico {
    width: 30px;
    height: 30px;
    border-radius: 8px;
    border: 1px solid #1E5A7A;
    background: rgba(56, 189, 248, 0.12);
    color: var(--accent);
    display: grid;
    place-items: center;
    flex: none;
  }
  .ico.big { width: 44px; height: 44px; border-radius: 10px; }
  .body { min-width: 0; flex: 1; }
  .title { font-weight: 600; font-size: 16px; color: var(--text); }
  .body p { margin: 6px 0 0; font-size: 13.5px; color: var(--text-2); line-height: 1.5; }
  .body p.muted { color: var(--muted); font-size: 12.5px; }
  .actions { display: flex; align-items: center; gap: 12px; margin-top: 12px; flex-wrap: wrap; }
  .actions .btn { gap: 8px; height: 38px; padding: 0 16px; }
  .url { font-size: 12px; color: var(--muted); }
  .text { font-size: 13px; color: var(--text-2); flex: 1; min-width: 200px; }
</style>
