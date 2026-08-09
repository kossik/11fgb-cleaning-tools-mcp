import { createHash } from "node:crypto";

export interface AppConfig {
  port: number;
  production: boolean;
  publicSiteUrl: string;
  publicMcpUrl: string;
  reportTokenKey: Buffer;
  calculatorDataUrl?: string;
  calculatorDataToken?: string;
  analyticsSinkUrl?: string;
  analyticsSinkToken?: string;
}

function reportKey(production: boolean): Buffer {
  const encoded = process.env.REPORT_TOKEN_KEY?.trim();
  if (encoded) {
    const decoded = Buffer.from(encoded, "base64");
    if (decoded.length !== 32) {
      throw new Error("REPORT_TOKEN_KEY must be exactly 32 bytes encoded as base64.");
    }
    return decoded;
  }
  if (production) {
    throw new Error("REPORT_TOKEN_KEY is required in production.");
  }
  return createHash("sha256").update("11fgb-development-report-key").digest();
}

export function loadConfig(): AppConfig {
  const production = process.env.NODE_ENV === "production";
  const analyticsSinkUrl = process.env.ANALYTICS_SINK_URL?.trim() || undefined;
  const analyticsSinkToken = process.env.ANALYTICS_SINK_TOKEN?.trim() || undefined;
  if (Boolean(analyticsSinkUrl) !== Boolean(analyticsSinkToken)) {
    throw new Error("ANALYTICS_SINK_URL and ANALYTICS_SINK_TOKEN must be configured together.");
  }
  return {
    port: Number(process.env.PORT ?? 3400),
    production,
    publicSiteUrl: (process.env.PUBLIC_SITE_URL ?? "https://11fgb.com").replace(/\/$/, ""),
    publicMcpUrl: (process.env.PUBLIC_MCP_URL ?? "https://mcp.11fgb.com").replace(/\/$/, ""),
    reportTokenKey: reportKey(production),
    calculatorDataUrl: process.env.CALCULATOR_DATA_URL?.trim() || undefined,
    calculatorDataToken: process.env.CALCULATOR_DATA_TOKEN?.trim() || undefined,
    analyticsSinkUrl,
    analyticsSinkToken,
  };
}
