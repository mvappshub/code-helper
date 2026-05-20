/**
 * Unit tests for the import extractor — runs without DOM or VS Code runtime.
 * Constitution IV: analysis layer must be independently testable.
 */

import * as assert from 'assert';
import { extractImports, resolveSpecifier, stripComments } from '../../analysis/importExtractor';

suite('ImportExtractor', () => {
  // ─── TypeScript / JavaScript ───────────────────────────────────────────
  suite('TypeScript imports', () => {
    test('ES6 static import', () => {
      const src = `import { foo } from './utils/bar';`;
      const result = extractImports('file.ts', src);
      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0].specifier, './utils/bar');
      assert.strictEqual(result[0].sourceLine, 1);
    });

    test('CommonJS require', () => {
      const src = `const x = require('../lib/helper');`;
      const result = extractImports('file.js', src);
      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0].specifier, '../lib/helper');
    });

    test('Dynamic import', () => {
      const src = `const mod = await import('./lazy/module');`;
      const result = extractImports('file.ts', src);
      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0].specifier, './lazy/module');
    });

    test('External package returns nothing resolvable', () => {
      const src = `import React from 'react';`;
      const result = extractImports('file.tsx', src);
      assert.strictEqual(result.length, 1);
      // specifier is 'react' (external) — resolveSpecifier should return null
      const resolved = resolveSpecifier(result[0].specifier, '/ws/src/App.tsx', '/ws');
      assert.strictEqual(resolved, null);
    });

    test('Multiple imports in one file', () => {
      const src = `
        import A from './a';
        import B from './b';
        const c = require('./c');
      `;
      const result = extractImports('file.ts', src);
      assert.strictEqual(result.length, 3);
      assert.deepStrictEqual(result.map((entry) => entry.sourceLine), [2, 3, 4]);
    });
  });

  // ─── Python ────────────────────────────────────────────────────────────
  suite('Python imports', () => {
    test('from x import y', () => {
      const src = `from utils.helpers import something`;
      const result = extractImports('script.py', src);
      assert.ok(result.some((r) => r.specifier === 'utils/helpers'));
    });

    test('plain import', () => {
      const src = `import os\nimport sys`;
      const result = extractImports('script.py', src);
      assert.ok(result.some((r) => r.specifier === 'os'));
      assert.ok(result.some((r) => r.specifier === 'sys'));
    });
  });

  // ─── Java ──────────────────────────────────────────────────────────────
  suite('Java imports', () => {
    test('standard import', () => {
      const src = `import com.example.service.UserService;`;
      const result = extractImports('Main.java', src);
      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0].specifier, 'com/example/service/UserService');
    });
  });

  // ─── Unsupported extension ────────────────────────────────────────────
  suite('Unsupported extension', () => {
    test('returns empty array gracefully', () => {
      const result = extractImports('file.xyz', 'some content');
      assert.deepStrictEqual(result, []);
    });
  });

  // ─── Comment-stripping false-positive fixes (F-1..F-4) ──────────────
  suite('Comment-stripping false positives', () => {
    test('stripComments: JS double-quoted literal content is removed', () => {
      const stripped = stripComments('const msg = "import x from \\"./fake-path\\"";', 'js-like');
      assert.ok(!stripped.includes('./fake-path'));
    });

    test('stripComments: JS single-quoted literal content is removed', () => {
      const stripped = stripComments("const msg = 'require(\"./fake-path\")';", 'js-like');
      assert.ok(!stripped.includes('./fake-path'));
    });

    // F-1: Go — string literal inside function body must NOT emit edge
    test('Go: string literal inside function body is not an import', () => {
      const src = `package main

import (
	"fmt"
	"os"
)

func main() {
	s := "this is not an import"
	fmt.Println(s)
}`;
      const result = extractImports('main.go', src);
      // Only "fmt" and "os" from the import block should be detected
      assert.strictEqual(result.length, 2);
      assert.ok(result.some((r) => r.specifier === 'fmt'));
      assert.ok(result.some((r) => r.specifier === 'os'));
      // "this is not an import" must NOT appear
      assert.ok(!result.some((r) => r.specifier === 'this is not an import'));
    });

    // F-2: Python — '# import os' comment must NOT emit edge
    test('Python: commented-out import is ignored', () => {
      const src = `# import os
import sys`;
      const result = extractImports('script.py', src);
      assert.ok(!result.some((r) => r.specifier === 'os'), '"os" from comment line must not be extracted');
      assert.ok(result.some((r) => r.specifier === 'sys'), 'sys should still be detected');
    });

    // F-3: Java — block-commented import must NOT emit edge
    test('Java: block-commented import is ignored', () => {
      const src = `/* import com.old.lib.Deprecated; */
import com.example.service.UserService;`;
      const result = extractImports('Main.java', src);
      assert.ok(!result.some((r) => r.specifier === 'com/old/lib/Deprecated'), 'block-commented import must be ignored');
      assert.ok(result.some((r) => r.specifier === 'com/example/service/UserService'), 'real import must be detected');
    });

    // F-4: JS/TS — import inside JSDoc @example block must NOT emit edge
    test('TypeScript: import in JSDoc @example is ignored', () => {
      const src = `/**
 * @example
 * \`\`\`ts
 * import { foo } from './fake-dep';
 * \`\`\`
 */
import { bar } from './real-dep';`;
      const result = extractImports('file.ts', src);
      assert.ok(!result.some((r) => r.specifier === './fake-dep'), '@example import must be ignored');
      assert.ok(result.some((r) => r.specifier === './real-dep'), 'real import must be detected');
    });

    // F-4: JS/TS — import inside template literal must NOT emit edge
    test('TypeScript: import in template literal is ignored', () => {
      const src = 'const code = `import { x } from "./bogus"`;\nimport { real } from "./actual";';
      const result = extractImports('file.ts', src);
      assert.ok(!result.some((r) => r.specifier === './bogus'), 'template literal import must be ignored');
      assert.ok(result.some((r) => r.specifier === './actual'), 'real import must be detected');
    });

    test('TypeScript: import text inside double-quoted string is ignored', () => {
      const src = 'const msg = "Failed: import x from \\"./bogus\\"";\nimport { real } from "./actual";';
      const result = extractImports('file.ts', src);
      assert.ok(!result.some((r) => r.specifier === './bogus'), 'double-quoted string import must be ignored');
      assert.ok(result.some((r) => r.specifier === './actual'), 'real import must be detected');
    });

    test('TypeScript: require text inside single-quoted string is ignored', () => {
      const src = "const msg = 'load with require(\"./bogus\")';\nconst real = require('./actual');";
      const result = extractImports('file.ts', src);
      assert.ok(!result.some((r) => r.specifier === './bogus'), 'single-quoted string require must be ignored');
      assert.ok(result.some((r) => r.specifier === './actual'), 'real require must be detected');
    });
  });

  // ─── resolveSpecifier ─────────────────────────────────────────────────
  suite('resolveSpecifier', () => {
    test('relative path resolved correctly', () => {
      const resolved = resolveSpecifier('./utils/helper', '/ws/src/index.ts', '/ws');
      assert.strictEqual(resolved, 'src/utils/helper');
    });

    test('external package returns null', () => {
      const resolved = resolveSpecifier('lodash', '/ws/src/index.ts', '/ws');
      assert.strictEqual(resolved, null);
    });
  });
});
