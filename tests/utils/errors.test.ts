import { describe, it, expect } from "vitest";
import {
  RAOSError,
  SkillNotFoundError,
  DuplicateSkillError,
  CyclicDependencyError,
  DependencyNotFoundError,
  DependencyInUseError,
  MaxDepthExceededError,
} from "../../src/utils/errors";

describe("RAOSError", () => {
  it("should create a base error with correct name", () => {
    const err = new RAOSError("something went wrong");
    expect(err.name).toBe("RAOSError");
    expect(err.message).toBe("something went wrong");
    expect(err).toBeInstanceOf(Error);
  });
});

describe("SkillNotFoundError", () => {
  it("should format message with skill name", () => {
    const err = new SkillNotFoundError("my-skill");
    expect(err.name).toBe("SkillNotFoundError");
    expect(err.message).toBe('Skill not found: "my-skill"');
    expect(err).toBeInstanceOf(RAOSError);
  });
});

describe("DuplicateSkillError", () => {
  it("should format message with skill name", () => {
    const err = new DuplicateSkillError("my-skill");
    expect(err.name).toBe("DuplicateSkillError");
    expect(err.message).toBe('Skill already registered: "my-skill"');
    expect(err).toBeInstanceOf(RAOSError);
  });
});

describe("CyclicDependencyError", () => {
  it("should format cycle path", () => {
    const err = new CyclicDependencyError(["a", "b", "c", "a"]);
    expect(err.name).toBe("CyclicDependencyError");
    expect(err.message).toBe("Cyclic dependency detected: a → b → c → a");
    expect(err).toBeInstanceOf(RAOSError);
  });
});

describe("DependencyNotFoundError", () => {
  it("should format missing dependency message", () => {
    const err = new DependencyNotFoundError("skill-a", "skill-b");
    expect(err.name).toBe("DependencyNotFoundError");
    expect(err.message).toBe(
      'Skill "skill-a" depends on "skill-b" which is not registered'
    );
    expect(err).toBeInstanceOf(RAOSError);
  });
});

describe("DependencyInUseError", () => {
  it("should format dependents list", () => {
    const err = new DependencyInUseError("skill-a", ["skill-b", "skill-c"]);
    expect(err.name).toBe("DependencyInUseError");
    expect(err.message).toBe(
      'Cannot unregister "skill-a": depended on by [skill-b, skill-c]'
    );
    expect(err).toBeInstanceOf(RAOSError);
  });
});

describe("MaxDepthExceededError", () => {
  it("should format depth exceeded message", () => {
    const err = new MaxDepthExceededError(11, 10);
    expect(err.name).toBe("MaxDepthExceededError");
    expect(err.message).toBe("Max recursion depth exceeded: 11 > 10");
    expect(err).toBeInstanceOf(RAOSError);
  });
});
