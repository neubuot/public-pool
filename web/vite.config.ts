import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vite';

// Entwicklung: /api wird an das lokale Backend (oder VITE_API_PROXY) weitergereicht, im Betrieb macht das Caddy.
export default defineConfig({
    plugins: [svelte()],
    server: {
        port: 5173,
        proxy: {
            '/api': {
                target: process.env.VITE_API_PROXY ?? 'http://127.0.0.1:3334',
                changeOrigin: true,
            },
        },
    },
    build: {
        outDir: 'dist',
        sourcemap: false,
        chunkSizeWarningLimit: 1500,
        rollupOptions: {
            output: {
                manualChunks: {
                    echarts: ['echarts/core', 'echarts/charts', 'echarts/components', 'echarts/renderers'],
                },
            },
        },
    },
});
