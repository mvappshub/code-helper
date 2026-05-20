import * as vscode from 'vscode';

export function getWebviewHtml(
  webview: vscode.Webview,
  extensionUri: vscode.Uri
): string {
  const cssUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, 'src', 'webview', 'assets', 'graphWebview.css')
  );
  const scriptUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, 'src', 'webview', 'assets', 'graph-main.js')
  );

  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none';
             script-src ${webview.cspSource};
             style-src ${webview.cspSource};
             img-src ${webview.cspSource} data:;" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Architecture Graph</title>
  <link rel="stylesheet" href="${cssUri}" />
</head>
<body>
  <div id="toolbar">
    <select id="layout-select">
      <option value="force">Force-directed</option>
      <option value="tree">Tree</option>
      <option value="radial">Radial</option>
    </select>
    <button id="btn-fit">Fit view</button>
    <input id="search-input" type="text" placeholder="Search nodes…" />
    <span id="status">—</span>
  </div>

  <div id="canvas-wrap">
    <canvas id="graph-canvas"></canvas>
    <div id="tooltip"></div>
    <div id="empty-state">
      <div class="card">
        <p>No files matched current include/exclude patterns.</p>
        <button id="btn-open-settings">Open Settings</button>
      </div>
    </div>
  </div>

  <div id="legend">
    <div class="legend-item"><span class="legend-dot normal"></span>Normal</div>
    <div class="legend-item"><span class="legend-dot warning"></span>Warning LOC</div>
    <div class="legend-item"><span class="legend-dot danger"></span>Danger LOC</div>
    <div class="legend-item"><span class="legend-dot cycle"></span>Cycle</div>
    <div class="legend-item"><span class="legend-dot hub"></span>Hub</div>
    <div class="legend-item"><span class="entrypoint-indicator"></span> entry point</div>
    <div class="legend-item"><span class="import-line"></span> import</div>
  </div>

  <script type="module" src="${scriptUri}"></script>
</body>
</html>`;
}
