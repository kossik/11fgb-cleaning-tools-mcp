import bundledRates from "../data/rates.json" with { type: "json" };
import type { RateDataset, RateMarket } from "./types.js";

let cached: { data: RateDataset; loadedAt: number } | undefined;
const CACHE_MS = 5 * 60 * 1000;

function validDataset(value: unknown): value is RateDataset {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<RateDataset>;
  return Boolean(row.version && row.source && row.national && Array.isArray(row.markets));
}

export async function loadRates(url?: string, token?: string): Promise<RateDataset> {
  if (!url) return bundledRates as RateDataset;
  if (cached && Date.now() - cached.loadedAt < CACHE_MS) return cached.data;

  try {
    const response = await fetch(url, {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      signal: AbortSignal.timeout(2500),
    });
    if (!response.ok) throw new Error(`Rate feed returned ${response.status}`);
    const data: unknown = await response.json();
    if (!validDataset(data)) throw new Error("Rate feed returned an invalid document");
    cached = { data, loadedAt: Date.now() };
    return data;
  } catch (error) {
    console.error(JSON.stringify({ level: "warn", event: "rate_feed_fallback", message: String(error) }));
    return cached?.data ?? (bundledRates as RateDataset);
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
