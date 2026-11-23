import Redis from "ioredis";

const LUA_INCR_EXPIRE = `
local current = redis.call("INCR", KEYS[1])
if current == 1 then
  redis.call("PEXPIRE", KEYS[1], ARGV[1])
end
local ttl = redis.call("PTTL", KEYS[1])
return {current, ttl}
`;

export function createRateLimiter(redisConfig) {
  const redis = new Redis({
    ...redisConfig,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false
  });
  redis.on("error", () => {});

  return function rateLimit({ bucket, max, windowMs, keyGenerator }) {
    return async (req, res, next) => {
      try {
        const id = keyGenerator ? keyGenerator(req) : (req.tenant?.id ? `t:${req.tenant.id}` : `ip:${req.ip || "unknown"}`);
        const key = `rl:${bucket}:${id}`;
        const [count, pttl] = await redis.eval(LUA_INCR_EXPIRE, 1, key, windowMs);
        const remaining = Math.max(0, max - Number(count));
        const resetSec = Math.max(1, Math.ceil(Number(pttl) / 1000));

        res.setHeader("X-RateLimit-Limit", String(max));
        res.setHeader("X-RateLimit-Remaining", String(remaining));
        res.setHeader("X-RateLimit-Reset", String(resetSec));

        if (Number(count) > max) {
          res.setHeader("Retry-After", String(resetSec));
          return res.status(429).json({
            error: "RATE_LIMIT_EXCEEDED",
            bucket,
            limit: max,
            retry_after_seconds: resetSec
          });
        }
        next();
      } catch {
        // Fail-open if Redis is temporarily unreachable
        next();
      }
    };
  };
}
