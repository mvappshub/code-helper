import * as path from 'path';
import { GraphData, GraphEdge, GraphNode } from '../model/graphTypes';

export interface Layer {
  name: string;
  match: string[];
}

export interface LayerRule {
  from: string;
  cannotImport?: string[];
  canImport?: string[];
}

export interface BoundaryConfig {
  layers?: Layer[];
  layerRules?: LayerRule[];
  maxRelativeDepth?: number;
  testPatterns?: string[];
  internalFolderNames?: string[];
}

export type BoundaryViolationCategory =
  | 'layerViolation'
  | 'deepRelative'
  | 'reverseTest'
  | 'packageInternal';

export interface BoundaryViolation {
  category: BoundaryViolationCategory;
  sourcePath: string;
  targetPath: string;
  sourceLine: number;
  rule: string;
  title: string;
  sourceId: string;
  targetId: string;
}

export interface BoundaryComputeContext {
  fileMatcher: (filePath: string, includes: string[], excludes: string[]) => boolean;
  warn?: (key: string, message: string) => void;
}

export interface ResolvedBoundaryConfig {
  layers: Layer[];
  layerRules: LayerRule[];
  maxRelativeDepth: number;
  testPatterns: string[];
  internalFolderNames: string[];
}

const DEFAULT_TEST_PATTERNS = [
  '**/*.{test,spec}.{ts,tsx,js,jsx}',
  '**/test/**',
  '**/tests/**',
];

const DEFAULT_INTERNAL_FOLDER_NAMES = ['internal', '_internal', 'private'];

export function resolveBoundaryConfig(config?: BoundaryConfig): ResolvedBoundaryConfig {
  return {
    layers: config?.layers ?? [],
    layerRules: config?.layerRules ?? [],
    maxRelativeDepth: config?.maxRelativeDepth ?? 3,
    testPatterns: config?.testPatterns ?? DEFAULT_TEST_PATTERNS,
    internalFolderNames: config?.internalFolderNames ?? DEFAULT_INTERNAL_FOLDER_NAMES,
  };
}

export function computeBoundaryViolations(
  data: GraphData,
  config: BoundaryConfig | undefined,
  context: BoundaryComputeContext
): BoundaryViolation[] {
  const resolvedConfig = resolveBoundaryConfig(config);
  const nodesById = new Map(data.nodes.map((node) => [node.id, node]));
  const layerAssignments = assignLayers(data.nodes, resolvedConfig.layers, context);
  const ruleIndex = compileLayerRules(resolvedConfig.layers, resolvedConfig.layerRules, context);
  const violations: BoundaryViolation[] = [];

  for (const edge of data.edges) {
    if (edge.type !== 'import') {
      continue;
    }

    const sourceNode = nodesById.get(edge.source);
    const targetNode = nodesById.get(edge.target);
    if (!sourceNode || !targetNode) {
      continue;
    }

    const sourceLine = edge.sourceLine ?? 1;
    const deepRelativeViolation = computeDeepRelativeViolation(sourceNode, targetNode, edge, resolvedConfig.maxRelativeDepth, sourceLine);
    if (deepRelativeViolation) {
      violations.push(deepRelativeViolation);
    }

    const reverseTestViolation = computeReverseTestViolation(
      sourceNode,
      targetNode,
      sourceLine,
      resolvedConfig.testPatterns,
      context.fileMatcher
    );
    if (reverseTestViolation) {
      violations.push(reverseTestViolation);
    }

    const packageInternalViolation = computePackageInternalViolation(
      sourceNode,
      targetNode,
      sourceLine,
      resolvedConfig.internalFolderNames
    );
    if (packageInternalViolation) {
      violations.push(packageInternalViolation);
    }

    const layerViolation = computeLayerViolation(
      sourceNode,
      targetNode,
      sourceLine,
      layerAssignments,
      ruleIndex
    );
    if (layerViolation) {
      violations.push(layerViolation);
    }
  }

  return violations;
}

function assignLayers(
  nodes: GraphNode[],
  layers: Layer[],
  context: BoundaryComputeContext
): Map<string, string> {
  const assignments = new Map<string, string>();

  for (const node of nodes) {
    let best: { layerName: string; patternLength: number } | null = null;
    const matches: { layerName: string; pattern: string }[] = [];

    for (const layer of layers) {
      for (const pattern of layer.match) {
        if (!context.fileMatcher(node.id, [pattern], [])) {
          continue;
        }
        matches.push({ layerName: layer.name, pattern });
        if (!best || pattern.length > best.patternLength) {
          best = { layerName: layer.name, patternLength: pattern.length };
        }
      }
    }

    if (matches.length > 1) {
      const distinctLayers = new Set(matches.map((match) => match.layerName));
      if (distinctLayers.size > 1) {
        context.warn?.(
          `layer-collision:${node.id}`,
          `Boundary rules: ${node.id} matched multiple layers (${Array.from(distinctLayers).join(', ')}); longest glob wins.`
        );
      }
    }

    if (best) {
      assignments.set(node.id, best.layerName);
    }
  }

  return assignments;
}

