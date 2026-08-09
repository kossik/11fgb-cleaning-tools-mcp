import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { AnalyticsReporter } from "../src/analytics.js";
import { loadConfig } from "../src/config.js";

const servers: Array<{ close(callback?: () => void): void }> = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(resolve))));
});

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
});
