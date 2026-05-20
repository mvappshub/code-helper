import type { RawImport } from './types';
import { consumeQuoted, isWordAt, lineNumberAt } from './shared';

export function extractGoImports(content: string): RawImport[] {
  const results: RawImport[] = [];
  let i = 0;

  while (i < content.length) {
    const ch = content[i];
    const next = content[i + 1];

    if (ch === '/' && next === '/') {
      i += 2;
      while (i < content.length && content[i] !== '\n' && content[i] !== '\r') { i++; }
      continue;
    }
    if (ch === '/' && next === '*') {
      i += 2;
      while (i + 1 < content.length && !(content[i] === '*' && content[i + 1] === '/')) { i++; }
      i = i + 1 < content.length ? i + 2 : content.length;
      continue;
    }
    if (ch === '"' || ch === "'") { i = consumeQuoted(content, i, ch as '"' | "'", { allowNewlines: false }); continue; }
    if (ch === '`') { i = consumeQuoted(content, i, '`', { allowNewlines: true, raw: true }); continue; }

    if (isWordAt(content, i, 'import')) {
      i = readGoImport(content, i + 'import'.length, results);
      continue;
    }

    i++;
  }

  return results;
}

function readGoImport(content: string, start: number, results: RawImport[]): number {
  let i = start;
  while (i < content.length && /\s/.test(content[i])) { i++; }

  if (content[i] === '(') {
    i++;
    while (i < content.length && content[i] !== ')') {
      if (content[i] === '/' && content[i + 1] === '/') {
        i += 2;
        while (i < content.length && content[i] !== '\n' && content[i] !== '\r') { i++; }
        continue;
      }
      if (content[i] === '/' && content[i + 1] === '*') {
        i += 2;
        while (i + 1 < content.length && !(content[i] === '*' && content[i + 1] === '/')) { i++; }
        i = i + 1 < content.length ? i + 2 : content.length;
        continue;
      }
      if (content[i] === '"' || content[i] === '`') {
        const end = consumeQuoted(content, i, content[i] as '"' | '`', { allowNewlines: content[i] === '`', raw: content[i] === '`' });
        results.push({
          specifier: content.slice(i + 1, end - 1),
          sourceLine: lineNumberAt(content, i),
        });
        i = end;
        continue;
      }
      i++;
    }
    return i;
  }

  while (i < content.length && !/["'`\n\r]/.test(content[i])) { i++; }
  if (content[i] === '"' || content[i] === '`') {
    const end = consumeQuoted(content, i, content[i] as '"' | '`', { allowNewlines: content[i] === '`', raw: content[i] === '`' });
    results.push({
      specifier: content.slice(i + 1, end - 1),
      sourceLine: lineNumberAt(content, i),
    });
    return end;
  }

  return i;
}
