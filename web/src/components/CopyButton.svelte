<script lang="ts">
  import { t } from '../lib/i18n.svelte';

  interface Props {
    text: string;
    label?: string;
    small?: boolean;
    disabled?: boolean;
    ariaLabel?: string;
  }
  let { text, label = '', small = true, disabled = false, ariaLabel = '' }: Props = $props();

  let copied = $state(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const area = document.createElement('textarea');
      area.value = text;
      document.body.appendChild(area);
      area.select();
      document.execCommand('copy');
      area.remove();
    }
    copied = true;
    setTimeout(() => { copied = false; }, 1600);
  }
</script>

<button class="btn" class:small={small} type="button" onclick={copy} disabled={disabled} aria-label={ariaLabel || label || t('home.copy')} style={copied ? 'border-color: #1F4D37; color: var(--green)' : ''}>
  {#if copied}
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>
    {label ? t('home.copied') : ''}
  {:else}
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="9" y="9" width="12" height="12" rx="2"></rect><path d="M5 15V5a2 2 0 0 1 2-2h10"></path></svg>
    {label}
  {/if}
</button>
