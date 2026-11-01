import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Certificate for the TLS stratum port, taken from Caddy's storage (the same Let's Encrypt certificate the
 * dashboard uses) or from explicit files. Caddy keeps <dir>/<issuer>/<domain>/<domain>.crt and .key and
 * rewrites them on renewal, so the loader is called again from time to time.
 */

export interface TlsFiles {
    certPath: string;
    keyPath: string;
}

export interface TlsMaterial extends TlsFiles {
    key: Buffer;
    cert: Buffer;
    /** sha256 of the certificate file, to notice a renewal */
    fingerprint: string;
}

export interface TlsSource {
    certPath?: string | null;
    keyPath?: string | null;
    /** Caddy's certificates directory, e.g. /certs/caddy/certificates */
    certDir?: string | null;
    domain?: string | null;
}

/** Newest <certDir>/<issuer>/<domain>/<domain>.crt with its key, null when Caddy has none yet. */
export function findCaddyCertificate(certDir: string, domain: string): TlsFiles | null {
    let issuers: string[];
    try {
        issuers = fs.readdirSync(certDir);
    } catch {
        return null;
    }
    let best: { files: TlsFiles; mtime: number } | null = null;
    for (const issuer of issuers) {
        const certPath = path.join(certDir, issuer, domain, `${domain}.crt`);
        const keyPath = path.join(certDir, issuer, domain, `${domain}.key`);
        try {
            const mtime = fs.statSync(certPath).mtimeMs;
            fs.statSync(keyPath);
            if (best == null || mtime > best.mtime) {
                best = { files: { certPath, keyPath }, mtime };
            }
        } catch {
            // this issuer has no certificate for the domain
        }
    }
    return best?.files ?? null;
}

export function resolveTlsFiles(source: TlsSource): TlsFiles | null {
    if (source.certPath && source.keyPath) {
        return { certPath: source.certPath, keyPath: source.keyPath };
    }
    if (source.certDir && source.domain) {
        return findCaddyCertificate(source.certDir, source.domain);
    }
    return null;
}

export function loadTlsMaterial(source: TlsSource): TlsMaterial | null {
    const files = resolveTlsFiles(source);
    if (files == null) {
        return null;
    }
    try {
        const cert = fs.readFileSync(files.certPath);
        const key = fs.readFileSync(files.keyPath);
        if (cert.length === 0 || key.length === 0) {
            return null;
        }
        return { ...files, cert, key, fingerprint: createHash('sha256').update(cert).digest('hex') };
    } catch {
        return null;
    }
}

/** the host of POOL_PUBLIC_URL, the domain the certificate is issued for */
export function domainOf(publicUrl: string | null | undefined): string | null {
    if (publicUrl == null || publicUrl.length === 0) {
        return null;
    }
    try {
        return new URL(publicUrl).hostname || null;
    } catch {
        return null;
    }
}
