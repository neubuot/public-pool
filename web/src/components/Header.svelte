<script lang="ts">
  import { validate } from 'bitcoin-address-validation';

  import { poolDomain } from '../lib/config';
  import { fmtHashrate, fmtInt, shortHash } from '../lib/format';
  import { lang, setLang, t } from '../lib/i18n.svelte';
  import { navigate, route } from '../lib/router.svelte';
  import { remember, saved, stats } from '../lib/stats.svelte';

  let menuOpen = $state(false);
  let addressOpen = $state(false);
  let addressInput = $state('');

  const data = $derived(stats.data);
  const connected = $derived(stats.error == null && data != null);
  const syncing = $derived(data?.bitcoin?.syncing === true);

  function isActive(path: string): boolean {
    return path === '/' ? route.path === '/' : route.path.startsWith(path);
  }

  function openMine() {
    if (saved.btcAddress.length > 0 && validate(saved.btcAddress)) {
      navigate(`/d/${saved.btcAddress}`);
      menuOpen = false;
      return;
    }
    addressInput = saved.btcAddress;
    addressOpen = true;
  }

  function submitAddress(event: Event) {
    event.preventDefault();
    const address = addressInput.trim();
    if (!validate(address)) {
      return;
    }
    remember('btcAddress', address);
    addressOpen = false;
    menuOpen = false;
    navigate(`/d/${address}`);
  }
</script>

<header>
  <a href="/" class="brand" aria-label="NerdPool Start">
    <span class="logo">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12h4l3-8 4 16 3-8h4"></path></svg>
    </span>
    <span class="name">NERDPOOL</span>
    <span class="mono domain hidenarrow">{poolDomain}</span>
    <span class="beta">{t('common.beta')}</span>
  </a>

  <div class="chips hidenarrow">
    {#if connected}
      <span class="chip"><span class="dot"></span>{t('status.connected')}{#if stats.latencyMs != null}&nbsp;· {stats.latencyMs} ms{/if}</span>
    {:else if stats.error != null}
      <span class="chip"><span class="dot red"></span>{t('status.offline')}</span>
    {:else}
      <span class="chip"><span class="dot off pulse"></span>{t('status.connecting')}</span>
    {/if}
    {#if data != null}
      {#if syncing}
        <span class="chip" title={t('chain.syncing')}><span class="label btc" style="letter-spacing: .08em">BTC</span><span class="mono">{t('status.syncing', { percent: Math.round((data.bitcoin.verificationProgress ?? 0) * 100) })}</span></span>
      {:else}
        <span class="chip"><span class="label btc" style="letter-spacing: .08em">BTC</span><span class="mono">{fmtInt(data.bitcoin.blocks)}</span></span>
      {/if}
      <span class="chip"><span class="label doi" style="letter-spacing: .08em">DOI</span><span class="mono">{fmtInt(data.doichain.blocks)}</span></span>
      <span class="chip"><span class="mono">{fmtInt(data.pool.miners)}</span> {t('status.minersOnline')}</span>
      <span class="chip">{t('status.pool')} <span class="mono">{fmtHashrate(data.pool.hashRate)}</span></span>
    {/if}
  </div>

  <button class="btn ghost burger" type="button" aria-label="Menu" aria-expanded={menuOpen} onclick={() => { menuOpen = !menuOpen; }}>
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"></path></svg>
  </button>

  <nav class:open={menuOpen}>
    <a href="/" class:active={isActive('/')} onclick={() => { menuOpen = false; }}>{t('nav.start')}</a>
    <a href="/pool" class:active={isActive('/pool')} onclick={() => { menuOpen = false; }}>{t('nav.pool')}</a>
    <a href="/blocks" class:active={isActive('/blocks')} onclick={() => { menuOpen = false; }}>{t('nav.blocks')}</a>
    <a href="/explorer" class:active={isActive('/explorer')} onclick={() => { menuOpen = false; }}>{t('nav.explorer')}</a>
    <button class="btn mono" type="button" onclick={openMine} style="font-size: 12.5px">
      {#if saved.btcAddress.length > 0 && validate(saved.btcAddress)}
        {shortHash(saved.btcAddress, 6, 5)}
      {:else}
        {t('nav.mine')}
      {/if}
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="8" r="4"></circle><path d="M4 21a8 8 0 0 1 16 0"></path></svg>
    </button>
    <button class="btn ghost small" type="button" onclick={() => setLang(lang.current === 'de' ? 'en' : 'de')} aria-label={t('nav.lang')}>{t('nav.lang')}</button>
  </nav>
</header>

{#if addressOpen}
  <div class="modal-bg" role="presentation" onclick={event => { if (event.target === event.currentTarget) { addressOpen = false; } }} onkeydown={event => { if (event.key === 'Escape') { addressOpen = false; } }}>
    <form class="card modal" onsubmit={submitAddress} aria-label={t('nav.myAddress')}>
      <label for="my-address" class="label">{t('nav.myAddress')}</label>
      <!-- svelte-ignore a11y_autofocus -->
      <input id="my-address" class="input" bind:value={addressInput} placeholder="bc1q…" autofocus autocomplete="off" spellcheck="false" style="margin-top: 8px">
      <div style="display: flex; gap: 8px; margin-top: 12px; justify-content: flex-end">
        <button class="btn" type="button" onclick={() => { addressOpen = false; }}>✕</button>
        <button class="btn primary" type="submit" disabled={!validate(addressInput.trim())}>{t('nav.open')}</button>
      </div>
    </form>
  </div>
{/if}

<style>
  header {
    display: flex;
    align-items: center;
    gap: 20px;
    flex-wrap: wrap;
    padding: 12px 32px;
    min-height: 64px;
    border-bottom: 1px solid var(--border);
    background: var(--surface-2);
    position: relative;
  }
  .brand { display: flex; align-items: center; gap: 12px; color: var(--text); }
  .logo {
    width: 30px; height: 30px; border: 2px solid var(--accent); border-radius: 8px;
    display: grid; place-items: center; flex: none;
  }
  .name { font-weight: 700; letter-spacing: .14em; font-size: 15px; }
  .domain { color: var(--muted-2); font-size: 12.5px; }
  .beta {
    font-size: 10px; letter-spacing: .12em; text-transform: uppercase; color: var(--accent);
    border: 1px solid var(--accent); border-radius: 999px; padding: 1px 7px; opacity: .85;
  }
  .chips { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  nav { margin-left: auto; display: flex; align-items: center; gap: 14px; font-size: 13px; }
  nav a { color: var(--muted); padding: 6px 2px; border-bottom: 2px solid transparent; }
  nav a:hover { color: var(--text); }
  nav a.active { color: var(--text); border-bottom-color: var(--accent); }
  .burger { display: none; margin-left: auto; }
  .modal-bg { position: fixed; inset: 0; background: rgba(5, 8, 11, .7); display: grid; place-items: center; z-index: 50; padding: 16px; }
  .modal { width: min(520px, 100%); }
  @media (max-width: 980px) {
    header { padding: 10px 16px; gap: 12px; }
    .burger { display: inline-flex; }
    nav { display: none; width: 100%; flex-direction: column; align-items: stretch; gap: 6px; padding-top: 8px; border-top: 1px solid var(--border); }
    nav.open { display: flex; }
    nav a { padding: 10px 4px; }
  }
</style>
