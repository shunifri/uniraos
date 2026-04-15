# Unified Permission Service Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a unified permission service that centralizes all permission-related functionality in RAOS, replacing scattered permission checks with a single, consistent API.

**Architecture:** Create a new `src/permissions/` module with clear layered architecture:
- Types: Centralized permission type definitions
- Constants: Permission names and resource types
- Services: Core permission logic
- Middleware: Express middleware for route protection
- Managers: Permission management components
- Utils: Helper functions and validators
- Errors: Custom permission error types

**Tech Stack:** TypeScript, Express, SQLite/MySQL (existing stack)

---

## Phase 0: Foundation & Infrastructure

### Task 0.1: Create Directory Structure

**Files:**
- Create: `src/permissions/types/index.ts`
- Create: `src/permissions/types/permission.ts`
- Create: `src/permissions/types/role.ts`
- Create: `src/permissions/types/resource.ts`
- Create: `src/permissions/types/share.ts`
- Create: `src/permissions/errors/permission-errors.ts`
- Create: `src/permissions/constants.ts`

- [ ] **Step 1: Create base type files**

```typescript
// src/permissions/types/permission.ts
export type PermissionName = string;
export type ActionType = 'read' | 'write' | 'execute' | 'manage';
export type ResourceType = 'api' | 'skill' | 'menu' | 'data' | 'knowledge' | 'memory';

export interface Permission {
  id: string;
  name: PermissionName;
  description: string;
  resourceId: string;
  action: ActionType;
}

export interface PermissionCheckResult {
  hasPermission: boolean;
  reason?: string;
  permission?: PermissionName;
}
```

```typescript
// src/permissions/types/role.ts
export interface Role {
  id: string;
  name: string;
  description: string;
  isSystem: boolean;
  createdAt: number;
}

export interface UserRoleAssignment {
  userId: string;
  roleId: string;
  grantedAt: number;
}
```

```typescript
// src/permissions/types/resource.ts
export interface Resource {
  id: string;
  name: string;
  type: ResourceType;
  description: string;
  createdAt: number;
}
```

```typescript
// src/permissions/types/share.ts
export type ShareScope = 'all' | 'role' | 'department' | 'user' | 'none';
export type SharePermission = 'read' | 'execute' | 'write';

export interface ShareRule {
  id: string;
  resourceType: 'skill' | 'kb_document' | 'file';
  resourceId: string;
  ownerId: string;
  scope: ShareScope;
  targetId?: string;
  permission: SharePermission;
  createdAt: number;
}
```

```typescript
// src/permissions/types/index.ts
export * from './permission';
export * from './role';
export * from './resource';
export * from './share';
```

- [ ] **Step 2: Create permission errors file**

```typescript
// src/permissions/errors/permission-errors.ts
export class PermissionError extends Error {
  readonly name = 'PermissionError';

  constructor(
    message: string,
    public readonly permissionName?: string,
    public readonly userId?: string,
  ) {
    super(message);
    Object.setPrototypeOf(this, PermissionError.prototype);
  }
}

export class AuthenticationRequiredError extends PermissionError {
  readonly name = 'AuthenticationRequiredError';

  constructor(message: string = 'Authentication required') {
    super(message);
    Object.setPrototypeOf(this, AuthenticationRequiredError.prototype);
  }
}

export class AccessDeniedError extends PermissionError {
  readonly name = 'AccessDeniedError';

  constructor(
    permissionName: string,
    userId?: string,
    message?: string,
  ) {
    super(message || `Access denied: ${permissionName}`, permissionName, userId);
    Object.setPrototypeOf(this, AccessDeniedError.prototype);
  }
}

export class SkillAccessDeniedError extends PermissionError {
  readonly name = 'SkillAccessDeniedError';

  constructor(
    skillName: string,
    userId?: string,
  ) {
    super(`Permission denied for skill: ${skillName}`, `skill:${skillName}.execute`, userId);
    Object.setPrototypeOf(this, SkillAccessDeniedError.prototype);
  }
}
```

- [ ] **Step 3: Create constants file**

```typescript
// src/permissions/constants.ts
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
```

---

## Phase 1: Core Services

### Task 1.1: Skill Permission Service

**Files:**
- Create: `src/permissions/services/skill-permission-service.ts`
- Create: `src/permissions/services/data-isolation-service.ts`
- Create: `src/permissions/services/share-service.ts`

- [ ] **Step 1: Create SkillPermissionService**

