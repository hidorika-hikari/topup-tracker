import express from "express";
import { healthRouter } from "./routes/health";
import { ordersRouter } from "./routes/orders";
import { botsRouter } from "./routes/bots";
import { migrate } from "./db";
import { startWatchdog } from "./watchdog";
import { errorHandler, notFoundHandler } from "./errorHandler";
import { requestLogger } from "./requestLogger";
import { logger } from "./logger";

async function main() {
  await migrate();

  const app = express();
  app.use(express.json());
  app.use(requestLogger);
  app.use(healthRouter);
  app.use(ordersRouter);
  app.use(botsRouter);
  app.use(notFoundHandler);
  app.use(errorHandler);

  const port = Number(process.env.PORT ?? 3000);
  app.listen(port, () => logger.info(`API listening on :${port}`, { component: "api" }));
  startWatchdog();
}

main().catch((e) => {
  logger.error(`fatal: ${e?.message ?? e}`, { component: "api" });
  process.exit(1);
});
