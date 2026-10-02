import { Pool } from "pg";
import { randomUUID } from "crypto";
import { logger } from "./logger";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const BOT_ID = `bot-${randomUUID().slice(0, 8)}`;
const LEASE_SEC = Number(process.env.LEASE_SEC ?? 30);
const HEARTBEAT_MS = 5000;
const POLL_MS = 1000;
const PAY_MS = Number(process.env.PAY_MS ?? 3000);
const TOPUP_MS = Number(process.env.TOPUP_MS ?? 4000);
// failure injection (0-1)
const FAIL_RATE = Number(process.env.FAIL_RATE ?? 0.1);
const CRASH_RATE = Number(process.env.CRASH_RATE ?? 0.05);
const MAX_ATTEMPTS = Number(process.env.MAX_ATTEMPTS ?? 3);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const log = (m: string) => logger.info(m, { component: BOT_ID });

type Order = { id: string; order_no: string; payment_ref: string | null; attempts: number };

async function heartbeat(status: "IDLE" | "BUSY", orderId: string | null) {
  await pool.query(
    `INSERT INTO bots (id, status, current_order_id, last_heartbeat_at)
     VALUES ($1,$2,$3,now())
     ON CONFLICT (id) DO UPDATE
       SET status = $2, current_order_id = $3, last_heartbeat_at = now()`,
    [BOT_ID, status, orderId]
  );
}

// หยิบงานแบบ atomic: bot หลายตัวไม่มีทางได้ออเดอร์เดียวกัน
async function claim(): Promise<Order | null> {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const r = await c.query(
      `UPDATE orders SET status = 'IN_PROGRESS', locked_by = $1,
              lease_expires_at = now() + make_interval(secs => $2),
              attempts = attempts + 1, updated_at = now()
       WHERE id = (
         SELECT id FROM orders WHERE status = 'QUEUED' AND attempts < $3
           AND (next_attempt_at IS NULL OR next_attempt_at <= now())
         ORDER BY created_at ASC
         FOR UPDATE SKIP LOCKED LIMIT 1
       )
       RETURNING id, order_no, payment_ref, attempts`,
      [BOT_ID, LEASE_SEC, MAX_ATTEMPTS]
    );
    if (r.rowCount === 0) {
      await c.query("COMMIT");
      return null;
    }
    const o = r.rows[0] as Order;
    await c.query(
      "INSERT INTO order_events (order_id, from_status, to_status, message) VALUES ($1,'QUEUED','IN_PROGRESS',$2)",
      [o.id, `${BOT_ID} รับงาน (ครั้งที่ ${o.attempts})`]
    );
    await c.query("COMMIT");
    return o;
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}

// ต่ออายุ lease เฉพาะงานที่ bot นี้ยังถือครองอยู่ (ถ้าถูก watchdog ยึดคืนแล้ว จะต่อไม่ได้)
async function renewLease(o: Order): Promise<boolean> {
  const r = await pool.query(
    `UPDATE orders SET lease_expires_at = now() + make_interval(secs => $3)
     WHERE id = $1 AND locked_by = $2 AND status = 'IN_PROGRESS'`,
    [o.id, BOT_ID, LEASE_SEC]
  );
  return (r.rowCount ?? 0) > 0;
}

async function addEvent(o: Order, message: string) {
  await pool.query(
    "INSERT INTO order_events (order_id, from_status, to_status, message) VALUES ($1,'IN_PROGRESS','IN_PROGRESS',$2)",
    [o.id, message]
  );
}

function maybeCrash(where: string) {
  if (Math.random() < CRASH_RATE) {
    log(`💥 simulated crash (${where})`);
    process.exit(1);
  }
}

// จำลองเรียก payment gateway: ใช้ order_no เป็น idempotency key (เรียกซ้ำได้ ref เดิม)
async function callPayment(orderNo: string): Promise<string> {
  await sleep(PAY_MS);
  if (Math.random() < FAIL_RATE) throw new Error("payment gateway error");
  return `PAY-${orderNo}`;
}

async function callTopup(orderNo: string): Promise<void> {
  await sleep(TOPUP_MS);
  if (Math.random() < FAIL_RATE) throw new Error("game topup error");
}

