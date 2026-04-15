/**
 * Skill 权限配置
 *
 * 统一管理各角色可访问的 Skill 白名单
 * 避免硬编码在数据库 migration 中
 *
 * @deprecated Use src/permissions/constants.ts instead
 * This module will be removed in a future version.
 */

/** 普通用户可用的 Skill 列表 */
export const USER_ALLOWED_SKILLS = [
  // 知识库
  'kb_search', 'kb_ingest', 'kb_list', 'kb_delete', 'kb_share',
  // 记忆
  'stm_store', 'stm_retrieve', 'stm_forget', 'ltm_store', 'ltm_search', 'ltm_delete', 'ltm_list',
  // 图表
  'chart_recommend', 'chart_generate', 'chart_multi',
  // 文档
  'doc_read', 'doc_read_csv',
  // 网络搜索
  'web_search', 'web_fetch',
  // 知识图谱
  'graph_query', 'graph_path', 'graph_communities',
  // 交互
  'user_confirm',
  // 规划
  'plan_and_execute',
] as const;

/** 匿名用户可用的 Skill 列表（最小集） */
export const ANONYMOUS_ALLOWED_SKILLS = [
  'user_confirm',
  'kb_search', 'kb_list',
  'chart_recommend', 'chart_generate',
  'web_search', 'web_fetch',
  'doc_read',
] as const;

/** 管理员默认拥有的 Skill 权限（通配符表示全部） */
export const ADMIN_SKILL_PERMISSIONS = [
  'skill:*.execute',
  'skill:*.read',
  'skill:*.manage',
] as const;

/**
 * 检查 Skill 是否在用户白名单中
 */
export function isSkillAllowedForUser(skillName: string): boolean {
  return USER_ALLOWED_SKILLS.includes(skillName as any);
}

/**
 * 检查 Skill 是否在匿名用户白名单中
 */
export function isSkillAllowedForAnonymous(skillName: string): boolean {
  return ANONYMOUS_ALLOWED_SKILLS.includes(skillName as any);
}

/**
 * 获取角色对应的 Skill 权限列表
 */
export function getSkillPermissionsForRole(role: 'user' | 'anonymous' | 'admin'): string[] {
  switch (role) {
    case 'user':
      return USER_ALLOWED_SKILLS.map(s => `skill:${s}.execute`);
    case 'anonymous':
      return ANONYMOUS_ALLOWED_SKILLS.map(s => `skill:${s}.execute`);
    case 'admin':
      return [...ADMIN_SKILL_PERMISSIONS];
    default:
      return [];
  }
}
