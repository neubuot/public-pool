<script lang="ts">
  // Startseite: Onboarding in drei Schritten nach dem Mockup.
  import { validate, getAddressInfo } from 'bitcoin-address-validation';
  import { onMount } from 'svelte';

  import { api, type AddressCheck, type MinerInfo } from '../lib/api';
  import { poolDomain, stratumPort, stratumUrl } from '../lib/config';
  import { fmtAgo, fmtHashrate, fmtPercent, shortHash } from '../lib/format';
  import { t } from '../lib/i18n.svelte';
  import { clock, remember, saved, stats } from '../lib/stats.svelte';
  import CopyButton from '../components/CopyButton.svelte';

  let btc = $state(saved.btcAddress);
  let doi = $state(saved.doiAddress);
  let worker = $state(saved.worker || 'bitaxe1');
  let btcOnly = $state(false);
  let device = $state<'bitaxe' | 'nerdminer' | 'cgminer' | 'braiins'>('bitaxe');

  let doiCheck = $state<{ address: string, result: AddressCheck | null, pending: boolean }>({ address: '', result: null, pending: false });
  let miner = $state<MinerInfo | null>(null);
  let minerError = $state<string | null>(null);

  const btcTrim = $derived(btc.trim());
  const btcValid = $derived(btcTrim.length > 0 && validate(btcTrim));
  const btcInfo = $derived(btcValid ? getAddressInfo(btcTrim) : null);
  const doiTrim = $derived(doi.trim());
  const doiValid = $derived(!btcOnly && doiCheck.address === doiTrim && doiCheck.result?.valid === true);
  const workerClean = $derived(worker.trim().replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32) || 'worker');
  const username = $derived(btcValid ? `${btcTrim}.${workerClean}` : '');
  const password = $derived(btcOnly ? 'x' : (doiValid ? doiTrim : ''));
  const ready = $derived(btcValid && (btcOnly || doiValid));
  const firstWorker = $derived(miner?.workers.find(w => w.online) ?? miner?.workers[0] ?? null);
  const arrived = $derived(firstWorker != null);

  let doiTimer: ReturnType<typeof setTimeout> | null = null;
  $effect(() => {
    const address = doiTrim;
    if (doiTimer != null) {
      clearTimeout(doiTimer);
    }
    if (address.length < 20 || btcOnly) {
      doiCheck = { address, result: null, pending: false };
      return;
    }
    doiCheck = { address, result: null, pending: true };
    doiTimer = setTimeout(async () => {
      try {
        const result = await api.validateDoi(address);
        if (doiTrim === address) {
          doiCheck = { address, result, pending: false };
          if (result.valid) {
            remember('doiAddress', address);
          }
        }
      } catch {
        if (doiTrim === address) {
          doiCheck = { address, result: null, pending: false };
        }
      }
    }, 350);
  });

  $effect(() => {
    if (btcValid) {
      remember('btcAddress', btcTrim);
    }
  });
  $effect(() => {
    remember('worker', workerClean);
  });

  async function pollMiner() {
    if (!btcValid) {
      miner = null;
      return;
    }
    try {
      miner = await api.miner(btcTrim);
      minerError = null;
    } catch (e: any) {
      minerError = e?.message ?? 'Fehler';
    }
  }

  onMount(() => {
    void pollMiner();
    const timer = setInterval(() => { if (document.visibilityState === 'visible') { void pollMiner(); } }, 10000);
    return () => clearInterval(timer);
  });
  $effect(() => {
    void btcTrim;
    void pollMiner();
  });

  const steps = $derived(
    device === 'bitaxe' ? ['home.bitaxe1', 'home.bitaxe2', 'home.bitaxe3']
    : device === 'nerdminer' ? ['home.nerd1', 'home.nerd2', 'home.nerd3']
    : device === 'cgminer' ? ['home.cg1', 'home.cg2', 'home.cg3']
    : ['home.br1', 'home.br2', 'home.br3']
  );
  const typeLabel = (type: string | null | undefined) => type == null ? '' : type.toUpperCase();
</script>

