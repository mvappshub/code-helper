/**
 * Thin logger wrapping VS Code OutputChannel.
 * Constitution III: debugLogging is a configurable setting.
 * Constitution I (Observability): activation-time log entry mandatory.
 */

import * as vscode from 'vscode';

export class Logger {
  private channel: vscode.OutputChannel;
  private debugEnabled: boolean;

  constructor(channel: vscode.OutputChannel) {
    this.channel = channel;
    this.debugEnabled = vscode.workspace
      .getConfiguration('codeLensArchExplorer')
      .get<boolean>('debugLogging', false);
  }

  public refreshSettings(): void {
    this.debugEnabled = vscode.workspace
      .getConfiguration('codeLensArchExplorer')
      .get<boolean>('debugLogging', false);
  }

  public info(msg: string): void {
    this.channel.appendLine(`[INFO ] ${new Date().toISOString()} ${msg}`);
  }

  public warn(msg: string): void {
    this.channel.appendLine(`[WARN ] ${new Date().toISOString()} ${msg}`);
  }

  public error(msg: string): void {
    this.channel.appendLine(`[ERROR] ${new Date().toISOString()} ${msg}`);
  }

  public debug(msg: string): void {
    if (this.debugEnabled) {
      this.channel.appendLine(`[DEBUG] ${new Date().toISOString()} ${msg}`);
    }
  }
}
