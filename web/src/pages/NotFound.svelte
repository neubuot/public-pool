<script lang="ts">
  import { t } from '../lib/i18n.svelte';
</script>

<main class="page">
  <div class="card">
    <h2>{t('common.notFound')}</h2>
    <p class="muted" style="margin-top: 8px"><a href="/">{t('nav.start')}</a> · <a href="/pool">{t('nav.pool')}</a> · <a href="/explorer">{t('nav.explorer')}</a></p>
  </div>
</main>
