import { createHash, randomUUID } from "node:crypto";
import { resolve } from "node:path";
import express, { type Request, type Response } from "express";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { AppConfig } from "../config.js";
import { AnalyticsReporter } from "../analytics.js";
import { calculatorDefinitions, type CalculatorId } from "../calculators/index.js";
import { createCleaningMcpServer, cleaningServerInfo } from "../mcp/createServer.js";
import { calculationResultSchema } from "../resultSchema.js";
import type { CalculationService } from "../service.js";
import { calculationRateLimit } from "./rateLimit.js";

type Transport = StreamableHTTPServerTransport;
const calculationEnvelopeSchema = z.object({ result: calculationResultSchema });

function securityHeaders(_req: Request, res: Response, next: () => void) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  next();
}

function clientType(req: Request): string {
  if (req.header("x-11fgb-source") === "website") return "website";
  const userAgent = (req.header("user-agent") ?? "").toLowerCase();
  if (userAgent.includes("chatgpt") || userAgent.includes("openai")) return "openai";
  if (userAgent.includes("claude") || userAgent.includes("anthropic")) return "anthropic";
  if (userAgent.includes("cursor")) return "cursor";
  if (userAgent.includes("vscode") || userAgent.includes("visual studio code")) return "vscode";
  if (userAgent.includes("codex")) return "codex";
  return "other";
}

