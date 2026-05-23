import * as path from 'path';
import { GraphData, GraphNode } from '../model/graphTypes';
import { RawImport } from './extractors/types';
import {
  BoundaryComputeContext,
  BoundaryConfig,
  BoundaryViolation,
  Layer,
  LayerRule,
  resolveBoundaryConfig,
} from './boundaryRuleModels';

type ViolationSeverity = BoundaryViolation['severity'];

type CompiledLayerRule = {
  allow: Set<string>;
  deny: Set<string>;
  denySeverity: Map<string, ViolationSeverity>;
  allowSeverity: ViolationSeverity;
  hasAllow: boolean;
  hasDeny: boolean;
};

type BoundaryEdgeContext = {
  sourceNode: GraphNode;
  targetNode: GraphNode;
  sourceLine: number;
};

export function computeBoundaryViolations(
  data: GraphData,
  config: BoundaryConfig | undefined,
  context: BoundaryComputeContext
): BoundaryViolation[] {
  const resolvedConfig = resolveBoundaryConfig(config);
  const nodesById = new Map(data.nodes.map((node) => [node.id, node]));
  const layersByName = new Map(resolvedConfig.layers.map((layer) => [layer.name, layer]));
  const layerAssignments = assignLayers(data.nodes, resolvedConfig.layers, context);
  const ruleIndex = compileLayerRules(resolvedConfig.layers, resolvedConfig.layerRules, context);
  const violations: BoundaryViolation[] = [];

  collectDeepRelativeViolations(data.nodes, resolvedConfig.maxRelativeDepth, violations);

  for (const edge of data.edges) {
    if (edge.type !== 'import') {
      continue;
    }

    const sourceNode = nodesById.get(edge.source);
    const targetNode = nodesById.get(edge.target);
    if (!sourceNode || !targetNode) {
      continue;
    }

    const edgeContext: BoundaryEdgeContext = {
      sourceNode,
      targetNode,
      sourceLine: edge.sourceLine ?? 1,
    };

    pushViolation(
      violations,
      computeReverseTestViolation(
        edgeContext,
        resolvedConfig.testPatterns,
        context.fileMatcher
      )
    );
    pushViolation(
      violations,
      computePackageInternalViolation(
        edgeContext,
        resolvedConfig.internalFolderNames
      )
    );
    pushViolation(
      violations,
      computeLayerViolation(
        edgeContext,
        layerAssignments,
        ruleIndex
      )
    );
    pushViolation(
      violations,
      computeFacadeViolation(
        edgeContext,
        layerAssignments,
        layersByName,
        context
      )
    );
    pushViolation(
      violations,
      computeDeepInternalViolation(
        edgeContext,
        layerAssignments,
        layersByName,
        context
      )
    );
  }

  return violations;
}

function collectDeepRelativeViolations(
  nodes: GraphNode[],
  maxRelativeDepth: number,
  violations: BoundaryViolation[]
): void {
  for (const sourceNode of nodes) {
    const rawImports = (sourceNode as GraphNode & { _rawImports?: RawImport[] })._rawImports ?? [];
    for (const rawImport of rawImports) {
      pushViolation(
        violations,
        computeDeepRelativeViolation(sourceNode, rawImport, maxRelativeDepth)
      );
    }
  }
}

function assignLayers(
  nodes: GraphNode[],
  layers: Layer[],
  context: BoundaryComputeContext
): Map<string, string> {
  const assignments = new Map<string, string>();

  for (const node of nodes) {
    const bestMatch = findBestLayerMatch(node, layers, context);
    if (bestMatch.warning) {
      context.warn?.(bestMatch.warning.key, bestMatch.warning.message);
    }
    if (bestMatch.layerName) {
      assignments.set(node.id, bestMatch.layerName);
    }
  }

  return assignments;
}

function findBestLayerMatch(
  node: GraphNode,
  layers: Layer[],
  context: BoundaryComputeContext
): {
  layerName: string | null;
  warning?: { key: string; message: string };
} {
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

  const distinctLayers = new Set(matches.map((match) => match.layerName));
  const warning = distinctLayers.size > 1
    ? {
      key: `layer-collision:${node.id}`,
      message: `Boundary rules: ${node.id} matched multiple layers (${Array.from(distinctLayers).join(', ')}); longest glob wins.`,
    }
    : undefined;

  return {
    layerName: best?.layerName ?? null,
    warning,
  };
}

