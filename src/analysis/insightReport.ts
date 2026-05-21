import * as path from 'path';
import { BoundaryConfig, resolveBoundaryConfig, summarizeBoundaryConfig } from './boundaryRules';
import { Insight, InsightSet } from './insightTypes';
import { GraphData } from '../model/graphTypes';

export interface InsightReportConfigSnapshot {
  topN: number;
  locWarningThreshold: number;
  locDangerThreshold: number;
  entryPointPatterns: string[];
  boundaries?: BoundaryConfig;
}

export interface InsightReportMetadata {
  workspaceRoot: string | null;
  generatedAt: string;
}

export interface InsightReportInput {
  graph: GraphData;
  insights: InsightSet;
  config: InsightReportConfigSnapshot;
  metadata: InsightReportMetadata;
}

type InsightSection = {
  key: keyof Pick<InsightSet, 'risky' | 'cycles' | 'violations' | 'bloated' | 'hubs' | 'fanOut' | 'unresolved' | 'orphans'>;
  title: string;
  emptyLabel: string;
};

const INSIGHT_SECTIONS: InsightSection[] = [
  { key: 'risky', title: 'Risky Modules', emptyLabel: 'No modules currently combine multiple strong risk signals.' },
  { key: 'cycles', title: 'Dependency Cycles', emptyLabel: 'No dependency cycles detected.' },
  { key: 'violations', title: 'Boundary Violations', emptyLabel: 'No configured boundary violations detected.' },
  { key: 'bloated', title: 'Bloated Modules', emptyLabel: 'No files exceeded the configured LOC warning threshold.' },
  { key: 'hubs', title: 'High Fan-In Hubs', emptyLabel: 'No high fan-in modules detected in the current top-N slice.' },
  { key: 'fanOut', title: 'High Fan-Out Modules', emptyLabel: 'No high fan-out modules detected in the current top-N slice.' },
  { key: 'unresolved', title: 'Unresolved Local Imports', emptyLabel: 'No unresolved local imports detected.' },
  { key: 'orphans', title: 'Potential Orphans', emptyLabel: 'No non-entry-point orphan modules detected.' },
];

