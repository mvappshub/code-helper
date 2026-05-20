# Webview Message Contracts

**Phase**: 1 — Design
**Feature**: `001-architecture-insights-graph`
**Date**: 2026-05-20

These contracts define the `postMessage` protocol between the extension host and the two webviews (graph + insights). The existing graph protocol is preserved; new messages are additive.

---

## Contract 1: Graph Webview ↔ Extension Host

### 1.1 Extension Host → Graph Webview: `update` (UNCHANGED)

The extension pushes a new `GraphData` snapshot with rendering config. This contract is pre-existing and not modified.

```typescript
// Direction: Extension Host → Graph Webview
{
  type: 'update';
  data: {
    nodes: Array<{
      id: string;           // workspace-relative path
      path: string;         // absolute filesystem path
      language: string;
      linesOfCode: number;
      lastModified: string; // ISO timestamp
      depth: number;
      label: string;        // basename
    }>;
    edges: Array<{
      source: string;       // node.id of importer
      target: string;       // node.id of imported
      type: 'import';       // only 'import' is emitted currently
    }>;
    generatedAt: string;    // ISO timestamp
  };
  config: {
    locWarning: number;     // ≥1, default 500
    locDanger: number;      // ≥1, default 1000
    layout: 'force' | 'tree' | 'radial';
  };
}
```

### 1.2 Extension Host → Graph Webview: `search` (NEW)

Sent when the extension-side search command is invoked (not in scope for this feature; reserved for future). Not used by the graph webview's own search input (which is client-side).

```typescript
// Direction: Extension Host → Graph Webview
{
  type: 'search';
  query: string;
}
```

### 1.3 Graph Webview → Extension Host: `forceRefresh` (UNCHANGED)

```typescript
// Direction: Graph Webview → Extension Host
{
  type: 'forceRefresh';
}
```

### 1.4 Graph Webview → Extension Host: `openFile` (NEW)

Sent when the user clicks a node (mousedown→mouseup within 250ms, distance < 5px). The extension host opens the file via `vscode.window.showTextDocument`.

```typescript
// Direction: Graph Webview → Extension Host
{
  type: 'openFile';
  nodeId: string;   // node.id from the rendered graph
}
```

**Acceptance criteria**: The extension host handler calls `showTextDocument(vscode.Uri.file(node.path), { preview: false })`. If no node matches `nodeId`, logs a debug warning and ignores.

---

## Contract 2: Insights Webview ↔ Extension Host

### 2.1 Extension Host → Insights Webview: `updateInsights` (NEW)

The extension pushes a pre-computed `InsightSet` whenever `GraphData` changes. The insights webview renders it as a structured HTML page with four collapsible sections.

```typescript
// Direction: Extension Host → Insights Webview
{
  type: 'updateInsights';
  data: {
    cycles: Array<{
      title: string;        // e.g., "Cycle: src/a.ts → src/b.ts → src/c.ts → src/a.ts"
      nodes: string[];      // GraphNode.id array in cycle order
      severity: 'error';    // always 'error' for cycles
      metric: number;       // cycle size (≥ 2)
      description?: string; // optional fix suggestion
    }>;
    orphans: Array<{
      title: string;        // e.g., "orphan: src/utils/dead.ts"
      nodes: string[];      // always single-element array
      severity: 'info';     // always 'info' for orphans
      metric: number;       // linesOfCode
      description?: string;
    }>;
    hubs: Array<{
      title: string;        // e.g., "Hub: src/logger.ts (47 importers)"
      nodes: string[];      // always single-element array
      severity: 'warn';     // always 'warn' for hubs
      metric: number;       // in-degree count
      description?: string;
    }>;
    bloated: Array<{
      title: string;        // e.g., "Bloated: src/mega.ts (1847 LOC)"
      nodes: string[];      // always single-element array
      severity: 'warn' | 'error';  // 'warn' if < locDangerThreshold, 'error' otherwise
      metric: number;       // linesOfCode
      description?: string;
    }>;
    computedAt: string;     // ISO timestamp
  };
  config: {
    topN: number;           // max items per category (default 10)
    locWarning: number;     // maps to codeLensArchExplorer.locWarningThreshold (default 500)
    locDanger: number;      // maps to codeLensArchExplorer.locDangerThreshold (default 1000)
    entryPointPatterns: string[];
  };
}
```

**Rendering contract**: The insights webview HTML:
- Renders four sections (Cycles, Orphans, Hubs, Bloated) in a vertical list.
- Each section is collapsible (header click toggles `display: none` on body).
- Each section has a badge showing item count.
- Each row displays the insight `title` and `metric` as a right-aligned pill.
- Clicking a row posts `{ type: 'openFile', nodeId }` for each `nodes[0]` (simple row) or each `nodes[i]` (cycle row expands to show individual files).
- Empty sections show a "✓ No X detected" message.
- Sections with zero items are collapsed by default.

### 2.2 Insights Webview → Extension Host: `openFile` (NEW)

Same contract as 1.4 — the extension host opens the file. The insights webview emits one `openFile` per clicked file path.

```typescript
// Direction: Insights Webview → Extension Host
{
  type: 'openFile';
  nodeId: string;
}
```

---

## Contract 3: Public TypeScript API (for testability)

### 3.1 `computeInsights` (NEW — `src/analysis/insightTypes.ts`)

```typescript
/**
 * Computes an InsightSet from the given GraphData and configuration.
 * Pure function — no side effects, no I/O.
 * Exported for unit testing.
 */
export function computeInsights(
  data: GraphData,
  options: {
    topN: number;
    locWarningThreshold: number;
    locDangerThreshold: number;
    entryPointPatterns: string[];
    fileMatcher: (absPath: string, includes: string[], excludes: string[]) => boolean;
  }
): InsightSet;
```

### 3.2 `stripComments` (NEW — `src/analysis/importExtractor.ts`)

```typescript
/**
 * Strips line comments, block comments, and string/template contents
 * from source file text. Returns a clean version safe for regex matching.
 *
 * language:
 *   'js-like' → removes //, /* */, '' strings, "" strings, `` templates
 *   'python'  → removes #, ''' ''', """ """
 *   'c-like'  → removes //, /* */
 *   'go'      → removes //, /* */, "" strings
 */
export function stripComments(content: string, language: 'js-like' | 'python' | 'c-like' | 'go'): string;
```

### 3.3 `tarjanSCC` (NEW — `src/analysis/insightTypes.ts` or `src/analysis/graphBuilder.ts`)

```typescript
/**
 * Computes all strongly connected components using Tarjan's algorithm.
 * Returns an array of SCCs, each an array of node IDs.
 * SCCs of size 1 without self-loops are filtered out by the caller.
 */
export function tarjanSCC(nodes: string[], edges: [string, string][]): string[][];
```

---

## Naming Convention Note

**Message payload keys** (`postMessage` config objects) use short form: `locWarning`, `locDanger` — optimized for the lightweight webview JS runtime.

**TypeScript API parameters** (`ComputeOptions`, VS Code settings) use full form: `locWarningThreshold`, `locDangerThreshold` — matching the existing `codeLensArchExplorer.locWarningThreshold` setting key.

The extension host is responsible for mapping between the two forms when serializing/deserializing messages. This is intentional: the webview payload is a wire format, while the TypeScript API mirrors the VS Code settings namespace.
