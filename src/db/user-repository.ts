/**
 * 用户仓库：CRUD + 密码哈希 + 角色/权限查询（交叉控制模型）
 *
 * 交叉控制：用户可访问资源 R 执行操作 A ⟺
 *   (1) 用户的角色授予了 Permission(R, A)    ← 角色维度
 *   AND
 *   (2) 用户所在部门（含祖先）拥有资源 R     ← 部门维度
 *   例外：admin 角色跳过部门检查
 * 
 * 支持 SQLite 和 MySQL 切换
 */
import { randomBytes, scrypt } from "crypto";
import { randomUUID } from "crypto";
import { getDb } from "./database.js";
import type { RoleAgentConfig } from "../permissions/types/role.js";
import { log } from "../utils/logger.js";

export interface User {
  id: string;
  username: string;
  displayName: string;
  avatar: string;
  phone: string;
  email: string;
  departmentId: string | null;
  status: "active" | "disabled" | "deleted";
  createdAt: number;
  updatedAt: number;
  lastLoginAt: number | null;
}

export interface CreateUserInput {
  username: string;
  password: string;
  displayName?: string;
  departmentId?: string;
  phone?: string;
  email?: string;
  roleIds?: string[];
}

export interface UserWithDetails extends User {
  roles: Array<{ id: string; name: string; description: string }>;
  department: { id: string; name: string; path: string } | null;
  permissions: string[];
}

// ===== 密码哈希 =====

/** Scrypt 成本因子（N=2^15=32768, maxmem=64MB） */
const SCRYPT_OPTIONS = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const SCRYPT_KEYLEN = 64;

function scryptAsync(password: string, salt: string, keylen: number, options?: object): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keylen, options ?? {}, (err, derivedKey) => {
      if (err) reject(err);
      else resolve(derivedKey);
    });
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const hash = (await scryptAsync(password, salt, SCRYPT_KEYLEN, SCRYPT_OPTIONS)).toString("hex");
  return `v2:${salt}:${hash}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  // v2 格式: v2:salt:hash (N=32768)
  if (stored.startsWith("v2:")) {
    const parts = stored.split(":");
    if (parts.length !== 3) return false;
    const [, salt, hash] = parts;
    if (!salt || !hash) return false;
    const check = (await scryptAsync(password, salt, SCRYPT_KEYLEN, SCRYPT_OPTIONS)).toString("hex");
    return hash === check;
  }

  // 旧格式: salt:hash (Node.js 默认 N=16384)
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const check = (await scryptAsync(password, salt, SCRYPT_KEYLEN)).toString("hex");
  return hash === check;
}

// ===== MySQL 适配器延迟加载 =====

// ===== 用户 CRUD =====

export async function createUser(input: CreateUserInput): Promise<User> {
  
    const db = getDb();
    const id = `u_${randomUUID().slice(0, 12)}`;
    const passwordHash = await hashPassword(input.password);
    const departmentId = input.departmentId ?? "dept_root";

    db.prepare(`
      INSERT INTO users (id, username, display_name, password_hash, department_id, phone, email)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, input.username, input.displayName ?? input.username, passwordHash, departmentId, input.phone ?? "", input.email ?? "");

    const roleIds = input.roleIds && input.roleIds.length > 0 ? input.roleIds : ["role_user"];
    const insertRole = db.prepare("INSERT OR IGNORE INTO user_roles (user_id, role_id) VALUES (?, ?)");
    for (const roleId of roleIds) {
      insertRole.run(id, roleId);
    }

    return (await getUserById(id))!;
  
}

export async function getUserById(id: string): Promise<User | null> {
  
    const row = getDb().prepare("SELECT * FROM users WHERE id = ? AND status != 'deleted'").get(id) as any;
    return row ? mapUser(row) : null;
  
}

export async function getUserByUsername(username: string): Promise<User | null> {
  
    const row = getDb().prepare("SELECT * FROM users WHERE username = ? AND status != 'deleted'").get(username) as any;
    return row ? mapUser(row) : null;
  
}

export async function getUserByPhone(phone: string): Promise<User | null> {
  
    const row = getDb().prepare("SELECT * FROM users WHERE phone = ? AND status != 'deleted'").get(phone) as any;
    return row ? mapUser(row) : null;
  
}

export async function listUsers(opts?: { limit?: number; offset?: number; status?: string }): Promise<User[]> {
  const limit = opts?.limit ?? 50;
  const offset = opts?.offset ?? 0;
  const status = opts?.status ?? "active";

  
    const rows = getDb().prepare(
      "SELECT * FROM users WHERE status = ? ORDER BY created_at DESC LIMIT ? OFFSET ?"
    ).all(status, limit, offset) as any[];
    return rows.map(mapUser);
  
}

