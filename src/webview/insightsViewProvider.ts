/**
 * WebviewViewProvider for the Architecture Insights panel.
 *
 * Renders cycles, orphans, hubs, bloated files, and additional signals as a structured list
 * inside the Architecture activity-bar container.
 *
 * Constitution II: every section answers an architectural question.
 * Constitution III: reads `insights.enabled` from config.
 * Security: strict CSP, no remote scripts.
 */

import * as vscode from 'vscode';
import { InsightSet } from '../analysis/insightTypes';
import { Logger } from '../util/logger';

export interface InsightsConfig {
  topN: number;
  locWarning: number;
  locDanger: number;
  entryPointPatterns: string[];
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
    webviewView.webview.html = this.getInsightsHtml(webviewView.webview.cspSource);
    this.disposables.push(
      webviewView.webview.onDidReceiveMessage((msg) => this.onMessage(msg))
    );
    this.logger.info('InsightsViewProvider: resolved');
  }

  /**
   * Push an InsightSet to the webview.
   * The webview re-renders the sections with the new data.
   */
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

  // ─── HTML ────────────────────────────────────────────────────────────────

  private getInsightsHtml(cspSource: string): string {
    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none';
             script-src ${cspSource} 'unsafe-inline';
             style-src ${cspSource} 'unsafe-inline';
             img-src ${cspSource} data:;" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Architecture Insights</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: var(--vscode-editor-background, #1e1e1e);
      color: var(--vscode-editor-foreground, #d4d4d4);
      font-family: var(--vscode-font-family, monospace);
      font-size: 12px;
      padding: 0;
    }
    .section { border-bottom: 1px solid var(--vscode-panel-border, #444); }
    .section-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 8px 10px;
      cursor: pointer;
      user-select: none;
      background: var(--vscode-titleBar-activeBackground, #3c3c3c);
    }
    .section-header:hover { opacity: 0.9; }
    .section-header h3 {
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .badge {
      background: var(--vscode-badge-background, #4d4d4d);
      color: var(--vscode-badge-foreground, #fff);
      padding: 1px 7px;
      border-radius: 10px;
      font-size: 10px;
      min-width: 16px;
      text-align: center;
    }
    .badge.error { background: #f44747; }
    .badge.warn { background: #cca700; }
    .section-body { padding: 0; }
    .section-body.collapsed { display: none; }
    .insight-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 5px 10px;
      border-bottom: 1px solid var(--vscode-panel-border, #333);
      cursor: pointer;
      min-height: 28px;
    }
    .insight-row:hover { background: var(--vscode-list-hoverBackground, #2a2d2e); }
    .insight-title {
      flex: 1;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      margin-right: 8px;
      font-size: 11px;
    }
    .metric-pill {
      flex-shrink: 0;
      background: var(--vscode-editorWidget-background, #2d2d2d);
      border: 1px solid var(--vscode-charts-lines, #555);
      border-radius: 10px;
      padding: 1px 8px;
      font-size: 10px;
      color: var(--vscode-editor-foreground, #d4d4d4);
      white-space: nowrap;
    }
    .metric-pill.error { border-color: #f44747; color: #f44747; }
    .metric-pill.warn { border-color: #cca700; color: #cca700; }
    .empty-state {
      padding: 8px 10px;
      color: var(--vscode-descriptionForeground, #808080);
      font-size: 11px;
      font-style: italic;
    }
    .cycle-files {
      padding: 2px 10px 2px 22px;
      font-size: 10px;
      color: var(--vscode-descriptionForeground, #808080);
    }
    .cycle-files span {
      display: block;
      padding: 1px 0;
      cursor: pointer;
    }
    .cycle-files span:hover {
      color: var(--vscode-editor-foreground, #d4d4d4);
      text-decoration: underline;
    }
    .severity-dot {
      display: inline-block;
      width: 8px; height: 8px;
      border-radius: 50%;
      margin-right: 6px;
      flex-shrink: 0;
    }
    .severity-dot.error { background: #f44747; }
    .severity-dot.warn  { background: #cca700; }
    .severity-dot.info  { background: #4ec9b0; }
    .panel-message {
      padding: 12px 10px;
      color: var(--vscode-descriptionForeground, #808080);
      font-size: 11px;
      line-height: 1.5;
    }
    .hidden { display: none; }
    #status {
      padding: 6px 10px;
      font-size: 10px;
      opacity: 0.5;
      border-top: 1px solid var(--vscode-panel-border, #444);
    }
  </style>
</head>
<body>

<div id="disabled-state" class="panel-message hidden">
  Architecture Insights are disabled in settings.
</div>

<div id="sections">
  <!-- Cycles -->
  <div class="section" data-category="cycles">
    <div class="section-header" data-toggle="cycles">
      <h3>🔴 Cycles</h3>
      <span class="badge error" id="cycles-badge">0</span>
    </div>
    <div class="section-body collapsed" id="cycles-body"></div>
  </div>

  <!-- Orphans -->
  <div class="section" data-category="orphans">
    <div class="section-header" data-toggle="orphans">
      <h3>⚪ Orphans</h3>
      <span class="badge" id="orphans-badge">0</span>
    </div>
    <div class="section-body collapsed" id="orphans-body"></div>
  </div>

  <!-- Hubs -->
  <div class="section" data-category="hubs">
    <div class="section-header" data-toggle="hubs">
      <h3>🟡 Hubs</h3>
      <span class="badge warn" id="hubs-badge">0</span>
    </div>
    <div class="section-body collapsed" id="hubs-body"></div>
  </div>

  <!-- Bloated -->
  <div class="section" data-category="bloated">
    <div class="section-header" data-toggle="bloated">
      <h3>🟠 Bloated</h3>
      <span class="badge warn" id="bloated-badge">0</span>
    </div>
    <div class="section-body collapsed" id="bloated-body"></div>
  </div>

  <div class="section" data-category="unresolved">
    <div class="section-header" data-toggle="unresolved">
      <h3>🧩 Unresolved Imports</h3>
      <span class="badge warn" id="unresolved-badge">0</span>
    </div>
    <div class="section-body collapsed" id="unresolved-body"></div>
  </div>

  <div class="section" data-category="fanOut">
    <div class="section-header" data-toggle="fanOut">
      <h3>🪄 Fan-Out</h3>
      <span class="badge warn" id="fanOut-badge">0</span>
    </div>
    <div class="section-body collapsed" id="fanOut-body"></div>
  </div>

  <div class="section" data-category="risky">
    <div class="section-header" data-toggle="risky">
      <h3>🚨 Risky Modules</h3>
      <span class="badge error" id="risky-badge">0</span>
    </div>
    <div class="section-body collapsed" id="risky-body"></div>
  </div>

  <div class="section" data-category="layerViolations">
    <div class="section-header" data-toggle="layerViolations">
      <h3>⛔ Layer Violations</h3>
      <span class="badge warn" id="layerViolations-badge">0</span>
    </div>
    <div class="section-body collapsed" id="layerViolations-body"></div>
  </div>

  <div class="section" data-category="deepRelative">
    <div class="section-header" data-toggle="deepRelative">
      <h3>↕ Deep Relative Imports</h3>
      <span class="badge warn" id="deepRelative-badge">0</span>
    </div>
    <div class="section-body collapsed" id="deepRelative-body"></div>
  </div>

  <div class="section" data-category="reverseTest">
    <div class="section-header" data-toggle="reverseTest">
      <h3>🧪 Reverse Test Imports</h3>
      <span class="badge warn" id="reverseTest-badge">0</span>
    </div>
    <div class="section-body collapsed" id="reverseTest-body"></div>
  </div>

  <div class="section" data-category="packageInternal">
    <div class="section-header" data-toggle="packageInternal">
      <h3>🔒 Package Internal Violations</h3>
      <span class="badge warn" id="packageInternal-badge">0</span>
    </div>
    <div class="section-body collapsed" id="packageInternal-body"></div>
  </div>
</div>

<div id="status">Waiting for data…</div>

<script>
(function () {
  'use strict';

  const vscode = acquireVsCodeApi();
  const sections = document.getElementById('sections');
  const disabledState = document.getElementById('disabled-state');
  const status = document.getElementById('status');

  let elements = {
    cycles:   { badge: document.getElementById('cycles-badge'),   body: document.getElementById('cycles-body')   },
    orphans:  { badge: document.getElementById('orphans-badge'),  body: document.getElementById('orphans-body')  },
    hubs:     { badge: document.getElementById('hubs-badge'),     body: document.getElementById('hubs-body')     },
    bloated:  { badge: document.getElementById('bloated-badge'),  body: document.getElementById('bloated-body')  },
    unresolved: { badge: document.getElementById('unresolved-badge'), body: document.getElementById('unresolved-body') },
    fanOut: { badge: document.getElementById('fanOut-badge'), body: document.getElementById('fanOut-body') },
    risky: { badge: document.getElementById('risky-badge'), body: document.getElementById('risky-body') },
    layerViolations: { badge: document.getElementById('layerViolations-badge'), body: document.getElementById('layerViolations-body') },
    deepRelative: { badge: document.getElementById('deepRelative-badge'), body: document.getElementById('deepRelative-body') },
    reverseTest: { badge: document.getElementById('reverseTest-badge'), body: document.getElementById('reverseTest-body') },
    packageInternal: { badge: document.getElementById('packageInternal-badge'), body: document.getElementById('packageInternal-body') },
  };

  let currentScrollTops = {
    cycles: 0,
    orphans: 0,
    hubs: 0,
    bloated: 0,
    unresolved: 0,
    fanOut: 0,
    risky: 0,
    layerViolations: 0,
    deepRelative: 0,
    reverseTest: 0,
    packageInternal: 0,
  };

  // Toggle section collapse
  document.querySelectorAll('.section-header').forEach((header) => {
    header.addEventListener('click', () => {
      const key = header.getAttribute('data-toggle');
      if (!key) return;
      const body = elements[key]?.body;
      if (body) body.classList.toggle('collapsed');
    });
  });

  function esc(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function renderInsightRow(insight) {
    const sevClass = insight.severity;
    const nodes = insight.nodes || [];
    const isCycle = insight.category === 'cycle';
    let html = '<div class="insight-row" data-nodes="' + esc(JSON.stringify(nodes)) + '">';
    html += '<span class="severity-dot ' + sevClass + '"></span>';
    html += '<span class="insight-title">' + esc(insight.title) + '</span>';
    html += '<span class="metric-pill ' + sevClass + '">' + insight.metric + '</span>';
    html += '</div>';
    if (isCycle && nodes.length > 1) {
      html += '<div class="cycle-files collapsed">';
      nodes.forEach(function (n) {
        html += '<span data-file="' + esc(n) + '">' + esc(n) + '</span>';
      });
      html += '</div>';
    }
    return html;
  }

  function renderViolationRow(violation) {
    let html = '<div class="insight-row" data-file-path="' + esc(violation.sourcePath) + '" data-line="' + esc(String(violation.sourceLine || 1)) + '">';
    html += '<span class="severity-dot warn"></span>';
    html += '<span class="insight-title">' + esc(violation.title) + '</span>';
    html += '<span class="metric-pill warn">L' + esc(String(violation.sourceLine || 1)) + '</span>';
    html += '</div>';
    return html;
  }

  function renderSection(key, insights, emptyLabel) {
    const { badge, body } = elements[key];
    badge.textContent = insights.length;

    if (key === 'cycles') {
      badge.className = insights.length > 0 ? 'badge error' : 'badge';
    } else if (key === 'risky') {
      badge.className = insights.length > 0 ? 'badge error' : 'badge';
    } else if (key === 'hubs' || key === 'bloated' || key === 'unresolved' || key === 'fanOut' || key === 'layerViolations' || key === 'deepRelative' || key === 'reverseTest' || key === 'packageInternal') {
      badge.className = insights.length > 0 ? 'badge warn' : 'badge';
    }

    if (insights.length === 0) {
      body.innerHTML = '<div class="empty-state">✓ ' + esc(emptyLabel) + '</div>';
      body.classList.add('collapsed');
      return;
    }

    let html = '';
    insights.forEach(function (ins) {
      html += key === 'layerViolations' || key === 'deepRelative' || key === 'reverseTest' || key === 'packageInternal'
        ? renderViolationRow(ins)
        : renderInsightRow(ins);
    });
    body.innerHTML = html;

    // Expand sections with items (if first time)
    if (!body.classList.contains('user-toggled')) {
      body.classList.remove('collapsed');
    }

    // Restore scroll position
    body.scrollTop = currentScrollTops[key] || 0;
  }

  // Handle clicks on insight rows → open file
  document.addEventListener('click', function (e) {
    const row = e.target.closest('.insight-row');
    if (row) {
      const filePath = row.getAttribute('data-file-path');
      if (filePath) {
        vscode.postMessage({
          type: 'openFile',
          filePath: filePath,
          line: Number(row.getAttribute('data-line') || '1'),
        });
        return;
      }

      const nodes = JSON.parse(row.getAttribute('data-nodes') || '[]');
      if (nodes.length > 0) {
        // Open first file; if cycle, toggle child files visibility
        if (nodes.length > 1) {
          const next = row.nextElementSibling;
          if (next && next.classList.contains('cycle-files')) {
            next.classList.toggle('collapsed');
          }
        }
        vscode.postMessage({ type: 'openFile', nodeId: nodes[0] });
      }
      return;
    }
    // Click on a file in cycle detail
    const fileSpan = e.target.closest('[data-file]');
    if (fileSpan) {
      vscode.postMessage({ type: 'openFile', nodeId: fileSpan.getAttribute('data-file') });
    }
  });

  // Track manual toggling
  document.querySelectorAll('.section-header').forEach(function (header) {
    header.addEventListener('click', function () {
      const key = header.getAttribute('data-toggle');
      if (key && elements[key]) {
        elements[key].body.classList.add('user-toggled');
      }
    });
  });

  // ─── Messages from extension ──────────────────────────────────────────
  window.addEventListener('message', function (event) {
    var msg = event.data;
    if (msg.type === 'updateInsights') {
      disabledState.classList.add('hidden');
      sections.classList.remove('hidden');
      var d = msg.data;
      // Save current scroll positions
      Object.keys(elements).forEach(function (k) {
        currentScrollTops[k] = elements[k].body.scrollTop;
      });

      renderSection('cycles',   d.cycles,   'No cycles detected');
      renderSection('orphans',  d.orphans,  'No orphans detected');
      renderSection('hubs',     d.hubs,     'No hub files detected');
      renderSection('bloated',  d.bloated,  'No bloated files detected');
      renderSection('unresolved', d.unresolved, 'No unresolved local imports detected');
      renderSection('fanOut', d.fanOut, 'No high fan-out files detected');
      renderSection('risky', d.risky, 'No risky modules detected');
      renderSection('layerViolations', d.violations.filter(function (v) { return v.category === 'layerViolation'; }), 'No layer violations detected');
      renderSection('deepRelative', d.violations.filter(function (v) { return v.category === 'deepRelative'; }), 'No deep relative imports detected');
      renderSection('reverseTest', d.violations.filter(function (v) { return v.category === 'reverseTest'; }), 'No reverse test imports detected');
      renderSection('packageInternal', d.violations.filter(function (v) { return v.category === 'packageInternal'; }), 'No package internal violations detected');

      status.textContent =
        'Computed at ' + new Date(d.computedAt).toLocaleTimeString();
      return;
    }

    if (msg.type === 'setInsightsDisabled') {
      sections.classList.add('hidden');
      disabledState.classList.remove('hidden');
      status.textContent = 'Enable codeLensArchExplorer.insights.enabled to compute insights';
    }
  });
})();
</script>
</body>
</html>`;
  }
}
