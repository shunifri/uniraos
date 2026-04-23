export interface RoleAgentConfig {
  /** 系统提示词（完全替代全局 systemPrompt） */
  systemPrompt?: string;
  /** 最大迭代次数（替代全局 maxIterations） */
  maxIterations?: number;
  /** 人格描述（替代默认 personality） */
  personality?: string;
  /** 允许使用的技能名称列表（空=全部） */
  allowedSkills?: string[];
  /** 拒绝回答的话题关键词列表 */
  restrictedTopics?: string[];
  /** 欢迎语（首次打开对话时显示） */
  welcomeMessage?: string;
}

export interface Role {
  id: string;
  name: string;
  description: string;
  isSystem: boolean;
  createdAt: number;
  agentConfig?: RoleAgentConfig;
}

export interface UserRoleAssignment {
  userId: string;
  roleId: string;
  grantedAt: number;
}
