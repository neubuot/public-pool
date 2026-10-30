#!/usr/bin/env python3
"""Legt die NerdPool-Monitore in Uptime Kuma an (Bibliothek uptime-kuma-api, Kuma 1.x).

Umgebung: KUMA_URL, KUMA_USER, KUMA_PASSWORD, POOL_DOMAIN (Standard pool.doichain.org),
          POOL_IP (optional, für den Ping-Monitor), KUMA_NOTIFICATION_IDS (optional, z. B. "1,3")
"""
import os
import sys

try:
    from uptime_kuma_api import MonitorType, UptimeKumaApi
except ImportError:
    sys.exit("Bitte zuerst: pip install uptime-kuma-api")


def main() -> int:
    url = os.environ.get("KUMA_URL")
    user = os.environ.get("KUMA_USER")
    password = os.environ.get("KUMA_PASSWORD")
    if not (url and user and password):
        sys.exit("KUMA_URL, KUMA_USER und KUMA_PASSWORD setzen")

    domain = os.environ.get("POOL_DOMAIN", "pool.doichain.org")
    pool_ip = os.environ.get("POOL_IP")
    notification_ids = [int(x) for x in os.environ.get("KUMA_NOTIFICATION_IDS", "").split(",") if x.strip()]

    monitors = [
        {
            "type": MonitorType.PORT,
            "name": "NerdPool Stratum",
            "hostname": domain,
            "port": 3333,
            "interval": 60,
            "maxretries": 2,
        },
        {
            "type": MonitorType.KEYWORD,
            "name": "NerdPool Health",
            "url": f"https://{domain}/api/health",
            "keyword": '"ok":true',
            "interval": 60,
            "maxretries": 1,
            "expiryNotification": True,
        },
        {
            "type": MonitorType.HTTP,
            "name": "NerdPool Dashboard",
            "url": f"https://{domain}/",
            "interval": 300,
            "maxretries": 1,
        },
    ]
    if pool_ip:
        monitors.append({
            "type": MonitorType.PING,
            "name": "NerdPool Host",
            "hostname": pool_ip,
            "interval": 60,
            "maxretries": 2,
        })

    with UptimeKumaApi(url) as api:
        api.login(user, password)
        existing = {m["name"] for m in api.get_monitors()}
        for monitor in monitors:
            if monitor["name"] in existing:
                print(f"übersprungen (gibt es schon): {monitor['name']}")
                continue
            if notification_ids:
                monitor["notificationIDList"] = notification_ids
            result = api.add_monitor(**monitor)
            print(f"angelegt: {monitor['name']} (id {result.get('monitorID')})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
