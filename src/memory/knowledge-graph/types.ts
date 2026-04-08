export type NodeType = "ltm" | "kb_document" | "entity" | "concept";
export type EdgeType = "EXTRACTED" | "INFERRED" | "TEMPORAL";

export interface GraphNode {
  id: string;
  label: string;
  type: NodeType;
  tags: string[];
  properties: Record<string, unknown>;
  createdAt: number;
  communityId?: number;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  type: EdgeType;
  label: string;
  weight: number;
  createdAt: number;
}

export interface GraphData {
  version: 1;
  nodes: Record<string, GraphNode>;
  edges: Record<string, GraphEdge>;
  adjacency: Record<string, string[]>;
}

export interface SubgraphResult {
  nodes: GraphNode[];
  edges: GraphEdge[];
  seedNodes: string[];
}
