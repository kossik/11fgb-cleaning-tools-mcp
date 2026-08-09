import { randomUUID } from "node:crypto";
import type { AppConfig } from "./config.js";

type EventFields = Record<string, unknown>;

function stringField(value: unknown, maxLength = 100): string | undefined {
  if (typeof value !== "string") return undefined;
  const clean = value.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return clean ? clean.slice(0, maxLength) : undefined;
}

function metadata(fields: EventFields): Record<string, string | number | boolean> {
  const safe: Record<string, string | number | boolean> = {};
  for (const key of ["confidence", "transport", "duration_ms", "status"] as const) {
    const value = fields[key];
    if (typeof value === "string") safe[key] = value.slice(0, 100);
    else if (typeof value === "number" || typeof value === "boolean") safe[key] = value;
  }
  return safe;
}

export class AnalyticsReporter {
  constructor(private readonly config: AppConfig) {}

  emit(eventType: string, fields: EventFields = {}): void {
    console.log(JSON.stringify({ timestamp: new Date().toISOString(), event: eventType, ...fields }));
    if (!this.config.analyticsSinkUrl || !this.config.analyticsSinkToken) return;

    const source = stringField(fields.client) ?? "other";
    const payload = {
      event_id: randomUUID(),
      event_type: eventType,
      source,
      client_name: stringField(fields.client_name) ?? source,
      tool_name: stringField(fields.tool) ?? stringField(fields.calculator),
      calculator: stringField(fields.calculator),
      action: stringField(fields.action),
      correlation_key: stringField(fields.correlation_key, 64),
      metadata: metadata(fields),
    };

    void fetch(this.config.analyticsSinkUrl, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.config.analyticsSinkToken}`,
        "content-type": "application/json",
        "user-agent": "11fgb-cleaning-tools-mcp/0.1.0",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(3_000),
    }).then((response) => {
      if (!response.ok) {
        console.error(JSON.stringify({ level: "warn", event: "analytics_sink_rejected", status: response.status }));
      }
    }).catch((error: unknown) => {
      console.error(JSON.stringify({ level: "warn", event: "analytics_sink_error", message: error instanceof Error ? error.message : "unknown" }));
    });
  }
}
