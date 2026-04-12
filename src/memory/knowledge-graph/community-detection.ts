import type { GraphStore } from "./graph-store.js";

/**
 * Louvain community detection — pure TypeScript implementation.
 * Assigns communityId to each node in the graph.
 */
export async function detectCommunities(store: GraphStore, options?: {
  maxCommunitySize?: number;  // default 50
  resolution?: number;        // default 1.0
}): Promise<Map<number, string[]>> {
  const _maxSize = options?.maxCommunitySize ?? 50;
  const nodes = await store.getAllNodes();
  if (nodes.length === 0) return new Map();

  // Total edge weight (m)
  const allEdges = await store.getAllEdges();
  const m = allEdges.reduce((sum, e) => sum + e.weight, 0) || 1;

  // Initialize: each node in its own community
  const nodeCommunity = new Map<string, number>();
  let nextId = 0;
  for (const node of nodes) {
    nodeCommunity.set(node.id, nextId++);
  }

  // Precompute per-node degree (ki)
  const nodeDegree = new Map<string, number>();
  for (const node of nodes) {
    const edges = await store.getEdgesOf(node.id);
    nodeDegree.set(node.id, edges.reduce((sum, e) => sum + e.weight, 0));
  }

  // Precompute sigmaTotal per community (sum of all edge weights incident to nodes in community)
  const sigmaTot = new Map<number, number>();
  for (const node of nodes) {
    const comm = nodeCommunity.get(node.id)!;
    sigmaTot.set(comm, (sigmaTot.get(comm) ?? 0) + nodeDegree.get(node.id)!);
  }

  // Iterative optimization
  let improved = true;
  let iterations = 0;
  const maxIterations = 50;

  while (improved && iterations < maxIterations) {
    improved = false;
    iterations++;

    for (const node of nodes) {
      const nodeId = node.id;
      const currentComm = nodeCommunity.get(nodeId)!;
      const ki = nodeDegree.get(nodeId)!;
      const neighbors = await store.getNeighbors(nodeId);

      if (neighbors.length === 0) continue;

      // Compute ki_in for current community and each neighbor community
      const kiInPerComm = new Map<number, number>();
      const nodeEdges = await store.getEdgesOf(nodeId);
      for (const edge of nodeEdges) {
        const neighborId = edge.source === nodeId ? edge.target : edge.source;
        const neighborComm = nodeCommunity.get(neighborId)!;
        kiInPerComm.set(neighborComm, (kiInPerComm.get(neighborComm) ?? 0) + edge.weight);
      }

      const kiInCurrent = kiInPerComm.get(currentComm) ?? 0;
      const sigmaCurrentWithout = (sigmaTot.get(currentComm) ?? 0) - ki;

      // ΔQ of removing node from current community
      const removeGain = kiInCurrent / m - (sigmaCurrentWithout * ki) / (2 * m * m);

      let bestComm = currentComm;
      let bestGain = 0;

      const neighborComms = new Set(neighbors.map(n => nodeCommunity.get(n.id)!));
      neighborComms.delete(currentComm);

      for (const targetComm of neighborComms) {
        const kiInTarget = kiInPerComm.get(targetComm) ?? 0;
        const sigmaTarget = sigmaTot.get(targetComm) ?? 0;

        // ΔQ of adding node to target community
        const addGain = kiInTarget / m - (sigmaTarget * ki) / (2 * m * m);

        // Net gain = addGain - removeGain (gain from moving vs staying in current)
        const netGain = addGain - removeGain;

        if (netGain > bestGain) {
          bestGain = netGain;
          bestComm = targetComm;
        }
      }

      if (bestComm !== currentComm) {
        // Update sigmaTot
        sigmaTot.set(currentComm, (sigmaTot.get(currentComm) ?? 0) - ki);
        sigmaTot.set(bestComm, (sigmaTot.get(bestComm) ?? 0) + ki);

        nodeCommunity.set(nodeId, bestComm);
        improved = true;
      }
    }
  }

  // Build result map: communityId -> nodeIds
  const communities = new Map<number, string[]>();
  for (const [nodeId, commId] of nodeCommunity) {
    if (!communities.has(commId)) communities.set(commId, []);
    communities.get(commId)!.push(nodeId);
  }

  // Re-index communities by size (largest first) with sequential IDs
  const sorted = [...communities.entries()].sort((a, b) => b[1].length - a[1].length);
  const result = new Map<number, string[]>();
  for (let i = 0; i < sorted.length; i++) {
    result.set(i, sorted[i][1]);
    // Update node communityId
    for (const nodeId of sorted[i][1]) {
      const storeNode = await store.getNode(nodeId);
      if (storeNode) storeNode.communityId = i;
    }
  }

  return result;
}
