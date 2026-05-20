/**
 * Unit tests for GraphBuilder — no VS Code runtime required.
 * Constitution IV: analysis layer must be testable without DOM or Webview.
 */

import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { GraphBuilder } from '../../analysis/graphBuilder';
import { ResolvedScanConfig } from '../../analysis/scanPolicy';
import { GraphNode } from '../../model/graphTypes';

// Minimal stub logger
const stubLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  refreshSettings: () => {},
};

function writeTempFiles(
  dir: string,
  files: Record<string, string>
): void {
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, 'utf8');
  }
}

function makeConfig(tmpDir: string, overrides: Partial<ResolvedScanConfig> = {}): ResolvedScanConfig {
  return {
    workspaceRoot: tmpDir,
    includePatterns: ['**/*.ts', '**/*.js'],
    excludePatterns: [],
    maxDepth: 5,
    maxFileLOC: 5000,
    includeOverridesExcludes: false,
    ...overrides,
  };
}

suite('GraphBuilder', () => {
  let tmpDir: string;

  setup(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'arch-test-'));
  });

  teardown(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('fullScan: creates nodes for each file', () => {
    writeTempFiles(tmpDir, {
      'src/index.ts': `import { foo } from './foo';`,
      'src/foo.ts': `export const foo = 1;`,
    });

    const builder = new GraphBuilder(stubLogger as never);
    const data = builder.fullScan(
      [path.join(tmpDir, 'src/index.ts'), path.join(tmpDir, 'src/foo.ts')],
      makeConfig(tmpDir)
    );

    assert.strictEqual(data.nodes.length, 2);
    const ids = data.nodes.map((n) => n.id);
    assert.ok(ids.includes('src/index.ts'));
    assert.ok(ids.includes('src/foo.ts'));
  });

  test('fullScan: linesOfCode is accurate', () => {
    writeTempFiles(tmpDir, {
      'a.ts': 'line1\nline2\nline3\n',
    });

    const builder = new GraphBuilder(stubLogger as never);
    const data = builder.fullScan(
      [path.join(tmpDir, 'a.ts')],
      makeConfig(tmpDir)
    );
    const node = data.nodes.find((n) => n.id === 'a.ts');
    assert.ok(node);
    // 'line1\nline2\nline3\n'.split('\n') → 4 elements (trailing empty)
    assert.strictEqual(node.linesOfCode, 4);
  });

  test('fullScan: detects import edge between two files', () => {
    writeTempFiles(tmpDir, {
      'src/a.ts': `import { b } from './b';`,
      'src/b.ts': `export const b = 2;`,
    });

    const builder = new GraphBuilder(stubLogger as never);
    const data = builder.fullScan(
      [path.join(tmpDir, 'src/a.ts'), path.join(tmpDir, 'src/b.ts')],
      makeConfig(tmpDir)
    );

    assert.ok(
      data.edges.some(
        (e) => e.source === 'src/a.ts' && e.target === 'src/b.ts' && e.type === 'import'
      ),
      `Expected edge src/a.ts → src/b.ts. Got: ${JSON.stringify(data.edges)}`
    );
  });

  test('fullScan: propagates sourceLine and raw specifier onto edges', () => {
    writeTempFiles(tmpDir, {
      'src/a.ts': `const x = 1;\nimport { b } from './b';\n`,
      'src/b.ts': `export const b = 2;\n`,
    });

    const builder = new GraphBuilder(stubLogger as never);
    const data = builder.fullScan(
      [path.join(tmpDir, 'src/a.ts'), path.join(tmpDir, 'src/b.ts')],
      makeConfig(tmpDir)
    );

    const edge = data.edges.find((entry) => entry.source === 'src/a.ts' && entry.target === 'src/b.ts');
    assert.ok(edge);
    assert.strictEqual(edge?.sourceLine, 2);
    assert.strictEqual(edge?.specifier, './b');
  });

  test('updateFile: incremental update changes linesOfCode', () => {
    const filePath = path.join(tmpDir, 'x.ts');
    fs.writeFileSync(filePath, 'a\nb\n', 'utf8');

    const builder = new GraphBuilder(stubLogger as never);
    builder.fullScan([filePath], makeConfig(tmpDir));

    // Now change the file
    fs.writeFileSync(filePath, 'a\nb\nc\nd\n', 'utf8');
    const updated = builder.updateFile(filePath, makeConfig(tmpDir));

    const node = updated.nodes.find((n) => n.id === 'x.ts');
    assert.ok(node);
    assert.strictEqual(node.linesOfCode, 5);
  });

  test('removeFile: node and its edges are gone', () => {
    writeTempFiles(tmpDir, {
      'src/a.ts': `import { b } from './b';`,
      'src/b.ts': `export const b = 2;`,
    });

    const builder = new GraphBuilder(stubLogger as never);
    builder.fullScan(
      [path.join(tmpDir, 'src/a.ts'), path.join(tmpDir, 'src/b.ts')],
      makeConfig(tmpDir)
    );

    const after = builder.removeFile(path.join(tmpDir, 'src/b.ts'), tmpDir);
    assert.ok(!after.nodes.some((n) => n.id === 'src/b.ts'));
    assert.ok(!after.edges.some((e) => e.target === 'src/b.ts'));
  });

  test('Constitution V: all nodes have required schema fields', () => {
    writeTempFiles(tmpDir, { 'z.ts': 'const x = 1;\n' });
    const builder = new GraphBuilder(stubLogger as never);
    const data = builder.fullScan(
      [path.join(tmpDir, 'z.ts')],
      makeConfig(tmpDir)
    );
    const n = data.nodes[0];
    assert.ok(typeof n.id === 'string', 'id');
    assert.ok(typeof n.path === 'string', 'path');
    assert.ok(typeof n.language === 'string', 'language');
    assert.ok(typeof n.linesOfCode === 'number', 'linesOfCode');
    assert.ok(typeof n.lastModified === 'string', 'lastModified');
    assert.ok(typeof n.depth === 'number', 'depth');
    assert.ok(typeof n.label === 'string', 'label');
  });

  test('fullScan: excludes generated files by marker', () => {
    writeTempFiles(tmpDir, {
      'src/types.generated.ts': '// @generated\nexport const x = 1;\n',
      'src/real.ts': 'export const y = 2;\n',
    });

    const builder = new GraphBuilder(stubLogger as never);
    const data = builder.fullScan(
      [path.join(tmpDir, 'src/types.generated.ts'), path.join(tmpDir, 'src/real.ts')],
      makeConfig(tmpDir)
    );

    assert.strictEqual(data.nodes.length, 1);
    assert.strictEqual(data.nodes[0].id, 'src/real.ts');
  });

  test('fullScan: excludes files above maxFileLOC', () => {
    writeTempFiles(tmpDir, {
      'src/huge.ts': `${Array.from({ length: 6000 }, (_, i) => `line${i}`).join('\n')}\n`,
      'src/real.ts': 'export const y = 2;\n',
    });

    const builder = new GraphBuilder(stubLogger as never);
    const data = builder.fullScan(
      [path.join(tmpDir, 'src/huge.ts'), path.join(tmpDir, 'src/real.ts')],
      makeConfig(tmpDir, { maxFileLOC: 5000 })
    );

    assert.deepStrictEqual(data.nodes.map((node) => node.id), ['src/real.ts']);
  });

  test('fullScan: excludes files with very long first line', () => {
    writeTempFiles(tmpDir, {
      'src/minified.ts': `${'x'.repeat(5001)}\nexport const x = 1;\n`,
      'src/real.ts': 'export const y = 2;\n',
    });

    const builder = new GraphBuilder(stubLogger as never);
    const data = builder.fullScan(
      [path.join(tmpDir, 'src/minified.ts'), path.join(tmpDir, 'src/real.ts')],
      makeConfig(tmpDir)
    );

    assert.deepStrictEqual(data.nodes.map((node) => node.id), ['src/real.ts']);
  });

  test('fullScan: explicit include wins over generated and exclude heuristics', () => {
    writeTempFiles(tmpDir, {
      'src/test/suite/fixtures/cyclic-project/a.ts': '// @generated\nexport const a = 1;\n',
    });

    const absPath = path.join(tmpDir, 'src/test/suite/fixtures/cyclic-project/a.ts');
    const builder = new GraphBuilder(stubLogger as never);
    const data = builder.fullScan(
      [absPath],
      makeConfig(tmpDir, {
        includePatterns: ['**/fixtures/**/*.ts'],
        excludePatterns: ['**/fixtures/**'],
        includeOverridesExcludes: true,
      })
    );

    assert.strictEqual(data.nodes.length, 1);
    assert.strictEqual(data.nodes[0].id, 'src/test/suite/fixtures/cyclic-project/a.ts');
  });

  test('fullScan: preserves self-loop imports for cycle detection', () => {
    writeTempFiles(tmpDir, {
      'src/self.ts': `import './self';\nexport const self = true;\n`,
    });

    const absPath = path.join(tmpDir, 'src/self.ts');
    const builder = new GraphBuilder(stubLogger as never);
    const data = builder.fullScan([absPath], makeConfig(tmpDir));

    assert.ok(data.edges.some((edge) => edge.source === 'src/self.ts' && edge.target === 'src/self.ts'));
  });

  test('fullScan: stores unresolved local imports and ignores external packages', () => {
    writeTempFiles(tmpDir, {
      'src/a.ts': `import './missing';\nimport helper from 'lodash';\nexport const a = helper;\n`,
    });

    const absPath = path.join(tmpDir, 'src/a.ts');
    const builder = new GraphBuilder(stubLogger as never);
    const data = builder.fullScan([absPath], makeConfig(tmpDir));

    const node = data.nodes.find((entry) => entry.id === 'src/a.ts') as GraphNode & {
      _unresolvedImports?: string[];
    };
    assert.ok(node);
    assert.deepStrictEqual(node._unresolvedImports, ['./missing']);
  });
});
