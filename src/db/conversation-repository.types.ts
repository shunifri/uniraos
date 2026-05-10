import type { Message } from "../llm/types.js";

export interface ConversationRepository {
  saveMessage(userId: string, conversationId: string, message: Message): Promise<void>;
  getHistory(userId: string, conversationId: string, limit?: number): Promise<Message[]>;
  clearHistory(userId?: string, conversationId?: string): Promise<void>;
  listConversations(userId: string): Promise<string[]>;
}
