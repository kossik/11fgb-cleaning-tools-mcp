import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createApp } from "../src/http/createApp.js";
import { loadConfig } from "../src/config.js";
import { CalculationService } from "../src/service.js";

const servers: Array<{ close(callback?: () => void): void }> = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(resolve))));
});

async function listen() {
  const config = loadConfig();
  const app = createApp(config, new CalculationService(config));
  const server = app.listen(0, "127.0.0.1");
  servers.push(server);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const port = (server.address() as AddressInfo).port;
  return `http://127.0.0.1:${port}`;
}

describe("HTTP and MCP contracts", () => {
  it("serves health, REST calculations, and recoverable reports", async () => {
    const origin = await listen();
    const health = await fetch(`${origin}/health`).then((response) => response.json()) as { ok: boolean; calculators: number };
    expect(health).toEqual(expect.objectContaining({ ok: true, calculators: 4 }));

    const glamaResponse = await fetch(`${origin}/.well-known/glama.json`);
    expect(glamaResponse.status).toBe(200);
    expect(glamaResponse.headers.get("content-type")).toContain("application/json");
    await expect(glamaResponse.json()).resolves.toEqual({
      $schema: "https://glama.ai/mcp/schemas/connector.json",
      maintainers: [{ email: "kossik@gmail.com" }],
    });

    const response = await fetch(`${origin}/api/v1/calculations/home-cleaning-cost`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ postal_code: "78704", square_feet: 1800, bedrooms: 3, bathrooms: 2 }),
    });
    expect(response.status).toBe(200);
    const body = await response.json() as { result: { visualization_url: string; headline: string } };
    expect(body.result.headline).toContain("Estimated home cleaning cost");
    const token = body.result.visualization_url.split("/").at(-1)!;
    const report = await fetch(`${origin}/api/v1/reports/${encodeURIComponent(token)}`);
    expect(report.status).toBe(200);
  });

  it("exposes four focused MCP tools and structured fallback content", async () => {
    const origin = await listen();
    const client = new Client({ name: "11fgb-contract-test", version: "1.0.0" });
    const transport = new StreamableHTTPClientTransport(new URL(`${origin}/mcp`));
    await client.connect(transport);
    const listed = await client.listTools();
    expect(listed.tools.map((tool) => tool.name).sort()).toEqual([
      "calculate_cleaning_chemical_usage",
      "estimate_cleaning_time_and_crew",
      "estimate_home_cleaning_cost",
      "estimate_office_cleaning_cost",
    ]);
    for (const tool of listed.tools) {
      expect(tool.inputSchema).toMatchObject({ type: "object" });
      expect(tool.outputSchema).toMatchObject({ type: "object" });
      expect(tool.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false, idempotentHint: true });
      expect(tool.description?.length).toBeGreaterThan(80);
    }
    const result = await client.callTool({
      name: "estimate_home_cleaning_cost",
      arguments: { postal_code: "78704", square_feet: 1600, bedrooms: 3, bathrooms: 2 },
    });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toHaveProperty("result.visualization_url");
    expect(result.content).toEqual(expect.arrayContaining([expect.objectContaining({ type: "text" })]));
    await client.close();
  });

  it.each([
    ["home-cleaning-cost", { postal_code: "bad", square_feet: 1800 }],
    ["home-cleaning-cost", { postal_code: "78704" }],
    ["office-cleaning-cost", { postal_code: "78701", square_feet: 500001 }],
    ["cleaning-chemical-usage", { jobs_count: 0, average_square_feet: 1000, product_category: "floor" }],
    ["cleaning-chemical-usage", { jobs_count: 1, average_square_feet: 1000, product_category: "floor", dilution_ratio: 2048 }],
  ])("rejects invalid boundary input for %s", async (calculator, input) => {
    const origin = await listen();
    const response = await fetch(`${origin}/api/v1/calculations/${calculator}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
    expect(response.status).toBe(400);
  });

  it("returns explicit chemical safety warnings", async () => {
    const origin = await listen();
    const response = await fetch(`${origin}/api/v1/calculations/cleaning-chemical-usage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jobs_count: 5, average_square_feet: 1600, product_category: "bathroom", dilution_ratio: 32 }),
    });
    const body = await response.json() as { result: { warnings: string[] } };
    expect(response.status).toBe(200);
    expect(body.result.warnings.join(" ")).toMatch(/Never mix|label|Safety Data Sheet/);
  });
});
