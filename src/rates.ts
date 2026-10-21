import bundledRates from "../data/rates.json" with { type: "json" };
import type { RateDataset, RateMarket } from "./types.js";

const bundled = bundledRates as RateDataset;
const DEFAULT_TTL_MS = 5 * 60 * 1000;
const MIN_TTL_MS = 60 * 1000;
const MAX_TTL_MS = 60 * 60 * 1000;

export interface RateFeedOptions {
  timeoutMs?: number;
  /** Wait before trying the feed again after a failed refresh. */
  retryAfterMs?: number;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

function validDataset(value: unknown): value is RateDataset {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<RateDataset>;
  return Boolean(row.version && row.source && row.national && Array.isArray(row.markets));
}

function ttlFromCacheControl(header: string | null): number {
  const maxAge = header?.match(/(?:^|[\s,])max-age=(\d+)/i)?.[1];
  return maxAge === undefined ? DEFAULT_TTL_MS : clamp(Number(maxAge) * 1000, MIN_TTL_MS, MAX_TTL_MS);
}

/**
 * In-memory copy of the private rate feed. Calculations read it synchronously and never wait on the
 * website: once the copy is older than the feed's max-age, the last good copy (or the bundled
 * defaults before the first fetch lands) is served while a single background refresh runs.
 */
export class RateFeed {
  private readonly timeoutMs: number;
  private readonly retryAfterMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private cached?: { data: RateDataset; expiresAt: number };
  private refreshing?: Promise<void>;
  private retryAt = 0;

  constructor(private readonly url?: string, private readonly token?: string, options: RateFeedOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? 2_500;
    this.retryAfterMs = options.retryAfterMs ?? 60_000;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? Date.now;
  }

  current(): RateDataset {
    if (!this.url) return bundled;
    if (!this.cached || this.now() >= this.cached.expiresAt) void this.refresh();
    return this.cached?.data ?? bundled;
  }

  /** Starts a refresh unless one is running or a failed one is backing off; never rejects. */
  refresh(): Promise<void> {
    if (this.url && !this.refreshing && this.now() >= this.retryAt) {
      this.refreshing = this.fetchDataset(this.url).finally(() => {
        this.refreshing = undefined;
      });
    }
    return this.refreshing ?? Promise.resolve();
  }

  private async fetchDataset(url: string): Promise<void> {
    try {
      const response = await this.fetchImpl(url, {
        headers: this.token ? { Authorization: `Bearer ${this.token}` } : undefined,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        throw new Error(`Rate feed returned ${response.status}`);
      }
      const data: unknown = await response.json();
      if (!validDataset(data)) throw new Error("Rate feed returned an invalid document");
      this.cached = { data, expiresAt: this.now() + ttlFromCacheControl(response.headers.get("cache-control")) };
    } catch (error) {
      this.retryAt = this.now() + this.retryAfterMs;
      console.error(JSON.stringify({ level: "warn", event: "rate_feed_fallback", message: String(error), serving: this.cached ? "cached" : "bundled" }));
    }
  }
}

export function normalizePostalCode(value: string): string {
  const match = value.trim().match(/^(\d{5})(?:-\d{4})?$/);
  if (!match?.[1]) throw new Error("postal_code must be a valid 5-digit US ZIP code.");
  return match[1];
}

export function resolveMarket(postalCode: string, dataset: RateDataset): RateMarket {
  const exact = dataset.markets.find((market) => market.postalCodes?.includes(postalCode));
  if (exact) return exact;
  const prefix = dataset.markets.find((market) => market.zipPrefixes?.some((item) => postalCode.startsWith(item)));
  return prefix ?? dataset.national;
}

export function roundMoney(value: number): number {
  return Math.round(value);
}

export function round(value: number, digits = 1): number {
  const multiplier = 10 ** digits;
  return Math.round(value * multiplier) / multiplier;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
