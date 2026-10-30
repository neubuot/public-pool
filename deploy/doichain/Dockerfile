# Doichain Core aus dem offiziellen statischen Release-Binary, Prüfsumme aus SHA256SUMS des Releases.
FROM debian:bookworm-slim

ARG DOICHAIN_VERSION=v31.1.6
ARG DOICHAIND_SHA256=c0d4e634f9f1468f6625d66441c919f2b61181b29b3bf7f74f25436968ae9e95
ARG DOICHAIN_CLI_SHA256=dd708692b55eee031089807f50cd15e7e83c5f62fb5a4fb32a9430ef33b0a516

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*

RUN set -eux; \
    base="https://github.com/Doichain/doichain-core/releases/download/${DOICHAIN_VERSION}"; \
    curl -fsSL -o /usr/local/bin/doichaind "${base}/doichaind-${DOICHAIN_VERSION}-x86_64-linux-static"; \
    curl -fsSL -o /usr/local/bin/doichain-cli "${base}/doichain-cli-${DOICHAIN_VERSION}-x86_64-linux-static"; \
    echo "${DOICHAIND_SHA256}  /usr/local/bin/doichaind" | sha256sum -c -; \
    echo "${DOICHAIN_CLI_SHA256}  /usr/local/bin/doichain-cli" | sha256sum -c -; \
    chmod +x /usr/local/bin/doichaind /usr/local/bin/doichain-cli; \
    useradd -r -m -d /data doichain

USER doichain
VOLUME /data
EXPOSE 18445 28334

ENTRYPOINT ["doichaind"]
