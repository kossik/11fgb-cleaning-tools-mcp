import { z } from "zod";

const metricSchema = z.object({
  label: z.string(),
  value: z.union([z.string(), z.number()]),
  unit: z.string().optional(),
});

const breakdownSchema = z.object({
  label: z.string(),
  value: z.number(),
  unit: z.string(),
  detail: z.string().optional(),
});

export const calculationResultSchema = z.object({
  calculator: z.enum(["home-cleaning-cost", "office-cleaning-cost", "cleaning-time-and-crew", "cleaning-chemical-usage"]),
  methodology_version: z.string(),
  locale: z.literal("en-US"),
  currency: z.literal("USD"),
  units: z.literal("imperial"),
  location: z.object({
    postal_code: z.string(),
    market_id: z.string(),
    market_label: z.string(),
    confidence: z.enum(["local", "national"]),
    data_version: z.string(),
  }),
  headline: z.string(),
  summary: z.object({
    price_min: z.number().optional(),
    price_max: z.number().optional(),
    price_per_visit_min: z.number().optional(),
    price_per_visit_max: z.number().optional(),
    monthly_price_min: z.number().optional(),
    monthly_price_max: z.number().optional(),
    labor_hours: z.number(),
    crew_size: z.number(),
    duration_hours: z.number(),
    solution_gallons: z.number().optional(),
    concentrate_ounces: z.number().optional(),
    containers: z.number().optional(),
  }),
  metrics: z.array(metricSchema),
  breakdown: z.array(breakdownSchema),
  assumptions: z.array(z.string()),
  warnings: z.array(z.string()),
  visualization: z.object({
    kind: z.enum(["rooms", "zones", "timeline", "containers"]),
    items: z.array(z.object({
      label: z.string(),
      value: z.number(),
      unit: z.string(),
      share: z.number().optional(),
      tone: z.enum(["blue", "green", "orange", "purple"]).optional(),
    })),
  }),
  visualization_url: z.string().url(),
  methodology_url: z.string().url(),
  cta_url: z.string().url(),
  expires_at: z.string().datetime(),
});
