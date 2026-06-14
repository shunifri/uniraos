import type { ConversationRepository } from "./conversation-repository.types.js";
import { SQLiteConversationRepository } from "./sqlite-conversation-repository.js";

export type { ConversationRepository } from "./conversation-repository.types.js";

export function createConversationRepository(): ConversationRepository {
  return new SQLiteConversationRepository();
}
