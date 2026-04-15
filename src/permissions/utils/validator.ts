import type { PermissionName, ActionType, ResourceType } from '../types/index.js';

export function isValidPermissionName(name: string): boolean {
  return !!name && name.length > 0;
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
