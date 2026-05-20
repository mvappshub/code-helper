import { GraphData } from '../model/graphTypes';
import { InsightSet } from './insightTypes';

export interface DiagnosticDescriptor {
  path: string;
  message: string;
  code: 'arch.cycle' | 'arch.bloated' | 'arch.layerViolation' | 'arch.deepRelative' | 'arch.reverseTest' | 'arch.packageInternal';
  source: 'CodeLens Architecture';
  line?: number;
}

export function insightSetToDiagnostics(
  insightSet: InsightSet | null,
  graphData: GraphData,
  locDangerThreshold: number
): Map<string, DiagnosticDescriptor[]> {
  const payload = new Map<string, DiagnosticDescriptor[]>();
  if (!insightSet) {
    return payload;
  }

  const nodesById = new Map(graphData.nodes.map((node) => [node.id, node]));

  for (const cycle of insightSet.cycles) {
    const pathText = cycle.nodes.length === 1
      ? `${cycle.nodes[0]} -> ${cycle.nodes[0]}`
      : `${cycle.nodes.join(' -> ')} -> ${cycle.nodes[0]}`;
    const message = `Part of circular dependency: ${pathText}`;

    for (const nodeId of cycle.nodes) {
      const node = nodesById.get(nodeId);
      if (!node) { continue; }
      pushDiagnostic(payload, node.path, {
        path: node.path,
        message,
        code: 'arch.cycle',
        source: 'CodeLens Architecture',
        line: 1,
      });
    }
  }

  for (const bloated of insightSet.bloated.filter((insight) => insight.severity === 'error')) {
    const nodeId = bloated.nodes[0];
    const node = nodesById.get(nodeId);
    if (!node) { continue; }
    pushDiagnostic(payload, node.path, {
      path: node.path,
      message: `File has ${node.linesOfCode} lines of code (above danger threshold ${locDangerThreshold})`,
      code: 'arch.bloated',
      source: 'CodeLens Architecture',
      line: 1,
    });
  }

  for (const violation of insightSet.violations) {
    pushDiagnostic(payload, violation.sourcePath, {
      path: violation.sourcePath,
      message: violation.title,
      code: violationCodeForCategory(violation.category),
      source: 'CodeLens Architecture',
      line: violation.sourceLine,
    });
  }

  return payload;
}

function violationCodeForCategory(
  category: 'layerViolation' | 'deepRelative' | 'reverseTest' | 'packageInternal'
): DiagnosticDescriptor['code'] {
  switch (category) {
    case 'layerViolation':
      return 'arch.layerViolation';
    case 'deepRelative':
      return 'arch.deepRelative';
    case 'reverseTest':
      return 'arch.reverseTest';
    case 'packageInternal':
      return 'arch.packageInternal';
  }
}

function pushDiagnostic(
  payload: Map<string, DiagnosticDescriptor[]>,
  filePath: string,
  diagnostic: DiagnosticDescriptor
): void {
  const existing = payload.get(filePath) ?? [];
  existing.push(diagnostic);
  payload.set(filePath, existing);
}