```typescript
// src/permissions/services/skill-permission-service.ts
import type { SkillRegistry } from '../../registry/index.js';
import type { SkillDefinition } from '../../types/index.js';
import { getUserPermissions, getUserRoles, getUserById } from '../../db/user-repository.js';
import { getDepartmentById } from '../../db/department-repository.js';
import { ShareRepository } from '../../db/share-repository.js';
import { getDb, isMySQL } from '../../db/database.js';
import { USER_ALLOWED_SKILLS, ANONYMOUS_ALLOWED_SKILLS, skillPermission } from '../constants.js';

export interface SkillAccessResult {
  skills: SkillDefinition[];
  sourceMap: Map<string, 'own' | 'role' | 'shared'>;
  permissions: string[];
  isAdmin: boolean;
}

export class SkillPermissionService {
  private registry: SkillRegistry;
  private shareRepo: ShareRepository;
  private cachedResults: Map<string, SkillAccessResult> = new Map();

  constructor(registry: SkillRegistry) {
    this.registry = registry;
    this.shareRepo = new ShareRepository(isMySQL() ? undefined : getDb());
  }

  invalidate(userId: string): void {
    this.cachedResults.delete(userId);
  }

  invalidateAll(): void {
    this.cachedResults.clear();
  }

  async canAccess(userId: string, skillName: string): Promise<boolean> {
    const permissions = await getUserPermissions(userId);
    const isAdmin = this.isAdmin(permissions);

    if (isAdmin) return true;

    if (permissions.includes(skillPermission(skillName))) return true;

    const sharedNames = await this.getSharedSkillNames(userId);
    if (sharedNames.includes(skillName)) return true;

    const skill = this.registry.lookup(skillName);
    if (skill?.owner === userId) return true;

    return false;
  }

  async getAccessibleSkills(
    userId: string,
    options?: {
      visibleOnly?: boolean;
      allowedSkills?: string[];
    },
    useCache = true
  ): Promise<SkillAccessResult> {
    const cacheKey = `${userId}:${options?.visibleOnly ?? true}:${options?.allowedSkills?.join(',') ?? 'all'}`;

    if (useCache && this.cachedResults.has(cacheKey)) {
      return this.cachedResults.get(cacheKey)!;
    }

    const sourceMap = new Map<string, 'own' | 'role' | 'shared'>();
    const permissions = await getUserPermissions(userId);
    const isAdmin = this.isAdmin(permissions);

    if (isAdmin) {
      const skills = this.getAllSkills(options?.visibleOnly);
      skills.forEach((s) => sourceMap.set(s.name, 'role'));
      const result = { skills, sourceMap, permissions, isAdmin };
      this.cachedResults.set(cacheKey, result);
      return result;
    }

    const accessibleNames = new Set<string>();

    const roleSkillNames = permissions
      .filter((p) => p.startsWith('skill:') && p.endsWith('.execute'))
      .map((p) => p.slice(6, -8));

    roleSkillNames.forEach((name) => {
      accessibleNames.add(name);
      sourceMap.set(name, 'role');
    });

    const sharedSkillNames = await this.getSharedSkillNames(userId);
    sharedSkillNames.forEach((name) => {
      if (!accessibleNames.has(name)) {
        accessibleNames.add(name);
        sourceMap.set(name, 'shared');
      }
    });

    const ownSkillNames = this.getOwnSkillNames(userId);
    ownSkillNames.forEach((name) => {
      if (!accessibleNames.has(name)) {
        accessibleNames.add(name);
        sourceMap.set(name, 'own');
      }
    });

    let skills = this.registry
      .list()
      .filter((s) => accessibleNames.has(s.name));

    if (options?.visibleOnly) {
      skills = skills.filter((s) => s.visible);
    }

    if (options?.allowedSkills && options.allowedSkills.length > 0) {
      skills = skills.filter((s) => options.allowedSkills!.includes(s.name));
    }

    const result = { skills, sourceMap, permissions, isAdmin };
    this.cachedResults.set(cacheKey, result);
    return result;
  }

  private isAdmin(permissions: string[]): boolean {
    return permissions.some((p) => p === 'users.manage' || p === 'roles.manage');
  }

  private getAllSkills(visibleOnly?: boolean): SkillDefinition[] {
    const skills = this.registry.list();
    if (visibleOnly) {
      return skills.filter((s) => s.visible);
    }
    return skills;
  }

  private async getSharedSkillNames(userId: string): Promise<string[]> {
    try {
      const roles = await getUserRoles(userId);
      const roleIds = roles.map((r) => r.id);

      const user = await getUserById(userId);
      let deptPath = '/';
      if (user?.departmentId) {
        const dept = await getDepartmentById(user.departmentId);
        if (dept) deptPath = dept.path;
      }

      return this.shareRepo.getSharedResourceIds('skill', userId, roleIds, deptPath);
    } catch {
      return [];
    }
  }

  private getOwnSkillNames(userId: string): string[] {
    return this.registry
      .list()
      .filter((s) => s.owner === userId)
      .map((s) => s.name);
  }
}
```

