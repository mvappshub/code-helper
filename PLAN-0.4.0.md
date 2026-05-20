# Implementační plán 0.4.0 - Code Helper

**Datum:** 2026-05-20
**Založen na:** Analýze stávajícího kódu v C:\Users\marti\Desktop\code-helper
**Přistup:** Efektivní, bezpečný, vycházející z faktů - ne generický

## Třívrstvý framework (Architecture Map / Raw Signals / Findings)

### 1. Architecture Map (vždy zapnuté vizuální atributy)
Cíl: Rozšířit `insightOverlay.ts` a `graphBuilder.ts` o nové metriky, které se zobrazí v grafu jako vizuální atributy uzlů.

#### Úkol 1.1: Fan-out per node
- **Soubor:** `src/analysis/graphBuilder.ts`
- **Změna:** V metodě `rebuildEdges` nebo nové metodě `computeMetrics` dopočítat pro každý uzel `fanOut` (počet odchozích hran) a `fanIn` (počet příchozích hran).
- **Implementace:** Přidat do `GraphNode` (v `src/model/graphTypes.ts`) pole `fanOut: number` a `fanIn: number`.
- **Efektivita:** Metriky se počítají při rebuildu hran, který už probíhá, žádné extra procházení.
- **Bezpečnost:** Zachovat zpětnou kompatibilitu - pokud pole chybí, nastavit na 0.

#### Úkol 1.2: Always-on visual encoding pro fan-out
- **Soubor:** `src/analysis/insightOverlay.ts`
- **Změna:** Rozšířit `OverlayCategory` o `'fan-out'`. V `buildInsightOverlay` přidat logiku, která pro uzly s fan-out > threshold (např. 5) přidá overlay s kategorií `'fan-out'`.
- **Poznámka:** Nebude to toggle overlay, ale vždy viditelný vizuální atribut (např. tloušťka ohraničení uzlu podle fan-out).

#### Úkol 1.3: Layer coloring (pokud existuje konfigurace)
- **Soubor:** `src/analysis/insightOverlay.ts`
- **Změna:** Pokud uživatel má nakonfigurované layers (z `boundaryRules.ts`), obarvit uzly podle jejich layer assignmentu.
- **Implementace:** Získat layer assignment z `computeBoundaryViolations` nebo jiného zdroje. Přidat `'layer'` do `OverlayCategory`.
- **Bezpečnost:** Pokud layer neexistuje, neprovádět žádnou změnu.

### 2. Raw Signals (nové sekce v insight panelu)
Cíl: Přidat nové typy insights do `insightTypes.ts` a `computeInsights`.

#### Úkol 2.1: Přesun RawImport a rozlišení import type
- **Soubory:** `src/analysis/importExtractor.ts`, `src/analysis/extractors/types.ts` (nový soubor)
- **Změna:** 
  1. Vytvořit `src/analysis/extractors/types.ts` s `RawImport` interfacem rozšířeným o `importType: 'runtime' | 'type-only'`.
  2. V JS/TS extractorech (`src/analysis/extractors/javascript.ts`) rozlišovat mezi `import { type X }` a běžným importem.
  3. Aktualizovat všechny importy `RawImport` v projektu.
- **Efektivita:** Rozšíření stávajícího kódu, ne přepisování.

#### Úkol 2.2: Unresolved Imports jako nová kategorie
- **Soubor:** `src/analysis/insightTypes.ts`
- **Změna:** 
  1. Přidat `'unresolved'` do `InsightCategory`.
  2. V `InsightSet` přidat `unresolved: Insight[]`.
  3. V `computeInsights` přidat logiku, která zachycuje specifiers, které `resolveSpecifier` vrátil jako `null` (ale ne externí balíčky, ty filtrovat).
- **Implementace:** V `graphBuilder.ts` v metodě `rebuildEdges` ukládat unresolved specifiers na uzel (např. `_unresolvedImports`). V `computeInsights` je číst.
- **Bezpečnost:** Filtrovat jen relative/absolute specifiers (`./`, `../`, `/`), ne externí balíčky.

#### Úkol 2.3: High Fan-Out sekce (sourozenec Hubs)
- **Soubor:** `src/analysis/insightTypes.ts`
- **Změna:**
  1. Přidat `'fan-out'` do `InsightCategory`.
  2. V `InsightSet` přidat `fanOutInsights: Insight[]` (nebo rozšířit existující sekci).
  3. V `computeInsights` přidat sekci pro uzly s vysokým fan-out (např. > 10).
- **Poznámka:** Hubs jsou high fan-in, toto je high fan-out. Obě sekce budou v panelu samostatně.

### 3. Findings (Risky Modules)
Cíl: Přidat novou sekci pro moduly s kombinací více signálů.

#### Úkol 3.1: Risky Modules kategorie
- **Soubor:** `src/analysis/insightTypes.ts`
- **Změna:**
  1. Přidat `'risky'` do `InsightCategory`.
  2. V `InsightSet` přidat `riskyModules: Insight[]`.
  3. Logika: Modul je Risky, pokud má současně 2+ z těchto silných signálů: `cycle`, `bloated_error`, `layer_violation`, `package_internal_violation`, `high_fan_in + high_fan_out`.
- **Konkrétní pravidlo:** 
  - `cycle`: uzel je v cycles seznamu
  - `bloated_error`: uzel má LOC >= locDangerThreshold
  - `layer_violation`: uzel je v violations seznamu (z boundary rules)
  - `high_fan_in + high_fan_out`: uzel je v hubs (top N) A zároveň má fanOut > threshold (např. 10)
- **Bezpečnost:** Žádné numerické skóre, jen seznam důvodů v `description`.

### 4. import type rozlišení v cyklech
- **Soubor:** `src/analysis/insightTypes.ts` (v sekci cycles)
- **Změna:** Pokud cyklus obsahuje jen type-only importy, označit ho jako `'cycle (type-only)'` s nižší prioritou.
- **Implementace:** V `computeInsights` u cyklů kontrolovat `importType` u hran (přidat `importType` do `GraphEdge`).

### 5. Bezpečnost a testy
- **Soubory:** `src/test/suite/`
- **Změna:**
  1. Přidat testy pro nové typy v `insightTypes.test.ts`.
  2. Aktualizovat `graphBuilder.test.ts` pro fan-out/fan-in.
  3. Přidat test pro unresolved imports.
- **Postup:** Nejprve testy, pak implementace (TDD kde možno).

### 6. Webview aktualizace
- **Soubor:** `src/webview/insightsViewProvider.ts`
- **Změna:** Aktualizovat HTML generování pro zobrazení nových sekcí: Unresolved Imports, High Fan-Out, Risky Modules.
- **Efektivita:** Rozšířit existující switch nebo mapování, ne přepisovat celý provider.

## Efektivita a bezpečnost - shrnutí
- **Efektivita:** Využívám existující `computeInsights` a `buildInsightOverlay`. Nebuduju nové systémy zbytečně.
- **Bezpečnost:** Každá změna bude mít odpovídající test. Feature flags nejsou potřeba, změny jsou přírůstkové.
- **Fakta:** Plán vychází z analýzy skutečných souborů: `insightTypes.ts` (InsightCategory má 4 hodnoty), `graphBuilder.ts` (metriky se počítají v `computeInsights`), `importExtractor.ts` (RawImport je tam).
