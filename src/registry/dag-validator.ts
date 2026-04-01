import type { SkillDefinition } from "../types/index.js";
import {
  CyclicDependencyError,
  DependencyNotFoundError,
} from "../utils/errors.js";

/**
 * 使用 Kahn 算法验证 Skill 依赖图是否为 DAG（无环有向图）
 * 返回拓扑排序结果
 */
export function validateDAG(
  skills: Map<string, SkillDefinition>,
): string[] {
  // 检查所有依赖是否存在
  for (const [name, skill] of skills) {
    for (const dep of skill.dependencies) {
      if (!skills.has(dep)) {
        throw new DependencyNotFoundError(name, dep);
      }
      if (dep === name) {
        throw new CyclicDependencyError([name, name]);
      }
    }
  }

  // Kahn's algorithm
  const inDegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();

  for (const name of skills.keys()) {
    inDegree.set(name, 0);
    adjacency.set(name, []);
  }

  for (const [name, skill] of skills) {
    for (const dep of skill.dependencies) {
      // dep → name (name depends on dep)
      adjacency.get(dep)!.push(name);
      inDegree.set(name, (inDegree.get(name) ?? 0) + 1);
    }
  }

  const queue: string[] = [];
  for (const [name, degree] of inDegree) {
    if (degree === 0) queue.push(name);
  }

  const sorted: string[] = [];

  while (queue.length > 0) {
    const node = queue.shift()!;
    sorted.push(node);

    for (const neighbor of adjacency.get(node) ?? []) {
      const newDegree = (inDegree.get(neighbor) ?? 1) - 1;
      inDegree.set(neighbor, newDegree);
      if (newDegree === 0) queue.push(neighbor);
    }
  }

  if (sorted.length !== skills.size) {
    // 找出环中的节点
    const inCycle = [...skills.keys()].filter(
      (name) => !sorted.includes(name),
    );
    throw new CyclicDependencyError(inCycle);
  }

  return sorted;
}
