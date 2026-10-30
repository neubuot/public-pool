<script lang="ts">
  interface Props {
    chain: string;
    size?: 'small' | 'normal';
  }
  let { chain, size = 'normal' }: Props = $props();
  const color = $derived(chain === 'DOI' ? 'var(--doi)' : chain === 'BTC' ? 'var(--btc)' : 'var(--muted)');
</script>

<span class="label" style="color: {color}; letter-spacing: 0.08em; font-size: {size === 'small' ? '10px' : '11px'}">{chain}</span>
