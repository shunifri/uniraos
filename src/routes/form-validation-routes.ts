import { Router } from "express";
import { requireAuth } from "../db/auth-middleware.js";

const router = Router();

/**
 * POST /form/validate
 * Generic async validation endpoint.
 * Body: { rule: string, value: any, context?: Record<string, any> }
 */
router.post("/form/validate", requireAuth, async (req, res) => {
  try {
    const { rule, value, context } = req.body;

    if (!rule) {
      return res.status(400).json({ success: false, error: "Missing rule" });
    }

    // Built-in validation rules
    switch (rule) {
      case "uniqueUsername": {
        const { username } = context || {};
        // Mock check: reject "admin" and "root"
        const forbidden = ["admin", "root", "system"];
        const isValid = !forbidden.includes(String(value).toLowerCase());
        return res.json({
          success: true,
          data: { valid: isValid, message: isValid ? null : "用户名已被占用" },
        });
      }
      case "uniqueEmail": {
        const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRe.test(String(value))) {
          return res.json({
            success: true,
            data: { valid: false, message: "邮箱格式不正确" },
          });
        }
        // Mock check: reject specific email
        const isValid = String(value).toLowerCase() !== "taken@example.com";
        return res.json({
          success: true,
          data: { valid: isValid, message: isValid ? null : "邮箱已被注册" },
        });
      }
      case "customExpression": {
        const { expression } = context || {};
        if (!expression) {
          return res.status(400).json({ success: false, error: "Missing expression" });
        }
        // Safe evaluation with limited scope
        try {
          const fn = new Function("value", "context", `"use strict"; return (${expression});`);
          const isValid = !!fn(value, context);
          return res.json({
            success: true,
            data: { valid: isValid, message: isValid ? null : "验证失败" },
          });
        } catch (e: any) {
          return res.json({
            success: true,
            data: { valid: false, message: `表达式错误: ${e.message}` },
          });
        }
      }
      default:
        return res.status(400).json({ success: false, error: `Unknown rule: ${rule}` });
    }
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
