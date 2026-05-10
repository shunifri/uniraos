import { getMySQLAdapter } from "./mysql-adapter.js";

/** 获取所有租户列表（基于 kb_documents 的 owner_id） */
export async function getAllTenants(): Promise<string[]> {
  try {
    const adapter = getMySQLAdapter();
    const rows = await adapter.query<{ owner_id: string }>(
      "SELECT DISTINCT owner_id FROM kb_documents"
    );
    return rows.map((r) => r.owner_id);
  } catch {
    return [];
  }
}
