import { describe, it, expect } from "vitest";
import { validateDAG } from "../../src/registry/dag-validator.js";
import { defineSkill, Autonomy } from "../../src/types/skill.js";

const noop = async () => ({ success: true });

function makeSkill(name: string, deps: string[] = []) {
  return defineSkill({ name, dependencies: deps, handler: noop });
}

describe("DAG Validator", () => {
  it("should accept empty graph", () => {
    expect(validateDAG(new Map())).toEqual([]);
  });

  it("should accept single skill with no deps", () => {
    const skills = new Map([["a", makeSkill("a")]]);
    expect(validateDAG(skills)).toEqual(["a"]);
  });

  it("should accept valid DAG", () => {
    const skills = new Map([
      ["a", makeSkill("a")],
      ["b", makeSkill("b", ["a"])],
      ["c", makeSkill("c", ["a", "b"])],
    ]);
    const order = validateDAG(skills);
    expect(order.indexOf("a")).toBeLessThan(order.indexOf("b"));
    expect(order.indexOf("b")).toBeLessThan(order.indexOf("c"));
  });

  it("should reject self-dependency", () => {
    const skills = new Map([["a", makeSkill("a", ["a"])]]);
    expect(() => validateDAG(skills)).toThrow("Cyclic dependency");
  });

  it("should reject 2-node cycle", () => {
    const skills = new Map([
      ["a", makeSkill("a", ["b"])],
      ["b", makeSkill("b", ["a"])],
    ]);
    expect(() => validateDAG(skills)).toThrow("Cyclic dependency");
  });

  it("should reject missing dependency", () => {
    const skills = new Map([["a", makeSkill("a", ["nonexistent"])]]);
    expect(() => validateDAG(skills)).toThrow("not registered");
  });

  it("should accept diamond DAG", () => {
    const skills = new Map([
      ["a", makeSkill("a")],
      ["b", makeSkill("b", ["a"])],
      ["c", makeSkill("c", ["a"])],
      ["d", makeSkill("d", ["b", "c"])],
    ]);
    const order = validateDAG(skills);
    expect(order).toHaveLength(4);
    expect(order.indexOf("a")).toBeLessThan(order.indexOf("d"));
  });
});
