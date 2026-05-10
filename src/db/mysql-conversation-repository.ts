import { getMySQLAdapter } from "./mysql-adapter.js";
import type { Message } from "../llm/types.js";
import type { ConversationRepository } from "./conversation-repository.types.js";

export class MySQLConversationRepository implements ConversationRepository {
  async saveMessage(userId: string, conversationId: string, message: Message): Promise<void> {
    const adapter = getMySQLAdapter();
    const toolCalls = message.toolCalls ? JSON.stringify(message.toolCalls) : null;
    await adapter.execute(
      `INSERT INTO conversation_history (user_id, conversation_id, role, content, tool_calls, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [userId, conversationId, message.role, message.content ?? "", toolCalls, Date.now()]
    );
  }

  async getHistory(userId: string, conversationId: string, limit?: number): Promise<Message[]> {
    const adapter = getMySQLAdapter();
    let sql = `SELECT role, content, tool_calls FROM conversation_history
               WHERE user_id = ? AND conversation_id = ?
               ORDER BY created_at DESC`;
    const params: (string | number)[] = [userId, conversationId];
    if (limit !== undefined) {
      sql += " LIMIT ?";
      params.push(limit);
    }
    const rows = await adapter.query(sql, params) as Array<{
      role: string;
      content: string;
      tool_calls: string | null;
    }>;

    return rows.reverse().map((row) => {
      const msg: Message = {
        role: row.role as Message["role"],
        content: row.content ?? "",
      };
      if (row.tool_calls) {
        try {
          const parsed = typeof row.tool_calls === "string" ? JSON.parse(row.tool_calls) : row.tool_calls;
          if (parsed.toolCalls) msg.toolCalls = parsed.toolCalls;
          if (parsed.toolCallId) msg.toolCallId = parsed.toolCallId;
        } catch {
          // ignore parse error
        }
      }
      return msg;
    });
  }

  async clearHistory(userId?: string, conversationId?: string): Promise<void> {
    const adapter = getMySQLAdapter();
    if (userId && conversationId) {
      await adapter.execute("DELETE FROM conversation_history WHERE user_id = ? AND conversation_id = ?", [userId, conversationId]);
    } else if (userId) {
      await adapter.execute("DELETE FROM conversation_history WHERE user_id = ?", [userId]);
    } else {
      await adapter.execute("DELETE FROM conversation_history");
    }
  }

  async listConversations(userId: string): Promise<string[]> {
    const adapter = getMySQLAdapter();
    const rows = await adapter.query(
      "SELECT DISTINCT conversation_id FROM conversation_history WHERE user_id = ?",
      [userId]
    ) as Array<{ conversation_id: string }>;
    return rows.map((r) => r.conversation_id);
  }
}
