import { HttpError } from "./http";

export const ORDER_NO_RE = /^ORD-\d{13}-\d{3}$/; // ตัวอย่าง ORD-2587965432159-458

export function checkOrderNo(v: string): void {
  if (!ORDER_NO_RE.test(v)) {
    throw new HttpError(400, "INVALID_ORDER_NO", "orderNo must match ORD-<13 digits>-<3 digits>");
  }
}

export function intParam(v: unknown, def: number, name: string): number {
  if (v === undefined) return def;
  if (typeof v !== "string" || !/^\d+$/.test(v) || Number(v) < 1) {
    throw new HttpError(400, "INVALID_PARAM", `${name} must be a positive integer`);
  }
  return Number(v);
}

export function str(v: unknown, name: string, max = 100): string {
  if (typeof v !== "string" || v.trim() === "" || v.length > max) {
    throw new HttpError(400, "VALIDATION_ERROR", `${name} is required (string, max ${max} chars)`);
  }
  return v.trim();
}
