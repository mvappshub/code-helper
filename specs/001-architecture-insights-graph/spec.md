# Feature Specification: Architecture Insights Panel + Graph Usability

**Feature Branch**: `001-architecture-insights-graph`

**Created**: 2026-05-20

**Status**: Draft

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Architecture Insights Panel (Priority: P1, MVP)

**As a** developer onboarding to or refactoring an unfamiliar codebase,
**I want** a single panel that lists the architectural problems in my workspace,
**so that** I can identify cycles, dead files, hubs, and bloated files without manually scanning a graph.

**Why this priority**: This is the only story that delivers insights VS Code itself cannot produce. The graph view is a secondary "nice to have"; this panel is the primary value proposition. Without it the extension is a graph viewer; with it, it is an architecture analysis tool.

**Independent Test**: Open the panel on any workspace with known architectural issues (e.g., a deliberate cycle). Verify the panel lists the issue without any other UI interaction.

**Acceptance Scenarios**:

1. **Given** a workspace containing files A→B→C→A (cycle), **when** the user opens the Architecture Insights panel, **then** the Cycles section lists one entry containing all three file paths.
2. **Given** a workspace where `utils/unused.ts` is not imported anywhere and is not an entry point, **when** the panel opens, **then** `utils/unused.ts` appears in the Orphans section.
3. **Given** a workspace where `logger.ts` is imported by 47 other files, **when** the panel opens, **then** `logger.ts` appears at or near the top of the Hubs section with its incoming count.
4. **Given** a file `mega.ts` exceeding the configured `locWarningThreshold`, **when** the panel opens, **then** `mega.ts` appears in the Bloated section.
5. **Given** any insight row in the panel, **when** the user clicks the row, **then** the corresponding file opens in the active editor at line 1.
6. **Given** the panel is open and a file is saved in the workspace, **when** the next refresh tick fires, **then** the insight lists update without losing scroll position or column sort (default sort: each section sorted by `metric` descending — cycles by cycle size, hubs by incoming count, bloated by LOC, orphans by LOC).
7. **Given** the workspace has zero cycles, **when** the panel opens, **then** the Cycles section shows a clear "✓ No cycles detected" empty state, not a blank table.

---

### User Story 2 — Graph Navigation Improvements (Priority: P2)

**As a** developer exploring the architecture graph,
**I want** to click a node to open the file, search for nodes by name, and visually see a node's connected edges on hover,
**so that** the graph is a usable navigation tool rather than a static picture.

**Why this priority**: Independent from US1. These three changes each require a small surgical edit to the existing webview and turn the graph from demo-only into a useful tool for codebases with 100–300 files.

**Independent Test**: With US1 not implemented, on any workspace: (a) clicking a node opens its file, (b) typing in a search input dims non-matching nodes, (c) hovering a node colors its connected edges differently from unrelated edges.

**Acceptance Scenarios**:

1. **Given** the graph webview is open, **when** the user clicks a node (mouseup within 250ms and < 5px from mousedown), **then** the corresponding file opens in the editor via the extension's open-file command.
2. **Given** the graph contains 200 nodes, **when** the user types "auth" into the search input, **then** nodes whose label or id contains "auth" (case-insensitive) remain fully opaque while the rest fade to ~10% opacity.
3. **Given** the search input is cleared, **when** it becomes empty, **then** all nodes return to their default opacity.
4. **Given** the user hovers a node X, **when** the renderer redraws, **then** edges where X is source are drawn in one accent color, edges where X is target are drawn in a second accent color, and all other edges fade to low opacity.
5. **Given** the user moves the cursor off any node, **when** the renderer redraws, **then** all edges return to their default color.

---

### User Story 3 — Async File I/O for UI Responsiveness (Priority: P3)

**As a** developer working on a large codebase (1,000+ files),
**I want** the initial scan and full refresh to not block the VS Code UI thread,
**so that** I can keep coding while the graph builds in the background.

