import { defineSkill, defineSystemSkill } from "../types/index.js";
import { Autonomy } from "../types/index.js";
import type { UserSessionManager } from "../user/user-session.js";
import type { SkillDefinition } from "../types/index.js";
import { getCurrentUserId } from "../user/request-context.js";
import { ShareRepository } from "../db/share-repository.js";
import { getUserRoles, getUserDepartment } from "../db/user-repository.js";
import { getKnowledgeBase } from "./knowledge-skills.js";

export function createGraphSkills(sessionManager: UserSessionManager): SkillDefinition[] {
  function getGraphManager(owner?: string) {
    // Access the current user's graphManager from session
    if (owner) {
      const session = sessionManager.getOrCreate(owner);
      return session.graphManager || null;
    }
    // Fallback: iterate sessions or use a default session approach
    for (const s of (sessionManager as any).sessions?.values?.() ?? []) {
      if (s.graphManager) return s.graphManager;
    }
    return null;
  }

  return [
    defineSystemSkill({
      name: "graph_query",
      visible: true,
      description: "查询知识图谱。通过 BFS 遍历返回与查询相关的节点和边。参数: query(string), maxDepth?(number), maxNodes?(number), owner?(string, 默认当前用户)",
      paramSchema: {
        properties: {
          query: { type: "string", description: "搜索查询" },
          maxDepth: { type: "number", description: "BFS 遍历深度（默认 3）" },
          maxNodes: { type: "number", description: "最大返回节点数（默认 50）" },
          owner: { type: "string", description: "知识图谱所属用户（默认当前用户）" },
        },
        required: ["query"],
      },
      handler: async (params) => {
        const owner = (params.owner as string) || getCurrentUserId();
        const gm = getGraphManager(owner);
        if (!gm) return { success: false, error: new Error("知识图谱未初始化") };

        // 获取用户自己的知识库文档 ID + 有权访问的共享文档 ID
        const kb = getKnowledgeBase(owner);
        const ownDocIds = await kb.getAllDocIds();

        const shareRepo = ShareRepository.getInstance();
        const userRoles = await getUserRoles(owner);
        const roleIds = userRoles.map(r => r.id);
        const userDept = await getUserDepartment(owner);
        const deptPath = userDept?.path || "/";
        const sharedRules = await shareRepo.getSharedToUser(owner, roleIds, deptPath);

        // 过滤知识库文档类型的共享规则，提取文档 ID
        const kbRules = sharedRules.filter(rule => rule.resourceType === "kb_document");
        const sharedDocIds = kbRules.map(rule => rule.resourceId);

        const allowedDocIds = [...new Set([...ownDocIds, ...sharedDocIds])];

        const result = await gm.querySubgraph(params.query as string, {
          maxDepth: params.maxDepth as number,
          maxNodes: params.maxNodes as number,
          allowedDocIds: allowedDocIds,
        });

        return {
          success: true,
          data: { totalNodes: result.nodes.length, totalEdges: result.edges.length, ...result }
        };
      },
    }),

    defineSystemSkill({
      name: "graph_path",
      visible: true,
      description: "查找知识图谱中两个概念之间的最短路径。参数: source(string), target(string), owner?(string, 默认当前用户)",
      paramSchema: {
        properties: {
          source: { type: "string", description: "起始节点标签" },
          target: { type: "string", description: "目标节点标签" },
          owner: { type: "string", description: "知识图谱所属用户（默认当前用户）" },
        },
        required: ["source", "target"],
      },
      handler: async (params) => {
        const owner = (params.owner as string) || getCurrentUserId();
        const gm = getGraphManager(owner);
        if (!gm) return { success: false, error: new Error("知识图谱未初始化") };

        // 获取允许的文档 ID 列表用于结果过滤
        const kb = getKnowledgeBase(owner);
        const ownDocIds = await kb.getAllDocIds();
        const shareRepo = ShareRepository.getInstance();
        const userRoles = await getUserRoles(owner);
        const roleIds = userRoles.map(r => r.id);
        const userDept = await getUserDepartment(owner);
        const deptPath = userDept?.path || "/";
        const sharedRules = await shareRepo.getSharedToUser(owner, roleIds, deptPath);
        const kbRules = sharedRules.filter(rule => rule.resourceType === "kb_document");
        const sharedDocIds = kbRules.map(rule => rule.resourceId);
        const allowedDocIds = new Set([...ownDocIds, ...sharedDocIds]);

        const result = await gm.getPath(params.source as string, params.target as string);
        if (!result) return { success: true, data: { found: false, message: "未找到路径" } };

        // 过滤路径中的节点：kb_document 节点必须属于 allowedDocIds
        const filteredPath = result.path.filter((n: any) => {
          if (!n.tags?.some((t: string) => t === 'kb_document')) return true;
          return allowedDocIds.size === 0 || [...allowedDocIds].some((id: string) => n.id.includes(id));
        });

        return { success: true, data: { found: true, pathLength: filteredPath.length, path: filteredPath.map((n: any) => n.label), edges: result.edges.length } };
      },
    }),

    defineSystemSkill({
      name: "graph_communities",
      visible: true,
      description: "查看知识图谱的社区结构。参数: rebuild?(boolean), owner?(string, 默认当前用户)",
      paramSchema: {
        properties: {
          rebuild: { type: "boolean", description: "是否重建社区（默认 false）" },
          owner: { type: "string", description: "知识图谱所属用户（默认当前用户）" },
        },
      },
      handler: async (params) => {
        const owner = (params.owner as string) || getCurrentUserId();
        const gm = getGraphManager(owner);
        if (!gm) return { success: false, error: new Error("知识图谱未初始化") };

        // 获取允许的文档 ID 列表用于结果过滤
        const kb = getKnowledgeBase(owner);
        const ownDocIds = await kb.getAllDocIds();
        const shareRepo = ShareRepository.getInstance();
        const userRoles = await getUserRoles(owner);
        const roleIds = userRoles.map(r => r.id);
        const userDept = await getUserDepartment(owner);
        const deptPath = userDept?.path || "/";
        const sharedRules = await shareRepo.getSharedToUser(owner, roleIds, deptPath);
        const kbRules = sharedRules.filter(rule => rule.resourceType === "kb_document");
        const sharedDocIds = kbRules.map(rule => rule.resourceId);
        const allowedDocIds = new Set([...ownDocIds, ...sharedDocIds]);

        if (params.rebuild) await gm.rebuildCommunities();
        const { communities, stats } = await gm.getCommunities();
        const commList = [...communities.entries()].map(([id, nodeIds]: [number, string[]]) => {
          const filteredNodes = nodeIds.filter((nid: string) => {
            // 非 kb_document 节点直接允许
            if (!nid.startsWith('kb_doc_')) return true;
            return allowedDocIds.size === 0 || [...allowedDocIds].some((docId: string) => nid.includes(docId));
          });
          return { id, size: filteredNodes.length, nodes: filteredNodes.slice(0, 10) };
        });
        return { success: true, data: { ...stats, communities: commList } };
       },
     }),

     defineSystemSkill({
       name: "graph_deduplicate",
       visible: true,
       description: "知识图谱节点去重，合并相同标签的节点并转移关系。参数: owner?(string, 默认当前用户)",
       paramSchema: {
         properties: {
           owner: { type: "string", description: "知识图谱所属用户（默认当前用户）" },
         },
       },
       handler: async (params) => {
         const owner = (params.owner as string) || getCurrentUserId();
         const gm = getGraphManager(owner);
         if (!gm) return { success: false, error: new Error("知识图谱未初始化") };
         const store = await gm.getStore();
         const result = await store.deduplicateNodes();
         return {
           success: true,
           data: {
             merged: result.merged,
             removed: result.removed,
             message: `去重完成：合并 ${result.merged} 个节点，移除 ${result.removed} 个重复节点`
           }
         };
       },
     }),
   ];
 }
