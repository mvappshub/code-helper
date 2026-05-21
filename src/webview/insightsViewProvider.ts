/**
 * WebviewViewProvider for the Architecture Insights panel.
 *
 * Keeps transport/orchestration here; the large HTML payload lives in
 * a dedicated module so this provider stays readable.
 */

import * as vscode from 'vscode';
import { BoundaryConfigSummary } from '../analysis/boundaryRules';
import { InsightSet } from '../analysis/insightTypes';
import { Logger } from '../util/logger';
import { getInsightsHtml } from './insightsHtml';

export interface InsightsConfig {
  topN: number;
  locWarning: number;
  locDanger: number;
  entryPointPatterns: string[];
  boundaries: BoundaryConfigSummary;
}

export class InsightsViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  public static readonly viewType = 'codeLensArchExplorer.insightsView';

  private view: vscode.WebviewView | undefined;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly logger: Logger,
    private readonly onMessage: (msg: unknown) => void
  ) {}

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'media')],
    };
    webviewView.webview.html = getInsightsHtml(webviewView.webview.cspSource);
    this.disposables.push(
      webviewView.webview.onDidReceiveMessage((msg) => this.onMessage(msg))
    );
    this.logger.info('InsightsViewProvider: resolved');
  }

  public update(data: InsightSet, config: InsightsConfig): void {
    if (!this.view) { return; }

    void this.view.webview.postMessage({
      type: 'updateInsights',
      data,
      config: {
        topN: config.topN,
        locWarning: config.locWarning,
        locDanger: config.locDanger,
        entryPointPatterns: config.entryPointPatterns,
        boundaries: config.boundaries,
      },
    });

    this.logger.debug(
      `InsightsViewProvider: pushed ${data.cycles.length} cycles, ${data.orphans.length} orphans, ${data.hubs.length} hubs, ${data.bloated.length} bloated, ${data.unresolved.length} unresolved, ${data.fanOut.length} fan-out, ${data.risky.length} risky, ${data.violations.length} boundary violations`
    );
  }

  public showDisabled(config: InsightsConfig): void {
    if (!this.view) { return; }

    void this.view.webview.postMessage({
      type: 'setInsightsDisabled',
      config,
    });
    this.logger.debug('InsightsViewProvider: insights disabled placeholder shown');
  }

  public dispose(): void {
    this.disposables.forEach((d) => d.dispose());
  }
}
