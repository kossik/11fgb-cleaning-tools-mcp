import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AnalyticsReporter } from "../src/analytics.js";
import { loadConfig } from "../src/config.js";

const servers: Array<{ close(callback?: () => void): void }> = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(resolve))));
});

function sinkConfig() {
  const config = loadConfig();
  config.analyticsSinkUrl = "http://sink.invalid/events";
  config.analyticsSinkToken = "sink-secret";
  return config;
}

describe("analytics sink", () => {
  it("forwards only structured, privacy-safe MCP event fields", async () => {
    let resolvePayload!: (value: { authorization?: string; body: Record<string, unknown> }) => void;
    const received = new Promise<{ authorization?: string; body: Record<string, unknown> }>((resolve) => {
      resolvePayload = resolve;
    });
    const sink = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      request.on("end", () => {
        resolvePayload({
          authorization: request.headers.authorization,
          body: JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>,
        });
        response.writeHead(204).end();
      });
    });
    servers.push(sink);
    sink.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => sink.once("listening", resolve));
    const port = (sink.address() as AddressInfo).port;

    const config = loadConfig();
    config.analyticsSinkUrl = `http://127.0.0.1:${port}/events`;
    config.analyticsSinkToken = "sink-secret";
    const reporter = new AnalyticsReporter(config);
    reporter.emit("mcp_tool_call", {
      client: "chatgpt",
      client_name: "ChatGPT",
      tool: "estimate_home_cleaning_cost",
      transport: "streamable-http",
      prompt: "must never leave the MCP service",
      address: "123 Main St",
    });

    const event = await received;
    expect(event.authorization).toBe("Bearer sink-secret");
    expect(event.body).toEqual(expect.objectContaining({
      event_type: "mcp_tool_call",
      source: "chatgpt",
      client_name: "ChatGPT",
      tool_name: "estimate_home_cleaning_cost",
      metadata: { transport: "streamable-http" },
    }));
    expect(event.body).not.toHaveProperty("prompt");
    expect(event.body).not.toHaveProperty("address");
  });

  it("keeps at most two sink requests in flight and drops the oldest queued events when full", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const warn = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const calls: Array<{ tool: unknown; release: () => void }> = [];
    let active = 0;
    let maxActive = 0;
    const fetchImpl = ((_url: unknown, init?: RequestInit) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      return new Promise<Response>((resolve) => {
        calls.push({
          tool: (JSON.parse(String(init?.body)) as { tool_name?: unknown }).tool_name,
          release: () => {
            active -= 1;
            resolve(new Response(null, { status: 204 }));
          },
        });
      });
    }) as typeof fetch;
    const reporter = new AnalyticsReporter(sinkConfig(), { concurrency: 2, maxQueueSize: 3, fetchImpl });

    for (let index = 0; index < 10; index += 1) reporter.emit("mcp_tool_call", { tool: `tool_${index}` });

    expect(calls).toHaveLength(2);
    expect(reporter.stats).toEqual({ queued: 3, inFlight: 2, dropped: 5 });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain("analytics_sink_queue_full");

    const idle = reporter.idle();
    for (let released = 0; released < 5; released += 1) {
      await vi.waitFor(() => expect(calls.length).toBeGreaterThan(released));
      calls[released]?.release();
    }
    await idle;
    expect(maxActive).toBe(2);
    expect(calls.map((call) => call.tool)).toEqual(["tool_0", "tool_1", "tool_7", "tool_8", "tool_9"]);
    expect(reporter.stats).toEqual({ queued: 0, inFlight: 0, dropped: 5 });
  });

  it("gives up on a hanging sink after the timeout and pauses instead of retrying", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const warn = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const attempts: Array<{ tool: unknown; at: number }> = [];
    const fetchImpl = ((_url: unknown, init?: RequestInit) => {
      attempts.push({ tool: (JSON.parse(String(init?.body)) as { tool_name?: unknown }).tool_name, at: Date.now() });
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
      });
    }) as typeof fetch;
    const reporter = new AnalyticsReporter(sinkConfig(), { timeoutMs: 50, failureCooldownMs: 200, fetchImpl });

    reporter.emit("mcp_tool_call", { tool: "first" });
    await reporter.idle();
    expect(attempts).toHaveLength(1);
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/analytics_sink_error.*timeout/));

    reporter.emit("mcp_tool_call", { tool: "second" });
    expect(attempts).toHaveLength(1);
    await reporter.idle();
    expect(attempts.map((attempt) => attempt.tool)).toEqual(["first", "second"]);
    expect((attempts[1]?.at ?? 0) - (attempts[0]?.at ?? 0)).toBeGreaterThanOrEqual(180);
  });
});
