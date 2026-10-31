<script lang="ts">
  // Benachrichtigungen einer Adresse: Telegram-Hinweis und Webhooks (ntfy, Discord, JSON) verwalten.
  import { onMount } from 'svelte';

  import { api, type WebhookKind, type WebhookList } from '../lib/api';
  import { fmtDate } from '../lib/format';
  import { t } from '../lib/i18n.svelte';

  interface Props { address: string; telegramBot: string | null; }
  let { address, telegramBot }: Props = $props();

  let hooks = $state<WebhookList | null>(null);
  let url = $state('');
  let kind = $state<WebhookKind>('ntfy');
  let busy = $state(false);
  let message = $state<{ ok: boolean; text: string } | null>(null);

  const placeholders: Record<WebhookKind, string> = {
    ntfy: 'https://ntfy.sh/mein-thema',
    discord: 'https://discord.com/api/webhooks/…',
    json: 'https://…/api/webhook/…',
  };

  async function load() {
    try {
      hooks = await api.webhooks(address);
    } catch {
      hooks = { address, max: 3, webhooks: [] };
    }
  }

  async function add() {
    busy = true;
    message = null;
    try {
      hooks = await api.addWebhook(address, url.trim(), kind);
      url = '';
      message = { ok: true, text: t('notify.added') };
    } catch (e: any) {
      message = { ok: false, text: e?.message ?? 'Fehler' };
    } finally {
      busy = false;
    }
  }

  async function test() {
    busy = true;
    message = null;
    try {
      const result = await api.testWebhook(address, url.trim(), kind);
      message = result.ok ? { ok: true, text: t('notify.testOk') } : { ok: false, text: t('notify.testFailed', { error: result.error ?? '?' }) };
    } catch (e: any) {
      message = { ok: false, text: e?.message ?? 'Fehler' };
    } finally {
      busy = false;
    }
  }

  async function remove(id: number) {
    busy = true;
    message = null;
    try {
      hooks = await api.removeWebhook(address, id);
    } catch (e: any) {
      message = { ok: false, text: e?.message ?? 'Fehler' };
    } finally {
      busy = false;
    }
  }

  onMount(() => { void load(); });
</script>

<section class="card span12" aria-label={t('notify.title')}>
  <div class="label">{t('notify.title')}</div>
  {#if telegramBot}
    <p style="margin-top: 10px; font-size: 13px; color: var(--text-2)">
      <a href={`https://t.me/${telegramBot}`} target="_blank" rel="noopener noreferrer" style="color: var(--accent)">{t('miner.telegram', { bot: telegramBot })}</a>
    </p>
  {/if}
  <p style="margin-top: 10px; font-size: 13px; color: var(--text-2)">{t('notify.intro')} <a href="/integrations">{t('notify.docs')}</a></p>

  {#if hooks != null && hooks.webhooks.length > 0}
    <ul class="hooks">
      {#each hooks.webhooks as hook (hook.id)}
        <li>
          <span class="mono kind">{hook.kind}</span>
          <span class="mono url" title={hook.url}>{hook.url}</span>
          <span class="muted-2 state">
            {#if !hook.enabled}{t('notify.disabled', { failures: hook.failures })}
            {:else if hook.lastError}{t('notify.lastError', { error: hook.lastError })}
            {:else if hook.lastDeliveredAt}{t('notify.delivered', { time: fmtDate(hook.lastDeliveredAt) })}
            {:else}{t('notify.waiting')}{/if}
          </span>
          <button class="btn small ghost" type="button" onclick={() => void remove(hook.id)} disabled={busy}>{t('notify.remove')}</button>
        </li>
      {/each}
    </ul>
  {:else if hooks != null}
    <p class="muted" style="margin-top: 10px; font-size: 13px">{t('notify.none')}</p>
  {/if}

  {#if hooks == null || hooks.webhooks.length < hooks.max}
    <form class="form" onsubmit={(event) => { event.preventDefault(); void add(); }}>
      <select class="input kind-select" bind:value={kind} aria-label={t('notify.kind')}>
        <option value="ntfy">ntfy</option>
        <option value="discord">Discord</option>
        <option value="json">{t('notify.kindJson')}</option>
      </select>
      <input class="input url-input" type="url" bind:value={url} placeholder={placeholders[kind]} required maxlength="512" aria-label="URL" />
      <button class="btn" type="button" onclick={() => void test()} disabled={busy || url.trim().length === 0}>{t('notify.test')}</button>
      <button class="btn primary" type="submit" disabled={busy || url.trim().length === 0}>{t('notify.add')}</button>
    </form>
  {:else}
    <p class="muted" style="margin-top: 10px; font-size: 13px">{t('notify.max', { max: hooks.max })}</p>
  {/if}

  {#if message}
    <p style="margin-top: 8px; font-size: 13px; color: {message.ok ? '#4ADE80' : 'var(--red)'}">{message.text}</p>
  {/if}
  <p class="muted-2" style="margin-top: 10px; font-size: 12px">{t('notify.public')}</p>
</section>

<style>
  .hooks { list-style: none; margin: 12px 0 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
  .hooks li { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; font-size: 13px; }
  .kind { color: var(--accent); width: 60px; flex: none; }
  .url { color: var(--text-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 100%; }
  .state { font-size: 12px; flex: 1 1 200px; }
  .form { display: flex; gap: 8px; margin-top: 12px; flex-wrap: wrap; align-items: center; }
  .form .input { height: 38px; }
  .kind-select { width: 170px; flex: none; }
  .url-input { flex: 1 1 260px; width: auto; }
</style>
