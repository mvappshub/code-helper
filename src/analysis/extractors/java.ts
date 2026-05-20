import type { RawImport } from '../importExtractor';
import { lineNumberAt } from './shared';
import { stripComments } from './stripComments';

export function extractJavaImports(content: string): RawImport[] {
  const clean = stripComments(content, 'c-like');
  const results: RawImport[] = [];
  const re = /^import\s+(?:static\s+)?([\w.]+)\s*;/gm;

  let match: RegExpExecArray | null;
  while ((match = re.exec(clean)) !== null) {
    results.push({
      specifier: match[1].replace(/\./g, '/'),
      sourceLine: lineNumberAt(clean, match.index),
    });
  }

  return results;
}
