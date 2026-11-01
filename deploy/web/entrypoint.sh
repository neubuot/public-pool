#!/bin/sh
# Schreibt die Laufzeit-Konfiguration des Dashboards (Domain, Stratum-Port), trägt die Domain in die Rechtstexte
# ein, erzeugt das Caddyfile und startet Caddy.
set -eu

: "${POOL_DOMAIN:?POOL_DOMAIN fehlt}"
STRATUM_PORT=${STRATUM_PORT:-3333}
BETA=${POOL_BETA:-true}
# stratum+ssl-Port fürs Dashboard, leer oder 0 heißt: keinen anzeigen
case "${STRATUM_TLS_PORT:-}" in
    ''|0) TLS_PORT_JSON=null ;;
    *) TLS_PORT_JSON=${STRATUM_TLS_PORT} ;;
esac

# index.html lädt /config.js vor der App; die API ist relativ unter /api (Caddy reicht sie an den Pool weiter)
cat > /srv/ui/config.js <<EOF
window.__NERDPOOL__ = {"domain":"${POOL_DOMAIN}","stratumPort":${STRATUM_PORT},"stratumTlsPort":${TLS_PORT_JSON},"beta":${BETA}};
EOF

# Domain in die Rechtstexte eintragen (Kopie, damit ein Bind-Mount der Vorlagen schreibgeschützt bleiben kann)
if [ -d /srv/legal-src ]; then
    mkdir -p /srv/ui/legal
    cp /srv/legal-src/* /srv/ui/legal/
fi
for f in /srv/ui/legal/*.html; do
    [ -f "$f" ] && sed -i "s|{{POOL_DOMAIN}}|${POOL_DOMAIN}|g" "$f"
done

if [ -n "${ACME_EMAIL:-}" ]; then
    email_line="    email ${ACME_EMAIL}"
else
    email_line=""
fi
sed -e "s|%%POOL_DOMAIN%%|${POOL_DOMAIN}|g" -e "s|%%ACME_EMAIL_LINE%%|${email_line}|" /etc/caddy/Caddyfile.tpl > /etc/caddy/Caddyfile

echo "Dashboard für ${POOL_DOMAIN}, Stratum-Port ${STRATUM_PORT}"
exec caddy run --config /etc/caddy/Caddyfile --adapter caddyfile
