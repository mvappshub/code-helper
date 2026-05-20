import * as path from 'path';
import { extractCsharpImports } from './extractors/csharp';
import { extractGoImports } from './extractors/go';
import { extractJavaImports } from './extractors/java';
import { extractJavascriptImports } from './extractors/javascript';
import { extractPythonImports } from './extractors/python';
import { extractRustImports } from './extractors/rust';
import { stripComments } from './extractors/stripComments';

export interface RawImport {
  specifier: string;
  sourceLine?: number;
}

type ExtractorFn = (content: string) => RawImport[];

const EXTRACTORS: Record<string, ExtractorFn> = {
  cjs: extractJavascriptImports,
  cs: extractCsharpImports,
  go: extractGoImports,
  java: extractJavaImports,
  js: extractJavascriptImports,
  jsx: extractJavascriptImports,
  mjs: extractJavascriptImports,
  py: extractPythonImports,
  rs: extractRustImports,
  ts: extractJavascriptImports,
  tsx: extractJavascriptImports,
};

export function extractImports(filePath: string, content: string): RawImport[] {
  const ext = path.extname(filePath).replace('.', '').toLowerCase();
  const extractor = EXTRACTORS[ext];
  if (!extractor) {
    return [];
  }
  try {
    return extractor(content);
  } catch {
    return [];
  }
}

export function resolveSpecifier(specifier: string, sourceFile: string, workspaceRoot: string): string | null {
  if (!specifier.startsWith('.') && !specifier.startsWith('/')) {
    return null;
  }

  return path.relative(workspaceRoot, path.resolve(path.dirname(sourceFile), specifier)).replace(/\\/g, '/');
}

export { stripComments };