**Why this priority**: Current synchronous disk reads freeze VS Code for seconds on large projects. This is a correctness fix (violates the project's own design principles) with measurable user impact on projects above ~500 files.

**Independent Test**: On a synthetic workspace of 3,000 files, run Force Refresh and verify VS Code commands (cursor movement, file open, command palette) remain responsive during the scan.

**Acceptance Scenarios**:

1. **Given** a workspace of 3,000 source files, **when** the full scan runs, **then** typing in any open editor remains responsive with no perceptible input lag above 100ms.
2. **Given** a workspace of any size, **when** a single file changes and the incremental update runs, **then** the updated graph data reaches the webview within the configured refresh interval.
3. **Given** the file-deletion code path, **when** a file is deleted, **then** the graph updates synchronously (this path does not read disk and stays synchronous).

---

### Foundational Work — Import Extractor Correctness (Pre-requisite for all stories)

**As a** user of any of the above features,
**I want** the dependency graph to contain only real import relationships,
**so that** insights and visualizations are not polluted by false-positive edges from comments, string literals, or misapplied regexes.

**Why this priority**: Every story above consumes the output of the import extractor. Bad data makes all insights and visualizations unreliable. These fixes must land before any story ships.

**Acceptance Scenarios**:

1. **Given** a Go file with a string literal containing an import-like path inside a function body, **when** the extractor runs, **then** no dependency edge is emitted for that string.
2. **Given** a Python file with `# import os` (a commented-out import), **when** the extractor runs, **then** no dependency edge is emitted for `os`.
3. **Given** a Java or C# file with `/* import foo.bar; */` (a block-commented import), **when** the extractor runs, **then** no dependency edge is emitted for `foo.bar`.
4. **Given** a TypeScript file with an `import` statement inside a JSDoc `@example` block or template literal, **when** the extractor runs, **then** no dependency edge is emitted.

---

### Edge Cases

- **Empty workspace**: panel shows "No files matched current include/exclude patterns" with a settings link.
- **Self-loop** (file imports itself): treated as a cycle of length 1 in the Cycles section.
- **Multiple disconnected entry points**: Orphan detection respects all configured entry-point patterns, not just the first match.
- **Ambiguous basenames** (same filename in two folders): all panel rows display the workspace-relative path, not just the basename.
- **Symbolic links**: respected only if VS Code's file-finder resolves them; no additional traversal.
- **File reading fails** (permissions, encoding): the file is silently skipped; insights are computed on remaining files.
- **Panel vs. in-flight builder state**: the panel reads from a stable `GraphData` snapshot, not from in-flight builder state, to avoid race conditions.
- **Search input with regex-special characters**: treated as literal substring, not regex, to prevent unexpected behavior.

---

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST compute the insight set from the current graph data snapshot whenever the snapshot changes, and only then.
- **FR-002**: System MUST detect circular dependencies using Tarjan's strongly-connected-components algorithm, running in linear time relative to nodes and edges. Each detected cycle MUST list all nodes in the cycle in discovery order.
- **FR-003**: System MUST identify orphan files as nodes with zero incoming edges that do not match any configured entry-point pattern.
- **FR-004**: System MUST identify hub files as the top N files ranked by incoming-edge count (descending), where N is configurable (default 10).
- **FR-005**: System MUST identify bloated files as files whose line count exceeds the configured `codeLensArchExplorer.locWarningThreshold` (default 500), sorted descending; the top N (default 10) are shown.
- **FR-006**: System MUST render the insight set in a webview panel registered under the existing `codeLensArchExplorer` view container, with four collapsible sections for cycles, orphans, hubs, and bloated files.
- **FR-007**: System MUST open the corresponding file in the active editor when the user clicks any insight row (or any file within a cycle's expanded detail).
- **FR-008**: System MUST emit an open-file message from the graph webview when a user clicks a node, distinguishing click from pan via a 5-pixel distance threshold and 250ms time threshold.
- **FR-009**: System MUST provide a search input in the graph webview toolbar that filters node visibility by case-insensitive substring match on node label or id, with perceived latency no greater than 100ms on graphs up to 1,000 nodes.
- **FR-010**: System MUST visually distinguish edges connected to the currently hovered node — incoming in one accent color, outgoing in a second accent color — from non-connected edges (faded), redrawing on hover state change.
- **FR-011**: System MUST perform initial workspace file reads asynchronously, batched in groups of at most 50 concurrent reads, to avoid blocking the extension host thread.
- **FR-012**: Import extractors for Go, Python, Java, C#, and JS/TS MUST strip line comments, block comments, and string-literal contents from file content before regex matching, so that `import`-like keywords inside comments or string literals do not produce false-positive edges.
- **FR-013**: Three new configuration keys MUST be added under the existing `codeLensArchExplorer.*` namespace:
  - `codeLensArchExplorer.entryPointPatterns` — array of glob strings (default: `["**/extension.ts", "**/index.ts", "**/main.{py,go,rs}", "**/Program.cs", "**/Main.java"]`)
  - `codeLensArchExplorer.insights.topN` — number, default 10, min 1, max 50
  - `codeLensArchExplorer.insights.enabled` — boolean, default `true`
  The bloated-file computation (FR-005) reuses the existing `codeLensArchExplorer.locWarningThreshold` (default 500) and `codeLensArchExplorer.locDangerThreshold` (default 1000) keys — no new keys are needed for thresholds. When `insights.enabled` is `false`, the Insights view shows a placeholder message "Insights disabled via settings" and no `computeInsights` calls are made.
- **FR-014**: The Insights panel and the existing graph panel MUST share a single graph data source with no duplicate scanning and no separate refresh cycles; both subscribe to the same graph-update event.
- **FR-015**: System MUST NOT introduce any new runtime npm dependency. All implementation uses the existing dependency surface.

---

### Key Entities

- **Insight**: A structured finding with `category` (`'cycle' | 'orphan' | 'hub' | 'bloated'`), `title` (human-readable summary, e.g., "Cycle: A→B→C→A"), `nodes` (one or more node IDs), `severity` (`'info' | 'warn' | 'error'`), `metric` (e.g., incoming edge count for hubs; line count for bloated), and `description` (optional — fix suggestion or explanation). Derived from graph data without extending the node or edge schema.
- **InsightSet**: Aggregate result `{ cycles, orphans, hubs, bloated, computedAt }`. Recomputed when graph data changes; cached otherwise.
- **EntryPointPattern**: A glob string (configurable) identifying files that must never appear in the Orphans list regardless of their incoming-edge count.

---

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: On a workspace with a known cycle (test fixture with files A↔B), the Insights panel correctly lists the cycle within one refresh interval of opening the panel.
- **SC-002**: On a workspace of 3,000 source files, a full refresh does not produce a measurable input-lag spike above 100ms in any open editor.
- **SC-003**: With all four extractor fixes applied, no edge is emitted for a file whose only mention of an import target appears in a comment or string literal (verified by test fixtures).
- **SC-004**: On a graph of 200 nodes, hovering any node visually distinguishes its connected edges within 16ms of the mouse-move event (one frame at 60 Hz).
- **SC-005**: The Insights panel renders the first batch of results (cycles, orphans, top-10 hubs, top-10 bloated) within 500ms of graph data becoming available, on a 3,000-file workspace.
- **SC-006**: Zero new runtime dependencies appear in `package.json`'s `dependencies` field (devDependencies for test fixtures are permitted).
- **SC-007**: All existing unit tests pass after implementation, and new tests cover: cycle detection (including self-loops and disjoint cycles), orphan detection with entry-point exclusion, hub ranking, bloated ranking, and each extractor's comment/string-stripping behavior.

---

## Assumptions

- The Insights panel reuses the existing `codeLensArchExplorer` activity-bar container; no new container is introduced.
- The cycle-detection (Tarjan SCC) implementation runs in the extension host (not the webview) and serializes results over the standard webview message channel.
- The Insights panel webview and the graph webview are separate webview instances within the same view container, keeping their HTML/JS isolated.
- Entry-point pattern matching reuses the existing `src/util/fileMatcher.ts` utility already used for include/exclude patterns.
- Test fixtures for cycle detection and extractor edge cases are added to `src/test/suite/` following the existing test scaffolding.
- The feature targets a single workspace folder; if multiple folders are open, the extension continues to use the first one (existing behavior unchanged).
- The VS Code engine target remains at `^1.85.0`; no new VS Code API requirements are introduced.

---

## Out of Scope

The following are explicitly excluded from this feature:

- Replacing the JS/TS regex extractor with the TypeScript Compiler API.
- Folder/package-level node aggregation in the graph.
- Exporting the graph as SVG or PNG.
- Pinning node positions across sessions.
- Path-finding between two selected nodes.
- Barnes-Hut quadtree force simulation.
- Minimap / thumbnail navigation.
- Force-directed edge bundling.
- Migrating hard-coded node colors to VS Code theme tokens.
- Persisting viewport state across sessions.
- Adding `'reference'` or `'export'` edge types to runtime emission.
