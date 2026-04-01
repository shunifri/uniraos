/**
 * 用户仓库：CRUD + 密码哈希 + 角色/权限查询（交叉控制模型）
 *
 * 交叉控制：用户可访问资源 R 执行操作 A ⟺
 *   (1) 用户的角色授予了 Permission(R, A)    ← 角色维度
 *   AND
 *   (2) 用户所在部门（含祖先）拥有资源 R     ← 部门维度
 *   例外：admin 角色跳过部门检查
 */
import { randomBytes, scryptSync } from "crypto";
import { randomUUID } from "crypto";
import { getDb } from "./database.js";

export interface User {
  id: string;
  username: string;
  displayName: string;
  avatar: string;
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
}

export interface UserWithDetails extends User {
  roles: Array<{ id: string; name: string; description: string }>;
  department: { id: string; name: string; path: string } | null;
  permissions: string[];
}

// ===== 密码哈希 =====

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const check = scryptSync(password, salt, 64).toString("hex");
  return hash === check;
}

// ===== 用户 CRUD =====

export function createUser(input: CreateUserInput): User {
  const db = getDb();
  const id = `u_${randomUUID().slice(0, 12)}`;
  const passwordHash = hashPassword(input.password);
  const departmentId = input.departmentId ?? "dept_root";

  db.prepare(`
    INSERT INTO users (id, username, display_name, password_hash, department_id)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, input.username, input.displayName ?? input.username, passwordHash, departmentId);

  // 默认赋予 user 角色
  db.prepare("INSERT INTO user_roles (user_id, role_id) VALUES (?, 'role_user')").run(id);

  return getUserById(id)!;
}

export function getUserById(id: string): User | null {
  const row = getDb().prepare("SELECT * FROM users WHERE id = ? AND status != 'deleted'").get(id) as any;
  return row ? mapUser(row) : null;
}

export function getUserByUsername(username: string): User | null {
  const row = getDb().prepare("SELECT * FROM users WHERE username = ? AND status != 'deleted'").get(username) as any;
  return row ? mapUser(row) : null;
}

export function listUsers(opts?: { limit?: number; offset?: number; status?: string }): User[] {
  const limit = opts?.limit ?? 50;
  const offset = opts?.offset ?? 0;
  const status = opts?.status ?? "active";

  const rows = getDb().prepare(
    "SELECT * FROM users WHERE status = ? ORDER BY created_at DESC LIMIT ? OFFSET ?"
  ).all(status, limit, offset) as any[];

  return rows.map(mapUser);
}

export function countUsers(status = "active"): number {
  const row = getDb().prepare("SELECT COUNT(*) as c FROM users WHERE status = ?").get(status) as any;
  return row.c;
}

export function updateUser(id: string, fields: { displayName?: string; avatar?: string; status?: string; departmentId?: string }): User | null {
  const db = getDb();
  const sets: string[] = [];
  const vals: unknown[] = [];

  if (fields.displayName !== undefined) { sets.push("display_name = ?"); vals.push(fields.displayName); }
  if (fields.avatar !== undefined) { sets.push("avatar = ?"); vals.push(fields.avatar); }
  if (fields.status !== undefined) { sets.push("status = ?"); vals.push(fields.status); }
  if (fields.departmentId !== undefined) { sets.push("department_id = ?"); vals.push(fields.departmentId); }

  if (sets.length === 0) return getUserById(id);

  sets.push("updated_at = unixepoch()");
  vals.push(id);

  db.prepare(`UPDATE users SET ${sets.join(", ")} WHERE id = ?`).run(...vals);
  return getUserById(id);
}

export function changePassword(id: string, newPassword: string): boolean {
  const hash = hashPassword(newPassword);
  const result = getDb().prepare("UPDATE users SET password_hash = ?, updated_at = unixepoch() WHERE id = ?").run(hash, id);
  return result.changes > 0;
}

export function deleteUser(id: string): boolean {
  // 软删除
  const result = getDb().prepare("UPDATE users SET status = 'deleted', updated_at = unixepoch() WHERE id = ?").run(id);
  return result.changes > 0;
}

// ===== 认证 =====

export function authenticate(username: string, password: string): User | null {
  const row = getDb().prepare("SELECT * FROM users WHERE username = ? AND status = 'active'").get(username) as any;
  if (!row) return null;
  if (!verifyPassword(password, row.password_hash)) return null;

  // 更新最后登录时间
  getDb().prepare("UPDATE users SET last_login_at = unixepoch() WHERE id = ?").run(row.id);

  return mapUser(row);
}

// ===== 角色管理 =====

export function getUserRoles(userId: string): Array<{ id: string; name: string; description: string }> {
  return getDb().prepare(`
    SELECT r.id, r.name, r.description
    FROM roles r
    JOIN user_roles ur ON ur.role_id = r.id
    WHERE ur.user_id = ?
  `).all(userId) as any[];
}

export function assignRole(userId: string, roleId: string): void {
  getDb().prepare(
    "INSERT OR IGNORE INTO user_roles (user_id, role_id) VALUES (?, ?)"
  ).run(userId, roleId);
}

export function removeRole(userId: string, roleId: string): void {
  getDb().prepare("DELETE FROM user_roles WHERE user_id = ? AND role_id = ?").run(userId, roleId);
}

// ===== 权限查询（交叉控制） =====

/**
 * 检查用户是否拥有指定权限（交叉控制模型）
 *
 * 条件：
 *   (1) 用户角色授予了该 permission（角色维度）
 *   AND
 *   (2) 用户部门（含祖先）拥有该 permission 关联的 resource（部门维度）
 *   例外：admin 角色跳过部门检查
 */
export function userHasPermission(userId: string, permissionName: string): boolean {
  const db = getDb();

  // 先检查是否是 admin（跳过部门检查）
  const isAdmin = db.prepare(`
    SELECT 1 FROM user_roles ur
    JOIN roles r ON r.id = ur.role_id
    WHERE ur.user_id = ? AND r.name = 'admin'
    LIMIT 1
  `).get(userId);

  if (isAdmin) {
    // admin 只需角色维度
    const hasRolePerm = db.prepare(`
      SELECT 1 FROM permissions p
      JOIN role_permissions rp ON rp.permission_id = p.id
      JOIN user_roles ur ON ur.role_id = rp.role_id
      WHERE ur.user_id = ? AND p.name = ?
      LIMIT 1
    `).get(userId, permissionName);
    return !!hasRolePerm;
  }

  // 非 admin：交叉控制（6 表 JOIN）
  const row = db.prepare(`
    SELECT 1
    FROM permissions p
    JOIN role_permissions rp ON rp.permission_id = p.id
    JOIN user_roles ur ON ur.role_id = rp.role_id
    JOIN users u ON u.id = ur.user_id
    JOIN departments user_dept ON user_dept.id = u.department_id
    WHERE ur.user_id = ?
      AND p.name = ?
      AND EXISTS (
        SELECT 1 FROM department_resources dr
        JOIN departments res_dept ON res_dept.id = dr.department_id
        WHERE dr.resource_id = p.resource_id
          AND user_dept.path LIKE res_dept.path || '%'
      )
    LIMIT 1
  `).get(userId, permissionName);

  return !!row;
}

/** 获取用户所有有效权限名（已过交叉控制） */
export function getUserPermissions(userId: string): string[] {
  const db = getDb();

  // admin 直接返回角色权限
  const isAdmin = db.prepare(`
    SELECT 1 FROM user_roles ur
    JOIN roles r ON r.id = ur.role_id
    WHERE ur.user_id = ? AND r.name = 'admin'
    LIMIT 1
  `).get(userId);

  if (isAdmin) {
    const rows = db.prepare(`
      SELECT DISTINCT p.name
      FROM permissions p
      JOIN role_permissions rp ON rp.permission_id = p.id
      JOIN user_roles ur ON ur.role_id = rp.role_id
      WHERE ur.user_id = ?
    `).all(userId) as Array<{ name: string }>;
    return rows.map((r) => r.name);
  }

  // 非 admin：交叉控制
  const rows = db.prepare(`
    SELECT DISTINCT p.name
    FROM permissions p
    JOIN role_permissions rp ON rp.permission_id = p.id
    JOIN user_roles ur ON ur.role_id = rp.role_id
    JOIN users u ON u.id = ur.user_id
    JOIN departments user_dept ON user_dept.id = u.department_id
    WHERE ur.user_id = ?
      AND EXISTS (
        SELECT 1 FROM department_resources dr
        JOIN departments res_dept ON res_dept.id = dr.department_id
        WHERE dr.resource_id = p.resource_id
          AND user_dept.path LIKE res_dept.path || '%'
      )
  `).all(userId) as Array<{ name: string }>;

  return rows.map((r) => r.name);
}

/** 获取用户完整详情（用户+角色+部门+权限） */
export function getUserWithDetails(userId: string): UserWithDetails | null {
  const user = getUserById(userId);
  if (!user) return null;

  const roles = getUserRoles(userId);
  const permissions = getUserPermissions(userId);

  let department: { id: string; name: string; path: string } | null = null;
  if (user.departmentId) {
    const dept = getDb().prepare("SELECT id, name, path FROM departments WHERE id = ?").get(user.departmentId) as any;
    if (dept) department = { id: dept.id, name: dept.name, path: dept.path };
  }

  return {
    ...user,
    roles,
    department,
    permissions,
  };
}

// ===== 角色列表 =====

export function listRoles(): Array<{ id: string; name: string; description: string; isSystem: boolean }> {
  const rows = getDb().prepare("SELECT * FROM roles ORDER BY is_system DESC, name").all() as any[];
  return rows.map((r) => ({ id: r.id, name: r.name, description: r.description, isSystem: !!r.is_system }));
}

// ===== 角色创建/删除 =====

export function createRole(input: { name: string; description?: string }): { id: string; name: string; description: string; isSystem: boolean } {
  const db = getDb();
  const id = `role_${randomUUID().slice(0, 12)}`;
  db.prepare("INSERT INTO roles (id, name, description, is_system) VALUES (?, ?, ?, 0)").run(id, input.name, input.description ?? "");
  return { id, name: input.name, description: input.description ?? "", isSystem: false };
}

export function deleteRole(id: string): boolean {
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

export function ensureAdminExists(): User {
  const existing = getUserByUsername("admin");
  if (existing) return existing;

  const db = getDb();
  const id = `u_${randomUUID().slice(0, 12)}`;
  const passwordHash = hashPassword("admin123");

  db.prepare(`
    INSERT INTO users (id, username, display_name, password_hash, department_id)
    VALUES (?, 'admin', 'Administrator', ?, 'dept_root')
  `).run(id, passwordHash);

  db.prepare("INSERT INTO user_roles (user_id, role_id) VALUES (?, 'role_admin')").run(id);

  console.log("   Default admin created (admin / admin123)");
  return getUserById(id)!;
}

// ===== 内部 =====

function mapUser(row: any): User {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    avatar: row.avatar ?? "",
    departmentId: row.department_id ?? null,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastLoginAt: row.last_login_at,
  };
}
