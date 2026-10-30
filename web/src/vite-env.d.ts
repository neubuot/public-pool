/// <reference types="svelte" />
/// <reference types="vite/client" />

interface NerdPoolRuntimeConfig {
    domain?: string;
    stratumPort?: number;
    beta?: boolean;
}

interface Window {
    __NERDPOOL__?: NerdPoolRuntimeConfig;
}
