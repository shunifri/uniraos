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
import { getDb, isMySQL } from "./database.js";
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

let mysqlAdapter: any = null;

async function getMySQLAdapter() {
  if (!mysqlAdapter) {
    const { getMySQLAdapter: getAdapter } = await import('./mysql-adapter.js');
    mysqlAdapter = getAdapter();
  }
  return mysqlAdapter;
}

// ===== 用户 CRUD =====

export async function createUser(input: CreateUserInput): Promise<User> {
  if (isMySQL()) {
    const adapter = await getMySQLAdapter();
    const id = `u_${randomUUID().slice(0, 12)}`;
    const passwordHash = await hashPassword(input.password);
    const departmentId = input.departmentId ?? "dept_root";
    const now = Date.now();

    await adapter.execute(
      `INSERT INTO users (id, username, display_name, password_hash, department_id, phone, email, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, input.username, input.displayName ?? input.username, passwordHash, departmentId, input.phone ?? "", input.email ?? "", now, now]
    );

    const roleIds = input.roleIds && input.roleIds.length > 0 ? input.roleIds : ["role_user"];
    for (const roleId of roleIds) {
      await adapter.execute(
        `INSERT IGNORE INTO user_roles (user_id, role_id, created_at) VALUES (?, ?, ?)`,
        [id, roleId, now]
      );
    }

    return (await getUserById(id))!;
  } else {
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
}

export async function getUserById(id: string): Promise<User | null> {
  if (isMySQL()) {
    const adapter = await getMySQLAdapter();
    const rows = await adapter.query(
      `SELECT * FROM users WHERE id = ? AND status != 'deleted'`,
      [id]
    );
    return rows.length > 0 ? mapUser(rows[0]) : null;
  } else {
    const row = getDb().prepare("SELECT * FROM users WHERE id = ? AND status != 'deleted'").get(id) as any;
    return row ? mapUser(row) : null;
  }
}

export async function getUserByUsername(username: string): Promise<User | null> {
  if (isMySQL()) {
    const adapter = await getMySQLAdapter();
    const rows = await adapter.query(
      `SELECT * FROM users WHERE username = ? AND status != 'deleted'`,
      [username]
    );
    return rows.length > 0 ? mapUser(rows[0]) : null;
  } else {
    const row = getDb().prepare("SELECT * FROM users WHERE username = ? AND status != 'deleted'").get(username) as any;
    return row ? mapUser(row) : null;
  }
}

export async function getUserByPhone(phone: string): Promise<User | null> {
  if (isMySQL()) {
    const adapter = await getMySQLAdapter();
    const rows = await adapter.query(
      `SELECT * FROM users WHERE phone = ? AND status != 'deleted'`,
      [phone]
    );
    return rows.length > 0 ? mapUser(rows[0]) : null;
  } else {
    const row = getDb().prepare("SELECT * FROM users WHERE phone = ? AND status != 'deleted'").get(phone) as any;
    return row ? mapUser(row) : null;
  }
}

export async function listUsers(opts?: { limit?: number; offset?: number; status?: string }): Promise<User[]> {
  const limit = opts?.limit ?? 50;
  const offset = opts?.offset ?? 0;
  const status = opts?.status ?? "active";

  if (isMySQL()) {
    const adapter = await getMySQLAdapter();
    // mysql2 requires strict integer types for LIMIT/OFFSET
    const rows = await adapter.query(
      `SELECT * FROM users WHERE status = ? ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [status, parseInt(String(limit), 10), parseInt(String(offset), 10)]
    );
    return rows.map(mapUser);
  } else {
    const rows = getDb().prepare(
      "SELECT * FROM users WHERE status = ? ORDER BY created_at DESC LIMIT ? OFFSET ?"
    ).all(status, limit, offset) as any[];
    return rows.map(mapUser);
  }
}