export async function countUsers(status = "active"): Promise<number> {
  
    const row = getDb().prepare("SELECT COUNT(*) as c FROM users WHERE status = ?").get(status) as any;
    return row.c;
  
}

const ALLOWED_USER_FIELDS: Record<string, string> = {
  displayName: "display_name",
  avatar: "avatar",
  status: "status",
  departmentId: "department_id",
  phone: "phone",
  email: "email",
};

export async function updateUser(id: string, fields: { displayName?: string; avatar?: string; status?: string; departmentId?: string; phone?: string; email?: string; roleIds?: string[] }): Promise<User | null> {
  
    const db = getDb();
    const sets: string[] = [];
    const vals: unknown[] = [];

    for (const [key, col] of Object.entries(ALLOWED_USER_FIELDS)) {
      if ((fields as any)[key] !== undefined) {
        sets.push(`${col} = ?`);
        vals.push((fields as any)[key]);
      }
    }

    if (sets.length > 0) {
      sets.push("updated_at = unixepoch()");
      vals.push(id);
      db.prepare(`UPDATE users SET ${sets.join(", ")} WHERE id = ?`).run(...vals);
    }

    if (fields.roleIds !== undefined && fields.roleIds.length > 0) {
      db.prepare("DELETE FROM user_roles WHERE user_id = ?").run(id);
      const insertRole = db.prepare("INSERT OR IGNORE INTO user_roles (user_id, role_id) VALUES (?, ?)");
      for (const roleId of fields.roleIds) {
        insertRole.run(id, roleId);
      }
    }

    return await getUserById(id);
  
}

export async function changePassword(id: string, newPassword: string): Promise<boolean> {
  const hash = await hashPassword(newPassword);
  
    const result = getDb().prepare("UPDATE users SET password_hash = ?, updated_at = unixepoch() WHERE id = ?").run(hash, id);
    const success = result.changes > 0;
    if (success) log("info", "auth.password_changed", { userId: id });
    return success;
  
}

export async function deleteUser(id: string): Promise<boolean> {
  
    const result = getDb().prepare("UPDATE users SET status = 'deleted', updated_at = unixepoch() WHERE id = ?").run(id);
    const success = result.changes > 0;
    if (success) log("info", "auth.user_deleted", { userId: id });
    return success;
  
}

// ===== 认证 =====

export async function authenticate(username: string, password: string): Promise<User | null> {
  
    const row = getDb().prepare("SELECT * FROM users WHERE username = ? AND status = 'active'").get(username) as any;
    if (!row) {
      log("warn", "auth.login_failed", { username, reason: "user_not_found" });
      return null;
    }
    if (!(await verifyPassword(password, row.password_hash))) {
      log("warn", "auth.login_failed", { username, userId: row.id, reason: "invalid_password" });
      return null;
    }

    getDb().prepare("UPDATE users SET last_login_at = unixepoch() WHERE id = ?").run(row.id);
    log("info", "auth.login_success", { username, userId: row.id });
    return mapUser(row);
  
}

// ===== 角色管理 =====

export async function getUsersByRole(roleId: string): Promise<User[]> {
  
    return getDb().prepare(`
      SELECT u.*
      FROM users u
      JOIN user_roles ur ON ur.user_id = u.id
      WHERE ur.role_id = ? AND u.status != 'deleted'
    `).all(roleId) as any[];
  
}

export async function getUsersByDepartment(departmentId: string): Promise<User[]> {
  
    return getDb().prepare(`
      SELECT * FROM users WHERE department_id = ? AND status != 'deleted'
    `).all(departmentId) as any[];
  
}

export async function getUserDepartment(userId: string): Promise<{ id: string; name: string; path: string } | null> {
  const user = await getUserById(userId);
  if (!user?.departmentId) return null;

  const { getDepartmentById } = await import('./department-repository.js');
  const dept = await getDepartmentById(user.departmentId);
  if (!dept) return null;

  return { id: dept.id, name: dept.name, path: dept.path };
}

export async function getUserRoles(userId: string): Promise<Array<{ id: string; name: string; description: string }>> {
  
    return getDb().prepare(`
      SELECT r.id, r.name, r.description
      FROM roles r
      JOIN user_roles ur ON ur.role_id = r.id
      WHERE ur.user_id = ?
    `).all(userId) as any[];
  
}

