<script lang="ts">
  // Integrationen: Benachrichtigungen (Telegram, Webhooks), Home Assistant und die JSON-Schnittstelle.
  import { poolDomain } from '../lib/config';
  import { t } from '../lib/i18n.svelte';

  const base = `https://${poolDomain}`;

  const restYaml = `# configuration.yaml
rest:
  - resource: ${base}/api/miner/YOUR_BTC_ADDRESS
    scan_interval: 60
    sensor:
      - name: "NerdPool hashrate"
        unique_id: nerdpool_hashrate
        value_template: "{{ (value_json.hashRate / 1e12) | round(2) }}"
        unit_of_measurement: "TH/s"
      - name: "NerdPool workers online"
        unique_id: nerdpool_workers_online
        value_template: "{{ value_json.workersOnline }}"
      - name: "NerdPool best share"
        unique_id: nerdpool_best_share
        value_template: "{{ value_json.bestDifficulty | round(0) }}"
      - name: "NerdPool Doichain block chance per year"
        unique_id: nerdpool_doi_chance_year
        value_template: "{{ ((value_json.odds.doichain.perYear or 0) * 100) | round(1) }}"
        unit_of_measurement: "%"
    binary_sensor:
      - name: "NerdPool bitaxe1 online"
        unique_id: nerdpool_bitaxe1_online
        device_class: connectivity
        value_template: "{{ value_json.workers | selectattr('name', 'eq', 'bitaxe1') | map(attribute='online') | first | default(false) }}"`;

  const webhookYaml = `# automations.yaml  (dashboard: webhook of kind "JSON", URL https://<your-home-assistant>/api/webhook/nerdpool)
- alias: NerdPool worker offline
  trigger:
    - platform: webhook
      webhook_id: nerdpool
      allowed_methods: [POST]
      local_only: false
  condition:
    - condition: template
      value_template: "{{ trigger.json.event in ['worker.offline', 'worker.online', 'block.found', 'share.record'] }}"
  action:
    - service: notify.notify
      data:
        title: "{{ trigger.json.title }}"
        message: "{{ trigger.json.text }}"`;

  const eventJson = `{
  "event": "worker.offline",
  "address": "bc1q…",
  "title": "Worker bitaxe1 offline",
  "text": "🔌 bitaxe1 (BitAxe) is offline, nothing from the device for 12 min.",
  "url": "${base}/d/bc1q…",
  "data": { "worker": "bitaxe1", "userAgent": "BitAxe", "kind": "offline", "lastSeen": "2026-10-31T20:00:00.000Z", "awayMs": null },
  "time": "2026-10-31T20:12:00.000Z"
}`;
</script>

<main class="page">
  <h1>{t('integ.title')}</h1>
  <p class="muted" style="margin-top: 8px; max-width: 760px">{t('integ.intro')}</p>

  <div class="grid12" style="margin-top: 20px">
    <section class="card span12">
      <div class="label">{t('integ.notifyTitle')}</div>
      <p class="text">{t('integ.notifyText')}</p>
      <p class="text">{t('integ.events')}</p>
      <div class="label" style="margin-top: 14px">{t('integ.jsonTitle')}</div>
      <pre class="mono code">{eventJson}</pre>
    </section>

    <section class="card span12">
      <div class="label">{t('integ.haTitle')}</div>
      <p class="text">{t('integ.haRest')}</p>
      <pre class="mono code">{restYaml}</pre>
      <p class="text" style="margin-top: 14px">{t('integ.haWebhook')}</p>
      <pre class="mono code">{webhookYaml}</pre>
    </section>

    <section class="card span12">
      <div class="label">{t('integ.apiTitle')}</div>
      <p class="text">{t('integ.apiText')}</p>
      <ul class="api">
        <li><a href={`${base}/api/miner/YOUR_BTC_ADDRESS`} rel="external" class="mono">/api/miner/&lt;BTC&gt;</a> {t('integ.apiMiner')}</li>
        <li><span class="mono">/api/miner/&lt;BTC&gt;/worker/&lt;name&gt;</span> {t('integ.apiWorker')}</li>
        <li><a href={`${base}/api/stats`} rel="external" class="mono">/api/stats</a> {t('integ.apiStats')}</li>
        <li><span class="mono">/api/stats/events?address=&lt;BTC&gt;</span> {t('integ.apiEvents')}</li>
        <li><span class="mono">/api/share/best/&lt;BTC&gt;</span> {t('integ.apiShare')}</li>
      </ul>
      <p class="text">{t('integ.apiLimits')}</p>
    </section>
  </div>
</main>

<style>
  .text { margin-top: 10px; font-size: 13.5px; color: var(--text-2); max-width: 820px; line-height: 1.55; }
  .code { margin-top: 10px; padding: 12px 14px; border: 1px solid var(--border); border-radius: var(--radius-s); background: var(--input); font-size: 12.5px; line-height: 1.5; overflow-x: auto; white-space: pre; color: var(--text); }
  .api { margin: 10px 0 0; padding-left: 18px; font-size: 13.5px; color: var(--text-2); display: flex; flex-direction: column; gap: 6px; }
  .api .mono { color: var(--accent); }
</style>
