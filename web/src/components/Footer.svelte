<script lang="ts">
  import { repoUrl, walletsUrl } from '../lib/config';
  import { t } from '../lib/i18n.svelte';
</script>

<footer>
  <div class="links">
    <span>{t('footer.beta')}</span>
    <a href="/impressum">{t('footer.imprint')}</a>
    <a href="/datenschutz">{t('footer.privacy')}</a>
    <a href="/nutzungsbedingungen">{t('footer.terms')}</a>
    <a href={walletsUrl} target="_blank" rel="noopener noreferrer">{t('footer.wallets')}</a>
    <a href={repoUrl} target="_blank" rel="noopener noreferrer">{t('footer.source')}</a>
  </div>
  <p class="muted-2" style="font-size: 12px; margin-top: 6px">{t('footer.basedOn')}</p>
</footer>

<style>
  footer { text-align: center; padding: 20px 16px 26px; color: var(--muted); font-size: 12.5px; border-top: 1px solid var(--border); margin-top: 24px; }
  .links { display: flex; gap: 14px; justify-content: center; flex-wrap: wrap; }
  .links a { color: var(--muted); }
  .links a:hover { color: var(--text); }
</style>