export function buildInsightsAgentReport(input: InsightReportInput): string {
  const { graph, insights, config, metadata } = input;
  const workspaceName = metadata.workspaceRoot ? path.basename(metadata.workspaceRoot) : 'Unknown Workspace';
  const importEdgeCount = graph.edges.filter((edge) => edge.type === 'import').length;
  const totalFindings = countFindings(insights);
  const boundaries = resolveBoundaryConfig(config.boundaries);
  const boundarySummary = summarizeBoundaryConfig(config.boundaries);

  const lines: string[] = [
    '# Architecture Insights Review Brief',
    '',
    `Generated at: ${metadata.generatedAt}`,
    '',
    '## Review Goal',
    'Review the architectural findings below and determine whether they imply real correctness, maintainability, layering, coupling, dead-code, or dependency risks.',
    'Distinguish between likely real issues, acceptable tradeoffs, and potential false positives caused by limited static analysis context.',
    '',
    '## Workspace Summary',
    `- Workspace: ${workspaceName}`,
    `- Workspace root: ${metadata.workspaceRoot ?? 'Unavailable'}`,
    `- Graph generated at: ${graph.generatedAt}`,
    `- Insights computed at: ${insights.computedAt}`,
    `- Files analyzed: ${graph.nodes.length}`,
    `- Total edges: ${graph.edges.length}`,
    `- Import edges: ${importEdgeCount}`,
    `- Total findings: ${totalFindings}`,
    '',
    '## Active Analysis Configuration',
    `- Top N per category: ${config.topN}`,
    `- LOC warning threshold: ${config.locWarningThreshold}`,
    `- LOC danger threshold: ${config.locDangerThreshold}`,
    `- Entry point patterns: ${formatInlineList(config.entryPointPatterns)}`,
    `- Boundary layers configured: ${boundaries.layers.length}`,
    `- Boundary rules configured: ${boundaries.layerRules.length}`,
    `- Layer checks active: ${boundarySummary.layerChecksActive ? 'yes' : 'no'}`,
    `- Max relative import depth: ${boundaries.maxRelativeDepth}`,
    `- Test patterns: ${formatInlineList(boundaries.testPatterns)}`,
    `- Internal folder names: ${formatInlineList(boundaries.internalFolderNames)}`,
    '',
    '## Findings Summary',
    `- Errors: ${countBySeverity(insights, 'error')}`,
    `- Warnings: ${countBySeverity(insights, 'warn')}`,
    `- Informational findings: ${countBySeverity(insights, 'info')}`,
    `- Risky modules: ${insights.risky.length}`,
    `- Cycles: ${insights.cycles.length}`,
    `- Boundary violations: ${insights.violations.length}`,
    `- Bloated modules: ${insights.bloated.length}`,
    `- High fan-in hubs: ${insights.hubs.length}`,
    `- High fan-out modules: ${insights.fanOut.length}`,
    `- Unresolved local imports: ${insights.unresolved.length}`,
    `- Potential orphans: ${insights.orphans.length}`,
    '',
  ];

  if (!boundarySummary.layerChecksActive) {
    lines.push(
      'Layer checks are currently inactive because boundaries.layers or boundaries.layerRules are not configured.',
      'Treat "0 layer violations" as "not evaluated yet", not as proof that layer boundaries are clean.',
      ''
    );
  }

  if (totalFindings === 0) {
    lines.push(
      '## No Findings Detected',
      'No current insight categories produced findings for this snapshot.',
      'Please verify whether that likely reflects a healthy architecture or whether the current graph scope, thresholds, or boundary rules are too limited to surface problems.',
      ''
    );
  }

  lines.push('## Detailed Findings', '');
  for (const section of INSIGHT_SECTIONS) {
    lines.push(`### ${section.title}`);
    if (section.key === 'violations') {
      const violations = insights.violations;
      if (violations.length === 0) {
        if (!boundarySummary.layerChecksActive) {
          lines.push('Layer checks inactive — configure boundaries.layers and boundaries.layerRules.', '');
          continue;
        }
        lines.push(section.emptyLabel, '');
        continue;
      }
      violations.forEach((violation, index) => {
        lines.push(`${index + 1}. ${violation.title}`);
        lines.push(`   - Category: ${violation.category}`);
        lines.push('   - Severity: error');
        lines.push(`   - Source: ${violation.sourceId}`);
        lines.push(`   - Target: ${violation.targetId}`);
        lines.push(`   - Source path: ${violation.sourcePath}`);
        lines.push(`   - Target path: ${violation.targetPath}`);
        lines.push(`   - Source line: ${violation.sourceLine}`);
        lines.push(`   - Rule: ${violation.rule}`);
      });
      lines.push('');
      continue;
    }

    const entries = insights[section.key] as Insight[];
    if (entries.length === 0) {
      lines.push(section.emptyLabel, '');
      continue;
    }
    entries.forEach((entry, index) => {
      lines.push(`${index + 1}. ${entry.title}`);
      lines.push(`   - Category: ${entry.category}`);
      lines.push(`   - Severity: ${entry.severity}`);
      lines.push(`   - Metric: ${entry.metric}`);
      lines.push(`   - Nodes: ${entry.nodes.join(', ')}`);
      if (entry.description) {
        lines.push(`   - Evidence: ${entry.description}`);
      }
    });
    lines.push('');
  }

  lines.push(
    '## Questions For The Coding Agent To Verify',
    '- Which findings are likely to cause real defects, architectural erosion, or costly maintenance hotspots if left unchanged?',
    '- Which findings are expected by design, such as deliberate entrypoint orchestration, generated layering seams, or test-only coupling?',
    '- Are any cycles, boundary violations, or unresolved imports likely to break builds, block refactors, or hide runtime errors?',
    '- Do the largest hubs or fan-out modules suggest missing abstractions, overloaded responsibilities, or poor dependency direction?',
    '- Do orphan modules look like dead code, private extension points, or files simply outside the current graph scope?',
    '',
    '## Final Instruction',
    'Assess the findings as an engineering reviewer. For each meaningful issue, explain why it matters, estimate its likely impact, note any plausible false-positive explanations, and suggest the smallest practical follow-up investigation or refactor.',
    ''
  );

  return lines.join('\n');
}

function countFindings(insights: InsightSet): number {
  return insights.risky.length
    + insights.cycles.length
    + insights.violations.length
    + insights.bloated.length
    + insights.hubs.length
    + insights.fanOut.length
    + insights.unresolved.length
    + insights.orphans.length;
}

function countBySeverity(insights: InsightSet, severity: 'info' | 'warn' | 'error'): number {
  return flattenInsightSet(insights)
    .filter((entry) => entry.severity === severity)
    .length
    + (severity === 'error' ? insights.violations.length : 0);
}

function flattenInsightSet(insights: InsightSet): Insight[] {
  return [
    ...insights.risky,
    ...insights.cycles,
    ...insights.bloated,
    ...insights.hubs,
    ...insights.fanOut,
    ...insights.unresolved,
    ...insights.orphans,
  ];
}

function formatInlineList(values: string[]): string {
  return values.length > 0 ? values.join(', ') : '(none)';
}
