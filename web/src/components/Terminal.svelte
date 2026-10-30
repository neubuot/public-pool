<script lang="ts">
  // Live-Terminal: Server-sent events des Pools als Protokollzeilen, pausierbar, hält die letzten 250 Zeilen.
  import { onMount } from 'svelte';

  import { subscribeEvents, type PoolEvent } from '../lib/api';
  import { fmtDifficulty, fmtInt, fmtTime, shortHash } from '../lib/format';
  import { t } from '../lib/i18n.svelte';

  interface Props {
    address?: string;
    height?: number;
  }
  let { address, height = 300 }: Props = $props();

  let lines = $state<{ id: number, text: string, kind: string }[]>([]);
  let paused = $state(false);
  let open = $state(false);
  let container: HTMLDivElement;
  let counter = 0;
  let pending: PoolEvent[] = [];

  function pad(text: string, width: number): string {
    return text.length >= width ? text : text + ' '.repeat(width - text.length);
  }

  function render(event: PoolEvent): { text: string, kind: string } {
    const time = fmtTime(event.t, true);
    const who = pad(event.worker ?? (event.chain ?? 'pool'), 10);
    const data = event.data ?? {};
    switch (event.type) {
      case 'share': {
        const hash = data.shareDifficulty != null ? `hash ${fmtDifficulty(data.shareDifficulty)}` : '';
        return { text: `${time}  ${who} ${pad(t('term.share'), 16)} diff ${pad(fmtDifficulty(data.difficulty), 9)} ${hash}`, kind: 'share' };
      }
      case 'block':
        return { text: `${time}  ${who} ${t('term.block')} ${event.chain} ${fmtInt(data.height)} ${data.accepted ? '✓' : '✗ ' + (data.message ?? '')} ${shortHash(data.hash, 10, 6)}`, kind: 'block' };
      case 'connect':
        return { text: `${time}  ${who} ${pad(t('term.connect'), 16)} ${data.userAgent ?? ''} ${data.mergedMining ? 'btc+doi' : 'btc'} diff ${fmtDifficulty(data.difficulty)}`, kind: 'connect' };
      case 'disconnect':
        return { text: `${time}  ${who} ${t('term.disconnect')}`, kind: 'disconnect' };
      case 'vardiff':
        return { text: `${time}  ${who} ${pad(t('term.vardiff'), 16)} ${fmtDifficulty(data.from)} -> ${fmtDifficulty(data.to)}`, kind: 'vardiff' };
      case 'tip':
        return { text: `${time}  ${pad(event.chain ?? 'chain', 10)} ${pad(t('term.tip'), 16)} ${fmtInt(data.height)} ${shortHash(data.hash, 10, 6)}`, kind: 'tip' };
      default:
        return { text: `${time}  ${who} ${event.type}`, kind: 'other' };
    }
  }

  function push(event: PoolEvent) {
    const rendered = render(event);
    lines.push({ id: ++counter, ...rendered });
    if (lines.length > 250) {
      lines.splice(0, lines.length - 250);
    }
  }

  function handle(event: PoolEvent) {
    if (paused) {
      pending.push(event);
      if (pending.length > 250) {
        pending.splice(0, pending.length - 250);
      }
      return;
    }
    push(event);
    queueMicrotask(() => {
      if (container != null) {
        container.scrollTop = container.scrollHeight;
      }
    });
  }

  function togglePause() {
    paused = !paused;
    if (!paused) {
      for (const event of pending) {
        push(event);
      }
      pending = [];
      queueMicrotask(() => {
        if (container != null) {
          container.scrollTop = container.scrollHeight;
        }
      });
    }
  }

  onMount(() => {
    let close = subscribeEvents(handle, address, state => { open = state; });
    return () => close();
  });
</script>

<div style="display: flex; align-items: center; gap: 12px">
  <div class="label">{t('pool.terminal')}</div>
  <span class="muted-2" style="font-size: 12px">{t('pool.terminalHint')}</span>
  <span class="dot" class:off={!open} style="margin-left: 4px" title={open ? 'live' : 'offline'}></span>
  <div style="margin-left: auto; display: flex; gap: 6px">
    {#if address == null}
      <span class="btn small ghost" style="cursor: default">{t('term.all')}</span>
    {/if}
    <button class="btn small" type="button" onclick={togglePause} aria-label={paused ? t('term.resume') : t('term.pause')}>
      {#if paused}
        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M6 4l14 8-14 8z"></path></svg>
      {:else}
        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg>
      {/if}
      {paused ? t('term.resume') : t('term.pause')}
    </button>
  </div>
</div>
<div class="term" bind:this={container} role="log" aria-label={t('pool.terminal')} style="margin-top: 12px; height: {height}px">
  {#if lines.length === 0}
    <span class="muted-2" style="white-space: normal">{t('term.empty')}</span>
  {/if}
  {#each lines as line (line.id)}
    <div class="line {line.kind}">{line.text}</div>
  {/each}
</div>

<style>
  .line.block { color: #FBBF24; font-weight: 600; }
  .line.connect { color: #38BDF8; }
  .line.disconnect { color: #6B7A8A; }
  .line.vardiff { color: #C7D2DC; }
  .line.tip { color: #9085E9; }
</style>
