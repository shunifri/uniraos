/**
 * 资源与权限仓库：资源注册、权限管理、Skill 同步
 */
import { randomUUID } from "crypto";
import { getDb } from "./database.js";

export interface Resource {
  id: string;
  name: string;
  type: "api" | "skill" | "menu" | "data";
  description: string;
  createdAt: number;
}

export interface Permission {
  id: string;
  name: string;
  description: string;
  resourceId: string;
  action: string;
}

// ===== 资源 =====

export function listResources(type?: string): Resource[] {
  const db = getDb();
  if (type) {
    return (db.prepare("SELECT * FROM resources WHERE type = ? ORDER BY name").all(type) as any[]).map(mapResource);
  }
  return (db.prepare("SELECT * FROM resources ORDER BY type, name").all() as any[]).map(mapResource);
}

export function getResourceByName(name: string): Resource | null {
  const row = getDb().prepare("SELECT * FROM resources WHERE name = ?").get(name) as any;
  return row ? mapResource(row) : null;
}

export function getResourceById(id: string): Resource | null {
  const row = getDb().prepare("SELECT * FROM resources WHERE id = ?").get(id) as any;
  return row ? mapResource(row) : null;
}

export function createResource(input: { name: string; type: string; description?: string }): Resource {
  const db = getDb();
  const id = `res_${randomUUID().slice(0, 12)}`;
  db.prepare(`
    INSERT INTO resources (id, name, type, description) VALUES (?, ?, ?, ?)
  `).run(id, input.name, input.type, input.description ?? "");
  return getResourceById(id)!;
}

// ===== 权限 =====

export function listPermissions(): Permission[] {
  return (getDb().prepare("SELECT * FROM permissions ORDER BY name").all() as any[]).map(mapPermission);
}

export function createPermission(input: { name: string; description?: string; resourceId: string; action: string }): Permission {
  const db = getDb();
  const id = `perm_${randomUUID().slice(0, 12)}`;
  db.prepare(`
    INSERT INTO permissions (id, name, description, resource_id, action) VALUES (?, ?, ?, ?, ?)
  `).run(id, input.name, input.description ?? "", input.resourceId, input.action);

  const row = db.prepare("SELECT * FROM permissions WHERE id = ?").get(id) as any;
  return mapPermission(row);
}

export function getPermissionsByRole(roleId: string): Permission[] {
  return (getDb().prepare(`
    SELECT p.* FROM permissions p
    JOIN role_permissions rp ON rp.permission_id = p.id
    WHERE rp.role_id = ?
    ORDER BY p.name
  `).all(roleId) as any[]).map(mapPermission);
}

export function assignPermissionsToRole(roleId: string, permissionIds: string[]): void {
  const db = getDb();
  const stmt = db.prepare(
    "INSERT OR IGNORE INTO role_permissions (role_id, permission_id) VALUES (?, ?)"
  );
  const run = db.transaction(() => {
    for (const pid of permissionIds) {
      stmt.run(roleId, pid);
    }
  });
  run();
}

export function removePermissionsFromRole(roleId: string, permissionIds: string[]): void {
  const db = getDb();
  const stmt = db.prepare(
    "DELETE FROM role_permissions WHERE role_id = ? AND permission_id = ?"
  );
  const run = db.transaction(() => {
    for (const pid of permissionIds) {
      stmt.run(roleId, pid);
    }
  });
  run();
}

// ===== Skill 同步 =====

/** 从 SkillRegistry 同步 Skill 到资源表（upsert） */
export function syncSkillResources(skills: Array<{ name: string; description?: string }>): { added: number; total: number } {
  const db = getDb();
  let added = 0;

  const upsertResource = db.prepare(`
    INSERT INTO resources (id, name, type, description)
    VALUES (?, ?, 'skill', ?)
    ON CONFLICT(name) DO UPDATE SET description = excluded.description
  `);

  const upsertPermission = db.prepare(`
    INSERT INTO permissions (id, name, description, resource_id, action)
    VALUES (?, ?, ?, ?, 'execute')
    ON CONFLICT(name) DO UPDATE SET description = excluded.description
  `);

  // 将新的 skill 资源分配给根部门
  const assignToRoot = db.prepare(`
    INSERT OR IGNORE INTO department_resources (department_id, resource_id)
    VALUES ('dept_root', ?)
  `);

  const run = db.transaction(() => {
    for (const skill of skills) {
      const resourceName = `skill:${skill.name}`;
      const existing = getResourceByName(resourceName);

      if (!existing) {
        const resId = `res_skill_${skill.name.replace(/[^a-zA-Z0-9_]/g, '_')}`;
        upsertResource.run(resId, resourceName, skill.description ?? "");
        const permId = `perm_skill_${skill.name.replace(/[^a-zA-Z0-9_]/g, '_')}`;
        upsertPermission.run(permId, `skill:${skill.name}.execute`, `执行 Skill: ${skill.name}`, resId);
        assignToRoot.run(resId);
        added++;
      } else {
        upsertResource.run(existing.id, resourceName, skill.description ?? "");
      }
    }
  });

  run();

  const total = (db.prepare("SELECT COUNT(*) as c FROM resources WHERE type = 'skill'").get() as any).c;
  return { added, total };
}

// ===== 内部 =====

function mapResource(row: any): Resource {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    description: row.description ?? "",
    createdAt: row.created_at,
  };
}

function mapPermission(row: any): Permission {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? "",
    resourceId: row.resource_id,
    action: row.action,
  };
}
