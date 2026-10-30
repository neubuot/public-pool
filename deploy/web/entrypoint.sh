#!/bin/sh
# Schreibt die Laufzeit-Konfiguration des UI (API relativ unter /api, Stratum-Adresse) und startet Caddy.
set -eu

: "${POOL_DOMAIN:?POOL_DOMAIN fehlt}"
STRATUM_URL=${STRATUM_URL:-$POOL_DOMAIN:3333}

mkdir -p /srv/ui/assets
# API relativ (Caddy reicht /api an den Pool weiter). Die übrigen Schlüssel leer setzen, sonst zeigt das UI
# die eingebauten public-pool.io-Adressen. SECURE_STRATUM_URL leer -> UI zeigt <domain>:4333, der Port ist
# in der Beta nicht aktiv (steht so im README).
cat > /srv/ui/assets/runtime-config.js <<EOF
window.__PUBLIC_POOL_CONFIG__ = {"API_URL":"","STRATUM_URL":"${STRATUM_URL}","SECURE_STRATUM_URL":"","STRATUM_V2_URL":"","PPLNS_STRATUM_URL":"","PPLNS_SECURE_STRATUM_URL":"","PPLNS_STRATUM_V2_URL":"","PPLNS_DATUM_URL":""};
EOF

if [ -n "${ACME_EMAIL:-}" ]; then
    email_line="    email ${ACME_EMAIL}"
else
    email_line=""
fi
sed -e "s|%%POOL_DOMAIN%%|${POOL_DOMAIN}|g" -e "s|%%ACME_EMAIL_LINE%%|${email_line}|" /etc/caddy/Caddyfile.tpl > /etc/caddy/Caddyfile

echo "Dashboard für ${POOL_DOMAIN}, Stratum ${STRATUM_URL}"
exec caddy run --config /etc/caddy/Caddyfile --adapter caddyfile
