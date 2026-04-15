import type { SkillRegistry } from '../registry/index.js';
import type { SkillDefinition } from '../types/index.js';
import { PermissionService } from './services/permission-service.js';
import { authMiddleware, requireAuth } from './middleware/auth-middleware.js';
import { createPermissionMiddleware } from './middleware/permission-middleware.js';
import { userIdContextMiddleware } from './middleware/data-isolation-middleware.js';
import { API_PERMISSIONS, MENU_PERMISSIONS, ROLE_NAMES } from './constants.js';
import * as helpers from './utils/helper.js';
import { PermissionChecker } from './utils/permission-checker.js';

let instance: PermissionService | null = null;
let registryRef: SkillRegistry | null = null;

export function initPermissionService(registry: SkillRegistry): PermissionService {
  registryRef = registry;
  instance = new PermissionService(registry);
  return instance;
}

export function getPermissionService(): PermissionService {
  if (!instance) {
    if (!registryRef) {
      throw new Error('PermissionService not initialized. Call initPermissionService first.');
    }
    instance = new PermissionService(registryRef);
  }
  return instance;
}

export const permissions = {
  get service(): PermissionService {
    return getPermissionService();
  },

  init(registry: SkillRegistry): PermissionService {
    return initPermissionService(registry);
  },

  constants: {
    API: API_PERMISSIONS,
    MENU: MENU_PERMISSIONS,
    ROLES: ROLE_NAMES,
  },

  middleware: {
    auth: authMiddleware,
    requireAuth,
    userIdContext: userIdContextMiddleware,
  },

  createMiddleware: createPermissionMiddleware,

  helpers,

  checker: (permissions: string[]) => new PermissionChecker(permissions),

  hasPermission: async (userId: string, permissionName: string) => {
    return getPermissionService().hasPermission(userId, permissionName);
  },

  checkPermission: async (userId: string, permissionName: string) => {
    return getPermissionService().checkPermission(userId, permissionName);
  },

  hasSkillPermission: async (userId: string, skillName: string) => {
    return getPermissionService().hasSkillPermission(userId, skillName);
  },

  checkSkillPermission: async (userId: string, skillName: string) => {
    return getPermissionService().checkSkillPermission(userId, skillName);
  },

  getAccessibleSkills: async (
    userId: string,
    options?: {
      visibleOnly?: boolean;
      allowedSkills?: string[];
    }
  ) => {
    return getPermissionService().getAccessibleSkills(userId, options);
  },

  getAccessibleSkillsList: async (
    userId: string,
    options?: {
      visibleOnly?: boolean;
      allowedSkills?: string[];
    }
  ): Promise<SkillDefinition[]> => {
    return getPermissionService().getAccessibleSkillsList(userId, options);
  },

  isAdmin: async (userId: string) => {
    return getPermissionService().isAdmin(userId);
  },

  invalidateCache: (userId?: string) => {
    getPermissionService().invalidateSkillCache(userId);
  },
};

export type { PermissionService } from './services/permission-service.js';
export type { SkillAccessResult } from './services/skill-permission-service.js';
export * from './types/index.js';
export * from './errors/permission-errors.js';
export * from './constants.js';
