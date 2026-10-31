// Verfügbarkeit aus den Messpunkten des Pools: fehlende Zeitfenster sind Ausfälle (der Pool misst nur, wenn er läuft).

export interface Outage {
    from: number;
    /** exclusive */
    to: number;
}

export interface Availability {
    /** 0 bis 100 */
    percent: number;
    outages: Outage[];
    /** Beginn des betrachteten Zeitraums, erster Messpunkt oder Fensteranfang */
    since: number;
    buckets: number;
}

/**
 * Teilt den Zeitraum in Fenster von bucketMs und zählt, in wie vielen ein Messpunkt liegt. Das laufende Fenster
 * bleibt außen vor, der Zeitraum beginnt frühestens mit dem ersten Messpunkt (vor dem Start gab es keine).
 */
export function availability(points: { t: number }[], windowMs: number, bucketMs: number, now: number = Date.now()): Availability {
    const end = Math.floor(now / bucketMs) * bucketMs;
    const first = points.reduce((min, p) => Math.min(min, p.t), Number.POSITIVE_INFINITY);
    const windowStart = Math.floor((now - windowMs) / bucketMs) * bucketMs;
    const start = Number.isFinite(first) ? Math.max(windowStart, Math.floor(first / bucketMs) * bucketMs) : windowStart;
    const present = new Set(points.map(p => Math.floor(p.t / bucketMs) * bucketMs));
    const outages: Outage[] = [];
    let buckets = 0;
    let up = 0;
    let gapStart: number | null = null;
    for (let bucket = start; bucket < end; bucket += bucketMs) {
        buckets++;
        if (present.has(bucket)) {
            up++;
            if (gapStart != null) {
                outages.push({ from: gapStart, to: bucket });
                gapStart = null;
            }
        } else if (gapStart == null) {
            gapStart = bucket;
        }
    }
    if (gapStart != null) {
        outages.push({ from: gapStart, to: end });
    }
    return { percent: buckets > 0 ? up / buckets * 100 : 100, outages, since: start, buckets };
}
