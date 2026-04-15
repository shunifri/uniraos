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
