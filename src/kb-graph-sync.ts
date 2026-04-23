/**
 * Knowledge Base & Knowledge Graph Synchronization
 * 
 * Handles syncing between KB documents and Knowledge Graph:
 * - When KB is shared: sync document node to shared user's graph
 * - When KB is deleted: remove document node from all users' graphs
 */
import { join } from "path";
import type { KnowledgeGraphManager } from "./memory/knowledge-graph/index.js";
import type { UserSessionManager } from "./user/user-session.js";
import { getAllTenants } from "./skills/knowledge-skills.js";
import { log } from "./utils/logger.js";

/**
 * Sync a KB document to a user's knowledge graph
 */
export async function syncKBToUserGraph(
  docId: string,
  docName: string,
  targetUserId: string,
  sharedByUserId: string,
  sessionManager: UserSessionManager
): Promise<void> {
  try {
    const session = sessionManager.getOrCreate(targetUserId);
    if (!session.graphManager) return;

    // Add document node to target user's knowledge graph
    await session.graphManager.onFactStored({
      id: `kb_shared_${docId}_${sharedByUserId}`,
      key: `kb:shared:${docName}`,
      value: `Shared document from ${sharedByUserId}`,
      tags: ['kb_document', 'shared', (docName.split('.').pop() || 'doc')],
      relation: `shared_by:${sharedByUserId}`,
      type: "kb_document",
    });

    log('info', 'kb_synced_to_user_graph', { docId, docName, targetUserId, sharedByUserId });
  } catch (error) {
    log('warn', 'kb_sync_to_graph_failed', { 
      docId, 
      targetUserId, 
      error: error instanceof Error ? error.message : String(error) 
    });
  }
}

/**
 * Remove a KB document from a user's knowledge graph
 */
export async function removeKBFromUserGraph(
  docId: string,
  docName: string,
  userId: string,
  sessionManager: UserSessionManager
): Promise<void> {
  try {
    const session = sessionManager.getOrCreate(userId);
    if (!session.graphManager) return;

    // Find and remove document nodes from user's graph
    const store = await session.graphManager.getStore();
    const nodes = await store.getAllNodes();

    // Remove nodes that reference this document
    const nodesToRemove: string[] = [];
    for (const node of nodes) {
      // 匹配各种知识库相关节点的 id 模式
      const isKBNode =
        node.id.startsWith(`kb_doc_${docId}`) ||
        node.id.startsWith(`kb_layout_`) && node.id.includes(docId) ||
        node.id.startsWith(`kb_seg_${docId}`) ||
        node.id.startsWith(`kb_content_${docId}`) ||
        node.id.includes(`kb_shared_${docId}`) ||
        // 同时匹配标签模式
        node.label === `kb:${docName}:chunk0` ||
        node.label.startsWith(`kb:${docName}:`);

      if (isKBNode) {
        nodesToRemove.push(node.id);
      }
    }

    // 执行删除操作
    for (const nodeId of nodesToRemove) {
      await store.removeNode(nodeId);
    }

    if (nodesToRemove.length > 0) {
      log('info', 'kb_removed_from_user_graph', { docId, docName, userId, removedNodes: nodesToRemove.length });
    }
  } catch (error) {
    log('warn', 'kb_remove_from_graph_failed', {
      docId,
      userId,
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

/**
 * Sync shared KB to all target users' graphs
 * Called when a KB document sharing status changes
 */
export async function syncSharedKBToGraphs(
  docId: string,
  docName: string,
  sharedByUserId: string,
  targetUserIds: string[],
  sessionManager: UserSessionManager
): Promise<void> {
  for (const targetUserId of targetUserIds) {
    if (targetUserId !== sharedByUserId) {
      await syncKBToUserGraph(docId, docName, targetUserId, sharedByUserId, sessionManager);
    }
  }
}

/**
 * Remove KB document from all users' graphs
 * Called when a KB document is deleted
 */
export async function removeKBFromAllGraphs(
  docId: string,
  docName: string,
  ownerId: string,
  sessionManager: UserSessionManager
): Promise<void> {
  // Get all users who might have this document in their graph
  const allUsers = await getAllTenants();
  
  // Also include the owner
  if (!allUsers.includes(ownerId)) {
    allUsers.push(ownerId);
  }

  for (const userId of allUsers) {
    await removeKBFromUserGraph(docId, docName, userId, sessionManager);
  }
}

/**
 * Get all users who have access to a shared KB document
 */
export async function getSharedKBTargetUsers(
  sharedByUserId: string,
  scope?: "all" | "role" | "department" | "user",
  targetId?: string
): Promise<string[]> {
  const tenants = await getAllTenants();

  if (!scope) {
    return tenants.filter((t: string) => t !== sharedByUserId);
  }

  if (scope === "all") {
    return tenants.filter((t: string) => t !== sharedByUserId);
  }

  if (scope === "user" && targetId) {
    return [targetId];
  }

  if (scope === "role" && targetId) {
    // Import user-repository dynamically
    const { getUsersByRole } = await import("./db/user-repository.js");
    const users = await getUsersByRole(targetId);
    return users.map((u: any) => u.id).filter((id: string) => id !== sharedByUserId);
  }

  if (scope === "department" && targetId) {
    // Import user-repository and department-repository dynamically
    const { getUsersByDepartment } = await import("./db/user-repository.js");
    const users = await getUsersByDepartment(targetId);
    return users.map((u: any) => u.id).filter((id: string) => id !== sharedByUserId);
  }

  return [];
}
