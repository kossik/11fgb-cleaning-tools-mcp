import type { CalculationResult, RateDataset, VisualizationItem } from "../types.js";
import { normalizePostalCode, round } from "../rates.js";
import type { OfficeInput } from "./schemas.js";
import { confidenceWarning, crewForLabor, duration, locationResult, metric, priceRange, taskRate, validateFiniteResult } from "./common.js";

const occupancyFactor = { low: 0.86, average: 1, high: 1.22 } as const;
const floorFactor = { mostly_hard: 0.96, mostly_carpet: 1, mixed: 1.08 } as const;
const serviceFactor = { essential: 0.82, standard: 1, detailed: 1.3 } as const;
const visitsPerMonth = { weekly: 4.33, twice_weekly: 8.66, three_weekly: 13, five_weekly: 21.65, daily: 30.4 } as const;
const addOnHours: Record<OfficeInput["add_ons"][number], number> = {
  day_porter: 2,
  interior_glass: 0.75,
  appliance_cleaning: 0.5,
  supply_restocking: 0.35,
};

export function estimateOffice(input: OfficeInput, rates: RateDataset): CalculationResult {
  const postalCode = normalizePostalCode(input.postal_code);
  const { market, location } = locationResult(postalCode, rates);
  const openArea = input.square_feet / taskRate(rates, "office.square_feet_per_labor_hour", 2400);
  const workstation = input.workstations * taskRate(rates, "office.workstation_labor_hours", 0.012);
  const restroom = input.restrooms * taskRate(rates, "office.restroom_labor_hours", 0.38);
  const kitchen = input.kitchens * taskRate(rates, "office.kitchen_labor_hours", 0.32);
  const extras = input.add_ons.reduce((sum, item) => sum + addOnHours[item], 0);
  const laborHours = round(
    Math.max(1.25, (openArea + workstation + restroom + kitchen) * occupancyFactor[input.occupancy] * floorFactor[input.floor_type] * serviceFactor[input.service_level] + extras),
    1,
  );
  const crewSize = crewForLabor(laborHours, 4, 12);
  const visitDuration = duration(laborHours, crewSize);
  const [visitMin, visitMax] = priceRange(laborHours, { ...market, laborRate: market.laborRate * 1.04 }, 120);
  const monthlyVisits = visitsPerMonth[input.service_frequency];
  const monthlyMin = Math.round(visitMin * monthlyVisits);
  const monthlyMax = Math.round(visitMax * monthlyVisits);
  const items: VisualizationItem[] = [
    { label: "Open areas & floors", value: round(openArea, 1), unit: "labor hr", tone: "blue" },
    { label: "Workstations", value: round(workstation, 1), unit: "labor hr", tone: "green" },
    { label: "Restrooms", value: round(restroom, 1), unit: "labor hr", tone: "orange" },
    { label: "Kitchens & add-ons", value: round(kitchen + extras, 1), unit: "labor hr", tone: "purple" },
  ];

  return validateFiniteResult({
    calculator: "office-cleaning-cost",
    methodology_version: "office-cost-1.0.0",
    locale: "en-US",
    currency: "USD",
    units: "imperial",
    location,
    headline: `Estimated office cleaning cost: $${visitMin}–$${visitMax} per visit`,
    summary: {
      price_per_visit_min: visitMin,
      price_per_visit_max: visitMax,
      monthly_price_min: monthlyMin,
      monthly_price_max: monthlyMax,
      labor_hours: laborHours,
      crew_size: crewSize,
      duration_hours: visitDuration,
    },
    metrics: [metric("Per visit", `$${visitMin}–$${visitMax}`), metric("Monthly", `$${monthlyMin.toLocaleString("en-US")}–$${monthlyMax.toLocaleString("en-US")}`), metric("Labor / visit", laborHours, "hours"), metric("Crew", crewSize, crewSize === 1 ? "cleaner" : "cleaners")],
    breakdown: items.map((item) => ({ label: item.label, value: item.value, unit: item.unit })),
    assumptions: [
      `${input.square_feet.toLocaleString("en-US")} sq ft office with ${input.workstations} workstations`,
      `${input.restrooms} restrooms and ${input.kitchens} kitchens`,
      `${input.service_frequency.replaceAll("_", " ")} ${input.service_level} service`,
      `${round(monthlyVisits, 1)} average visits per month`,
    ],
    warnings: confidenceWarning(location.confidence),
    visualization: { kind: "zones", items },
  });
}
