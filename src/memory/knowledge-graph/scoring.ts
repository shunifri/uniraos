import type { GraphNode } from "./types.js";
import type { GraphStore } from "./graph-store.js";

/** Identify top-N nodes by degree (highest connectivity) */
export async function identifyGodNodes(store: GraphStore, topN = 10): Promise<GraphNode[]> {
  const nodes = await store.getAllNodes();
  const nodesWithDegree = await Promise.all(
    nodes.map(async (n) => ({ node: n, degree: await store.getDegree(n.id) }))
  );
  return nodesWithDegree
    .sort((a, b) => b.degree - a.degree)
    .slice(0, topN)
    .map(x => x.node);
}

/** Score how "surprising" a node's connections are */
export async function scoreSurprise(node: GraphNode, store: GraphStore): Promise<{
  score: number; reasons: string[];
}> {
  let score = 0;
  const reasons: string[] = [];
  const neighbors = await store.getNeighbors(node.id);

  // 1. Cross-type connections
  const neighborTypes = new Set(neighbors.map(n => n.type));
  if (neighborTypes.size > 1) {
    score += neighborTypes.size * 0.5;
    reasons.push(`connects ${neighborTypes.size} different types`);
  }

  // 2. Community bridge
  const neighborComms = new Set(neighbors.filter(n => n.communityId !== undefined).map(n => n.communityId));
  if (neighborComms.size > 1) {
    score += (neighborComms.size - 1) * 1.5;
    reasons.push(`bridges ${neighborComms.size} communities`);
  }

  // 3. Peripheral-to-hub (low degree node connected to high degree node)
  const myDegree = await store.getDegree(node.id);
  if (myDegree <= 3) {
    const hubNeighbors = [];
    for (const n of neighbors) {
      const degree = await store.getDegree(n.id);
      if (degree >= 5) hubNeighbors.push(n);
    }
    if (hubNeighbors.length > 0) {
      score += 2.0;
      reasons.push("peripheral connected to hub");
    }
  }

  // 4. INFERRED edge bonus
  const edges = await store.getEdgesOf(node.id);
  const inferredEdges = edges.filter(e => e.type === "INFERRED");
  if (inferredEdges.length > 0) {
    score += inferredEdges.length * 0.3;
    reasons.push(`${inferredEdges.length} inferred connections`);
  }

  return { score, reasons };
}
