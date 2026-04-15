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
