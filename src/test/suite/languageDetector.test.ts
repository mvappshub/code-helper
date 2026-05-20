import * as assert from 'assert';
import { detectLanguage } from '../../analysis/languageDetector';

suite('LanguageDetector', () => {
  const cases: [string, string][] = [
    ['app.ts', 'TypeScript'],
    ['index.tsx', 'TypeScript'],
    ['main.js', 'JavaScript'],
    ['server.py', 'Python'],
    ['Main.java', 'Java'],
    ['Program.cs', 'C#'],
    ['main.go', 'Go'],
    ['lib.rs', 'Rust'],
    ['unknown.xyz', 'XYZ'],
    ['no-extension', 'Unknown'],
  ];

  for (const [file, expected] of cases) {
    test(`${file} → ${expected}`, () => {
      assert.strictEqual(detectLanguage(file), expected);
    });
  }
});
