/**
 * Core graph data model — decoupled from any chart library.
 * Serialisable to JSON; rendering layer is pluggable.
 *
 * Constitution V: every node/edge must conform to this schema.
 */

export type EdgeType = 'import' | 'reference' | 'export';

export interface GraphNode {
  /** Unique identifier (workspace-relative path). */
  id: string;
  /** Absolute filesystem path. */
  path: string;
  /** File extension / detected language. */
  language: string;
  /** Current line count. */
  linesOfCode: number;
  /** ISO timestamp of last modification. */
  lastModified: string;
  /** Depth in the directory tree (0 = workspace root). */
  depth: number;
  /** Display name (basename). */
  label: string;
}

export interface GraphEdge {
  /** Source node id (importer). */
  source: string;
  /** Target node id (imported). */
  target: string;
  /** Relationship type. */
  type: EdgeType;
  /** 1-based line number of the import statement in the source file. */
  sourceLine?: number;
  /** Raw import specifier as written in the source file. */
  specifier?: string;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
  /** ISO timestamp when this snapshot was produced. */
  generatedAt: string;
}

export function emptyGraph(): GraphData {
  return { nodes: [], edges: [], generatedAt: new Date().toISOString() };
}
