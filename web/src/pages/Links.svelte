<script lang="ts">
  // Videos & Anleitungen: Anleitungs-Videos groß oben, darunter Videos aus der Community und geschriebene Anleitungen.
  // Alles sind schlichte Links in einen neuen Tab: kein eingebetteter Player, kein Script und kein Bild von YouTube.
  // Die Einträge stehen in lib/links.ts.
  import { locale, t } from '../lib/i18n.svelte';
  import { channelHref, communityVideos, guideLinks, thumbSrc, tutorialVideos, type VideoLink } from '../lib/links';

  const contact = 'on@doichain.world';
  const empty = tutorialVideos.length === 0 && communityVideos.length === 0 && guideLinks.length === 0;
  const mailHref = $derived(`mailto:${contact}?subject=${encodeURIComponent(t('links.mailSubject'))}`);

  /** Datum ohne Uhrzeit; JJJJ-MM-TT gilt als Kalendertag, deshalb in UTC formatiert */
  function fmtDay(date: string): string {
    const ms = Date.parse(date);
    if (!Number.isFinite(ms)) {
      return date;
    }
    return new Intl.DateTimeFormat(locale(), { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(ms));
  }
</script>

{#snippet playIcon(size: number)}
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z"/></svg>
{/snippet}

{#snippet docIcon()}
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h6"/></svg>
{/snippet}

{#snippet meta(video: VideoLink)}
  {@const channel = channelHref(video)}
  <div class="meta">
    {#if channel}<a href={channel} target="_blank" rel="noopener noreferrer">{video.channel}</a>{:else}{video.channel}{/if}
    · <span class="mono" title={t('links.lang')}>{video.lang.toUpperCase()}</span>
    · <time datetime={video.date}>{fmtDay(video.date)}</time>
  </div>
{/snippet}

{#snippet invite(wide: boolean)}
  <section class="card invite" class:wide aria-labelledby="links-invite">
    <div class="invite-text">
      <h2 id="links-invite">{t('links.inviteTitle')}</h2>
      <p>{t('links.inviteText')}</p>
    </div>
    <a class="btn primary" href={mailHref}>
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg>
      {contact}
    </a>
  </section>
{/snippet}

<main class="page">
  <h1>{t('links.title')}</h1>
  <p class="muted" style="margin-top: 8px; max-width: 760px">{t('links.lead')}</p>

  {#if empty}
    <div class="grid12" style="margin-top: 20px">
      <section class="card span6 soon" aria-labelledby="links-soon">
        <div class="label">{t('links.soonLabel')}</div>
        <h2 id="links-soon">{t('links.soonTitle')}</h2>
        <p class="text">{t('links.soonText')}</p>
        <ul class="soon-list">
          <li><span class="ico doi">{@render playIcon(10)}</span><span>{t('links.soon1')}</span></li>
          <li><span class="ico muted">{@render playIcon(10)}</span><span>{t('links.soon2')}</span></li>
          <li><span class="ico">{@render docIcon()}</span><span>{t('links.soon3')}</span></li>
        </ul>
      </section>
      <div class="span6" style="display: flex; flex-direction: column">
        {@render invite(false)}
      </div>
    </div>
  {:else}
    {#if tutorialVideos.length > 0}
      <section aria-labelledby="links-tutorials" style="margin-top: 24px">
        <div class="section-head">
          <h2 id="links-tutorials">{t('links.tutorials')}</h2>
          <span class="muted" style="font-size: 13px">{t('links.tutorialsHint')}</span>
        </div>
        <div class="tutorials">
          {#each tutorialVideos as video (video.url)}
            {@const src = thumbSrc(video)}
            <article class="card tut">
              <a class="thumb" href={video.url} target="_blank" rel="noopener noreferrer" tabindex="-1" aria-hidden="true">
                {#if src}
                  <img src={src} alt="" loading="lazy" width="640" height="360">
                {:else}
                  <span class="play">{@render playIcon(26)}</span>
                {/if}
              </a>
              <div class="tut-body">
                <span class="label doi">{t('links.tutorialBadge')}</span>
                <h3><a href={video.url} target="_blank" rel="noopener noreferrer">{video.title} <span class="ext" aria-hidden="true">↗</span></a></h3>
                {@render meta(video)}
              </div>
            </article>
          {/each}
        </div>
      </section>
    {/if}

    <div class="grid12" style="margin-top: 20px">
      <section class="card span6" aria-labelledby="links-community">
        <h2 class="label" id="links-community">{t('links.community')}</h2>
        {#if communityVideos.length === 0}
          <p class="muted none">{t('links.communityNone')}</p>
        {:else}
          <ul class="list">
            {#each communityVideos as video (video.url)}
              <li>
                <span class="ico muted">{@render playIcon(10)}</span>
                <div class="item">
                  <a class="title" href={video.url} target="_blank" rel="noopener noreferrer">{video.title} <span class="ext" aria-hidden="true">↗</span></a>
                  {@render meta(video)}
                </div>
              </li>
            {/each}
          </ul>
        {/if}
      </section>

      <section class="card span6" aria-labelledby="links-guides">
        <h2 class="label" id="links-guides">{t('links.guides')}</h2>
        {#if guideLinks.length === 0}
          <p class="muted none">{t('links.guidesNone')}</p>
        {:else}
          <ul class="list">
            {#each guideLinks as guide (guide.url)}
              <li>
                <span class="ico">{@render docIcon()}</span>
                <div class="item">
                  <a class="title" href={guide.url} target="_blank" rel="noopener noreferrer">{guide.title} <span class="ext" aria-hidden="true">↗</span></a>
                  <div class="meta">{guide.source} · <span class="mono" title={t('links.lang')}>{guide.lang.toUpperCase()}</span></div>
                </div>
              </li>
            {/each}
          </ul>
        {/if}
      </section>
    </div>

    {@render invite(true)}
  {/if}

  <p class="muted-2 privacy">{t('links.privacy')}</p>
</main>

<style>
  h2 { line-height: 1.3; }
  .text { font-size: 13.5px; color: var(--text-2); line-height: 1.55; }
  .soon { display: flex; flex-direction: column; gap: 10px; }
  .soon-list { list-style: none; margin: 4px 0 0; padding: 0; display: flex; flex-direction: column; gap: 10px; font-size: 13px; color: var(--text-2); }
  .soon-list li { display: flex; gap: 10px; align-items: center; }
  .ico { width: 22px; height: 22px; border-radius: 6px; border: 1px solid var(--border-3); display: grid; place-items: center; flex: none; }

  .invite {
    flex: 1;
    display: flex; flex-direction: column; justify-content: center; gap: 16px;
    border-color: #1E5A7A;
    background: linear-gradient(180deg, rgba(56, 189, 248, 0.08), rgba(56, 189, 248, 0) 75%), var(--surface);
  }
  .invite h2 { font-size: 19px; }
  .invite p { margin-top: 8px; font-size: 13.5px; color: var(--text-2); line-height: 1.55; }
  .invite .btn { align-self: flex-start; height: 40px; padding: 0 16px; }
  .invite.wide { margin-top: 20px; flex-direction: row; align-items: center; gap: 24px; }
  .invite.wide .invite-text { flex: 1; min-width: 0; }
  .invite.wide .btn { align-self: center; }

  .section-head { display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap; }
  .tutorials { margin-top: 14px; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 20px; }
  .tut { padding: 0; overflow: hidden; display: flex; flex-direction: column; }
  .thumb {
    display: grid; place-items: center; aspect-ratio: 16 / 9;
    background: radial-gradient(circle at 50% 45%, #14324A, var(--surface-2) 70%);
    border-bottom: 1px solid var(--border);
  }
  .thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .play {
    width: 68px; height: 68px; border-radius: 50%; border: 2px solid var(--accent); color: var(--accent);
    display: grid; place-items: center; padding-left: 4px; background: rgba(56, 189, 248, 0.08);
    transition: background .15s;
  }
  .thumb:hover .play { background: rgba(56, 189, 248, 0.18); }
  .tut-body { padding: 16px 20px 18px; display: flex; flex-direction: column; gap: 6px; }
  .tut h3 { font-size: 18px; line-height: 1.3; }
  .tut h3 a { color: var(--text); }
  .tut h3 a:hover { color: var(--accent); }

  .list { list-style: none; margin: 12px 0 0; padding: 0; display: flex; flex-direction: column; }
  .list li { display: flex; gap: 12px; align-items: flex-start; padding: 10px 0; border-top: 1px solid var(--border); }
  .list li:first-child { border-top: none; padding-top: 2px; }
  .item { min-width: 0; display: flex; flex-direction: column; gap: 2px; }
  .title { color: var(--text); font-weight: 600; font-size: 13.5px; overflow-wrap: anywhere; }
  .title:hover { color: var(--accent); }
  .ext { color: var(--muted-2); font-weight: 400; font-size: .85em; }
  .meta { font-size: 12.5px; color: var(--muted); }
  .meta a { color: var(--text-2); }
  .meta a:hover { color: var(--text); }
  .none { margin-top: 12px; font-size: 13px; }
  .privacy { margin-top: 18px; font-size: 12px; max-width: 760px; line-height: 1.5; }

  @media (max-width: 980px) {
    .tutorials { grid-template-columns: 1fr; }
    .invite.wide { flex-direction: column; align-items: stretch; }
    .invite.wide .btn, .invite .btn { align-self: stretch; }
  }
</style>
