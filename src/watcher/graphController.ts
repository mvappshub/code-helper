/**
 * Orchestrates FileSystemWatcher, refresh timer, and GraphBuilder.
 *
 * Constitution I:  auto-refresh on configurable interval.
 * Constitution IV: incremental updates via FileSystemWatcher; full scan only on init.
 * Constitution III: all config read from VS Code settings.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { GraphBuilder } from '../analysis/graphBuilder';
import { GraphData, emptyGraph } from '../model/graphTypes';
import { Logger } from '../util/logger';
import { scanWorkspace, getWorkspaceRoot } from './workspaceScanner';
import { matchesPatterns } from '../util/fileMatcher';
import { InsightSet, computeInsights, ComputeOptions } from '../analysis/insightTypes';
import { mergeExcludePatterns, ResolvedScanConfig, pathMatchesScan } from '../analysis/scanPolicy';
import { BoundaryConfig } from '../analysis/boundaryRules';

export type GraphUpdateListener = (data: GraphData, insights: InsightSet | null) => void;

export class GraphController implements vscode.Disposable {
  private builder: GraphBuilder;
  private logger: Logger;
  private listeners: GraphUpdateListener[] = [];
  private watcher: vscode.FileSystemWatcher | null = null;
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private currentData: GraphData = emptyGraph();
  private dirtyFiles = new Set<string>();
  private workspaceRoot: string | null = null;
  private disposables: vscode.Disposable[] = [];
  private lastInsightSet: InsightSet | null = null;
  private lastInsightCacheKey: string | null = null;
  private warnedBoundaryKeys = new Set<string>();

  constructor(logger: Logger) {
    this.logger = logger;
    this.builder = new GraphBuilder(logger);
  }

  // ─── Lifecycle ──────────────────────────────────────────────────────────

  public async start(): Promise<void> {
    this.workspaceRoot = getWorkspaceRoot();
    if (!this.workspaceRoot) {
      this.logger.warn('GraphController: no workspace folder open');
      return;
    }
    this.logger.info(`GraphController: activated for ${this.workspaceRoot}`);

    await this.fullScan();
    this.setupWatcher();
    this.scheduleRefresh();

    // Re-schedule when settings change
    const cfgSub = vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('codeLensArchExplorer')) {
        this.logger.refreshSettings();
        this.logger.info('GraphController: settings changed — rescheduling refresh');
        this.scheduleRefresh();
        this.lastInsightCacheKey = null;
        if (!this.areInsightsEnabled()) {
          this.lastInsightSet = null;
        }
        this.notify();
      }
    });
    this.disposables.push(cfgSub);
  }

  public dispose(): void {
    this.stopRefresh();
    this.watcher?.dispose();
    this.disposables.forEach((d) => d.dispose());
    this.logger.info('GraphController: disposed');
  }

  // ─── Listeners ──────────────────────────────────────────────────────────

  public onGraphUpdate(listener: GraphUpdateListener): vscode.Disposable {
    this.listeners.push(listener);
    return {
      dispose: () => {
        this.listeners = this.listeners.filter((l) => l !== listener);
      },
    };
  }

  private notify(): void {
    const insights = this.getCurrentInsights();
    for (const l of this.listeners) {
      try { l(this.currentData, insights); } catch { /* listener error must not crash controller */ }
    }
  }

  /** Compute InsightSet lazily; cache keyed on generatedAt. */
  private getCurrentInsights(): InsightSet | null {
    if (!this.workspaceRoot) { return null; }
    if (!this.areInsightsEnabled()) {
      this.lastInsightSet = null;
      this.lastInsightCacheKey = null;
      return null;
    }
    try {
      const opts = this.getInsightOptions();
      const cacheKey = this.buildInsightCacheKey(opts);
      if (!this.lastInsightSet || this.lastInsightCacheKey !== cacheKey) {
        this.lastInsightSet = computeInsights(this.currentData, opts);
        this.lastInsightCacheKey = cacheKey;
        this.logger.debug(`GraphController: Insights recomputed — ${this.lastInsightSet.cycles.length} cycles, ${this.lastInsightSet.orphans.length} orphans, ${this.lastInsightSet.hubs.length} hubs, ${this.lastInsightSet.bloated.length} bloated, ${this.lastInsightSet.violations.length} boundary violations`);
      }
      return this.lastInsightSet;
    } catch {
      return this.lastInsightSet;
    }
  }

  // ─── Scanning ───────────────────────────────────────────────────────────

  private async fullScan(): Promise<void> {
    const cfg = this.getConfig();
    const files = await scanWorkspace(cfg, this.logger);
    this.currentData = await this.builder.fullScanAsync(files, cfg);
    this.dirtyFiles.clear();
    this.notify();
  }

  /** Process accumulated dirty files then notify. */
  private processDirty(): void {
    if (this.dirtyFiles.size === 0) { return; }
    const cfg = this.getConfig();
    for (const f of this.dirtyFiles) {
      this.currentData = this.builder.updateFile(f, cfg);
    }
    this.dirtyFiles.clear();
    this.notify();
  }

  // ─── FileSystemWatcher ──────────────────────────────────────────────────

  private setupWatcher(): void {
    const root = this.workspaceRoot!;
    const cfg = this.getConfig();

    this.watcher?.dispose();
    // Watch all files; filtering happens in the handler
    this.watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(root, '**/*')
    );

    const handle = (uri: vscode.Uri, deleted = false) => {
      const abs = uri.fsPath;
      if (!pathMatchesScan(abs, cfg)) { return; }

      if (deleted) {
        this.currentData = this.builder.removeFile(abs, root);
        this.notify();
      } else {
        // Accumulate; next timer tick will batch-process
        this.dirtyFiles.add(abs);
        this.logger.debug(`Watcher: dirty ${path.basename(abs)}`);
      }
    };

    this.watcher.onDidChange((u) => handle(u));
    this.watcher.onDidCreate((u) => handle(u));
    this.watcher.onDidDelete((u) => handle(u, true));
    this.logger.info('GraphController: FileSystemWatcher started');
  }

  // ─── Auto-refresh timer ─────────────────────────────────────────────────

  private scheduleRefresh(): void {
    this.stopRefresh();
    const intervalSec = Math.max(
      1,
      vscode.workspace
        .getConfiguration('codeLensArchExplorer')
        .get<number>('refreshIntervalSeconds', 5)
    );
    this.logger.info(`GraphController: refresh interval = ${intervalSec}s`);
    this.refreshTimer = setInterval(() => {
      this.processDirty();
    }, intervalSec * 1000);
  }

  private stopRefresh(): void {
    if (this.refreshTimer !== null) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  // ─── Public API ─────────────────────────────────────────────────────────

  public forceRefresh(): void {
    this.logger.info('GraphController: force refresh requested');
    void this.fullScan();
  }

  public getData(): GraphData {
    return this.currentData;
  }

  /** Returns the pre-computed InsightSet. Null until first scan completes. */
  public getInsights(): InsightSet | null {
    return this.getCurrentInsights();
  }

  public getWorkspaceRoot(): string | null {
    return this.workspaceRoot;
  }

  // ─── Config helper ──────────────────────────────────────────────────────

  private getConfig(): ResolvedScanConfig {
    const cfg = vscode.workspace.getConfiguration('codeLensArchExplorer');
    const includePatterns = cfg.get<string[]>('includePatterns', ['**/*.ts']);
    const excludePatterns = mergeExcludePatterns(cfg.get<string[]>('excludePatterns', ['**/node_modules/**']));
    const includeInspect = cfg.inspect<string[]>('includePatterns');
    const includeOverridesExcludes = Boolean(
      includeInspect?.globalValue ??
      includeInspect?.workspaceValue ??
      includeInspect?.workspaceFolderValue
    );

    return {
      workspaceRoot: this.workspaceRoot ?? '',
      includePatterns,
      excludePatterns,
      maxDepth: cfg.get<number>('maxDepth', 10),
      maxFileLOC: cfg.get<number>('maxFileLOC', 5000),
      includeOverridesExcludes,
    };
  }

  private getInsightOptions(): ComputeOptions {
    const cfg = vscode.workspace.getConfiguration('codeLensArchExplorer');
    return {
      topN: cfg.get<number>('insights.topN', 10),
      locWarningThreshold: cfg.get<number>('locWarningThreshold', 500),
      locDangerThreshold: cfg.get<number>('locDangerThreshold', 1000),
      entryPointPatterns: cfg.get<string[]>('entryPointPatterns', [
        '**/extension.ts', '**/index.ts', '**/main.{py,go,rs}',
        '**/Program.cs', '**/Main.java',
      ]),
      fileMatcher: matchesPatterns,
      boundaries: cfg.get<BoundaryConfig>('boundaries'),
      warn: (key: string, message: string) => {
        if (this.warnedBoundaryKeys.has(key)) {
          return;
        }
        this.warnedBoundaryKeys.add(key);
        this.logger.warn(message);
      },
    };
  }

  public areInsightsEnabled(): boolean {
    return vscode.workspace
      .getConfiguration('codeLensArchExplorer')
      .get<boolean>('insights.enabled', true);
  }

  private buildInsightCacheKey(options: ComputeOptions): string {
    return JSON.stringify({
      generatedAt: this.currentData.generatedAt,
      topN: options.topN,
      locWarningThreshold: options.locWarningThreshold,
      locDangerThreshold: options.locDangerThreshold,
      entryPointPatterns: options.entryPointPatterns,
      boundaries: options.boundaries,
    });
  }
}
