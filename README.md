# CodeLens Architecture Explorer

> Real-time visualization of workspace file structure, code dependencies and line-count metrics — a tool for gaining architectural overview of any codebase.

## Features

| Feature | Details |
|---------|---------|
| **Live dependency graph** | Force-directed / tree / radial diagram showing import links between files |
| **Line-count badges** | Node size and colour indicate file size; configurable warning/danger thresholds |
| **Auto-refresh** | Configurable interval (default 5 s, min 1 s); uses `FileSystemWatcher` for incremental updates |
| **Interactive** | Pan, zoom, hover tooltips, fit-view, per-node details |
| **Multi-language** | TS, JS, Python, Java, C#, Go, Rust, and more |
| **Architecture boundary rules** | Detects layer violations, deep relative imports, package-internal access, and production-to-test reverse imports |

## Usage

1. Open a workspace folder
2. Click the **Architecture** icon in the VS Code Activity Bar
3. Open **Architecture Graph** in the sidebar and watch it refresh automatically
4. Optional: run **CodeLens: Show Architecture Graph** from the Command Palette (`Ctrl+Shift+P`) if you also want the graph in a separate editor panel
5. Use **CodeLens: Export Architecture Insights Report** or **CodeLens: Copy Architecture Insights Report** to generate an AI-ready Markdown brief from the current insights snapshot

## Installation

1. Run `npm run package:vsix`
2. In VS Code open Extensions view
3. Use `...` -> `Install from VSIX...`
4. Select `codelens-arch-explorer-0.4.1.vsix`

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `codeLensArchExplorer.refreshIntervalSeconds` | `5` | Auto-refresh interval (≥ 1 s) |
| `codeLensArchExplorer.maxDepth` | `10` | Maximum directory scan depth |
| `codeLensArchExplorer.includePatterns` | `["**/*.ts", ...]` | Glob patterns to include |
| `codeLensArchExplorer.excludePatterns` | `["**/node_modules/**", ...]` | Glob patterns to exclude |
| `codeLensArchExplorer.graphLayout` | `"force"` | Layout: `force` / `tree` / `radial` |
| `codeLensArchExplorer.locWarningThreshold` | `500` | LOC above this → orange node |
| `codeLensArchExplorer.locDangerThreshold` | `1000` | LOC above this → red node |
| `codeLensArchExplorer.debugLogging` | `false` | Verbose output channel logging |
| `codeLensArchExplorer.insights.enabled` | `true` | Enables Architecture Insights and boundary diagnostics |
| `codeLensArchExplorer.diagnostics.enabled` | `true` | Shows architectural warnings in the Problems panel |
| `codeLensArchExplorer.boundaries` | object | Configures layer rules, relative-depth threshold, test patterns, and internal folder names |

Insights sections remain visible with badge `0` and an empty-state message when no findings are present, including boundary categories.

## AI Report Export

The **Architecture Insights** view toolbar now includes actions to copy or export an AI-ready Markdown report. The report is designed to be pasted directly into an AI coding agent and includes:

- current graph and insight timestamps
- analysis thresholds and boundary configuration summary
- findings grouped by category with concrete evidence
- review questions for an engineering-focused AI audit

### Boundary rule example

```json
"codeLensArchExplorer.boundaries": {
  "layers": [
    { "name": "ui", "match": ["src/ui/**"] },
    { "name": "domain", "match": ["src/domain/**"] },
    { "name": "db", "match": ["src/db/**"] }
  ],
  "layerRules": [
    { "from": "ui", "canImport": ["domain"] },
    { "from": "domain", "cannotImport": ["ui", "db"] }
  ],
  "maxRelativeDepth": 3,
  "testPatterns": ["**/*.{test,spec}.{ts,tsx,js,jsx}", "**/test/**", "**/tests/**"],
  "internalFolderNames": ["internal", "_internal", "private"]
}
```

Explicit deny rules win over allow rules when both apply.

## Architecture

```
src/
├── extension.ts          # Activation entry point
├── model/
│   └── graphTypes.ts     # JSON-serialisable node/edge schema (Constitution V)
├── analysis/
│   ├── languageDetector.ts
│   ├── importExtractor.ts  # Regex-based, per-language import extraction
│   └── graphBuilder.ts     # Incremental graph maintenance (Constitution IV)
├── watcher/
│   ├── workspaceScanner.ts # Initial full scan via VS Code findFiles API
│   └── graphController.ts  # FileSystemWatcher + configurable refresh timer
├── webview/
│   ├── webviewPanel.ts     # VS Code WebviewPanel wrapper (strict CSP)
│   └── webviewHtml.ts      # Self-contained Canvas 2D renderer + force simulation
└── util/
    ├── logger.ts           # Output channel logger with debug toggle
    └── fileMatcher.ts      # Glob pattern matching for watcher events
```
