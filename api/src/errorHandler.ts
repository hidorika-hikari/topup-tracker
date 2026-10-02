import { NextFunction, Request, Response } from "express";
import { HttpError } from "./http";
import { extractOrderNo, logger } from "./logger";

export const errorBody = (code: string, message: string) => ({ error: { code, message } });

export function notFoundHandler(_req: Request, res: Response): void {
  res.status(404).json(errorBody("NOT_FOUND", "Route not found"));
}

export function errorHandler(err: any, req: Request, res: Response, _next: NextFunction): void {
  const orderNo = extractOrderNo(req.originalUrl ?? "");

  if (err instanceof HttpError) {
    const f = { component: "api", orderNo, status: err.status, code: err.code };
    if (err.status >= 500) logger.error(err.message, f);
    else logger.warn(err.message, f);
    res.status(err.status).json(errorBody(err.code, err.message));
    return;
  }
  if (err?.type === "entity.parse.failed") {
    logger.warn("malformed JSON body", { component: "api", orderNo, status: 400 });
    res.status(400).json(errorBody("INVALID_JSON", "Malformed JSON body"));
    return;
  }
  if (err?.type === "entity.too.large") {
    res.status(413).json(errorBody("PAYLOAD_TOO_LARGE", "Request body too large"));
    return;
  }
  logger.error(`unhandled: ${err?.message ?? err}`, { component: "api", orderNo, stack: err?.stack });
  res.status(500).json(errorBody("INTERNAL_ERROR", "Internal server error"));
}