export async function assignRole(userId: string, roleId: string): Promise<void> {
  
    getDb().prepare("INSERT OR IGNORE INTO user_roles (user_id, role_id) VALUES (?, ?)").run(userId, roleId);
  
  log("info", "auth.role_assigned", { userId, roleId });
}

export async function removeRole(userId: string, roleId: string): Promise<void> {
  
    getDb().prepare("DELETE FROM user_roles WHERE user_id = ? AND role_id = ?").run(userId, roleId);
  
  log("info", "auth.role_removed", { userId, roleId });
}

// ===== 权限查询（交叉控制） =====

export async function userHasPermission(userId: string, permissionName: string): Promise<boolean> {
  
    const db = getDb();
    const row = db.prepare(`
      SELECT 1 FROM permissions p
      JOIN role_permissions rp ON rp.permission_id = p.id
      JOIN user_roles ur ON ur.role_id = rp.role_id
      WHERE ur.user_id = ? AND p.name = ?
      LIMIT 1
    `).get(userId, permissionName);
    return !!row;
  
}

export async function getUserPermissions(userId: string): Promise<string[]> {
  
    const db = getDb();
    const rows = db.prepare(`
      SELECT DISTINCT p.name
      FROM permissions p
      JOIN role_permissions rp ON rp.permission_id = p.id
      JOIN user_roles ur ON ur.role_id = rp.role_id
      WHERE ur.user_id = ?
    `).all(userId) as Array<{ name: string }>;
    return rows.map((r) => r.name);
  
}

export async function getUserWithDetails(userId: string): Promise<UserWithDetails | null> {
  const user = await getUserById(userId);
  if (!user) return null;

  const [roles, permissions] = await Promise.all([
    getUserRoles(userId),
    getUserPermissions(userId),
  ]);

  let department: { id: string; name: string; path: string } | null = null;
  if (user.departmentId) {
    
      const dept = getDb().prepare("SELECT id, name, path FROM departments WHERE id = ?").get(user.departmentId) as any;
      if (dept) department = { id: dept.id, name: dept.name, path: dept.path };
    
  }

  return { ...user, roles, department, permissions };
}

// ===== 角色列表 =====

export async function listRoles(): Promise<Array<{ id: string; name: string; description: string; isSystem: boolean }>> {
  
    const rows = getDb().prepare("SELECT * FROM roles ORDER BY is_system DESC, name").all() as any[];
    return rows.map((r) => ({ id: r.id, name: r.name, description: r.description, isSystem: !!r.is_system }));
  
}

export async function getRoleAgentConfig(roleId: string): Promise<RoleAgentConfig | null> {
  
    const row = getDb().prepare("SELECT agent_config FROM roles WHERE id = ?").get(roleId) as any;
    if (!row?.agent_config) return null;
    try {
      return JSON.parse(row.agent_config) as RoleAgentConfig;
    } catch {
      return null;
    }
  
}

export async function updateRoleAgentConfig(roleId: string, config: RoleAgentConfig | null): Promise<void> {
  const configJson = config ? JSON.stringify(config) : null;
  
    getDb().prepare("UPDATE roles SET agent_config = ? WHERE id = ?").run(configJson, roleId);
  
}

// ===== 角色创建/删除 =====

export async function createRole(input: { name: string; description?: string }): Promise<{ id: string; name: string; description: string; isSystem: boolean }> {
  const id = `role_${randomUUID().slice(0, 12)}`;
  
  
    const db = getDb();
    db.prepare("INSERT INTO roles (id, name, description, is_system) VALUES (?, ?, ?, 0)").run(id, input.name, input.description ?? "");
  
  
  return { id, name: input.name, description: input.description ?? "", isSystem: false };
}

export async function deleteRole(id: string): Promise<boolean> {
  
    const db = getDb();
    const role = db.prepare("SELECT is_system FROM roles WHERE id = ?").get(id) as any;
    if (!role) return false;
    if (role.is_system) throw new Error("Cannot delete system role");
    db.prepare("DELETE FROM role_permissions WHERE role_id = ?").run(id);
    db.prepare("DELETE FROM user_roles WHERE role_id = ?").run(id);
    db.prepare("DELETE FROM roles WHERE id = ?").run(id);
    return true;
  
}

// ===== 初始管理员 =====

