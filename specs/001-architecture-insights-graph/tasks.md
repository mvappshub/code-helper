# Tasks: Architecture Insights Panel + Graph Usability

**Input**: Design documents from `/specs/001-architecture-insights-graph/`

**Prerequisites**: plan.md ✅, spec.md ✅, research.md ✅, data-model.md ✅, contracts/webview-protocol.md ✅

**Tests**: Included — required by Success Criteria SC-003, SC-007.

**Organization**: Tasks grouped by user story for independent implementation and testing.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., Foundational, US1, US2, US3)
- Include exact file paths in descriptions

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Verify existing project builds and tests pass before any changes

- [ ] T001 Run `npm install && npm run compile` and verify zero build errors in the existing codebase
- [ ] T002 Run `npm test` and record baseline test results — all existing tests must pass

---

## Phase 2: Foundational — Import Extractor Correctness Fixes

**Purpose**: Fix known false-positive bugs in the regex-based import extractors (F-1 through F-4) before any insight or graph feature consumes data from them.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete. Bad data makes all insights unreliable.

- [ ] T003 [P] Add `stripComments()` state-machine utility in `src/analysis/importExtractor.ts` — strips line comments, block comments, and string/template-literal contents for languages: `'js-like'`, `'python'`, `'c-like'`, `'go'`
- [ ] T004 [depends on T003] Fix F-1: Apply `stripComments(content, 'go')` before Go extractor regex; fix block regex from `import\s*\(([^)]+)\)` to `import\s*\(([\s\S]*?)\)` to handle nested parens, and restrict `"([^"]+)"` to only paths inside `import (...)` blocks in `src/analysis/importExtractor.ts`
- [ ] T005 [depends on T003] Fix F-2: Apply `stripComments(content, 'python')` before Python extractor regex to prevent `# import os` false positives in `src/analysis/importExtractor.ts`
- [ ] T006 [depends on T003] Fix F-3: Apply `stripComments(content, 'c-like')` before Java and C# extractors to prevent `/* import foo; */` false positives in `src/analysis/importExtractor.ts`
- [ ] T007 [depends on T003] Fix F-4: Apply `stripComments(content, 'js-like')` before JS/TS extractor to prevent JSDoc `@example` and template-literal false positives in `src/analysis/importExtractor.ts`
- [ ] T008 Add test fixtures for F-1..F-4 in `src/test/suite/importExtractor.test.ts`: Go file with string literal inside function body (must not emit edge), Python file with `# import os` (must not emit edge), Java file with `/* import foo; */` (must not emit edge), TypeScript file with import inside JSDoc `@example` block (must not emit edge)
- [ ] T008b [P] Add observability: ensure `stripComments()` and each fixed extractor honor `codeLensArchExplorer.debugLogging` — emit debug-level log entries via `Logger` when the setting is enabled (extractor name + file path on invocation)

**Checkpoint**: All extractor false positives fixed — verified by tests. Data foundation is trustworthy. User story implementation can now begin.

---

## Phase 3: User Story 1 — Architecture Insights Panel (Priority: P1) 🎯 MVP

**Goal**: A new webview panel in the Architecture activity-bar container that lists cycles, orphans, hubs, and bloated files as sortable, clickable rows. Clicking a row opens the file.

**Independent Test**: Open the panel on a workspace with a known cycle (test fixture `src/test/suite/fixtures/cyclic-project/`). Verify the Cycles section lists the cycle with all file paths without any other UI interaction.

### Tests for User Story 1

- [ ] T009 [P] [US1] Create test fixture directory `src/test/suite/fixtures/cyclic-project/` with files `a.ts` (imports `./b`), `b.ts` (imports `./c`), `c.ts` (imports `./a`) — a deliberate 3-way cycle for cycle-detection tests
- [ ] T010 [P] [US1] Create unit tests for `tarjanSCC()` in `src/test/suite/insightTypes.test.ts` — test: empty graph (no SCC), single-node graph (no cycles), simple 2-node cycle (A↔B), 3-way cycle (A→B→C→A), self-loop (node importing itself), two disconnected cycles in one graph
- [ ] T011 [P] [US1] Create unit tests for `computeInsights()` in `src/test/suite/insightTypes.test.ts` — test: cycle detection returns correct nodes and severity, orphan detection respects entry-point patterns, hub ranking by in-degree descending, bloated ranking by LOC with warning/danger thresholds, empty InsightSet when graph has zero issues

