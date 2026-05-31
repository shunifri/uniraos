import { Router } from "express";
import { requireAuth } from "../permissions/middleware/auth-middleware.js";

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
        // Safe evaluation with AST interpreter (P0 安全修复：替换 new Function)
        try {
          const { safeEvaluateBoolean } = await import("../utils/safe-expression.js");
          const isValid = safeEvaluateBoolean(expression, { value, context });
          return res.json({
            success: true,
            data: { valid: isValid, message: isValid ? null : "验证失败" },
          });
        } catch (e: unknown) {
          return res.json({
            success: true,
            data: { valid: false, message: `表达式错误: ${(e as Error).message}` },
          });
        }
      }
      default:
        return res.status(400).json({ success: false, error: `Unknown rule: ${rule}` });
    }
  } catch (error: unknown) {
    console.error("[form-validation-routes] error:", error);
      res.status(500).json({ success: false, error: "Internal server error" });
  }
});

export default router;
