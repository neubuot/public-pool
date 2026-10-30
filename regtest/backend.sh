# Wird von setup.sh und e2e.sh eingebunden. Stellt btc(), doi(), nodes_up() und nodes_down() bereit,
# je nachdem, ob die Nodes in Docker oder in WSL (Ubuntu, statische Binaries) laufen.
#   REGTEST_BACKEND=auto|docker|wsl   (auto: Docker wenn erreichbar, sonst WSL)
#   WSL_DISTRO=Ubuntu
REGTEST_BACKEND=${REGTEST_BACKEND:-auto}
WSL_DISTRO=${WSL_DISTRO:-Ubuntu}
REGTEST_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)

if [ "$REGTEST_BACKEND" = auto ]; then
    if docker info >/dev/null 2>&1; then
        REGTEST_BACKEND=docker
    elif wsl -d "$WSL_DISTRO" -- true >/dev/null 2>&1; then
        REGTEST_BACKEND=wsl
    else
        echo "Weder Docker noch WSL ($WSL_DISTRO) erreichbar" >&2
        exit 1
    fi
fi
echo "Regtest-Backend: $REGTEST_BACKEND"

case "$REGTEST_BACKEND" in
    docker)
        btc() { docker exec nerdpool-bitcoind bitcoin-cli -regtest -rpcuser=pool -rpcpassword=pool "$@"; }
        doi() { docker exec nerdpool-doichaind doichain-cli -regtest -rpcuser=pool -rpcpassword=pool -rpcport=18445 "$@"; }
        nodes_up() { (cd "$REGTEST_DIR" && docker compose up -d --build); }
        nodes_down() { (cd "$REGTEST_DIR" && docker compose down); }
        ;;
    wsl)
        # Git Bash darf Linux-Pfade (/mnt/c/...) für wsl.exe nicht in Windows-Pfade umschreiben
        export MSYS_NO_PATHCONV=1
        export MSYS2_ARG_CONV_EXCL='*'
        # Die Binaries werden auf der Windows-Seite geladen (WSL hat hier oft kein DNS) und per /mnt/c übergeben.
        BITCOIN_VERSION=${BITCOIN_VERSION:-29.5}
        DOICHAIN_VERSION=${DOICHAIN_VERSION:-v31.1.6}
        DOICHAIND_SHA256=c0d4e634f9f1468f6625d66441c919f2b61181b29b3bf7f74f25436968ae9e95
        DOICHAIN_CLI_SHA256=dd708692b55eee031089807f50cd15e7e83c5f62fb5a4fb32a9430ef33b0a516
        CACHE=$REGTEST_DIR/.cache
        fetch_downloads() {
            mkdir -p "$CACHE"
            local tarball="bitcoin-$BITCOIN_VERSION-x86_64-linux-gnu.tar.gz"
            if [ ! -f "$CACHE/$tarball.ok" ]; then
                echo "Lade Bitcoin Core $BITCOIN_VERSION"
                local base="https://bitcoincore.org/bin/bitcoin-core-$BITCOIN_VERSION"
                curl -fsSL -o "$CACHE/$tarball" "$base/$tarball"
                curl -fsSL -o "$CACHE/SHA256SUMS" "$base/SHA256SUMS"
                (cd "$CACHE" && grep " $tarball\$" SHA256SUMS | sha256sum -c -)
                touch "$CACHE/$tarball.ok"
            fi
            if [ ! -f "$CACHE/doichaind.ok" ]; then
                echo "Lade Doichain Core $DOICHAIN_VERSION"
                local base="https://github.com/Doichain/doichain-core/releases/download/$DOICHAIN_VERSION"
                curl -fsSL -o "$CACHE/doichaind" "$base/doichaind-$DOICHAIN_VERSION-x86_64-linux-static"
                curl -fsSL -o "$CACHE/doichain-cli" "$base/doichain-cli-$DOICHAIN_VERSION-x86_64-linux-static"
                echo "$DOICHAIND_SHA256  $CACHE/doichaind" | sha256sum -c -
                echo "$DOICHAIN_CLI_SHA256  $CACHE/doichain-cli" | sha256sum -c -
                touch "$CACHE/doichaind.ok"
            fi
        }
        fetch_downloads

        # nodes.sh in das WSL-Home kopieren (DrvFS-Pfade und CRLF vermeiden)
        # Pfade mit Schrägstrichen (cygpath -m), Backslashes würden auf dem Weg nach WSL verschluckt
        if command -v cygpath >/dev/null 2>&1; then
            WIN_SCRIPT=$(cygpath -m "$REGTEST_DIR/wsl/nodes.sh")
            WIN_CACHE=$(cygpath -m "$CACHE")
        else
            WIN_SCRIPT=$REGTEST_DIR/wsl/nodes.sh
            WIN_CACHE=$CACHE
        fi
        WSL_SCRIPT=$(wsl -d "$WSL_DISTRO" -- wslpath -u "$WIN_SCRIPT" | tr -d '\r\0')
        WSL_CACHE=$(wsl -d "$WSL_DISTRO" -- wslpath -u "$WIN_CACHE" | tr -d '\r\0')
        wsl -d "$WSL_DISTRO" -- bash -c "mkdir -p ~/nerdpool-regtest && cp '$WSL_SCRIPT' ~/nerdpool-regtest/nodes.sh && sed -i 's/\r\$//' ~/nerdpool-regtest/nodes.sh && chmod +x ~/nerdpool-regtest/nodes.sh"
        wslnodes() {
            wsl -d "$WSL_DISTRO" -- env "NERDPOOL_DOWNLOADS=$WSL_CACHE" "BITCOIN_VERSION=$BITCOIN_VERSION" "DOICHAIN_VERSION=$DOICHAIN_VERSION" bash "\$HOME/nerdpool-regtest/nodes.sh" "$@" | tr -d '\r\0'
        }
        btc() { wslnodes btc "$@"; }
        doi() { wslnodes doi "$@"; }
        nodes_up() { wslnodes start; }
        nodes_down() { wslnodes stop; }
        ;;
    *)
        echo "Unbekanntes REGTEST_BACKEND: $REGTEST_BACKEND" >&2
        exit 1
        ;;
esac
