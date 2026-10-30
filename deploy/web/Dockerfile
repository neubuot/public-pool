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

FROM caddy:2-alpine
ARG STRATUM_URL=pool.example.org:3333
ENV STRATUM_URL=$STRATUM_URL
COPY --from=build /build/dist/public-pool-ui /srv/ui
COPY Caddyfile.tpl /etc/caddy/Caddyfile.tpl
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
EXPOSE 80 443 443/udp
CMD ["/entrypoint.sh"]
