<!--
SYNC IMPACT REPORT
==================
Version change: (none) → 1.0.0  — initial constitution, all tokens replaced
Added sections: Core Principles (I–V), Technical Constraints, Development Workflow, Governance
Removed sections: none (first authoring)
Modified principles: n/a (new project)
Templates updated:
  ✅ constitution.md — filled (this file)
  ✅ plan-template.md — Constitution Check gate references updated (no edits needed; gates listed below apply)
  ✅ spec-template.md — no structural changes required; section ordering compatible
  ✅ tasks-template.md — observability and refresh-interval task types added as expected task categories
Deferred TODOs: none
-->

# CodeLens Architecture Explorer Constitution

## Core Principles

### I. Real-Time Visibility (NON-NEGOTIABLE)

The extension MUST continuously reflect the live state of the workspace.
Every visualization (dependency graph, file-tree diagram, line-count metrics)
MUST refresh automatically based on a user-configurable polling interval.
The default refresh interval is 5 seconds; the minimum MUST NOT be lower than
1 second to avoid thrashing the file-system. Configuration key:
`codeLensArchExplorer.refreshIntervalSeconds`.

**Rationale**: The primary purpose of the tool is architectural awareness — stale
data defeats that purpose entirely. Configurability prevents performance problems
on large codebases.

### II. Architecture-First Visualization

Every rendered diagram MUST answer at least one of the following architectural
questions: (a) what files/modules exist, (b) how are they connected at the code
level (imports, requires, exports, class references), (c) how large is each unit
(lines of code). Purely decorative visuals are prohibited. The graph or chart
format (tree, force-directed, sunburst, etc.) MUST be chosen based on the
information type being conveyed, not aesthetics.

**Rationale**: This is a design-intelligence tool, not a dashboard widget.
Every rendered element must earn its place by answering an architectural question.

### III. Configurability Over Hard-Coding

Every performance-sensitive or user-preference parameter MUST be exposed as a
VS Code setting with sensible defaults. This includes: refresh interval,
maximum file depth for scanning, file-type inclusion/exclusion patterns,
graph layout algorithm, and LOC warning thresholds.
Hard-coded limits are a build error unless documented with a technical
justification in a code comment.

**Rationale**: Codebases range from a handful of files to hundreds of thousands.
A one-size-fits-all approach will either miss large projects or overwhelm
small ones.

### IV. Incremental & Performant Updates

The extension MUST NOT re-scan the entire workspace on every refresh tick.
It MUST use VS Code's `FileSystemWatcher` API for change detection and only
re-analyse files that have changed since the last scan. Full re-scan is
permitted only on initial activation or explicit user-triggered refresh.
Background scanning MUST NOT block the VS Code UI thread.

**Rationale**: Blocking the editor for visualization is unacceptable. Incremental
updates are a hard architectural requirement, not an optimisation to add later.

### V. Extensible Graph Data Model

The internal graph representation MUST be serialisable to JSON and MUST be
decoupled from any specific chart library. The rendering layer (e.g., D3.js,
vis.js, ECharts) is pluggable. The data model MUST support nodes (files/modules)
with at minimum: `id`, `path`, `language`, `linesOfCode`, `lastModified`; and
edges with at minimum: `source`, `target`, `type` (import | reference | export).

**Rationale**: Locking the data model to a chart library prevents future migration
and makes unit-testing the analysis layer impossible without a DOM.

## Technical Constraints

- **Language / Runtime**: TypeScript 5.x targeting VS Code Extension Host (Node.js 18+).
- **VS Code API minimum**: `^1.85.0` — use stable APIs only; no proposed APIs in
  production code paths.
- **Chart library**: Any MIT/Apache-2 licensed web-based chart library rendered
  inside a `WebviewPanel`. The library MUST support dynamic data updates without
  full DOM replacement.
- **File parsing**: Language-agnostic import detection via regex/AST; full AST
  parsing (TypeScript compiler API or tree-sitter) is preferred for `.ts`/`.js`
  but MUST gracefully degrade to regex for unsupported languages.
- **Performance budget**: Initial scan of 1 000 files MUST complete within 3 seconds
  on a modern developer machine (SSD, 8-core CPU). Incremental update for a single
  changed file MUST complete within 200 ms.
- **Bundle size**: Packaged `.vsix` MUST remain under 10 MB excluding `node_modules`
  vendored inside the webview.
- **Security**: The Webview MUST set a strict `Content-Security-Policy`. No remote
  script sources. All assets served from extension-local URIs via
  `webview.asWebviewUri`.

## Development Workflow

- **Branching**: Feature branches follow the pattern `###-short-description`
  (managed by `speckit.git.feature`). Direct commits to `main` are prohibited.
- **Constitution Check gate** (enforced in every `plan.md`):
  1. ✅ Does the feature keep visualizations real-time (Principle I)?
  2. ✅ Does every new visual element answer an architectural question (Principle II)?
  3. ✅ Are all new parameters exposed as VS Code settings (Principle III)?
  4. ✅ Does the implementation use incremental updates / FileSystemWatcher (Principle IV)?
  5. ✅ Does any new graph data conform to the defined node/edge schema (Principle V)?
- **Testing discipline**: Unit tests MUST cover the graph-analysis layer independently
  of the Webview. Integration tests MUST verify that a file-system change triggers
  a graph update within the performance budget.
- **Observability tasks** are mandatory in every feature's task list:
  include at minimum an activation-time log entry and a configurable
  verbose/debug mode setting (`codeLensArchExplorer.debugLogging`).
- **Code review**: Every PR MUST include a screenshot or recorded GIF demonstrating
  the real-time refresh behaviour for the changed feature.

## Governance

This constitution supersedes all other practices and conventions for the
CodeLens Architecture Explorer project. Amendments require:
1. A written rationale explaining why the change is necessary.
2. An updated version number following semantic versioning rules defined below.
3. A migration plan if any existing feature violates the new rule.

**Versioning policy**:
- MAJOR bump: removal or backward-incompatible redefinition of a Core Principle.
- MINOR bump: new principle, new section, or materially expanded guidance added.
- PATCH bump: clarifications, wording fixes, non-semantic refinements.

All PRs and spec reviews MUST verify compliance with the Constitution Check gate
listed in the Development Workflow section. Non-compliance blocks merge.
Complexity introduced beyond YAGNI MUST be justified by linking to a
specific principle or a performance measurement.

**Version**: 1.0.0 | **Ratified**: 2026-05-20 | **Last Amended**: 2026-05-20
