/**
 * Architecture Insight types and computation.
 *
 * Constitution V: Insights are derived from GraphData — no fields added
 * to GraphNode or GraphEdge. The Insight type lives in this separate module.
 */

import { GraphData } from '../model/graphTypes';
import { BoundaryConfig, BoundaryViolation, computeBoundaryViolations } from './boundaryRules';

type GraphNodeWithMeta = GraphData['nodes'][number] & {
  _unresolvedImports?: string[];
};

export type InsightCategory = 'cycle' | 'orphan' | 'hub' | 'bloated' | 'unresolved' | 'fan-out' | 'risky';
export type InsightSeverity = 'info' | 'warn' | 'error';

/** A single architectural finding computed from the current GraphData snapshot. */
export interface Insight {
  category: InsightCategory;
  /** Human-readable summary, e.g. "Cycle: a.ts → b.ts → c.ts → a.ts" */
  title: string;
  /** IDs of the graph nodes involved (one or more). */
  nodes: string[];
  /** Severity level for display: cycles=error, hubs=warn, bloated=warn|error, orphans=info */
  severity: InsightSeverity;
  /** Numeric metric for sorting/ranking (e.g., incoming count for hubs, LOC for bloated). */
  metric: number;
  /** Optional fix suggestion or explanation. */
  description?: string;
}

/** Aggregate result computed from GraphData. Cached until the next snapshot arrives. */
export interface InsightSet {
  cycles: Insight[];
  orphans: Insight[];
  hubs: Insight[];
  bloated: Insight[];
  unresolved: Insight[];
  fanOut: Insight[];
  risky: Insight[];
  violations: BoundaryViolation[];
  /** ISO timestamp when this set was computed. */
  computedAt: string;
}

export interface ComputeOptions {
  topN: number;
  locWarningThreshold: number;
  locDangerThreshold: number;
  entryPointPatterns: string[];
  fileMatcher: (absPath: string, includes: string[], excludes: string[]) => boolean;
  boundaries?: BoundaryConfig;
  warn?: (key: string, message: string) => void;
}

/**
 * Tarjan's Strongly Connected Components algorithm.
 * Runs in O(V+E). Returns SCCs sorted by descending size.
 * SCCs of size 1 without self-loops are filtered out by the caller.
 */
export function tarjanSCC(nodes: string[], edges: [string, string][]): string[][] {
  const nodeSet = new Set(nodes);
  const adjacency = new Map<string, string[]>();
  for (const node of nodes) {
    adjacency.set(node, []);
  }
  for (const [src, tgt] of edges) {
    if (!nodeSet.has(src) || !nodeSet.has(tgt)) { continue; }
    adjacency.get(src)!.push(tgt);
  }

  const idx = new Map<string, number>();
  const lowlink = new Map<string, number>();
  let index = 0;
  const stack: string[] = [];
  const onStack = new Set<string>();
  const sccs: string[][] = [];

  type Frame = {
    node: string;
    nextNeighborIndex: number;
    parent: string | null;
  };

  const enterNode = (node: string, parent: string | null, callStack: Frame[]): void => {
    idx.set(node, index);
    lowlink.set(node, index);
    index++;
    stack.push(node);
    onStack.add(node);
    callStack.push({ node, nextNeighborIndex: 0, parent });
  };

  for (const startNode of nodes) {
    if (idx.has(startNode)) { continue; }

    const callStack: Frame[] = [];
    enterNode(startNode, null, callStack);

    while (callStack.length > 0) {
      const frame = callStack[callStack.length - 1];
      const neighbors = adjacency.get(frame.node) ?? [];

      if (frame.nextNeighborIndex < neighbors.length) {
        const neighbor = neighbors[frame.nextNeighborIndex++];
        if (!idx.has(neighbor)) {
          enterNode(neighbor, frame.node, callStack);
          continue;
        }
        if (onStack.has(neighbor)) {
          lowlink.set(
            frame.node,
            Math.min(lowlink.get(frame.node)!, idx.get(neighbor)!)
          );
        }
        continue;
      }

      callStack.pop();

      if (frame.parent) {
        lowlink.set(
          frame.parent,
          Math.min(lowlink.get(frame.parent)!, lowlink.get(frame.node)!)
        );
      }

      if (lowlink.get(frame.node) === idx.get(frame.node)) {
        const scc: string[] = [];
        let member: string;
        do {
          member = stack.pop()!;
          onStack.delete(member);
          scc.push(member);
        } while (member !== frame.node);
        sccs.push(scc);
      }
    }
  }

  // Sort by descending size
  sccs.sort((a, b) => b.length - a.length);
  return sccs;
}

