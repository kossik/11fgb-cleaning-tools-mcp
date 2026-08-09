import { loadConfig } from "./config.js";
import { createApp } from "./http/createApp.js";
import { CalculationService } from "./service.js";

const config = loadConfig();
const service = new CalculationService(config);
const app = createApp(config, service);

const server = app.listen(config.port, "0.0.0.0", () => {
  console.log(JSON.stringify({ event: "server_started", port: config.port, environment: config.production ? "production" : "development" }));
});

function shutdown(signal: string) {
  console.log(JSON.stringify({ event: "server_stopping", signal }));
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
