import * as assert from 'assert';
import { buildInsightOverlay } from '../../analysis/insightOverlay';
import { computeInsights, ComputeOptions } from '../../analysis/insightTypes';
import { GraphData, GraphEdge, GraphNode } from '../../model/graphTypes';

function makeGraph(
  specs: { id: string; loc?: number }[],
  edgeSpecs: [string, string][]
): GraphData {
  const nodes: GraphNode[] = specs.map((spec) => ({
    id: spec.id,
    path: `/ws/${spec.id}`,
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
  fileMatcher: () => false,
};

suite('InsightOverlay', () => {
  test('fan-out overlay is applied when node has high outgoing degree', () => {
    const graph = makeGraph(
      [{ id: 'src/a.ts' }, { id: 'src/b.ts' }, { id: 'src/c.ts' }],
      [['src/a.ts', 'src/b.ts'], ['src/a.ts', 'src/c.ts']]
    );
    const insights = computeInsights(graph, opts);
    const overlay = buildInsightOverlay(graph, insights, ['**/index.ts']);

    assert.strictEqual(overlay['src/a.ts'].category, 'fan-out');
    assert.ok(overlay['src/a.ts'].reason.includes('imports 2 files'));
  });

  test('cycle overlay takes precedence over hub overlay', () => {
    const graph = makeGraph(
      [{ id: 'a.ts' }, { id: 'b.ts' }, { id: 'c.ts' }, { id: 'd.ts' }],
      [['a.ts', 'b.ts'], ['b.ts', 'c.ts'], ['c.ts', 'a.ts'], ['d.ts', 'a.ts']]
    );
    const insights = computeInsights(graph, opts);
    const overlay = buildInsightOverlay(graph, insights, ['**/index.ts']);

    assert.strictEqual(overlay['a.ts'].category, 'cycle');
    assert.strictEqual(overlay['b.ts'].category, 'cycle');
    assert.strictEqual(overlay['c.ts'].category, 'cycle');
  });

  test('hub overlay takes precedence over fan-out overlay', () => {
    const graph = makeGraph(
      [{ id: 'shared.ts' }, { id: 'leaf-a.ts' }, { id: 'leaf-b.ts' }, { id: 'dep.ts' }],
      [['shared.ts', 'dep.ts'], ['leaf-a.ts', 'shared.ts'], ['leaf-b.ts', 'shared.ts']]
    );
    const insights = computeInsights(graph, opts);
    const overlay = buildInsightOverlay(graph, insights, ['**/index.ts']);

    assert.strictEqual(overlay['shared.ts'].category, 'hub');
  });

  test('entry points get overlays when not overridden by higher-severity insight', () => {
    const graph = makeGraph([{ id: 'src/index.ts' }, { id: 'src/a.ts' }], []);
    const overlay = buildInsightOverlay(graph, null, ['**/index.ts']);

    assert.strictEqual(overlay['src/index.ts'].category, 'entrypoint');
    assert.ok(!overlay['src/a.ts']);
  });
});