<main class="page" style="max-width: 1280px">
  <h1>{t('home.title')}</h1>
  <p class="muted" style="margin-top: 8px; max-width: 720px">{t('home.lead')}</p>

  <div class="cols">
    <div style="display: flex; flex-direction: column; gap: 20px; min-width: 0">
      <section class="card" aria-label={t('home.step1')}>
        <div class="step"><span class="num mono">1</span><strong>{t('home.step1')}</strong></div>
        <div class="fields">
          <div class="field">
            <label for="btc" class="label btc">{t('home.btcAddress')}</label>
            <input id="btc" class="input" class:valid={btcValid} class:invalid={btcTrim.length > 0 && !btcValid} bind:value={btc} placeholder="bc1q…" autocomplete="off" spellcheck="false">
            <span class="check" class:green={btcValid} class:red={btcTrim.length > 0 && !btcValid}>
              {#if btcValid}
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>
                {t('home.btcOk', { network: btcInfo?.network ?? '', type: typeLabel(btcInfo?.type) })}
              {:else if btcTrim.length > 0}
                {t('home.btcBad')}
              {:else}
                <span class="muted-2">{t('home.btcHint')}</span>
              {/if}
            </span>
          </div>
          <div class="field">
            <label for="doi" class="label doi">{t('home.doiAddress')}</label>
            <input id="doi" class="input" class:valid={doiValid} class:invalid={!btcOnly && doiTrim.length > 0 && !doiCheck.pending && !doiValid} bind:value={doi} placeholder="dc1q…" autocomplete="off" spellcheck="false" disabled={btcOnly}>
            <span class="check" class:green={doiValid} class:red={!btcOnly && doiTrim.length > 0 && !doiCheck.pending && !doiValid}>
              {#if btcOnly}
                <span class="muted-2">{t('home.btcOnlyPassword')}</span>
              {:else if doiCheck.pending}
                <span class="muted-2">{t('home.checking')}</span>
              {:else if doiValid}
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>
                {t('home.doiOk', { type: typeLabel(doiCheck.result?.type) })}
              {:else if doiTrim.length > 0}
                {t('home.doiBad')}
              {:else}
                <span class="muted-2">{t('home.doiHint')}</span>
              {/if}
            </span>
          </div>
        </div>
        <div style="display: flex; align-items: center; gap: 16px; margin-top: 14px; flex-wrap: wrap; font-size: 13px">
          <label style="display: inline-flex; align-items: center; gap: 8px; color: var(--text-2)"><input type="checkbox" bind:checked={btcOnly} style="width: 16px; height: 16px; accent-color: var(--accent)">{t('home.btcOnly')}</label>
          <a href="https://doichain.org" target="_blank" rel="noopener noreferrer" style="margin-left: auto">{t('home.noWallet')}</a>
        </div>
      </section>

      <section class="card" aria-label={t('home.step2')}>
        <div class="step"><span class="num mono">2</span><strong>{t('home.step2')}</strong><span class="muted-2" style="margin-left: auto; font-size: 12px">{t('home.generated')}</span></div>
        <div style="display: flex; flex-direction: column; gap: 8px; margin-top: 16px">
          <div class="row"><span class="label key">{t('home.stratumUrl')}</span><span class="mono val">{stratumUrl}</span><CopyButton text={stratumUrl} label={t('home.copy')} /></div>
          <div class="row"><span class="label key">{t('home.port')}</span><span class="mono val">{stratumPort}</span><CopyButton text={String(stratumPort)} label={t('home.copy')} /></div>
          <div class="row"><span class="label key">{t('home.user')}</span><span class="mono val">{#if username}{btcTrim}<span class="doi">.{workerClean}</span>{:else}<span class="muted-2">{t('home.fillFirst')}</span>{/if}</span><CopyButton text={username} label={t('home.copy')} disabled={!username} /></div>
          <div class="row"><span class="label key">{t('home.password')}</span><span class="mono val">{#if password}{password}{:else}<span class="muted-2">{doiTrim.length === 0 ? t('home.doiAddress') : t('home.doiBad')}</span>{/if}</span><CopyButton text={password} label={t('home.copy')} disabled={!password} /></div>
        </div>
        <div style="display: flex; align-items: center; gap: 10px; margin-top: 12px; font-size: 13px; color: var(--muted); flex-wrap: wrap">
          <label for="worker">{t('home.worker')}</label>
          <input id="worker" class="input" bind:value={worker} style="width: 160px; height: 34px; font-size: 13px" autocomplete="off" spellcheck="false">
          <span>{t('home.workerHint')}</span>
        </div>
        <div class="tabs" role="tablist" aria-label="Device">
          <button class="tab" class:active={device === 'bitaxe'} type="button" role="tab" aria-selected={device === 'bitaxe'} onclick={() => { device = 'bitaxe'; }}>{t('home.device.bitaxe')}</button>
          <button class="tab" class:active={device === 'nerdminer'} type="button" role="tab" aria-selected={device === 'nerdminer'} onclick={() => { device = 'nerdminer'; }}>{t('home.device.nerdminer')}</button>
          <button class="tab" class:active={device === 'cgminer'} type="button" role="tab" aria-selected={device === 'cgminer'} onclick={() => { device = 'cgminer'; }}>{t('home.device.cgminer')}</button>
          <button class="tab" class:active={device === 'braiins'} type="button" role="tab" aria-selected={device === 'braiins'} onclick={() => { device = 'braiins'; }}>{t('home.device.braiins')}</button>
        </div>
        <div class="howto">
          <ol>
            {#each steps as key (key)}<li>{t(key)}</li>{/each}
          </ol>
          <div class="schema" aria-label={t('home.schema')}>
            <div class="label" style="font-size: 10px">{device === 'bitaxe' ? 'AxeOS · Settings' : device === 'nerdminer' ? 'NerdMiner · Portal' : device === 'cgminer' ? 'cgminer · Pool 1' : 'Braiins OS · Pools'}</div>
            <div style="margin-top: 8px; display: flex; flex-direction: column; gap: 5px">
              <div><span>URL</span><span class="mono">{device === 'nerdminer' ? poolDomain : stratumUrl}</span></div>
              <div><span>Port</span><span class="mono">{stratumPort}</span></div>
              <div><span>User</span><span class="mono">{btcValid ? `${shortHash(btcTrim, 4, 3)}.${workerClean}` : 'bc1q….' + workerClean}</span></div>
              <div><span>Password</span><span class="mono">{password ? (btcOnly ? 'x' : shortHash(password, 4, 4)) : 'dc1q…'}</span></div>
            </div>
          </div>
        </div>
      </section>
    </div>

    <div style="display: flex; flex-direction: column; gap: 20px; min-width: 0">
      <section class="card" aria-label={t('home.step3')} style="border-color: {arrived ? '#1F4D37' : 'var(--border)'}">
        <div class="step"><span class="num mono" style="border-color: {arrived ? 'var(--green)' : 'var(--accent)'}; color: {arrived ? 'var(--green)' : 'var(--accent)'}">3</span><strong>{t('home.step3')}</strong></div>
        {#if arrived && firstWorker != null && miner != null}
          <div style="margin-top: 14px; display: flex; align-items: center; gap: 12px">
            <span class="dot" class:off={!firstWorker.online} style="width: 12px; height: 12px"></span>
            <div>
              <div style="font-weight: 600">{t('home.connected', { worker: firstWorker.name })}</div>
              <div class="muted" style="font-size: 12.5px">{firstWorker.userAgent ?? ''}</div>
              {#if stats.data != null && !stats.data.pool.jobsActive}
                <div class="warn" style="font-size: 12.5px; margin-top: 4px">{t('home.connectedWaiting', { percent: Math.round((stats.data.bitcoin.verificationProgress ?? 0) * 100) })}</div>
              {/if}
            </div>
          </div>
          <div class="tiles">
            <div class="card-inner"><div class="label">{t('home.hashrate')}</div><div class="mono big">{fmtHashrate(miner.hashRate)}</div></div>
            <div class="card-inner"><div class="label">{t('home.lastShare')}</div><div class="mono big">{t('chain.ago', { ago: fmtAgo(firstWorker.lastSeen, clock.now) })}</div></div>
            <div class="card-inner"><div class="label doi">{t('home.doiChance')}</div><div class="mono big">{fmtPercent(miner.odds.doichain.perYear, 0)}</div></div>
            <div class="card-inner"><div class="label btc">{t('home.btcChance')}</div><div class="mono big">{stats.data?.bitcoin?.syncing ? '–' : fmtPercent(miner.odds.bitcoin.perYear, 3)}</div></div>
          </div>
          <a href={`/d/${btcTrim}`} class="btn primary" style="margin-top: 16px; width: 100%; height: 44px">{t('home.toDashboard')}</a>
        {:else}
          <div style="margin-top: 14px; display: flex; align-items: center; gap: 12px">
            <span class="dot off pulse" style="width: 12px; height: 12px; background: var(--accent); box-shadow: 0 0 12px var(--accent)"></span>
            <div>
              <div style="font-weight: 600">{t('home.waiting')}</div>
              <div class="muted" style="font-size: 12.5px">{btcValid ? t('home.waitingHint') : t('home.waitingNoAddress')}</div>
            </div>
          </div>
          {#if minerError}<p class="red" style="font-size: 12px; margin-top: 10px">{minerError}</p>{/if}
          <a href={btcValid ? `/d/${btcTrim}` : '/pool'} class="btn" style="margin-top: 16px; width: 100%; height: 44px">{btcValid ? t('home.toDashboard') : t('nav.pool')}</a>
        {/if}
      </section>

      <section class="card" aria-label={t('home.then')}>
        <div class="label">{t('home.then')}</div>
        <ul class="then">
          <li><span class="ico"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M3 12h4l3-8 4 16 3-8h4"/></svg></span><span>{t('home.then1')}</span></li>
          <li><span class="ico"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" stroke-width="2" stroke-linecap="round" aria-hidden="true"><rect x="3" y="6" width="18" height="12" rx="2"/><path d="M3 10h18"/></svg></span><span>{t('home.then2')}</span></li>
          <li><span class="ico"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/></svg></span><span>{t('home.then3')}</span></li>
          <li><span class="ico"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></svg></span><span>{t('home.then4', { url: `${poolDomain}/d/${btcValid ? shortHash(btcTrim, 4, 3) : 'bc1q…'}` })}</span></li>
        </ul>
      </section>
    </div>
  </div>
</main>

<style>
  .cols { display: grid; grid-template-columns: minmax(0, 7fr) minmax(0, 5fr); gap: 20px; margin-top: 24px; }
  .step { display: flex; align-items: center; gap: 10px; }
  .num { width: 26px; height: 26px; border-radius: 50%; border: 1px solid var(--accent); color: var(--accent); display: grid; place-items: center; font-size: 12px; font-weight: 600; flex: none; }
  .fields { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; margin-top: 16px; }
  .field { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
  .check { font-size: 12px; display: inline-flex; align-items: center; gap: 6px; min-height: 16px; }
  .row { display: flex; align-items: center; gap: 10px; padding: 10px 12px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface-2); }
  .key { width: 118px; flex: none; }
  .val { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; }
  .tabs { margin-top: 18px; display: flex; gap: 4px; border-bottom: 1px solid var(--border); padding-bottom: 8px; flex-wrap: wrap; }
  .tab { height: 32px; padding: 0 12px; border-radius: 8px; border: 1px solid transparent; background: transparent; color: var(--muted); font-size: 12.5px; cursor: pointer; }
  .tab.active { color: var(--text); border-color: var(--border-3); background: var(--surface-3); }
  .howto { display: grid; grid-template-columns: minmax(0, 1fr) 220px; gap: 16px; margin-top: 14px; align-items: start; }
  .howto ol { margin: 0; padding-left: 18px; color: var(--text-2); font-size: 13px; display: flex; flex-direction: column; gap: 6px; }
  .schema { border: 1px solid var(--border); border-radius: 8px; background: var(--input); padding: 10px; font-size: 11px; color: var(--muted); }
  .schema div > div { display: flex; justify-content: space-between; gap: 8px; }
  .schema .mono { color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .tiles { margin-top: 14px; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
  .big { font-size: 20px; font-weight: 600; margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .then { list-style: none; margin: 12px 0 0; padding: 0; display: flex; flex-direction: column; gap: 12px; font-size: 13px; color: var(--text-2); }
  .then li { display: flex; gap: 10px; }
  .ico { width: 22px; height: 22px; border-radius: 6px; border: 1px solid var(--border-3); display: grid; place-items: center; flex: none; }
  @media (max-width: 980px) {
    .cols { grid-template-columns: 1fr; }
    .fields { grid-template-columns: 1fr; }
    .howto { grid-template-columns: 1fr; }
    .key { width: 96px; }
  }
</style>