### Implementation for User Story 1

- [ ] T012 [depends on T013] [US1] Create `src/analysis/insightTypes.ts` — export `Insight`, `InsightSet` interfaces per data-model.md; export `computeInsights()` pure function (takes `GraphData` + options, returns `InsightSet`); implement cycle detection by calling `tarjanSCC()` from T013 and converting each SCC with size ≥ 2 (or self-loop) into an `Insight[]` with title/severity/metric; implement orphan detection via `inDegree === 0 && !matchesEntryPattern`; implement hub ranking via in-degree sort + top-N; implement bloated ranking via LOC sort + threshold + top-N
- [ ] T013 [P] [US1] Implement `tarjanSCC()` in `src/analysis/insightTypes.ts` — iterative Tarjan's SCC algorithm on `{ nodes: string[], edges: [string, string][] }`, returns `string[][]` where each inner array is an SCC with ≥ 2 nodes or a self-loop
- [ ] T014 [US1] Wire `computeInsights()` into `src/watcher/graphController.ts` — add `private lastInsightSet: InsightSet | null`, call `computeInsights()` in `notify()` only when `generatedAt` changed, add public `getInsights(): InsightSet`, read new settings (`entryPointPatterns`, `insights.topN`, `insights.enabled`)
- [ ] T015 [P] [US1] Add `codeLensArchExplorer.insightsView` view to `package.json` under `contributes.views.codeLensArchExplorer` (second entry in the array); add 3 configuration keys: `codeLensArchExplorer.entryPointPatterns` (array of strings, default `["**/extension.ts","**/index.ts","**/main.{py,go,rs}","**/Program.cs","**/Main.java"]`), `codeLensArchExplorer.insights.topN` (number, default 10, min 1, max 50), `codeLensArchExplorer.insights.enabled` (boolean, default true)
- [ ] T016 [P] [US1] Create `src/webview/insightsViewProvider.ts` — implement `vscode.WebviewViewProvider`; generate self-contained HTML with 4 collapsible sections (Cycles/Orphans/Hubs/Bloated), each section showing row count badge, each row showing title + metric pill, click-to-open via `postMessage({ type: 'openFile', nodeId })`, empty "✓ No X detected" states, empty sections collapsed by default; on `updateInsights` message, preserve each section's current `scrollTop` and maintain sort order (default: each section sorted by `metric` descending)
- [ ] T017 [US1] Register `InsightsViewProvider` in `src/extension.ts` — create `ArchInsightsViewProvider` instance, register via `vscode.window.registerWebviewViewProvider('codeLensArchExplorer.insightsView', provider)`, subscribe to `onGraphUpdate` to push `{ type: 'updateInsights', data: insightSet, config }` to insights view, route `openFile` messages from insights view to `vscode.window.showTextDocument(vscode.Uri.file(path))`

**Checkpoint**: US1 complete — Insights panel shows cycles, orphans, hubs, bloated when the Architecture activity bar is opened. Panel is independently testable as the MVP.

---

## Phase 4: User Story 2 — Graph Navigation Improvements (Priority: P2)

**Goal**: Click a graph node to open its file, search nodes by name, see connected edges highlighted on node hover.

**Independent Test**: On any workspace with the graph webview open: (a) click a node → file opens, (b) type "auth" in search → non-matching nodes dim, (c) hover a node → connected edges color differently.

### Implementation for User Story 2

