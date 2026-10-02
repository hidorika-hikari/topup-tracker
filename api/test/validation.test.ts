import { describe, expect, it } from "vitest";
import { checkOrderNo, intParam, str } from "../src/validation";

describe("checkOrderNo", () => {
  it("รับรูปแบบตัวอย่างในโจทย์", () => {
    expect(() => checkOrderNo("ORD-2587965432159-458")).not.toThrow();
  });

  it.each(["ABC", "ORD-123-456", "ORD-2587965432159-45", "ord-2587965432159-458", "ORD-2587965432159-4580", ""])(
    "ปฏิเสธ %s ด้วย 400 INVALID_ORDER_NO",
    (v) => {
      expect(() => checkOrderNo(v)).toThrowError(expect.objectContaining({ status: 400, code: "INVALID_ORDER_NO" }));
    }
  );
});

describe("intParam", () => {
  it("ใช้ค่า default เมื่อไม่ส่งมา", () => expect(intParam(undefined, 1, "page")).toBe(1));
  it("แปลงเลขบวกได้", () => expect(intParam("3", 1, "page")).toBe(3));
  it.each(["0", "-1", "abc", "1.5", ""])("ปฏิเสธ %s", (v) => {
    expect(() => intParam(v, 1, "page")).toThrowError(expect.objectContaining({ status: 400 }));
  });
});

describe("str", () => {
  it("trim ค่า", () => expect(str("  ROV ", "gameId")).toBe("ROV"));
  it("ปฏิเสธค่าว่าง / ไม่ใช่ string / ยาวเกิน", () => {
    expect(() => str("   ", "x")).toThrow();
    expect(() => str(123, "x")).toThrow();
    expect(() => str("a".repeat(101), "x")).toThrow();
  });
});
