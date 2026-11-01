import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { domainOf, findCaddyCertificate, loadTlsMaterial, resolveTlsFiles } from './tls-certs';

const DOMAIN = 'pool.example.org';

function issuerDir(root: string, issuer: string, mtimeSeconds: number, withKey = true): string {
    const dir = path.join(root, issuer, DOMAIN);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${DOMAIN}.crt`), `cert of ${issuer}`);
    if (withKey) {
        fs.writeFileSync(path.join(dir, `${DOMAIN}.key`), `key of ${issuer}`);
    }
    const time = new Date(mtimeSeconds * 1000);
    fs.utimesSync(path.join(dir, `${DOMAIN}.crt`), time, time);
    return dir;
}

describe('tls certificate loader', () => {
    let root: string;

    beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'nerdpool-certs-'));
    });

    afterEach(() => {
        fs.rmSync(root, { recursive: true, force: true });
    });

    it('takes the newest certificate across issuer directories and ignores one without key', () => {
        issuerDir(root, 'acme-v02.api.letsencrypt.org-directory', 1_700_000_000);
        issuerDir(root, 'acme.zerossl.com-v2-dv90', 1_800_000_000);
        issuerDir(root, 'broken-issuer', 1_900_000_000, false);
        const files = findCaddyCertificate(root, DOMAIN);
        expect(files?.certPath).toBe(path.join(root, 'acme.zerossl.com-v2-dv90', DOMAIN, `${DOMAIN}.crt`));
        const material = loadTlsMaterial({ certDir: root, domain: DOMAIN });
        expect(material?.cert.toString()).toBe('cert of acme.zerossl.com-v2-dv90');
        expect(material?.key.toString()).toBe('key of acme.zerossl.com-v2-dv90');
        expect(material?.fingerprint).toHaveLength(64);
    });

    it('returns null without a certificate or directory', () => {
        expect(findCaddyCertificate(root, DOMAIN)).toBeNull();
        expect(findCaddyCertificate(path.join(root, 'missing'), DOMAIN)).toBeNull();
        expect(loadTlsMaterial({ certDir: root, domain: DOMAIN })).toBeNull();
        expect(loadTlsMaterial({})).toBeNull();
    });

    it('prefers explicit files and notices a renewal by fingerprint', () => {
        const dir = issuerDir(root, 'manual', 1_700_000_000);
        const explicit = { certPath: path.join(dir, `${DOMAIN}.crt`), keyPath: path.join(dir, `${DOMAIN}.key`) };
        expect(resolveTlsFiles({ ...explicit, certDir: '/nowhere', domain: 'x' })).toEqual(explicit);
        const before = loadTlsMaterial(explicit)!;
        fs.writeFileSync(explicit.certPath, 'renewed certificate');
        const after = loadTlsMaterial(explicit)!;
        expect(after.fingerprint).not.toBe(before.fingerprint);
    });

    it('reads the domain from the public URL', () => {
        expect(domainOf('https://pool.doilabs.org')).toBe('pool.doilabs.org');
        expect(domainOf('https://pool.doilabs.org/')).toBe('pool.doilabs.org');
        expect(domainOf('')).toBeNull();
        expect(domainOf('nope')).toBeNull();
    });
});