- [ ] T018 [P] [US2] Add click-to-open in `src/webview/webviewHtml.ts` — track `mousedown` position and timestamp in canvas state; on `mouseup`, if elapsed < 250ms AND distance < 5px AND click lands on a node, post `{ type: 'openFile', nodeId: node.id }` via `vscode.postMessage`
- [ ] T019 [P] [US2] Add search filter in `src/webview/webviewHtml.ts` — add `<input id="search-input" type="text" placeholder="Search nodes…">` to `#toolbar` div; on `input` event, filter nodes by case-insensitive substring match on `label` or `id`; in `draw()`, non-matching nodes rendered with `ctx.globalAlpha = 0.1`; clearing input restores all to `ctx.globalAlpha = 1.0`
- [ ] T020 [P] [US2] Add hover edge highlight in `src/webview/webviewHtml.ts` — in `draw()` edge-rendering loop, when `hoveredNode` is set: classify each edge as outgoing (source === hovered) → draw in `#4fc1ff`, incoming (target === hovered) → draw in `#ce9178`, unrelated → draw with `ctx.globalAlpha = 0.1`; when `hoveredNode` is null, all edges draw at default color + full opacity
- [ ] T021 [US2] Handle `openFile` messages in `src/webview/webviewPanel.ts` — in `ArchGraphPanel` constructor or setup, register message handler that checks `msg.type === 'openFile'` and forwards to extension host via a callback; OR pass handler through existing `onDidReceiveMessage` mechanism in `src/webview/webviewPanel.ts` (the `onDidReceiveMessage` API already exists — add `openFile` case to the handler in `src/extension.ts`)

**Checkpoint**: US2 complete — graph webview is now interactive: click opens file, search filters nodes, hover reveals edges. Independent from US1; testable without the Insights panel.

---

## Phase 5: User Story 3 — Async File I/O for UI Responsiveness (Priority: P3)

**Goal**: `fullScan` no longer blocks the VS Code UI thread. `fs.readFileSync` and `fs.statSync` replaced with async equivalents in batched groups of 50.

**Independent Test**: On a synthetic workspace of 3,000 files, run `CodeLens: Force Refresh` and verify VS Code remains responsive (cursor movement, file open, command palette) during scan.

### Implementation for User Story 3

- [ ] T022 [US3] Refactor `analyseFile` to `analyseFileAsync` in `src/analysis/graphBuilder.ts` — replace `fs.statSync(absPath)` with `await fs.promises.stat(absPath)`, replace `fs.readFileSync(absPath, 'utf8')` with `await fs.promises.readFile(absPath, 'utf8')`; keep the same node-creation and `_rawImports` side-channel logic; wrap in try/catch (same skip-on-error behavior)
- [ ] T023 [US3] Refactor `fullScan` to async batched in `src/analysis/graphBuilder.ts` — add new `async fullScanAsync(files: string[], config: ScanConfig): Promise<GraphData>` method that: (1) splits files into chunks of 50, (2) for each chunk, `await Promise.all(chunk.map(f => this.analyseFileAsync(f, config.workspaceRoot)))`, (3) after all chunks, calls `rebuildEdges()` and returns `snapshot()`; keep old sync `fullScan()` for backwards compatibility (delegates to `updateFile` which stays sync)
- [ ] T024 [US3] Update `src/watcher/graphController.ts` to use async scan — change `fullScan()` method to `async fullScan(): Promise<void>` with `await this.builder.fullScanAsync(...)`; change `forceRefresh()` to `async forceRefresh(): Promise<void>`; `start()` already `await`s `fullScan()` (no signature change needed at call site); `getConfig()` returns `ScanConfig` — ensure it passes through correctly

**Checkpoint**: US3 complete — initial scan and force refresh are non-blocking. Incremental updates (`updateFile`/`removeFile`) remain synchronous (correct — single file, no I/O in hot path).

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Final validation, constitution compliance, and documentation

