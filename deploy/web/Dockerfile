# Übergangs-Dashboard: public-pool-ui (Angular) an einem festen Commit gebaut, ausgeliefert von Caddy,
# das zugleich TLS besorgt und /api an den Pool weiterreicht.

FROM node:22-bookworm-slim AS build
ARG UI_COMMIT=ad4bb5bb79dc445be494d440af1d9aa5d953854d
RUN apt-get update \
    && apt-get install -y --no-install-recommends git ca-certificates python3 build-essential \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /build
RUN git clone https://github.com/benjamin-wilson/public-pool-ui.git . \
    && git checkout --quiet "$UI_COMMIT"
RUN npm ci --no-audit --no-fund && npm run build
# Fußzeile mit den Rechtstexten anhängen; die vorkomprimierten Kopien der index.html sind danach veraltet
RUN sed -i 's|</body>|<div id="legal-footer" style="text-align:center;padding:14px 16px 18px;font:12px/1.5 system-ui,sans-serif;color:#8a97a6">Beta-Betrieb · <a href="/impressum" style="color:inherit">Impressum</a> · <a href="/datenschutz" style="color:inherit">Datenschutz</a> · <a href="/nutzungsbedingungen" style="color:inherit">Nutzungsbedingungen</a></div></body>|' dist/public-pool-ui/index.html \
    && rm -f dist/public-pool-ui/index.html.br dist/public-pool-ui/index.html.gz \
    && grep -q 'legal-footer' dist/public-pool-ui/index.html

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
