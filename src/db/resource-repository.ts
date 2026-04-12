/**
 * 资源与权限仓库：资源注册、权限管理、Skill 同步
 * 支持 SQLite 和 MySQL 双模式
 */
import { randomUUID } from "crypto";
import { getDb, isMySQL } from "./database.js";

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

async function getMySQLAdapter() {
  const { getMySQLAdapter: getAdapter } = await import('./mysql-adapter.js');
  return getAdapter();
}

// ===== 资源 =====

export async function listResources(type?: string): Promise<Resource[]> {
  if (isMySQL()) {
    const adapter = await getMySQLAdapter();
    const rows = await adapter.query(
      type 
        ? "SELECT * FROM resources WHERE type = ? ORDER BY name"
        : "SELECT * FROM resources ORDER BY type, name",
      type ? [type] : []
    );
    return rows.map(mapResource);
  }
  
  const db = getDb();
  if (type) {
    return (db.prepare("SELECT * FROM resources WHERE type = ? ORDER BY name").all(type) as any[]).map(mapResource);
  }
  return (db.prepare("SELECT * FROM resources ORDER BY type, name").all() as any[]).map(mapResource);
}

export async function getResourceByName(name: string): Promise<Resource | null> {
  if (isMySQL()) {
    const adapter = await getMySQLAdapter();
    const rows = await adapter.query(
      "SELECT * FROM resources WHERE name = ?",
      [name]
    );
    return rows.length > 0 ? mapResource(rows[0]) : null;
  }
  
  const row = getDb().prepare("SELECT * FROM resources WHERE name = ?").get(name) as any;
  return row ? mapResource(row) : null;
}

export async function getResourceById(id: string): Promise<Resource | null> {
  if (isMySQL()) {
    const adapter = await getMySQLAdapter();
    const rows = await adapter.query(
      "SELECT * FROM resources WHERE id = ?",
      [id]
    );
    return rows.length > 0 ? mapResource(rows[0]) : null;
  }
  
  const row = getDb().prepare("SELECT * FROM resources WHERE id = ?").get(id) as any;
  return row ? mapResource(row) : null;
}

export async function createResource(input: { name: string; type: string; description?: string }): Promise<Resource> {
  const id = `res_${randomUUID().slice(0, 12)}`;
  
  if (isMySQL()) {
    const adapter = await getMySQLAdapter();
    await adapter.execute(
      `INSERT INTO resources (id, name, type, description) VALUES (?, ?, ?, ?)`,
      [id, input.name, input.type, input.description ?? ""]
    );
    const resource = await getResourceById(id);
    if (!resource) throw new Error("Failed to create resource");
    return resource;
  }
  
  const db = getDb();
  db.prepare(`
    INSERT INTO resources (id, name, type, description) VALUES (?, ?, ?, ?)
  `).run(id, input.name, input.type, input.description ?? "");
  
  const resource = await getResourceById(id);
  if (!resource) throw new Error("Failed to create resource");
  return resource;
}

// ===== 权限 =====

export async function listPermissions(): Promise<Permission[]> {
  if (isMySQL()) {
    const adapter = await getMySQLAdapter();
    const rows = await adapter.query(
      "SELECT * FROM permissions ORDER BY name"
    );
    return rows.map(mapPermission);
  }
  
  return (getDb().prepare("SELECT * FROM permissions ORDER BY name").all() as any[]).map(mapPermission);
}

export async function createPermission(input: { name: string; description?: string; resourceId: string; action: string }): Promise<Permission> {
  const id = `perm_${randomUUID().slice(0, 12)}`;
  
  if (isMySQL()) {
    const adapter = await getMySQLAdapter();
    await adapter.execute(
      `INSERT INTO permissions (id, name, description, resource_id, action) VALUES (?, ?, ?, ?, ?)`,
      [id, input.name, input.description ?? "", input.resourceId, input.action]
    );
    const permission = await getPermissionById(id);
    if (!permission) throw new Error("Failed to create permission");
    return permission;
  }
  
  const db = getDb();
  db.prepare(`
    INSERT INTO permissions (id, name, description, resource_id, action) VALUES (?, ?, ?, ?, ?)
  `).run(id, input.name, input.description ?? "", input.resourceId, input.action);

  const row = db.prepare("SELECT * FROM permissions WHERE id = ?").get(id) as any;
  return mapPermission(row);
}

