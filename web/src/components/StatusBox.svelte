<script lang="ts">
  // Lade- und Fehlerzustand für Seiten.
  import { t } from '../lib/i18n.svelte';

  interface Props {
    loading: boolean;
    error: string | null;
    onretry?: () => void;
  }
  let { loading, error, onretry }: Props = $props();
</script>

{#if loading}
  <div class="card" style="display: flex; align-items: center; gap: 10px"><span class="dot off pulse"></span><span class="muted">{t('common.loading')}</span></div>
{:else if error != null}
  <div class="card" style="border-color: #4a2626">
    <div class="red">{t('common.error', { message: error })}</div>
    {#if onretry}<button class="btn small" type="button" style="margin-top: 10px" onclick={onretry}>{t('common.retry')}</button>{/if}
  </div>
{/if}
