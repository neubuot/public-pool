# NerdPool-Dashboard (web/, Vite + Svelte) gebaut und von Caddy ausgeliefert, das zugleich TLS besorgt und
# /api an den Pool weiterreicht. Build-Kontext ist das Repository (docker-compose.yml: context ..).

FROM node:24-bookworm-slim AS build
WORKDIR /build
COPY web/package.json web/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY web/ ./
RUN npm run build \
    && test -f dist/index.html \
    && grep -q NerdPool dist/index.html

FROM caddy:2-alpine
COPY --from=build /build/dist /srv/ui
COPY deploy/web/legal /srv/ui/legal
COPY deploy/web/Caddyfile.tpl /etc/caddy/Caddyfile.tpl
COPY deploy/web/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
EXPOSE 80 443 443/udp
CMD ["/entrypoint.sh"]