- [ ] **Step 2: Create DataIsolationService**

```typescript
// src/permissions/services/data-isolation-service.ts
import { getCurrentUserId } from '../../user/request-context.js';

export class DataIsolationService {
  ensureOwner(userId: string, expectedOwner: string): void {
    if (userId !== expectedOwner && expectedOwner !== 'default') {
      throw new Error('Data isolation violation: user does not own this resource');
    }
  }

  getCurrentUserId(): string {
    return getCurrentUserId();
  }

  isValidUserId(userId: string): boolean {
    return userId && userId.length > 0;
  }

  sanitizeOwner(owner?: string): string {
    return owner || this.getCurrentUserId();
  }

  async filterByOwner<T extends { owner?: string }>(
    items: T[],
    owner: string
  ): Promise<T[]> {
    return items.filter((item) => item.owner === owner || item.owner === undefined);
  }
}
```

- [ ] **Step 3: Create ShareService**

```typescript
// src/permissions/services/share-service.ts
import type { ShareRule, ShareScope, SharePermission } from '../types/index.js';
import { ShareRepository } from '../../db/share-repository.js';
import { getUserRoles, getUserById } from '../../db/user-repository.js';
import { getDepartmentById } from '../../db/department-repository.js';

export class ShareService {
  private shareRepo: ShareRepository;

  constructor(shareRepo?: ShareRepository) {
    this.shareRepo = shareRepo ?? ShareRepository.getInstance();
  }

  async canAccessResource(
    userId: string,
    resourceType: 'skill' | 'kb_document' | 'file',
    resourceId: string,
    ownerId: string,
    requiredPermission: SharePermission = 'read'
  ): Promise<boolean> {
    if (userId === ownerId) {
      return true;
    }

    const shareRules = await this.getShareRulesForResource(resourceType, resourceId);

    for (const rule of shareRules) {
      if (rule.ownerId !== ownerId) continue;

      if (await this.matchesShareRule(rule, userId)) {
        return this.permissionSatisfies(rule.permission, requiredPermission);
      }
    }

    return false;
  }

  async getShareRulesForResource(
    resourceType: 'skill' | 'kb_document' | 'file',
    resourceId: string
  ): Promise<ShareRule[]> {
    return this.shareRepo.getByResource(resourceType, resourceId);
  }

  async getSharedResourcesForUser(
    userId: string,
    resourceType?: 'skill' | 'kb_document' | 'file'
  ): Promise<ShareRule[]> {
    const roles = await getUserRoles(userId);
    const roleIds = roles.map((r) => r.id);

    const user = await getUserById(userId);
    let deptPath = '/';
    if (user?.departmentId) {
      const dept = await getDepartmentById(user.departmentId);
      if (dept) deptPath = dept.path;
    }

    const allRules = await this.shareRepo.getSharedToUser(userId, roleIds, deptPath);

    if (resourceType) {
      return allRules.filter((r) => r.resourceType === resourceType);
    }

    return allRules;
  }

  async createShareRule(
    rule: Omit<ShareRule, 'id' | 'createdAt'>
  ): Promise<ShareRule> {
    return this.shareRepo.create(rule);
  }

  async deleteShareRule(id: string): Promise<boolean> {
    return this.shareRepo.delete(id);
  }

  private async matchesShareRule(rule: ShareRule, userId: string): Promise<boolean> {
    switch (rule.scope) {
      case 'all':
        return true;
      case 'user':
        return rule.targetId === userId;
      case 'role':
        const roles = await getUserRoles(userId);
        return roles.some((r) => r.id === rule.targetId);
      case 'department':
        const user = await getUserById(userId);
        if (!user?.departmentId) return false;
        const dept = await getDepartmentById(user.departmentId);
        return dept?.path.includes(rule.targetId ?? '') ?? false;
      case 'none':
        return false;
      default:
        return false;
    }
  }

  private permissionSatisfies(
    hasPermission: SharePermission,
    requiresPermission: SharePermission
  ): boolean {
    const permissionLevel: Record<SharePermission, number> = {
      'read': 1,
      'execute': 2,
      'write': 3,
    };
    return permissionLevel[hasPermission] >= permissionLevel[requiresPermission];
  }
}
```

