import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { openReport, sealReport } from "../src/security/reportToken.js";

describe("anonymous report tokens", () => {
  const key = randomBytes(32);
  const payload = {
    calculator: "home-cleaning-cost" as const,
    input: { postal_code: "78704", square_feet: 1800 },
    methodology_version: "home-cost-1.0.0",
  };

  it("encrypts and restores a report without exposing its ZIP", () => {
    const sealed = sealReport(key, payload, Date.UTC(2026, 7, 8));
    expect(sealed.token).not.toContain("78704");
    expect(openReport(key, sealed.token, Date.UTC(2026, 7, 9))).toMatchObject(payload);
  });

  it("rejects tampering", () => {
    const sealed = sealReport(key, payload);
    const position = Math.floor(sealed.token.length / 2);
    const replacement = sealed.token[position] === "a" ? "b" : "a";
    const tampered = `${sealed.token.slice(0, position)}${replacement}${sealed.token.slice(position + 1)}`;
    expect(() => openReport(key, tampered)).toThrow("Invalid report token");
  });

  it("expires after 30 days", () => {
    const now = Date.UTC(2026, 7, 8);
    const sealed = sealReport(key, payload, now);
    expect(() => openReport(key, sealed.token, now + 31 * 24 * 60 * 60 * 1000)).toThrow("expired");
  });
});
