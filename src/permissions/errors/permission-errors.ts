export class PermissionError extends Error {
  readonly name: string = 'PermissionError';

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
  readonly name: string = 'AuthenticationRequiredError';

  constructor(message: string = 'Authentication required') {
    super(message);
    Object.setPrototypeOf(this, AuthenticationRequiredError.prototype);
  }
}

export class AccessDeniedError extends PermissionError {
  readonly name: string = 'AccessDeniedError';

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
  readonly name: string = 'SkillAccessDeniedError';

  constructor(
    skillName: string,
    userId?: string,
  ) {
    super(`Permission denied for skill: ${skillName}`, `skill:${skillName}.execute`, userId);
    Object.setPrototypeOf(this, SkillAccessDeniedError.prototype);
  }
}
