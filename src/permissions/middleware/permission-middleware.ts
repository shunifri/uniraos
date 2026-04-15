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
