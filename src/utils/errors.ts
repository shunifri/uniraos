export class RAOSError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RAOSError";
  }
}

export class SkillNotFoundError extends RAOSError {
  constructor(name: string) {
    super(`Skill not found: "${name}"`);
    this.name = "SkillNotFoundError";
  }
}

export class DuplicateSkillError extends RAOSError {
  constructor(name: string) {
    super(`Skill already registered: "${name}"`);
    this.name = "DuplicateSkillError";
  }
}

export class CyclicDependencyError extends RAOSError {
  constructor(cycle: string[]) {
    super(`Cyclic dependency detected: ${cycle.join(" → ")}`);
    this.name = "CyclicDependencyError";
  }
}

export class DependencyNotFoundError extends RAOSError {
  constructor(skill: string, dependency: string) {
    super(`Skill "${skill}" depends on "${dependency}" which is not registered`);
    this.name = "DependencyNotFoundError";
  }
}

export class DependencyInUseError extends RAOSError {
  constructor(name: string, dependents: string[]) {
    super(
      `Cannot unregister "${name}": depended on by [${dependents.join(", ")}]`,
    );
    this.name = "DependencyInUseError";
  }
}

export class MaxDepthExceededError extends RAOSError {
  constructor(depth: number, maxDepth: number) {
    super(`Max recursion depth exceeded: ${depth} > ${maxDepth}`);
    this.name = "MaxDepthExceededError";
  }
}

export class CallBudgetExhaustedError extends RAOSError {
  constructor() {
    super("Call budget exhausted");
    this.name = "CallBudgetExhaustedError";
  }
}

export class SkillTimeoutError extends RAOSError {
  constructor(name: string, timeout: number) {
    super(`Skill "${name}" timed out after ${timeout}ms`);
    this.name = "SkillTimeoutError";
  }
}
