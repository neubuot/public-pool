/// <reference types="svelte" />
/// <reference types="vite/client" />

interface NerdPoolRuntimeConfig {
    domain?: string;
    stratumPort?: number;
    /** stratum+ssl port, null or missing when the pool offers none */
    stratumTlsPort?: number | null;
    beta?: boolean;
}

interface Window {
    __NERDPOOL__?: NerdPoolRuntimeConfig;
}
