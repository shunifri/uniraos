/**
 * 共享规则仓库 — CRUD + 按用户/资源查询
 */
import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";

export interface ShareRule {
  id: string;
  resourceType: "skill" | "kb_document" | "file";
  resourceId: string;
  ownerId: string;
  scope: "all" | "role" | "department" | "user";
  targetId?: string;
  permission: "read" | "execute" | "write";
  createdAt: number;
}

interface ShareRuleRow {
  id: string;
  resource_type: string;
  resource_id: string;
  owner_id: string;
  scope: string;
  target_id: string | null;
  permission: string;
  created_at: number;
}

function rowToRule(row: ShareRuleRow): ShareRule {
  return {
    id: row.id,
    resourceType: row.resource_type as ShareRule["resourceType"],
    resourceId: row.resource_id,
    ownerId: row.owner_id,
    scope: row.scope as ShareRule["scope"],
    targetId: row.target_id ?? undefined,
    permission: row.permission as ShareRule["permission"],
    createdAt: row.created_at,
  };
}

export class ShareRepository {
  constructor(private db: Database.Database) {}

  /** 创建共享规则 */
  create(rule: Omit<ShareRule, "id" | "createdAt">): ShareRule {
    const id = randomUUID();
    const createdAt = Math.floor(Date.now() / 1000);
    this.db.prepare(`
      INSERT INTO share_rules (id, resource_type, resource_id, owner_id, scope, target_id, permission, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, rule.resourceType, rule.resourceId, rule.ownerId, rule.scope, rule.targetId ?? null, rule.permission, createdAt);
    return { id, createdAt, ...rule };
  }

  /** 删除共享规则 */
  delete(id: string): boolean {
    const result = this.db.prepare("DELETE FROM share_rules WHERE id = ?").run(id);
    return result.changes > 0;
  }

  /** 更新共享规则 */
  update(id: string, updates: Partial<Pick<ShareRule, "scope" | "targetId" | "permission">>): boolean {
    const sets: string[] = [];
    const values: unknown[] = [];
    if (updates.scope !== undefined) { sets.push("scope = ?"); values.push(updates.scope); }
    if (updates.targetId !== undefined) { sets.push("target_id = ?"); values.push(updates.targetId); }
    if (updates.permission !== undefined) { sets.push("permission = ?"); values.push(updates.permission); }
    if (sets.length === 0) return false;
    values.push(id);
    const result = this.db.prepare(`UPDATE share_rules SET ${sets.join(", ")} WHERE id = ?`).run(...values);
    return result.changes > 0;
  }

  /** 获取资源的所有共享规则 */
  getByResource(resourceType: string, resourceId: string): ShareRule[] {
    const rows = this.db.prepare(
      "SELECT * FROM share_rules WHERE resource_type = ? AND resource_id = ?"
    ).all(resourceType, resourceId) as ShareRuleRow[];
    return rows.map(rowToRule);
  }

  /** 获取用户创建的所有共享规则 */
  getByOwner(ownerId: string): ShareRule[] {
    const rows = this.db.prepare(
      "SELECT * FROM share_rules WHERE owner_id = ?"
    ).all(ownerId) as ShareRuleRow[];
    return rows.map(rowToRule);
  }

  /** 获取单条共享规则 */
  getById(id: string): ShareRule | null {
    const row = this.db.prepare("SELECT * FROM share_rules WHERE id = ?").get(id) as ShareRuleRow | undefined;
    return row ? rowToRule(row) : null;
  }

  /** 获取共享给特定用户的资源（考虑 all/role/department/user 四种范围） */
  getSharedToUser(userId: string, userRoleIds: string[], userDeptPath: string): ShareRule[] {
    if (userRoleIds.length === 0) {
      const rows = this.db.prepare(`
        SELECT * FROM share_rules WHERE
          scope = 'all'
          OR (scope = 'user' AND target_id = ?)
          OR (scope = 'department' AND ? LIKE '%' || target_id || '%')
      `).all(userId, userDeptPath) as ShareRuleRow[];
      return rows.map(rowToRule);
    }
    const rolePlaceholders = userRoleIds.map(() => "?").join(",");
    const rows = this.db.prepare(`
      SELECT * FROM share_rules WHERE
        scope = 'all'
        OR (scope = 'user' AND target_id = ?)
        OR (scope = 'role' AND target_id IN (${rolePlaceholders}))
        OR (scope = 'department' AND ? LIKE '%' || target_id || '%')
    `).all(userId, ...userRoleIds, userDeptPath) as ShareRuleRow[];
    return rows.map(rowToRule);
  }

  /** 获取特定类型共享给用户的资源 ID 列表 */
  getSharedResourceIds(resourceType: string, userId: string, userRoleIds: string[], userDeptPath: string): string[] {
    const rules = this.getSharedToUser(userId, userRoleIds, userDeptPath);
    return [...new Set(rules.filter(r => r.resourceType === resourceType).map(r => r.resourceId))];
  }
}
