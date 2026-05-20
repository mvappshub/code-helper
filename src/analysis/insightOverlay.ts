import { GraphData } from '../model/graphTypes';
import { InsightSet } from './insightTypes';
import { matchesPatterns } from '../util/fileMatcher';

export type OverlayCategory = 'cycle' | 'hub' | 'entrypoint';

export interface OverlayInfo {
  category: OverlayCategory;
  reason: string;
}

export function buildInsightOverlay(
  graphData: GraphData,
  insightSet: InsightSet | null,
  entryPointPatterns: string[]
): Record<string, OverlayInfo> {
  const overlay: Record<string, OverlayInfo> = {};

  for (const node of graphData.nodes) {
    if (matchesPatterns(node.path, entryPointPatterns, [], false)) {
      overlay[node.id] = {
        category: 'entrypoint',
        reason: 'Entry point',
      };
    }
  }

  if (!insightSet) {
    return overlay;
  }

  for (const hub of insightSet.hubs) {
    const nodeId = hub.nodes[0];
    overlay[nodeId] = {
      category: 'hub',
      reason: `Hub: imported by ${hub.metric} files`,
    };
  }

  for (const cycle of insightSet.cycles) {
    const others = cycle.nodes.map((nodeId) => nodeId.split('/').pop() ?? nodeId).join(', ');
    for (const nodeId of cycle.nodes) {
      overlay[nodeId] = {
        category: 'cycle',
        reason: `In cycle with: ${others}`,
      };
    }
  }

  return overlay;
}
