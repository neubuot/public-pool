import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

interface Bucket {
    tokens: number;
    updatedAt: number;
}

/**
 * Small per-IP token bucket for the public, unauthenticated API: the explorer proxies calls to the nodes and
 * to mempool.space, so one client must not be able to turn the pool into a free relay.
 */
export class RateLimiter {

    private readonly buckets = new Map<string, Bucket>();
    private lastSweep = Date.now();

    constructor(private readonly capacity: number, private readonly refillPerSecond: number) { }

    /** true when the request may pass */
    public take(key: string, cost = 1): boolean {
        const now = Date.now();
        let bucket = this.buckets.get(key);
        if (bucket == null) {
            bucket = { tokens: this.capacity, updatedAt: now };
            this.buckets.set(key, bucket);
        } else {
            bucket.tokens = Math.min(this.capacity, bucket.tokens + (now - bucket.updatedAt) / 1000 * this.refillPerSecond);
            bucket.updatedAt = now;
        }
        if (now - this.lastSweep > 60_000) {
            this.lastSweep = now;
            for (const [k, b] of this.buckets) {
                if (now - b.updatedAt > 120_000) {
                    this.buckets.delete(k);
                }
            }
        }
        if (bucket.tokens >= cost) {
            bucket.tokens -= cost;
            return true;
        }
        return false;
    }
}

export interface RateLimitRule {
    /** request path prefix the rule applies to */
    prefix: string;
    limiter: RateLimiter;
    /** optional: a higher cost for expensive calls under the prefix, by path substring */
    expensive?: { contains: string, cost: number }[];
}

/** Registers an onRequest hook answering 429 when a rule's bucket is empty. */
export function registerRateLimits(fastify: FastifyInstance, rules: RateLimitRule[]) {
    fastify.addHook('onRequest', (request: FastifyRequest, reply: FastifyReply, done: () => void) => {
        const url = request.url;
        for (const rule of rules) {
            if (!url.startsWith(rule.prefix)) {
                continue;
            }
            let cost = 1;
            for (const item of rule.expensive ?? []) {
                if (url.includes(item.contains)) {
                    cost = item.cost;
                }
            }
            if (!rule.limiter.take(request.ip, cost)) {
                reply.header('Retry-After', '10');
                reply.status(429).send({ statusCode: 429, message: 'Zu viele Anfragen, bitte in ein paar Sekunden erneut versuchen.' });
                return;
            }
        }
        done();
    });
}
