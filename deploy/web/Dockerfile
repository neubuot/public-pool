# Übergangs-Dashboard: public-pool-ui (Angular) an einem festen Commit gebaut, ausgeliefert von Caddy,
# das zugleich TLS besorgt und /api an den Pool weiterreicht.
#
# UI_COMMIT ist der letzte Stand, dessen Startseite nur /api/info, /api/network und /api/info/chart braucht
# (neuere Stände erwarten /api/info/accounting und /api/info/chart/payout-modes, die das Backend nicht hat)
# und der die Laufzeit-Konfiguration assets/runtime-config.js schon kennt. nerdpool-ui.patch setzt darauf
# Titel, Verbindungsanleitung mit DOI-Adresse, die Kettenspalte bei gefundenen Blöcken und entfernt die
# public-pool.io-Links und -Spendenadressen.

FROM node:22-bookworm-slim AS build
ARG UI_COMMIT=5f730f4f34846020c644ec96a9bd2b41dba847b9
RUN apt-get update \
    && apt-get install -y --no-install-recommends git ca-certificates python3 build-essential \
    && rm -rf /var/lib/apt/lists/*
COPY nerdpool-ui.patch /nerdpool-ui.patch
WORKDIR /build
RUN git clone https://github.com/benjamin-wilson/public-pool-ui.git . \
    && git checkout --quiet "$UI_COMMIT" \
    && git apply --whitespace=nowarn /nerdpool-ui.patch \
    && grep -q NerdPool src/index.html
RUN npm ci --no-audit --no-fund && npm run build
# Fußzeile mit den Rechtstexten anhängen. Der Build legt zu jeder Datei vorkomprimierte .br/.gz-Kopien an,
# die Caddy bevorzugt ausliefert: für index.html (hier geändert) und assets/runtime-config.js (wird beim
# Start vom Entrypoint geschrieben) müssen sie weg, sonst sieht der Browser den alten Inhalt.
RUN sed -i 's|</body>|<div id="legal-footer" style="text-align:center;padding:14px 16px 18px;font:12px/1.5 system-ui,sans-serif;color:#8a97a6">Beta-Betrieb · <a href="/impressum" style="color:inherit">Impressum</a> · <a href="/datenschutz" style="color:inherit">Datenschutz</a> · <a href="/nutzungsbedingungen" style="color:inherit">Nutzungsbedingungen</a></div></body>|' dist/public-pool-ui/index.html \
    && rm -f dist/public-pool-ui/index.html.br dist/public-pool-ui/index.html.gz \
       dist/public-pool-ui/assets/runtime-config.js.br dist/public-pool-ui/assets/runtime-config.js.gz \
    && grep -q 'legal-footer' dist/public-pool-ui/index.html \
    && grep -q 'NerdPool' dist/public-pool-ui/index.html

FROM caddy:2-alpine
ARG STRATUM_URL=pool.example.org:3333
ENV STRATUM_URL=$STRATUM_URL
COPY --from=build /build/dist/public-pool-ui /srv/ui
COPY legal /srv/ui/legal
COPY Caddyfile.tpl /etc/caddy/Caddyfile.tpl
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
EXPOSE 80 443 443/udp
CMD ["/entrypoint.sh"]
