# MBR PPTX Export — Design Spec

## Overview

Add a "Generate MBR" button to Performance Intel that exports a polished Monthly Business Review PowerPoint deck from the app's already-crunched data. The deck follows the GCS MBR structure with a modern design, dynamically adapting to whichever programs are loaded. Slide count varies based on active programs (typically ~11 with the standard program set).

## Goals

- Eliminate manual data assembly for the monthly MBR deck
- Produce a professional PPTX that matches GCS branding (purple `#6137F4` header, amber `#FFAA00` accent)
- Auto-populate data-driven slides, AI-draft narrative insights, leave placeholder slides editable
- Keep it purely in-browser — no backend, no Python at runtime

## Non-Goals

- In-app MBR preview/presentation mode (future iteration)
- Ollama model selector (separate concern)
- Auto-populating Operations, Member Insights, or Action Items slides with data (placeholder only for v1)
- Restructuring the slide order or adding new slide types beyond the existing GCS MBR pattern

## UI Integration

### Export Button

- Location: the expandable `data-toolbar` row (the hover-revealed secondary toolbar alongside Local AI toggle, Goals upload, etc.), not the always-visible primary bar
- Label: "Export MBR" (small, unobtrusive — consistent with adjacent toolbar buttons)
- Available whenever data is loaded

### Confirmation Modal

On click, a modal appears with:

- **Title:** "Generate Monthly Business Review"
- **Summary line:** program count, data date range, fiscal period
- **Program list:** names of all programs that will be included (derived from loaded data)
- **Buttons:** "Generate" and "Cancel"
- **Progress state:** after clicking Generate, modal shows progress ("Generating insights for BAU WR NS...") as AI insights are produced per program
- **Completion:** download triggers automatically, modal closes

### Filename

`GCS_MBR_MMDDYY.pptx` where MMDDYY is the fiscal month end date derived from `getFiscalMonthInfo().fiscalEnd`. The `fiscalEnd` field is in `YYYY-MM-DD` format — parse and reformat to `MMDDYY`.

Example: `fiscalEnd` = `"2026-03-21"` → `GCS_MBR_032126.pptx`.

## Slide Design System

### Template (all slides)

- **Header:** purple gradient (`#6137F4` → `#4a28c4`) with 3px amber accent line (`#FFAA00`) underneath
- **Branding:** "Global Callcenter Solutions" top-left, slide context (section label + period) on a subtitle row below the title with adequate spacing — not crowded into the right side
- **Body:** white background
- **Dimensions:** 16:9 widescreen (standard)

### Color Palette (GCS theme)

| Role | Hex | Usage |
|------|-----|-------|
| Primary / accent1 | `#6137F4` | Header, branding, headcount accent |
| accent2 | `#1F69FF` | Blue KPI accents (RGUs, Sales) |
| accent3 | `#008557` | Green KPI accents (Hours, XI RGUs — at/above goal) |
| accent4 | `#FFAA00` | Amber accent line, below-goal indicators |
| accent5 | `#E54F00` | Orange (reserved) |
| accent6 | `#E5004C` | Red/pink (critical alerts, Q4) |
| Text primary | `#1a1a1a` | KPI values, body text |
| Text secondary | `#888888` | Labels, captions |

### Quartile Color Mapping

The app's Q1/Q2/Q3/Q4 system maps to the GCS palette:

- Q1 (100%+ to goal) → `#008557` (green)
- Q2 (80–99.9%) → `#1F69FF` (blue)
- Q3 (1–79.9%) → `#FFAA00` (amber)
- Q4 (0%) → `#E5004C` (red/pink)

### Typography

- Font: Segoe UI with fallback chain (Segoe UI, Calibri, Arial) for cross-platform compatibility
- Bold weights for KPI values
- Light/uppercase for labels and captions

## Slide Content

### Slide 1 — Title

- Full purple background (not header/body split)
- "MONTHLY BUSINESS REVIEW" main title
- "GLOBAL CALLCENTER SOLUTIONS (GCS)" subtitle
- Fiscal period date (e.g., "March 2026")

### Slide 2 — Summary Dashboard

- Purple header / white body (standard template)
- KPI cards in a grid with explicit field mappings:
  - **Hours** — `perf.totalHours` (actual) vs `perf.globalPlanHours` (plan)
  - **Homes (Sales)** — `perf.globalGoals` (actual) vs `perf.planTotal` (plan). Label as "Sales" on slide to match existing MBR terminology.
  - **RGUs** — `perf.globalRgu` (actual) vs `perf.globalPlanRgu` (plan)
  - **XI RGUs (HSD)** — `perf.globalNewXI` (actual) vs `perf.globalPlanNewXI` (plan)
  - **XM RGUs** — `perf.globalXmLines` (actual) vs `perf.globalPlanXmLines` (plan)
  - **Headcount** — `perf.uniqueAgentCount` (no plan, display count only)
- Each card: % to Goal, Pacing % (via `calcPacing(actual, plan, elapsedBDays, totalBDays)`), border-left colored by performance quartile
- Pacing is only shown for cards that have a non-null plan value. Headcount shows count only (no % to Goal or Pacing).
- Data source attribution at bottom (e.g., "Data Source: BI data through 3.3.26") using `perf.fiscalInfo.lastDataDate`

