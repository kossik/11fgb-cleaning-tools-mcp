export type Confidence = "local" | "national";
export type CalculatorKind =
  | "home-cleaning-cost"
  | "office-cleaning-cost"
  | "cleaning-time-and-crew"
  | "cleaning-chemical-usage";

export interface RateMarket {
  marketId: string;
  marketLabel: string;
  zipPrefixes?: string[];
  postalCodes?: string[];
  laborRate: number;
  priceLowFactor: number;
  priceHighFactor: number;
  confidence: Confidence;
}

export interface RateDataset {
  version: string;
  source: string;
  national: RateMarket;
  markets: RateMarket[];
  taskRates?: Record<string, number>;
  chemicalRules?: Record<string, { coverageSqftPerGallon: number; defaultDilutionRatio: number }>;
}

export interface LocationResult {
  postal_code: string;
  market_id: string;
  market_label: string;
  confidence: Confidence;
  data_version: string;
}

export interface Metric {
  label: string;
  value: string | number;
  unit?: string;
}

export interface BreakdownItem {
  label: string;
  value: number;
  unit: string;
  detail?: string;
}

export interface VisualizationItem {
  label: string;
  value: number;
  unit: string;
  share?: number;
  tone?: "blue" | "green" | "orange" | "purple";
}

export interface CalculationResult {
  calculator: CalculatorKind;
  methodology_version: string;
  locale: "en-US";
  currency: "USD";
  units: "imperial";
  location: LocationResult;
  headline: string;
  summary: {
    price_min?: number;
    price_max?: number;
    price_per_visit_min?: number;
    price_per_visit_max?: number;
    monthly_price_min?: number;
    monthly_price_max?: number;
    labor_hours: number;
    crew_size: number;
    duration_hours: number;
    solution_gallons?: number;
    concentrate_ounces?: number;
    containers?: number;
  };
  metrics: Metric[];
  breakdown: BreakdownItem[];
  assumptions: string[];
  warnings: string[];
  visualization: {
    kind: "rooms" | "zones" | "timeline" | "containers";
    items: VisualizationItem[];
  };
  visualization_url?: string;
  methodology_url?: string;
  cta_url?: string;
  expires_at?: string;
}

export interface SealedReportPayload {
  calculator: CalculatorKind;
  input: Record<string, unknown>;
  methodology_version: string;
  exp: number;
}
