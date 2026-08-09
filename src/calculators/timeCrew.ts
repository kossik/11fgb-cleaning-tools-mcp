import type { CalculationResult, RateDataset, VisualizationItem } from "../types.js";
import { normalizePostalCode, round } from "../rates.js";
import type { TimeCrewInput } from "./schemas.js";
import { duration, locationResult, metric, taskRate, validateFiniteResult } from "./common.js";

const productivity: Record<TimeCrewInput["property_type"], number> = {
  home: 680,
  apartment: 760,
  office: 2400,
  retail: 2100,
  vacation_rental: 580,
};
const typeFactor = { standard: 1, deep: 1.62, move_in_out: 1.78, turnover: 1.22 } as const;
const conditionFactor = { light: 0.84, average: 1, heavy: 1.36 } as const;

export function estimateTimeCrew(input: TimeCrewInput, rates: RateDataset): CalculationResult {
  const postalCode = input.postal_code ? normalizePostalCode(input.postal_code) : "00000";
  const { location } = locationResult(postalCode, rates);
  const areaHours = input.square_feet / taskRate(rates, `time.${input.property_type}_productivity`, productivity[input.property_type]);
  const roomHours = input.rooms_or_zones * (input.property_type === "office" || input.property_type === "retail" ? 0.035 : 0.12);
  const bathroomHours = input.bathrooms * 0.42;
  const laborHours = round(Math.max(1, (areaHours + roomHours + bathroomHours) * typeFactor[input.cleaning_type] * conditionFactor[input.condition]), 1);
  const crewSize = Math.min(16, Math.max(1, Math.ceil(laborHours / input.max_visit_hours)));
  const visitDuration = duration(laborHours, crewSize);
  const portion = laborHours / crewSize;
  const items: VisualizationItem[] = Array.from({ length: crewSize }, (_, index) => ({
    label: `Cleaner ${index + 1}`,
    value: round(portion, 1),
    unit: "hours",
    tone: (["blue", "green", "orange", "purple"] as const)[index % 4],
  }));

  return validateFiniteResult({
    calculator: "cleaning-time-and-crew",
    methodology_version: "time-crew-1.0.0",
    locale: "en-US",
    currency: "USD",
    units: "imperial",
    location,
    headline: `${crewSize} ${crewSize === 1 ? "cleaner" : "cleaners"} for about ${visitDuration} hours`,
    summary: { labor_hours: laborHours, crew_size: crewSize, duration_hours: visitDuration },
    metrics: [metric("Total labor", laborHours, "hours"), metric("Recommended crew", crewSize, crewSize === 1 ? "cleaner" : "cleaners"), metric("Visit duration", visitDuration, "hours"), metric("Target maximum", input.max_visit_hours, "hours")],
    breakdown: [
      { label: "Area workload", value: round(areaHours, 1), unit: "labor hr" },
      { label: "Rooms / zones", value: round(roomHours, 1), unit: "labor hr" },
      { label: "Bathrooms", value: round(bathroomHours, 1), unit: "labor hr" },
    ],
    assumptions: [
      `${input.square_feet.toLocaleString("en-US")} sq ft ${input.property_type.replaceAll("_", " ")}`,
      `${input.rooms_or_zones} rooms or work zones and ${input.bathrooms} bathrooms`,
      `${input.cleaning_type.replaceAll("_", " ")} cleaning in ${input.condition} condition`,
      "Crew members are assumed to work in parallel without access delays.",
    ],
    warnings: ["Actual duration changes with layout, clutter, access, equipment, and the final scope of work."],
    visualization: { kind: "timeline", items },
  });
}
