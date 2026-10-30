#!/usr/bin/env bash
# Zustand des Beta-Servers: Container, Abgleich beider Nodes, Pool-API, gefundene Blöcke.
set -uo pipefail
cd "$(dirname "$0")/.."
# shellcheck disable=SC1091
set -a; source .env; set +a

echo "== Container"
docker compose ps --format 'table {{.Name}}\t{{.Status}}'

echo
echo "== Bitcoin Core"
docker compose exec -T bitcoind bitcoin-cli -rpcuser="${BITCOIN_RPC_USER:-pool}" -rpcpassword="$BITCOIN_RPC_PASSWORD" getblockchaininfo 2>/dev/null \
    | grep -E '"(chain|blocks|headers|verificationprogress|initialblockdownload|pruned|size_on_disk)"' || echo "nicht erreichbar"

echo
echo "== Doichain Core"
DOI_LOCAL=$(docker compose exec -T doichaind doichain-cli -datadir=/data -rpcuser="${DOICHAIN_RPC_USER:-pool}" -rpcpassword="$DOICHAIN_RPC_PASSWORD" getblockcount 2>/dev/null || echo "?")
DOI_PUBLIC=$(curl -s --max-time 10 https://doi-api.sendlabs.de/health | grep -oE '"blocks":[0-9]+' | cut -d: -f2)
echo "Höhe lokal $DOI_LOCAL, öffentlich ${DOI_PUBLIC:-?}"
docker compose exec -T doichaind doichain-cli -datadir=/data -rpcuser="${DOICHAIN_RPC_USER:-pool}" -rpcpassword="$DOICHAIN_RPC_PASSWORD" getblockchaininfo 2>/dev/null \
    | grep -E '"(initialblockdownload|verificationprogress)"' || true

echo
echo "== Pool-API (/api/health, dieselbe Sicht wie Uptime Kuma)"
docker compose exec -T pool node -e "fetch('http://127.0.0.1:3334/api/health').then(r=>r.json()).then(j=>console.log(JSON.stringify(j, null, 1))).catch(e=>console.log('nicht erreichbar: '+e.message))" 2>/dev/null
echo "== Gefundene Blöcke"
docker compose exec -T pool node -e "fetch('http://127.0.0.1:3334/api/pool').then(r=>r.json()).then(j=>console.log(JSON.stringify(j.blocksFound||j))).catch(()=>{})" 2>/dev/null

echo
echo "== Letzte Pool-Meldungen"
docker compose logs --no-log-prefix --tail 8 pool 2>/dev/null | grep -vE "share|Share" | tail -8