---

### Task 1.2: Main Permission Service

**Files:**
- Create: `src/permissions/services/permission-service.ts`

- [ ] **Step 1: Create PermissionService**

```typescript
// src/permissions/services/permission-service.ts
import type { SkillRegistry } from '../../registry/index.js';
import type { SkillDefinition } from '../../types/index.js';
import {
  userHasPermission,
  getUserPermissions,
  getUserRoles,
} from '../../db/user-repository.js';
import {
  API_PERMISSIONS,
  MENU_PERMISSIONS,
  skillPermission,
  isAdminPermission,
} from '../constants.js';
import {
  PermissionError,
  AuthenticationRequiredError,
  AccessDeniedError,
  SkillAccessDeniedError,
} from '../errors/permission-errors.js';
import { SkillPermissionService } from './skill-permission-service.js';
import { DataIsolationService } from './data-isolation-service.js';
import { ShareService } from './share-service.js';

export class PermissionService {
  readonly skills: SkillPermissionService;
  readonly dataIsolation: DataIsolationService;
  readonly share: ShareService;

  constructor(registry: SkillRegistry) {
    this.skills = new SkillPermissionService(registry);
    this.dataIsolation = new DataIsolationService();
    this.share = new ShareService();
  }

  async hasPermission(
    userId: string,
    permissionName: string
  ): Promise<boolean> {
    return userHasPermission(userId, permissionName);
  }

  async checkPermission(
    userId: string,
    permissionName: string
  ): Promise<void> {
    if (!userId) {
      throw new AuthenticationRequiredError();
    }

    const hasPerm = await this.hasPermission(userId, permissionName);
    if (!hasPerm) {
      throw new AccessDeniedError(permissionName, userId);
    }
  }

  async getUserPermissions(userId: string): Promise<string[]> {
    return getUserPermissions(userId);
  }

  async isAdmin(userId: string): Promise<boolean> {
    const permissions = await this.getUserPermissions(userId);
    return permissions.some((p) => p === 'users.manage' || p === 'roles.manage');
  }

  async getUserRoles(userId: string): Promise<Array<{ id: string; name: string; description: string }>> {
    return getUserRoles(userId);
  }

  async hasSkillPermission(
    userId: string,
    skillName: string
  ): Promise<boolean> {
    return this.skills.canAccess(userId, skillName);
  }

  async checkSkillPermission(
    userId: string,
    skillName: string
  ): Promise<void> {
    if (!userId) {
      throw new AuthenticationRequiredError();
    }

    const hasAccess = await this.hasSkillPermission(userId, skillName);
    if (!hasAccess) {
      throw new SkillAccessDeniedError(skillName, userId);
    }
  }

  async getAccessibleSkills(
    userId: string,
    options?: {
      visibleOnly?: boolean;
      allowedSkills?: string[];
    }
  ): Promise<SkillDefinition[]> {
    const result = await this.skills.getAccessibleSkills(userId, options);
    return result.skills;
  }

  invalidateSkillCache(userId?: string): void {
    if (userId) {
      this.skills.invalidate(userId);
    } else {
      this.skills.invalidateAll();
    }
  }
}
```

---

## Phase 2: Middleware

### Task 2.1: Permission Middleware

**Files:**
- Create: `src/permissions/middleware/auth-middleware.ts`
- Create: `src/permissions/middleware/permission-middleware.ts`
- Create: `src/permissions/middleware/data-isolation-middleware.ts`

- [ ] **Step 1: Create auth middleware**

```typescript
// src/permissions/middleware/auth-middleware.ts
import type { Request, Response, NextFunction } from 'express';
import { validateSession } from '../../db/auth.js';
import type { User } from '../../db/user-repository.js';

declare global {
  namespace Express {
    interface Request {
      user?: User;
    }
  }
}

export async function authMiddleware(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  let token: string | undefined;

  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    token = authHeader.slice(7);
  }

  if (!token && req.cookies?.token) {
    token = req.cookies.token;
  }

  if (!token && typeof req.query.token === 'string') {
    token = req.query.token;
  }

  if (token) {
    const user = await validateSession(token);
    if (user) {
      req.user = user;
    }
  }
  next();
}

export function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  if (!req.user) {
    res.status(401).json({
      success: false,
      error: 'Authentication required',
    });
    return;
  }
  next();
}
```

