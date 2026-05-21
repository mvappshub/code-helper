import * as assert from 'assert';
import { buildInsightsAgentReport } from '../../analysis/insightReport';
import { GraphData, GraphEdge, GraphNode } from '../../model/graphTypes';
import { InsightSet } from '../../analysis/insightTypes';

function makeNode(id: string, linesOfCode = 10): GraphNode {
  return {
    id,
    path: `/ws/${id}`,
    language: 'ts',
    linesOfCode,
    lastModified: '2026-05-21T09:00:00.000Z',
    depth: id.split('/').length - 1,
    label: id.split('/').pop() ?? id,
  };
}

function makeEdge(source: string, target: string, sourceLine?: number, specifier?: string): GraphEdge {
  return {
    source,
    target,
    type: 'import',
    sourceLine,
    specifier,
  };
}

suite('buildInsightsAgentReport', () => {
  test('renders all major sections and evidence', () => {
    const graph: GraphData = {
      nodes: [
        makeNode('src/a.ts', 1200),
        makeNode('src/b.ts', 650),
        makeNode('src/c.ts', 20),
      ],
      edges: [
        makeEdge('src/a.ts', 'src/b.ts', 12, './b'),
        makeEdge('src/b.ts', 'src/a.ts', 9, './a'),
        makeEdge('src/a.ts', 'src/c.ts', 20, './c'),
      ],
      generatedAt: '2026-05-21T08:00:00.000Z',
    };

    const insights: InsightSet = {
      risky: [{
        category: 'risky',
        title: 'src/a.ts',
        nodes: ['src/a.ts'],
        severity: 'error',
        metric: 3,
        description: 'Reasons: Part of a dependency cycle; Large module (1200 LOC)',
      }],
      cycles: [{
        category: 'cycle',
        title: 'Cycle: src/a.ts -> src/b.ts -> src/a.ts',
        nodes: ['src/a.ts', 'src/b.ts'],
        severity: 'error',
        metric: 2,
        description: '2 files form a circular dependency.',
      }],
      orphans: [{
        category: 'orphan',
        title: 'src/c.ts',
        nodes: ['src/c.ts'],
        severity: 'info',
        metric: 20,
        description: 'No other file imports this module.',
      }],
      hubs: [{
        category: 'hub',
        title: 'src/b.ts',
        nodes: ['src/b.ts'],
        severity: 'warn',
        metric: 1,
        description: 'Imported by 1 files.',
      }],
      bloated: [{
        category: 'bloated',
        title: 'src/a.ts',
        nodes: ['src/a.ts'],
        severity: 'error',
        metric: 1200,
        description: '1200 lines of code.',
      }],
      unresolved: [{
        category: 'unresolved',
        title: 'src/b.ts',
        nodes: ['src/b.ts'],
        severity: 'warn',
        metric: 2,
        description: 'Unresolved local imports: ./missing, ./ghost',
      }],
      fanOut: [{
        category: 'fan-out',
        title: 'src/a.ts',
        nodes: ['src/a.ts'],
        severity: 'warn',
        metric: 2,
        description: 'Imports 2 files.',
      }],
      violations: [{
        category: 'layerViolation',
        sourcePath: '/ws/src/a.ts',
        targetPath: '/ws/src/b.ts',
        sourceLine: 12,
        rule: 'ui cannot import db',
        title: 'Layer violation: ui cannot import db',
        sourceId: 'src/a.ts',
        targetId: 'src/b.ts',
      }],
      computedAt: '2026-05-21T08:01:00.000Z',
    };

    const report = buildInsightsAgentReport({
      graph,
      insights,
      config: {
        topN: 10,
        locWarningThreshold: 500,
        locDangerThreshold: 1000,
        entryPointPatterns: ['**/extension.ts', '**/index.ts'],
        boundaries: {
          layers: [{ name: 'ui', match: ['src/ui/**'] }],
          layerRules: [{ from: 'ui', cannotImport: ['db'] }],
          maxRelativeDepth: 3,
          testPatterns: ['**/*.test.ts'],
          internalFolderNames: ['internal'],
        },
      },
      metadata: {
        workspaceRoot: '/ws',
        generatedAt: '2026-05-21T08:02:00.000Z',
      },
    });

    assert.ok(report.includes('# Architecture Insights Review Brief'));
    assert.ok(report.includes('## Workspace Summary'));
    assert.ok(report.includes('- Files analyzed: 3'));
    assert.ok(report.includes('## Active Analysis Configuration'));
    assert.ok(report.includes('- Top N per category: 10'));
    assert.ok(report.includes('## Findings Summary'));
    assert.ok(report.includes('- Boundary violations: 1'));
    assert.ok(report.includes('### Dependency Cycles'));
    assert.ok(report.includes('Cycle: src/a.ts -> src/b.ts -> src/a.ts'));
    assert.ok(report.includes('### Boundary Violations'));
    assert.ok(report.includes('Rule: ui cannot import db'));
    assert.ok(report.includes('Source path: /ws/src/a.ts'));
    assert.ok(report.includes('### Unresolved Local Imports'));
    assert.ok(report.includes('Unresolved local imports: ./missing, ./ghost'));
    assert.ok(report.includes('## Questions For The Coding Agent To Verify'));
    assert.ok(report.includes('## Final Instruction'));
  });

  test('renders a valid empty report when there are no findings', () => {
    const graph: GraphData = {
      nodes: [makeNode('src/clean.ts', 40)],
      edges: [],
      generatedAt: '2026-05-21T08:00:00.000Z',
    };

    const insights: InsightSet = {
      risky: [],
      cycles: [],
      orphans: [],
      hubs: [],
      bloated: [],
      unresolved: [],
      fanOut: [],
      violations: [],
      computedAt: '2026-05-21T08:01:00.000Z',
    };

    const report = buildInsightsAgentReport({
      graph,
      insights,
      config: {
        topN: 10,
        locWarningThreshold: 500,
        locDangerThreshold: 1000,
        entryPointPatterns: [],
      },
      metadata: {
        workspaceRoot: '/ws',
        generatedAt: '2026-05-21T08:02:00.000Z',
      },
    });

    assert.ok(report.includes('## No Findings Detected'));
    assert.ok(report.includes('Please verify whether that likely reflects a healthy architecture'));
    assert.ok(report.includes('No dependency cycles detected.'));
    assert.ok(report.includes('No unresolved local imports detected.'));
    assert.ok(report.includes('Layer checks are currently inactive because boundaries.layers or boundaries.layerRules are not configured.'));
    assert.ok(report.includes('Layer checks inactive — configure boundaries.layers and boundaries.layerRules.'));
  });

  test('uses standard boundary wording when layer checks are active but no violations exist', () => {
    const graph: GraphData = {
      nodes: [makeNode('src/ui/view.ts', 40), makeNode('src/domain/model.ts', 25)],
      edges: [makeEdge('src/ui/view.ts', 'src/domain/model.ts', 4, '../domain/model')],
      generatedAt: '2026-05-21T08:00:00.000Z',
    };

    const insights: InsightSet = {
      risky: [],
      cycles: [],
      orphans: [],
      hubs: [],
      bloated: [],
      unresolved: [],
      fanOut: [],
      violations: [],
      computedAt: '2026-05-21T08:01:00.000Z',
    };

    const report = buildInsightsAgentReport({
      graph,
      insights,
      config: {
        topN: 10,
        locWarningThreshold: 500,
        locDangerThreshold: 1000,
        entryPointPatterns: ['**/extension.ts'],
        boundaries: {
          layers: [
            { name: 'ui', match: ['src/ui/**'] },
            { name: 'domain', match: ['src/domain/**'] },
          ],
          layerRules: [{ from: 'ui', canImport: ['domain'] }],
        },
      },
      metadata: {
        workspaceRoot: '/ws',
        generatedAt: '2026-05-21T08:02:00.000Z',
      },
    });

    assert.ok(report.includes('- Layer checks active: yes'));
    assert.ok(report.includes('No configured boundary violations detected.'));
    assert.ok(!report.includes('Layer checks inactive — configure boundaries.layers and boundaries.layerRules.'));
  });
});
