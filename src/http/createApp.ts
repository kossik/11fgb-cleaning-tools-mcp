import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import express, { type Request, type Response } from "express";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { AppConfig } from "../config.js";
import { calculatorDefinitions, type CalculatorId } from "../calculators/index.js";
import { createCleaningMcpServer } from "../mcp/createServer.js";
import type { CalculationService } from "../service.js";
import { calculationRateLimit } from "./rateLimit.js";

type Transport = StreamableHTTPServerTransport;

function securityHeaders(_req: Request, res: Response, next: () => void) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  next();
}

function logEvent(event: string, fields: Record<string, unknown> = {}) {
  console.log(JSON.stringify({ timestamp: new Date().toISOString(), event, ...fields }));
}

function clientType(req: Request): string {
  const userAgent = (req.header("user-agent") ?? "").toLowerCase();
  if (userAgent.includes("chatgpt") || userAgent.includes("openai")) return "openai";
  if (userAgent.includes("claude") || userAgent.includes("anthropic")) return "anthropic";
  if (userAgent.includes("cursor")) return "cursor";
  if (userAgent.includes("vscode") || userAgent.includes("visual studio code")) return "vscode";
  if (userAgent.includes("codex")) return "codex";
  return "other";
}

export function createApp(config: AppConfig, service: CalculationService) {
  const app = createMcpExpressApp({ host: "0.0.0.0" });
  const transports = new Map<string, Transport>();
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
      serverInfo: { name: "11FGB Cleaning Tools", version: "0.1.0" },
      authentication: { required: false, schemes: [] },
      transport: { type: "streamable-http", url: `${config.publicMcpUrl}/mcp` },
      tools: Object.values(calculatorDefinitions).map((definition) => ({
        name: definition.toolName,
        description: definition.description,
        inputSchema: zodToJsonSchema(definition.schema, { target: "jsonSchema7" }),
      })),
      resources: [{ uri: "ui://11fgb/cleaning-calculation.html", name: "Cleaning calculation UI" }],
      prompts: [],
    });
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
      logEvent("report_open", { calculator: result.calculator, confidence: result.location.confidence, client: clientType(req) });
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
        logEvent("report_order", { calculator: result.calculator, confidence: result.location.confidence, client: clientType(req) });
        return res.sendStatus(204);
      } catch {
        return res.sendStatus(400);
      }
    }
    const calculator = typeof req.body?.calculator === "string" ? req.body.calculator : "";
    const confidence = req.body?.confidence === "local" ? "local" : "national";
    if (!allowedActions.has(action) || !(calculator in calculatorDefinitions)) return res.sendStatus(400);
    logEvent(`report_${action}`, { calculator, confidence, client: clientType(req) });
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
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (id) => {
            transports.set(id, transport as Transport);
          },
        });
        transport.onclose = () => {
          if (transport?.sessionId) transports.delete(transport.sessionId);
        };
        await createCleaningMcpServer(config, service).connect(transport);
      }
      if (!transport) {
        return res.status(400).json({ jsonrpc: "2.0", id: null, error: { code: -32000, message: "Invalid or missing MCP session." } });
      }
      if (isToolCall) logEvent("mcp_tool_call", { tool: req.body?.params?.name, session: Boolean(sessionId), client: clientType(req) });
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
