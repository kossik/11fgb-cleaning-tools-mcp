import type { RateDataset } from "../types.js";
import { estimateChemicals } from "./chemicals.js";
import { estimateHome } from "./home.js";
import { estimateOffice } from "./office.js";
import { chemicalInputSchema, homeInputSchema, officeInputSchema, timeCrewInputSchema } from "./schemas.js";
import { estimateTimeCrew } from "./timeCrew.js";

export const calculatorDefinitions = {
  "home-cleaning-cost": {
    toolName: "estimate_home_cleaning_cost",
    title: "Estimate home cleaning cost",
    slug: "home-cleaning-cost-calculator",
    description: "Use this when a user wants a free planning estimate for cleaning a US house, apartment, condo, or townhouse. Returns price range, labor hours, crew size, duration, assumptions, and a visual report. Do not present it as a binding quote.",
    schema: homeInputSchema,
    calculate: (input: unknown, rates: RateDataset) => estimateHome(homeInputSchema.parse(input), rates),
  },
  "office-cleaning-cost": {
    toolName: "estimate_office_cleaning_cost",
    title: "Estimate office cleaning cost",
    slug: "office-cleaning-cost-calculator",
    description: "Use this when a user wants a free office or commercial cleaning budget estimate in the United States. Returns per-visit and monthly ranges, labor, crew, schedule assumptions, and a visual report. Do not use for residential cleaning or present it as a binding bid.",
    schema: officeInputSchema,
    calculate: (input: unknown, rates: RateDataset) => estimateOffice(officeInputSchema.parse(input), rates),
  },
  "cleaning-time-and-crew": {
    toolName: "estimate_cleaning_time_and_crew",
    title: "Estimate cleaning time and crew",
    slug: "cleaning-time-and-crew-calculator",
    description: "Use this when a user asks how long a cleaning job may take or how many cleaners are needed. Works for homes, apartments, offices, retail, and vacation rentals. It estimates workload, not worker availability or a price quote.",
    schema: timeCrewInputSchema,
    calculate: (input: unknown, rates: RateDataset) => estimateTimeCrew(timeCrewInputSchema.parse(input), rates),
  },
  "cleaning-chemical-usage": {
    toolName: "calculate_cleaning_chemical_usage",
    title: "Calculate cleaning chemical usage",
    slug: "cleaning-chemical-usage-calculator",
    description: "Use this when a user needs a planning estimate for ready-to-use cleaning solution, concentrate, water, or generic container quantities across one or many jobs. It does not recommend brands and product-label directions always take precedence.",
    schema: chemicalInputSchema,
    calculate: (input: unknown, rates: RateDataset) => estimateChemicals(chemicalInputSchema.parse(input), rates),
  },
} as const;

export type CalculatorId = keyof typeof calculatorDefinitions;

export function calculatorByToolName(toolName: string) {
  return Object.entries(calculatorDefinitions).find(([, definition]) => definition.toolName === toolName);
}
