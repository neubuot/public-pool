import { BadRequestException, Controller, Get, NotFoundException, Param, Req, Res } from '@nestjs/common';
import { FastifyReply, FastifyRequest } from 'fastify';

import { fmtDifficultyDe, fmtPercentDe, ShareImageService } from '../../services/share-image.service';
import { percentOfTarget } from '../../utils/record-alerts';

const ADDRESS_RE = /^[A-Za-z0-9]{20,90}$/;

function addressOf(value: string): string {
    if (!ADDRESS_RE.test(value ?? '')) {
        throw new BadRequestException('Keine Adresse');
    }
    return value;
}

function chainOf(value: string): 'BTC' | 'DOI' {
    const upper = (value ?? '').toUpperCase();
    if (upper !== 'BTC' && upper !== 'DOI') {
        throw new BadRequestException('Kette muss btc oder doi sein');
    }
    return upper;
}

function heightOf(value: string): number {
    const height = parseInt(value, 10);
    if (!/^\d{1,9}$/.test(value ?? '') || !Number.isFinite(height)) {
        throw new BadRequestException('Höhe muss eine Zahl sein');
    }
    return height;
}

function escapeHtml(text: string): string {
    return text.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/**
 * Share card of a found block: the PNG under /api/share/<chain>/<height> and a small page with Open Graph
 * tags under /api/s/<chain>/<height>, which Caddy also serves as /s/<chain>/<height> so chats show a preview.
 */
@Controller()
export class ShareController {

    constructor(private readonly shareImageService: ShareImageService) { }

    /** The best share of an address as PNG (the record card), 404 while the address has no share. */
    @Get('share/best/:address')
    public async bestImage(@Param('address') addressParam: string, @Req() request: FastifyRequest, @Res() reply: FastifyReply) {
        const address = addressOf(addressParam);
        const png = await this.shareImageService.renderBest(address, request.hostname);
        if (png == null) {
            throw new NotFoundException('Für diese Adresse gibt es noch keinen Share');
        }
        reply
            .header('Content-Type', 'image/png')
            .header('Cache-Control', 'public, max-age=300')
            .header('Content-Disposition', 'inline; filename="nerdpool-best-share.png"')
            .send(png);
    }

    @Get('s/best/:address')
    public async bestPage(@Param('address') addressParam: string, @Req() request: FastifyRequest, @Res() reply: FastifyReply) {
        const address = addressOf(addressParam);
        const data = await this.shareImageService.bestData(address, request.hostname);
        const base = this.shareImageService.publicUrl(request.hostname);
        if (data == null) {
            reply.status(404).header('Content-Type', 'text/html; charset=utf-8').send(this.html(
                'Noch kein Share · NerdPool', 'Für diese Adresse gibt es noch keinen Share.', null, base,
                `<p>Für diese Adresse gibt es noch keinen Share.</p><p><a href="${base}/d/${escapeHtml(address)}">Dashboard des Miners</a></p>`));
            return;
        }
        const doiPercent = fmtPercentDe(percentOfTarget(data.difficulty, data.doiTarget));
        const title = `Best Share ${fmtDifficultyDe(data.difficulty)} · NerdPool`;
        const description = `${data.worker.length > 0 ? `Worker ${data.worker}` : 'Ein Miner'} hat auf NerdPool einen Share mit ${doiPercent} der Doichain-Difficulty gefunden. Merged Mining: Bitcoin und Doichain gleichzeitig, solo, ohne Registrierung.`;
        const image = `${base}/api/share/best/${address}?v=${Math.round(data.difficulty)}`;
        const body = `
<p><img src="${image}" alt="${escapeHtml(title)}" width="1200" height="630" style="width:100%;height:auto;border-radius:16px;border:1px solid #1E2A36"></p>
<p>
  <a href="${base}/share/best/${escapeHtml(address)}">Teilen-Karte im Dashboard</a> ·
  <a href="${base}/d/${escapeHtml(address)}">Dashboard des Miners</a> ·
  <a href="${image}" download="nerdpool-best-share.png">Bild herunterladen</a>
</p>`;
        reply
            .header('Content-Type', 'text/html; charset=utf-8')
            .header('Cache-Control', 'public, max-age=300')
            .send(this.html(title, description, image, base, body));
    }

    @Get('share/:chain/:height')
    public async image(@Param('chain') chainParam: string, @Param('height') heightParam: string, @Req() request: FastifyRequest, @Res() reply: FastifyReply) {
        const chain = chainOf(chainParam);
        const height = heightOf(heightParam);
        const png = await this.shareImageService.render(chain, height, request.hostname);
        if (png == null) {
            throw new NotFoundException('Diesen Block hat der Pool nicht gefunden');
        }
        reply
            .header('Content-Type', 'image/png')
            .header('Cache-Control', 'public, max-age=600')
            .header('Content-Disposition', `inline; filename="nerdpool-${chain.toLowerCase()}-${height}.png"`)
            .send(png);
    }

    @Get('s/:chain/:height')
    public async page(@Param('chain') chainParam: string, @Param('height') heightParam: string, @Req() request: FastifyRequest, @Res() reply: FastifyReply) {
        const chain = chainOf(chainParam);
        const height = heightOf(heightParam);
        const data = await this.shareImageService.data(chain, height, request.hostname);
        const base = this.shareImageService.publicUrl(request.hostname);
        const lower = chain.toLowerCase();
        if (data == null) {
            reply.status(404).header('Content-Type', 'text/html; charset=utf-8').send(this.html(
                'Block nicht gefunden · NerdPool', 'Diesen Block hat der Pool nicht gefunden.', null, base,
                `<p>Diesen Block hat der Pool nicht gefunden.</p><p><a href="${base}/blocks">Alle gefundenen Blöcke</a></p>`));
            return;
        }
        const chainName = chain === 'DOI' ? 'Doichain' : 'Bitcoin';
        const title = `${chainName}-Block ${height.toLocaleString('de-DE')} gefunden · NerdPool`;
        const description = `Worker ${data.worker} hat auf NerdPool einen ${chainName}-Block gefunden. Merged Mining: Bitcoin und Doichain gleichzeitig, solo, ohne Registrierung.`;
        const image = `${base}/api/share/${lower}/${height}`;
        const body = `
<p><img src="${image}" alt="${escapeHtml(title)}" width="1200" height="630" style="width:100%;height:auto;border-radius:16px;border:1px solid #1E2A36"></p>
<p>
  <a href="${base}/share/${lower}/${height}">Teilen-Karte im Dashboard</a> ·
  ${data.hash ? `<a href="${base}/explorer/${lower}/block/${escapeHtml(data.hash)}">Block im Explorer</a> · ` : ''}
  <a href="${base}/d/${escapeHtml(data.minerAddress)}">Dashboard des Miners</a> ·
  <a href="${image}" download="nerdpool-${lower}-${height}.png">Bild herunterladen</a>
</p>`;
        reply
            .header('Content-Type', 'text/html; charset=utf-8')
            .header('Cache-Control', 'public, max-age=300')
            .send(this.html(title, description, image, base, body));
    }

    private html(title: string, description: string, image: string | null, base: string, body: string): string {
        const safeTitle = escapeHtml(title);
        const safeDescription = escapeHtml(description);
        return `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${safeTitle}</title>
<meta name="description" content="${safeDescription}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="NerdPool">
<meta property="og:title" content="${safeTitle}">
<meta property="og:description" content="${safeDescription}">
${image ? `<meta property="og:image" content="${image}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:image" content="${image}">` : ''}
<style>
body{margin:0;background:#0B0F14;color:#E6EDF3;font:16px/1.5 Inter,system-ui,sans-serif}
main{max-width:1200px;margin:0 auto;padding:32px 16px 48px}
a{color:#38BDF8}
h1{font-size:22px;margin:0 0 16px}
</style>
</head>
<body>
<main>
<h1><a href="${base}/" style="color:inherit;text-decoration:none">NERDPOOL</a> · ${safeTitle}</h1>
${body}
</main>
</body>
</html>`;
    }
}