### Slides 3–N — Per-Program Detail (dynamic, one per active program)

- Header identifies program name. Category (Acquisition / Multi-Product Expansion / Up Tier & Ancillary) is derived from a `PROGRAM_CATEGORIES` mapping constant that maps `jobType` strings to display categories. Unknown jobTypes fall back to the raw jobType string.
- **Left column:**
  - "Project KPI Insights" — AI-generated via `buildAIPrompt("narrative", data)`, which produces a performance summary. Reuses cached results from `_aiCache` if the user already viewed this program's AI insights during the session.
  - "Team Insights" — AI-generated via `buildAIPrompt("opps", data)`, which produces coaching-focused action items. Same caching behavior.
- **Right column:**
  - Quartile legend (Q1/Q2/Q3/Q4 color key, matching app terminology)
  - KPI metrics table with columns: Goal, Actual, Variance, % to Goal, % Pacing. Rows limited to metrics with plan-vs-actual data available from `goalEntries`:
    - Hours (`hoursGoal` / `totalHours`)
    - Homes/Sales (`planGoals` / `actGoals`)
    - RGUs (`rguGoal` / `totalRgu`)
    - XI/HSD RGUs (`hsdGoal` / `totalNewXI`)
    - XM RGUs (`xmGoal` / `totalXmLines`)
    - SPH (computed: `actGoals / totalHours`, goal from `sphGoal`)
  - Rows with no plan value are omitted rather than showing empty cells
- Agent quartile distribution from existing app calculations
- Programs are ordered by attainment (highest first), matching the app's `buildPrograms()` sort order

### Slide N+1 — Member & Team Insights

- Placeholder layout with section headers per program
- Editable in PowerPoint (not auto-populated in v1)

### Slide N+2 — Operations

- Placeholder sections: Attrition, tNPS, Performance Stats
- Editable in PowerPoint

### Slide N+3 — Action Items / Looking Ahead

- Two-column layout: "Comcast Team" / "Partner Team"
- Placeholder text, editable in PowerPoint

## Data Flow

### Source

The `generateMBR()` function receives the already-computed `perf` object as a parameter from the component that has it. The `perf` object is produced by the `usePerformanceEngine()` React hook (which cannot be called directly from a non-hook function).

The export reads from:

- `perf` — the full performance object passed as a parameter, containing:
  - `perf.programs` — array of active programs (determines slides 3–N)
  - `perf.fiscalInfo` — fiscal dates, elapsed/remaining business days (from `getFiscalMonthInfo()`)
  - `perf.goalLookup` — budget/plan values for financial tables (may be null if no goals CSV uploaded)
  - `perf.totalHours`, `perf.globalGoals`, `perf.globalRgu`, etc. — aggregated KPIs for summary slide

No re-parsing or separate data pipeline.

### AI Insight Generation

Before building the PPTX:

1. For each active program, call `ollamaGenerate()` via `buildAIPrompt()` for two prompt types:
   - **Project KPI Insights** — `buildAIPrompt("narrative", programData)` — produces a performance/pacing summary
   - **Team Insights** — `buildAIPrompt("opps", programData)` — produces coaching-focused action items
2. Uses existing concurrency limiter (`AI_CONCURRENCY = 1`)
3. Reuses insights from `_aiCache` if already generated this session (same prompt types as in-app AI insights, so viewing a program slide first populates the cache for the export)
4. **Fallback:** if Ollama is unavailable or returns null, fields show "Add project insights here"

### Generation Flow

1. User clicks "Export MBR" in sub-bar → confirmation modal
2. User clicks "Generate" → modal shows per-program progress
3. AI insights generated (sequential, respecting limiter), cached results reused
4. PPTX assembled in memory via `pptxgenjs`
5. Browser triggers download of `GCS_MBR_MMDDYY.pptx`
6. Modal closes

**Error handling:** if `pptxgenjs` throws during slide assembly (e.g., undefined data value), the modal shows an error message with a "Close" button and logs the error to console. The user is not left in a stuck progress state.

## Dependencies

### New

- `pptxgenjs` (npm) — in-browser PPTX generation, ~300KB, mature library

### Existing (no changes)

- `ollamaGenerate()` / `buildAIPrompt()` — AI insight generation (prompt types: `"narrative"`, `"opps"`)
- `_aiCache` — session-level insight caching
- `usePerformanceEngine()` — produces the `perf` object (not called by export; `perf` is passed as parameter)
- `getFiscalMonthInfo()` — fiscal calendar (accessed via `perf.fiscalInfo`)
- `calcPacing()` — pacing calculations for KPI cards
- All existing views, data processing, and features remain untouched

### Files Modified

- `Project/src/app.jsx` — export button in sub-bar, confirmation modal component, `generateMBR()` orchestration function, PPTX slide-building logic
- `Project/package.json` — add `pptxgenjs` dependency

## Future Considerations (out of scope)

- In-app MBR preview before export
- Configurable program selection in the export modal
- Auto-populated Operations/Member Insights slides from additional data sources
- Ollama model selection
- Template-based approach (ship a `.pptx` template) if `pptxgenjs` hits formatting limits
- Python `python-pptx` backend as an alternative engine