/**
 * Pure function: computes an InsightSet from GraphData and configuration.
 * No side effects, no I/O.
 */
export function computeInsights(data: GraphData, options: ComputeOptions): InsightSet {
  const { topN, locWarningThreshold, locDangerThreshold, entryPointPatterns, fileMatcher } = options;

  // --- Build edge adjacency for Tarjan + degree counting ---
  const nodeIds = data.nodes.map((n) => n.id);
  const edgePairs: [string, string][] = data.edges
    .filter((e) => e.type === 'import')
    .map((e) => [e.source, e.target]);

  const incomingFromOtherFiles = new Map<string, number>();
  const outgoingToOtherFiles = new Map<string, number>();
  for (const nodeId of nodeIds) {
    incomingFromOtherFiles.set(nodeId, 0);
    outgoingToOtherFiles.set(nodeId, 0);
  }
  for (const [src, tgt] of edgePairs) {
    if (src === tgt) { continue; }
    incomingFromOtherFiles.set(tgt, (incomingFromOtherFiles.get(tgt) ?? 0) + 1);
    outgoingToOtherFiles.set(src, (outgoingToOtherFiles.get(src) ?? 0) + 1);
  }

  // --- Cycles (via Tarjan SCC) ---
  const sccs = tarjanSCC(nodeIds, edgePairs);
  const selfLoopNodes = new Set<string>();
  for (const [src, tgt] of edgePairs) {
    if (src === tgt) { selfLoopNodes.add(src); }
  }

  const cycles: Insight[] = [];
  for (const scc of sccs) {
    // An SCC is a "cycle" if size >= 2, OR size==1 with a self-loop
    if (scc.length >= 2 || (scc.length === 1 && selfLoopNodes.has(scc[0]))) {
      const title = scc.length === 1
        ? `Self-loop: ${scc[0]} → ${scc[0]}`
        : `Cycle: ${scc.join(' → ')} → ${scc[0]}`;
      cycles.push({
        category: 'cycle',
        title,
        nodes: scc,
        severity: 'error',
        metric: scc.length,
        description: scc.length === 1
          ? 'This file imports itself.'
          : `${scc.length} files form a circular dependency. Break the cycle by extracting a shared interface or restructuring imports.`,
      });
    }
  }

  // --- Orphans (in-degree 0, not matching entry-point patterns) ---
  const orphans: Insight[] = [];
  for (const node of data.nodes) {
    if ((incomingFromOtherFiles.get(node.id) ?? 0) !== 0) { continue; }
    // Entry-point patterns exclude a node from being considered an orphan
    if (fileMatcher(node.path, entryPointPatterns, [])) { continue; }
    orphans.push({
      category: 'orphan',
      title: `${node.id}`,
      nodes: [node.id],
      severity: 'info',
      metric: node.linesOfCode,
      description: 'No other file imports this module — may be dead code.',
    });
  }
  orphans.sort((a, b) => b.metric - a.metric);

  // --- Hubs (top-N by in-degree) ---
  const hubs: Insight[] = [];
  for (const node of data.nodes) {
    const deg = incomingFromOtherFiles.get(node.id) ?? 0;
    if (deg > 0) {
      hubs.push({
        category: 'hub',
        title: `${node.id}`,
        nodes: [node.id],
        severity: 'warn',
        metric: deg,
        description: `Imported by ${deg} files — candidate for refactoring into a smaller interface.`,
      });
    }
  }
  hubs.sort((a, b) => b.metric - a.metric);
  hubs.splice(topN);

  // --- Bloated (top-N by LOC above warning threshold) ---
  const bloated: Insight[] = [];
  for (const node of data.nodes) {
    if (node.linesOfCode >= locWarningThreshold) {
      bloated.push({
        category: 'bloated',
        title: `${node.id}`,
        nodes: [node.id],
        severity: node.linesOfCode >= locDangerThreshold ? 'error' : 'warn',
        metric: node.linesOfCode,
        description: `${node.linesOfCode} lines of code — consider splitting into smaller modules.`,
      });
    }
  }
  bloated.sort((a, b) => b.metric - a.metric);
  bloated.splice(topN);

  // --- Unresolved local imports (stored as internal node metadata) ---
  const unresolved: Insight[] = [];
  for (const node of data.nodes) {
    const unresolvedImports = (node as GraphNodeWithMeta)._unresolvedImports ?? [];
    if (unresolvedImports.length === 0) { continue; }
    unresolved.push({
      category: 'unresolved',
      title: `${node.id}`,
      nodes: [node.id],
      severity: 'warn',
      metric: unresolvedImports.length,
      description: `Unresolved local imports: ${unresolvedImports.join(', ')}`,
    });
  }
  unresolved.sort((a, b) => b.metric - a.metric);
  unresolved.splice(topN);

  // --- Fan-out (top-N by outgoing import count) ---
  const fanOut: Insight[] = [];
  for (const node of data.nodes) {
    const deg = outgoingToOtherFiles.get(node.id) ?? 0;
    if (deg > 0) {
      fanOut.push({
        category: 'fan-out',
        title: `${node.id}`,
        nodes: [node.id],
        severity: 'warn',
        metric: deg,
        description: `Imports ${deg} files — candidate for splitting orchestration from implementation.`,
      });
    }
  }
  fanOut.sort((a, b) => b.metric - a.metric);
  fanOut.splice(topN);

  const violations = computeBoundaryViolations(data, options.boundaries, {
    fileMatcher,
    warn: options.warn,
  });

  // --- Risky modules (2+ strong signals, no numeric score) ---
  const riskyReasons = new Map<string, string[]>();
  const pushReason = (nodeId: string, reason: string): void => {
    const existing = riskyReasons.get(nodeId) ?? [];
    existing.push(reason);
    riskyReasons.set(nodeId, existing);
  };

  for (const cycle of cycles) {
    for (const nodeId of cycle.nodes) {
      pushReason(nodeId, 'Part of a dependency cycle');
    }
  }

  for (const insight of bloated.filter((entry) => entry.severity === 'error')) {
    pushReason(insight.nodes[0], `Large module (${insight.metric} LOC)`);
  }

  for (const violation of violations.filter((entry) => entry.category === 'layerViolation')) {
    pushReason(violation.sourceId, 'Layer boundary violation');
  }

  const hubIds = new Set(hubs.map((insight) => insight.nodes[0]));
  for (const insight of fanOut) {
    const nodeId = insight.nodes[0];
    if (!hubIds.has(nodeId)) { continue; }
    const fanIn = incomingFromOtherFiles.get(nodeId) ?? 0;
    pushReason(nodeId, `High fan-in (${fanIn}) and fan-out (${insight.metric})`);
  }

  const risky: Insight[] = [];
  for (const node of data.nodes) {
    const reasons = riskyReasons.get(node.id) ?? [];
    if (reasons.length < 2) { continue; }
    risky.push({
      category: 'risky',
      title: `${node.id}`,
      nodes: [node.id],
      severity: 'error',
      metric: reasons.length,
      description: `Reasons: ${reasons.join('; ')}`,
    });
  }
  risky.sort((a, b) => b.metric - a.metric || a.title.localeCompare(b.title));
  risky.splice(topN);

  return {
    cycles,
    orphans: orphans.slice(0, topN),
    hubs,
    bloated,
    unresolved,
    fanOut,
    risky,
    violations,
    computedAt: new Date().toISOString(),
  };
}