export async function ensureAdminExists(): Promise<User> {
  const existing = await getUserByUsername("admin");
  if (existing) {
    // P2-3 修复: 同事反馈 "看不到密码" 还可能因为 admin 已有 (重启 / 重 build 没清 volume)
    // 旧代码 return existing 直接走, 不打 log, 同事以为有错.
    // 改: 总是打印 admin 当前状态 + 密码重置路径
    // 注: User interface 不含 passwordHash, 直接查 DB 拿 (admin 内部用户, 不走 userRepo mapUser)
    const rawHash = (
      getDb()
        .prepare(`SELECT password_hash FROM users WHERE username = 'admin' LIMIT 1`)
        .get() as { password_hash: string } | undefined
    )?.password_hash;
    const hashPrefix = rawHash?.slice(0, 8) ?? "(unknown)";
    const isV2Format = rawHash?.startsWith("v2:") ?? false;
    console.warn("╔════════════════════════════════════════════════════════════════════════════╗");
    console.warn("║  Admin account already exists (idempotent check)                            ║");
    console.warn("╠════════════════════════════════════════════════════════════════════════════╣");
    console.warn(`║  Username: admin                                                           ║`);
    console.warn(`║  id:       ${existing.id}                                                 ║`);
    console.warn(`║  status:   ${existing.status}                                             ║`);
    console.warn(`║  hash:     ${hashPrefix}... (${isV2Format ? "v2 scrypt OK" : "⚠️  非 v2 格式!"})     ║`);
    console.warn("║                                                                            ║");
    console.warn("║  如忘记密码, 2 种重置方式:                                                  ║");
    console.warn("║    1. 删除 SQLite 数据库: rm .raos/raos.db && 重启服务                    ║");
    console.warn("║       (走 INITIAL_ADMIN_PASSWORD 重新创建)                                  ║");
    console.warn("║    2. SQL UPDATE (DEPLOY-TROUBLESHOOT.md §1.5 修法 2)                       ║");
    console.warn("╚════════════════════════════════════════════════════════════════════════════╝");
    return existing;
  }

  const id = `u_${randomUUID().slice(0, 12)}`;
  // P2-3 修复: 同事部署反馈 admin 密码随机生成, 不打印, 鸡生蛋登不进.
  // 优先用 INITIAL_ADMIN_PASSWORD env (部署者可设), 否则随机 (production 安全).
  const envPassword = process.env.INITIAL_ADMIN_PASSWORD;
  const isDevDefault = !envPassword || envPassword.length < 8;
  const initialPassword = isDevDefault ? randomBytes(16).toString("hex") : envPassword!;
  const passwordHash = await hashPassword(initialPassword);

  
    const db = getDb();
    db.prepare(`
      INSERT INTO users (id, username, display_name, password_hash, department_id)
      VALUES (?, 'admin', 'Administrator', ?, 'dept_root')
    `).run(id, passwordHash);
    db.prepare("INSERT INTO user_roles (user_id, role_id) VALUES (?, 'role_admin')").run(id);
  

  // P2-3 修复: 同事 2026-06-12 23:23 反馈 'production 模式 hidden, 看不到密码'
  // 改: 设了 INITIAL_ADMIN_PASSWORD 就明文打, 不管 production (deploy 阶段 = setup, 只打一次)
  if (envPassword && !isDevDefault) {
    console.warn("╔════════════════════════════════════════════════════════════════════════════╗");
    console.warn("║  Default admin account created with INITIAL_ADMIN_PASSWORD                 ║");
    console.warn("╠════════════════════════════════════════════════════════════════════════════╣");
    console.warn("║  Username: admin                                                           ║");
    console.warn(`║  Password: ${initialPassword}                                                ║`);
    console.warn("║                                                                            ║");
    console.warn("║  ⚠️  此密码仅在部署日志打印一次, 请保存到安全位置                          ║");
    console.warn("║  ⚠️  首次登录后请通过「系统设置 → 用户」立即修改                            ║");
    console.warn("║  ⚠️  production 部署后建议通过 SQL 或 UI 改成强密码 (别留 INITIAL_ADMIN_PASSWORD)${NC}");
    console.warn("╚════════════════════════════════════════════════════════════════════════════╝");
  } else {
    console.warn("╔════════════════════════════════════════════════════════════════════════════╗");
    console.warn("║  SECURITY WARNING: Default admin account created with a random password    ║");
    console.warn("╠════════════════════════════════════════════════════════════════════════════╣");
    console.warn("║  Username: admin                                                           ║");
    console.warn("║  Password: [hidden — please reset via system settings after first login]   ║");
    console.warn("╚════════════════════════════════════════════════════════════════════════════╝");
  }
  return (await getUserById(id))!;
}

// ===== 内部 =====

function mapUser(row: any): User {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    avatar: row.avatar ?? "",
    phone: row.phone ?? "",
    email: row.email ?? "",
    departmentId: row.department_id ?? null,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastLoginAt: row.last_login_at,
  };
}
