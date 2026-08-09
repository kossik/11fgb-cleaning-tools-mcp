import type { CalculationResult, RateDataset, VisualizationItem } from "../types.js";
import { normalizePostalCode, round } from "../rates.js";
import type { ChemicalInput } from "./schemas.js";
import { locationResult, metric, validateFiniteResult } from "./common.js";

const defaultCoverage: Record<ChemicalInput["product_category"], number> = {
  all_purpose: 9000,
  bathroom: 5500,
  floor: 12000,
  glass: 15000,
  degreaser: 4500,
};
const cleaningFactor = { standard: 1, deep: 1.35, move_in_out: 1.5, commercial: 0.9 } as const;
const soilFactor = { light: 0.8, average: 1, heavy: 1.35 } as const;

export function estimateChemicals(input: ChemicalInput, rates: RateDataset): CalculationResult {
  const postalCode = input.postal_code ? normalizePostalCode(input.postal_code) : "00000";
  const { location } = locationResult(postalCode, rates);
  const configuredCoverage = rates.chemicalRules?.[input.product_category]?.coverageSqftPerGallon;
  const coverage = input.coverage_sqft_per_gallon ?? (configuredCoverage && configuredCoverage > 0 ? configuredCoverage : defaultCoverage[input.product_category]);
  const treatedArea = input.jobs_count * input.average_square_feet;
  const baseGallons = treatedArea / coverage;
  const solutionGallons = round(baseGallons * cleaningFactor[input.cleaning_type] * soilFactor[input.soil_level] * (1 + input.reserve_percent / 100), 2);
  const solutionOunces = solutionGallons * 128;
  const concentrateOunces = round(solutionOunces / (input.dilution_ratio + 1), 1);
  const waterGallons = round(Math.max(0, (solutionOunces - concentrateOunces) / 128), 2);
  const containers = Math.max(1, Math.ceil(concentrateOunces / input.container_size_ounces));
  const items: VisualizationItem[] = [
    { label: "Ready-to-use solution", value: solutionGallons, unit: "gal", tone: "blue" },
    { label: "Concentrate", value: concentrateOunces, unit: "fl oz", tone: "purple" },
    { label: "Water", value: waterGallons, unit: "gal", tone: "green" },
    { label: "Concentrate containers", value: containers, unit: `${input.container_size_ounces} fl oz`, tone: "orange" },
  ];

  return validateFiniteResult({
    calculator: "cleaning-chemical-usage",
    methodology_version: "chemical-usage-1.0.0",
    locale: "en-US",
    currency: "USD",
    units: "imperial",
    location,
    headline: `${solutionGallons} gallons of ready-to-use solution for ${input.jobs_count.toLocaleString("en-US")} jobs`,
    summary: {
      labor_hours: 0,
      crew_size: 0,
      duration_hours: 0,
      solution_gallons: solutionGallons,
      concentrate_ounces: concentrateOunces,
      containers,
    },
    metrics: [metric("Ready-to-use solution", solutionGallons, "gal"), metric("Concentrate", concentrateOunces, "fl oz"), metric("Water", waterGallons, "gal"), metric("Containers", containers, `${input.container_size_ounces} fl oz each`)],
    breakdown: items.map((item) => ({ label: item.label, value: item.value, unit: item.unit })),
    assumptions: [
      `${input.jobs_count.toLocaleString("en-US")} jobs averaging ${input.average_square_feet.toLocaleString("en-US")} sq ft`,
      `${coverage.toLocaleString("en-US")} sq ft of coverage per gallon of ready-to-use solution`,
      `Dilution ratio 1:${input.dilution_ratio}`,
      `${input.reserve_percent}% reserve included`,
      "Package count refers to generic concentrate containers, not a brand recommendation.",
    ],
    warnings: [
      "Follow the product label and Safety Data Sheet; label directions override this planning estimate.",
      "Never mix cleaning chemicals unless the manufacturer explicitly instructs it.",
      "Coverage varies by applicator, surface porosity, soil, and required dwell time.",
    ],
    visualization: { kind: "containers", items },
  });
}
