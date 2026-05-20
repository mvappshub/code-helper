# Research: Architecture Insights Panel + Graph Usability

**Phase**: 0 — Pre-design research
**Feature**: `001-architecture-insights-graph`
**Date**: 2026-05-20

---

## R-01 — Tarjan SCC Algorithm

**Decision**: Use Tarjan's iterative strongly-connected-components (SCC) algorithm implemented in pure TypeScript in the extension host.

**Rationale**: Tarjan SCC runs in O(V + E) time and detects all SCCs in one DFS pass. SCCs with size ≥ 1 that have at least one back-edge (i.e., size ≥ 2, or a self-loop) are the cycles we surface. On a 3,000-node / 8,000-edge graph it completes in < 10ms in Node.js. No external dependency needed — the algorithm is well-understood and trivially portable.

**Alternatives considered**:
- Floyd-Warshall (O(V³)) — rejected, too slow on large graphs.
- Johnson's algorithm — rejected, handles negative-weight graphs (irrelevant here) and more complex to implement.
- Kosaraju's SCC — equivalent correctness; slightly more memory (needs reverse graph). Tarjan preferred for single-pass simplicity.

**Implementation note**: The existing `GraphData` already exposes `nodes` and `edges` with string IDs. Tarjan receives `{ nodes: string[], edges: [string, string][] }` slices and returns `string[][]` (each inner array = one SCC with ≥ 2 members or a self-loop node).

---

## R-02 — Insights Panel as a Separate WebviewView

**Decision**: Register a second `WebviewView` (type `codeLensArchExplorer.insightsView`) inside the existing `codeLensArchExplorer` activity-bar container. It is separate from the graph `WebviewView` (`codeLensArchExplorer.sidebarView`).

**Rationale**: VS Code activity-bar containers support multiple `WebviewView` instances stacked vertically. Keeping them separate isolates HTML/JS bundle (no cross-contamination of canvas + simulation state with table state) and lets each view be collapsed/expanded independently. Sharing HTML would require complex conditional rendering and a larger payload per `postMessage`.

**Alternatives considered**:
- Single webview with tab switching — rejected; requires message routing complexity and prevents independent collapsing.
- `WebviewPanel` (editor area) — rejected; spec requires reuse of the existing activity-bar container; a panel would open in the editor column.

**Existing surface to reuse**: `ArchGraphViewProvider` is the pattern to follow for the new `InsightsViewProvider`. Both implement `vscode.WebviewViewProvider`.

---

## R-03 — Async Batch I/O for fullScan

**Decision**: Replace the synchronous `for` loop in `GraphBuilder.fullScan` with an async batched approach using `Promise.all` over groups of at most 50 concurrent `fs.promises.readFile` + `fs.promises.stat` calls.

**Rationale**: The existing `analyseFile` uses `fs.readFileSync` and `fs.statSync` synchronously inside a loop. On a 3,000-file workspace this blocks the extension host event loop for several seconds, violating Constitution IV. Node.js `fs.promises` API is available in Node 18 (the target runtime). Batch size of 50 balances I/O concurrency against OS file-descriptor limits. The `rebuildEdges` call stays synchronous (CPU-only, no I/O, runs after all reads complete).

**Alternatives considered**:
- Worker threads — rejected; complexity is not justified when the bottleneck is disk I/O, not CPU. Batched async I/O yields the event loop between batches.
- `p-limit` npm package — rejected; FR-015 prohibits new runtime dependencies. A manual batch helper (chunk array → `Promise.all`) is trivial to implement.

---

## R-04 — Import Extractor False-Positive Fixes

**Decision**: Apply a "strip before match" strategy to each extractor: strip line comments, block comments, and string/template-literal contents from the source text *before* running regex matching. Use a simple character-by-character state machine rather than a full parser.

**Rationale**: A full AST parser (TypeScript Compiler API, tree-sitter) is out of scope (FR-015, spec Out-of-Scope). A state machine that tracks `inLineComment`, `inBlockComment`, `inSingleString`, `inDoubleString`, `inTemplateLiteral` states while iterating the string is sufficient for the false-positive patterns described in F-1 through F-4. It handles nested template literals via a depth counter.

**Specific fixes per language**:

