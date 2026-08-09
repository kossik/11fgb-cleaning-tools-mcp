import type { CalculationResult, RateDataset, VisualizationItem } from "../types.js";
import { normalizePostalCode, round } from "../rates.js";
import type { HomeInput } from "./schemas.js";
import { confidenceWarning, crewForLabor, duration, locationResult, metric, priceRange, taskRate, validateFiniteResult } from "./common.js";

const propertyFactor = { house: 1, apartment: 0.9, condo: 0.94, townhouse: 0.98 } as const;
const typeFactor = { standard: 1, deep: 1.62, move_in_out: 1.78 } as const;
const conditionFactor = { light: 0.84, average: 1, heavy: 1.36 } as const;
const frequencyFactor = { one_time: 1, weekly: 0.86, biweekly: 0.92, monthly: 0.97 } as const;
const addOnHours: Record<HomeInput["add_ons"][number], number> = {
  oven: 0.65,
  refrigerator: 0.5,
  interior_windows: 0.8,
  inside_cabinets: 0.9,
  laundry: 0.45,
  dishes: 0.3,
};

export function estimateHome(input: HomeInput, rates: RateDataset): CalculationResult {
  const postalCode = normalizePostalCode(input.postal_code);
  const { market, location } = locationResult(postalCode, rates);
  const roomHours = input.bedrooms * taskRate(rates, "home.bedroom_labor_hours", 0.18);
  const bathroomHours = input.bathrooms * taskRate(rates, "home.bathroom_labor_hours", 0.48);
  const livingHours = Math.max(0.8, input.square_feet / taskRate(rates, "home.square_feet_per_labor_hour", 680));
  const petHours = Math.min(1.5, input.pets * 0.2);
  const extrasHours = input.add_ons.reduce((sum, item) => sum + addOnHours[item], 0);
  const base = (livingHours + roomHours + bathroomHours + petHours) * propertyFactor[input.property_type];
  const adjusted = base * typeFactor[input.cleaning_type] * conditionFactor[input.condition];
  const laborHours = round(Math.max(1.5, adjusted + extrasHours), 1);
  const crewSize = crewForLabor(laborHours, 3.5, 6);
  const visitDuration = duration(laborHours, crewSize);
  const [priceMin, priceMax] = priceRange(laborHours * frequencyFactor[input.frequency], market, 105);

  const visualizationItems: VisualizationItem[] = [
    { label: "Living areas & floors", value: round(livingHours * typeFactor[input.cleaning_type], 1), unit: "labor hr", tone: "blue" },
    { label: "Bedrooms", value: round(roomHours * typeFactor[input.cleaning_type], 1), unit: "labor hr", tone: "green" },
    { label: "Bathrooms", value: round(bathroomHours * typeFactor[input.cleaning_type], 1), unit: "labor hr", tone: "orange" },
  ];
  if (petHours + extrasHours > 0) {
    visualizationItems.push({ label: "Pets & add-ons", value: round(petHours + extrasHours, 1), unit: "labor hr", tone: "purple" });
  }

  return validateFiniteResult({
    calculator: "home-cleaning-cost",
    methodology_version: "home-cost-1.0.0",
    locale: "en-US",
    currency: "USD",
    units: "imperial",
    location,
    headline: `Estimated home cleaning cost: $${priceMin}–$${priceMax}`,
    summary: { price_min: priceMin, price_max: priceMax, labor_hours: laborHours, crew_size: crewSize, duration_hours: visitDuration },
    metrics: [metric("Estimated price", `$${priceMin}–$${priceMax}`), metric("Labor", laborHours, "hours"), metric("Crew", crewSize, crewSize === 1 ? "cleaner" : "cleaners"), metric("Visit", visitDuration, "hours")],
    breakdown: visualizationItems.map((item) => ({ label: item.label, value: item.value, unit: item.unit })),
    assumptions: [
      `${input.square_feet.toLocaleString("en-US")} sq ft ${input.property_type.replaceAll("_", " ")}`,
      `${input.cleaning_type.replaceAll("_", " ")} cleaning in ${input.condition} condition`,
      `${input.bedrooms} bedrooms and ${input.bathrooms} bathrooms`,
      input.frequency === "one_time" ? "One-time service" : `${input.frequency} recurring service efficiency included`,
    ],
    warnings: confidenceWarning(location.confidence),
    visualization: { kind: "rooms", items: visualizationItems },
  });
}
