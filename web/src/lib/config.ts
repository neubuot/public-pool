// Laufzeit-Konfiguration aus /config.js (im Betrieb vom Entrypoint geschrieben), sonst aus der Adresse der Seite.
const runtime = (typeof window !== 'undefined' && window.__NERDPOOL__) || {};

export const poolDomain: string = runtime.domain && runtime.domain.length > 0 ? runtime.domain : window.location.hostname;
export const stratumPort: number = runtime.stratumPort ?? 3333;
export const stratumUrl = `stratum+tcp://${poolDomain}:${stratumPort}`;
export const isBeta: boolean = runtime.beta ?? true;
export const repoUrl = 'https://github.com/neubuot/public-pool/tree/auxpow-doichain';
export const mempoolSpace = 'https://mempool.space';
