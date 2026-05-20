/**
 * Maps file extensions to human-readable language names.
 */

const EXT_MAP: Record<string, string> = {
  ts: 'TypeScript',
  tsx: 'TypeScript',
  js: 'JavaScript',
  jsx: 'JavaScript',
  mjs: 'JavaScript',
  cjs: 'JavaScript',
  py: 'Python',
  java: 'Java',
  cs: 'C#',
  go: 'Go',
  rs: 'Rust',
  cpp: 'C++',
  cc: 'C++',
  cxx: 'C++',
  c: 'C',
  h: 'C/C++ Header',
  hpp: 'C++ Header',
  rb: 'Ruby',
  php: 'PHP',
  swift: 'Swift',
  kt: 'Kotlin',
  scala: 'Scala',
  dart: 'Dart',
  vue: 'Vue',
  svelte: 'Svelte',
  html: 'HTML',
  css: 'CSS',
  scss: 'SCSS',
  less: 'Less',
  json: 'JSON',
  yaml: 'YAML',
  yml: 'YAML',
  md: 'Markdown',
  sh: 'Shell',
  ps1: 'PowerShell',
  r: 'R',
  lua: 'Lua',
  ex: 'Elixir',
  exs: 'Elixir',
  erl: 'Erlang',
  hs: 'Haskell',
  fs: 'F#',
  fsx: 'F#',
};

export function detectLanguage(filePath: string): string {
  if (!filePath.includes('.')) { return 'Unknown'; }
  const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
  return EXT_MAP[ext] ?? (ext.toUpperCase() || 'Unknown');
}
