import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { errorHandler, notFoundHandler } from "../src/errorHandler";
import { HttpError } from "../src/http";

function fakeRes() {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}
const req: any = { originalUrl: "/orders/ORD-2587965432159-458", method: "GET" };

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("errorHandler: รูปแบบ error เดียวกันทั้งระบบ", () => {
  it("HttpError -> status + {error:{code,message}}", () => {
    const res = fakeRes();
    errorHandler(new HttpError(404, "ORDER_NOT_FOUND", "Order not found"), req, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: { code: "ORDER_NOT_FOUND", message: "Order not found" } });
  });

  it("JSON พัง -> 400 INVALID_JSON", () => {
    const res = fakeRes();
    errorHandler({ type: "entity.parse.failed" }, req, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].error.code).toBe("INVALID_JSON");
  });

  it("error ไม่รู้จัก -> 500 และไม่รั่วข้อความภายใน", () => {
    const res = fakeRes();
    errorHandler(new Error("password=secret db down"), req, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(500);
    const body = res.json.mock.calls[0][0];
    expect(body).toEqual({ error: { code: "INTERNAL_ERROR", message: "Internal server error" } });
    expect(JSON.stringify(body)).not.toContain("secret");
  });

  it("route ไม่มี -> 404 NOT_FOUND รูปแบบเดียวกัน", () => {
    const res = fakeRes();
    notFoundHandler({} as any, res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: { code: "NOT_FOUND", message: "Route not found" } });
  });

  it("log error มี orderNo จาก URL", () => {
    errorHandler(new HttpError(409, "INVALID_TRANSITION", "x"), req, fakeRes(), vi.fn());
    const line = JSON.parse((console.log as any).mock.calls[0][0]);
    expect(line).toMatchObject({ level: "warn", orderNo: "ORD-2587965432159-458", code: "INVALID_TRANSITION" });
  });
});
