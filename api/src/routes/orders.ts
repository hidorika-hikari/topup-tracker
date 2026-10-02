import { Router } from "express";
import { createHash, randomInt } from "crypto";
import { pool, withTx } from "../db";
import { asyncHandler, HttpError } from "../http";
import { CURRENT_STATUSES, HISTORY_STATUSES, recordEvent, transition } from "../orderStatus";
import { checkOrderNo, intParam, str } from "../validation";
import { logger } from "../logger";

export const ordersRouter = Router();

const PAYMENT_TTL_MS = 15 * 60 * 1000;

function genOrderNo(): string {
  return `ORD-${Date.now()}-${String(randomInt(0, 1000)).padStart(3, "0")}`;
}

function toOrder(r: any) {
  return {
    orderNo: r.order_no,
    gameId: r.game_id,
    playerId: r.player_id,
    packageCode: r.package_code,
    amount: Number(r.amount),
    status: r.status,
    attempts: r.attempts,
    expiresAt: r.expires_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

// POST /orders
ordersRouter.post("/orders", asyncHandler(async (req, res) => {
  const body = req.body ?? {};
  const gameId = str(body.gameId, "gameId");
  const playerId = str(body.playerId, "playerId");
  const packageCode = str(body.packageCode, "packageCode");
  const amount = body.amount;
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) {
    throw new HttpError(400, "VALIDATION_ERROR", "amount must be a positive number");
  }

  const keyHeader = req.header("Idempotency-Key");
  if (keyHeader !== undefined && (keyHeader.trim() === "" || keyHeader.length > 200)) {
    throw new HttpError(400, "INVALID_IDEMPOTENCY_KEY", "Idempotency-Key must be 1-200 chars");
  }
  const key = keyHeader?.trim() ?? null;
  const hash = createHash("sha256")
    .update(JSON.stringify([gameId, playerId, packageCode, amount]))
    .digest("hex");

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const result = await withTx(async (c) => {
        const ins = await c.query(
          `INSERT INTO orders (order_no, game_id, player_id, package_code, amount, idempotency_key, request_hash, expires_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
           ON CONFLICT (idempotency_key) DO NOTHING
           RETURNING *`,
          [genOrderNo(), gameId, playerId, packageCode, amount, key, hash, new Date(Date.now() + PAYMENT_TTL_MS)]
        );
        if (ins.rowCount === 0) {
          const ex = await c.query("SELECT * FROM orders WHERE idempotency_key = $1", [key]);
          return { row: ex.rows[0], created: false };
        }
        await recordEvent(c, ins.rows[0].id, null, "PENDING_PAYMENT", "สร้างออเดอร์ รอชำระเงิน");
        return { row: ins.rows[0], created: true };
      });

      if (!result.created && result.row.request_hash !== hash) {
        throw new HttpError(409, "IDEMPOTENCY_KEY_REUSED", "Idempotency-Key was used with a different request body");
      }
      logger.info(result.created ? "สร้างออเดอร์ใหม่" : "ได้ออเดอร์เดิมจาก Idempotency-Key", {
        component: "api", orderNo: result.row.order_no,
      });
      return res.status(result.created ? 201 : 200).json(toOrder(result.row));
    } catch (e: any) {
      // order_no ชนกัน (โอกาสน้อยมาก) -> สุ่มเลขใหม่
      if (e?.code === "23505" && e?.constraint === "orders_order_no_key") continue;
      throw e;
    }
  }
  throw new HttpError(500, "ORDER_NO_COLLISION", "Could not generate order number");
}));

// GET /orders?tab=current|history&page=&limit=
ordersRouter.get("/orders", asyncHandler(async (req, res) => {
  const tab = req.query.tab ?? "current";
  if (tab !== "current" && tab !== "history") {
    throw new HttpError(400, "INVALID_PARAM", "tab must be 'current' or 'history'");
  }
  const page = intParam(req.query.page, 1, "page");
  const limit = Math.min(intParam(req.query.limit, 20, "limit"), 100);
  const statuses = tab === "current" ? CURRENT_STATUSES : HISTORY_STATUSES;

  const total = Number(
    (await pool.query("SELECT count(*) FROM orders WHERE status = ANY($1)", [statuses])).rows[0].count
  );
  const rows = await pool.query(
    `SELECT * FROM orders WHERE status = ANY($1)
     ORDER BY created_at DESC, id DESC LIMIT $2 OFFSET $3`,
    [statuses, limit, (page - 1) * limit]
  );
  res.json({
    tab,
    page,
    limit,
    total,
    totalPages: Math.ceil(total / limit),
    data: rows.rows.map(toOrder),
  });
}));

