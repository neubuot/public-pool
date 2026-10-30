#!/usr/bin/env bash
# Ende-zu-Ende-Nachweis für Phase 0: Nodes starten, Pool starten, Test-Miner laufen lassen und prüfen,
# dass Doichain die per AuxPoW eingereichten Blöcke angenommen hat.
set -euo pipefail
cd "$(dirname "$0")"
ROOT=$(cd .. && pwd)

SHARES=${SHARES:-3}
POOL_LOG=${POOL_LOG:-$ROOT/regtest/pool-e2e.log}

doi() { docker exec nerdpool-doichaind doichain-cli -regtest -rpcuser=pool -rpcpassword=pool -rpcport=18445 "$@"; }
btc() { docker exec nerdpool-bitcoind bitcoin-cli -regtest -rpcuser=pool -rpcpassword=pool "$@"; }

bash setup.sh
# shellcheck disable=SC1091
source generated.env

DOI_BEFORE=$(doi getblockcount)
BTC_BEFORE=$(btc getblockcount)

if [ ! -d "$ROOT/node_modules" ]; then
    (cd "$ROOT" && npm install --no-audit --no-fund)
fi

echo "== Pool starten (Log: $POOL_LOG)"
(cd "$ROOT" && npx nest start > "$POOL_LOG" 2>&1) &
POOL_PID=$!
cleanup() {
    echo "== Pool stoppen"
    kill "$POOL_PID" 2>/dev/null || true
    # nest start startet node als Kindprozess, auf Windows (Git Bash) bleibt der sonst stehen
    if command -v taskkill >/dev/null 2>&1; then
        taskkill //F //T //PID "$POOL_PID" >/dev/null 2>&1 || true
    fi
}
trap cleanup EXIT

for i in $(seq 1 120); do
    if grep -q "Stratum server is listening" "$POOL_LOG" 2>/dev/null; then
        break
    fi
    if ! kill -0 "$POOL_PID" 2>/dev/null; then
        echo "Pool ist beendet, Log:" >&2
        tail -40 "$POOL_LOG" >&2
        exit 1
    fi
    sleep 1
done
grep -q "Stratum server is listening" "$POOL_LOG" || { echo "Stratum-Port kam nicht hoch" >&2; tail -40 "$POOL_LOG" >&2; exit 1; }
grep -q "Doichain RPC connected" "$POOL_LOG" || { echo "Pool hat keine Doichain-RPC-Verbindung" >&2; tail -40 "$POOL_LOG" >&2; exit 1; }

echo "== Test-Miner: $SHARES Shares mit DOI-Adresse $DOI_ADDRESS"
(cd "$ROOT" && node tools/testminer.js --user "$BTC_ADDRESS.e2e" --pass "$DOI_ADDRESS" --shares "$SHARES" --timeout 240)

sleep 2
DOI_AFTER=$(doi getblockcount)
BTC_AFTER=$(btc getblockcount)
DOI_FOUND=$((DOI_AFTER - DOI_BEFORE))
BTC_FOUND=$((BTC_AFTER - BTC_BEFORE))

echo
echo "== Ergebnis"
echo "Doichain: $DOI_BEFORE -> $DOI_AFTER ($DOI_FOUND neue Blöcke)"
echo "Bitcoin:  $BTC_BEFORE -> $BTC_AFTER ($BTC_FOUND neue Blöcke)"
echo "AuxPoW-Antworten im Pool-Log:"
grep -E "DOICHAIN AUXPOW SUBMISSION|DOICHAIN BLOCK FOUND" "$POOL_LOG" | tail -10 || true

if [ "$DOI_FOUND" -lt 1 ]; then
    echo "FEHLGESCHLAGEN: Doichain hat keinen Block angenommen" >&2
    tail -60 "$POOL_LOG" >&2
    exit 1
fi

BEST=$(doi getbestblockhash)
echo
echo "== Bester Doichain-Block $BEST"
doi getblock "$BEST" | grep -E '"(height|chainid|auxpow|hash|tx)"' | head -8 || true
AUXPOW_TX=$(doi getblock "$BEST" | grep -A2 '"auxpow"' | head -3 || true)
echo "$AUXPOW_TX"
echo
echo "PHASE 0 BESTANDEN: $DOI_FOUND Doichain-Block/Blöcke per AuxPoW über den Pool gefunden."
