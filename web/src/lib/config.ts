// Laufzeit-Konfiguration aus /config.js (im Betrieb vom Entrypoint geschrieben), sonst aus der Adresse der Seite.
const runtime = (typeof window !== 'undefined' && window.__NERDPOOL__) || {};

export const poolDomain: string = runtime.domain && runtime.domain.length > 0 ? runtime.domain : window.location.hostname;
export const stratumPort: number = runtime.stratumPort ?? 3333;
export const stratumUrl = `stratum+tcp://${poolDomain}:${stratumPort}`;
/** stratum+ssl port, null when the pool offers none */
export const stratumTlsPort: number | null = typeof runtime.stratumTlsPort === 'number' && runtime.stratumTlsPort > 0 ? runtime.stratumTlsPort : null;
export const stratumTlsUrl: string | null = stratumTlsPort != null ? `stratum+ssl://${poolDomain}:${stratumTlsPort}` : null;
export const isBeta: boolean = runtime.beta ?? true;
export const repoUrl = 'https://github.com/neubuot/public-pool/tree/auxpow-doichain';
export const mempoolSpace = 'https://mempool.space';
export const walletsUrl = 'https://www.doilabs.org/downloads/';
