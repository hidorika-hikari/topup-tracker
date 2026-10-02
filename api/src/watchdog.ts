import { PoolClient } from "pg";
import { pool, withTx } from "./db";
import { transition } from "./orderStatus";
import { logger } from "./logger";

const INTERVAL_MS = Number(process.env.WATCHDOG_INTERVAL_MS ?? 5000);
const BOT_DOWN_SEC = Number(process.env.BOT_DOWN_SEC ?? 15);
const MAX_ATTEMPTS = Number(process.env.MAX_ATTEMPTS ?? 3);
const REFUND_AFTER_SEC = Number(process.env.REFUND_AFTER_SEC ?? 10);

const log = (m: string) => logger.info(m, { component: "watchdog" });

type Row = {
  id: string;
  order_no: string;
  status: string;
  attempts: number;
  payment_ref: string | null;
  locked_by: string | null;
};

// หาออเดอร์ที่เข้าเงื่อนไข แล้วจัดการทีละใบใน transaction ของตัวเอง
// ภายใน tx เช็กเงื่อนไขซ้ำพร้อม FOR UPDATE SKIP LOCKED กันชนกับ bot / watchdog ตัวอื่น
async function sweep(
  where: string,
  params: unknown[],
  act: (c: PoolClient, o: Row) => Promise<void>
): Promise<void> {
  const list = await pool.query(`SELECT order_no FROM orders WHERE ${where} ORDER BY id LIMIT 50`, params);
  for (const { order_no } of list.rows) {
    try {
      await withTx(async (c) => {
        const r = await c.query(
          `SELECT id, order_no, status, attempts, payment_ref, locked_by FROM orders
           WHERE order_no = $${params.length + 1} AND ${where} FOR UPDATE SKIP LOCKED`,
          [...params, order_no]
        );
        if (r.rowCount === 0) return; // สถานะเปลี่ยนไปแล้ว หรือมีคนอื่นถืออยู่
        await act(c, r.rows[0] as Row);
      });
    } catch (e) {
      log(`error on ${order_no}: ${(e as Error).message}`);
    }
  }
}

// 1) bot ที่ heartbeat เงียบเกินกำหนด -> DOWN
async function markDeadBots() {
  const r = await pool.query(
    `UPDATE bots SET status = 'DOWN'
     WHERE status <> 'DOWN' AND last_heartbeat_at < now() - make_interval(secs => $1)
     RETURNING id`,
    [BOT_DOWN_SEC]
  );
  for (const b of r.rows) log(`bot ${b.id} ไม่มี heartbeat เกิน ${BOT_DOWN_SEC}s -> DOWN`);
  await pool.query(
    "DELETE FROM bots WHERE status = 'DOWN' AND last_heartbeat_at < now() - interval '10 minutes'"
  );
}

// 2) งานที่ lease หมด (bot ตายหรือค้าง) -> DELAYED -> QUEUED พร้อม exponential backoff
async function reclaimStale() {
  await sweep("status = 'IN_PROGRESS' AND lease_expires_at < now()", [], async (c, o) => {
    await transition(c, o.order_no, "DELAYED", `lease หมดอายุ (${o.locked_by} ไม่ตอบสนอง) watchdog ยึดงานคืน`);
    await transition(c, o.order_no, "QUEUED", `คืนเข้าคิว (ทำไปแล้ว ${o.attempts} ครั้ง) รอ backoff ก่อนลองใหม่`);
    await c.query(
      `UPDATE orders SET locked_by = NULL, lease_expires_at = NULL,
              next_attempt_at = now() + make_interval(secs => LEAST(60, 2 * power(2, attempts)))
       WHERE id = $1`,
      [o.id]
    );
    log(`${o.order_no}: ยึดคืนจาก ${o.locked_by}`);
  });
}

// 3) ลองครบแล้วยังไม่สำเร็จ -> FAILED (ไม่วนไม่รู้จบ)
async function failExhausted() {
  await sweep("status = 'QUEUED' AND attempts >= $1", [MAX_ATTEMPTS], async (c, o) => {
    const note = o.payment_ref
      ? " (bot จ่ายเงินผู้ให้บริการไปแล้ว ควรตรวจสอบยอดกับผู้ให้บริการ)"
      : "";
    await transition(c, o.order_no, "FAILED", `ลองครบ ${o.attempts} ครั้งแล้วไม่สำเร็จ${note}`);
    log(`${o.order_no}: FAILED`);
  });
}

// 4) FAILED -> REFUNDED (จำลองการคืนเงินอัตโนมัติ)
async function refundFailed() {
  await sweep(
    "status = 'FAILED' AND updated_at < now() - make_interval(secs => $1)",
    [REFUND_AFTER_SEC],
    async (c, o) => {
      await transition(c, o.order_no, "REFUNDED", "คืนเงินให้ลูกค้าอัตโนมัติ");
      log(`${o.order_no}: REFUNDED`);
    }
  );
}

// 5) PENDING_PAYMENT เกินเวลา -> EXPIRED
async function expirePending() {
  await sweep("status = 'PENDING_PAYMENT' AND expires_at < now()", [], async (c, o) => {
    await transition(c, o.order_no, "EXPIRED", "หมดเวลาชำระเงิน");
    log(`${o.order_no}: EXPIRED`);
  });
}

async function tick() {
  for (const [name, fn] of [
    ["markDeadBots", markDeadBots],
    ["reclaimStale", reclaimStale],
    ["failExhausted", failExhausted],
    ["refundFailed", refundFailed],
    ["expirePending", expirePending],
  ] as const) {
    try {
      await fn();
    } catch (e) {
      log(`${name} error: ${(e as Error).message}`);
    }
  }
}

export function startWatchdog(): void {
  let running = false;
  setInterval(async () => {
    if (running) return; // ไม่ให้รอบซ้อนกัน
    running = true;
    try {
      await tick();
    } finally {
      running = false;
    }
  }, INTERVAL_MS);
  log(`started (every ${INTERVAL_MS}ms, botDown=${BOT_DOWN_SEC}s, maxAttempts=${MAX_ATTEMPTS})`);
}
