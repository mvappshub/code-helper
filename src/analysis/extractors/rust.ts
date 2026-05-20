import type { RawImport } from './types';
import { lineNumberAt } from './shared';

export function extractRustImports(content: string): RawImport[] {
  const results: RawImport[] = [];
  const re = /^(?:use|mod|extern crate)\s+([\w:]+)/gm;

  let match: RegExpExecArray | null;
  while ((match = re.exec(content)) !== null) {
    results.push({
      specifier: match[1].replace(/::/g, '/'),
      sourceLine: lineNumberAt(content, match.index),
    });
  }

  return results;
}
