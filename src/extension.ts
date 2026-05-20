/**
 * Extension entry point.
 *
 * Constitution I (Observability): activation-time log entry here.
 * Constitution IV: GraphController started once; incremental from there.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { Logger } from './util/logger';
import { GraphController } from './watcher/graphController';
import { ArchGraphPanel } from './webview/webviewPanel';
import { ArchGraphViewProvider } from './webview/webviewViewProvider';
import { InsightsViewProvider } from './webview/insightsViewProvider';
import { insightSetToDiagnostics } from './analysis/diagnostics';
import { GraphData } from './model/graphTypes';
import { InsightSet } from './analysis/insightTypes';

let controller: GraphController | undefined;
let panel: ArchGraphPanel | undefined;
let sidebarView: ArchGraphViewProvider | undefined;
let insightsView: InsightsViewProvider | undefined;
let logger: Logger | undefined;
let diagnostics: vscode.DiagnosticCollection | undefined;
let webviewErrorShown = false;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const channel = vscode.window.createOutputChannel('CodeLens Architecture Explorer');
  logger = new Logger(channel);
  logger.info('CodeLens Architecture Explorer — activated');

  controller = new GraphController(logger);
  syncDiagnosticsCollection(context);
  const handleWebviewMessage = (msg: unknown) => {
    const m = msg as { type?: string; nodeId?: string; filePath?: string; line?: number; message?: string; stack?: string };
    if (m?.type === 'forceRefresh') {
      controller?.forceRefresh();
    }
    if (m?.type === 'webviewError') {
      logger?.error(`Graph webview crashed: ${m.message ?? 'Unknown error'}`);
      if (m.stack) {
        logger?.error(m.stack);
      }
      if (!webviewErrorShown) {
        webviewErrorShown = true;
        void vscode.window.showErrorMessage('CodeLens Architecture graph webview crashed. See output for details.');
      }
    }
    if (m?.type === 'openSettings') {
      void vscode.commands.executeCommand(
        'workbench.action.openSettings',
        '@ext:codelens.codelens-arch-explorer codeLensArchExplorer'
      );
    }
    if (m?.type === 'openFile') {
      const root = controller?.getWorkspaceRoot();
      const filePath = m.filePath ?? (root && m.nodeId ? path.join(root, m.nodeId) : undefined);
      if (filePath) {
        const line = Math.max(0, (m.line ?? 1) - 1);
        const selection = new vscode.Range(line, 0, line, 0);
        void vscode.window.showTextDocument(vscode.Uri.file(filePath), {
          preview: false,
          selection,
        });
      }
    }
  };
  sidebarView = new ArchGraphViewProvider(context, logger, handleWebviewMessage);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(ArchGraphViewProvider.viewType, sidebarView)
  );

  // ─── Insights panel ─────────────────────────────────────────────────────
  insightsView = new InsightsViewProvider(context, logger, handleWebviewMessage);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(InsightsViewProvider.viewType, insightsView)
  );

  // ─── Commands ────────────────────────────────────────────────────────────

  const showGraphCmd = vscode.commands.registerCommand(
    'codeLensArchExplorer.focusSidebar',
    async () => {
      await vscode.commands.executeCommand('workbench.view.extension.codeLensArchExplorer');
      sidebarView?.reveal();
      if (controller) {
        sidebarView?.update(controller.getData(), controller.getInsights());
      }
    }
  );

  const openGraphPanelCmd = vscode.commands.registerCommand(
    'codeLensArchExplorer.showGraph',
    () => {
      ensurePanel(context, handleWebviewMessage);
      panel!.reveal();
      if (controller) {
        panel!.update(controller.getData(), controller.getInsights());
      }
    }
  );

  const refreshNowCmd = vscode.commands.registerCommand(
    'codeLensArchExplorer.refreshNow',
    () => {
      controller?.forceRefresh();
    }
  );

  context.subscriptions.push(showGraphCmd, openGraphPanelCmd, refreshNowCmd, channel);

  // ─── Start controller and warm sidebar data ─────────────────────────────

  await controller.start();

  // Subscribe to graph updates: push to every visible surface
  const updateSub = controller.onGraphUpdate((data, insights) => {
    panel?.update(data, insights);
    sidebarView?.update(data, insights);
    updateDiagnostics(data, insights);
    if (insightsView) {
      const cfg = vscode.workspace.getConfiguration('codeLensArchExplorer');
      const enabled = cfg.get<boolean>('insights.enabled', true);
      const topN = cfg.get<number>('insights.topN', 10);
      const locWarning = cfg.get<number>('locWarningThreshold', 500);
      const locDanger = cfg.get<number>('locDangerThreshold', 1000);
      const entryPointPatterns = cfg.get<string[]>('entryPointPatterns', [
        '**/extension.ts', '**/index.ts', '**/main.{py,go,rs}', '**/Program.cs', '**/Main.java',
      ]);
      if (!enabled) {
        insightsView.showDisabled({
          topN,
          locWarning,
          locDanger,
          entryPointPatterns,
        });
      } else if (insights) {
        insightsView.update(insights, { topN, locWarning, locDanger, entryPointPatterns });
      }
    }
  });
  context.subscriptions.push(updateSub);

  const diagnosticsCfgSub = vscode.workspace.onDidChangeConfiguration((event) => {
    if (event.affectsConfiguration('codeLensArchExplorer.diagnostics.enabled')) {
      syncDiagnosticsCollection(context);
      if (controller) {
        updateDiagnostics(controller.getData(), controller.getInsights());
      }
    }
  });

  sidebarView.update(controller.getData(), controller.getInsights());

  context.subscriptions.push(controller, sidebarView, insightsView, diagnosticsCfgSub);
  logger.info('CodeLens Architecture Explorer — ready');
}