// GET /orders/:orderNo
ordersRouter.get("/orders/:orderNo", asyncHandler(async (req, res) => {
  checkOrderNo(req.params.orderNo);
  const r = await pool.query("SELECT * FROM orders WHERE order_no = $1", [req.params.orderNo]);
  if (r.rowCount === 0) throw new HttpError(404, "ORDER_NOT_FOUND", "Order not found");
  res.json(toOrder(r.rows[0]));
}));

// GET /orders/:orderNo/timeline
ordersRouter.get("/orders/:orderNo/timeline", asyncHandler(async (req, res) => {
  checkOrderNo(req.params.orderNo);
  const o = await pool.query("SELECT id, status FROM orders WHERE order_no = $1", [req.params.orderNo]);
  if (o.rowCount === 0) throw new HttpError(404, "ORDER_NOT_FOUND", "Order not found");
  const ev = await pool.query(
    "SELECT from_status, to_status, message, created_at FROM order_events WHERE order_id = $1 ORDER BY id ASC",
    [o.rows[0].id]
  );
  res.json({
    orderNo: req.params.orderNo,
    currentStatus: o.rows[0].status,
    events: ev.rows.map((e) => ({
      fromStatus: e.from_status,
      toStatus: e.to_status,
      message: e.message,
      createdAt: e.created_at,
    })),
  });
}));

// POST /orders/:orderNo/report-issue
ordersRouter.post("/orders/:orderNo/report-issue", asyncHandler(async (req, res) => {
  checkOrderNo(req.params.orderNo);
  const message = str(req.body?.message, "message", 500);
  const category = req.body?.category === undefined ? null : str(req.body.category, "category", 50);

  const out = await withTx(async (c) => {
    const o = await c.query("SELECT id, status FROM orders WHERE order_no = $1 FOR UPDATE", [req.params.orderNo]);
    if (o.rowCount === 0) throw new HttpError(404, "ORDER_NOT_FOUND", "Order not found");
    const issue = await c.query(
      "INSERT INTO order_issues (order_id, category, message) VALUES ($1,$2,$3) RETURNING id",
      [o.rows[0].id, category, message]
    );
    // ออเดอร์ที่ยังวิ่งอยู่ -> ติดธง DELAYED (รอตรวจสอบ) ส่วนออเดอร์ที่จบแล้วแค่บันทึกเรื่องไว้
    if (["QUEUED", "IN_PROGRESS"].includes(o.rows[0].status)) {
      await transition(c, req.params.orderNo, "DELAYED", `ลูกค้าแจ้งปัญหา: ${message}`);
    }
    const s = await c.query("SELECT status FROM orders WHERE id = $1", [o.rows[0].id]);
    return { issueId: issue.rows[0].id, status: s.rows[0].status };
  });
  res.status(201).json({ orderNo: req.params.orderNo, ...out });
}));

// (เสริม) POST /orders/:orderNo/pay -- จำลอง webhook ว่าลูกค้าชำระเงินแล้ว
ordersRouter.post("/orders/:orderNo/pay", asyncHandler(async (req, res) => {
  checkOrderNo(req.params.orderNo);
  await withTx(async (c) => {
    const o = await c.query("SELECT status, expires_at FROM orders WHERE order_no = $1", [req.params.orderNo]);
    if (o.rowCount === 0) throw new HttpError(404, "ORDER_NOT_FOUND", "Order not found");
    if (o.rows[0].status === "PENDING_PAYMENT" && new Date(o.rows[0].expires_at) < new Date()) {
      throw new HttpError(409, "ORDER_EXPIRED", "Payment window has expired");
    }
    await transition(c, req.params.orderNo, "QUEUED", "ชำระเงินแล้ว เข้าคิวรอ bot");
  });
  const r = await pool.query("SELECT * FROM orders WHERE order_no = $1", [req.params.orderNo]);
  res.json(toOrder(r.rows[0]));
}));
