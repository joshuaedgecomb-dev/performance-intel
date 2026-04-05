# Program Scorecard Redesign

**Date:** 2026-04-04
**Status:** Approved
**Scope:** Replace the Program Scorecard table on the Overview tab (BusinessOverview component, Section 12a of app.jsx, lines ~5729-5904)

## Problem

The current scorecard has 11 dense columns with redundant metrics (Attain % vs Proj. EOM %, Pacing badge vs Proj. EOM), sub-metric colors that inherit from the parent row instead of reflecting their own attainment, and cryptic labels (Q1/Q4). It's hard to scan at a glance.

## Design

### Columns (9)

| # | Column | Content | Visual |
|---|--------|---------|--------|
| 1 | Program | Name + optional BELIZE ONLY badge | Status dot colored by projected % using pacing thresholds |
| 2 | Avg/Day | Average unique agent count per day | Plain number |
| 3 | Sales vs Plan | `actual / plan` with projected EOM | Two stacked bars: top = current attainment progress bar with `actual / plan` text; bottom = thinner projection bar with proj % and `proj N` number underneath |
| 4 | Hours | Total hours worked | Plain number; total in footer row |
| 5 | GPH vs Goal | `actual / goal` | Progress bar colored by GPH attainment (actual/goal ratio) |
| 6 | HSD | Raw count + projected % | Proj % colored independently by its own projected attainment |
| 7 | XM | Raw count + projected % | Same independent coloring |
| 8 | RGU | Raw count + projected % | Same independent coloring |
| 9 | Quartile Distribution | Q1/Q2/Q3/Q4 agent counts | Stacked bar with numbers aligned under each segment using matching flex proportions |

### Removed Columns
- **Attain %** — redundant with Proj % in the Sales vs Plan column
- **Pacing badge** (AHEAD/BEHIND) — redundant with Proj %
- **Proj. EOM** as standalone column — now stacked into Sales vs Plan

### Color Thresholds

Use the **pacing threshold** system (not `attainColor()` which maps to quartile boundaries). All projected % values — status dot, Sales proj %, HSD/XM/RGU proj %, GPH bar — use these thresholds:

