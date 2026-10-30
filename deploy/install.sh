#!/usr/bin/env bash
# Richtet einen frischen Ubuntu-24.04-Server als Beta-Pool ein: Docker, Firewall, Repository, .env mit Passwörtern.
# Aufruf als root:  bash <(curl -fsSL https://raw.githubusercontent.com/neubuot/public-pool/auxpow-doichain/deploy/install.sh)
set -euo pipefail

REPO_URL=${REPO_URL:-https://github.com/neubuot/public-pool.git}
REPO_BRANCH=${REPO_BRANCH:-auxpow-doichain}
INSTALL_DIR=${INSTALL_DIR:-/opt/nerdpool}

if [ "$(id -u)" -ne 0 ]; then
    echo "Bitte als root ausführen" >&2
    exit 1
fi

echo "== Pakete"
export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get install -y -q ca-certificates curl git ufw openssl

if ! command -v docker >/dev/null 2>&1; then
    echo "== Docker (offizielles Repository)"
    install -m 0755 -d /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
    chmod a+r /etc/apt/keyrings/docker.asc
    . /etc/os-release
    # Docker pflegt neue Ubuntu-Versionen mit Verzögerung; dann die Pakete der letzten LTS nehmen
    codename=${VERSION_CODENAME}
    if ! curl -fsI "https://download.docker.com/linux/ubuntu/dists/${codename}/Release" >/dev/null 2>&1; then
        echo "Docker-Paketquelle für ${codename} gibt es noch nicht, verwende noble (Ubuntu 24.04)"
        codename=noble
    fi
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu ${codename} stable" > /etc/apt/sources.list.d/docker.list
    apt-get update -q
    apt-get install -y -q docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
    systemctl enable --now docker
fi
docker compose version

echo "== Firewall"
ufw --force default deny incoming
ufw default allow outgoing
ufw allow 22/tcp comment 'SSH'
ufw allow 80/tcp comment 'HTTP (Let''s Encrypt, Weiterleitung)'
ufw allow 443/tcp comment 'HTTPS Dashboard und API'
ufw allow 443/udp comment 'HTTP/3'
ufw allow 3333/tcp comment 'Stratum'
ufw allow 8333/tcp comment 'Bitcoin P2P'
ufw allow 8338/tcp comment 'Doichain P2P'
ufw --force enable

echo "== Repository"
if [ ! -d "$INSTALL_DIR/.git" ]; then
    git clone --branch "$REPO_BRANCH" "$REPO_URL" "$INSTALL_DIR"
else
    git -C "$INSTALL_DIR" fetch --quiet && git -C "$INSTALL_DIR" checkout --quiet "$REPO_BRANCH" && git -C "$INSTALL_DIR" pull --quiet
fi

cd "$INSTALL_DIR/deploy"
if [ ! -f .env ]; then
    cp .env.example .env
    sed -i "s|^BITCOIN_RPC_PASSWORD=.*|BITCOIN_RPC_PASSWORD=$(openssl rand -hex 24)|" .env
    sed -i "s|^DOICHAIN_RPC_PASSWORD=.*|DOICHAIN_RPC_PASSWORD=$(openssl rand -hex 24)|" .env
    chmod 600 .env
    echo ".env angelegt, RPC-Passwörter erzeugt"
fi

cat <<EOF

Fertig. Jetzt:
1. $INSTALL_DIR/deploy/.env ausfüllen: POOL_DOMAIN, DOICHAIN_DEFAULT_ADDRESS, optional ACME_EMAIL
2. DNS: A-Record der Domain auf diesen Server
3. Starten:   cd $INSTALL_DIR/deploy && docker compose up -d --build
4. Fortschritt des Erstabgleichs:   bash scripts/status.sh   (Bitcoin pruned braucht 6 bis 24 Stunden)
EOF
