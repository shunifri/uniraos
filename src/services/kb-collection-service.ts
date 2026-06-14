/**
 * 知识库集合服务
 * 支持多知识库分类管理
 */
import { getDb } from '../db/database.js';

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
  const db = getDb();
  const id = generateCollectionId();
  const now = Date.now();

  db.prepare(
    'INSERT INTO kb_collections (id, name, description, owner_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(id, input.name, input.description || '', ownerId, now, now);

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
  const db = getDb();

  // 1. 自己的 collections
  const ownRows = db.prepare(
    'SELECT id, name, description, owner_id, created_at, updated_at FROM kb_collections WHERE owner_id = ? ORDER BY created_at DESC'
  ).all(ownerId) as Array<{ id: string; name: string; description: string; owner_id: string; created_at: number; updated_at: number }>;

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
  const db = getDb();
  const r = db.prepare(
    'SELECT id, name, description, owner_id, created_at, updated_at FROM kb_collections WHERE id = ?'
  ).get(id) as { id: string; name: string; description: string; owner_id: string; created_at: number; updated_at: number } | undefined;

  if (!r) return null;
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
  const db = getDb();
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

  db.prepare(
    `UPDATE kb_collections SET ${fields.join(', ')} WHERE id = ?`
  ).run(...params);
}

/** 删除知识库集合 — 文档移回默认知识库 */
export async function deleteKBCollection(id: string, ownerId: string): Promise<void> {
  const db = getDb();

  // 获取默认知识库 ID
  const defaultRow = db.prepare(
    "SELECT id FROM kb_collections WHERE owner_id = ? AND name = '默认知识库'"
  ).get(ownerId) as { id: string } | undefined;
  const defaultCollectionId = defaultRow?.id;

  // 将集合内的文档移回默认库
  if (defaultCollectionId) {
    db.prepare(
      'UPDATE kb_documents SET collection_id = ? WHERE collection_id = ? AND owner_id = ?'
    ).run(defaultCollectionId, id, ownerId);
  } else {
    // 没有默认库，设为 NULL
    db.prepare(
      'UPDATE kb_documents SET collection_id = NULL WHERE collection_id = ? AND owner_id = ?'
    ).run(id, ownerId);
  }

  // 删除集合
  db.prepare(
    'DELETE FROM kb_collections WHERE id = ? AND owner_id = ?'
  ).run(id, ownerId);
}

/** 获取或创建默认知识库 */
export async function getOrCreateDefaultCollection(ownerId: string): Promise<string> {
  const db = getDb();

  const row = db.prepare(
    "SELECT id FROM kb_collections WHERE owner_id = ? AND name = '默认知识库'"
  ).get(ownerId) as { id: string } | undefined;

  if (row) return row.id;

  const collection = await createKBCollection(ownerId, {
    name: '默认知识库',
    description: '系统自动创建的默认知识库',
  });
  return collection.id;
}
