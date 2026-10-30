# Beta-Server: Pool mit Merged Mining betreiben

Ein Server, vier Container: Bitcoin Core (pruned), Doichain Core, der Pool, und Caddy mit dem
NerdPool-Dashboard (`web/`). Zielgruppe: eine geschlossene Beta mit einer Handvoll Bitaxe,
später derselbe Aufbau für den öffentlichen Betrieb.

| Container | Image | Aufgabe | Ports nach außen |
| --- | --- | --- | --- |
| nerdpool-bitcoind | bitcoin/bitcoin:29.5 | Parent-Kette, getblocktemplate, ZMQ | 8333 (P2P) |
| nerdpool-doichaind | nerdpool/doichain-core:v31.1.6 (statisches Release-Binary, Prüfsumme) | Aux-Kette, createauxblock, submitauxblock | 8338 (P2P) |
| nerdpool-pool | aus diesem Repository gebaut | Stratum und API | 3333 (Stratum) |
| nerdpool-web | Caddy mit dem Dashboard aus `web/` (Vite + Svelte) | HTTPS, Dashboard, /api an den Pool | 80, 443 |

RPC-Ports und die Pool-API bleiben im Docker-Netz.

## Server

Empfehlung für die Beta: 8 vCPU, 16 GB RAM, 240 GB NVMe, Ubuntu 24.04, feste IPv4 (z. B. Hetzner Cloud
CPX41, ca. 30 EUR/Monat; vorher mit einem Satz beim Support klären, dass ein Stratum-Server ohne eigenes
Mining erlaubt ist, oder netcup/OVH nehmen). Für den öffentlichen Betrieb später 64 GB RAM und ein
voller Node.

Platzbedarf: Bitcoin pruned ca. 25 GB, Doichain wenige GB, Pool-Datenbank wächst mit den Shares
(einige hundert MB je Monat bei zehn Geräten). Der Erstabgleich von Bitcoin lädt trotz Pruning die
gesamte Kette (rund 750 GB Traffic) und dauert 6 bis 24 Stunden.

## Installation

1. DNS: A-Record der Pool-Domain (z. B. `pool.doilabs.org`) auf die Server-IP.
2. Als root auf dem Server:

   ```bash
   bash <(curl -fsSL https://raw.githubusercontent.com/neubuot/public-pool/auxpow-doichain/deploy/install.sh)
   ```

   Installiert Docker, setzt die Firewall (22, 80, 443, 3333, 8333, 8338), klont das Repository nach
   `/opt/nerdpool` und legt `deploy/.env` mit zufälligen RPC-Passwörtern an.
3. `/opt/nerdpool/deploy/.env` ausfüllen: `POOL_DOMAIN`, `DOICHAIN_DEFAULT_ADDRESS` (Projekt-Adresse für
   Miner ohne DOI-Adresse), optional `ACME_EMAIL`, `DEV_FEE_ADDRESS`, `TELEGRAM_BOT_TOKEN`.
4. Starten:

   ```bash
   cd /opt/nerdpool/deploy && docker compose up -d --build
   ```

   Der erste Build (Pool und UI) dauert einige Minuten. Caddy holt das Zertifikat, sobald die Domain
   auflöst.
5. Abgleich verfolgen:

   ```bash
   bash scripts/status.sh
   ```

   Der Pool gibt erst Jobs aus, wenn Bitcoin Core den Erstabgleich beendet hat (`initialblockdownload`
   false). Bis dahin meldet er einmal pro Minute den Fortschritt. Doichain ist in wenigen Minuten synchron.

## Miner anschließen

| Feld | Wert |
| --- | --- |
| Stratum-URL | `stratum+tcp://pool.doilabs.org` |
| Port | `3333` |
| Benutzername | `<BTC-Adresse>.<Gerätename>` |
| Passwort | `<DOI-Adresse>` (oder `doi=<DOI-Adresse>`, kombinierbar mit `d=<Difficulty>`) |

Ohne DOI-Adresse im Passwort geht die DOI-Belohnung an `DOICHAIN_DEFAULT_ADDRESS`. Das Dashboard unter
`https://pool.doilabs.org` (Quellcode in `web/`, Beschreibung in `web/README.md`) führt durch das Onboarding
(Adressen prüfen, Zugangsdaten erzeugen, wartet auf den ersten Share), zeigt die Pool-Statistik mit
Instrumenten und Charts für beide Ketten, ein Miner-Dashboard je BTC-Adresse unter `/d/<adresse>`, alle
gefundenen Blöcke mit Kette, einen Explorer für Doichain (eigener Node mit Transaktionsindex) und Bitcoin
(jüngste Blöcke vom eigenen Node, Details über mempool.space) sowie eine Teilen-Karte je Block. Die API dazu:
`/api/stats` (Ketten, Pool, Chancen, Kurse, alle 30 s erneuert), `/api/stats/history?range=24h|7d|30d|90d`
(Stichproben alle 5 Minuten, 90 Tage), `/api/stats/events` (Server-sent events: Shares, Blöcke, Verbindungen,
Kettenspitzen), `/api/miner/:address`, `/api/validate/{btc,doi}/:address`, `/api/explorer/...`. Der Pool-Kurs
kommt von CoinGecko (`PRICE_URL`, `off` schaltet ab), Bitcoin-Details von `MEMPOOL_API_URL`
(Vorgabe mempool.space). Gefundene DOI-Blöcke stehen außerdem in der API unter `/api/pool` mit `chain = DOI`
und im Pool-Log.

