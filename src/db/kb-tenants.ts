import { getDb } from "./database.js";

/** 获取所有租户列表（基于 kb_documents 的 owner_id） */
export async function getAllTenants(): Promise<string[]> {
  try {
    const db = getDb();
    const rows = db.prepare("SELECT DISTINCT owner_id FROM kb_documents").all() as Array<{ owner_id: string }>;
    return rows.map((r) => r.owner_id);
  } catch {
    return [];
  }
}
