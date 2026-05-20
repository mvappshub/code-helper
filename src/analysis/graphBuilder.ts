/**
 * Builds and maintains the GraphData snapshot.
 *
 * Constitution IV: incremental — only re-analyses dirty files.
 * Constitution V: all nodes/edges conform to GraphNode / GraphEdge schema.
 */

import * as fs from 'fs';
import * as path from 'path';
import { GraphData, GraphEdge, GraphNode, emptyGraph } from '../model/graphTypes';
import { detectLanguage } from './languageDetector';
import { RawImport, extractImports, resolveSpecifier } from './importExtractor';
import { Logger } from '../util/logger';
import { ResolvedScanConfig, shouldIncludeFileContent, isWithinMaxDepth } from './scanPolicy';

export type ScanConfig = ResolvedScanConfig;

export class GraphBuilder {
  private nodes = new Map<string, GraphNode>();
  private edges: GraphEdge[] = [];
  private logger: Logger;

  constructor(logger: Logger) {
    this.logger = logger;
  }

  // ─── Full scan (sync, backwards compat) ────────────────────────────────

  /**
   * Synchronous full workspace scan. Called only on activation or explicit refresh.
   * Constitution IV: subsequent updates use `updateFile` / `removeFile`.
   */
  public fullScan(files: string[], config: ScanConfig): GraphData {
    this.logger.debug(`GraphBuilder.fullScan (sync): ${files.length} files`);
    this.nodes.clear();
    this.edges = [];

    for (const absPath of files) {
      this.analyseFile(absPath, config);
    }
    this.rebuildEdges(config.workspaceRoot);
    return this.snapshot();
  }

  /**
   * Async full workspace scan using fs.promises in batches of 50.
   * Constitution IV: non-blocking background scan.
   */
  public async fullScanAsync(files: string[], config: ScanConfig): Promise<GraphData> {
    this.logger.debug(`GraphBuilder.fullScanAsync: ${files.length} files`);
    this.nodes.clear();
    this.edges = [];

    const BATCH_SIZE = 50;
    for (let i = 0; i < files.length; i += BATCH_SIZE) {
      const batch = files.slice(i, i + BATCH_SIZE);
      await Promise.all(batch.map((f) => this.analyseFileAsync(f, config)));
    }
    this.rebuildEdges(config.workspaceRoot);
    return this.snapshot();
  }

  // ─── Incremental update ─────────────────────────────────────────────────

  /** Re-analyse a single changed/created file. O(1) node update + edge rebuild. */
  public updateFile(absPath: string, config: ScanConfig): GraphData {
    this.logger.debug(`GraphBuilder.updateFile: ${absPath}`);
    this.analyseFile(absPath, config);
    this.rebuildEdges(config.workspaceRoot);
    return this.snapshot();
  }

  /** Remove a deleted file from the graph. */
  public removeFile(absPath: string, workspaceRoot: string): GraphData {
    const id = this.toId(absPath, workspaceRoot);
    this.nodes.delete(id);
    this.edges = this.edges.filter((e) => e.source !== id && e.target !== id);
    this.logger.debug(`GraphBuilder.removeFile: ${id}`);
    return this.snapshot();
  }

  // ─── Internals ──────────────────────────────────────────────────────────

  private analyseFile(absPath: string, config: ScanConfig): void {
    try {
      if (!isWithinMaxDepth(absPath, config.workspaceRoot, config.maxDepth)) {
        this.removeNode(absPath, config.workspaceRoot);
        return;
      }
      const stat = fs.statSync(absPath);
      const content = fs.readFileSync(absPath, 'utf8');
      this.processFileContent(absPath, config, content, stat.mtime.toISOString());
    } catch (err) {
      this.logger.debug(`GraphBuilder: skip ${absPath} — ${err}`);
    }
  }

  /** Async version using fs.promises (T022). */
  private async analyseFileAsync(absPath: string, config: ScanConfig): Promise<void> {
    try {
      if (!isWithinMaxDepth(absPath, config.workspaceRoot, config.maxDepth)) {
        this.removeNode(absPath, config.workspaceRoot);
        return;
      }
      const stat = await fs.promises.stat(absPath);
      const content = await fs.promises.readFile(absPath, 'utf8');
      this.processFileContent(absPath, config, content, stat.mtime.toISOString());
    } catch (err) {
      this.logger.debug(`GraphBuilder: skip ${absPath} — ${err}`);
    }
  }

  /** Shared node-creation logic, used by both sync and async paths (Constitution IV). */
  private processFileContent(
    absPath: string,
    config: ScanConfig,
    content: string,
    lastModified: string
  ): void {
    const decision = shouldIncludeFileContent(absPath, content, config);
    if (!decision.included) {
      this.removeNode(absPath, config.workspaceRoot);
      this.logger.debug(`GraphBuilder: excluded ${absPath} (${decision.reason})`);
      return;
    }

    const linesOfCode = content.split('\n').length;
    const id = this.toId(absPath, config.workspaceRoot);
    const depth = id.split('/').length - 1;

    const node: GraphNode = {
      id,
      path: absPath,
      language: detectLanguage(absPath),
      linesOfCode,
      lastModified,
      depth,
      label: path.basename(absPath),
    };
    this.nodes.set(id, node);

    // Store raw imports on a side-channel so edge rebuild can use them
    const rawImports = extractImports(absPath, content);
    (node as GraphNode & { _rawImports?: RawImport[] })._rawImports = rawImports;
  }

  /**
   * Rebuilds all edges from stored _rawImports on each node.
   * Runs after every node change; fast because it iterates only the node map.
   */
  private rebuildEdges(workspaceRoot: string): void {
    this.edges = [];
    for (const [, node] of this.nodes) {
      const rawImports: RawImport[] =
        (node as GraphNode & { _rawImports?: RawImport[] })._rawImports ?? [];

      for (const rawImport of rawImports) {
        const resolved = resolveSpecifier(rawImport.specifier, node.path, workspaceRoot);
        if (!resolved) { continue; } // external package — skip

        // Try to find a matching node (with or without extension)
        const targetId = this.resolveNodeId(resolved);
        if (targetId) {
          this.edges.push({
            source: node.id,
            target: targetId,
            type: 'import',
            sourceLine: rawImport.sourceLine,
            specifier: rawImport.specifier,
          });
        }
      }
    }
  }

  /**
   * Finds a node id that matches the given relative path
   * (tries exact match, then with common extensions appended).
   */
  private resolveNodeId(rel: string): string | null {
    if (this.nodes.has(rel)) { return rel; }
    const EXTS = ['.ts', '.tsx', '.js', '.jsx', '.py', '.java', '.cs', '.go', '.rs'];
    for (const ext of EXTS) {
      const candidate = rel + ext;
      if (this.nodes.has(candidate)) { return candidate; }
      // index file
      const index = rel + '/index' + ext;
      if (this.nodes.has(index)) { return index; }
    }
    return null;
  }

  private toId(absPath: string, workspaceRoot: string): string {
    return path.relative(workspaceRoot, absPath).replace(/\\/g, '/');
  }

  private removeNode(absPath: string, workspaceRoot: string): void {
    this.nodes.delete(this.toId(absPath, workspaceRoot));
  }

  private snapshot(): GraphData {
    return {
      nodes: Array.from(this.nodes.values()),
      edges: this.edges,
      generatedAt: new Date().toISOString(),
    };
  }

  public currentSnapshot(): GraphData {
    if (this.nodes.size === 0) { return emptyGraph(); }
    return this.snapshot();
  }
}
