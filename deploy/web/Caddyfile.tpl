{
%%ACME_EMAIL_LINE%%
}

%%POOL_DOMAIN%% {
    encode zstd gzip

    # Pool-API (NestJS, Präfix /api) im Docker-Netz
    handle /api/* {
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

    # Dashboard (Angular, Single-Page-App)
    handle {
        root * /srv/ui
        try_files {path} /index.html
        file_server {
            precompressed br gzip
        }
    }

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
