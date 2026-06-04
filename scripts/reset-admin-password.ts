#!/usr/bin/env tsx
/**
 * Dev utility: 重置 admin 密码 (忘记时用)
 * 用法: npx tsx scripts/reset-admin-password.ts [新密码]
 */
import { hashPassword } from "../src/db/user-repository.js";
import { getMySQLAdapter } from "../src/db/mysql-adapter.js";

const newPassword = process.argv[2] || "test1234";

(async () => {
  const hash = await hashPassword(newPassword);
  const adapter = await getMySQLAdapter();
  await adapter.execute(
    "UPDATE users SET password_hash = ? WHERE username = ?",
    [hash, "admin"]
  );
  console.log(`[reset-admin-password] admin password set to: ${newPassword}`);
  process.exit(0);
})();
