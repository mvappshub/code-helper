export interface Layer {
  name: string;
  match: string[];
  publicEntry?: string[];
  avoidDeepImportsInto?: string[];
}

export interface LayerRule {
  from: string;
  cannotImport?: string[];
  canImport?: string[];
  severity?: 'warn' | 'error';
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
  | 'packageInternal'
  | 'facadeBypass'
  | 'deepInternalImport';

export interface BoundaryViolation {
  category: BoundaryViolationCategory;
  severity: 'warn' | 'error';
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

export interface BoundaryConfigSummary {
  layerCount: number;
  ruleCount: number;
  layerChecksActive: boolean;
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

export function summarizeBoundaryConfig(config?: BoundaryConfig): BoundaryConfigSummary {
  const resolved = resolveBoundaryConfig(config);
  return {
    layerCount: resolved.layers.length,
    ruleCount: resolved.layerRules.length,
    layerChecksActive: resolved.layers.length > 0 && resolved.layerRules.length > 0,
  };
}
