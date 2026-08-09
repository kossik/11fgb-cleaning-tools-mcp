import { z } from "zod";

const postalCode = z.string().regex(/^\d{5}(?:-\d{4})?$/, "Use a valid 5-digit US ZIP code.");

export const homeInputSchema = z.object({
  postal_code: postalCode.describe("US ZIP code used to select local or national rates."),
  property_type: z.enum(["house", "apartment", "condo", "townhouse"]).default("house"),
  square_feet: z.number().int().min(200).max(20000).describe("Total interior square footage."),
  bedrooms: z.number().int().min(0).max(20).default(2),
  bathrooms: z.number().min(0).max(20).default(1),
  cleaning_type: z.enum(["standard", "deep", "move_in_out"]).default("standard"),
  condition: z.enum(["light", "average", "heavy"]).default("average"),
  pets: z.number().int().min(0).max(10).default(0),
  frequency: z.enum(["one_time", "weekly", "biweekly", "monthly"]).default("one_time"),
  add_ons: z
    .array(z.enum(["oven", "refrigerator", "interior_windows", "inside_cabinets", "laundry", "dishes"]))
    .max(6)
    .default([]),
});

export const officeInputSchema = z.object({
  postal_code: postalCode.describe("US ZIP code used to select local or national rates."),
  square_feet: z.number().int().min(300).max(500000),
  workstations: z.number().int().min(0).max(10000).default(10),
  restrooms: z.number().int().min(0).max(200).default(1),
  kitchens: z.number().int().min(0).max(100).default(1),
  occupancy: z.enum(["low", "average", "high"]).default("average"),
  floor_type: z.enum(["mostly_hard", "mostly_carpet", "mixed"]).default("mixed"),
  service_frequency: z.enum(["weekly", "twice_weekly", "three_weekly", "five_weekly", "daily"]).default("five_weekly"),
  service_level: z.enum(["essential", "standard", "detailed"]).default("standard"),
  add_ons: z.array(z.enum(["day_porter", "interior_glass", "appliance_cleaning", "supply_restocking"])).max(4).default([]),
});

export const timeCrewInputSchema = z.object({
  postal_code: postalCode.optional().describe("Optional US ZIP code. It affects the market label, not cleaning time."),
  property_type: z.enum(["home", "apartment", "office", "retail", "vacation_rental"]),
  square_feet: z.number().int().min(200).max(500000),
  rooms_or_zones: z.number().int().min(1).max(500).default(5),
  bathrooms: z.number().min(0).max(200).default(1),
  cleaning_type: z.enum(["standard", "deep", "move_in_out", "turnover"]).default("standard"),
  condition: z.enum(["light", "average", "heavy"]).default("average"),
  max_visit_hours: z.number().min(1).max(12).default(4),
});

export const chemicalInputSchema = z.object({
  postal_code: postalCode.optional().describe("Optional US ZIP code for market context."),
  jobs_count: z.number().int().min(1).max(100000),
  average_square_feet: z.number().int().min(100).max(500000),
  product_category: z.enum(["all_purpose", "bathroom", "floor", "glass", "degreaser"]),
  cleaning_type: z.enum(["standard", "deep", "move_in_out", "commercial"]).default("standard"),
  soil_level: z.enum(["light", "average", "heavy"]).default("average"),
  dilution_ratio: z.number().min(1).max(1024).default(64).describe("Parts water per one part concentrate, such as 64 for 1:64."),
  coverage_sqft_per_gallon: z.number().min(100).max(100000).optional(),
  container_size_ounces: z.number().min(1).max(640).default(128),
  reserve_percent: z.number().min(0).max(50).default(10),
});

export type HomeInput = z.infer<typeof homeInputSchema>;
export type OfficeInput = z.infer<typeof officeInputSchema>;
export type TimeCrewInput = z.infer<typeof timeCrewInputSchema>;
export type ChemicalInput = z.infer<typeof chemicalInputSchema>;