export function deactivate(): void {
  controller?.dispose();
  panel?.dispose();
  sidebarView?.dispose();
  insightsView?.dispose();
  diagnostics?.dispose();
  logger?.info('CodeLens Architecture Explorer — deactivated');
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function ensurePanel(
  context: vscode.ExtensionContext,
  handleWebviewMessage: (msg: unknown) => void
): void {
  if (!panel || panel.isDisposed()) {
    panel = new ArchGraphPanel(context, logger!);
    panel.setHtml();

    panel.onDidReceiveMessage(handleWebviewMessage);
  }
}

function syncDiagnosticsCollection(context: vscode.ExtensionContext): void {
  const enabled = vscode.workspace
    .getConfiguration('codeLensArchExplorer')
    .get<boolean>('diagnostics.enabled', true);

  if (!enabled) {
    diagnostics?.clear();
    diagnostics?.dispose();
    diagnostics = undefined;
    return;
  }

  if (!diagnostics) {
    diagnostics = vscode.languages.createDiagnosticCollection('codelens-architecture');
    context.subscriptions.push(diagnostics);
  }
}

function updateDiagnostics(data: GraphData, insights: InsightSet | null): void {
  if (!diagnostics) {
    return;
  }

  const locDangerThreshold = vscode.workspace
    .getConfiguration('codeLensArchExplorer')
    .get<number>('locDangerThreshold', 1000);
  const payload = insightSetToDiagnostics(insights, data, locDangerThreshold);
  diagnostics.clear();
  diagnostics.set(Array.from(payload.entries()).map(([filePath, entries]) => [
    vscode.Uri.file(filePath),
    entries.map((entry) => {
      const diagnostic = new vscode.Diagnostic(
        new vscode.Range(Math.max(0, (entry.line ?? 1) - 1), 0, Math.max(0, (entry.line ?? 1) - 1), 80),
        entry.message,
        vscode.DiagnosticSeverity.Warning
      );
      diagnostic.code = entry.code;
      diagnostic.source = entry.source;
      return diagnostic;
    }),
  ]));
}
