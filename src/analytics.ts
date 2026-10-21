import { randomUUID } from "node:crypto";
import type { AppConfig } from "./config.js";

type EventFields = Record<string, unknown>;

export interface AnalyticsReporterOptions {
  /** Sink requests allowed in flight at once. */
  concurrency?: number;
  /** Events waiting for a free slot; the oldest is dropped when full. */
  maxQueueSize?: number;
  timeoutMs?: number;
  /** Pause after a failed delivery so a struggling sink is not hammered. Failed events are not retried. */
  failureCooldownMs?: number;
  fetchImpl?: typeof fetch;
}

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

/**
 * Logs events and forwards them to the private sink in the background. `emit` only enqueues, so a
 * slow or saturated sink can never hold a request or tool call open; at most `concurrency` sink
 * requests run at once and the queue is bounded.
 */
export class AnalyticsReporter {
  private readonly concurrency: number;
  private readonly maxQueueSize: number;
  private readonly timeoutMs: number;
  private readonly failureCooldownMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly queue: string[] = [];
  private inFlight = 0;
  private dropped = 0;
  private dropWarned = false;
  private pausedUntil = 0;
  private resumeTimer?: NodeJS.Timeout;
  private idleWaiters: Array<() => void> = [];

  constructor(private readonly config: AppConfig, options: AnalyticsReporterOptions = {}) {
    this.concurrency = options.concurrency ?? 2;
    this.maxQueueSize = options.maxQueueSize ?? 200;
    this.timeoutMs = options.timeoutMs ?? 3_000;
    this.failureCooldownMs = options.failureCooldownMs ?? 5_000;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

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
    this.enqueue(JSON.stringify(payload));
  }

  get stats(): { queued: number; inFlight: number; dropped: number } {
    return { queued: this.queue.length, inFlight: this.inFlight, dropped: this.dropped };
  }

  /** Resolves once every queued event has been delivered or given up on. */
  idle(): Promise<void> {
    if (this.queue.length === 0 && this.inFlight === 0) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.push(resolve));
  }

  private enqueue(body: string): void {
    if (this.queue.length >= this.maxQueueSize) {
      this.queue.shift();
      this.dropped += 1;
      if (!this.dropWarned) {
        this.dropWarned = true;
        console.error(JSON.stringify({ level: "warn", event: "analytics_sink_queue_full", max_queue: this.maxQueueSize, dropped_total: this.dropped }));
      }
    }
    this.queue.push(body);
    this.pump();
  }

  private pump(): void {
    const wait = this.pausedUntil - Date.now();
    if (wait > 0 && this.queue.length > 0) {
      if (!this.resumeTimer) {
        this.resumeTimer = setTimeout(() => {
          this.resumeTimer = undefined;
          this.pump();
        }, wait);
        this.resumeTimer.unref();
      }
      return;
    }
    while (this.inFlight < this.concurrency && this.queue.length > 0) {
      const body = this.queue.shift() as string;
      this.inFlight += 1;
      void this.send(body).finally(() => {
        this.inFlight -= 1;
        this.pump();
      });
    }
    if (this.queue.length === 0 && this.inFlight === 0) {
      this.dropWarned = false;
      for (const resolve of this.idleWaiters.splice(0)) resolve();
    }
  }

  private async send(body: string): Promise<void> {
    try {
      const response = await this.fetchImpl(this.config.analyticsSinkUrl as string, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.config.analyticsSinkToken}`,
          "content-type": "application/json",
          "user-agent": "11fgb-cleaning-tools-mcp/0.1.0",
        },
        body,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      await response.body?.cancel().catch(() => undefined);
      if (!response.ok) {
        console.error(JSON.stringify({ level: "warn", event: "analytics_sink_rejected", status: response.status }));
        if (response.status === 429 || response.status >= 500) this.pause();
      }
    } catch (error: unknown) {
      console.error(JSON.stringify({ level: "warn", event: "analytics_sink_error", message: error instanceof Error ? error.message : "unknown" }));
      this.pause();
    }
  }

  private pause(): void {
    this.pausedUntil = Math.max(this.pausedUntil, Date.now() + this.failureCooldownMs);
  }
}
