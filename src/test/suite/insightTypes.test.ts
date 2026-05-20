/**
 * Unit tests for insight computation — Tarjan SCC + computeInsights.
 * Runs without DOM or VS Code runtime.
 *
 * Constitution V: computed from GraphData; no real dependencies on VS Code API.
 */

import * as assert from 'assert';
import {
  tarjanSCC,
  computeInsights,
  ComputeOptions,
} from '../../analysis/insightTypes';
import { GraphData, GraphNode, GraphEdge } from '../../model/graphTypes';
import { matchesPatterns } from '../../util/fileMatcher';

// Helper to build a minimal GraphData
function makeGraph(
  specs: { id: string; loc?: number; unresolved?: string[] }[],
  edgeSpecs: Array<[string, string] | { source: string; target: string; sourceLine?: number; specifier?: string }>
): GraphData {
  const nodes: GraphNode[] = specs.map((s) => {
    const node: GraphNode & { _unresolvedImports?: string[] } = {
      id: s.id,
      path: `/ws/${s.id}`,
      language: 'ts',
      linesOfCode: s.loc ?? 10,
      lastModified: new Date().toISOString(),
      depth: s.id.split('/').length - 1,
      label: s.id.split('/').pop() ?? s.id,
    };
    if (s.unresolved) {
      node._unresolvedImports = s.unresolved;
    }
    return node;
  });
  const edges: GraphEdge[] = edgeSpecs.map((edgeSpec) => {
    if (Array.isArray(edgeSpec)) {
      return {
        source: edgeSpec[0],
        target: edgeSpec[1],
        type: 'import' as const,
      };
    }
    return {
      source: edgeSpec.source,
      target: edgeSpec.target,
      type: 'import' as const,
      sourceLine: edgeSpec.sourceLine,
      specifier: edgeSpec.specifier,
    };
  });
  return { nodes, edges, generatedAt: new Date().toISOString() };
}

const defaultOpts: ComputeOptions = {
  topN: 10,
  locWarningThreshold: 500,
  locDangerThreshold: 1000,
  entryPointPatterns: ['**/extension.ts', '**/index.ts'],
  fileMatcher: matchesPatterns,
  boundaries: {
    maxRelativeDepth: 3,
    testPatterns: ['**/*.{test,spec}.{ts,tsx,js,jsx}', '**/test/**', '**/tests/**'],
    internalFolderNames: ['internal', '_internal', 'private'],
  },
};

// ─── Tarjan SCC ────────────────────────────────────────────────────────

suite('tarjanSCC', () => {
  test('empty graph returns no SCCs', () => {
    const sccs = tarjanSCC([], []);
    assert.strictEqual(sccs.length, 0);
  });

  test('single node, no edges returns single-node SCC (filtered by caller)', () => {
    const sccs = tarjanSCC(['a'], []);
    assert.strictEqual(sccs.length, 1);
    assert.deepStrictEqual(sccs[0], ['a']);
  });

  test('two-node cycle A↔B', () => {
    const sccs = tarjanSCC(['a', 'b'], [['a', 'b'], ['b', 'a']]);
    assert.strictEqual(sccs.length, 1);
    assert.strictEqual(sccs[0].length, 2);
    assert.ok(sccs[0].includes('a') && sccs[0].includes('b'));
  });

  test('three-way cycle A→B→C→A', () => {
    const sccs = tarjanSCC(
      ['a', 'b', 'c'],
      [['a', 'b'], ['b', 'c'], ['c', 'a']]
    );
    assert.strictEqual(sccs.length, 1);
    assert.strictEqual(sccs[0].length, 3);
    assert.ok(sccs[0].includes('a'));
    assert.ok(sccs[0].includes('b'));
    assert.ok(sccs[0].includes('c'));
  });

  test('self-loop is its own SCC', () => {
    const sccs = tarjanSCC(['a'], [['a', 'a']]);
    assert.strictEqual(sccs.length, 1);
    assert.deepStrictEqual(sccs[0], ['a']);
  });

  test('two disconnected cycles', () => {
    const sccs = tarjanSCC(
      ['a', 'b', 'c', 'd'],
      [['a', 'b'], ['b', 'a'], ['c', 'd'], ['d', 'c']]
    );
    assert.strictEqual(sccs.length, 2);
    // Each SCC should have 2 nodes
    const sizes = sccs.map((s) => s.length).sort();
    assert.deepStrictEqual(sizes, [2, 2]);
  });

  test('no cycle (DAG) returns only single-node SCCs', () => {
    const sccs = tarjanSCC(
      ['a', 'b', 'c'],
      [['a', 'b'], ['b', 'c']]
    );
    assert.strictEqual(sccs.length, 3);
    sccs.forEach((s) => assert.strictEqual(s.length, 1));
  });

  test('large DAG does not rely on recursive call stack', () => {
    const size = 12000;
    const nodes = Array.from({ length: size }, (_, i) => `n${i}`);
    const edges: [string, string][] = Array.from({ length: size - 1 }, (_, i) => [`n${i}`, `n${i + 1}`]);
    const sccs = tarjanSCC(nodes, edges);
    assert.strictEqual(sccs.length, size);
    assert.ok(sccs.every((s) => s.length === 1));
  });
});