- [ ] **Step 2: Create permission middleware**

```typescript
// src/permissions/middleware/permission-middleware.ts
import type { Request, Response, NextFunction } from 'express';
import type { PermissionService } from '../services/permission-service.js';
import { requireAuth } from './auth-middleware.js';

export function createPermissionMiddleware(
  permissionService: PermissionService
) {
  return {
    requireAuth,

    requirePermission(permissionName: string) {
      return async (
        req: Request,
        res: Response,
        next: NextFunction
      ): Promise<void> => {
        if (!req.user) {
          res.status(401).json({
            success: false,
            error: 'Authentication required',
          });
          return;
        }

        const hasPerm = await permissionService.hasPermission(
          req.user.id,
          permissionName
        );
        if (!hasPerm) {
          res.status(403).json({
            success: false,
            error: `Permission denied: ${permissionName}`,
          });
          return;
        }
        next();
      };
    },

    requireRole(roleName: string) {
      return async (
        req: Request,
        res: Response,
        next: NextFunction
      ): Promise<void> => {
        if (!req.user) {
          res.status(401).json({
            success: false,
            error: 'Authentication required',
          });
          return;
        }

        const roles = await permissionService.getUserRoles(req.user.id);
        if (!roles.some((r) => r.name === roleName)) {
          res.status(403).json({
            success: false,
            error: `Role required: ${roleName}`,
          });
          return;
        }
        next();
      };
    },

    requireAdmin() {
      return async (
        req: Request,
        res: Response,
        next: NextFunction
      ): Promise<void> => {
        if (!req.user) {
          res.status(401).json({
            success: false,
            error: 'Authentication required',
          });
          return;
        }

        const isAdmin = await permissionService.isAdmin(req.user.id);
        if (!isAdmin) {
          res.status(403).json({
            success: false,
            error: 'Admin access required',
          });
          return;
        }
        next();
      };
    },

    requireSkillAccess(skillName: string) {
      return async (
        req: Request,
        res: Response,
        next: NextFunction
      ): Promise<void> => {
        if (!req.user) {
          res.status(401).json({
            success: false,
            error: 'Authentication required',
          });
          return;
        }

        const hasAccess = await permissionService.hasSkillPermission(
          req.user.id,
          skillName
        );
        if (!hasAccess) {
          res.status(403).json({
            success: false,
            error: `No access to skill: ${skillName}`,
          });
          return;
        }
        next();
      };
    },
  };
}
```

- [ ] **Step 3: Create data isolation middleware**

```typescript
// src/permissions/middleware/data-isolation-middleware.ts
import type { Request, Response, NextFunction } from 'express';
import { requestContext } from '../../user/request-context.js';

export function userIdContextMiddleware(
  req: Request,
  _res: Response,
  next: NextFunction
): void {
  const userId = req.user?.id ?? 'default';
  requestContext.run({ userId }, () => next());
}
```

---

## Phase 3: Entry Point & Integration

### Task 3.1: Main Entry Point

**Files:**
- Create: `src/permissions/index.ts`
- Create: `src/permissions/utils/helper.ts`
- Create: `src/permissions/utils/validator.ts`
- Create: `src/permissions/utils/permission-checker.ts`

- [ ] **Step 1: Create utility files**

```typescript
// src/permissions/utils/helper.ts
import { USER_ALLOWED_SKILLS, ANONYMOUS_ALLOWED_SKILLS, ADMIN_SKILL_PERMISSIONS } from '../constants.js';

export function isSkillAllowedForUser(skillName: string): boolean {
  return USER_ALLOWED_SKILLS.includes(skillName as any);
}

export function isSkillAllowedForAnonymous(skillName: string): boolean {
  return ANONYMOUS_ALLOWED_SKILLS.includes(skillName as any);
}

export function getSkillPermissionsForRole(
  role: 'user' | 'anonymous' | 'admin'
): string[] {
  switch (role) {
    case 'user':
      return USER_ALLOWED_SKILLS.map((s) => `skill:${s}.execute`);
    case 'anonymous':
      return ANONYMOUS_ALLOWED_SKILLS.map((s) => `skill:${s}.execute`);
    case 'admin':
      return [...ADMIN_SKILL_PERMISSIONS];
    default:
      return [];
  }
}
```

