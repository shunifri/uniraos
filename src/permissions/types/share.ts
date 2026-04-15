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
