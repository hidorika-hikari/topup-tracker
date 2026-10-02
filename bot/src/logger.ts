const ORDER_NO_RE = /ORD-\d{13}-\d{3}/;

type Level = "info" | "warn" | "error";
type Fields = Record<string, unknown>;

export function extractOrderNo(text: string): string | undefined {
  return text.match(ORDER_NO_RE)?.[0];
}

function emit(level: Level, msg: string, fields: Fields = {}): void {
  const orderNo = (fields.orderNo as string | undefined) ?? extractOrderNo(msg);
  const line = JSON.stringify({ ts: new Date().toISOString(), level, ...fields, orderNo, msg });
  (level === "error" ? console.error : console.log)(line);
}

export const logger = {
  info: (msg: string, f?: Fields) => emit("info", msg, f),
  warn: (msg: string, f?: Fields) => emit("warn", msg, f),
  error: (msg: string, f?: Fields) => emit("error", msg, f),
};