```typescript
// src/permissions/utils/validator.ts
import type { PermissionName, ActionType, ResourceType } from '../types/index.js';

export function isValidPermissionName(name: string): boolean {
  return name && name.length > 0;
}

export function isValidActionType(action: string): action is ActionType {
  return ['read', 'write', 'execute', 'manage', '*'].includes(action);
}

export function isValidResourceType(type: string): type is ResourceType {
  return ['api', 'skill', 'menu', 'data', 'knowledge', 'memory'].includes(type);
}

export function validatePermissionName(name: string): void {
  if (!isValidPermissionName(name)) {
    throw new Error(`Invalid permission name: ${name}`);
  }
}
```

```typescript
// src/permissions/utils/permission-checker.ts
export class PermissionChecker {
  private permissions: Set<string>;

  constructor(permissions: string[]) {
    this.permissions = new Set(permissions);
  }

  has(permissionName: string): boolean {
    if (this.permissions.has('*')) return true;

    if (this.permissions.has(permissionName)) return true;

    const parts = permissionName.split('.');
    if (parts.length === 2) {
      if (this.permissions.has(`${parts[0]}.*`)) return true;
    }

    if (permissionName.startsWith('skill:')) {
      if (this.permissions.has('skill:*')) return true;
      if (this.permissions.has('skill:*.execute')) return true;
    }

    return false;
  }

  hasAny(permissionNames: string[]): boolean {
    return permissionNames.some((p) => this.has(p));
  }

  hasAll(permissionNames: string[]): boolean {
    return permissionNames.every((p) => this.has(p));
  }
}
```

- [ ] **Step 2: Create main index.ts**

```typescript
// src/permissions/index.ts
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
  ): Promise<SkillDefinition[]> => {
    return getPermissionService().getAccessibleSkills(userId, options);
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
```

---

## Phase 4: Integration & Migration

### Task 4.1: Server Integration

**Files:**
- Modify: `src/server.ts`
- Modify: `src/routes/index.ts`
- Modify: `src/routes/skill-routes.ts`
- Modify: `src/llm/agent-loop.ts`

- [ ] **Step 1: Update server.ts to initialize permission service**

Find the SkillRegistry initialization and add:
```typescript
// Before:
const registry = new SkillRegistry();

// After:
const registry = new SkillRegistry();
import { initPermissionService } from './permissions/index.js';
initPermissionService(registry);
```

- [ ] **Step 2: Update routes to use new permissions**

For each route file, replace imports from `../db/auth-middleware.js` with:
```typescript
import { permissions } from '../permissions/index.js';
```

And replace middleware usage:
```typescript
// Before:
router.get('/skills', requireAuth, requirePermission('skills.read'), ...);

// After:
const pm = permissions.createMiddleware(permissions.service);
router.get('/skills', pm.requireAuth, pm.requirePermission(permissions.constants.API.SKILLS_READ), ...);
```

---

## Phase 5: Cleanup & Finalization

### Task 5.1: Deprecate Old Modules

**Files:**
- Modify: `src/config/skill-permissions.ts` (add deprecation warning)
- Modify: `src/engine/skill-access-service.ts` (add deprecation warning)
- Modify: `src/db/auth-middleware.ts` (add deprecation warning)

- [ ] **Step 1: Add deprecation warnings to old modules**

Add to each old module:
```typescript
/**
 * @deprecated Use the unified permission service from src/permissions/ instead
 * This module will be removed in a future version.
 */
```

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Breaking existing code | High | Critical | Keep API compatibility, gradual migration |
| Performance impact from reinitialization | Medium | Medium | Cache permission checks, keep existing code paths |
| Type errors in refactoring | High | High | Full TypeScript type safety, incremental changes |
| Missing edge cases | Medium | High | Comprehensive testing, keep existing tests |
| Merge conflicts | High | Medium | Frequent commits, small PRs |

---

## Test Plan

### Unit Tests
- [ ] Test PermissionService initialization
- [ ] Test skill permission checking (role, shared, own)
- [ ] Test resource permission checking
- [ ] Test middleware functions
- [ ] Test cache invalidation

### Integration Tests
- [ ] Test route protection with new middleware
- [ ] Test AgentLoop integration
- [ ] Test data isolation
- [ ] Test share rules

### Migration Tests
- [ ] Test backward compatibility
- [ ] Test old code paths still work
- [ ] Test side-by-side usage
