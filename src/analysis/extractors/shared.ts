export function consumeQuoted(
  content: string,
  start: number,
  quote: "'" | '"' | '`',
  options?: { allowNewlines?: boolean; raw?: boolean }
): number {
  const { allowNewlines = false, raw = false } = options ?? {};
  let i = start + 1;

  while (i < content.length) {
    const ch = content[i];
    if (ch === quote) {
      return i + 1;
    }
    if (!raw && ch === '\\') {
      i += 2;
      continue;
    }
    if (!allowNewlines && (ch === '\n' || ch === '\r')) {
      return i;
    }
    i++;
  }

  return i;
}

export function isIdentifierChar(ch: string | undefined): boolean {
  return typeof ch === 'string' && /[A-Za-z0-9_$]/.test(ch);
}

export function isWordAt(content: string, index: number, word: string): boolean {
  return content.startsWith(word, index)
    && !isIdentifierChar(content[index - 1])
    && !isIdentifierChar(content[index + word.length]);
}

export function skipJsTrivia(content: string, start: number): number {
  let i = start;
  while (i < content.length) {
    const ch = content[i];
    const next = content[i + 1];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
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
    break;
  }
  return i;
}

export function readJsString(content: string, start: number): { value: string; end: number } {
  const quote = content[start] as "'" | '"';
  let value = '';
  let i = start + 1;

  while (i < content.length) {
    const ch = content[i];
    if (ch === quote) {
      return { value, end: i + 1 };
    }
    if (ch === '\\' && i + 1 < content.length) {
      value += content[i + 1];
      i += 2;
      continue;
    }
    if (ch === '\n' || ch === '\r') {
      return { value, end: i };
    }
    value += ch;
    i++;
  }

  return { value, end: i };
}

export function skipJsTemplateLiteral(content: string, start: number): number {
  let i = start + 1;
  while (i < content.length) {
    if (content[i] === '`') {
      return i + 1;
    }
    if (content[i] === '\\' && i + 1 < content.length) {
      i += 2;
      continue;
    }
    i++;
  }
  return i;
}

export function lineNumberAt(content: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < content.length; i++) {
    if (content[i] === '\n') {
      line++;
    }
  }
  return line;
}
