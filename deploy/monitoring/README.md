# Überwachung mit Uptime Kuma

Vier Monitore reichen für die Beta. Sie lassen sich in fünf Minuten von Hand anlegen oder mit
`kuma-add-monitors.py` in einem Rutsch.

| Name | Typ | Ziel | Intervall | Einstellungen |
| --- | --- | --- | --- | --- |
| NerdPool Stratum | TCP Port | `pool.doichain.org`, Port 3333 | 60 s | Wiederholungen 2, damit ein Neustart des Pools nicht alarmiert |
| NerdPool Health | HTTP(s) Keyword | `https://pool.doichain.org/api/health` | 60 s | Schlüsselwort `"ok":true`, Zertifikatsablauf-Warnung einschalten |
| NerdPool Dashboard | HTTP(s) | `https://pool.doichain.org/` | 300 s | erwartet 200 |
| NerdPool Host | Ping | Server-IP | 60 s | zeigt, ob Server oder nur Dienst weg ist |

Der Health-Endpunkt antwortet erst mit `"ok":true`, wenn beide Nodes erreichbar sind, Bitcoin Core den
Erstabgleich abgeschlossen hat und keine der beiden Ketten mehr als zwei Blöcke hinter der öffentlichen
Höhe liegt (Vergleich mit mempool.space und doi-api.sendlabs.de, alle fünf Minuten). Beispiel:

```json
{
  "ok": true,
  "bitcoin": { "reachable": true, "syncing": false, "blocks": 973807, "publicHeight": 973807, "behind": 0 },
  "doichain": { "enabled": true, "reachable": true, "blocks": 438598, "publicHeight": 438598, "behind": 0 },
  "pool": { "miners": 4, "hashRate": 4820000000000, "since": "2026-11-03T10:12:00.000Z" },
  "problems": []
}
```

Im Feld `problems` steht im Fehlerfall, was fehlt (z. B. `bitcoin syncing: 612000/973807`), das erscheint
auch in der Kuma-Meldung, wenn der Keyword-Monitor auf "Antwort anzeigen" steht.

## Skript

Legt die vier Monitore über die Socket-API von Uptime Kuma an (Bibliothek `uptime-kuma-api`, für Kuma 1.x;
vorhandene Monitore gleichen Namens werden übersprungen). Benachrichtigungen werden über ihre IDs
zugeordnet, die stehen in Kuma unter Einstellungen, Benachrichtigungen, in der URL beim Bearbeiten.

```bash
pip install uptime-kuma-api
KUMA_URL=https://kuma.example.org KUMA_USER=admin KUMA_PASSWORD=... \
POOL_DOMAIN=pool.doichain.org POOL_IP=203.0.113.10 KUMA_NOTIFICATION_IDS=1,3 \
python3 kuma-add-monitors.py
```

Die Monitore tauchen anschließend wie alle anderen im NOC-Dashboard auf.
