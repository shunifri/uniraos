import type { ConversationRepository } from "./conversation-repository.types.js";
import { SQLiteConversationRepository } from "./sqlite-conversation-repository.js";
import { MySQLConversationRepository } from "./mysql-conversation-repository.js";
import { isMySQL } from "./database.js";

export type { ConversationRepository } from "./conversation-repository.types.js";

export function createConversationRepository(): ConversationRepository {
  if (isMySQL()) {
    return new MySQLConversationRepository();
  }
  return new SQLiteConversationRepository();
}
