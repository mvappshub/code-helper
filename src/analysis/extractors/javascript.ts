import type { RawImport } from './types';
import { isWordAt, lineNumberAt, readJsString, skipJsTemplateLiteral, skipJsTrivia } from './shared';

export function extractJavascriptImports(content: string): RawImport[] {
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
    if (ch === "'" || ch === '"') { i = readJsString(content, i).end; continue; }
    if (ch === '`') { i = skipJsTemplateLiteral(content, i); continue; }

    if (isWordAt(content, i, 'require')) {
      const specifier = readCallSpecifier(content, skipJsTrivia(content, i + 'require'.length));
      if (specifier) {
        results.push({ specifier: specifier.value, sourceLine: lineNumberAt(content, i) });
        i = specifier.end;
        continue;
      }
    }

    if (isWordAt(content, i, 'import')) {
      const direct = readCallSpecifier(content, skipJsTrivia(content, i + 'import'.length));
      if (direct) {
        results.push({ specifier: direct.value, sourceLine: lineNumberAt(content, i) });
        i = direct.end;
        continue;
      }

      const inline = readInlineImport(content, skipJsTrivia(content, i + 'import'.length));
      if (inline) {
        results.push({ specifier: inline.value, sourceLine: lineNumberAt(content, i) });
        i = inline.end;
        continue;
      }
    }

    i++;
  }

  return results;
}

function readCallSpecifier(content: string, start: number) {
  if (content[start] !== '(') {
    return null;
  }
  const specifierStart = skipJsTrivia(content, start + 1);
  if (content[specifierStart] !== "'" && content[specifierStart] !== '"') {
    return null;
  }
  return readJsString(content, specifierStart);
}

function readInlineImport(content: string, start: number) {
  if (content[start] === "'" || content[start] === '"') {
    return readJsString(content, start);
  }

  let i = start;
  let depth = 0;
  while (i < content.length) {
    i = skipJsTrivia(content, i);
    const ch = content[i];
    if (ch === "'" || ch === '"') { i = readJsString(content, i).end; continue; }
    if (ch === '`') { i = skipJsTemplateLiteral(content, i); continue; }
    if (isWordAt(content, i, 'from') && depth === 0) {
      const specifierStart = skipJsTrivia(content, i + 'from'.length);
      return content[specifierStart] === "'" || content[specifierStart] === '"'
        ? readJsString(content, specifierStart)
        : null;
    }
    if ((ch === ';' || ch === '\n' || ch === '\r') && depth === 0) { return null; }
    if (ch === '{' || ch === '[' || ch === '(') { depth++; }
    if (ch === '}' || ch === ']' || ch === ')') { depth = Math.max(0, depth - 1); }
    i++;
  }
  return null;
}
