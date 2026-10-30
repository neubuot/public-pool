{
%%ACME_EMAIL_LINE%%
}

%%POOL_DOMAIN%% {
    # Ereignisstrom des Pools (Server-sent events): ungepuffert und unkomprimiert durchreichen
    handle /api/stats/events* {
        reverse_proxy pool:3334 {
            flush_interval -1
        }
    }

    # Pool-API (NestJS, Präfix /api) im Docker-Netz
    handle /api/* {
        encode zstd gzip
        reverse_proxy pool:3334
    }

    # Rechtstexte (statische Seiten aus web/legal, per Volume ohne Neubau änderbar)
    handle /impressum {
        rewrite * /legal/impressum.html
        root * /srv/ui
        file_server
    }
    handle /datenschutz {
        rewrite * /legal/datenschutz.html
        root * /srv/ui
        file_server
    }
    handle /nutzungsbedingungen {
        rewrite * /legal/nutzungsbedingungen.html
        root * /srv/ui
        file_server
    }

    # Dashboard (Single-Page-App): gebaute Dateien, alles andere auf index.html
    handle {
        encode zstd gzip
        root * /srv/ui
        try_files {path} /index.html
        file_server
    }

    # gebaute Assets tragen einen Hash im Namen, index.html und config.js müssen frisch bleiben
    @assets path /assets/*
    header @assets Cache-Control "public, max-age=31536000, immutable"
    @fresh path / /index.html /config.js
    header @fresh Cache-Control "no-cache"

    header {
        -Server
        X-Content-Type-Options nosniff
        Referrer-Policy strict-origin-when-cross-origin
    }

    log {
        output stdout
        format console
    }
}
