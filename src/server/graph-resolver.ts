import type { UserSessionManager } from "../user/user-session.js";
import type { KnowledgeGraphManager } from "../memory/knowledge-graph/manager.js";

export function getGraphManagerForUser(sessionManager: UserSessionManager, userId: string): KnowledgeGraphManager | null {
  const session = sessionManager.getOrCreate(userId);
  return session.graphManager ?? null;
}
