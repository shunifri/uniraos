import { z } from "zod";
import type { Request, Response, NextFunction } from "express";

export const loginSchema = z.object({
  username: z.string().min(1, "Username is required").max(50, "Username must be at most 50 characters"),
  password: z.string().min(6, "Password must be at least 6 characters").max(100, "Password must be at most 100 characters"),
});

export const registerSchema = z.object({
  username: z.string().min(3, "Username must be at least 3 characters").max(50, "Username must be at most 50 characters"),
  password: z.string().min(6, "Password must be at least 6 characters").max(100, "Password must be at most 100 characters"),
});

export function validate(schema: z.ZodSchema) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const messages = result.error.issues.map((e: { message: string }) => e.message).join(", ");
      res.status(400).json({ success: false, error: messages });
      return;
    }
    next();
  };
}
