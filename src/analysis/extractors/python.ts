import type { RawImport } from '../importExtractor';
import { lineNumberAt } from './shared';
import { stripComments } from './stripComments';

export function extractPythonImports(content: string): RawImport[] {
  const clean = stripComments(content, 'python');
  const results: RawImport[] = [];
  const fromImport = /^from\s+([\w.]+)\s+import/gm;
  const plainImport = /^import\s+([\w.,]+)/gm;

  let match: RegExpExecArray | null;
  while ((match = fromImport.exec(clean)) !== null) {
    results.push({
      specifier: match[1].replace(/\./g, '/'),
      sourceLine: lineNumberAt(clean, match.index),
    });
  }

  while ((match = plainImport.exec(clean)) !== null) {
    const sourceLine = lineNumberAt(clean, match.index);
    match[1].split(',').forEach((segment) => {
      const specifier = segment.trim().split(' ')[0];
      if (specifier) {
        results.push({ specifier: specifier.replace(/\./g, '/'), sourceLine });
      }
    });
  }

  return results;
}
