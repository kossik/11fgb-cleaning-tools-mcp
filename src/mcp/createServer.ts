import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { calculatorDefinitions } from "../calculators/index.js";
import type { AppConfig } from "../config.js";
import { calculationResultSchema } from "../resultSchema.js";
import type { CalculationService } from "../service.js";

const UI_RESOURCE_URI = "ui://11fgb/cleaning-calculation.html";
const uiFile = resolve(process.cwd(), "public", "calculator-app.html");

function resultText(result: Awaited<ReturnType<CalculationService["calculate"]>>): string {
  const details = result.metrics.map((item) => `${item.label}: ${item.value}${item.unit ? ` ${item.unit}` : ""}`).join("; ");
  return `${result.headline}. ${details}. Open the interactive visual report: ${result.visualization_url} Methodology: ${result.methodology_url}`;
}

export function createCleaningMcpServer(config: AppConfig, service: CalculationService): McpServer {
  const server = new McpServer(
    { name: "11fgb-cleaning-tools", version: "0.1.0" },
    {
      instructions:
        "Free US cleaning planning calculators. Use the narrowest matching tool. Treat every price and duration as a non-binding estimate, preserve warnings, and include visualization_url when a user wants to inspect or share the result.",
    },
  );

  server.registerResource("cleaning-calculation-ui", UI_RESOURCE_URI, {}, async () => ({
    contents: [
      {
        uri: UI_RESOURCE_URI,
        mimeType: "text/html;profile=mcp-app",
        text: await readFile(uiFile, "utf8"),
        _meta: {
          ui: {
            prefersBorder: true,
            domain: config.publicMcpUrl,
            csp: {
              connectDomains: [config.publicMcpUrl, config.publicSiteUrl],
              resourceDomains: [config.publicMcpUrl],
            },
          },
        },
      },
    ],
  }));

  const registerTool = server.registerTool.bind(server) as unknown as (
    name: string,
    config: Record<string, unknown>,
    callback: (input: unknown) => Promise<Record<string, unknown>>,
  ) => void;

  for (const [calculatorId, definition] of Object.entries(calculatorDefinitions)) {
    registerTool(
      definition.toolName,
      {
        title: definition.title,
        description: definition.description,
        inputSchema: definition.schema.shape,
        outputSchema: { result: calculationResultSchema },
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
        _meta: {
          ui: { resourceUri: UI_RESOURCE_URI },
          "openai/outputTemplate": UI_RESOURCE_URI,
          "openai/toolInvocation/invoking": "Calculating…",
          "openai/toolInvocation/invoked": "Estimate ready",
        },
      },
      async (input: unknown) => {
        try {
          const result = await service.calculate(calculatorId as keyof typeof calculatorDefinitions, input);
          return {
            structuredContent: { result },
            content: [{ type: "text" as const, text: resultText(result) }],
          };
        } catch (error) {
          return {
            isError: true,
            content: [{ type: "text" as const, text: error instanceof Error ? error.message : "The estimate could not be calculated." }],
          };
        }
      },
    );
  }

  return server;
}
