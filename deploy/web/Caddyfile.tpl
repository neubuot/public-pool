{
%%ACME_EMAIL_LINE%%
}

%%POOL_DOMAIN%% {
    encode zstd gzip

    # Pool-API (NestJS, Präfix /api) im Docker-Netz
    handle /api/* {
        reverse_proxy pool:3334
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
