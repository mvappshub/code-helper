/**
 * Minimatch-free glob-like pattern matching using VS Code's built-in
 * RelativePattern + workspace.findFiles so we stay in the extension host
 * without extra npm dependencies.
 *
 * For synchronous post-watcher filtering we use a simple manual check.
 */

import * as path from 'path';

function expandBraces(pattern: string): string[] {
  const match = pattern.match(/\{([^{}]+)\}/);
  if (!match) { return [pattern]; }

  const [token, body] = match;
  return body.split(',').flatMap((part) => {
    const next = pattern.replace(token, part);
    return expandBraces(next);
  });
}

function globToRegExp(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .split('**/')
    .join('__GLOBSTAR_DIR__')
    .split('**')
    .join('__GLOBSTAR__')
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '[^/]')
    .split('__GLOBSTAR_DIR__')
    .join('(?:.*/)?')
    .split('__GLOBSTAR__')
    .join('.*');
  return new RegExp(`^${escaped}$`);
}

export function matchesAnyPattern(filePath: string, patterns: string[]): boolean {
  const normalised = filePath.replace(/\\/g, '/');
  const basename = path.basename(normalised);

  return patterns.some((pattern) =>
    expandBraces(pattern).some((expanded) => {
      const re = globToRegExp(expanded);
      return re.test(normalised) || re.test(basename);
    })
  );
}

/**
 * Returns true if `filePath` matches at least one include pattern
 * and matches none of the exclude patterns.
 * Patterns use the subset: ** (any depth), * (any segment), ? (one char).
 */
export function matchesPatterns(
  filePath: string,
  includePatterns: string[],
  excludePatterns: string[],
  includeWins = false
): boolean {
  const included = matchesAnyPattern(filePath, includePatterns);
  if (!included) { return false; }
  if (includeWins) { return true; }
  const excluded = matchesAnyPattern(filePath, excludePatterns);
  return !excluded;
}
