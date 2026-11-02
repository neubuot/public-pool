#!/usr/bin/env bash
# Ende-zu-Ende-Nachweis für den Syndikat-Modus im Regtest: zwei Miner mit verschiedenen DOI-Adressen und
# ",syndicate" im Passwort. Der Pool baut den Doichain-Block selbst (Coinbase mit einem Ausgang je Mitglied)
# und reicht ihn per submitblock ein. Geprüft wird, dass Doichain die Blöcke annimmt und der letzte Block
# beide Adressen bezahlt.
set -euo pipefail
cd "$(dirname "$0")"
ROOT=$(cd .. && pwd)

POOL_LOG=${POOL_LOG:-$ROOT/regtest/pool-e2e-syndicate.log}

# shellcheck disable=SC1091
source ./backend.sh

bash setup.sh
# shellcheck disable=SC1091
source generated.env

DOI_ADDRESS_2=$(doi -rpcwallet=pool getnewaddress syndicate2 bech32)
DOI_BEFORE=$(doi getblockcount)
BTC_BEFORE=$(btc getblockcount)

if [ ! -d "$ROOT/node_modules" ]; then
    (cd "$ROOT" && npm install --no-audit --no-fund)
fi

STRATUM_PORT=${STRATUM_PORT:-3333}
API_PORT=${API_PORT:-3334}

listening_pids() {
    if command -v powershell >/dev/null 2>&1; then
        powershell -NoProfile -Command "(Get-NetTCPConnection -LocalPort $STRATUM_PORT,$API_PORT -State Listen -ErrorAction SilentlyContinue).OwningProcess | Sort-Object -Unique" 2>/dev/null | tr -d '\r'
    elif command -v lsof >/dev/null 2>&1; then
        lsof -t -iTCP:"$STRATUM_PORT" -iTCP:"$API_PORT" -sTCP:LISTEN 2>/dev/null | sort -u
    fi
}

stop_pool() {
    for pid in $(listening_pids); do
        if command -v taskkill >/dev/null 2>&1; then
            MSYS_NO_PATHCONV=1 taskkill /F /T /PID "$pid" >/dev/null 2>&1 || true
        else
            kill "$pid" 2>/dev/null || true
        fi
    done
}

if [ -n "$(listening_pids)" ]; then
    echo "== Alter Pool-Prozess belegt die Ports, wird beendet"
    stop_pool
    sleep 2
fi

echo "== Pool starten (Log: $POOL_LOG)"
: > "$POOL_LOG"
(cd "$ROOT" && SYNDICATE_ENABLED=true npx nest start >> "$POOL_LOG" 2>&1) &
POOL_PID=$!
cleanup() {
    echo "== Pool stoppen"
    kill "$POOL_PID" 2>/dev/null || true
    stop_pool
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
grep -q "Syndicate mode on" "$POOL_LOG" || { echo "Syndikat-Modus ist nicht aktiv" >&2; tail -40 "$POOL_LOG" >&2; exit 1; }

echo "== Miner A: 2 Shares, Syndikat, DOI-Adresse $DOI_ADDRESS"
(cd "$ROOT" && node tools/testminer.js --user "$BTC_ADDRESS.synA" --pass "$DOI_ADDRESS,syndicate" --shares 2 --timeout 240)
sleep 2
echo "== Miner B: 3 Shares, Syndikat, DOI-Adresse $DOI_ADDRESS_2"
(cd "$ROOT" && node tools/testminer.js --user "$BTC_ADDRESS.synB" --pass "$DOI_ADDRESS_2,syndicate" --shares 3 --timeout 240)

sleep 3
DOI_AFTER=$(doi getblockcount)
BTC_AFTER=$(btc getblockcount)
DOI_FOUND=$((DOI_AFTER - DOI_BEFORE))
BTC_FOUND=$((BTC_AFTER - BTC_BEFORE))

echo
echo "== Ergebnis"
echo "Doichain: $DOI_BEFORE -> $DOI_AFTER ($DOI_FOUND neue Blöcke)"
echo "Bitcoin:  $BTC_BEFORE -> $BTC_AFTER ($BTC_FOUND neue Blöcke)"
echo "Syndikat-Meldungen im Pool-Log:"
grep -E "SYNDICATE BLOCK FOUND|SUBMITBLOCK" "$POOL_LOG" | tail -12 || true

if [ "$DOI_FOUND" -lt 3 ]; then
    echo "FEHLGESCHLAGEN: Doichain hat weniger als 3 Syndikat-Blöcke angenommen" >&2
    tail -60 "$POOL_LOG" >&2
    exit 1
fi

BEST=$(doi getbestblockhash)
echo
echo "== Bester Doichain-Block $BEST"
COINBASE_TXID=$(doi getblock "$BEST" | python3 -c "import sys,json; print(json.load(sys.stdin)['tx'][0])")
VOUT=$(doi getrawtransaction "$COINBASE_TXID" true "$BEST" | python3 -c "
import sys, json
tx = json.load(sys.stdin)
outs = [(o['scriptPubKey'].get('address'), o['value']) for o in tx['vout'] if o['scriptPubKey'].get('address')]
for a, v in outs:
    print(f'{a} {v}')
")
echo "$VOUT"
PAID_1=$(echo "$VOUT" | grep -c "^$DOI_ADDRESS " || true)
PAID_2=$(echo "$VOUT" | grep -c "^$DOI_ADDRESS_2 " || true)
if [ "$PAID_1" -lt 1 ] || [ "$PAID_2" -lt 1 ]; then
    echo "FEHLGESCHLAGEN: der letzte Block bezahlt nicht beide Syndikat-Mitglieder" >&2
    exit 1
fi

echo
echo "== API /api/syndicate"
curl -fsS "http://127.0.0.1:$API_PORT/api/syndicate" | python3 -c "
import sys, json
d = json.load(sys.stdin)
print('enabled', d['enabled'], 'members', len(d['members']), 'blocksFound', d['blocksFound'], 'paidOutDoi', d['paidOutDoi'])
for b in d['blocks'][:5]:
    print('block', b['height'], 'members', b['members'], 'total', b['totalDoi'], 'accepted', b['accepted'])
"

echo
echo "SYNDIKAT-TEST BESTANDEN: $DOI_FOUND Doichain-Blöcke per submitblock, der letzte zahlt beide Mitglieder."
