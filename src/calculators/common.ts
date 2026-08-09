import type { CalculationResult, RateDataset, RateMarket } from "../types.js";
import { clamp, resolveMarket, round, roundMoney } from "../rates.js";

export function taskRate(rates: RateDataset, key: string, fallback: number): number {
  const value = rates.taskRates?.[key];
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

export function crewForLabor(laborHours: number, targetDuration = 4, maximum = 8): number {
  return Math.round(clamp(Math.ceil(laborHours / targetDuration), 1, maximum));
}

export function priceRange(laborHours: number, market: RateMarket, minimum: number): [number, number] {
  const base = laborHours * market.laborRate;
  return [
    roundMoney(Math.max(minimum, base * market.priceLowFactor)),
    roundMoney(Math.max(minimum, base * market.priceHighFactor)),
  ];
}

export function locationResult(postalCode: string, dataset: RateDataset) {
  const market = resolveMarket(postalCode, dataset);
  return {
    market,
    location: {
      postal_code: postalCode === "00000" ? "Not provided" : postalCode,
      market_id: market.marketId,
      market_label: market.marketLabel,
      confidence: market.confidence,
      data_version: dataset.version,
    },
  };
}

export function duration(laborHours: number, crewSize: number): number {
  return round(laborHours / Math.max(1, crewSize), 1);
}

export function confidenceWarning(confidence: "local" | "national"): string[] {
  return confidence === "local"
    ? ["This is a planning estimate, not a binding quote. Confirm access, condition, and requested tasks before booking."]
    : [
        "This ZIP uses a national planning range rather than a verified local 11FGB rate card.",
        "This is a planning estimate, not a binding quote. Local labor costs and access conditions can change the result.",
      ];
}

export function metric(label: string, value: string | number, unit?: string) {
  return { label, value, ...(unit ? { unit } : {}) };
}

export function validateFiniteResult(result: CalculationResult): CalculationResult {
  const numbers: number[] = [
    result.summary.labor_hours,
    result.summary.crew_size,
    result.summary.duration_hours,
    ...result.breakdown.map((item) => item.value),
  ];
  if (numbers.some((value) => !Number.isFinite(value) || value < 0)) {
    throw new Error("Calculator produced an invalid numeric result.");
  }
  return result;
}