function compileLayerRules(
  layers: Layer[],
  rules: LayerRule[],
  context: BoundaryComputeContext
): Map<string, { allow: Set<string>; deny: Set<string>; hasAllow: boolean; hasDeny: boolean }> {
  const layerNames = new Set(layers.map((layer) => layer.name));
  const index = new Map<string, { allow: Set<string>; deny: Set<string>; hasAllow: boolean; hasDeny: boolean }>();

  for (const rule of rules) {
    if (!layerNames.has(rule.from)) {
      context.warn?.(
        `layer-rule-from:${rule.from}`,
        `Boundary rules: layerRules entry references unknown source layer "${rule.from}" and will be ignored.`
      );
      continue;
    }

    const entry = index.get(rule.from) ?? {
      allow: new Set<string>(),
      deny: new Set<string>(),
      hasAllow: false,
      hasDeny: false,
    };

    if (rule.canImport && rule.cannotImport) {
      context.warn?.(
        `layer-rule-mode:${rule.from}`,
        `Boundary rules: layer "${rule.from}" mixes canImport and cannotImport rules; deny rules will take precedence.`
      );
    }

    if (rule.canImport) {
      entry.hasAllow = true;
      for (const layerName of rule.canImport) {
        if (!layerNames.has(layerName)) {
          context.warn?.(
            `layer-rule-target:${rule.from}:${layerName}`,
            `Boundary rules: layerRules entry references unknown target layer "${layerName}" and will be ignored.`
          );
          continue;
        }
        entry.allow.add(layerName);
      }
    }

    if (rule.cannotImport) {
      entry.hasDeny = true;
      for (const layerName of rule.cannotImport) {
        if (!layerNames.has(layerName)) {
          context.warn?.(
            `layer-rule-target:${rule.from}:${layerName}`,
            `Boundary rules: layerRules entry references unknown target layer "${layerName}" and will be ignored.`
          );
          continue;
        }
        entry.deny.add(layerName);
      }
    }

    if (entry.hasAllow && entry.hasDeny) {
      context.warn?.(
        `layer-rule-mixed:${rule.from}`,
        `Boundary rules: layer "${rule.from}" uses both allow and deny modes; explicit denies win over allows.`
      );
    }

    index.set(rule.from, entry);
  }

  return index;
}

function computeLayerViolation(
  sourceNode: GraphNode,
  targetNode: GraphNode,
  sourceLine: number,
  layerAssignments: Map<string, string>,
  ruleIndex: Map<string, { allow: Set<string>; deny: Set<string>; hasAllow: boolean; hasDeny: boolean }>
): BoundaryViolation | null {
  const sourceLayer = layerAssignments.get(sourceNode.id);
  const targetLayer = layerAssignments.get(targetNode.id);
  if (!sourceLayer || !targetLayer) {
    return null;
  }

  const rules = ruleIndex.get(sourceLayer);
  if (!rules) {
    return null;
  }

  if (rules.deny.has(targetLayer)) {
    return createViolation('layerViolation', sourceNode, targetNode, sourceLine, `${sourceLayer} cannot import ${targetLayer}`);
  }

  if (rules.hasAllow && !rules.allow.has(targetLayer)) {
    return createViolation('layerViolation', sourceNode, targetNode, sourceLine, `${sourceLayer} can only import: ${Array.from(rules.allow).join(', ') || '(nothing)'}`);
  }

  return null;
}

function computeDeepRelativeViolation(
  sourceNode: GraphNode,
  targetNode: GraphNode,
  edge: GraphEdge,
  maxRelativeDepth: number,
  sourceLine: number
): BoundaryViolation | null {
  const specifier = edge.specifier ?? '';
  if (!specifier.startsWith('../')) {
    return null;
  }

  const depth = countLeadingParentTraversals(specifier);
  if (depth <= maxRelativeDepth) {
    return null;
  }

  return createViolation(
    'deepRelative',
    sourceNode,
    targetNode,
    sourceLine,
    `relative import depth ${depth} exceeds maxRelativeDepth ${maxRelativeDepth}`
  );
}

function computeReverseTestViolation(
  sourceNode: GraphNode,
  targetNode: GraphNode,
  sourceLine: number,
  testPatterns: string[],
  fileMatcher: BoundaryComputeContext['fileMatcher']
): BoundaryViolation | null {
  const sourceIsTest = fileMatcher(sourceNode.id, testPatterns, []);
  const targetIsTest = fileMatcher(targetNode.id, testPatterns, []);
  if (!sourceIsTest && targetIsTest) {
    return createViolation('reverseTest', sourceNode, targetNode, sourceLine, 'production code must not import test files');
  }
  return null;
}

function computePackageInternalViolation(
  sourceNode: GraphNode,
  targetNode: GraphNode,
  sourceLine: number,
  internalFolderNames: string[]
): BoundaryViolation | null {
  const targetSegments = targetNode.id.split('/');
  const internalIndex = targetSegments.findIndex((segment) => internalFolderNames.includes(segment));
  if (internalIndex < 0) {
    return null;
  }

  const packagePrefix = targetSegments.slice(0, internalIndex).join('/');
  const sourceInSamePackage = packagePrefix.length > 0
    ? sourceNode.id === packagePrefix || sourceNode.id.startsWith(`${packagePrefix}/`)
    : false;

  if (sourceInSamePackage) {
    return null;
  }

  return createViolation(
    'packageInternal',
    sourceNode,
    targetNode,
    sourceLine,
    `package-private import into ${packagePrefix || path.basename(targetNode.id)}`
  );
}

function createViolation(
  category: BoundaryViolationCategory,
  sourceNode: GraphNode,
  targetNode: GraphNode,
  sourceLine: number,
  rule: string
): BoundaryViolation {
  return {
    category,
    sourcePath: sourceNode.path,
    targetPath: targetNode.path,
    sourceLine,
    rule,
    title: `${sourceNode.id} -> ${targetNode.id} (${rule})`,
    sourceId: sourceNode.id,
    targetId: targetNode.id,
  };
}

function countLeadingParentTraversals(specifier: string): number {
  let depth = 0;
  let index = 0;
  while (specifier.startsWith('../', index)) {
    depth++;
    index += 3;
  }
  return depth;
}
