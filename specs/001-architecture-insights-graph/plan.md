# Implementation Plan: Architecture Insights Panel + Graph Usability

**Branch**: `001-architecture-insights-graph` | **Date**: 2026-05-20 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-architecture-insights-graph/spec.md`

## Summary

Extend CodeLens Architecture Explorer with an **Architecture Insights panel** (cycles, orphans, hubs, bloated files as sortable lists), three graph navigation fixes (click-to-open, search, hover edge highlight), async I/O compliance, and four import-extractor false-positive fixes. Zero new runtime dependencies. Three new files: `insightTypes.ts`, `insightsViewProvider.ts`, `insightTypes.test.ts`. ~550 non-test LOC across ~8 source files.

## Technical Context

**Language/Version**: TypeScript 5.x → Node.js 18+ (VS Code Extension Host)
**Primary Dependencies**: VS Code Extension API `^1.85.0` only; zero new npm deps
**Storage**: In-memory only (`Map<string, GraphNode>`, arrays, cached `InsightSet`)
**Testing**: Mocha + `assert` (tdd UI) in `src/test/suite/`; all `.test.js` files auto-discovered
**Target Platform**: VS Code Desktop ^1.85.0 (Windows/macOS/Linux)
**Performance**: Full scan 3k files < 3s non-blocking; Tarjan SCC < 10ms on 8k edges; draw < 16ms/frame
**Scale/Scope**: 1–10,000 files; 4 insight categories; top-N capped at 50

## Constitution Check

| Principle | Status |
|---|---|
| I. Real-Time Visibility | ✅ PASS — Insights subscribe to `onGraphUpdate`, recomputed on `GraphData` change |
| II. Architecture-First Visualization | ✅ PASS — Each of 4 insight categories answers a distinct architectural question |
| III. Configurability Over Hard-Coding | ✅ PASS — 3 new settings under `codeLensArchExplorer.*` |
| IV. Incremental & Performant Updates | ✅ PASS — `InsightSet` cached; `fullScan` → async; `updateFile`/`removeFile` remain sync |
| V. Extensible Graph Data Model | ✅ PASS — No changes to `GraphNode`/`GraphEdge`; `Insight` in separate module |

## Project Structure

### Documentation (this feature)

```text
specs/001-architecture-insights-graph/
├── spec.md, plan.md, research.md, data-model.md, quickstart.md
├── contracts/webview-protocol.md
└── tasks.md
```

### Source Code Changes

| File | Change | Story |
|---|---|---|
| `src/analysis/insightTypes.ts` | **NEW** — `Insight`, `InsightSet` types, `computeInsights()`, `tarjanSCC()` | US1 |
| `src/webview/insightsViewProvider.ts` | **NEW** — `WebviewViewProvider` for Insights panel | US1 |
| `src/analysis/importExtractor.ts` | MODIFIED — add `stripComments()`, fix F-1..F-4 regex bugs | Foundational |
| `src/analysis/graphBuilder.ts` | MODIFIED — async `fullScan` (batched `fs.promises`) | US3 |
| `src/watcher/graphController.ts` | MODIFIED — `computeInsights` cache, expose `getInsights()`, await async scan | US1+US3 |
| `src/webview/webviewHtml.ts` | MODIFIED — search input, click-to-open, hover edge highlight | US2 |
| `src/webview/webviewPanel.ts` | MODIFIED — forward `openFile` messages | US2 |
| `src/extension.ts` | MODIFIED — register `InsightsViewProvider`, route `openFile` messages | US1+US2 |
| `package.json` | MODIFIED — add 2nd `views` entry + 3 config keys | US1 |
| `src/test/suite/importExtractor.test.ts` | MODIFIED — F-1..F-4 comment-strip tests | Foundational |
| `src/test/suite/insightTypes.test.ts` | **NEW** — `tarjanSCC`, `computeInsights` unit tests | US1 |

## Key Design Decisions

| # | Decision | Reference |
|---|---|---|
| R-01 | Tarjan SCC for cycle detection (O(V+E), pure TS, extension host) | [research.md](./research.md) |
| R-02 | Separate `WebviewView` for Insights (same activity-bar container as graph) | [research.md](./research.md) |
| R-03 | Async batched I/O (50-concurrent `fs.promises` groups) for `fullScan` | [research.md](./research.md) |
| R-04 | `stripComments()` state machine before regex matching (F-1..F-4) | [research.md](./research.md) |
| R-05 | All three graph UX fixes are JS additions to existing `<script>` block | [research.md](./research.md) |
| R-06 | `InsightSet` cached by `GraphData.generatedAt` in `GraphController` | [research.md](./research.md) |
| R-07 | `fileMatcher.ts` reused for entry-point pattern matching | [research.md](./research.md) |


## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| [e.g., 4th project] | [current need] | [why 3 projects insufficient] |
| [e.g., Repository pattern] | [specific problem] | [why direct DB access insufficient] |