function normalizedClient(value: unknown, fallback = "other"): string {
  if (typeof value !== "string") return fallback;
  const client = value.toLowerCase();
  if (client.includes("chatgpt") || client.includes("openai")) return "chatgpt";
  if (client.includes("claude") || client.includes("anthropic")) return "claude";
  if (client.includes("perplexity")) return "perplexity";
  if (client.includes("cursor")) return "cursor";
  if (client.includes("visual studio code") || client.includes("vscode")) return "vscode";
  if (client.includes("codex")) return "codex";
  const clean = client.replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 100);
  return clean || fallback;
}

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function createApp(config: AppConfig, service: CalculationService) {
  const app = createMcpExpressApp({ host: "0.0.0.0", allowedHosts: ["mcp.11fgb.com", "localhost", "127.0.0.1"] });
  const transports = new Map<string, Transport>();
  const sessionClients = new Map<string, string>();
  const analytics = new AnalyticsReporter(config);
  const logEvent = (event: string, fields: Record<string, unknown> = {}) => analytics.emit(event, fields);
  app.set("trust proxy", 1);
  app.use(express.json({ limit: "64kb" }));
  app.use(securityHeaders);

  app.use((req, res, next) => {
    const origin = req.header("origin");
    if (origin === config.publicSiteUrl || (!config.production && origin?.startsWith("http://localhost"))) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
    }
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, MCP-Protocol-Version, MCP-Session-Id, Last-Event-ID");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    if (req.method === "OPTIONS") return res.sendStatus(204);
    next();
  });

  app.get("/health", (_req, res) => {
    res.json({ ok: true, service: "11fgb-cleaning-tools", version: "0.1.0", calculators: Object.keys(calculatorDefinitions).length });
  });

  app.get("/", (_req, res) => {
    res.json({
      name: "11FGB Cleaning Tools MCP",
      mcp: `${config.publicMcpUrl}/mcp`,
      documentation: `${config.publicSiteUrl}/developers/mcp`,
      tools: Object.values(calculatorDefinitions).map(({ toolName, title }) => ({ name: toolName, title })),
    });
  });

  app.get("/.well-known/mcp/server-card.json", (_req, res) => {
    res.json({
      serverInfo: cleaningServerInfo,
      authentication: { required: false, schemes: [] },
      transport: { type: "streamable-http", url: `${config.publicMcpUrl}/mcp` },
      tools: Object.values(calculatorDefinitions).map((definition) => ({
        name: definition.toolName,
        title: definition.title,
        description: definition.description,
        inputSchema: zodToJsonSchema(definition.schema, { target: "jsonSchema7" }),
        outputSchema: zodToJsonSchema(calculationEnvelopeSchema, { target: "jsonSchema7" }),
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      })),
      resources: [{ uri: "ui://11fgb/cleaning-calculation.html", name: "Cleaning calculation UI" }],
      prompts: [],
    });
  });

  app.get("/.well-known/glama.json", (_req, res) => {
    res.setHeader("Cache-Control", "public, max-age=300");
    res.sendFile(resolve(process.cwd(), ".well-known", "glama.json"), { dotfiles: "allow" });
  });

  app.use("/ui", express.static(resolve(process.cwd(), "public"), {
    fallthrough: false,
    setHeaders: (res) => {
      res.setHeader("Cache-Control", "public, max-age=300");
      res.setHeader("Access-Control-Allow-Origin", "*");
    },
  }));

  app.post("/api/v1/calculations/:calculator", calculationRateLimit, async (req, res) => {
    const calculator = req.params.calculator as CalculatorId;
    if (!(calculator in calculatorDefinitions)) return res.status(404).json({ error: "Unknown calculator." });
    const startedAt = performance.now();
    try {
      const result = await service.calculate(calculator, req.body);
      logEvent("calculation", { calculator, confidence: result.location.confidence, client: clientType(req), transport: "rest", duration_ms: Math.round(performance.now() - startedAt) });
      return res.json({ result });
    } catch (error) {
      logEvent("calculation_error", { calculator, message: error instanceof Error ? error.message : "unknown" });
      return res.status(400).json({ error: error instanceof Error ? error.message : "Invalid calculation input." });
    }
  });

  app.get("/api/v1/reports/:token", calculationRateLimit, async (req, res) => {
    try {
      const token = Array.isArray(req.params.token) ? req.params.token[0] : req.params.token;
      if (!token) return res.status(400).json({ error: "Missing report token." });
      const result = await service.fromToken(token);
      logEvent("report_open", { calculator: result.calculator, confidence: result.location.confidence, client: clientType(req), correlation_key: tokenHash(token) });
      res.setHeader("Cache-Control", "private, max-age=300");
      return res.json({ result });
    } catch (error) {
      const expired = error instanceof Error && error.name === "ExpiredReportError";
      return res.status(expired ? 410 : 400).json({ error: error instanceof Error ? error.message : "Invalid report." });
    }
  });

  app.post("/api/v1/events", async (req, res) => {
    const allowedActions = new Set(["share", "download", "cta"]);
    const action = typeof req.body?.action === "string" ? req.body.action : "";
    if (action === "order" && typeof req.body?.report_token === "string") {
      try {
        const result = await service.fromToken(req.body.report_token);
        logEvent("report_order", { calculator: result.calculator, confidence: result.location.confidence, client: clientType(req), action: "order", correlation_key: tokenHash(req.body.report_token) });
        return res.sendStatus(204);
      } catch {
        return res.sendStatus(400);
      }
    }
    const calculator = typeof req.body?.calculator === "string" ? req.body.calculator : "";
    const confidence = req.body?.confidence === "local" ? "local" : "national";
    if (!allowedActions.has(action) || !(calculator in calculatorDefinitions)) return res.sendStatus(400);
    logEvent(`report_${action}`, { calculator, confidence, client: clientType(req), action });
    return res.sendStatus(204);
  });

  const postMcp = async (req: Request, res: Response) => {
    const isToolCall = req.body?.method === "tools/call";
    if (isToolCall) {
      calculationRateLimit(req, res, () => undefined);
      if (res.headersSent) return;
    }
    const sessionId = req.header("mcp-session-id");
    try {
      let transport = sessionId ? transports.get(sessionId) : undefined;
      if (!transport && !sessionId && isInitializeRequest(req.body)) {
        const rawClientName = req.body?.params?.clientInfo?.name;
        const initializeClient = normalizedClient(rawClientName, clientType(req));
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (id) => {
            transports.set(id, transport as Transport);
            sessionClients.set(id, initializeClient);
          },
        });
        transport.onclose = () => {
          if (transport?.sessionId) {
            transports.delete(transport.sessionId);
            sessionClients.delete(transport.sessionId);
          }
        };
        await createCleaningMcpServer(config, service).connect(transport);
        logEvent("mcp_initialize", { client: initializeClient, client_name: typeof rawClientName === "string" ? rawClientName.slice(0, 100) : initializeClient, transport: "streamable-http" });
      }
      if (!transport) {
        return res.status(400).json({ jsonrpc: "2.0", id: null, error: { code: -32000, message: "Invalid or missing MCP session." } });
      }
      if (isToolCall) {
        const client = (sessionId ? sessionClients.get(sessionId) : undefined) ?? clientType(req);
        logEvent("mcp_tool_call", { tool: req.body?.params?.name, session: Boolean(sessionId), client, client_name: client });
      }
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      logEvent("mcp_error", { message: error instanceof Error ? error.message : "unknown" });
      if (!res.headersSent) res.status(500).json({ jsonrpc: "2.0", id: null, error: { code: -32603, message: "Internal server error" } });
    }
  };

  app.post("/mcp", postMcp);
  app.get("/mcp", async (req, res) => {
    const transport = transports.get(req.header("mcp-session-id") ?? "");
    if (!transport) return res.status(400).send("Invalid or missing MCP session ID.");
    await transport.handleRequest(req, res);
  });
  app.delete("/mcp", async (req, res) => {
    const transport = transports.get(req.header("mcp-session-id") ?? "");
    if (!transport) return res.status(400).send("Invalid or missing MCP session ID.");
    await transport.handleRequest(req, res);
  });

  return app;
}
