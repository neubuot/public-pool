#!/usr/bin/env bash
# Startet beide Regtest-Nodes, legt Wallets und Auszahlungsadressen an, mint die nötigen Startblöcke
# und schreibt die Pool-Konfiguration nach ../public-pool/.env (wird nur angelegt, wenn noch keine existiert).
set -euo pipefail
cd "$(dirname "$0")"

# shellcheck disable=SC1091
source ./backend.sh

wait_rpc() {
    local name=$1
    for i in $(seq 1 90); do
        if "$name" getblockchaininfo >/dev/null 2>&1; then
            return 0
        fi
        sleep 1
    done
    echo "RPC von $name nicht erreichbar" >&2
    exit 1
}

echo "== Nodes starten"
nodes_up

echo "== Auf RPC warten"
wait_rpc btc
wait_rpc doi

echo "== Wallets"
btc createwallet pool >/dev/null 2>&1 || btc loadwallet pool >/dev/null 2>&1 || true
doi createwallet pool >/dev/null 2>&1 || doi loadwallet pool >/dev/null 2>&1 || true

BTC_ADDRESS=$(btc -rpcwallet=pool getnewaddress pool bech32)
DOI_ADDRESS=$(doi -rpcwallet=pool getnewaddress pool bech32)

echo "== Startblöcke"
if [ "$(btc getblockcount)" -lt 101 ]; then
    btc -rpcwallet=pool generatetoaddress 101 "$BTC_ADDRESS" >/dev/null
fi
# Doichain Core 31.1.6 baut in createauxblock bei Höhen bis 16 einen 1-Byte-Coinbase-scriptSig und lehnt den
# eigenen Block mit bad-cb-length ab (OP_1..OP_16 als Höhe). Ab Höhe 17 ist der Push 2 Byte lang, deshalb vorminen.
DOI_HEIGHT=$(doi getblockcount)
if [ "$DOI_HEIGHT" -lt 17 ]; then
    doi -rpcwallet=pool generatetoaddress $((17 - DOI_HEIGHT)) "$DOI_ADDRESS" >/dev/null
fi

echo "Bitcoin  regtest Höhe $(btc getblockcount), Auszahlungsadresse $BTC_ADDRESS"
echo "Doichain regtest Höhe $(doi getblockcount), Auszahlungsadresse $DOI_ADDRESS"

cat > generated.env <<EOF
# erzeugt von regtest/setup.sh am $(date -u +%Y-%m-%dT%H:%M:%SZ)
BTC_ADDRESS=$BTC_ADDRESS
DOI_ADDRESS=$DOI_ADDRESS
EOF

POOL_ENV=../.env
if [ ! -f "$POOL_ENV" ]; then
    sed -e "s|__DOI_ADDRESS__|$DOI_ADDRESS|" pool.env.template > "$POOL_ENV"
    echo "Pool-Konfiguration nach $POOL_ENV geschrieben"
else
    echo "$POOL_ENV existiert schon, nicht überschrieben (Vorlage: regtest/pool.env.template)"
fi

echo
echo "Pool starten:   cd .. && npm run start"
echo "Test-Miner:     node tools/testminer.js --user $BTC_ADDRESS.test --pass $DOI_ADDRESS"
echo "Alles in einem: bash regtest/e2e.sh"
