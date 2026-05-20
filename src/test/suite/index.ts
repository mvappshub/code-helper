import * as path from 'path';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const Mocha = require('mocha') as typeof import('mocha');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const glob = require('glob') as { sync: (pattern: string, opts: { cwd: string }) => string[] };

export function run(): Promise<void> {
  const mocha = new Mocha({ ui: 'tdd', color: true, timeout: 10000 });
  const testsRoot = path.resolve(__dirname, '.');

  return new Promise((resolve, reject) => {
    try {
      const files = glob.sync('**/*.test.js', { cwd: testsRoot });
      files.forEach((f: string) => mocha.addFile(path.resolve(testsRoot, f)));
      mocha.run((failures: number) => {
        if (failures > 0) {
          reject(new Error(`${failures} tests failed.`));
        } else {
          resolve();
        }
      });
    } catch (e) {
      reject(e);
    }
  });
}
