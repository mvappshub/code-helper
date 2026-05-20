import * as assert from 'assert';
import { matchesAnyPattern, matchesPatterns } from '../../util/fileMatcher';

suite('FileMatcher', () => {
  test('matches simple extension glob', () => {
    assert.ok(matchesPatterns('/ws/src/app.ts', ['**/*.ts'], ['**/node_modules/**']));
  });

  test('excludes node_modules', () => {
    assert.ok(!matchesPatterns('/ws/node_modules/lodash/index.ts', ['**/*.ts'], ['**/node_modules/**']));
  });

  test('excludes dist', () => {
    assert.ok(!matchesPatterns('/ws/dist/bundle.js', ['**/*.js'], ['**/dist/**']));
  });

  test('non-matching extension returns false', () => {
    assert.ok(!matchesPatterns('/ws/src/app.css', ['**/*.ts'], []));
  });

  test('supports brace expansion globs', () => {
    assert.ok(matchesAnyPattern('/ws/src/types.generated.ts', ['**/*.generated.{ts,js}']));
    assert.ok(matchesAnyPattern('/ws/src/main.go', ['**/main.{py,go,rs}']));
  });

  test('include precedence can override excludes', () => {
    assert.ok(matchesPatterns('/ws/src/test/fixtures/a.ts', ['**/fixtures/**/*.ts'], ['**/fixtures/**'], true));
  });
});
