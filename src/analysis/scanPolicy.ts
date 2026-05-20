import * as path from 'path';
import { matchesAnyPattern, matchesPatterns } from '../util/fileMatcher';

export const EXCLUSION_DEFAULTS = [
  '**/node_modules/**',
  '**/dist/**',
  '**/out/**',
  '**/.git/**',
  '**/build/**',
  '**/__pycache__/**',
  '**/.vscode-test/**',
  '**/.vscode-test-web/**',
  '**/coverage/**',
  '**/.next/**',
  '**/.nuxt/**',
  '**/target/**',
  '**/.idea/**',
  '**/.vs/**',
  '**/.cache/**',
  '**/bin/**',
  '**/obj/**',
  '**/vendor/**',
  '**/fixtures/**',
  '**/__fixtures__/**',
  '**/test-fixtures/**',
  '**/*.min.js',
  '**/*.min.css',
  '**/*.bundle.js',
  '**/*.generated.{ts,js,tsx,jsx,cs,java}',
  '**/*.g.cs',
  '**/*.d.ts',
] as const;

export const GENERATED_MARKERS = [
  /@generated\b/,
  /DO NOT EDIT/i,
  /auto-?generated/i,
  /^\s*\/\*\s*eslint-disable.*generated/i,
];

export interface ResolvedScanConfig {
  workspaceRoot: string;
  includePatterns: string[];
  excludePatterns: string[];
  maxDepth: number;
  maxFileLOC: number;
  includeOverridesExcludes: boolean;
}

export function mergeExcludePatterns(userPatterns: string[]): string[] {
  return Array.from(new Set([...EXCLUSION_DEFAULTS, ...userPatterns]));
}

export function pathMatchesScan(
  filePath: string,
  config: Pick<ResolvedScanConfig, 'includePatterns' | 'excludePatterns' | 'includeOverridesExcludes'>
): boolean {
  return matchesPatterns(
    filePath,
    config.includePatterns,
    config.excludePatterns,
    config.includeOverridesExcludes
  );
}

export interface FileContentScanDecision {
  included: boolean;
  reason?: 'generated-marker' | 'max-loc' | 'long-first-line';
}

export function shouldIncludeFileContent(
  absPath: string,
  content: string,
  config: Pick<ResolvedScanConfig, 'includePatterns' | 'maxFileLOC' | 'includeOverridesExcludes'>
): FileContentScanDecision {
  if (config.includeOverridesExcludes && matchesAnyPattern(absPath, config.includePatterns)) {
    return { included: true };
  }

  const firstFiveLines = content.split(/\r?\n/, 5).join('\n');
  if (GENERATED_MARKERS.some((marker) => marker.test(firstFiveLines))) {
    return { included: false, reason: 'generated-marker' };
  }

  const firstLine = content.split(/\r?\n/, 1)[0] ?? '';
  if (firstLine.length > 5000) {
    return { included: false, reason: 'long-first-line' };
  }

  const linesOfCode = content.split('\n').length;
  if (linesOfCode > config.maxFileLOC) {
    return { included: false, reason: 'max-loc' };
  }

  return { included: true };
}

export function isWithinMaxDepth(absPath: string, workspaceRoot: string, maxDepth: number): boolean {
  const rel = path.relative(workspaceRoot, absPath).replace(/\\/g, '/');
  if (!rel || rel.startsWith('..')) { return false; }
  const depth = rel.split('/').length - 1;
  return depth <= maxDepth;
}