// ─── computeInsights ────────────────────────────────────────────────────

suite('computeInsights', () => {
  test('empty graph returns empty InsightSet', () => {
    const data = makeGraph([], []);
    const result = computeInsights(data, defaultOpts);
    assert.strictEqual(result.cycles.length, 0);
    assert.strictEqual(result.orphans.length, 0);
    assert.strictEqual(result.hubs.length, 0);
    assert.strictEqual(result.bloated.length, 0);
    assert.strictEqual(result.unresolved.length, 0);
    assert.strictEqual(result.fanOut.length, 0);
    assert.strictEqual(result.risky.length, 0);
    assert.strictEqual(result.violations.length, 0);
  });

  test('cycle detection returns correct nodes', () => {
    const data = makeGraph(
      [
        { id: 'a.ts' },
        { id: 'b.ts' },
        { id: 'c.ts' },
      ],
      [['a.ts', 'b.ts'], ['b.ts', 'c.ts'], ['c.ts', 'a.ts']]
    );
    const result = computeInsights(data, defaultOpts);
    assert.strictEqual(result.cycles.length, 1);
    assert.strictEqual(result.cycles[0].severity, 'error');
    assert.strictEqual(result.cycles[0].nodes.length, 3);
    assert.strictEqual(result.cycles[0].metric, 3);
  });

  test('self-loop detected as cycle', () => {
    const data = makeGraph([{ id: 'loop.ts' }], [['loop.ts', 'loop.ts']]);
    const result = computeInsights(data, defaultOpts);
    assert.strictEqual(result.cycles.length, 1);
    assert.strictEqual(result.cycles[0].metric, 1);
    assert.ok(result.cycles[0].title.includes('Self-loop'));
  });

  test('orphan: node with in-degree 0 not matching entry-point', () => {
    const data = makeGraph(
      [{ id: 'utils/orphan.ts' }, { id: 'extension.ts' }],
      [] // no edges → orphan if not an entry point
    );
    const result = computeInsights(data, defaultOpts);
    // extension.ts IS an entry point, so only orphan.ts is orphaned
    assert.strictEqual(result.orphans.length, 1);
    assert.strictEqual(result.orphans[0].nodes[0], 'utils/orphan.ts');
  });

  test('orphan: entry-point node excluded from orphans', () => {
    const data = makeGraph([{ id: 'extension.ts' }], []);
    const result = computeInsights(data, defaultOpts);
    assert.strictEqual(result.orphans.length, 0);
  });

  test('hub ranking by in-degree descending', () => {
    const data = makeGraph(
      [
        { id: 'hub.ts' },
        { id: 'a.ts' },
        { id: 'b.ts' },
        { id: 'c.ts' },
      ],
      [['a.ts', 'hub.ts'], ['b.ts', 'hub.ts'], ['c.ts', 'hub.ts']]
    );
    const result = computeInsights(data, defaultOpts);
    assert.strictEqual(result.hubs.length, 1); // only hub.ts has in-degree > 0
    assert.strictEqual(result.hubs[0].metric, 3);
    assert.strictEqual(result.hubs[0].nodes[0], 'hub.ts');
  });

  test('fan-out ranking by outgoing degree descending', () => {
    const data = makeGraph(
      [
        { id: 'orchestrator.ts' },
        { id: 'leaf-a.ts' },
        { id: 'leaf-b.ts' },
        { id: 'leaf-c.ts' },
      ],
      [['orchestrator.ts', 'leaf-a.ts'], ['orchestrator.ts', 'leaf-b.ts'], ['orchestrator.ts', 'leaf-c.ts']]
    );
    const result = computeInsights(data, defaultOpts);
    assert.strictEqual(result.fanOut.length, 1);
    assert.strictEqual(result.fanOut[0].nodes[0], 'orchestrator.ts');
    assert.strictEqual(result.fanOut[0].metric, 3);
  });

  test('self-loop-only file is still considered an orphan and not a hub', () => {
    const data = makeGraph([{ id: 'self.ts' }], [['self.ts', 'self.ts']]);
    const result = computeInsights(data, defaultOpts);
    assert.strictEqual(result.orphans.length, 1);
    assert.strictEqual(result.orphans[0].nodes[0], 'self.ts');
    assert.strictEqual(result.hubs.length, 0);
  });

  test('bloated ranking by LOC with warning threshold', () => {
    const data = makeGraph(
      [
        { id: 'small.ts', loc: 50 },
        { id: 'big.ts', loc: 600 },
        { id: 'mega.ts', loc: 1200 },
      ],
      []
    );
    const result = computeInsights(data, defaultOpts);
    assert.strictEqual(result.bloated.length, 2);
    // sorted descending: mega.ts (1200) then big.ts (600)
    assert.strictEqual(result.bloated[0].nodes[0], 'mega.ts');
    assert.strictEqual(result.bloated[0].severity, 'error'); // >= 1000
    assert.strictEqual(result.bloated[1].nodes[0], 'big.ts');
    assert.strictEqual(result.bloated[1].severity, 'warn'); // >= 500 but < 1000
  });

  test('topN limits results', () => {
    const opts = { ...defaultOpts, topN: 2 };
    const hubNodes = Array.from({ length: 10 }, (_, i) => ({
      id: `h${i}.ts`,
    }));
    // Add some source nodes
    const allNodes = [
      ...hubNodes.map((n) => ({ id: n.id, loc: 10 })),
      ...hubNodes.map((_, i) => ({ id: `x${i}.ts`, loc: 10 })),
    ];
    // Make it work properly
    const allEdges = hubNodes.flatMap((_, i) => {
      const result: [string, string][] = [];
      for (let j = 0; j <= i; j++) {
        result.push([`x${j}.ts`, `h${i}.ts`]);
      }
      return result;
    });
    const data = makeGraph(allNodes, allEdges);
    const result = computeInsights(data, opts);
    assert.ok(result.hubs.length <= 2);
  });

  test('computedAt is ISO string', () => {
    const data = makeGraph([{ id: 'a.ts' }], []);
    const result = computeInsights(data, defaultOpts);
    assert.ok(result.computedAt);
    assert.ok(!isNaN(Date.parse(result.computedAt)));
  });

  test('unresolved imports create warning insight per node', () => {
    const data = makeGraph(
      [{ id: 'src/a.ts', unresolved: ['./missing', '../lost'] }],
      []
    );
    const result = computeInsights(data, defaultOpts);

    assert.strictEqual(result.unresolved.length, 1);
    assert.strictEqual(result.unresolved[0].category, 'unresolved');
    assert.strictEqual(result.unresolved[0].severity, 'warn');
    assert.strictEqual(result.unresolved[0].metric, 2);
    assert.ok(result.unresolved[0].description?.includes('./missing'));
  });

  test('risky modules aggregate multiple strong signals without score', () => {
    const data = makeGraph(
      [
        { id: 'src/core/risky.ts', loc: 1200 },
        { id: 'src/core/peer.ts', loc: 100 },
      ],
      [
        { source: 'src/core/risky.ts', target: 'src/core/peer.ts', sourceLine: 3, specifier: './peer' },
        { source: 'src/core/peer.ts', target: 'src/core/risky.ts', sourceLine: 5, specifier: './risky' },
      ]
    );
    const result = computeInsights(data, {
      ...defaultOpts,
      boundaries: {
        ...defaultOpts.boundaries,
        layers: [
          { name: 'core', match: ['src/core/**'] },
          { name: 'forbidden', match: ['src/core/peer.ts'] },
        ],
        layerRules: [{ from: 'core', cannotImport: ['forbidden'] }],
      },
    });

    const risky = result.risky.find((entry) => entry.nodes[0] === 'src/core/risky.ts');
    assert.ok(risky);
    assert.strictEqual(risky?.category, 'risky');
    assert.strictEqual(risky?.severity, 'error');
    assert.ok((risky?.description ?? '').includes('Part of a dependency cycle'));
    assert.ok((risky?.description ?? '').includes('Large module (1200 LOC)'));
  });

  test('layer deny rule reports ui -> db violation', () => {
    const data = makeGraph(
      [
        { id: 'src/ui/widget.ts' },
        { id: 'src/db/conn.ts' },
      ],
      [{ source: 'src/ui/widget.ts', target: 'src/db/conn.ts', sourceLine: 4, specifier: '../db/conn' }]
    );
    const result = computeInsights(data, {
      ...defaultOpts,
      boundaries: {
        ...defaultOpts.boundaries,
        layers: [
          { name: 'ui', match: ['src/ui/**'] },
          { name: 'db', match: ['src/db/**'] },
        ],
        layerRules: [{ from: 'ui', cannotImport: ['db'] }],
      },
    });

    assert.strictEqual(result.violations.filter((entry) => entry.category === 'layerViolation').length, 1);
    assert.strictEqual(result.violations[0].sourceLine, 4);
  });

  test('layer allowlist reports disallowed target', () => {
    const data = makeGraph(
      [
        { id: 'src/ui/widget.ts' },
        { id: 'src/db/conn.ts' },
      ],
      [{ source: 'src/ui/widget.ts', target: 'src/db/conn.ts', sourceLine: 2, specifier: '../db/conn' }]
    );
    const result = computeInsights(data, {
      ...defaultOpts,
      boundaries: {
        ...defaultOpts.boundaries,
        layers: [
          { name: 'ui', match: ['src/ui/**'] },
          { name: 'domain', match: ['src/domain/**'] },
          { name: 'db', match: ['src/db/**'] },
        ],
        layerRules: [{ from: 'ui', canImport: ['domain'] }],
      },
    });

    assert.strictEqual(result.violations.filter((entry) => entry.category === 'layerViolation').length, 1);
  });

  test('deep relative import uses threshold boundaries', () => {
    const data = makeGraph(
      [
        { id: 'src/a/b/c/d.ts' },
        { id: 'src/shared/foo.ts' },
      ],
      [
        { source: 'src/a/b/c/d.ts', target: 'src/shared/foo.ts', sourceLine: 3, specifier: '../../../shared/foo' },
        { source: 'src/a/b/c/d.ts', target: 'src/shared/foo.ts', sourceLine: 4, specifier: '../../../../shared/foo' },
      ]
    );
    const result = computeInsights(data, defaultOpts);

    const deepRelative = result.violations.filter((entry) => entry.category === 'deepRelative');
    assert.strictEqual(deepRelative.length, 1);
    assert.strictEqual(deepRelative[0].sourceLine, 4);
  });

  test('maxRelativeDepth zero reports any parent traversal', () => {
    const data = makeGraph(
      [
        { id: 'src/foo.ts' },
        { id: 'src/bar.ts' },
      ],
      [{ source: 'src/foo.ts', target: 'src/bar.ts', sourceLine: 1, specifier: '../bar' }]
    );
    const result = computeInsights(data, {
      ...defaultOpts,
      boundaries: {
        ...defaultOpts.boundaries,
        maxRelativeDepth: 0,
      },
    });

    assert.strictEqual(result.violations.filter((entry) => entry.category === 'deepRelative').length, 1);
  });

  test('reverse test import flags prod to test and ignores test to test', () => {
    const prodToTest = computeInsights(
      makeGraph(
        [
          { id: 'src/foo.ts' },
          { id: 'src/foo.test.ts' },
        ],
        [{ source: 'src/foo.ts', target: 'src/foo.test.ts', sourceLine: 6, specifier: './foo.test' }]
      ),
      defaultOpts
    );
    const testToTest = computeInsights(
      makeGraph(
        [
          { id: 'src/foo.test.ts' },
          { id: 'src/bar.test.ts' },
        ],
        [{ source: 'src/foo.test.ts', target: 'src/bar.test.ts', sourceLine: 2, specifier: './bar.test' }]
      ),
      defaultOpts
    );

    assert.strictEqual(prodToTest.violations.filter((entry) => entry.category === 'reverseTest').length, 1);
    assert.strictEqual(testToTest.violations.filter((entry) => entry.category === 'reverseTest').length, 0);
  });

  test('package internal violation distinguishes same package from cross package', () => {
    const crossPackage = computeInsights(
      makeGraph(
        [
          { id: 'src/feature-a/internal/util.ts' },
          { id: 'src/feature-b/index.ts' },
        ],
        [{ source: 'src/feature-b/index.ts', target: 'src/feature-a/internal/util.ts', sourceLine: 5, specifier: '../feature-a/internal/util' }]
      ),
      defaultOpts
    );
    const samePackage = computeInsights(
      makeGraph(
        [
          { id: 'src/feature-a/internal/util.ts' },
          { id: 'src/feature-a/sub.ts' },
        ],
        [{ source: 'src/feature-a/sub.ts', target: 'src/feature-a/internal/util.ts', sourceLine: 5, specifier: './internal/util' }]
      ),
      defaultOpts
    );

    assert.strictEqual(crossPackage.violations.filter((entry) => entry.category === 'packageInternal').length, 1);
    assert.strictEqual(samePackage.violations.filter((entry) => entry.category === 'packageInternal').length, 0);
  });

  test('layer collision resolves by longer glob and emits warning once', () => {
    const warnings: string[] = [];
    const result = computeInsights(
      makeGraph(
        [
          { id: 'src/ui/special/widget.ts' },
          { id: 'src/db/conn.ts' },
        ],
        [{ source: 'src/ui/special/widget.ts', target: 'src/db/conn.ts', sourceLine: 3, specifier: '../../db/conn' }]
      ),
      {
        ...defaultOpts,
        boundaries: {
          ...defaultOpts.boundaries,
          layers: [
            { name: 'generic-ui', match: ['src/ui/**'] },
            { name: 'special-ui', match: ['src/ui/special/**'] },
            { name: 'db', match: ['src/db/**'] },
          ],
          layerRules: [{ from: 'special-ui', cannotImport: ['db'] }],
        },
        warn: (_key, message) => warnings.push(message),
      }
    );

    assert.strictEqual(result.violations.filter((entry) => entry.category === 'layerViolation').length, 1);
    assert.strictEqual(warnings.length, 1);
  });
});
