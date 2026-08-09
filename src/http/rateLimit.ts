import type { NextFunction, Request, Response } from "express";

interface Bucket {
  tokens: number;
  updatedAt: number;
}

const buckets = new Map<string, Bucket>();
const SESSION_CAPACITY = 15;
const SESSION_REFILL_PER_MS = 60 / 60_000;
const GATEWAY_CAPACITY = 120;
const GATEWAY_REFILL_PER_MS = 240 / 60_000;

function keyFor(req: Request): string {
  const session = req.header("mcp-session-id");
  return session ? `session:${session}` : `ip:${req.ip ?? req.socket.remoteAddress ?? "unknown"}`;
}

export function calculationRateLimit(req: Request, res: Response, next: NextFunction): void {
  const key = keyFor(req);
  const sessionBucket = key.startsWith("session:");
  const capacity = sessionBucket ? SESSION_CAPACITY : GATEWAY_CAPACITY;
  const refillPerMs = sessionBucket ? SESSION_REFILL_PER_MS : GATEWAY_REFILL_PER_MS;
  const now = Date.now();
  const previous = buckets.get(key) ?? { tokens: capacity, updatedAt: now };
  const replenished = Math.min(capacity, previous.tokens + (now - previous.updatedAt) * refillPerMs);
  if (replenished < 1) {
    buckets.set(key, { tokens: replenished, updatedAt: now });
    res.setHeader("Retry-After", String(Math.max(1, Math.ceil((1 - replenished) / refillPerMs / 1000))));
    res.status(429).json({ error: "Rate limit exceeded. Retry shortly." });
    return;
  }
  buckets.set(key, { tokens: replenished - 1, updatedAt: now });
  if (buckets.size > 20_000) {
    for (const [bucketKey, bucket] of buckets) {
      if (now - bucket.updatedAt > 10 * 60_000) buckets.delete(bucketKey);
    }
  }
  next();
}
