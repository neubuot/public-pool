# NerdPool-Dashboard

Oberfläche des Nerd-Mining-Pools: Onboarding, Pool-Statistik mit Instrumenten und Charts für Bitcoin und
Doichain, Miner-Dashboard je BTC-Adresse, Explorer für beide Ketten, Teilen-Karte für gefundene Blöcke.
Vite + Svelte 5 + TypeScript, Charts mit ECharts, Schriften gebündelt (keine externen Aufrufe), Deutsch und
Englisch umschaltbar.

## Entwicklung

```bash
npm install
npm run dev        # http://127.0.0.1:5173, /api wird an http://127.0.0.1:3334 weitergereicht
npm run check      # Typen und Svelte prüfen
npm run build      # dist/
```

Das Backend lokal starten (`npm run build && node dist/main` im Repository-Wurzelverzeichnis) oder einen anderen
Pool mit `VITE_API_PROXY=https://pool.doilabs.org npm run dev` anbinden. Die Laufzeit-Konfiguration kommt aus
`public/config.js` (im Betrieb schreibt `deploy/web/entrypoint.sh` die Datei aus `POOL_DOMAIN` und
`STRATUM_PORT`).

## Seiten

| Pfad | Inhalt |
|---|---|
| `/` | Onboarding: Adressen prüfen (BTC lokal, DOI über den Node), Zugangsdaten erzeugen, Geräteanleitung, wartet auf den ersten Share |
| `/pool` | Pool-Statistik: Hashrate-Verlauf, Lotterie-Cockpit, Kettenkarten mit Instrumenten, Netzwerk-Verlauf, Gerätetypen, Live-Terminal, Block-Feed |
| `/d/<btc-adresse>` | Miner-Dashboard: Hashrate je Gerät, Chancen, Geräte, Best Share, Live-Terminal, eigene Blöcke |
| `/blocks` | Alle vom Pool gefundenen Blöcke |
| `/explorer` | Suche (Höhe, Hash, Txid, Adresse) und neueste Blöcke beider Ketten |
| `/explorer/<doi|btc>/block/<id>`, `/tx/<txid>`, `/address/<adresse>` | Details |
| `/share/<doi|btc>/<höhe>` | Teilen-Karte 1200 × 630 |

Benutzte API-Endpunkte: `/api/stats`, `/api/stats/history`, `/api/stats/events` (Server-sent events), `/api/miner/:address`,
`/api/validate/{btc,doi}/:address`, `/api/explorer/*`, `/api/info`.
