import { Router } from "express";
import { pool } from "../db";
import { asyncHandler } from "../http";

export const botsRouter = Router();

botsRouter.get("/bots", asyncHandler(async (_req, res) => {
  const r = await pool.query(
    `SELECT b.id, b.status, b.last_heartbeat_at, b.started_at, o.order_no AS current_order_no,
            EXTRACT(EPOCH FROM (now() - b.last_heartbeat_at)) AS silent_sec
     FROM bots b LEFT JOIN orders o ON o.id = b.current_order_id
     ORDER BY b.started_at DESC`
  );
  res.json({
    data: r.rows.map((b) => ({
      id: b.id,
      status: b.status,
      currentOrderNo: b.status === "BUSY" ? b.current_order_no : null,
      lastHeartbeatAt: b.last_heartbeat_at,
      silentSeconds: Math.round(Number(b.silent_sec)),
      startedAt: b.started_at,
    })),
  });
}));
