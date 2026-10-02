import { afterEach, describe, expect, it, vi } from "vitest";
import { extractOrderNo, logger } from "../src/logger";

afterEach(() => vi.restoreAllMocks());

describe("logger", () => {
  it("ดึงเลขออเดอร์จากข้อความ", () => {
    expect(extractOrderNo("claimed ORD-2587965432159-458 แล้ว")).toBe("ORD-2587965432159-458");
    expect(extractOrderNo("ไม่มีเลขออเดอร์")).toBeUndefined();
  });

  it("เขียน JSON หนึ่งบรรทัด พร้อมฟิลด์ orderNo อัตโนมัติ", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    logger.info("completed ORD-2587965432159-458", { component: "bot-1" });
    const line = JSON.parse(spy.mock.calls[0][0] as string);
    expect(line).toMatchObject({ level: "info", component: "bot-1", orderNo: "ORD-2587965432159-458" });
    expect(typeof line.ts).toBe("string");
  });

  it("orderNo ที่ส่งมาตรง ๆ มาก่อนค่าที่ดึงจากข้อความ", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    logger.info("request", { orderNo: "ORD-1111111111111-111" });
    expect(JSON.parse(spy.mock.calls[0][0] as string).orderNo).toBe("ORD-1111111111111-111");
  });

  it("level error ไปที่ stderr", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    logger.error("boom");
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
