#!/usr/bin/env bash
# Sichert die Pool-Datenbank (Shares-Statistik, Best Shares, gefundene Blöcke) als tar.gz.
# Die Nodes brauchen keine Sicherung, sie gleichen sich neu ab. Aufruf per Cron, z. B. täglich 03:00.
set -euo pipefail
cd "$(dirname "$0")/.."

BACKUP_DIR=${BACKUP_DIR:-/var/backups/nerdpool}
KEEP_DAYS=${KEEP_DAYS:-14}
mkdir -p "$BACKUP_DIR"

STAMP=$(date -u +%Y%m%d-%H%M%S)
TARGET="$BACKUP_DIR/pool-db-$STAMP.tar.gz"

# WAL-Datei mit sichern; für eine konsistente Kopie den Pool kurz anhalten (wenige Sekunden)
docker compose stop pool >/dev/null
docker run --rm -v nerdpool_pool-db:/db:ro -v "$BACKUP_DIR":/backup alpine:3.20 tar czf "/backup/pool-db-$STAMP.tar.gz" -C /db .
docker compose start pool >/dev/null

find "$BACKUP_DIR" -name 'pool-db-*.tar.gz' -mtime +"$KEEP_DAYS" -delete
echo "Sicherung: $TARGET ($(du -h "$TARGET" | cut -f1))"
