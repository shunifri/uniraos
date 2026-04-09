import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "fs";
import { dirname } from "path";
import crypto from "crypto";
import type { GraphNode, GraphEdge, GraphData, NodeType, EdgeType } from "./types.js";

export class GraphStore {
  private data: GraphData;
  private storePath: string;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private dirty = false;

  constructor(storePath: string) {
    this.storePath = storePath;
    this.data = { version: 1, nodes: {}, edges: {}, adjacency: {} };
    this.load();
  }

  // Node operations
  addNode(node: Omit<GraphNode, "id"> & { id?: string }): GraphNode {
    const id = node.id ?? crypto.randomUUID().slice(0, 12);
    const full: GraphNode = { ...node, id, createdAt: node.createdAt ?? Date.now() };
    this.data.nodes[id] = full;
    if (!this.data.adjacency[id]) this.data.adjacency[id] = [];
    this.scheduleSave();
    return full;
  }

  removeNode(id: string): boolean {
    if (!this.data.nodes[id]) return false;
    // Remove all edges connected to this node
    const edgeIds = [...(this.data.adjacency[id] ?? [])];
    for (const eid of edgeIds) this.removeEdge(eid);
    delete this.data.nodes[id];
    delete this.data.adjacency[id];
    this.scheduleSave();
    return true;
  }

  getNode(id: string): GraphNode | undefined {
    return this.data.nodes[id];
  }

  findNodeByLabel(label: string): GraphNode | undefined {
    return Object.values(this.data.nodes).find((n) => n.label === label);
  }

  findNodesByType(type: NodeType): GraphNode[] {
    return Object.values(this.data.nodes).filter((n) => n.type === type);
  }

  getAllNodes(): GraphNode[] {
    return Object.values(this.data.nodes);
  }

  // Edge operations
  addEdge(
    source: string,
    target: string,
    type: EdgeType,
    label: string,
    weight = 1.0
  ): GraphEdge {
    if (!this.data.nodes[source] || !this.data.nodes[target]) {
      throw new Error(
        `Cannot add edge: node(s) not found (${source} -> ${target})`
      );
    }
    const id = crypto.randomUUID().slice(0, 12);
    const edge: GraphEdge = {
      id,
      source,
      target,
      type,
      label,
      weight,
      createdAt: Date.now(),
    };
    this.data.edges[id] = edge;
    this.data.adjacency[source] = this.data.adjacency[source] ?? [];
    this.data.adjacency[target] = this.data.adjacency[target] ?? [];
    this.data.adjacency[source].push(id);
    this.data.adjacency[target].push(id);
    this.scheduleSave();
    return edge;
  }

  removeEdge(id: string): boolean {
    const edge = this.data.edges[id];
    if (!edge) return false;
    // Remove from adjacency lists
    for (const nodeId of [edge.source, edge.target]) {
      const adj = this.data.adjacency[nodeId];
      if (adj) {
        const idx = adj.indexOf(id);
        if (idx !== -1) adj.splice(idx, 1);
      }
    }
    delete this.data.edges[id];
    this.scheduleSave();
    return true;
  }

  getEdge(id: string): GraphEdge | undefined {
    return this.data.edges[id];
  }

  getEdgesOf(nodeId: string): GraphEdge[] {
    return (this.data.adjacency[nodeId] ?? [])
      .map((eid) => this.data.edges[eid])
      .filter(Boolean) as GraphEdge[];
  }

  getEdgesBetween(a: string, b: string): GraphEdge[] {
    return this.getEdgesOf(a).filter((e) => e.source === b || e.target === b);
  }

  getAllEdges(): GraphEdge[] {
    return Object.values(this.data.edges);
  }

  // Graph queries
  getNeighbors(nodeId: string): GraphNode[] {
    const edges = this.getEdgesOf(nodeId);
    const neighborIds = new Set<string>();
    for (const e of edges) {
      if (e.source !== nodeId) neighborIds.add(e.source);
      if (e.target !== nodeId) neighborIds.add(e.target);
    }
    return [...neighborIds]
      .map((id) => this.data.nodes[id])
      .filter(Boolean) as GraphNode[];
  }

  getDegree(nodeId: string): number {
    return (this.data.adjacency[nodeId] ?? []).length;
  }

  get nodeCount(): number {
    return Object.keys(this.data.nodes).length;
  }

  get edgeCount(): number {
    return Object.keys(this.data.edges).length;
  }

  // Persistence
  load(): void {
    if (existsSync(this.storePath)) {
      try {
        const raw = readFileSync(this.storePath, "utf-8");
        this.data = JSON.parse(raw);
      } catch (err) {
        console.warn(`[GraphStore] Failed to load ${this.storePath}: ${err instanceof Error ? err.message : String(err)}. Starting with empty graph.`);
        this.data = { version: 1, nodes: {}, edges: {}, adjacency: {} };
      }
    }
  }

  save(): void {
    if (this.saveTimer) { clearTimeout(this.saveTimer); this.saveTimer = null; }
    const dir = dirname(this.storePath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const tmp = this.storePath + ".tmp";
    writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    renameSync(tmp, this.storePath);
    this.dirty = false;
  }

  dispose(): void {
    if (this.saveTimer) { clearTimeout(this.saveTimer); this.saveTimer = null; }
    if (this.dirty) this.save();
  }

  private scheduleSave(): void {
    this.dirty = true;
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.save();
    }, 500);
  }

  toJSON(): GraphData {
    return this.data;
  }
}