function compileLayerRules(
  layers: Layer[],
  rules: LayerRule[],
  context: BoundaryComputeContext
): Map<string, CompiledLayerRule> {
  const layerNames = new Set(layers.map((layer) => layer.name));
  const index = new Map<string, CompiledLayerRule>();

  for (const rule of rules) {
    if (!layerNames.has(rule.from)) {
      context.warn?.(
        `layer-rule-from:${rule.from}`,
        `Boundary rules: layerRules entry references unknown source layer "${rule.from}" and will be ignored.`
      );
      continue;
    }

    const entry = index.get(rule.from) ?? createEmptyCompiledRule();
    const severity = rule.severity ?? 'error';

    if (rule.canImport && rule.cannotImport) {
      context.warn?.(
        `layer-rule-mode:${rule.from}`,
        `Boundary rules: layer "${rule.from}" mixes canImport and cannotImport rules; deny rules will take precedence.`
      );
    }

    if (rule.canImport) {
      entry.hasAllow = true;
      entry.allowSeverity = severity;
      addReferencedLayers(rule.from, rule.canImport, layerNames, context, (layerName) => {
        entry.allow.add(layerName);
      });
    }

    if (rule.cannotImport) {
      entry.hasDeny = true;
      addReferencedLayers(rule.from, rule.cannotImport, layerNames, context, (layerName) => {
        entry.deny.add(layerName);
        entry.denySeverity.set(layerName, severity);
      });
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

function createEmptyCompiledRule(): CompiledLayerRule {
  return {
    allow: new Set<string>(),
    deny: new Set<string>(),
    denySeverity: new Map<string, ViolationSeverity>(),
    allowSeverity: 'error',
    hasAllow: false,
    hasDeny: false,
  };
}

function addReferencedLayers(
  fromLayer: string,
  targetLayers: string[],
  knownLayers: Set<string>,
  context: BoundaryComputeContext,
  onValidLayer: (layerName: string) => void
): void {
  for (const layerName of targetLayers) {
    if (!knownLayers.has(layerName)) {
      context.warn?.(
        `layer-rule-target:${fromLayer}:${layerName}`,
        `Boundary rules: layerRules entry references unknown target layer "${layerName}" and will be ignored.`
      );
      continue;
    }
    onValidLayer(layerName);
  }
}

function computeLayerViolation(
  edgeContext: BoundaryEdgeContext,
  layerAssignments: Map<string, string>,
  ruleIndex: Map<string, CompiledLayerRule>
): BoundaryViolation | null {
  const sourceLayer = layerAssignments.get(edgeContext.sourceNode.id);
  const targetLayer = layerAssignments.get(edgeContext.targetNode.id);
  if (!sourceLayer || !targetLayer) {
    return null;
  }

  const rules = ruleIndex.get(sourceLayer);
  if (!rules) {
    return null;
  }

  if (rules.deny.has(targetLayer)) {
    return createViolation(
      'layerViolation',
      edgeContext.sourceNode,
      edgeContext.targetNode,
      edgeContext.sourceLine,
      `${sourceLayer} cannot import ${targetLayer}`,
      rules.denySeverity.get(targetLayer) ?? 'error'
    );
  }

  if (rules.hasAllow && !rules.allow.has(targetLayer)) {
    return createViolation(
      'layerViolation',
      edgeContext.sourceNode,
      edgeContext.targetNode,
      edgeContext.sourceLine,
      `${sourceLayer} can only import: ${Array.from(rules.allow).join(', ') || '(nothing)'}`,
      rules.allowSeverity
    );
  }

  return null;
}

function computeDeepRelativeViolation(
  sourceNode: GraphNode,
  rawImport: RawImport,
  maxRelativeDepth: number
): BoundaryViolation | null {
  const specifier = rawImport.specifier;
  if (!specifier.startsWith('../')) {
    return null;
  }

  const depth = countLeadingParentTraversals(specifier);
  if (depth <= maxRelativeDepth) {
    return null;
  }

  return {
    ...createViolation(
      'deepRelative',
      sourceNode,
      {
        ...sourceNode,
        id: specifier,
        path: specifier,
      },
      rawImport.sourceLine ?? 1,
      `relative import depth ${depth} exceeds maxRelativeDepth ${maxRelativeDepth}`,
      'error'
    ),
    targetPath: specifier,
    targetId: specifier,
  };
}

function computeReverseTestViolation(
  edgeContext: BoundaryEdgeContext,
  testPatterns: string[],
  fileMatcher: BoundaryComputeContext['fileMatcher']
): BoundaryViolation | null {
  const sourceIsTest = fileMatcher(edgeContext.sourceNode.id, testPatterns, []);
  const targetIsTest = fileMatcher(edgeContext.targetNode.id, testPatterns, []);
  if (!sourceIsTest && targetIsTest) {
    return createViolation(
      'reverseTest',
      edgeContext.sourceNode,
      edgeContext.targetNode,
      edgeContext.sourceLine,
      'production code must not import test files'
    );
  }
  return null;
}

function computePackageInternalViolation(
  edgeContext: BoundaryEdgeContext,
  internalFolderNames: string[]
): BoundaryViolation | null {
  const targetSegments = edgeContext.targetNode.id.split('/');
  const internalIndex = targetSegments.findIndex((segment) => internalFolderNames.includes(segment));
  if (internalIndex < 0) {
    return null;
  }

  const packagePrefix = targetSegments.slice(0, internalIndex).join('/');
  const sourceInSamePackage = packagePrefix.length > 0
    ? edgeContext.sourceNode.id === packagePrefix || edgeContext.sourceNode.id.startsWith(`${packagePrefix}/`)
    : false;

  if (sourceInSamePackage) {
    return null;
  }

  return createViolation(
    'packageInternal',
    edgeContext.sourceNode,
    edgeContext.targetNode,
    edgeContext.sourceLine,
    `package-private import into ${packagePrefix || path.basename(edgeContext.targetNode.id)}`
  );
}

function computeFacadeViolation(
  edgeContext: BoundaryEdgeContext,
  layerAssignments: Map<string, string>,
  layersByName: Map<string, Layer>,
  context: BoundaryComputeContext
): BoundaryViolation | null {
  const layerPair = getCrossLayerPair(edgeContext, layerAssignments);
  if (!layerPair) {
    return null;
  }

  const target = layersByName.get(layerPair.targetLayer);
  if (!target?.publicEntry?.length) {
    return null;
  }

  if (context.fileMatcher(edgeContext.targetNode.id, target.publicEntry, [])) {
    return null;
  }

  return createViolation(
    'facadeBypass',
    edgeContext.sourceNode,
    edgeContext.targetNode,
    edgeContext.sourceLine,
    `${layerPair.targetLayer} smi byt importovano jen pres ${target.publicEntry.join(', ')}`,
    'warn'
  );
}

function computeDeepInternalViolation(
  edgeContext: BoundaryEdgeContext,
  layerAssignments: Map<string, string>,
  layersByName: Map<string, Layer>,
  context: BoundaryComputeContext
): BoundaryViolation | null {
  const layerPair = getCrossLayerPair(edgeContext, layerAssignments);
  if (!layerPair) {
    return null;
  }

  const target = layersByName.get(layerPair.targetLayer);
  if (!target?.avoidDeepImportsInto?.length) {
    return null;
  }

  if (!context.fileMatcher(edgeContext.targetNode.id, target.avoidDeepImportsInto, [])) {
    return null;
  }

  return createViolation(
    'deepInternalImport',
    edgeContext.sourceNode,
    edgeContext.targetNode,
    edgeContext.sourceLine,
    `import do vnitrku ${layerPair.targetLayer} (${edgeContext.targetNode.id}); preferuj verejne API`,
    'warn'
  );
}

function getCrossLayerPair(
  edgeContext: BoundaryEdgeContext,
  layerAssignments: Map<string, string>
): { sourceLayer: string; targetLayer: string } | null {
  const sourceLayer = layerAssignments.get(edgeContext.sourceNode.id);
  const targetLayer = layerAssignments.get(edgeContext.targetNode.id);
  if (!sourceLayer || !targetLayer || sourceLayer === targetLayer) {
    return null;
  }

  return { sourceLayer, targetLayer };
}

function createViolation(
  category: BoundaryViolation['category'],
  sourceNode: GraphNode,
  targetNode: GraphNode,
  sourceLine: number,
  rule: string,
  severity: ViolationSeverity = 'error'
): BoundaryViolation {
  return {
    category,
    severity,
    sourcePath: sourceNode.path,
    targetPath: targetNode.path,
    sourceLine,
    rule,
    title: `${sourceNode.id} -> ${targetNode.id} (${rule})`,
    sourceId: sourceNode.id,
    targetId: targetNode.id,
  };
}

function pushViolation(
  violations: BoundaryViolation[],
  violation: BoundaryViolation | null
): void {
  if (violation) {
    violations.push(violation);
  }
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
