import { describe, it, expect } from "vitest";
import { sanitizeHtml, isHtmlSafe } from "./sanitize";

describe("sanitize", () => {
  describe("sanitizeHtml", () => {
    it("should remove script tags", () => {
      const input = "<p>Hello</p><script>alert('xss')</script>";
      const result = sanitizeHtml(input);
      expect(result).not.toContain("<script>");
      expect(result).toContain("<p>Hello</p>");
    });

    it("should remove event handlers", () => {
      const input = '<img src="x" onerror="alert(1)">';
      const result = sanitizeHtml(input);
      expect(result).not.toContain("onerror");
    });

    it("should allow safe HTML", () => {
      const input = "<p><strong>Bold</strong> text</p>";
      const result = sanitizeHtml(input);
      expect(result).toContain("<strong>");
    });
  });

  describe("isHtmlSafe", () => {
    it("should return true for safe HTML", () => {
      expect(isHtmlSafe("<p>Hello world</p>")).toBe(true);
    });

    it("should return false for dangerous HTML", () => {
      expect(isHtmlSafe("<script>alert(1)</script>")).toBe(false);
    });
  });
});
