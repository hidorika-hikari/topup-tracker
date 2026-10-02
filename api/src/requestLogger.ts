import { NextFunction, Request, Response } from "express";
import { extractOrderNo, logger } from "./logger";

export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  if (req.path === "/health") return next(); // healthcheck ยิงทุก 3 วิ ไม่ log
  const start = Date.now();
  res.on("finish", () => {
    logger.info("request", {
      component: "api",
      method: req.method,
      path: req.originalUrl,
      status: res.statusCode,
      ms: Date.now() - start,
      orderNo: extractOrderNo(req.originalUrl),
    });
  });
  next();
}