async function getPermissionById(id: string): Promise<Permission | null> {
  if (isMySQL()) {
    const adapter = await getMySQLAdapter();
    const rows = await adapter.query(
      "SELECT * FROM permissions WHERE id = ?",
      [id]
    );
    return rows.length > 0 ? mapPermission(rows[0]) : null;
  }
  
  const row = getDb().prepare("SELECT * FROM permissions WHERE id = ?").get(id) as any;
  return row ? mapPermission(row) : null;
}

export async function getPermissionsByRole(roleId: string): Promise<Permission[]> {
  if (isMySQL()) {
    const adapter = await getMySQLAdapter();
    const rows = await adapter.query(
      `SELECT p.* FROM permissions p
       JOIN role_permissions rp ON rp.permission_id = p.id
       WHERE rp.role_id = ?
       ORDER BY p.name`,
      [roleId]
    );
    return rows.map(mapPermission);
  }
  
  return (getDb().prepare(`
    SELECT p.* FROM permissions p
    JOIN role_permissions rp ON rp.permission_id = p.id
    WHERE rp.role_id = ?
    ORDER BY p.name
  `).all(roleId) as any[]).map(mapPermission);
}

export async function assignPermissionsToRole(roleId: string, permissionIds: string[]): Promise<void> {
  if (isMySQL()) {
    const adapter = await getMySQLAdapter();
    for (const pid of permissionIds) {
      await adapter.execute(
        `INSERT IGNORE INTO role_permissions (role_id, permission_id) VALUES (?, ?)`,
        [roleId, pid]
      );
    }
    return;
  }
  
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

export async function removePermissionsFromRole(roleId: string, permissionIds: string[]): Promise<void> {
  if (isMySQL()) {
    const adapter = await getMySQLAdapter();
    for (const pid of permissionIds) {
      await adapter.execute(
        `DELETE FROM role_permissions WHERE role_id = ? AND permission_id = ?`,
        [roleId, pid]
      );
    }
    return;
  }
  
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
export async function syncSkillResources(skills: Array<{ name: string; description?: string }>): Promise<{ added: number; total: number }> {
  let added = 0;
  
  if (isMySQL()) {
    const adapter = await getMySQLAdapter();
    
    for (const skill of skills) {
      const resourceName = `skill:${skill.name}`;
      const existing = await getResourceByName(resourceName);
      
      const resId = `res_skill_${skill.name.replace(/[^a-zA-Z0-9_]/g, '_')}`;
      
      if (!existing) {
        // Insert resource
        await adapter.execute(
          `INSERT INTO resources (id, name, type, description) VALUES (?, ?, 'skill', ?)
           ON DUPLICATE KEY UPDATE description = VALUES(description)`,
          [resId, resourceName, skill.description ?? ""]
        );
        
        // Insert permission
        const permId = `perm_skill_${skill.name.replace(/[^a-zA-Z0-9_]/g, '_')}`;
        await adapter.execute(
          `INSERT INTO permissions (id, name, description, resource_id, action) 
           VALUES (?, ?, ?, ?, 'execute')
           ON DUPLICATE KEY UPDATE description = VALUES(description)`,
          [permId, `skill:${skill.name}.execute`, `执行 Skill: ${skill.name}`, resId]
        );
        
        // Assign to root department
        await adapter.execute(
          `INSERT IGNORE INTO department_resources (department_id, resource_id) VALUES ('dept_root', ?)`,
          [resId]
        );
        
        added++;
      } else {
        // Update existing
        await adapter.execute(
          `UPDATE resources SET description = ? WHERE id = ?`,
          [skill.description ?? "", existing.id]
        );
      }
    }
    
    const rows = await adapter.query(
      "SELECT COUNT(*) as c FROM resources WHERE type = 'skill'"
    );
    return { added, total: rows[0].c };
  }
  
  // SQLite path
  const db = getDb();

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
      const existing = db.prepare("SELECT * FROM resources WHERE name = ?").get(resourceName) as any;

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