export async function countUsers(status = "active"): Promise<number> {
  if (isMySQL()) {
    const adapter = await getMySQLAdapter();
    const rows = await adapter.query(`SELECT COUNT(*) as c FROM users WHERE status = ?`, [status]);
    return rows[0]?.c ?? 0;
  } else {
    const row = getDb().prepare("SELECT COUNT(*) as c FROM users WHERE status = ?").get(status) as any;
    return row.c;
  }
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
  if (isMySQL()) {
    const adapter = await getMySQLAdapter();
    const sets: string[] = [];
    const values: any[] = [];

    for (const [key, col] of Object.entries(ALLOWED_USER_FIELDS)) {
      if ((fields as any)[key] !== undefined) {
        sets.push(`${col} = ?`);
        values.push((fields as any)[key]);
      }
    }

    if (sets.length > 0) {
      sets.push("updated_at = ?");
      values.push(Date.now());
      values.push(id);
      await adapter.execute(`UPDATE users SET ${sets.join(", ")} WHERE id = ?`, values);
    }

    if (fields.roleIds !== undefined && fields.roleIds.length > 0) {
      await adapter.execute(`DELETE FROM user_roles WHERE user_id = ?`, [id]);
      const now = Date.now();
      for (const roleId of fields.roleIds) {
        await adapter.execute(`INSERT IGNORE INTO user_roles (user_id, role_id, created_at) VALUES (?, ?, ?)`, [id, roleId, now]);
      }
    }

    return getUserById(id);
  } else {
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
}

export async function changePassword(id: string, newPassword: string): Promise<boolean> {
  const hash = await hashPassword(newPassword);
  if (isMySQL()) {
    const adapter = await getMySQLAdapter();
    const result = await adapter.execute(
      `UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?`,
      [hash, Date.now(), id]
    );
    const success = result.affectedRows > 0;
    if (success) log("info", "auth.password_changed", { userId: id });
    return success;
  } else {
    const result = getDb().prepare("UPDATE users SET password_hash = ?, updated_at = unixepoch() WHERE id = ?").run(hash, id);
    const success = result.changes > 0;
    if (success) log("info", "auth.password_changed", { userId: id });
    return success;
  }
}

export async function deleteUser(id: string): Promise<boolean> {
  if (isMySQL()) {
    const adapter = await getMySQLAdapter();
    const result = await adapter.execute(
      `UPDATE users SET status = 'deleted', updated_at = ? WHERE id = ?`,
      [Date.now(), id]
    );
    const success = result.affectedRows > 0;
    if (success) log("info", "auth.user_deleted", { userId: id });
    return success;
  } else {
    const result = getDb().prepare("UPDATE users SET status = 'deleted', updated_at = unixepoch() WHERE id = ?").run(id);
    const success = result.changes > 0;
    if (success) log("info", "auth.user_deleted", { userId: id });
    return success;
  }
}

// ===== 认证 =====

export async function authenticate(username: string, password: string): Promise<User | null> {
  if (isMySQL()) {
    const adapter = await getMySQLAdapter();
    const rows = await adapter.query(
      `SELECT * FROM users WHERE username = ? AND status = 'active'`,
      [username]
    );
    if (rows.length === 0) {
      log("warn", "auth.login_failed", { username, reason: "user_not_found" });
      return null;
    }
    const row = rows[0];
    if (!(await verifyPassword(password, row.password_hash))) {
      log("warn", "auth.login_failed", { username, userId: row.id, reason: "invalid_password" });
      return null;
    }

    await adapter.execute(`UPDATE users SET last_login_at = ? WHERE id = ?`, [Date.now(), row.id]);
    log("info", "auth.login_success", { username, userId: row.id });
    return mapUser(row);
  } else {
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
}

// ===== 角色管理 =====

export async function getUsersByRole(roleId: string): Promise<User[]> {
  if (isMySQL()) {
    const adapter = await getMySQLAdapter();
    return await adapter.query(`
      SELECT u.*
      FROM users u
      JOIN user_roles ur ON ur.user_id = u.id
      WHERE ur.role_id = ? AND u.status != 'deleted'
    `, [roleId]);
  } else {
    return getDb().prepare(`
      SELECT u.*
      FROM users u
      JOIN user_roles ur ON ur.user_id = u.id
      WHERE ur.role_id = ? AND u.status != 'deleted'
    `).all(roleId) as any[];
  }
}

export async function getUsersByDepartment(departmentId: string): Promise<User[]> {
  if (isMySQL()) {
    const adapter = await getMySQLAdapter();
    return await adapter.query(`
      SELECT * FROM users WHERE department_id = ? AND status != 'deleted'
    `, [departmentId]);
  } else {
    return getDb().prepare(`
      SELECT * FROM users WHERE department_id = ? AND status != 'deleted'
    `).all(departmentId) as any[];
  }
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
  if (isMySQL()) {
    const adapter = await getMySQLAdapter();
    return await adapter.query(`
      SELECT r.id, r.name, r.description
      FROM roles r
      JOIN user_roles ur ON ur.role_id = r.id
      WHERE ur.user_id = ?
    `, [userId]);
  } else {
    return getDb().prepare(`
      SELECT r.id, r.name, r.description
      FROM roles r
      JOIN user_roles ur ON ur.role_id = r.id
      WHERE ur.user_id = ?
    `).all(userId) as any[];
  }
}

export async function assignRole(userId: string, roleId: string): Promise<void> {
  if (isMySQL()) {
    const adapter = await getMySQLAdapter();
    await adapter.execute(
      `INSERT IGNORE INTO user_roles (user_id, role_id, created_at) VALUES (?, ?, ?)`,
      [userId, roleId, Date.now()]
    );
  } else {
    getDb().prepare("INSERT OR IGNORE INTO user_roles (user_id, role_id) VALUES (?, ?)").run(userId, roleId);
  }
  log("info", "auth.role_assigned", { userId, roleId });
}

export async function removeRole(userId: string, roleId: string): Promise<void> {
  if (isMySQL()) {
    const adapter = await getMySQLAdapter();
    await adapter.execute(`DELETE FROM user_roles WHERE user_id = ? AND role_id = ?`, [userId, roleId]);
  } else {
    getDb().prepare("DELETE FROM user_roles WHERE user_id = ? AND role_id = ?").run(userId, roleId);
  }
  log("info", "auth.role_removed", { userId, roleId });
}

// ===== 权限查询（交叉控制） =====

export async function userHasPermission(userId: string, permissionName: string): Promise<boolean> {
  if (isMySQL()) {
    const adapter = await getMySQLAdapter();
    const rows = await adapter.query(`
      SELECT 1 FROM permissions p
      JOIN role_permissions rp ON rp.permission_id = p.id
      JOIN user_roles ur ON ur.role_id = rp.role_id
      WHERE ur.user_id = ? AND p.name = ?
      LIMIT 1
    `, [userId, permissionName]);
    return rows.length > 0;
  } else {
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
}

export async function getUserPermissions(userId: string): Promise<string[]> {
  if (isMySQL()) {
    const adapter = await getMySQLAdapter();
    const rows = await adapter.query(`
      SELECT DISTINCT p.name
      FROM permissions p
      JOIN role_permissions rp ON rp.permission_id = p.id
      JOIN user_roles ur ON ur.role_id = rp.role_id
      WHERE ur.user_id = ?
    `, [userId]);
    return rows.map((r: any) => r.name);
  } else {
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
    if (isMySQL()) {
      const adapter = await getMySQLAdapter();
      const rows = await adapter.query(`SELECT id, name, path FROM departments WHERE id = ?`, [user.departmentId]);
      if (rows.length > 0) {
        department = { id: rows[0].id, name: rows[0].name, path: rows[0].path };
      }
    } else {
      const dept = getDb().prepare("SELECT id, name, path FROM departments WHERE id = ?").get(user.departmentId) as any;
      if (dept) department = { id: dept.id, name: dept.name, path: dept.path };
    }
  }

  return { ...user, roles, department, permissions };
}

// ===== 角色列表 =====

export async function listRoles(): Promise<Array<{ id: string; name: string; description: string; isSystem: boolean }>> {
  if (isMySQL()) {
    const adapter = await getMySQLAdapter();
    const rows = await adapter.query(`SELECT * FROM roles ORDER BY id = 'role_admin' DESC, name`);
    return rows.map((r: any) => ({ id: r.id, name: r.name, description: r.description, isSystem: r.id === 'role_admin' || r.id === 'role_user' || r.id === 'role_viewer' }));
  } else {
    const rows = getDb().prepare("SELECT * FROM roles ORDER BY is_system DESC, name").all() as any[];
    return rows.map((r) => ({ id: r.id, name: r.name, description: r.description, isSystem: !!r.is_system }));
  }
}

export async function getRoleAgentConfig(roleId: string): Promise<RoleAgentConfig | null> {
  if (isMySQL()) {
    const adapter = await getMySQLAdapter();
    const rows = await adapter.query("SELECT agent_config FROM roles WHERE id = ?", [roleId]);
    const val = rows[0]?.agent_config;
    if (!val) return null;
    // mysql2 会自动解析 JSON 列为对象，如果是对象直接返回
    if (typeof val === 'object') return val as RoleAgentConfig;
    try {
      return JSON.parse(val) as RoleAgentConfig;
    } catch {
      return null;
    }
  } else {
    const row = getDb().prepare("SELECT agent_config FROM roles WHERE id = ?").get(roleId) as any;
    if (!row?.agent_config) return null;
    try {
      return JSON.parse(row.agent_config) as RoleAgentConfig;
    } catch {
      return null;
    }
  }
}

export async function updateRoleAgentConfig(roleId: string, config: RoleAgentConfig | null): Promise<void> {
  const configJson = config ? JSON.stringify(config) : null;
  if (isMySQL()) {
    const adapter = await getMySQLAdapter();
    await adapter.execute(
      "UPDATE roles SET agent_config = ?, updated_at = UNIX_TIMESTAMP() * 1000 WHERE id = ?",
      [configJson, roleId]
    );
  } else {
    getDb().prepare("UPDATE roles SET agent_config = ? WHERE id = ?").run(configJson, roleId);
  }
}

// ===== 角色创建/删除 =====

export async function createRole(input: { name: string; description?: string }): Promise<{ id: string; name: string; description: string; isSystem: boolean }> {
  const id = `role_${randomUUID().slice(0, 12)}`;
  
  if (isMySQL()) {
    const adapter = await getMySQLAdapter();
    await adapter.execute(
      `INSERT INTO roles (id, name, description) VALUES (?, ?, ?)`,
      [id, input.name, input.description ?? ""]
    );
  } else {
    const db = getDb();
    db.prepare("INSERT INTO roles (id, name, description, is_system) VALUES (?, ?, ?, 0)").run(id, input.name, input.description ?? "");
  }
  
  return { id, name: input.name, description: input.description ?? "", isSystem: false };
}

export async function deleteRole(id: string): Promise<boolean> {
  if (isMySQL()) {
    const adapter = await getMySQLAdapter();
    const rows = await adapter.query(`SELECT id FROM roles WHERE id = ?`, [id]);
    if (rows.length === 0) return false;
    
    await adapter.execute(`DELETE FROM role_permissions WHERE role_id = ?`, [id]);
    await adapter.execute(`DELETE FROM user_roles WHERE role_id = ?`, [id]);
    await adapter.execute(`DELETE FROM roles WHERE id = ?`, [id]);
    return true;
  } else {
    const db = getDb();
    const role = db.prepare("SELECT is_system FROM roles WHERE id = ?").get(id) as any;
    if (!role) return false;
    if (role.is_system) throw new Error("Cannot delete system role");
    db.prepare("DELETE FROM role_permissions WHERE role_id = ?").run(id);
    db.prepare("DELETE FROM user_roles WHERE role_id = ?").run(id);
    db.prepare("DELETE FROM roles WHERE id = ?").run(id);
    return true;
  }
}

// ===== 初始管理员 =====

export async function ensureAdminExists(): Promise<User> {
  const existing = await getUserByUsername("admin");
  if (existing) return existing;

  const id = `u_${randomUUID().slice(0, 12)}`;
  // P2-3 修复: 同事部署反馈 admin 密码随机生成, 不打印, 鸡生蛋登不进.
  // 优先用 INITIAL_ADMIN_PASSWORD env (部署者可设), 否则随机 (production 安全).
  const envPassword = process.env.INITIAL_ADMIN_PASSWORD;
  const isDevDefault = !envPassword || envPassword.length < 8;
  const initialPassword = isDevDefault ? randomBytes(16).toString("hex") : envPassword!;
  const passwordHash = await hashPassword(initialPassword);

  if (isMySQL()) {
    const adapter = await getMySQLAdapter();
    const now = Date.now();
    await adapter.execute(
      `INSERT INTO users (id, username, display_name, password_hash, department_id, created_at, updated_at)
       VALUES (?, 'admin', 'Administrator', ?, 'dept_root', ?, ?)`,
      [id, passwordHash, now, now]
    );
    await adapter.execute(
      `INSERT IGNORE INTO user_roles (user_id, role_id, created_at) VALUES (?, 'role_admin', ?)`,
      [id, now]
    );
  } else {
    const db = getDb();
    db.prepare(`
      INSERT INTO users (id, username, display_name, password_hash, department_id)
      VALUES (?, 'admin', 'Administrator', ?, 'dept_root')
    `).run(id, passwordHash);
    db.prepare("INSERT INTO user_roles (user_id, role_id) VALUES (?, 'role_admin')").run(id);
  }

  // P2-3 修复: dev/staging 打印明文密码 (INITIAL_ADMIN_PASSWORD 显式设置),
  // production / 未设 env 仍然隐藏 (走随机密码, 提示通过系统设置重置).
  const isProd = process.env.NODE_ENV === "production";
  if (envPassword && !isDevDefault && !isProd) {
    console.warn("╔════════════════════════════════════════════════════════════════════════════╗");
    console.warn("║  DEV/STAGING: Default admin account created with INITIAL_ADMIN_PASSWORD    ║");
    console.warn("╠════════════════════════════════════════════════════════════════════════════╣");
    console.warn("║  Username: admin                                                           ║");
    console.warn(`║  Password: ${initialPassword}                                                ║`);
    console.warn("║  ⚠️  在 production 请勿设置 INITIAL_ADMIN_PASSWORD, 否则密码会明文打印    ║");
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
