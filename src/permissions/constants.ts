import { USER_ALLOWED_SKILLS, ANONYMOUS_ALLOWED_SKILLS, ADMIN_SKILL_PERMISSIONS } from '../config/skill-permissions.js';

// API Permissions
export const API_PERMISSIONS = {
  SKILLS_READ: 'skills.read',
  SKILLS_EXECUTE: 'skills.execute',
  SKILLS_MANAGE: 'skills.manage',
  CONFIG_READ: 'config.read',
  CONFIG_WRITE: 'config.write',
  CHAT: 'chat',
  CHAT_STREAM: 'chat.stream',
  MEMORY_READ: 'memory.read',
  MEMORY_WRITE: 'memory.write',
  KNOWLEDGE_READ: 'knowledge.read',
  KNOWLEDGE_WRITE: 'knowledge.write',
  KNOWLEDGE_MANAGE: 'knowledge.manage',
  FILES_READ: 'files.read',
  FILES_WRITE: 'files.write',
  CONVERSATION_READ: 'conversation.read',
  CONVERSATION_WRITE: 'conversation.write',
  USERS_MANAGE: 'users.manage',
  ROLES_MANAGE: 'roles.manage',
  DEPARTMENTS_MANAGE: 'departments.manage',
  PLUGINS_MANAGE: 'plugins.manage',
  TASKS_READ: 'tasks.read',
  SYSTEM_MANAGE: 'system.manage',
} as const;

// Menu Permissions
export const MENU_PERMISSIONS = {
  MENU_SKILLS: 'menu:skills.read',
  MENU_CHAT: 'menu:chat.read',
  MENU_KNOWLEDGE: 'menu:knowledge.read',
  MENU_FILES: 'menu:files.read',
  MENU_CONFIG: 'menu:config.read',
  MENU_MEMORY: 'menu:memory.read',
  MENU_EVOLUTION: 'menu:evolution.read',
  MENU_GENEALOGY: 'menu:genealogy.read',
  MENU_FEDERATION: 'menu:federation.read',
  MENU_GRAPH: 'menu:graph.read',
  MENU_ADMIN: 'menu:admin.read',
} as const;

// Role names
export const ROLE_NAMES = {
  ADMIN: 'admin',
  USER: 'user',
  ANONYMOUS: 'anonymous',
} as const;

// Re-export from skill-permissions for consistency
export { USER_ALLOWED_SKILLS, ANONYMOUS_ALLOWED_SKILLS, ADMIN_SKILL_PERMISSIONS };

// Helper to create skill permission name
export function skillPermission(skillName: string): string {
  return `skill:${skillName}.execute`;
}

// Helper to check if permission is admin-only
export function isAdminPermission(permissionName: string): boolean {
  return [
    API_PERMISSIONS.USERS_MANAGE,
    API_PERMISSIONS.ROLES_MANAGE,
    API_PERMISSIONS.DEPARTMENTS_MANAGE,
    API_PERMISSIONS.PLUGINS_MANAGE,
    API_PERMISSIONS.SYSTEM_MANAGE,
  ].includes(permissionName as any);
}
