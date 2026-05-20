# Data Model: Architecture Insights + Graph Usability

**Phase**: 1 — Design
**Feature**: `001-architecture-insights-graph`
**Date**: 2026-05-20

---

## Entities

### 1. `Insight` (NEW — `src/analysis/insightTypes.ts`)

An architectural finding derived from `GraphData`. Lives in a separate module; does not modify `GraphNode` or `GraphEdge` (Constitution V).

```typescript
// src/analysis/insightTypes.ts

export type InsightCategory = 'cycle' | 'orphan' | 'hub' | 'bloated';

export type InsightSeverity = 'info' | 'warn' | 'error';

/**
 * A single architectural finding computed from the current GraphData snapshot.
 */
export interface Insight {
  /** Category: which architectural question this answers. */
  category: InsightCategory;
  /** Display title (e.g., "Cycle: A → B → C → A" or "Hub: logger.ts (47 importers)"). */
  title: string;
  /** IDs of the graph nodes involved (one or more). */
  nodes: string[];
  /** Severity level for display (cycles = error, hubs = warn, etc.). */
  severity: InsightSeverity;
  /** Numeric metric for sorting/ranking (e.g., incoming count for hubs, LOC for bloated). */
  metric: number;
  /** Optional detailed description or fix suggestion. */
  description?: string;
}
```

**Validation rules**:
- `category` must be one of the four enum values.
- `nodes` must contain at least one valid `GraphNode.id`.
- `metric` must be ≥ 0.
- `severity` is derived from `category`:
  - `'cycle'` → `'error'`
  - `'hub'` → `'warn'`
  - `'bloated'` → `'error'` if LOC ≥ `locDangerThreshold`, else `'warn'`
  - `'orphan'` → `'info'`

---

### 2. `InsightSet` (NEW — `src/analysis/insightTypes.ts`)

Aggregate result of the insight computation. Cached until `GraphData.generatedAt` changes.

```typescript
// src/analysis/insightTypes.ts

export interface InsightSet {
  cycles: Insight[];
  orphans: Insight[];
  hubs: Insight[];
  bloated: Insight[];
  /** ISO timestamp when this set was computed. */
  computedAt: string;
}
```

**Computation rules**:
1. **Cycles**: Run Tarjan SCC on `GraphData`. Each SCC with ≥ 2 nodes, or with 1 node and a self-loop edge (`source === target`), is a cycle insight. `metric` = size of SCC. `nodes` = all node IDs in the SCC.
2. **Orphans**: Nodes where in-degree = 0 AND `!matchesPatterns(absPath, entryPointPatterns, [])`. `metric` = file size in LOC. `description` = "No other file imports this module — may be dead code."
3. **Hubs**: Top N nodes by in-degree, descending. `metric` = in-degree count. `description` = "Imported by ${metric} files — candidate for refactoring into a smaller interface."
4. **Bloated**: Top N nodes by `linesOfCode`, descending, where `linesOfCode ≥ locWarningThreshold`. `metric` = LOC. `severity` = `'error'` if ≥ `locDangerThreshold`, else `'warn'`.

**Caching**: The `InsightSet` is recomputed only when `GraphData.generatedAt` differs from the cached `computedAt`. `GraphController` holds the cache as a private field.

---

### 3. `EntryPointPattern` (NEW — configuration only, no new type)

No new type. Entry-point patterns are consumed by the existing `matchesPatterns()` function from `src/util/fileMatcher.ts`. Configuration key:

```
codeLensArchExplorer.entryPointPatterns: string[]
```

Default: `["**/extension.ts", "**/index.ts", "**/main.{py,go,rs}", "**/Program.cs", "**/Main.java"]`

---

### 4. Webview Message Types (EXTENDED)

Existing `postMessage` types remain unchanged. New message types added:

| Direction | Type | Payload | Purpose |
|---|---|---|---|
| Ext → Graph WV | `update` | `{ type: 'update', data: GraphData, config: {...} }` | Unchanged |
| Graph WV → Ext | `forceRefresh` | `{ type: 'forceRefresh' }` | Unchanged |
| **Graph WV → Ext** | **`openFile`** | `{ type: 'openFile', nodeId: string }` | **NEW** — emitted on node click |
| Ext → Insights WV | `updateInsights` | `{ type: 'updateInsights', data: InsightSet, config: {...} }` | **NEW** — emitted on graph update |
| Insights WV → Ext | `openFile` | `{ type: 'openFile', nodeId: string }` | **NEW** — emitted on insight row click |

---

### 5. Existing Types (No Changes)

- `GraphNode`, `GraphEdge`, `GraphData` — **no fields added or removed** (Constitution V).
- `RawImport`, `ExtractorFn` — **interface unchanged**; behavior changes via `stripComments` pre-processing, not schema changes.

---

## State Transitions

### GraphController State

```
[Extension Activate]
      │
      ▼
  ┌───────┐   fullScan()   ┌──────────────┐
  │  Idle  │──────────────▶│  Scanning     │
  └───┬───┘                │  (async I/O)  │
      │                    └──────┬───────┘
      │                           │ scan complete
      │                           ▼
      │                    ┌──────────────┐
      │◀───────────────────│  Notifying   │
      │                    │  (sync)      │
      │                    └──────┬───────┘
      │                           │ onGraphUpdate listeners fire
      │                           │ → panel.update(data)
      │                           │ → sidebarView.update(data)
      │                           │ → insightsView.update(data, computeInsights(data))
      │                           ▼
      │                    ┌──────────────┐
      │                    │  Watching    │◀── FileSystemWatcher change/create
      │                    │  (timer)     │──▶ dirtyFiles.add(path)
      │                    └──────┬───────┘
      │                           │ refreshIntervalSeconds tick
      │                           │ processDirty() → builder.updateFile()
      │                           │ notify() with recomputed InsightSet
      │                           ▼
      │                    ┌──────────────┐
      └────────────────────│  Watching    │
                           └──────────────┘
```

### InsightSet Caching

```
GraphController.notify()
      │
      ▼
  currentData.generatedAt === lastInsightSet.computedAt?
      │                       │
      │ YES                   │ NO
      ▼                       ▼
  Use cached InsightSet    computeInsights(currentData)
      │                       │
      └───────────────────────┘
                  │
                  ▼
  insightsView.update(data, insightSet)
```

---

## Relationship Diagram

```
┌─────────────────────────────────────────────────────────┐
│ GraphData (existing, unchanged)                         │
│  nodes: GraphNode[]    edges: GraphEdge[]               │
│  generatedAt: string                                    │
└─────────────┬───────────────────────────────────────────┘
              │ consumed by
              ▼
┌─────────────────────────────────────────────────────────┐
│ InsightSet (new, derived)                               │
│  cycles: Insight[]   orphans: Insight[]                 │
│  hubs: Insight[]     bloated: Insight[]                 │
│  computedAt: string                                     │
│                                                         │
│ Insights reference GraphNode.id — no foreign key FK      │
│ violation because GraphNode is always the source of      │
│ truth and InsightSet is always recomputed from it.       │
└─────────────────────────────────────────────────────────┘
```