- [ ] T025 [P] Run `npm run compile` — verify zero TypeScript errors across all modified and new files
- [ ] T026 [P] Run `npm run lint` — verify zero new lint warnings
- [ ] T027 Run `npm test` — ALL existing tests pass AND new tests (importExtractor F-1..F-4, insightTypes tarjanSCC + computeInsights) pass; if synthetic-performance fixtures are available, also verify SC-002 (3,000 files < 100ms input lag) and SC-005 (insight render < 500ms)
- [ ] T028 [P] Verify Constitution IV compliance: confirm `fullScan` path uses `fs.promises` (no `readFileSync`/`statSync` in loop), confirm `updateFile`/`removeFile` are called incrementally from `processDirty`, confirm `InsightSet` is cached and only recomputed on `generatedAt` change
- [ ] T029 [P] Verify zero new runtime dependencies: `grep '"dependencies"' package.json` shows no new entries beyond `vscode`
- [ ] T030 [P] Package `.vsix` with `npx vsce package` and verify size under 10 MB
- [ ] T031 [P] Add observability: verify `src/webview/insightsViewProvider.ts` logs activation to output channel on `resolveWebviewView`; verify all new code paths (`computeInsights`, `tarjanSCC`, `stripComments`, `analyseFileAsync`, `Insights` message handler) honor `codeLensArchExplorer.debugLogging` — emit debug logs only when enabled

---

## Dependencies

```
Phase 1 (Setup)
   │
   ▼
Phase 2 (Foundational — extractor fixes)
   │
   ├──────────────────────────────┐
   ▼                              ▼
Phase 3 (US1 — Insights Panel)   Phase 4 (US2 — Graph Nav)
   │                              │
   │                              │
   ├──────────────────────────────┘
   ▼
Phase 5 (US3 — Async I/O)  ← depends on Phase 3 (shares graphController.ts changes)
   │
   ▼
Phase 6 (Polish)
```

- **US1 depends on**: Phase 2 (extractor fixes — insights consume cleaned data).
- **US2 depends on**: Phase 2 only (not on US1 — graph improvements are independent of the insights panel).
- **US3 depends on**: Phases 2+3 only insofar as it shares `graphController.ts`; functionally independent otherwise.
- **US1 and US2 can be implemented in parallel** after Phase 2.

## Parallel Execution Examples

### Within Phase 2 (Foundational)

All extractor fix tasks (T004, T005, T006, T007) can run in parallel — they touch different branches of the same `importExtractor.ts` or are independent extractors. T003 (`stripComments`) should complete first since they depend on it, but it can be written alongside them.

### Within Phase 3 (US1)

```
T009 (test fixture) ──┐
T010 (tarjan tests) ──┤── can all run in parallel
T011 (insight tests) ─┘
                      │
T012 (insightTypes) ──┤── parallel with tests
T013 (tarjanSCC)   ──┘
                      │
T014 (controller) ────┤── depends on T012+T013
T015 (package.json) ──┤── parallel with T014, T016
T016 (provider)     ──┘
                      │
T017 (extension.ts) ──┘── depends on T014+T015+T016
```

### Within Phase 4 (US2)

```
T018 (click-to-open) ──┐
T019 (search input)  ──┤── all three can run in parallel (different code sections in webviewHtml.ts)
T020 (hover edges)   ──┘
                      │
T021 (panel handler) ──┘── depends on T018 for the openFile message wiring
```

### US1 and US4 (sic - US2) in parallel

After Phase 2 completes, all of Phase 3 and Phase 4 can execute in parallel — they touch different files with zero shared mutable state.

## Implementation Strategy

### MVP First (Phase 1 + Phase 2 + Phase 3 = US1 only)

1. Complete Setup (T001–T002) — verify clean baseline.
2. Complete Foundational (T003–T008) — fix extractor bugs, add tests.
3. Complete US1 (T009–T017) — ship the Insights panel as the MVP.
4. **Stop and validate**: US1 alone delivers the primary value proposition (architecture insights VS Code itself cannot produce). Graph improvements (US2) and async I/O (US3) are enhancements that can ship later.

### Incremental Delivery

| Milestone | What ships | User-facing value |
|---|---|---|
| M1: US1 | Insights panel (cycles, orphans, hubs, bloated) | Developer can identify architectural problems without scanning a graph |
| M2: +US2 | Graph click-to-open, search, hover highlight | Graph becomes usable for navigation on 100–300 node projects |
| M3: +US3 | Async full scan | No UI freeze on large (3,000+) file codebases |
