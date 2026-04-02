import http from "http";
import app from "./app";
import { logger } from "./lib/logger";
import { setupWebSocket } from "./routes/websocket";

const rawPort = process.env["PORT"] ?? "3000";

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

// Validate required environment variables before starting.
if (!process.env.SESSION_SECRET?.trim()) {
  logger.error("SESSION_SECRET environment variable is required — set it in your .env or deployment config");
  process.exit(1);
}

const server = http.createServer(app);
setupWebSocket(server);

app.get("/healthz", (_req, res) => {
  res.json({ status: "ok" });
});

server.listen(port, (err?: Error) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
});

const shutdown = () => server.close(() => process.exit(0));
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
