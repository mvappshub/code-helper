/**
 * Manages the VS Code WebviewPanel that renders the architecture graph.
 *
 * Constitution II: every visual element answers an architectural question.
 * Constitution V: receives GraphData; rendering is pluggable.
 * Security: strict CSP, no remote script sources.
 */

import * as vscode from 'vscode';
import { GraphData } from '../model/graphTypes';
import { Logger } from '../util/logger';
import { getWebviewHtml } from './webviewHtml';
import { InsightSet } from '../analysis/insightTypes';

export class ArchGraphPanel implements vscode.Disposable {
  public static readonly viewType = 'codeLensArchExplorer.graph';

  private panel: vscode.WebviewPanel;
  private logger: Logger;
  private context: vscode.ExtensionContext;
  private disposables: vscode.Disposable[] = [];

  constructor(context: vscode.ExtensionContext, logger: Logger) {
    this.context = context;
    this.logger = logger;

    this.panel = vscode.window.createWebviewPanel(
      ArchGraphPanel.viewType,
      'Architecture Graph',
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(context.extensionUri, 'media'),
          vscode.Uri.joinPath(context.extensionUri, 'src', 'webview', 'assets'),
        ],
      }
    );

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.logger.info('ArchGraphPanel: created');
  }

  /** Push a new graph snapshot to the webview. O(1) postMessage. */
  public update(data: GraphData, insights: InsightSet | null): void {
    const locWarning = vscode.workspace
      .getConfiguration('codeLensArchExplorer')
      .get<number>('locWarningThreshold', 500);
    const locDanger = vscode.workspace
      .getConfiguration('codeLensArchExplorer')
      .get<number>('locDangerThreshold', 1000);
    const layout = vscode.workspace
      .getConfiguration('codeLensArchExplorer')
      .get<string>('graphLayout', 'force');
    const entryPointPatterns = vscode.workspace
      .getConfiguration('codeLensArchExplorer')
      .get<string[]>('entryPointPatterns', [
        '**/extension.ts', '**/index.ts', '**/main.{py,go,rs}',
        '**/Program.cs', '**/Main.java',
      ]);

    this.panel.webview.postMessage({
      type: 'update',
      data,
      insights,
      config: { locWarning, locDanger, layout },
      entryPointPatterns,
    });
    this.logger.debug(`ArchGraphPanel: pushed update — ${data.nodes.length} nodes, ${data.edges.length} edges`);
  }

  /** (Re-)set the full HTML skeleton. Called once at panel creation. */
  public setHtml(): void {
    this.panel.webview.html = getWebviewHtml(this.panel.webview, this.context.extensionUri);
  }

  public reveal(): void {
    this.panel.reveal();
  }

  /** Register a handler for messages sent by the webview JS. */
  public onDidReceiveMessage(handler: (msg: unknown) => void): vscode.Disposable {
    return this.panel.webview.onDidReceiveMessage(handler, null, this.disposables);
  }

  public isDisposed(): boolean {
    // VS Code doesn't expose a direct isDisposed; track via onDidDispose
    return this._disposed;
  }

  private _disposed = false;

  public dispose(): void {
    this._disposed = true;
    this.disposables.forEach((d) => d.dispose());
    this.panel.dispose();
    this.logger.info('ArchGraphPanel: disposed');
  }
}
