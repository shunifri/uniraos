/**
 * 部门仓库：CRUD + 树操作 + 资源分配
 * 支持 SQLite 和 MySQL 双模式
 */
import { randomUUID } from "crypto";
import { getDb, isMySQL } from "./database.js";

export interface Department {
  id: string;
  name: string;
  parentId: string | null;
  path: string;
  level: number;
  description: string;
  createdAt: number;
  updatedAt: number;
}

export interface CreateDepartmentInput {
  name: string;
  parentId?: string;
  description?: string;
}

async function getMySQLAdapter() {
  const { getMySQLAdapter: getAdapter } = await import('./mysql-adapter.js');
  return getAdapter();
}

// ===== CRUD =====

export async function createDepartment(input: CreateDepartmentInput): Promise<Department> {
  const id = `dept_${randomUUID().slice(0, 12)}`;

  let parentPath = "";
  let level = 0;

  if (input.parentId) {
    const parent = await getDepartmentById(input.parentId);
    if (!parent) throw new Error(`Parent department not found: ${input.parentId}`);
    parentPath = parent.path;
    level = parent.level + 1;
  }

  const path = parentPath ? `${parentPath}/${input.name}` : `/${input.name}`;

  // MySQL path
  if (isMySQL()) {
    const adapter = await getMySQLAdapter();
    
    // 检查同级重名
    const existing = await adapter.query(
      "SELECT 1 FROM departments WHERE parent_id <=> ? AND name = ?",
      [input.parentId ?? null, input.name]
    );
    if (existing.length > 0) throw new Error(`Department "${input.name}" already exists under this parent`);

    await adapter.execute(
      `INSERT INTO departments (id, name, parent_id, path, level, description) VALUES (?, ?, ?, ?, ?, ?)`,
      [id, input.name, input.parentId ?? null, path, level, input.description ?? ""]
    );

    const dept = await getDepartmentById(id);
    if (!dept) throw new Error("Failed to create department");
    return dept;
  }

  // SQLite path
  const db = getDb();

  // 检查同级重名
  const existing = db.prepare(
    "SELECT 1 FROM departments WHERE parent_id IS ? AND name = ?"
  ).get(input.parentId ?? null, input.name);
  if (existing) throw new Error(`Department "${input.name}" already exists under this parent`);

  db.prepare(`
    INSERT INTO departments (id, name, parent_id, path, level, description)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, input.name, input.parentId ?? null, path, level, input.description ?? "");

  const dept = await getDepartmentById(id);
  if (!dept) throw new Error("Failed to create department");
  return dept;
}

export async function getDepartmentById(id: string): Promise<Department | null> {
  if (isMySQL()) {
    const adapter = await getMySQLAdapter();
    const rows = await adapter.query(
      "SELECT * FROM departments WHERE id = ?",
      [id]
    );
    return rows.length > 0 ? mapDepartment(rows[0]) : null;
  }
  
  const row = getDb().prepare("SELECT * FROM departments WHERE id = ?").get(id) as any;
  return row ? mapDepartment(row) : null;
}

export async function getDepartmentTree(): Promise<Department[]> {
  if (isMySQL()) {
    const adapter = await getMySQLAdapter();
    const rows = await adapter.query(
      "SELECT * FROM departments ORDER BY path"
    );
    return rows.map(mapDepartment);
  }
  
  const rows = getDb().prepare("SELECT * FROM departments ORDER BY path").all() as any[];
  return rows.map(mapDepartment);
}

export async function getDepartmentChildren(parentId: string): Promise<Department[]> {
  if (isMySQL()) {
    const adapter = await getMySQLAdapter();
    const rows = await adapter.query(
      "SELECT * FROM departments WHERE parent_id = ? ORDER BY name",
      [parentId]
    );
    return rows.map(mapDepartment);
  }
  
  const rows = getDb().prepare(
    "SELECT * FROM departments WHERE parent_id = ? ORDER BY name"
  ).all(parentId) as any[];
  return rows.map(mapDepartment);
}

export async function updateDepartment(id: string, fields: { name?: string; description?: string }): Promise<Department | null> {
  const dept = await getDepartmentById(id);
  if (!dept) return null;

  const sets: string[] = [];
  const vals: unknown[] = [];

  if (fields.name !== undefined && fields.name !== dept.name) {
    // 更新自身及所有子部门的 path
    const oldPath = dept.path;
    const parentPath = dept.parentId 
      ? (await getDepartmentById(dept.parentId))?.path ?? ""
      : "";
    const newPath = parentPath ? `${parentPath}/${fields.name}` : `/${fields.name}`;

    sets.push("name = ?", "path = ?");
    vals.push(fields.name, newPath);

    // 更新所有子部门路径
    if (isMySQL()) {
      const adapter = await getMySQLAdapter();
      await adapter.execute(
        `UPDATE departments SET path = CONCAT(?, SUBSTRING(path, ?)), updated_at = UNIX_TIMESTAMP() * 1000 
         WHERE path LIKE CONCAT(?, '/%')`,
        [newPath, oldPath.length + 1, oldPath]
      );
    } else {
      const db = getDb();
      db.prepare(`
        UPDATE departments SET path = ? || SUBSTR(path, LENGTH(?) + 1), updated_at = unixepoch()
        WHERE path LIKE ? || '/%'
      `).run(newPath, oldPath, oldPath);
    }
  }

  if (fields.description !== undefined) {
    sets.push("description = ?");
    vals.push(fields.description);
  }

  if (sets.length === 0) return dept;

  if (isMySQL()) {
    const adapter = await getMySQLAdapter();
    sets.push("updated_at = UNIX_TIMESTAMP() * 1000");
    vals.push(id);
    await adapter.execute(
      `UPDATE departments SET ${sets.join(", ")} WHERE id = ?`,
      vals
    );
  } else {
    const db = getDb();
    sets.push("updated_at = unixepoch()");
    vals.push(id);
    db.prepare(`UPDATE departments SET ${sets.join(", ")} WHERE id = ?`).run(...vals);
  }

  return getDepartmentById(id);
}

export async function deleteDepartment(id: string): Promise<void> {
  if (id === "dept_root") throw new Error("Cannot delete root department");

  if (isMySQL()) {
    const adapter = await getMySQLAdapter();
    
    // 检查是否有子部门
    const children = await adapter.query(
      "SELECT COUNT(*) as c FROM departments WHERE parent_id = ?",
      [id]
    );
    if (children[0].c > 0) throw new Error("Cannot delete department with children. Delete children first.");

    // 检查是否有用户
    const users = await adapter.query(
      "SELECT COUNT(*) as c FROM users WHERE department_id = ?",
      [id]
    );
    if (users[0].c > 0) throw new Error("Cannot delete department with users. Reassign users first.");

    await adapter.execute(
      "DELETE FROM departments WHERE id = ?",
      [id]
    );
    return;
  }

  // SQLite path
  const db = getDb();

  // 检查是否有子部门
  const children = db.prepare("SELECT COUNT(*) as c FROM departments WHERE parent_id = ?").get(id) as any;
  if (children.c > 0) throw new Error("Cannot delete department with children. Delete children first.");

  // 检查是否有用户
  const users = db.prepare("SELECT COUNT(*) as c FROM users WHERE department_id = ?").get(id) as any;
  if (users.c > 0) throw new Error("Cannot delete department with users. Reassign users first.");

  db.prepare("DELETE FROM departments WHERE id = ?").run(id);
}

// ===== 资源分配 =====

export async function assignResources(departmentId: string, resourceIds: string[]): Promise<void> {
  if (isMySQL()) {
    const adapter = await getMySQLAdapter();
    for (const rid of resourceIds) {
      await adapter.execute(
        `INSERT IGNORE INTO department_resources (department_id, resource_id) VALUES (?, ?)`,
        [departmentId, rid]
      );
    }
    return;
  }
  
  const db = getDb();
  const stmt = db.prepare(
    "INSERT OR IGNORE INTO department_resources (department_id, resource_id) VALUES (?, ?)"
  );
  const run = db.transaction(() => {
    for (const rid of resourceIds) {
      stmt.run(departmentId, rid);
    }
  });
  run();
}

export async function removeResources(departmentId: string, resourceIds: string[]): Promise<void> {
  if (isMySQL()) {
    const adapter = await getMySQLAdapter();
    for (const rid of resourceIds) {
      await adapter.execute(
        `DELETE FROM department_resources WHERE department_id = ? AND resource_id = ?`,
        [departmentId, rid]
      );
    }
    return;
  }
  
  const db = getDb();
  const stmt = db.prepare(
    "DELETE FROM department_resources WHERE department_id = ? AND resource_id = ?"
  );
  const run = db.transaction(() => {
    for (const rid of resourceIds) {
      stmt.run(departmentId, rid);
    }
  });
  run();
}

export async function getDepartmentResources(departmentId: string): Promise<Array<{ id: string; name: string; type: string; description: string }>> {
  if (isMySQL()) {
    const adapter = await getMySQLAdapter();
    const rows = await adapter.query(
      `SELECT r.id, r.name, r.type, r.description
       FROM resources r
       JOIN department_resources dr ON dr.resource_id = r.id
       WHERE dr.department_id = ?
       ORDER BY r.type, r.name`,
      [departmentId]
    );
    return rows;
  }
  
  return getDb().prepare(`
    SELECT r.id, r.name, r.type, r.description
    FROM resources r
    JOIN department_resources dr ON dr.resource_id = r.id
    WHERE dr.department_id = ?
    ORDER BY r.type, r.name
  `).all(departmentId) as any[];
}

/** 获取部门的有效资源（含祖先继承） */
export async function getDepartmentEffectiveResources(departmentId: string): Promise<Array<{ id: string; name: string; type: string; description: string }>> {
  const dept = await getDepartmentById(departmentId);
  if (!dept) return [];

  if (isMySQL()) {
    const adapter = await getMySQLAdapter();
    const rows = await adapter.query(
      `SELECT DISTINCT r.id, r.name, r.type, r.description
       FROM resources r
       JOIN department_resources dr ON dr.resource_id = r.id
       JOIN departments d ON d.id = dr.department_id
       WHERE ? LIKE CONCAT(d.path, '%')
       ORDER BY r.type, r.name`,
      [dept.path]
    );
    return rows;
  }
  
  return getDb().prepare(`
    SELECT DISTINCT r.id, r.name, r.type, r.description
    FROM resources r
    JOIN department_resources dr ON dr.resource_id = r.id
    JOIN departments d ON d.id = dr.department_id
    WHERE ? LIKE d.path || '%'
    ORDER BY r.type, r.name
  `).all(dept.path) as any[];
}

// ===== 内部 =====

function mapDepartment(row: any): Department {
  return {
    id: row.id,
    name: row.name,
    parentId: row.parent_id,
    path: row.path,
    level: row.level,
    description: row.description ?? "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
