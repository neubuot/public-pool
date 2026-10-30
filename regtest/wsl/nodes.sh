#!/usr/bin/env bash
# Läuft in WSL (Ubuntu): lädt Bitcoin Core und Doichain Core als Linux-Binaries (Prüfsummen geprüft) und
# betreibt beide im Regtest mit denselben Ports und Zugangsdaten wie regtest/docker-compose.yml.
#   nodes.sh install | start | stop | status | btc <bitcoin-cli args> | doi <doichain-cli args>
set -euo pipefail

BASE=${NERDPOOL_REGTEST_HOME:-$HOME/nerdpool-regtest}
BIN=$BASE/bin
BTC_DATA=$BASE/bitcoin
DOI_DATA=$BASE/doichain

BITCOIN_VERSION=${BITCOIN_VERSION:-29.5}
DOICHAIN_VERSION=${DOICHAIN_VERSION:-v31.1.6}
DOICHAIND_SHA256=c0d4e634f9f1468f6625d66441c919f2b61181b29b3bf7f74f25436968ae9e95
DOICHAIN_CLI_SHA256=dd708692b55eee031089807f50cd15e7e83c5f62fb5a4fb32a9430ef33b0a516

BTC_ARGS=(-regtest "-datadir=$BTC_DATA" -rpcuser=pool -rpcpassword=pool)
DOI_ARGS=(-regtest "-datadir=$DOI_DATA" -rpcuser=pool -rpcpassword=pool -rpcport=18445)

# Von Windows aus kommen Verbindungen über die WSL-Weiterleitung aus dem privaten WSL-Netz an.
RPC_ALLOW=(-rpcbind=0.0.0.0 -rpcallowip=127.0.0.1 -rpcallowip=10.0.0.0/8 -rpcallowip=172.16.0.0/12 -rpcallowip=192.168.0.0/16)

# Quelle der Binaries: ein Verzeichnis mit fertig geladenen Dateien (NERDPOOL_DOWNLOADS, von backend.sh
# auf der Windows-Seite befüllt) oder ein direkter Download.
DOWNLOADS=${NERDPOOL_DOWNLOADS:-}

fetch() {
    local name=$1 url=$2 target=$3
    if [ -n "$DOWNLOADS" ] && [ -f "$DOWNLOADS/$name" ]; then
        cp "$DOWNLOADS/$name" "$target"
    else
        curl -fsSL -o "$target" "$url"
    fi
}

install() {
    mkdir -p "$BIN" "$BTC_DATA" "$DOI_DATA"
    if [ ! -x "$BIN/bitcoind" ]; then
        echo "Installiere Bitcoin Core $BITCOIN_VERSION"
        local tmp
        tmp=$(mktemp -d)
        local tarball="bitcoin-$BITCOIN_VERSION-x86_64-linux-gnu.tar.gz"
        local base="https://bitcoincore.org/bin/bitcoin-core-$BITCOIN_VERSION"
        fetch "$tarball" "$base/$tarball" "$tmp/$tarball"
        fetch "SHA256SUMS" "$base/SHA256SUMS" "$tmp/SHA256SUMS"
        (cd "$tmp" && grep " $tarball\$" SHA256SUMS | sha256sum -c -)
        tar -xzf "$tmp/$tarball" -C "$tmp"
        cp "$tmp/bitcoin-$BITCOIN_VERSION/bin/bitcoind" "$tmp/bitcoin-$BITCOIN_VERSION/bin/bitcoin-cli" "$BIN/"
        rm -rf "$tmp"
    fi
    if [ ! -x "$BIN/doichaind" ]; then
        echo "Installiere Doichain Core $DOICHAIN_VERSION"
        local base="https://github.com/Doichain/doichain-core/releases/download/$DOICHAIN_VERSION"
        fetch "doichaind" "$base/doichaind-$DOICHAIN_VERSION-x86_64-linux-static" "$BIN/doichaind"
        fetch "doichain-cli" "$base/doichain-cli-$DOICHAIN_VERSION-x86_64-linux-static" "$BIN/doichain-cli"
        echo "$DOICHAIND_SHA256  $BIN/doichaind" | sha256sum -c -
        echo "$DOICHAIN_CLI_SHA256  $BIN/doichain-cli" | sha256sum -c -
        chmod +x "$BIN/doichaind" "$BIN/doichain-cli"
    fi
}

btc_alive() { "$BIN/bitcoin-cli" "${BTC_ARGS[@]}" getblockchaininfo >/dev/null 2>&1; }
doi_alive() { "$BIN/doichain-cli" "${DOI_ARGS[@]}" getblockchaininfo >/dev/null 2>&1; }

start() {
    install
    if ! btc_alive; then
        echo "Starte bitcoind (regtest)"
        "$BIN/bitcoind" "${BTC_ARGS[@]}" "${RPC_ALLOW[@]}" -daemon -server=1 -fallbackfee=0.0001 \
            -zmqpubrawblock=tcp://0.0.0.0:28332 -zmqpubhashblock=tcp://0.0.0.0:28333 -listen=0 >/dev/null
    fi
    if ! doi_alive; then
        echo "Starte doichaind (regtest)"
        "$BIN/doichaind" "${DOI_ARGS[@]}" "${RPC_ALLOW[@]}" -daemon -server=1 -port=18446 \
            -zmqpubhashblock=tcp://0.0.0.0:28334 -listen=0 >/dev/null
    fi
    for i in $(seq 1 60); do
        if btc_alive && doi_alive; then
            echo "Beide Nodes laufen"
            return 0
        fi
        sleep 1
    done
    echo "Nodes nicht erreichbar, Logs: $BTC_DATA/regtest/debug.log, $DOI_DATA/regtest/debug.log" >&2
    exit 1
}

stop() {
    "$BIN/bitcoin-cli" "${BTC_ARGS[@]}" stop 2>/dev/null || true
    "$BIN/doichain-cli" "${DOI_ARGS[@]}" stop 2>/dev/null || true
}

status() {
    if btc_alive; then echo "bitcoind: Höhe $("$BIN/bitcoin-cli" "${BTC_ARGS[@]}" getblockcount)"; else echo "bitcoind: aus"; fi
    if doi_alive; then echo "doichaind: Höhe $("$BIN/doichain-cli" "${DOI_ARGS[@]}" getblockcount)"; else echo "doichaind: aus"; fi
}

case "${1:-}" in
    install) install ;;
    start) start ;;
    stop) stop ;;
    status) status ;;
    btc) shift; exec "$BIN/bitcoin-cli" "${BTC_ARGS[@]}" "$@" ;;
    doi) shift; exec "$BIN/doichain-cli" "${DOI_ARGS[@]}" "$@" ;;
    *) echo "Aufruf: nodes.sh install|start|stop|status|btc ...|doi ..." >&2; exit 2 ;;
esac
