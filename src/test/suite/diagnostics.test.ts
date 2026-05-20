import * as assert from 'assert';
import { insightSetToDiagnostics } from '../../analysis/diagnostics';
import { computeInsights, ComputeOptions } from '../../analysis/insightTypes';
import { GraphData, GraphEdge, GraphNode } from '../../model/graphTypes';
import { matchesPatterns } from '../../util/fileMatcher';

function makeGraph(
  specs: { id: string; loc?: number }[],
  edgeSpecs: [string, string][]
): GraphData {
  const nodes: GraphNode[] = specs.map((spec) => ({
    id: spec.id,
    path: `C:/ws/${spec.id}`,
    language: 'ts',
    linesOfCode: spec.loc ?? 10,
    lastModified: new Date().toISOString(),
    depth: spec.id.split('/').length - 1,
    label: spec.id.split('/').pop() ?? spec.id,
  }));
  const edges: GraphEdge[] = edgeSpecs.map(([source, target]) => ({
    source,
    target,
    type: 'import',
  }));
  return { nodes, edges, generatedAt: new Date().toISOString() };
}

const opts: ComputeOptions = {
  topN: 10,
  locWarningThreshold: 500,
  locDangerThreshold: 1000,
  entryPointPatterns: ['**/extension.ts', '**/index.ts'],
  fileMatcher: matchesPatterns,
  boundaries: {
    maxRelativeDepth: 3,
    testPatterns: ['**/*.{test,spec}.{ts,tsx,js,jsx}', '**/test/**', '**/tests/**'],
    internalFolderNames: ['internal'],
  },
};

suite('Diagnostics', () => {
  test('emits one warning per cycle-participating file and per danger-bloated file', () => {
    const graph = makeGraph(
      [
        { id: 'a.ts' },
        { id: 'b.ts' },
        { id: 'c.ts' },
        { id: 'mega.ts', loc: 1200 },
      ],
      [['a.ts', 'b.ts'], ['b.ts', 'c.ts'], ['c.ts', 'a.ts']]
    );
    const insights = computeInsights(graph, opts);
    const payload = insightSetToDiagnostics(insights, graph, 1000);

    assert.strictEqual(payload.size, 4);
    const diagnostics = Array.from(payload.values()).flat();
    assert.strictEqual(diagnostics.filter((diag) => diag.code === 'arch.cycle').length, 3);
    assert.strictEqual(diagnostics.filter((diag) => diag.code === 'arch.bloated').length, 1);
  });

  test('returns empty payload when there are no architectural warnings', () => {
    const graph = makeGraph([{ id: 'clean.ts', loc: 20 }], []);
    const insights = computeInsights(graph, opts);
    const payload = insightSetToDiagnostics(insights, graph, 1000);

    assert.strictEqual(payload.size, 0);
  });

  test('emits diagnostics for boundary violations with line numbers', () => {
    const graph = makeGraph(
      [
        { id: 'src/foo.ts' },
        { id: 'src/foo.test.ts' },
      ],
      []
    );
    graph.edges.push({
      source: 'src/foo.ts',
      target: 'src/foo.test.ts',
      type: 'import',
      sourceLine: 7,
      specifier: './foo.test',
    });

    const insights = computeInsights(graph, opts);
    const payload = insightSetToDiagnostics(insights, graph, 1000);
    const diagnostics = payload.get('C:/ws/src/foo.ts') ?? [];

    assert.strictEqual(diagnostics.length, 1);
    assert.strictEqual(diagnostics[0].code, 'arch.reverseTest');
    assert.strictEqual(diagnostics[0].line, 7);
  });
});
