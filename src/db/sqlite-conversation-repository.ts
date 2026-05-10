import { getDb } from "./database.js";
import type { Message } from "../llm/types.js";
import type { ConversationRepository } from "./conversation-repository.types.js";

export class SQLiteConversationRepository implements ConversationRepository {
  async saveMessage(userId: string, conversationId: string, message: Message): Promise<void> {
    const db = getDb();
    const toolCalls = message.toolCalls ? JSON.stringify(message.toolCalls) : null;
    db.prepare(
      `INSERT INTO conversation_history (user_id, conversation_id, role, content, tool_calls, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(userId, conversationId, message.role, message.content ?? "", toolCalls, Date.now());
  }

  async getHistory(userId: string, conversationId: string, limit?: number): Promise<Message[]> {
    const db = getDb();
    let sql = `SELECT role, content, tool_calls FROM conversation_history
               WHERE user_id = ? AND conversation_id = ?
               ORDER BY created_at DESC`;
    const params: (string | number)[] = [userId, conversationId];
    if (limit !== undefined) {
      sql += " LIMIT ?";
      params.push(limit);
    }
    const rows = db.prepare(sql).all(...params) as Array<{
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
          const parsed = JSON.parse(row.tool_calls);
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
    const db = getDb();
    if (userId && conversationId) {
      db.prepare("DELETE FROM conversation_history WHERE user_id = ? AND conversation_id = ?").run(userId, conversationId);
    } else if (userId) {
      db.prepare("DELETE FROM conversation_history WHERE user_id = ?").run(userId);
    } else {
      db.prepare("DELETE FROM conversation_history").run();
    }
  }

  async listConversations(userId: string): Promise<string[]> {
    const db = getDb();
    const rows = db.prepare(
      "SELECT DISTINCT conversation_id FROM conversation_history WHERE user_id = ?"
    ).all(userId) as Array<{ conversation_id: string }>;
    return rows.map((r) => r.conversation_id);
  }
}
