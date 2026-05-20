/**
 * Performs the initial full workspace scan using VS Code's workspace.findFiles API.
 * Constitution IV: this is the only place a full scan happens.
 */

import * as vscode from 'vscode';
import { Logger } from '../util/logger';
import { ResolvedScanConfig, isWithinMaxDepth, pathMatchesScan } from '../analysis/scanPolicy';

export async function scanWorkspace(
  config: ResolvedScanConfig,
  logger: Logger
): Promise<string[]> {
  const allFiles: string[] = [];

  for (const pattern of config.includePatterns) {
    try {
      const uris = await vscode.workspace.findFiles(new vscode.RelativePattern(config.workspaceRoot, pattern));
      for (const uri of uris) {
        const abs = uri.fsPath;
        if (
          abs.startsWith(config.workspaceRoot) &&
          isWithinMaxDepth(abs, config.workspaceRoot, config.maxDepth) &&
          pathMatchesScan(abs, config)
        ) {
          allFiles.push(abs);
        }
      }
    } catch (err) {
      logger.warn(`scanWorkspace: pattern "${pattern}" failed — ${err}`);
    }
  }

  // Deduplicate
  const unique = [...new Set(allFiles)];
  logger.info(`scanWorkspace: found ${unique.length} files in ${config.workspaceRoot}`);
  return unique;
}

export function getWorkspaceRoot(): string | null {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) { return null; }
  return folders[0].uri.fsPath;
}
