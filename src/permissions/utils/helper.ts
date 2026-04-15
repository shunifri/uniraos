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
