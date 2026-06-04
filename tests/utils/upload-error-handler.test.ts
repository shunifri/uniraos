import { describe, it, expect, vi } from "vitest";
import multer from "multer";
import { handleUploadErrors } from "../../src/utils/upload-error-handler.js";

function createMockReqRes() {
  const req: any = {};
  const res: any = {
    statusCode: 200,
    status: vi.fn(function (code: number) { res.statusCode = code; return this; }),
    json: vi.fn(function (data: any) { return this; }),
  };
  return { req, res };
}

describe("handleUploadErrors", () => {
  const MAX = 200 * 1024 * 1024; // 200MB

  it("calls next() with no error when middleware succeeds", () => {
    const middleware: any = (_req: any, _res: any, cb: any) => cb();
    const wrapped = handleUploadErrors(middleware, MAX);
    const { req, res } = createMockReqRes();
    const next = vi.fn();
    wrapped(req, res, next);
    expect(next).toHaveBeenCalledWith();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("returns 413 + FILE_TOO_LARGE with clear message on LIMIT_FILE_SIZE", () => {
    const middleware: any = (_req: any, _res: any, cb: any) => cb(new multer.MulterError("LIMIT_FILE_SIZE", "file"));
    const wrapped = handleUploadErrors(middleware, MAX);
    const { req, res } = createMockReqRes();
    const next = vi.fn();
    wrapped(req, res, next);
    expect(res.status).toHaveBeenCalledWith(413);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: false,
      code: "FILE_TOO_LARGE",
      maxSizeMB: 200,
    }));
    const errMsg = res.json.mock.calls[0][0].error;
    expect(errMsg).toContain("200MB");
    expect(errMsg).toContain("请压缩或拆分后重试");
    expect(next).not.toHaveBeenCalled();
  });

  it("uses actual maxSizeMB in the error message (not hardcoded)", () => {
    const middleware: any = (_req: any, _res: any, cb: any) => cb(new multer.MulterError("LIMIT_FILE_SIZE"));
    const customMax = 50 * 1024 * 1024;
    const wrapped = handleUploadErrors(middleware, customMax);
    const { req, res } = createMockReqRes();
    wrapped(req, res, vi.fn());
    expect(res.json.mock.calls[0][0].maxSizeMB).toBe(50);
    expect(res.json.mock.calls[0][0].error).toContain("50MB");
  });

  it("returns 413 + TOO_MANY_FILES on LIMIT_FILE_COUNT", () => {
    const err: any = new multer.MulterError("LIMIT_FILE_COUNT", "files");
    err.limit = 5;
    const middleware: any = (_req: any, _res: any, cb: any) => cb(err);
    const wrapped = handleUploadErrors(middleware, MAX);
    const { req, res } = createMockReqRes();
    wrapped(req, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(413);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: false,
      code: "TOO_MANY_FILES",
      error: expect.stringContaining("5"),
    }));
  });

  it("returns 400 on LIMIT_UNEXPECTED_FILE with the field name", () => {
    const err: any = new multer.MulterError("LIMIT_UNEXPECTED_FILE", "wrongField");
    const middleware: any = (_req: any, _res: any, cb: any) => cb(err);
    const wrapped = handleUploadErrors(middleware, MAX);
    const { req, res } = createMockReqRes();
    wrapped(req, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: false,
      error: expect.stringContaining("wrongField"),
    }));
  });

  it("returns 400 on generic MulterError (e.g. LIMIT_PART_COUNT)", () => {
    const middleware: any = (_req: any, _res: any, cb: any) => cb(new multer.MulterError("LIMIT_PART_COUNT"));
    const wrapped = handleUploadErrors(middleware, MAX);
    const { req, res } = createMockReqRes();
    wrapped(req, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: false,
      code: "LIMIT_PART_COUNT",
    }));
  });

  it("returns 400 on fileFilter rejection (non-MulterError)", () => {
    const middleware: any = (_req: any, _res: any, cb: any) => cb(new Error("文件类型不允许: .exe"));
    const wrapped = handleUploadErrors(middleware, MAX);
    const { req, res } = createMockReqRes();
    wrapped(req, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: false,
      error: "文件类型不允许: .exe",
    }));
  });
});
