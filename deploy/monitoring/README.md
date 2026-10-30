# Überwachung mit Uptime Kuma

Vier Monitore reichen für die Beta. Sie sind seit 30.10.2026 in der Kuma-Instanz auf der Docker-VM angelegt
(Gruppe „DOI Labs“, Benachrichtigungen „ntfy DOI Labs“ und „ntfy Alles“) und als Kacheln im NOC-Dashboard.

| Name in Kuma | Typ | Ziel | Intervall | Einstellungen |
| --- | --- | --- | --- | --- |
| NerdPool Stratum (pool.doilabs.org:3333) | TCP Port | `pool.doilabs.org`, Port 3333 | 60 s | Wiederholungen 2, damit ein Neustart des Pools nicht alarmiert |
| NerdPool Health (pool.doilabs.org/api/health) | HTTP(s) Keyword | `https://pool.doilabs.org/api/health` | 60 s | Schlüsselwort `"ok":true`, Zertifikatsablauf-Warnung; **pausiert, bis Bitcoin Core den Erstabgleich abgeschlossen hat** |
| NerdPool Dashboard (pool.doilabs.org) | HTTP(s) | `https://pool.doilabs.org/` | 300 s | erwartet 200, Zertifikatsablauf-Warnung |
| NerdPool Host (Ping 159.195.143.151) | Ping | Server-IP | 60 s | zeigt, ob Server oder nur Dienst weg ist |

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

Im Feld `problems` steht im Fehlerfall, was fehlt (z. B. `bitcoin syncing: 612000`), das erscheint auch in
der Kuma-Meldung, wenn der Keyword-Monitor auf „Antwort anzeigen“ steht. Während des Erstabgleichs antwortet
der Endpunkt mit 503, deshalb ist der Health-Monitor pausiert angelegt und wird danach fortgesetzt.

## So wurden sie angelegt (Kuma 2 auf der Docker-VM)

Die Instanz läuft als Uptime Kuma 2; die Socket-Bibliothek `uptime-kuma-api` (unten) ist für Kuma 1.x
gebaut. Angelegt wurde deshalb nach dem bewährten Verfahren ohne Login, Skript `/root/nerdpool-kuma.py`
auf der Docker-VM (nur Python-Standardbibliothek):

1. Sicherung der Kuma-Datenbank über die SQLite-Backup-API (`kuma.db.bak-<datum>-nerdpool` im Volume `uptime-kuma_data`)
2. Container `uptime-kuma-uptime-kuma-1` anhalten
3. die vier Monitore in `monitor` einfügen (Vorlage: jüngster Monitor gleichen Typs), Benachrichtigungen in `monitor_notification`
4. Container starten, auf „healthy“ warten
5. NOC-Katalog `/opt/noc-dashboard/entries.json` um vier Kacheln ergänzen (Sicherung `entries.json.bak-<datum>-nerdpool`);
   der Generator übernimmt sie innerhalb einer Minute

```bash
python3 /root/nerdpool-kuma.py              # Trockenlauf
python3 /root/nerdpool-kuma.py --anwenden   # ausführen, vorhandene Namen werden übersprungen
python3 /root/nerdpool-kuma.py --fortsetzen "NerdPool Health (pool.doilabs.org/api/health)"   # nach dem Erstabgleich
```

Der Health-Monitor lässt sich auch in der Kuma-Oberfläche mit „Fortsetzen“ aktivieren. Ohne Eintrag im
NOC-Katalog bleibt ein Kuma-Monitor dort unsichtbar, das Skript legt beides zusammen an.

## Alternative: Socket-API (Kuma 1.x)

`kuma-add-monitors.py` legt dieselben Monitore mit den Kurznamen „NerdPool Stratum“ usw. über die Socket-API
an (Bibliothek `uptime-kuma-api`, unterstützt Kuma 1.21 bis 1.23). Benachrichtigungen werden über ihre IDs
zugeordnet, die stehen in Kuma unter Einstellungen, Benachrichtigungen, in der URL beim Bearbeiten.

```bash
pip install uptime-kuma-api
KUMA_URL=https://kuma.example.org KUMA_USER=admin KUMA_PASSWORD=... \
POOL_DOMAIN=pool.doilabs.org POOL_IP=203.0.113.10 KUMA_NOTIFICATION_IDS=1,3 \
python3 kuma-add-monitors.py
```
