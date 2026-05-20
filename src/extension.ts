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
import { InsightSet, InsightSeverity } from './analysis/insightTypes';
import { buildInsightsAgentReport } from './analysis/insightReport';

let controller: GraphController | undefined;
let panel: ArchGraphPanel | undefined;
let sidebarView: ArchGraphViewProvider | undefined;
let insightsView: InsightsViewProvider | undefined;
let logger: Logger | undefined;
let diagnostics: vscode.DiagnosticCollection | undefined;
let webviewErrorShown = false;
const DEFAULT_ENTRY_POINT_PATTERNS = [
  '**/extension.ts',
  '**/index.ts',
  '**/main.{py,go,rs}',
  '**/Program.cs',
  '**/Main.java',
  '**/*.test.{ts,tsx,js,jsx}',
  '**/runTests.ts',
  '**/webview/assets/graph-main.js',
];

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

  const exportInsightsReportCmd = vscode.commands.registerCommand(
    'codeLensArchExplorer.exportInsightsReport',
    async () => {
      await exportInsightsReport();
    }
  );

  const copyInsightsReportCmd = vscode.commands.registerCommand(
    'codeLensArchExplorer.copyInsightsReport',
    async () => {
      await copyInsightsReport();
    }
  );

  context.subscriptions.push(
    showGraphCmd,
    openGraphPanelCmd,
    refreshNowCmd,
    exportInsightsReportCmd,
    copyInsightsReportCmd,
    channel
  );

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
      const entryPointPatterns = cfg.get<string[]>('entryPointPatterns', DEFAULT_ENTRY_POINT_PATTERNS);
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
        mapDiagnosticSeverity(entry.severity)
      );
      diagnostic.code = entry.code;
      diagnostic.source = entry.source;
      return diagnostic;
    }),
  ]));
}

async function exportInsightsReport(): Promise<void> {
  const report = getInsightsReportPayload();
  if (!report) {
    return;
  }

  const defaultUri = vscode.Uri.file(path.join(
    report.workspaceRoot ?? process.cwd(),
    `architecture-insights-report-${formatFileTimestamp(new Date())}.md`
  ));

  const targetUri = await vscode.window.showSaveDialog({
    defaultUri,
    filters: {
      Markdown: ['md'],
    },
    saveLabel: 'Export Architecture Insights Report',
  });

  if (!targetUri) {
    return;
  }

  await vscode.workspace.fs.writeFile(targetUri, Buffer.from(report.markdown, 'utf8'));
  void vscode.window.showInformationMessage(`Architecture insights report exported to ${targetUri.fsPath}`);
}

async function copyInsightsReport(): Promise<void> {
  const report = getInsightsReportPayload();
  if (!report) {
    return;
  }

  await vscode.env.clipboard.writeText(report.markdown);
  void vscode.window.showInformationMessage('Architecture insights report copied to clipboard.');
}

function getInsightsReportPayload(): { markdown: string; workspaceRoot: string | null } | null {
  if (!controller) {
    void vscode.window.showWarningMessage('Architecture insights are not ready yet.');
    return null;
  }

  if (!controller.areInsightsEnabled()) {
    void vscode.window.showWarningMessage('Architecture insights export is unavailable because insights are disabled in settings.');
    return null;
  }

  const insights = controller.getInsights();
  if (!insights) {
    void vscode.window.showWarningMessage('Architecture insights are not ready yet. Wait for the workspace scan to complete and try again.');
    return null;
  }

  const graph = controller.getData();
  const workspaceRoot = controller.getWorkspaceRoot();
  return {
    markdown: buildInsightsAgentReport({
      graph,
      insights,
      config: controller.getInsightReportConfigSnapshot(),
      metadata: {
        workspaceRoot,
        generatedAt: new Date().toISOString(),
      },
    }),
    workspaceRoot,
  };
}

function formatFileTimestamp(date: Date): string {
  return date.toISOString().replace(/[:.]/g, '-');
}

function mapDiagnosticSeverity(severity: InsightSeverity): vscode.DiagnosticSeverity {
  switch (severity) {
    case 'error':
      return vscode.DiagnosticSeverity.Error;
    case 'info':
      return vscode.DiagnosticSeverity.Information;
    case 'warn':
    default:
      return vscode.DiagnosticSeverity.Warning;
  }
}