Dashboard neu bauen: `docker compose build web && docker compose up -d web` (Build-Kontext ist das
Repository, Dockerfile `deploy/web/Dockerfile`, Ausschlüsse in `deploy/web/Dockerfile.dockerignore`).

Weitere Stücke der API (seit 31.10.2026): `/api/share/<btc|doi>/<höhe>` liefert die Teilen-Karte eines vom
Pool gefundenen Blocks als PNG (1200 × 630, serverseitig mit satori und resvg gezeichnet, zehn Minuten
zwischengespeichert), `/s/<btc|doi>/<höhe>` eine kleine Seite mit Open-Graph-Angaben, damit Telegram,
WhatsApp und Co. das Bild als Vorschau zeigen (Caddy reicht `/s/*` an den Pool weiter). Die besten Shares je
Adresse (Tabelle `top_share_entity`, 25 je Adresse) füllen „Closest Calls“ im Miner-Dashboard und „Beste
Shares“ auf der Pool-Seite. Explorer, Teilen-Karten, Adressprüfung und Miner-Abfragen sind je Client-Adresse
gedrosselt (HTTP 429), Caddy setzt dafür `X-Forwarded-For`, der Pool liest sie mit `TRUST_PROXY=true`.

Telegram: Miner abonnieren Blockfunde beim Bot mit `/subscribe <BTC-Adresse>`, das Dashboard zeigt den Bot
aus `TELEGRAM_BOT_USERNAME`. Gemeldet werden Bitcoin- und Doichain-Blöcke mit Link in den Explorer und auf die
Teilen-Seite. `TELEGRAM_ANNOUNCE_CHAT_ID` (Chat- oder Kanal-ID, Bot als Mitglied) meldet zusätzlich jeden
angenommenen Block an alle.

Einen TLS-Stratum-Port gibt es in der Beta noch nicht, nur `stratum+tcp`.

## Rechtstexte

Impressum, Datenschutzerklärung und Nutzungsbedingungen liegen als statische Seiten in `web/legal/` und
sind unter `/impressum`, `/datenschutz` und `/nutzungsbedingungen` erreichbar; das Dashboard verlinkt sie in
der Fußzeile. Der Ordner ist in den Web-Container eingebunden, Änderungen brauchen nur
`docker compose restart web`. Die Datenschutzerklärung setzt einen Vertrag zur Auftragsverarbeitung mit
hostworld voraus, den gibt es im Kundenmenü. Die Texte sind ein Entwurf für den Beta-Betrieb, vor dem
öffentlichen Start anwaltlich prüfen lassen.

## Betrieb

- **Health:** `https://pool.doilabs.org/api/health` antwortet mit `"ok":true` (HTTP 200), sonst 503 mit
  der Liste der Probleme; Grundlage für Monitoring und `status.sh`
- **Status:** `bash scripts/status.sh`
- **Logs:** `docker compose logs -f pool` (Blockfunde erscheinen als `DOICHAIN BLOCK FOUND` und `BLOCK FOUND`)
- **Update:** `git pull && docker compose up -d --build`
- **Sicherung:** `bash scripts/backup.sh` (hält den Pool für wenige Sekunden an), per Cron täglich:
  `0 3 * * * /opt/nerdpool/deploy/scripts/backup.sh`
- **Monitoring in Uptime Kuma:** vier Monitore, Tabelle und Anlege-Skript in
  [monitoring/README.md](monitoring/README.md).
- **Node-Reserven:** `BITCOIN_DBCACHE_MB` in `.env` während des Erstabgleichs auf 4000 setzen, danach wieder
  auf 1500 (`docker compose up -d` übernimmt die Änderung).

## Was vor dem öffentlichen Start noch fehlt

- Test mit echten Bitaxe und NerdMinern über mehrere Tage (Version-Rolling, Vardiff, Reconnects)
- Dashboard mit DOI-Blöcken und Onboarding (Phase 2 des Konzepts)
- TLS-Stratum-Port, Rate-Limits je IP auf dem Stratum-Port
- Auftragsverarbeitungsvertrag mit dem Hoster
- Anwaltliche Kurzprüfung der Rechtstexte und des nicht verwahrenden Modells
