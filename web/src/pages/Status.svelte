<script lang="ts">
  // Status & Betrieb: Live-Zustand, Verfügbarkeit aus den Messpunkten, Finanzierung.
  import { onMount } from 'svelte';

  import { api, ApiError, type Health, type History } from '../lib/api';
  import { availability, type Availability } from '../lib/availability';
  import { repoUrl } from '../lib/config';
  import { fmtDate, fmtDuration, fmtInt, fmtNum } from '../lib/format';
  import { t } from '../lib/i18n.svelte';
  import { stats } from '../lib/stats.svelte';

  const DAY = 24 * 60 * 60 * 1000;
  let health = $state<Health | null>(null);
  let healthError = $state<string | null>(null);
  let week = $state<History | null>(null);
  let month = $state<History | null>(null);

  const snapshot = $derived(stats.data);
  const day = $derived(week != null ? availability(week.pool, DAY, week.bucketMs) : null);
  const sevenDays = $derived(week != null ? availability(week.pool, 7 * DAY, week.bucketMs) : null);
  const thirtyDays = $derived(month != null ? availability(month.pool, 30 * DAY, month.bucketMs) : null);

  function node(chain: 'bitcoin' | 'doichain') {
    const info = health?.[chain];
    if (info == null) {
      return null;
    }
    if (info.enabled === false) {
      return { ok: false, text: t('status.nodeOff') };
    }
    if (!info.reachable) {
      return { ok: false, text: t('status.nodeDown') };
    }
    if (info.syncing) {
      return { ok: false, text: t('status.nodeSyncing') };
    }
    const behind = info.behind ?? 0;
    const heights = t('status.nodeOk', { height: fmtInt(info.blocks), publicHeight: info.publicHeight != null ? fmtInt(info.publicHeight) : '–' });
    return { ok: behind <= 1, text: behind > 1 ? `${heights} · ${t('status.nodeBehind', { behind: fmtInt(behind) })}` : heights };
  }

  function percent(value: Availability | null): string {
    return value == null ? '–' : `${fmtNum(value.percent, value.percent >= 99.95 ? 2 : 1)} %`;
  }

  async function load() {
    try {
      health = await api.health();
      healthError = null;
    } catch (e: any) {
      health = null;
      healthError = e instanceof ApiError ? e.message : (e?.message ?? 'Fehler');
    }
    const [w, m] = await Promise.all([api.history('7d').catch(() => null), api.history('30d').catch(() => null)]);
    week = w;
    month = m;
  }

  onMount(() => {
    void load();
    const timer = setInterval(() => { if (document.visibilityState === 'visible') { void load(); } }, 60000);
    return () => clearInterval(timer);
  });
</script>

<main class="page">
  <h1>{t('status.title')}</h1>
  <p class="muted" style="margin-top: 8px; max-width: 760px">{t('status.intro')}</p>

  <div class="grid12" style="margin-top: 20px">
    <section class="card span12" aria-label={t('status.live')}>
      <div class="label">{t('status.live')}{#if health} · {fmtDate(health.time, true)}{/if}</div>
      {#if healthError != null}
        <p class="muted" style="margin-top: 10px; font-size: 13px"><span class="dot warn"></span> {healthError}</p>
      {/if}
      <div class="tiles">
        <div class="tile">
          <span class="dot" class:off={!(health?.ok ?? false)}></span>
          <div><div class="tile-title">{t('status.poolTile')}</div><div class="tile-text">{#if health}{t('status.poolOk', { since: fmtDate(health.pool.since) })} · {t('status.miners', { miners: fmtInt(health.pool.miners) })}{:else}…{/if}</div></div>
        </div>
        <div class="tile">
          <span class="dot" class:off={!(snapshot?.pool.jobsActive ?? false)}></span>
          <div><div class="tile-title">{t('status.jobs')}</div><div class="tile-text">{snapshot == null ? '…' : snapshot.pool.jobsActive ? t('status.jobsOk') : t('status.jobsNo')}</div></div>
        </div>
        {#each [['bitcoin', 'Bitcoin'], ['doichain', 'Doichain']] as [key, name] (key)}
          {@const info = node(key as 'bitcoin' | 'doichain')}
          <div class="tile">
            <span class="dot" class:off={!(info?.ok ?? false)}></span>
            <div><div class="tile-title">{t('status.node', { chain: name })}</div><div class="tile-text">{info?.text ?? '…'}</div></div>
          </div>
        {/each}
      </div>
    </section>

    <section class="card span12" aria-label={t('status.availability')}>
      <div class="label">{t('status.availability')}</div>
      <div class="tiles">
        <div class="tile"><div><div class="tile-title">24 h</div><div class="mono big">{percent(day)}</div></div></div>
        <div class="tile"><div><div class="tile-title">7 d</div><div class="mono big">{percent(sevenDays)}</div></div></div>
        <div class="tile"><div><div class="tile-title">30 d</div><div class="mono big">{percent(thirtyDays)}</div>{#if thirtyDays}<div class="muted-2" style="font-size: 12px">{t('status.since', { since: fmtDate(thirtyDays.since) })}</div>{/if}</div></div>
      </div>
      <p class="muted" style="margin-top: 12px; font-size: 12.5px; max-width: 820px">{t('status.availabilityHint')}</p>
      <div class="label" style="margin-top: 14px">{t('status.outages')}</div>
      {#if sevenDays == null}
        <p class="muted" style="margin-top: 8px; font-size: 13px">…</p>
      {:else if sevenDays.outages.length === 0}
        <p class="muted" style="margin-top: 8px; font-size: 13px">{t('status.outagesNone')}</p>
      {:else}
        <ul class="outages mono">
          {#each sevenDays.outages as outage (outage.from)}
            <li>{t('status.outage', { from: fmtDate(outage.from), to: fmtDate(outage.to), duration: fmtDuration((outage.to - outage.from) / 1000) })}</li>
          {/each}
        </ul>
      {/if}
    </section>

    <section class="card span12" aria-label={t('status.funding')}>
      <div class="label">{t('status.funding')}</div>
      <p class="text">{t('status.fundingText1', { fee: fmtNum(snapshot?.pool.feePercent ?? 0, 1) })}</p>
      <p class="text">{t('status.fundingText2')}</p>
      <p class="text">{t('status.fundingText3')} <a href={repoUrl} target="_blank" rel="noopener noreferrer">{t('footer.source')}</a></p>
    </section>
  </div>
</main>

<style>
  .tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; margin-top: 12px; }
  .tile { display: flex; gap: 10px; align-items: flex-start; border: 1px solid var(--border); border-radius: var(--radius-s); padding: 12px 14px; background: var(--surface-2, transparent); }
  .tile .dot { margin-top: 5px; flex: none; }
  .tile-title { font-size: 12.5px; color: var(--muted); letter-spacing: .06em; text-transform: uppercase; }
  .tile-text { font-size: 13px; color: var(--text-2); margin-top: 4px; }
  .big { font-size: 26px; font-weight: 600; margin-top: 4px; }
  .text { margin-top: 10px; font-size: 13.5px; color: var(--text-2); max-width: 820px; line-height: 1.55; }
  .outages { margin: 8px 0 0; padding: 0; list-style: none; font-size: 12.5px; color: var(--text-2); display: flex; flex-direction: column; gap: 4px; }
</style>
