import { describe, expect, it } from "vitest";
import ratesJson from "../data/rates.json" with { type: "json" };
import { estimateHome } from "../src/calculators/home.js";
import { estimateOffice } from "../src/calculators/office.js";
import { estimateTimeCrew } from "../src/calculators/timeCrew.js";
import { estimateChemicals } from "../src/calculators/chemicals.js";
import type { RateDataset } from "../src/types.js";

const rates = ratesJson as RateDataset;

describe("calculator golden matrix", () => {
  it("checks 50 deterministic planning scenarios", () => {
    const results = [];

    for (let index = 0; index < 15; index += 1) {
      results.push(estimateHome({
        postal_code: index % 2 ? "78704" : "90210",
        property_type: (["house", "apartment", "condo", "townhouse"] as const)[index % 4]!,
        square_feet: 700 + index * 275,
        bedrooms: index % 6,
        bathrooms: 1 + (index % 4) * 0.5,
        cleaning_type: (["standard", "deep", "move_in_out"] as const)[index % 3]!,
        condition: (["light", "average", "heavy"] as const)[index % 3]!,
        pets: index % 3,
        frequency: (["one_time", "weekly", "biweekly", "monthly"] as const)[index % 4]!,
        add_ons: index % 2 ? ["oven"] : [],
      }, rates));
    }

    for (let index = 0; index < 12; index += 1) {
      results.push(estimateOffice({
        postal_code: index % 2 ? "78610" : "10001",
        square_feet: 1000 + index * 3500,
        workstations: 5 + index * 8,
        restrooms: 1 + (index % 6),
        kitchens: 1 + (index % 3),
        occupancy: (["low", "average", "high"] as const)[index % 3]!,
        floor_type: (["mostly_hard", "mostly_carpet", "mixed"] as const)[index % 3]!,
        service_frequency: (["weekly", "twice_weekly", "three_weekly", "five_weekly", "daily"] as const)[index % 5]!,
        service_level: (["essential", "standard", "detailed"] as const)[index % 3]!,
        add_ons: index % 3 === 0 ? ["interior_glass"] : [],
      }, rates));
    }

    for (let index = 0; index < 12; index += 1) {
      results.push(estimateTimeCrew({
        postal_code: index % 2 ? "78701" : undefined,
        property_type: (["home", "apartment", "office", "retail", "vacation_rental"] as const)[index % 5]!,
        square_feet: 600 + index * 1200,
        rooms_or_zones: 3 + index,
        bathrooms: index % 5,
        cleaning_type: (["standard", "deep", "move_in_out", "turnover"] as const)[index % 4]!,
        condition: (["light", "average", "heavy"] as const)[index % 3]!,
        max_visit_hours: 2 + (index % 5),
      }, rates));
    }

    for (let index = 0; index < 11; index += 1) {
      results.push(estimateChemicals({
        postal_code: index % 2 ? "78745" : undefined,
        jobs_count: 1 + index * 7,
        average_square_feet: 600 + index * 350,
        product_category: (["all_purpose", "bathroom", "floor", "glass", "degreaser"] as const)[index % 5]!,
        cleaning_type: (["standard", "deep", "move_in_out", "commercial"] as const)[index % 4]!,
        soil_level: (["light", "average", "heavy"] as const)[index % 3]!,
        dilution_ratio: [16, 32, 64, 128][index % 4]!,
        coverage_sqft_per_gallon: undefined,
        container_size_ounces: 128,
        reserve_percent: 10,
      }, rates));
    }

    expect(results).toHaveLength(50);
    for (const result of results) {
      expect(result.headline.length).toBeGreaterThan(12);
      expect(result.breakdown.length).toBeGreaterThan(0);
      expect(result.assumptions.length).toBeGreaterThan(2);
      expect(result.summary.labor_hours).toBeGreaterThanOrEqual(0);
      expect(Number.isFinite(result.summary.duration_hours)).toBe(true);
    }
  });

  it("uses Central Texas data and national fallback", () => {
    const local = estimateHome({ postal_code: "78704", property_type: "house", square_feet: 1800, bedrooms: 3, bathrooms: 2, cleaning_type: "standard", condition: "average", pets: 0, frequency: "one_time", add_ons: [] }, rates);
    const national = estimateHome({ postal_code: "98101", property_type: "house", square_feet: 1800, bedrooms: 3, bathrooms: 2, cleaning_type: "standard", condition: "average", pets: 0, frequency: "one_time", add_ons: [] }, rates);
    expect(local.location).toMatchObject({ market_id: "central-texas", confidence: "local" });
    expect(national.location).toMatchObject({ market_id: "us-national", confidence: "national" });
    expect(national.warnings.join(" ")).toContain("national planning range");
  });

  it("increases home workload for deeper and heavier cleaning", () => {
    const base = { postal_code: "78704", property_type: "house" as const, square_feet: 2000, bedrooms: 3, bathrooms: 2, pets: 0, frequency: "one_time" as const, add_ons: [] };
    const standard = estimateHome({ ...base, cleaning_type: "standard", condition: "average" }, rates);
    const heavy = estimateHome({ ...base, cleaning_type: "deep", condition: "heavy" }, rates);
    expect(heavy.summary.labor_hours).toBeGreaterThan(standard.summary.labor_hours);
    expect(heavy.summary.price_min).toBeGreaterThan(standard.summary.price_min!);
  });

  it("uses exact dilution math and reserve", () => {
    const result = estimateChemicals({ postal_code: "78704", jobs_count: 10, average_square_feet: 1000, product_category: "all_purpose", cleaning_type: "standard", soil_level: "average", dilution_ratio: 64, coverage_sqft_per_gallon: 10000, container_size_ounces: 32, reserve_percent: 0 }, rates);
    expect(result.summary.solution_gallons).toBe(1);
    expect(result.summary.concentrate_ounces).toBe(2);
    expect(result.summary.containers).toBe(1);
  });
});