| Bug | Root cause | Fix |
|---|---|---|
| **F-1 Go** | `/"([^"]+)"/g` inside `import (…)` block matches any double-quoted string (e.g., in comments or function bodies mistakenly captured). Also `[^)]+` in block regex fails when block contains a closing paren. | Strip line comments (`//…`) and block comments (`/* … */`) from full file before running Go extractor. Also fix block regex to use lazy match `[\s\S]*?` inside `import\s*\(([\s\S]*?)\)`. |
| **F-2 Python** | `/^import\s+/gm` fires on lines starting with `#` in some edge cases and on `# import os` because `^` is line-start, not non-comment-line-start. | Strip everything from `#` to line-end (outside string literals) before running Python regexes. |
| **F-3 Java/C#** | Block-commented imports (`/* import foo; */`) are matched. | Strip `/* … */` block comments before running Java/C# regexes. |
| **F-4 JS/TS** | `import … from '…'` inside JSDoc `@example` blocks (which are `/** … */` comments) or template literals is matched. | Strip line comments, block comments, and template literal bodies before running JS/TS regexes. |

The strip function is a single shared utility `stripComments(content: string, language: 'js-like' | 'python' | 'c-like' | 'go'): string` added to `importExtractor.ts`.

---

## R-05 — Graph Click-to-Open, Search, and Hover Edge Highlight

**Decision**: All three graph improvements are surgical edits inside the existing `getWebviewHtml()` function in `webviewHtml.ts`. No new files; changes are JavaScript additions to the inline `<script>` block.

**Click-to-open**: Track `mousedown` position and timestamp. On `mouseup`, if elapsed < 250ms and distance < 5px, post `{ type: 'openFile', nodeId }` to the extension. In `extension.ts`, the existing `handleWebviewMessage` switch receives the message and calls `vscode.window.showTextDocument`.

**Search**: Add `<input id="search-input">` to the `#toolbar`. On `input` event, filter nodes by case-insensitive substring of `label` or `id`. Non-matching nodes draw with `ctx.globalAlpha = 0.1` during the `draw()` call. Clearing the input restores all nodes to full opacity.

**Hover edge highlight**: The `hoveredNode` variable already exists in the canvas state. During `draw()`, when `hoveredNode` is set, classify each edge: (a) outgoing from hovered → accent color 1 (`#4fc1ff`), (b) incoming to hovered → accent color 2 (`#ce9178`), (c) unrelated → draw with `ctx.globalAlpha = 0.1`. This replaces the current uniform edge color pass.

**Rationale**: Self-contained canvas rendering means edge highlighting requires no DOM changes beyond the draw pass. The existing `hoveredNode` detection in `mousemove` is already present.

---

## R-06 — InsightSet Computation and Caching

**Decision**: Compute insights in `GraphController` (extension host), not in the webview. Cache the last `InsightSet` keyed by `GraphData.generatedAt`. Re-compute only when a new snapshot arrives. Serialize to the webview via `postMessage`.

**Rationale**: Running Tarjan SCC in the extension host keeps the webview JS small. It also means insights are available as structured data for future command palette integration (not in scope but architecturally cleaner). The webview only renders the pre-computed `InsightSet`.

**Caching**: `GraphController` gains a private `computeInsights(data: GraphData): InsightSet` method and a `lastInsightSet` cache invalidated by `generatedAt`. The `InsightsViewProvider.update(data, insights)` receives both payloads.

---

## R-07 — Entry-Point Pattern Matching for Orphan Detection

**Decision**: Reuse `src/util/fileMatcher.ts` which already provides `matchesPatterns(absPath, includes, excludes)`. Orphan detection treats entry-point patterns as an additional include filter: a node is an orphan iff `inDegree === 0 AND !matchesEntryPatterns(node.path)`.

**Rationale**: The existing `fileMatcher` uses minimatch-compatible patterns, which is exactly what VS Code's `findFiles` uses. No new matching logic required.

---

## R-08 — Zero-New-Dependency Constraint

**Decision confirmed**: All implementations (Tarjan SCC, strip-comments state machine, async batch helper, insight HTML renderer) are self-contained TypeScript/JavaScript. No new entries in `package.json` `dependencies`.

The `vscode` API used: `vscode.window.showTextDocument(vscode.Uri.file(path))` — stable since VS Code 1.0.

---

## Open Questions — All Resolved

| Question | Resolution |
|---|---|
| Can a second `WebviewView` be added to the same activity-bar container? | Yes — `package.json` `contributes.views` is an array; add a second entry with a different `id`. |
| Does `GraphNode.linesOfCode` exist for the bloated computation? | Yes — set in `analyseFile` as `content.split('\n').length`. |
| Does `GraphNode.id` equal the workspace-relative path? | Yes — set by `toId(absPath, workspaceRoot)` = `path.relative(workspaceRoot, absPath).replace(/\\/g, '/')`. |
| Can `removeFile` stay synchronous? | Yes — it only mutates in-memory Maps, no disk access. |
| Is `hoveredNode` already tracked? | Yes — `let hoveredNode = null;` exists in `webviewHtml.ts`. |