async function process_(o: Order) {
  // 1) จ่ายเงิน (ข้ามถ้าเคยจ่ายแล้ว -> กันจ่ายซ้ำ)
  if (o.payment_ref) {
    log(`${o.order_no}: จ่ายเงินแล้ว (${o.payment_ref}) ข้ามไปเติมเกม`);
    await addEvent(o, "พบว่าจ่ายเงินแล้ว ข้ามขั้นจ่ายเงิน");
  } else {
    await addEvent(o, "bot กำลังจ่ายเงิน");
    maybeCrash("ก่อนจ่ายเงินเสร็จ");
    const ref = await callPayment(o.order_no);
    await pool.query("UPDATE orders SET payment_ref = $1 WHERE id = $2 AND locked_by = $3", [ref, o.id, BOT_ID]);
    await addEvent(o, `จ่ายเงินสำเร็จ (${ref})`);
    await renewLease(o);
  }

  // 2) เติมเกม
  await addEvent(o, "bot กำลังเติมเกม");
  maybeCrash("ระหว่างเติมเกม");
  await callTopup(o.order_no);

  // 3) จบงาน (เช็กว่ายังเป็นเจ้าของงานอยู่)
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const r = await c.query(
      `UPDATE orders SET status = 'COMPLETED', locked_by = NULL, lease_expires_at = NULL, updated_at = now()
       WHERE id = $1 AND locked_by = $2 AND status = 'IN_PROGRESS'`,
      [o.id, BOT_ID]
    );
    if (r.rowCount === 0) throw new Error("lost ownership of order");
    await c.query(
      "INSERT INTO order_events (order_id, from_status, to_status, message) VALUES ($1,'IN_PROGRESS','COMPLETED','เติมเกมสำเร็จ')",
      [o.id]
    );
    await c.query("COMMIT");
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}

// งานพลาด: ปล่อยกลับ QUEUED ให้ลองใหม่ (watchdog จะตัดสินเรื่อง retry limit ใน step ถัดไป)
async function releaseOnError(o: Order, err: Error) {
  const r = await pool.query(
    `UPDATE orders SET status = 'QUEUED', locked_by = NULL, lease_expires_at = NULL, updated_at = now(),
         next_attempt_at = now() + make_interval(secs => LEAST(60, 2 * power(2, attempts)))
     WHERE id = $1 AND locked_by = $2 AND status = 'IN_PROGRESS'`,
    [o.id, BOT_ID]
  );
  if ((r.rowCount ?? 0) > 0) {
    await pool.query(
      "INSERT INTO order_events (order_id, from_status, to_status, message) VALUES ($1,'IN_PROGRESS','QUEUED',$2)",
      [o.id, `เกิดข้อผิดพลาด: ${err.message} คืนเข้าคิว`]
    );
  }
}

async function main() {
  log(`started (lease=${LEASE_SEC}s, failRate=${FAIL_RATE}, crashRate=${CRASH_RATE})`);
  let current: Order | null = null;
  let busy = false;

  // heartbeat + ต่อ lease เป็นระยะ (ทำงานแยกจากลูปหลัก)
  setInterval(async () => {
    try {
      await heartbeat(busy ? "BUSY" : "IDLE", current?.id ?? null);
      if (current) await renewLease(current);
    } catch (e) {
      log(`heartbeat error: ${(e as Error).message}`);
    }
  }, HEARTBEAT_MS);

  await heartbeat("IDLE", null);

  for (;;) {
    try {
      const o = await claim();
      if (!o) {
        await sleep(POLL_MS);
        continue;
      }
      current = o;
      busy = true;
      await heartbeat("BUSY", o.id);
      log(`claimed ${o.order_no}`);
      try {
        await process_(o);
        log(`completed ${o.order_no}`);
      } catch (e) {
        log(`failed ${o.order_no}: ${(e as Error).message}`);
        await releaseOnError(o, e as Error);
      }
    } catch (e) {
      log(`loop error: ${(e as Error).message}`);
      await sleep(POLL_MS);
    } finally {
      current = null;
      busy = false;
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
