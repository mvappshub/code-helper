import * as vscode from 'vscode';
import { GraphData } from '../model/graphTypes';
import { Logger } from '../util/logger';
import { getWebviewHtml } from './webviewHtml';
import { InsightSet } from '../analysis/insightTypes';

export class ArchGraphViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  public static readonly viewType = 'codeLensArchExplorer.sidebarView';

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
      localResourceRoots: [
        vscode.Uri.joinPath(this.context.extensionUri, 'media'),
        vscode.Uri.joinPath(this.context.extensionUri, 'src', 'webview', 'assets'),
      ],
    };
    webviewView.webview.html = getWebviewHtml(webviewView.webview, this.context.extensionUri);
    this.disposables.push(
      webviewView.webview.onDidReceiveMessage((msg) => this.onMessage(msg))
    );
    this.logger.info('ArchGraphViewProvider: sidebar view resolved');
  }

  public update(data: GraphData, insights: InsightSet | null): void {
    if (!this.view) {
      return;
    }

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

    void this.view.webview.postMessage({
      type: 'update',
      data,
      insights,
      config: { locWarning, locDanger, layout },
      entryPointPatterns,
    });
  }

  public reveal(): void {
    this.view?.show?.(true);
  }

  public dispose(): void {
    this.disposables.forEach((disposable) => disposable.dispose());
  }
}
