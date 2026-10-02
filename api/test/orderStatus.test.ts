import { describe, expect, it, vi } from "vitest";
import { CURRENT_STATUSES, HISTORY_STATUSES, TRANSITIONS, transition } from "../src/orderStatus";

function fakeClient(firstResult: { rowCount: number; rows: any[] }) {
  return {
    query: vi.fn().mockResolvedValueOnce(firstResult).mockResolvedValue({ rowCount: 1, rows: [] }),
  } as any;
}

describe("state machine table", () => {
  it("ทุกปลายทางต้องเป็นสถานะที่มีอยู่จริง", () => {
    const all = Object.keys(TRANSITIONS);
    for (const targets of Object.values(TRANSITIONS)) {
      for (const t of targets) expect(all).toContain(t);
    }
  });

  it("สถานะจบ (COMPLETED/EXPIRED/REFUNDED) ไปต่อไม่ได้", () => {
    expect(TRANSITIONS.COMPLETED).toEqual([]);
    expect(TRANSITIONS.EXPIRED).toEqual([]);
    expect(TRANSITIONS.REFUNDED).toEqual([]);
  });

  it("current กับ history แบ่งสถานะครบ ไม่ซ้ำกัน", () => {
    const union = [...CURRENT_STATUSES, ...HISTORY_STATUSES].sort();
    expect(union).toEqual(Object.keys(TRANSITIONS).sort());
    expect(CURRENT_STATUSES.filter((s) => HISTORY_STATUSES.includes(s))).toEqual([]);
  });
});

describe("transition()", () => {
  it("เปลี่ยนสถานะที่ถูกกฎ: UPDATE + เขียน event", async () => {
    const c = fakeClient({ rowCount: 1, rows: [{ id: "1", status: "PENDING_PAYMENT" }] });
    const r = await transition(c, "ORD-2587965432159-458", "QUEUED", "จ่ายแล้ว");
    expect(r).toEqual({ from: "PENDING_PAYMENT", to: "QUEUED" });
    expect(c.query).toHaveBeenCalledTimes(3); // SELECT, UPDATE, INSERT event
    expect(c.query.mock.calls[2][1]).toEqual(["1", "PENDING_PAYMENT", "QUEUED", "จ่ายแล้ว"]);
  });

  it("ผิดกฎ -> 409 INVALID_TRANSITION และไม่เขียนอะไรลง DB", async () => {
    const c = fakeClient({ rowCount: 1, rows: [{ id: "1", status: "COMPLETED" }] });
    await expect(transition(c, "ORD-2587965432159-458", "QUEUED", "x")).rejects.toMatchObject({
      status: 409,
      code: "INVALID_TRANSITION",
    });
    expect(c.query).toHaveBeenCalledTimes(1);
  });

  it("ไม่พบออเดอร์ -> 404 ORDER_NOT_FOUND", async () => {
    const c = fakeClient({ rowCount: 0, rows: [] });
    await expect(transition(c, "ORD-2587965432159-458", "QUEUED", "x")).rejects.toMatchObject({
      status: 404,
      code: "ORDER_NOT_FOUND",
    });
  });
});
