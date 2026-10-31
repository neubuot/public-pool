import { buildWebhookRequest, isPrivateIp, maskUrl, ntfyTarget, validateWebhookUrl, WebhookEvent } from './webhook-targets';

const EVENT: WebhookEvent = {
    event: 'worker.offline', address: 'bc1qexampleaddress0000000000000000000000000', title: 'Worker offline',
    text: 'bitaxe1 is offline', url: 'https://pool.test/d/bc1q', time: '2026-10-31T20:00:00.000Z', data: { worker: 'bitaxe1' }
};

describe('isPrivateIp', () => {
    it('knows the private, loopback and link local ranges', () => {
        for (const ip of ['10.1.2.3', '127.0.0.1', '169.254.10.1', '172.16.0.1', '172.31.255.255', '192.168.2.235', '100.64.0.1', '0.0.0.0', '::1', '::', 'fd12::1', 'fe80::1', '::ffff:10.0.0.1']) {
            expect(isPrivateIp(ip)).toBe(true);
        }
        for (const ip of ['8.8.8.8', '172.32.0.1', '159.195.143.151', '2a01:4f8::1', '::ffff:8.8.8.8']) {
            expect(isPrivateIp(ip)).toBe(false);
        }
    });
});

describe('validateWebhookUrl', () => {
    it('accepts public https targets only', () => {
        expect(validateWebhookUrl('https://ntfy.sh/nerdpool-ottmar').ok).toBe(true);
        expect(validateWebhookUrl('https://discord.com/api/webhooks/1/abc').ok).toBe(true);
        for (const bad of ['http://ntfy.sh/x', 'https://localhost/x', 'https://127.0.0.1/x', 'https://[::1]/x', 'https://pool/x', 'https://ha.local/api', 'https://user:pw@ntfy.sh/x', '', 'nope', `https://ntfy.sh/${'a'.repeat(520)}`]) {
            expect(validateWebhookUrl(bad).ok).toBe(false);
        }
    });
});

describe('ntfyTarget', () => {
    it('splits the topic off and keeps a sub path of a self hosted server', () => {
        expect(ntfyTarget(new URL('https://ntfy.sh/nerdpool-ottmar'))).toEqual({ publishUrl: 'https://ntfy.sh/', topic: 'nerdpool-ottmar' });
        expect(ntfyTarget(new URL('https://example.org/ntfy/topic_1'))).toEqual({ publishUrl: 'https://example.org/ntfy/', topic: 'topic_1' });
        expect(ntfyTarget(new URL('https://ntfy.sh/'))).toBeNull();
        expect(ntfyTarget(new URL('https://ntfy.sh/bad%20topic'))).toBeNull();
    });
});

describe('buildWebhookRequest', () => {
    it('publishes to ntfy as JSON with title, click link and priority', () => {
        const request = buildWebhookRequest('ntfy', 'https://ntfy.sh/nerdpool-ottmar', { ...EVENT, image: 'https://pool.test/api/share/best/x' });
        expect(request.url).toBe('https://ntfy.sh/');
        expect(JSON.parse(request.body)).toEqual({
            topic: 'nerdpool-ottmar', title: 'Worker offline', message: 'bitaxe1 is offline', tags: ['electric_plug'],
            click: 'https://pool.test/d/bc1q', attach: 'https://pool.test/api/share/best/x', priority: 4
        });
        expect(request.headers['X-NerdPool-Event']).toBe('worker.offline');
    });

    it('rejects an ntfy URL without topic', () => {
        expect(() => buildWebhookRequest('ntfy', 'https://ntfy.sh/', EVENT)).toThrow(/Thema/);
    });

    it('sends Discord a message with the link and the image as embed', () => {
        const request = buildWebhookRequest('discord', 'https://discord.com/api/webhooks/1/abc', { ...EVENT, image: 'https://pool.test/i.png' });
        const payload = JSON.parse(request.body);
        expect(request.url).toBe('https://discord.com/api/webhooks/1/abc');
        expect(payload.username).toBe('NerdPool');
        expect(payload.content).toBe('**Worker offline**\nbitaxe1 is offline\nhttps://pool.test/d/bc1q');
        expect(payload.embeds).toEqual([{ image: { url: 'https://pool.test/i.png' } }]);
    });

    it('posts the whole event to a JSON endpoint', () => {
        const request = buildWebhookRequest('json', 'https://example.org/hook', EVENT);
        expect(JSON.parse(request.body)).toEqual(EVENT);
        expect(request.headers['Content-Type']).toBe('application/json');
    });
});

describe('maskUrl', () => {
    it('keeps the host and hides most of the path', () => {
        expect(maskUrl('https://ntfy.sh/nerdpool-ottmar')).toBe('https://ntfy.sh/ner…ar');
        expect(maskUrl('https://discord.com/api/webhooks/123/token?wait=true')).toBe('https://discord.com/api…en?…');
        expect(maskUrl('https://example.org/')).toBe('https://example.org');
        expect(maskUrl('nope')).toBe('…');
    });
});
