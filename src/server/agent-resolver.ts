import type { RoleAgentConfig } from "../permissions/types/role.js";
import * as userRepo from "../db/user-repository.js";

/**
 * Resolve the role-based agent configuration for a request.
 * Priority: explicit role in body/query → first non-system role of user.
 */
export async function resolveRoleAgentConfig(req: {
  body?: { role?: string };
  query?: { role?: string };
  user?: { id?: string };
}): Promise<RoleAgentConfig | undefined> {
  const explicitRole = req.body?.role || req.query?.role;
  if (explicitRole) {
    return (await userRepo.getRoleAgentConfig(explicitRole)) ?? undefined;
  }
  if (req.user?.id) {
    const roles = await userRepo.getUserRoles(req.user.id);
    if (roles.length > 0) {
      return (await userRepo.getRoleAgentConfig(roles[0].id)) ?? undefined;
    }
  }
  return undefined;
}
