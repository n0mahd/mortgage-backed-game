'use strict';

function createRateLimiter(options = {}) {
    const name = options.name || 'request';
    const enabled = options.enabled !== false;
    const max = positiveInteger(options.max, 60);
    const windowMs = positiveInteger(options.windowMs, 60 * 1000);
    const keyGenerator = options.keyGenerator || defaultKeyGenerator;
    const store = new Map();
    let lastPruneAt = 0;

    // check(key) counts one hit against key and reports whether it is allowed.
    // Non-HTTP callers (MCP tools) use it directly; the middleware wraps it.
    function check(rawKey) {
        const now = Date.now();
        if (!enabled) return { allowed: true, limit: max, remaining: max, resetAt: now + windowMs, retryAfterSeconds: 0 };

        if (now - lastPruneAt > windowMs) {
            pruneExpired(store, now);
            lastPruneAt = now;
        }

        const key = `${name}:${rawKey}`;
        let record = store.get(key);
        if (!record || now >= record.resetAt) {
            record = { count: 0, resetAt: now + windowMs };
        }
        record.count += 1;
        store.set(key, record);

        return {
            allowed: record.count <= max,
            limit: max,
            remaining: Math.max(0, max - record.count),
            resetAt: record.resetAt,
            retryAfterSeconds: Math.max(1, Math.ceil((record.resetAt - now) / 1000)),
        };
    }

    function rateLimit(req, res, next) {
        if (!enabled) return next();

        const result = check(keyGenerator(req));
        res.set('X-RateLimit-Limit', String(result.limit));
        res.set('X-RateLimit-Remaining', String(result.remaining));
        res.set('X-RateLimit-Reset', String(Math.ceil(result.resetAt / 1000)));

        if (!result.allowed) {
            res.set('Retry-After', String(result.retryAfterSeconds));
            return res.status(429).json({
                error: 'Too many requests',
                retryAfterSeconds: result.retryAfterSeconds,
            });
        }

        next();
    }

    rateLimit.check = check;
    return rateLimit;
}

function defaultKeyGenerator(req) {
    return getRequestActorKey(req);
}

function getRequestActorKey(req) {
    if (req.userId) return `user:${req.userId}`;
    return `ip:${req.ip || req.socket?.remoteAddress || 'unknown'}`;
}

function pruneExpired(store, now) {
    for (const [key, record] of store.entries()) {
        if (now >= record.resetAt) store.delete(key);
    }
}

function positiveInteger(value, fallback) {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

module.exports = { createRateLimiter, getRequestActorKey };
