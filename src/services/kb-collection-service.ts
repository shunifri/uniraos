/**
 * 知识库集合服务
 * 支持多知识库分类管理
 */

import { getDb, isMySQL } from '../db/database.js';
import type { MySQLAdapter } from '../db/mysql-adapter.js';

async function getAdapter(): Promise<MySQLAdapter> {
  if (isMySQL()) {
    const { getMySQLAdapter } = await import('../db/mysql-adapter.js');
    return getMySQLAdapter();
  }
  throw new Error('kb-collection-service requires MySQL adapter');
}

export interface KBCollection {
  id: string;
  name: string;
  description: string;
  ownerId: string;
  createdAt: number;
  updatedAt: number;
}

export interface KBCollectionInput {
  name: string;
  description?: string;
}

function generateCollectionId(): string {
  return `kbc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/** 创建知识库集合 */
export async function createKBCollection(
  ownerId: string,
  input: KBCollectionInput
): Promise<KBCollection> {
  const adapter = await getAdapter();
  const id = generateCollectionId();
  const now = Date.now();

  await adapter.execute(
    'INSERT INTO kb_collections (id, name, description, owner_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    [id, input.name, input.description || '', ownerId, now, now]
  );

  return {
    id,
    name: input.name,
    description: input.description || '',
    ownerId,
    createdAt: now,
    updatedAt: now,
  };
}

/** 列出用户的所有知识库集合（含共享的） */
export async function listKBCollections(ownerId: string): Promise<KBCollection[]> {
  const adapter = await getAdapter();

  // 1. 自己的 collections
  const ownRows = await adapter.query<
    { id: string; name: string; description: string; owner_id: string; created_at: number; updated_at: number }
  >(
    'SELECT id, name, description, owner_id, created_at, updated_at FROM kb_collections WHERE owner_id = ? ORDER BY created_at DESC',
    [ownerId]
  );

  // 自动创建默认知识库（用户首次使用时）
  if (ownRows.length === 0) {
    const defaultCollection = await createKBCollection(ownerId, {
      name: '默认知识库',
      description: '系统自动创建的默认知识库',
    });
    return [defaultCollection];
  }

  // 2. 共享给自己的 collections（通过 share_rules）
  // TODO: 共享实现时启用
  // const { ShareRepository } = await import('../db/share-repository.js');
  // const shared = await ShareRepository.getSharedToUser(ownerId, 'kb_collection');

  return ownRows.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    ownerId: r.owner_id,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));
}

/** 获取单个知识库集合 */
export async function getKBCollection(id: string): Promise<KBCollection | null> {
  const adapter = await getAdapter();
  const rows = await adapter.query<
    { id: string; name: string; description: string; owner_id: string; created_at: number; updated_at: number }
  >(
    'SELECT id, name, description, owner_id, created_at, updated_at FROM kb_collections WHERE id = ?',
    [id]
  );

  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    ownerId: r.owner_id,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/** 更新知识库集合 */
export async function updateKBCollection(
  id: string,
  updates: Partial<KBCollectionInput>
): Promise<void> {
  const adapter = await getAdapter();
  const fields: string[] = [];
  const params: unknown[] = [];

  if (updates.name !== undefined) {
    fields.push('name = ?');
    params.push(updates.name);
  }
  if (updates.description !== undefined) {
    fields.push('description = ?');
    params.push(updates.description);
  }
  if (fields.length === 0) return;

  fields.push('updated_at = ?');
  params.push(Date.now());
  params.push(id);

  await adapter.execute(
    `UPDATE kb_collections SET ${fields.join(', ')} WHERE id = ?`,
    params
  );
}

/** 删除知识库集合 — 文档移回默认知识库 */
export async function deleteKBCollection(id: string, ownerId: string): Promise<void> {
  const adapter = await getAdapter();

  // 获取默认知识库 ID
  const defaultRows = await adapter.query<{ id: string }>(
    "SELECT id FROM kb_collections WHERE owner_id = ? AND name = '默认知识库'",
    [ownerId]
  );
  const defaultCollectionId = defaultRows[0]?.id;

  // 将集合内的文档移回默认库
  if (defaultCollectionId) {
    await adapter.execute(
      'UPDATE kb_documents SET collection_id = ? WHERE collection_id = ? AND owner_id = ?',
      [defaultCollectionId, id, ownerId]
    );
  } else {
    // 没有默认库，设为 NULL
    await adapter.execute(
      'UPDATE kb_documents SET collection_id = NULL WHERE collection_id = ? AND owner_id = ?',
      [id, ownerId]
    );
  }

  // 删除集合
  await adapter.execute(
    'DELETE FROM kb_collections WHERE id = ? AND owner_id = ?',
    [id, ownerId]
  );
}

/** 获取或创建默认知识库 */
export async function getOrCreateDefaultCollection(ownerId: string): Promise<string> {
  const adapter = await getAdapter();

  const rows = await adapter.query<{ id: string }>(
    "SELECT id FROM kb_collections WHERE owner_id = ? AND name = '默认知识库'",
    [ownerId]
  );

  if (rows.length > 0) return rows[0].id;

  const collection = await createKBCollection(ownerId, {
    name: '默认知识库',
    description: '系统自动创建的默认知识库',
  });
  return collection.id;
}
