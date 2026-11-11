// Rubrik „Videos & Anleitungen“ (/links): YouTube-Videos kooperierender Kanäle, Anleitungs-Videos zum Pool und
// geschriebene Anleitungen. Kein Backend: Einträge hier pflegen, committen und das Web-Image neu bauen.
//
// Beispiel-Eintrag für `videos` (Anleitungs-Videos mit `tutorial: true` stehen groß ganz oben auf der Seite,
// alle anderen unter „Videos aus der Community“):
//
//   {
//     title: 'NerdPool mit dem Bitaxe einrichten',
//     channel: 'Beispielkanal',
//     channelUrl: 'https://www.youtube.com/@beispielkanal',
//     url: 'https://www.youtube.com/watch?v=XXXXXXXXXXX',
//     lang: 'de',
//     tutorial: true,
//     thumb: 'beispielkanal-bitaxe.jpg',
//     date: '2026-11-20',
//   },
//
// Beispiel-Eintrag für `guides`:
//
//   { title: 'Bitaxe im NerdPool: Schritt für Schritt', url: 'https://example.org/anleitung', lang: 'de', source: 'Beispielblog' },
//
// Vorschaubild: nie direkt von i.ytimg.com oder einem anderen fremden Server einbinden. Die Seite soll außer bei bewusst
// geklickten Links keine Dritten aufrufen. Stattdessen das Bild einmal herunterladen (bei YouTube etwa
// https://i.ytimg.com/vi/<Video-ID>/hqdefault.jpg, am besten mit Zustimmung des Kanals), auf 640×360 verkleinern,
// als JPG, PNG, WebP oder AVIF unter web/public/links/ ablegen (Ordner beim ersten Bild anlegen) und bei `thumb` nur den
// Dateinamen eintragen. Alles andere als ein schlichter Dateiname wird ignoriert. Ohne Bild zeigt die Seite eine
// Karte mit Play-Symbol.

export interface VideoLink {
    title: string;
    /** Name des Kanals */
    channel: string;
    channelUrl: string;
    url: string;
    /** Sprachkürzel des Videos, etwa 'de' oder 'en' */
    lang: string;
    /** Anleitungs-Video zum Pool: erscheint groß ganz oben */
    tutorial?: boolean;
    /** Dateiname eines Vorschaubilds in web/public/links/ */
    thumb?: string;
    /** Veröffentlichung, JJJJ-MM-TT */
    date: string;
}

export interface GuideLink {
    title: string;
    url: string;
    /** Sprachkürzel der Anleitung, etwa 'de' oder 'en' */
    lang: string;
    /** Seite oder Autor */
    source: string;
}

export const videos: VideoLink[] = [];

export const guides: GuideLink[] = [];

const isWebUrl = (url: string) => /^https?:\/\//i.test(url);
const newestFirst = (a: VideoLink, b: VideoLink) => b.date.localeCompare(a.date);

/** Anleitungs-Videos zum Pool, neueste zuerst */
export const tutorialVideos: VideoLink[] = videos.filter(v => v.tutorial === true && isWebUrl(v.url)).sort(newestFirst);
/** alle übrigen Videos, neueste zuerst */
export const communityVideos: VideoLink[] = videos.filter(v => v.tutorial !== true && isWebUrl(v.url)).sort(newestFirst);
export const guideLinks: GuideLink[] = guides.filter(g => isWebUrl(g.url));

/** Vorschaubild nur als lokale Datei aus web/public/links/, eine fremde Adresse ergibt null. */
export function thumbSrc(video: VideoLink): string | null {
    const name = video.thumb ?? '';
    return /^[A-Za-z0-9][A-Za-z0-9._-]*\.(jpe?g|png|webp|avif)$/i.test(name) ? `/links/${name}` : null;
}

/** Link auf die Seite des Kanals, nur wenn es eine Web-Adresse ist */
export function channelHref(video: VideoLink): string | null {
    return isWebUrl(video.channelUrl) ? video.channelUrl : null;
}