- **Green** (#16a34a) — 100%+ projected
- **Blue** (#2563eb) — 85-99% projected
- **Red** (#dc2626) — under 85% projected

This matches the existing pacing color logic at line ~5796. Create a helper:
```js
const projColor = pct => pct >= 100 ? "#16a34a" : pct >= 85 ? "#2563eb" : "#dc2626";
```

**Note:** This is a deliberate change from the current scorecard's status dot, which uses `attainColor()` (quartile-based at 0/80/100 thresholds). The new design uses projected attainment consistently across all elements.

### Row Styling
- Behind-pace rows (projected < 85%) get a soft red wash background (dark: `#dc262606`, light: `#fef2f2`)
- Ahead-of-pace rows get no tint
- Rows remain clickable → navigate to program detail slide via existing `onNav(pidx + 1)`

### Belize-Only Badge
- Programs where all agents are in XOTM regions get a purple `BELIZE ONLY` text label under the program name
- Detection is region-based, not name-based:
```js
const isBelizeOnly = p.agents.length > 0 && p.agents.every(a =>
  a.region && a.region.includes("XOTM")
);
```
- In current data, this applies to Localizers (`jobType` containing "Localizer") and XMC (`jobType` "XMC")
- Programs with agents missing a `region` field will NOT get the badge (correct — unclear data should not be flagged)

### TOTAL Footer Row
- **Avg/Day**: sum of each program's avg/day (not global deduplication — consistent with per-program view)
- **Sales/Plan**: aggregated totals with projection
- **Hours**: total across all programs
- **GPH**: weighted (totalGoals / totalHours)
- **HSD/XM/RGU**: sums of raw counts (no projected % in footer — too many programs with missing plans)
- **Quartiles**: aggregated distribution bar across all programs

### Sort Order
- Programs sorted by `(b.attainment ?? b.healthScore ?? 0) - (a.attainment ?? a.healthScore ?? 0)` — same as current, with healthScore fallback for programs without plan data

## Data Requirements

### New: Average Agents Per Day
Currently the scorecard shows `uniqueAgentCount` (total unique agents across the period). The redesign needs average unique agents per calendar day present in data.

**Computation:**
```js
const agentsPerDay = {};
program.agents.forEach(a => {
  if (!a.date || !a.agentName) return;
  if (!agentsPerDay[a.date]) agentsPerDay[a.date] = new Set();
  agentsPerDay[a.date].add(a.agentName);
});
const dayCount = Object.keys(agentsPerDay).length;
const avgPerDay = dayCount > 0
  ? Math.round(Object.values(agentsPerDay).reduce((sum, set) => sum + set.size, 0) / dayCount)
  : 0;
```

Uses calendar days present in data (not filtered to business days). This reflects actual staffing on days agents worked, which is the more useful metric for Josh's reporting.

Compute inside the scorecard render (per-row).

### GPH Goal (SPH GOAL)
The goals sheet field is called `"SPH GOAL"` (Sales Per Hour). This is a **rate**, not a volume.

Pull via `getPlanForKey(p.goalEntry, "SPH GOAL")`. Since `getPlanForKey` sums across plan rows and SPH is a rate, the result is only meaningful when there's one plan row per program. For multi-row plans, use the first row's value or average:
```js
const sphGoalRaw = getPlanForKey(p.goalEntry, "SPH GOAL");
// If goalEntry has multiple sites, this sums rates — use cautiously.
// Alternatively, pull from p.goalEntry directly if needed.
```

The existing program slides already handle this at line ~4914 as `sphPlanVal`. Follow the same approach.

### HSD/XM/RGU Projected %
Each sub-metric gets its own `calcPacing()` call to produce a **projected end-of-month attainment %**:

- **HSD**: `calcPacing(p.totalNewXI, planHsd, fiscalInfo.elapsedBDays, fiscalInfo.totalBDays)`
  - Plan key: `getPlanForKey(p.goalEntry, "HSD Sell In Goal")`
- **XM**: `calcPacing(p.totalXmLines, planXm, fiscalInfo.elapsedBDays, fiscalInfo.totalBDays)`
  - Plan key: `getPlanForKey(p.goalEntry, "XM GOAL")`
- **RGU**: `calcPacing(p.totalRgu, planRgu, fiscalInfo.elapsedBDays, fiscalInfo.totalBDays)`
  - Plan key: `getPlanForKey(p.goalEntry, "RGU GOAL")`

**Behavior change:** The current scorecard shows raw current-period attainment (actual/plan). The redesign shows projected EOM attainment via `calcPacing`. This is intentional — projected % is more actionable than raw attainment.

**Note:** XM is a new column. The current scorecard does not show XM lines — this is an addition, not a modification of existing code.

### Missing Sub-Metrics / No Plan

When a sub-metric has no plan data (plan is null/0/undefined):
- Show `"—"` (em dash) in the cell
- No projected % line

When the raw count is 0 but a plan exists:
- Show `0` with `0% proj` colored red

When the program has no `goalEntry` at all:
- Sales vs Plan: show actual count only, no plan number, no projection bar
- GPH vs Goal: show actual GPH only, no goal or progress bar
- HSD/XM/RGU: show raw counts only, no projected %

### Quartile Edge Case: All Zeros
If all four quartile counts are zero (program with no qualified agents), show a gray placeholder bar with "No qualified agents" text instead of an empty collapsed bar.

## Theme Support

The component must work in both dark and light mode using existing CSS variables:
- Backgrounds: `var(--bg-secondary)`, `var(--bg-tertiary)`
- Text: `var(--text-warm)`, `var(--text-secondary)`, `var(--text-muted)`, `var(--text-dim)`, `var(--text-faint)`
- Borders: `var(--border)`
- Progress bar tracks: `var(--bg-tertiary)` — works in both modes as it's a CSS variable
- Behind-pace row wash: detect via existing light/dark mode mechanism in codebase (the `lightMode` state variable), use `#dc262606` (dark) or `#fef2f2` (light)

## Quartile Bar Alignment

The quartile numbers must use the same flex proportions as the bar segments above them. Use `Math.max(count, 1)` for flex to prevent zero-width segments from hiding their labels:

```jsx
const counts = { Q1: distUnique.Q1, Q2: distUnique.Q2, Q3: distUnique.Q3, Q4: distUnique.Q4 };
const total = counts.Q1 + counts.Q2 + counts.Q3 + counts.Q4;

{total > 0 ? (
  <>
    <div style={{ display: "flex", height: 10, borderRadius: 5, overflow: "hidden", gap: 1 }}>
      {["Q1","Q2","Q3","Q4"].map(q => (
        <div key={q} style={{ flex: counts[q], background: Q[q].color }} />
      ))}
    </div>
    <div style={{ display: "flex", marginTop: 3, fontSize: 10, gap: 1 }}>
      {["Q1","Q2","Q3","Q4"].map(q => (
        <div key={q} style={{ flex: Math.max(counts[q], 1), textAlign: "center", color: Q[q].color }}>
          {counts[q]}
        </div>
      ))}
    </div>
  </>
) : (
  <div style={{ color: "var(--text-faint)", fontSize: 10, textAlign: "center" }}>No qualified agents</div>
)}
```

## Visual Reference

Mockups are in `.superpowers/brainstorm/586-1775340821/`:
- `scorecard-final.html` — dark mode final
- `scorecard-light-v2.html` — light mode final (with aligned quartiles)
