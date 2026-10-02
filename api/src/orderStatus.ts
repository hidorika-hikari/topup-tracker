import { PoolClient } from "pg";
import { HttpError } from "./http";

export type OrderStatus =
  | "PENDING_PAYMENT"
  | "QUEUED"
  | "IN_PROGRESS"
  | "COMPLETED"
  | "DELAYED"
  | "FAILED"
  | "EXPIRED"
  | "REFUNDED";

export const TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  PENDING_PAYMENT: ["QUEUED", "EXPIRED"],
  QUEUED: ["IN_PROGRESS", "DELAYED", "FAILED"],
  IN_PROGRESS: ["COMPLETED", "DELAYED", "FAILED"],
  DELAYED: ["QUEUED", "IN_PROGRESS", "COMPLETED", "FAILED"],
  FAILED: ["REFUNDED", "QUEUED"],
  COMPLETED: [],
  EXPIRED: [],
  REFUNDED: [],
};

export const CURRENT_STATUSES: OrderStatus[] = ["PENDING_PAYMENT", "QUEUED", "IN_PROGRESS", "DELAYED"];
export const HISTORY_STATUSES: OrderStatus[] = ["COMPLETED", "FAILED", "EXPIRED", "REFUNDED"];

export async function recordEvent(
  c: PoolClient,
  orderId: string,
  from: OrderStatus | null,
  to: OrderStatus,
  message: string
): Promise<void> {
  await c.query(
    "INSERT INTO order_events (order_id, from_status, to_status, message) VALUES ($1,$2,$3,$4)",
    [orderId, from, to, message]
  );
}

// ทุกการเปลี่ยนสถานะต้องผ่านฟังก์ชันนี้ที่เดียว (ต้องเรียกภายใน transaction)
export async function transition(
  c: PoolClient,
  orderNo: string,
  to: OrderStatus,
  message: string
): Promise<{ from: OrderStatus; to: OrderStatus }> {
  const r = await c.query("SELECT id, status FROM orders WHERE order_no = $1 FOR UPDATE", [orderNo]);
  if (r.rowCount === 0) throw new HttpError(404, "ORDER_NOT_FOUND", "Order not found");
  const { id, status: from } = r.rows[0] as { id: string; status: OrderStatus };
  if (!TRANSITIONS[from].includes(to)) {
    throw new HttpError(409, "INVALID_TRANSITION", `Cannot change status from ${from} to ${to}`);
  }
  await c.query("UPDATE orders SET status = $1, updated_at = now() WHERE id = $2", [to, id]);
  await recordEvent(c, id, from, to, message);
  return { from, to };
}
