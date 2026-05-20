function pushWhitespacePreservingNewlines(out: string[], text: string): void {
  for (const ch of text) {
    out.push(ch === '\n' || ch === '\r' ? ch : ' ');
  }
}

function consumePythonTripleQuoted(content: string, start: number, quote: "'" | '"'): number {
  let i = start + 3;
  while (i + 2 < content.length) {
    if (content[i] === quote && content[i + 1] === quote && content[i + 2] === quote) {
      return i + 3;
    }
    i++;
  }
  return content.length;
}

export function stripComments(
  content: string,
  language: 'js-like' | 'python' | 'c-like' | 'go'
): string {
  const out: string[] = [];
  let i = 0;

  while (i < content.length) {
    const ch = content[i];
    const next = content[i + 1] ?? '';
    const next2 = content[i + 2] ?? '';

    if (language !== 'python' && ch === '/' && next === '/') {
      const start = i;
      while (i < content.length && content[i] !== '\n' && content[i] !== '\r') { i++; }
      pushWhitespacePreservingNewlines(out, content.slice(start, i));
      continue;
    }
    if (language === 'python' && ch === '#') {
      const start = i;
      while (i < content.length && content[i] !== '\n' && content[i] !== '\r') { i++; }
      pushWhitespacePreservingNewlines(out, content.slice(start, i));
      continue;
    }
    if (ch === '/' && next === '*') {
      const start = i;
      i += 2;
      while (i + 1 < content.length && !(content[i] === '*' && content[i + 1] === '/')) { i++; }
      i = i + 1 < content.length ? i + 2 : content.length;
      pushWhitespacePreservingNewlines(out, content.slice(start, i));
      continue;
    }
    if (language === 'python' && ch === next && next === next2 && (ch === "'" || ch === '"')) {
      const end = consumePythonTripleQuoted(content, i, ch);
      pushWhitespacePreservingNewlines(out, content.slice(i, end));
      i = end;
      continue;
    }
    if ((ch === "'" || ch === '"') && (language === 'js-like' || language === 'python' || language === 'c-like' || language === 'go')) {
      let end = i + 1;
      while (end < content.length) {
        if (content[end] === ch) { end++; break; }
        if (language !== 'python' && content[end] === '\\') { end += 2; continue; }
        if (language !== 'python' && (content[end] === '\n' || content[end] === '\r')) { break; }
        end++;
      }
      pushWhitespacePreservingNewlines(out, content.slice(i, end));
      i = end;
      continue;
    }
    if ((language === 'js-like' || language === 'go') && ch === '`') {
      let end = i + 1;
      while (end < content.length) {
        if (content[end] === '`') { end++; break; }
        if (content[end] === '\\') { end += 2; continue; }
        end++;
      }
      pushWhitespacePreservingNewlines(out, content.slice(i, end));
      i = end;
      continue;
    }

    out.push(ch);
    i++;
  }

  return out.join('');
}
