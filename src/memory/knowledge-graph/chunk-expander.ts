/**
 * Chunk Expander — KG v2 阶段 3 KG-first 检索的 Step 3
 *
 * 职责：把 recall 命中的 entity 节点（带 sourceChunkIds）反查为 KB chunks。
 * 这是 KG-first 主链路的关键跳板：让图谱的"结构化召回"变成 KB 的"原文召回"。
 *
 * 详见 docs/KG_ARCHITECTURE_VISION.md §4.3。
 */
import type { GraphNode } from "./types.js";
import { getMySQLAdapter } from "../../db/mysql-adapter.js";
import type { MySQLAdapter } from "../../db/mysql-adapter.js";

export interface ExpandedChunk {
  /** KB chunk 主键 */
  chunkId: number;
  /** 所属文档 ID */
  docId: string;
  /** 文档名 */
  docName?: string;
  /** chunk 索引 */
  chunkIndex: number;
  /** chunk 文本 */
  content: string;
  /** KG 召回给的图谱信号：关联的 entity 节点 + 关系路径 */
  graphSignal: {
    /** 关联的 entity 节点（这些 entity 都从该 chunk 抽出） */
    relatedEntities: GraphNode[];
    /** 关联的 sourceChunkId 列表（用于回溯） */
    sourceChunkIds: string[];
  };
  /** 图谱相关性评分 0-1 */
  graphScore: number;
}

export interface ExpandOptions {
  /** 每个 entity 节点最多召回多少个 chunk，默认 3 */
  perEntityLimit?: number;
  /** 最终返回的 chunk 上限，默认 20 */
  maxChunks?: number;
  /** 是否允许同 docId 的相邻 chunk（用于上下文扩展），默认 false */
  includeNeighbors?: boolean;
}

/**
 * 解析 phase 1 写入的 sourceChunkId 格式：`{docId}_chunk_{chunkIndex}`。
 * 返回 null 表示格式不识别。
 */
function parseSourceChunkId(sourceChunkId: string): { docId: string; chunkIndex: number } | null {
  const m = sourceChunkId.match(/^(.+)_chunk_(\d+)$/);
  if (!m) return null;
  return { docId: m[1], chunkIndex: Number(m[2]) };
}

/**
 * P0-3 修复：批量反查多个 (docId, chunkIndex) 对应的 KB chunks。
 * 之前 N+1 现在单次 IN 查询（MySQL 5.7+ 支持 row constructor）。
 *
 * 返回：Map<key, chunk>，key 格式 `${docId}::${chunkIndex}`
 */
async function fetchChunksByDocAndIndex(
  adapter: MySQLAdapter,
  pairs: Array<{ docId: string; chunkIndex: number }>
): Promise<Map<string, { chunkId: number; docId: string; docName?: string; content: string }>> {
  const out = new Map<string, { chunkId: number; docId: string; docName?: string; content: string }>();
  if (pairs.length === 0) return out;

  // 用 OR 链式等值：MySQL/SQLite 通用，跨数据库兼容
  // 对 N 对参数：4N 个占位符 (doc_id=? AND chunk_index=?) OR ...
  const conditions = pairs.map(() => "(c.doc_id = ? AND c.chunk_index = ?)").join(" OR ");
  const params: Array<string | number> = [];
  for (const p of pairs) {
    params.push(p.docId, p.chunkIndex);
  }

  const rows = await adapter.query<{
    id: number;
    doc_id: string;
    doc_name: string | null;
    chunk_index: number;
    content: string;
  }>(
    `SELECT c.id, c.doc_id, c.chunk_index, d.name as doc_name, c.content
     FROM kb_chunks c
     LEFT JOIN kb_documents d ON c.doc_id = d.doc_id
     WHERE ${conditions}`,
    params
  );

  for (const row of rows) {
    const key = `${row.doc_id}::${row.chunk_index}`;
    out.set(key, {
      chunkId: row.id,
      docId: row.doc_id,
      docName: row.doc_name ?? undefined,
      content: row.content,
    });
  }
  return out;
}

/**
 * 主入口：把 recall 出的 entity 节点（带 sourceChunkIds）展开为 KB chunks。
 *
 * 去重策略：
 * - 同一个 (docId, chunkIndex) 多次出现只取一个
 * - 按 graphScore 降序，截断到 maxChunks
 */
export async function expandToChunks(
  entities: GraphNode[],
  options?: ExpandOptions
): Promise<ExpandedChunk[]> {
  const opts = {
    perEntityLimit: options?.perEntityLimit ?? 3,
    maxChunks: options?.maxChunks ?? 20,
    includeNeighbors: options?.includeNeighbors ?? false,
  };

  if (entities.length === 0) return [];

  const adapter = getMySQLAdapter();
  const seen = new Map<string, ExpandedChunk>();
  const entityBySourceChunk = new Map<string, GraphNode[]>();

  // 1. 收集所有 (docId, chunkIndex) 候选
  for (const entity of entities) {
    if (!entity.sourceChunkIds || entity.sourceChunkIds.length === 0) continue;
    for (const scid of entity.sourceChunkIds.slice(0, opts.perEntityLimit)) {
      const parsed = parseSourceChunkId(scid);
      if (!parsed) continue;
      const key = `${parsed.docId}::${parsed.chunkIndex}`;
      if (!entityBySourceChunk.has(key)) entityBySourceChunk.set(key, []);
      entityBySourceChunk.get(key)!.push(entity);
    }
  }

  // 2. P0-3 修复：批量反查 KB（一次 SQL 拿所有 chunks）
  const pairs: Array<{ docId: string; chunkIndex: number }> = [];
  for (const key of entityBySourceChunk.keys()) {
    const [docId, idxStr] = key.split("::");
    const chunkIndex = Number(idxStr);
    pairs.push({ docId, chunkIndex });
  }
  const chunkMap = await fetchChunksByDocAndIndex(adapter, pairs);

  for (const [key, relatedEntities] of entityBySourceChunk.entries()) {
    const chunk = chunkMap.get(key);
    if (!chunk) continue;
    const chunkIndex = Number(key.split("::")[1]);

    // 同一 chunk 多次出现时累加 graphScore
    const existing = seen.get(key);
    if (existing) {
      existing.graphScore = Math.min(1.0, existing.graphScore + 0.1 * relatedEntities.length);
      for (const e of relatedEntities) {
        if (!existing.graphSignal.relatedEntities.some((x) => x.id === e.id)) {
          existing.graphSignal.relatedEntities.push(e);
        }
      }
    } else {
      seen.set(key, {
        chunkId: chunk.chunkId,
        docId: chunk.docId,
        docName: chunk.docName,
        chunkIndex,
        content: chunk.content,
        graphSignal: {
          relatedEntities,
          sourceChunkIds: relatedEntities.flatMap((e) => e.sourceChunkIds ?? []),
        },
        graphScore: Math.min(1.0, 0.5 + 0.1 * relatedEntities.length),
      });
    }
  }

  // 3. 排序 + 截断
  const result = Array.from(seen.values()).sort((a, b) => b.graphScore - a.graphScore);
  return result.slice(0, opts.maxChunks);
}
