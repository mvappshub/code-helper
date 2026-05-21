import * as assert from 'assert';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const Module: any = require('module');
const originalLoad = Module._load;

Module._load = function patchedLoad(request: string, parent: unknown, isMain: boolean): unknown {
  if (request === 'vscode') {
    return {
      Uri: {
        file: (fsPath: string) => ({ fsPath }),
        joinPath: (base: { fsPath?: string }, ...parts: string[]) => ({
          fsPath: [base.fsPath ?? '', ...parts].join('/'),
        }),
      },
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { InsightsViewProvider } = require('../../webview/insightsViewProvider');

suite('InsightsViewProvider', () => {
  teardown(() => {
    Module._load = originalLoad;
  });

  test('posts boundary summary in updateInsights payload', async () => {
    const posted: unknown[] = [];
    const webview = {
      cspSource: 'vscode-webview://test',
      html: '',
      options: {},
      postMessage: async (message: unknown) => {
        posted.push(message);
        return true;
      },
      onDidReceiveMessage: () => ({ dispose() {} }),
    };

    const view = { webview };

    const provider = new InsightsViewProvider(
      { extensionUri: { fsPath: 'C:/extension' } } as never,
      { info() {}, debug() {} } as never,
      () => {}
    );

    provider.resolveWebviewView(view as never, {} as never, {} as never);

    const insights = {
      risky: [],
      cycles: [],
      orphans: [],
      hubs: [],
      bloated: [],
      unresolved: [],
      fanOut: [],
      violations: [],
      computedAt: '2026-05-21T08:01:00.000Z',
    };

    const config = {
      topN: 10,
      locWarning: 500,
      locDanger: 1000,
      entryPointPatterns: ['**/extension.ts'],
      boundaries: {
        layerCount: 0,
        ruleCount: 0,
        layerChecksActive: false,
      },
    };

    provider.update(insights, config);
    await new Promise((resolve) => setImmediate(resolve));

    assert.strictEqual(posted.length, 1);
    assert.deepStrictEqual(posted[0], {
      type: 'updateInsights',
      data: insights,
      config: {
        topN: 10,
        locWarning: 500,
        locDanger: 1000,
        entryPointPatterns: ['**/extension.ts'],
        boundaries: {
          layerCount: 0,
          ruleCount: 0,
          layerChecksActive: false,
        },
      },
    });
  });
});
