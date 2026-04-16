# Performance Intel Dashboard — Definitive Training Reference

> **Purpose**: This document trains Claude CLI to understand, modify, debug, and extend the Performance Intel dashboard. It combines the complete codebase reference with operational training on every feature, data pipeline, and design decision.

> **Last updated**: 2026-04-12 (post top-nav redesign + ProgramSiteCompareCard)

---

## 1. What This Tool Is

Performance Intel is a **single-file React artifact** (`src/app.jsx`, ~14,000 lines) powering a telesales performance analytics dashboard for a BPO managing outbound **Xfinity** campaigns. It serves two geographic sites:

- **DR (SD-Xfinity)** — Santo Domingo, Dominican Republic
- **BZ (Belize)** — Three sub-sites: Belize City-XOTM, OW-XOTM, San Ignacio-XOTM

The tool processes CSV and JSON data for agent performance, goals, and roster tracking, rendering interactive pages (BusinessOverview, SiteDrilldown, program slides, MoM compare, tNPS), drill-down analytics, and a real-time live operational view (TodayView).

---

## 2. Architecture & Runtime

| Property | Value |
|----------|-------|
| File | `src/app.jsx` (~14,000 lines, single-file) |
| Framework | React 18 with named imports only |
| Import style | `import React, { useState, useMemo, useRef, useCallback, useEffect, Fragment, Component } from "react"` — **never** use `React.` namespace |
| Styling | Inline CSS with CSS custom properties for light/dark mode |
| Default mode | Light mode (`useState(true)`) |
| Error handling | `ErrorBoundary` class component wraps critical sections |
| Catch blocks | **Always** `catch(e) {}` — never bare `catch {}` (Vite/Babel compatibility) |
| Default export | `App` component |
| Deployment | GitHub Pages: `https://joshuaedgecomb-dev.github.io/performance-intel/` |
| Build | Vite with `"type": "module"` in package.json |
| Update process | Edit `src/app.jsx`, then `git add . && git commit -m "msg" && git push origin main && npx vite build && npx gh-pages -d dist -m "Deploy: msg"` |

### Data Flow
```
Google Sheets (CSV) → parseCSV() → normalizeAgents() → usePerformanceEngine() → TopNav + page components
```

---

## 3. Data Sources

### 3.1 Agent CSV (Primary Data)
One row per agent per day. Key columns:

| Column | Description | Example |
|--------|-------------|---------|
| `Job` | ROC code | `GLN04817` |
| `Job Type` | Program name | `Nonsub` |
| `Region` | Agent location | `SD-Xfinity`, `Belize City-XOTM` |
| `Date` | Work date | `2026-03-01` |
| `Week Number` | Fiscal week | `9` |
| `Hours` | Hours worked | `8.5` |
| `Goals` | Sales made | `3` |
| `Goals Number` | Prorated daily goal target | `0.4` |
| `AgentName` | Agent full name | `Wilson Cruz Mora` |
| `SupName` | Supervisor name | `Daysha` |
| `SPH Goal` | Sales-per-hour target | `0.088` |
| `New XI`, `XM Lines`, `New XH`, `New Video`, `NewVoice`, `NewSecurity` | Product counts | numeric |

### 3.2 Goals CSV (Plan Targets)
One row per target audience per site. Key columns:

| Column | Description |
|--------|-------------|
| `Site` | "DR" or "BZ" |
| `Target` / `Target Audience` | Program target name |
| `ROC Numbers` | GL codes (comma-separated) |
| `SPH GOAL`, `HOMES GOAL`, `Hours Goal` | Plan metrics |
| `Funding` | "National" or "HQ" |
| `Project` | Project grouping |
| `HSD Sell In Goal`, `XM GOAL`, `VIDEO GOAL`, `RGU GOAL` | Product goals |

**Note**: BOM-stripped in `parseCSV`. `Funding` distinguishes funding sources sharing the same program (e.g., GLN04817=National, GLN04818=HQ for Nonsub).

### 3.3 Roster CSV (New Hires + BP Lookup)
Columns: `First Name`, `Last Name`, `Hire Date`, `End Date`, `BP`, `Supervisor Name`, `Region`, `Role`. Used for both new-hire detection and tNPS BP→agent name mapping.

### 3.4 tNPS Survey CSV
One row per survey response. Key columns: `SMS tNPS` (score 0-10), `Site`, `Telesales Outcome Category`, `Employee NTID` (BP), `Response Date`, `Reason for score`, `Topics Tagged Original`, `Alert type`, `Alert Status`.

### 3.5 Today JSON (Live Data)
OTM API endpoint or manual paste. Fields: `agt`, `grp` (program name), `job` (ROC code), `reg`, `loc`, `hrs`, `sal`, `rgu`, plus numeric product code columns (`"420"`, `"600"`, `"702"`, etc.).

### 3.6 Google Sheet URL Storage
- Stored in `localStorage` key `perf_intel_sheet_urls_v1`
- Default URLs are **read from `.env.local`** at build time via Vite (`import.meta.env.VITE_DEFAULT_*_URL`). The committed source ships **no real URLs** — only empty fallbacks.
- You must provide your own data. Copy `.env.example` → `.env.local` and paste your published Google Sheet CSV URLs into each `VITE_DEFAULT_*_URL` slot. `.env.local` is gitignored and will never be committed.
- Without a populated `.env.local`, the app loads with blank URL fields and users must paste them in via the Settings menu (⚙ icon → Data sources) — the hardcoded defaults are just placeholders for accessing your own data, not shared credentials.
- URLs point to published Google Sheets with `output=csv` — the `gid=` parameter identifies specific tabs
- Full list of 13 env vars: 6 core Performance Intel sheets + 7 Corp MBR sources (see §18)

---

## 4. Region & Site System

### Valid Regions
```javascript
const VALID_REGIONS = new Set(["SD-Xfinity", "Belize City-XOTM", "OW-XOTM", "San Ignacio-XOTM"]);
```

| Region | Site Key | Display Label |
|--------|----------|---------------|
| SD-Xfinity | DR | Dom. Republic |
| Belize City-XOTM | BZ | Belize |
| OW-XOTM | BZ | Belize |
| San Ignacio-XOTM | BZ | Belize |

### Detection Logic
- BZ: `region.toUpperCase().includes("XOTM")`
- DR: any non-XOTM region (currently only "SD-Xfinity")
- Display uses "Dom. Republic" / "Belize" but **data keys remain "DR"/"BZ"** throughout goal lookups

### Auto-Corrections & Remapping
- `SD-Xfinty` → `SD-Xfinity` (typo in source data)
- `SD-Cox` agents with `GL*` ROC codes → remapped to `SD-Xfinity` (Cox agents dialing Xfinity campaigns)
- `SD-Cox` agents with `GS*` ROC codes → **excluded** (Cox-specific programs)
- ROC codes: `GL*` = Xfinity programs, `GS*` = Cox programs

### Spanish Callback
- `Job Type === "Spanish Callback"` → `isSpanishCallback: true`
- **Excluded** from all aggregation: programs, site totals, daily breakdowns
- Tracked separately via `buildSpanishCallbackStats`

---

## 5. Goal Matching System

### `getGoalEntries(goalLookup, jobType, rocCode)` — 8-Step Process

| Step | Priority | Method | Example |
|------|----------|--------|---------|
| 0 | Highest | **ROC code match** via `byROC` index | `GLN04817` → goal row with matching ROC |
| 1 | | Exact match on Target Audience | `"Nonsub"` = `"Nonsub"` |
| 2 | | Normalized match (lowercase, collapse separators) | `"Non-Sub"` ≈ `"Non Sub"` |
| 3 | | Compact match (strip ALL separators) | `"NonSub"` ≈ `"Nonsub"` |
| 4 | | Project match | `"Add a Line"` → `["AAL", "XM Likely"]` |
| 5 | | Word-boundary includes (hardened: ≥5 chars + boundary) | `"xm"` NOT matching `"addxmc"` |
| 6 | | Compact includes (length-aware) | Substring of compactKey |
| 7 | Lowest | Word overlap (70%+ significant words) | `"MAR Acquisition WRNS"` ↔ `"NAT MAR NS Acquisition WRNS"` |

### Goal Lookup Structure
```javascript
{
  byTA: { "Nonsub": { "DR": [row], "BZ": [row] } },
  byProject: { "Add a Line": ["AAL", "XM Likely"] },
  byROC: { "GLN04817": { "DR": [row], "BZ": [row] } },
  byTarget: { "GRW MAR XM Likely": { "DR": [row], "BZ": [row] } }
}
```
Each goal row has `_funding`, `_target`, `_roc` metadata attached.

### Site-Scoped Goal Entries
When a program needs to be filtered to a single site (DR or BZ), use the helper:
```javascript
filterGoalEntriesBySite(goalEntries, "DR")  // or "BZ"
```
This strips the entry's siteMap to only the requested site's plan rows. Critical for computing site-actual ÷ site-plan attainment in `filteredProgram`, `programsBySite`, and `ProgramSiteCompareCard`. **If you skip this, attainment is computed against the combined DR+BZ plan and reads wrong.**

### Column Name Matching
`findCol(row, ...candidates)` handles case-insensitive, separator-normalized matching. Key `computePlanRow` mappings:

| Metric | CSV Variants Searched |
|--------|----------------------|
| SPH Goal | `"SPH GOAL"`, `"SPH Goal"`, `"SPH"` |
| Homes Goal | `"HOMES GOAL"`, `"Homes Goal"`, `"Home Goal"`, `"Homes"` |
| HSD Goal | `"HSD GOAL"`, `"HSD Sell In Goal"`, `"New XI Goal"` |
| Hours Goal | `"Hours Goal"`, `"HOURS GOAL"`, `"Hour Goal"` |
| ROC Numbers | `"ROC Numbers"`, `"ROC Number"`, `"ROC"`, `"GL Code"` |

**WARNING**: Do NOT add `"GPH"` as a variant for sphGoal — the goals CSV may have a "GPH" column containing actual GPH values (not targets), which would corrupt every program's sphGoal.

---

## 6. Metrics & Calculations

### Quartile System
| Quartile | Threshold | Color |
|----------|-----------|-------|
| Q1 | ≥ 100% of goal | Green (#16a34a) |
| Q2 | ≥ 80% | Blue (#2563eb) |
| Q3 | > 0% | Amber (#d97706) |
| Q4 | 0% | Red (#dc2626) |

In Supervisor Ranking, quartiles are computed per **unique agent** (collapsed daily rows), not per row.

### Cost Per Sale (CPS)
```
CPS = (Hours × $19.77) / Sales
When sales = 0: CPS = Hours × $19.77
```
Color-coded to match % to Goal.

### SPH Attainment
```
SPH Attainment = (Actual SPH ÷ Plan SPH) × 100
where Plan SPH = Planned Homes ÷ Planned Hours
```
**Not** the same as % to goal. Tier targets displayed as **sales needed** (SPH × actual hours).

### Hour Attainment
```
Hour Attainment = Actual Hours ÷ Planned Hours × 100
```

### Fiscal Calendar & Pacing
- Cumulative: `projected = (actual / elapsedBDays) × totalBDays`
- SPH: projects homes and hours **separately**, then computes projected SPH ratio
- Goals vs Plan cards: "X remaining (Y/day)" or "+X over plan"
- The Day X of Y pacing pill in TopNav reads from `perf.fiscalInfo.elapsedBDays / totalBDays`

---

## 7. Gainshare Tiers

### Overall (`GAINSHARE_TIERS`)
| Range | Mobile | HSD | Cost Per | SPH |
|-------|--------|-----|----------|-----|
| > 126% | +4.00% | +4.00% | +1.00% | +1.00% |
| 120–126% | +3.00% | +3.00% | +0.75% | +0.75% |
| 113–119% | +2.00% | +2.00% | +0.50% | +0.50% |
| 106–112% | +1.00% | +1.00% | +0.25% | +0.25% |
| 95–105% | 0% | 0% | 0% | 0% |
| 88–94% | -1.00% | -1.00% | -0.25% | -0.25% |
| 81–87% | -2.00% | -2.00% | -0.50% | -0.50% |
| 74–80% | -3.00% | -3.00% | -0.75% | -0.75% |
| < 74% | -4.00% | -4.00% | -1.00% | -1.00% |

### Site (`GAINSHARE_SITE_TIERS`)
Different ranges (starts > 139%), different values. SPH mirrors Cost Per values.

### Hour Gate — Overall
Flat -2% penalty if below 100%.

### Hour Gate — Site (`HOUR_GATE_SITE_TIERS`)
| Range | Penalty |
|-------|---------|
| ≥ 100% | 0% |
| 95–99.99% | -2% |
| 90–94.99% | -4% |
| < 90% | -6% |

### Display
Each metric: attainment % → "X to next tier" → tier rows (Range | Target needed or ✓ | Bonus %) → net bonus total.

---

## 8. Navigation (Top-Nav Architecture)

### Top Bar (always visible, fixed)
```
PERF INTEL · Overview · DR ▼ · BZ ▼ · MoM · tNPS    [● Day 14 of 22] [☀] [⚙] [⚡ TODAY]
```

- **Overview / MoM / tNPS** — direct links (no dropdown). tNPS only shown when `hasTnps` is true.
- **DR ▼ / BZ ▼** — dropdown menus only. Clicking the label opens the menu, does NOT navigate. DR uses orange `#ed8936`, BZ uses green `#48bb78`.
- **Pacing pill** — `Day X of Y` with green dot. Live ambient context, not clickable.
- **☀ / ☾** — light/dark theme toggle.
- **⚙ Settings** — overflow menu containing: Export MBR (monthly), Refresh from sheet, Upload Goals/Roster/Prior Goals CSV, Data sources modal, Hours Threshold modal section, Local AI toggle (only when Ollama detected).
- **⚡ TODAY / ✕ EXIT TODAY** — green CTA. Toggles full-screen `TodayView`. The whole top nav stays visible inside Today view; clicking any nav link from Today exits Today AND navigates.

### Site Dropdown Content (DR & BZ identical structure)
```
┌─ DR · 91% to goal | Proj 100% ─┐
│  📊 Site Overview               │
│  ─────────────────────────────  │
│  ACQUISITION                    │
│  Nonsub                    94%  │
│  BAU                       72%  │
│  MULTI-PRODUCT EXPANSION        │
│  XM Likely                 87%  │
│  Add a Line                76%  │
│  UP TIER & ANCILLARY            │
│  Add XMC                   81%  │
└─────────────────────────────────┘
```
- Header shows site current attainment + projected attainment
- Programs grouped by `getMbrCategory()` (Acquisition / Multi-Product Expansion / Up Tier & Ancillary)
- Programs sorted by attainment within each category
- Programs with zero agents in that site are hidden

### Breadcrumb Bar (below TopNav, only on site-scoped pages)
```
DR · Dom. Republic › Acquisition › Nonsub                      94% to goal
```
- Only renders for sections "dr" or "bz"
- Site Overview shows: `DR · Dom. Republic › Site Overview`
- Program page shows: `DR · Dom. Republic › <Category> › <Program>` with attainment right-aligned

### Page Mapping
| `currentPage` | Renders |
|---|---|
| `{ section: "overview" }` | `BusinessOverview` (with Overview/Daily/Trends tabs) |
| `{ section: "dr" }` (no program) | `SiteDrilldown` filtered to DR regions |
| `{ section: "dr", program: "Nonsub" }` | `Slide` for Nonsub, agents pre-filtered to DR via `filteredProgram` |
| `{ section: "bz" }` (no program) | `SiteDrilldown` filtered to BZ regions |
| `{ section: "bz", program: "Nonsub" }` | `Slide` for Nonsub, agents pre-filtered to BZ |
| `{ section: "mom" }` | `CampaignComparisonPanel` |
| `{ section: "tnps" }` | `TNPSSlide` |
| `showToday: true` | `TodayView` (full-screen, TopNav still visible) |

### BusinessOverview Tabs
Overview | Daily | Trends (no By Site — removed in nav redesign)

### Program Slide Tabs
Overview | All Agents | Teams | Ranking | Daily (no By Site — removed)

### Drill-Down Patterns (within pages)
- **Daily** (BusinessOverview/SiteDrilldown): Date → Programs → Agents (3-level)
- **Supervisor Ranking**: Supervisor → Agents → Campaign composition (3-level)
- **Daily Targets**: Funding filter splits by ROC with per-funding plan+actuals

---

## 9. Component Quick Reference

### Navigation
| Component | Purpose |
|-----------|---------|
| `TopNav` | Permanent top bar, composes SiteDropdown + SettingsMenu, owns mutually-exclusive openMenu state |
| `SiteDropdown` | Categorized program list for DR/BZ menus, takes `attainment`, `projAttainment`, `currentProgram`, `accent` |
| `SettingsMenu` | ⚙ overflow menu with Actions/Data/Settings sections |
| `Breadcrumb` | Secondary nav showing site › category › program |

### Engine + Data
| Component | Purpose |
|-----------|---------|
| `usePerformanceEngine` | Central memoization hub returning all derived data including `programMap`, `tnpsByAgent`, etc. |

### Pages
| Component | Purpose |
|-----------|---------|
| `BusinessOverview` | Cross-site dashboard with KPIs, gainshare, Daily/Trends tabs |
| `SiteDrilldown` | Site-scoped analytics: narrative, goals, gainshare, supervisor ranking, daily targets |
| `Slide` | Program-level analytics; accepts `siteFilter` prop for site-scoped eyebrow |
| `CampaignComparisonPanel` | Month-over-month agent comparison |
| `TNPSSlide` | tNPS analytics with Summary/Campaign/Supervisor/Voices tabs |
| `TodayView` | Live OTM data with CORS fallback, auto-refresh |

### Cards & Panels
| Component | Purpose |
|-----------|---------|
| `ProgramSiteCompareCard` | DR vs BZ scorecard at top of program slides; only renders when both sites dial the program; includes winner-per-metric line |
| `DailyBreakdownPanel` | 3-level date drill-down (`singleProgram` skips program level) |
| `GainsharePanel` | 5 metrics + hour gate with tier display |
| `RankingAgentTray` | Expandable agent tray with campaign drill-down |
| `SupervisorCard` | Teams tab card with sparklines and coaching insights |
| `CollapsibleNarrative` | Collapsible text panel with Copy button |
| `MetricComparePanel` | Goals vs Plan cards with delta/remaining display |
| `AgentTable` | Sortable agent table with region filter |
| `MbrExportModal` | PowerPoint MBR export modal |

### Helpers (module-scope, hoisted)
| Helper | Purpose |
|---|---|
| `MenuSection`, `MenuRow` | SettingsMenu sub-rows |
| `Crumb`, `CRUMB_SEP` | Breadcrumb sub-elements |
| `topNavLinkStyle(active, accent)` | Top-nav button style factory (used by all 5 nav links) |
| `filterGoalEntriesBySite(entries, "DR"|"BZ")` | Strips entry.siteMap to one site's plan rows |

---

## 10. Known ROC Codes

| ROC | Program | Notes |
|-----|---------|-------|
| GLN04817 | Nonsub National | DR + BZ |
| GLN04818 | Nonsub HQ | BZ only |
| GLU04815 | XM Likely | |
| GLB04794 | Add XMC | |
| GL* | Xfinity programs | Included |
| GS* | Cox programs | Excluded |

---

## 11. localStorage Keys

| Key | Purpose |
|-----|---------|
| `perf_intel_sheet_urls_v1` | Google Sheet CSV URLs |
| `perf_intel_goals_v1` | Cached goals CSV |
| `perf_intel_newhires_v1` | Cached new hires CSV |
| `perf_intel_prior_month_v1` | Prior month data for MoM |
| `perf_intel_prior_month_v1_goals` | Prior month goals CSV |
| `perf_intel_tnps_v1` | tNPS surveys CSV |
| `perf_intel_hours_threshold` | Configurable hours-qualified threshold (default 16) |
| `perf_intel_hours_auto` | Auto-scale hours threshold by fiscal day |
| `perf-intel-current-page` | Current navigation page `{ section, program? }` — restored on reload |
| `today_raw_data` / `today_codes` / `today_last_refresh` | TodayView state |

---

## 12. CSS Color Conventions

| Color | Hex | Usage |
|-------|-----|-------|
| Amber | #d97706 | Accent, warnings, Q3, default site labels |
| Green | #16a34a | Positive, Q1, TODAY CTA, pacing pill |
| Red | #dc2626 | Negative, Q4, hours overage |
| Indigo | #6366f1 | Hours, SD-Xfinity |
| Blue | #2563eb | HSD, Q2 |
| Purple | #8b5cf6 | XM Lines |
| **Nav Orange** | **#ed8936** | **DR site label, breadcrumb, dropdowns** |
| **Nav Green** | **#48bb78** | **BZ site label, breadcrumb, dropdowns** |

---

## 13. Critical Gotchas

1. **Site-scoped attainment**: Always run `filterGoalEntriesBySite()` before calling `buildProgram()` with site-filtered agents — otherwise attainment uses combined plan and reads wrong.
2. **GPH column**: Never add "GPH" as sphGoal variant.
3. **ROC priority**: Step 0 always fires before name matching.
4. **Site SPH**: TodayView uses per-site goals; main dashboard averages all sites.
5. **Fragment**: Must use named import, not `React.Fragment`.
6. **localStorage**: May not persist in artifact env — all calls in try/catch.
7. **Catch blocks**: Always `catch(e) {}`, never bare `catch {}`.
8. **Spanish Callback**: Excluded from aggregation.
9. **SD-Cox**: Only GL-prefixed ROCs remapped to SD-Xfinity.
10. **Brace balance**: Verify after every multi-line edit.
11. **Unicode in str_replace**: Use Python for replacements with unicode characters.
12. **TopNav z-index**: 200, fixed-positioned. Page content needs `paddingTop: 48px` to avoid being hidden underneath. Breadcrumb sits inside that padded wrapper.
13. **Mutually-exclusive menus**: `openMenu` state allows only one of `dr | bz | settings | null` open at a time. Click-outside and Escape both clear it.
14. **Sub-component hoisting**: All inline helper sub-components (`MenuRow`, `MenuSection`, `Crumb`, `topNavLinkStyle`) MUST be at module scope, not nested inside their parent — otherwise they're recreated each render and unmount/remount their subtree.
15. **handleRefresh** (in App): refreshes ALL sheets in parallel (agent + goals + roster + prior + tNPS), uses corsproxy.io fallback. Don't simplify it back to agent-only.

---

## 14. Testing Checklist

### Core data pipeline
- [ ] App renders without errors after data loads
- [ ] Agent CSV loads from Google Sheets (or via Refresh action in ⚙ menu)
- [ ] Goals CSV loads and persists to localStorage
- [ ] Both sites show correct % to goal
- [ ] Site-scoped attainment uses site-only plan (not combined)
- [ ] Programs with different ROC codes show as separate rows
- [ ] SD-Cox GL agents appear under SD-Xfinity
- [ ] Spanish Callback rows excluded from aggregations

### Navigation
- [ ] TopNav shows: PERF INTEL · Overview · DR ▼ · BZ ▼ · MoM · tNPS · pacing pill · ☀ · ⚙ · ⚡ TODAY
- [ ] Clicking DR or BZ opens dropdown WITHOUT navigating
- [ ] Dropdown header shows `Site · X% to goal | Proj Y%`
- [ ] Programs grouped by MBR category and sorted by attainment
- [ ] Clicking Site Overview loads SiteDrilldown filtered to that site
- [ ] Clicking a program loads Slide with agents filtered to that site
- [ ] Breadcrumb appears below TopNav on site-scoped pages
- [ ] Active menu item highlighted in site accent color (orange/green)
- [ ] Esc closes any open dropdown
- [ ] Click outside closes any open dropdown
- [ ] Only one menu open at a time (DR/BZ/Settings mutually exclusive)
- [ ] Refresh page → currentPage persists from localStorage
- [ ] Empty state ("No Job Type column") shown if data has no jobTypes

### Site-scoped pages
- [ ] DR program slide: eyebrow shows `DR · <Category>`
- [ ] DR program slide: ProgramSiteCompareCard shows when BZ also dials this program
- [ ] Compare card: DR side and BZ side both show real attainment % (not "—")
- [ ] Compare card: winner-per-metric line reads correctly
- [ ] Compare card hidden when only one site dials the program

### Other
- [ ] Gainshare tiers highlight correctly with targets
- [ ] SPH Attainment shows sales needed
- [ ] Hour Gate tiered at site level
- [ ] Daily Targets funding filter splits plan+actuals
- [ ] Hours overage red, homes/HSD/XM green
- [ ] Supervisor ranking agent tray + campaign drill-down works
- [ ] Daily 3-level drill-down works
- [ ] Light/dark mode works
- [ ] TodayView loads via fetch or paste
- [ ] TodayView: TopNav stays visible; clicking any nav link exits TODAY and navigates
- [ ] ⚙ menu: Export MBR opens modal, Refresh refreshes all sheets, file uploads trigger correctly
- [ ] Hours Threshold can be edited from settings modal

---

## 15. Codebase Map (where things live)

The file is one ~14,000-line module. These ranges shift after edits — use `grep -n "function ComponentName"` to confirm. The order below is the source order top-to-bottom.

| Range | Section | Key contents |
|---|---|---|
| 1-20 | Imports + ErrorBoundary | React imports, pptxgen, ErrorBoundary class |
| 22-465 | §1 Constants & Utilities | `parseCSV`, `parseNum`, `attainColor`, `getMbrCategory`, MBR_COLORS, GAINSHARE_TIERS, gainshare lookups, Ollama AI helpers |
| 466-870 | §2 Data Normalization | `normalizeAgents`, `parseNewHires`, `buildBpLookup`, tNPS site/campaign mapping, `parseTnps`, `calcTnpsScore` |
| 875-960 | §3 Selectors | `selectQualified`/`Q1`/`Q2`/etc., `collapseToUniqueAgents`, `quartileDist`, `getActual`, hours-threshold globals |
| 962-1205 | §4 Goals Engine | `parseCSV` helpers, `buildGoalLookup`, `getGoalEntries` 8-step matcher, `computePlanRow`, `filterGoalEntriesBySite` |
| 1207-1240 | §5 Region Builder | `buildRegions` |
| 1242-1515 | §6 Program Builder | `calculateHealthScore`, `buildProgram`, `buildPrograms`, `buildSpanishCallbackStats`, `buildSupervisorStats`, `buildWeeklyRollup` |
| 1516-2125 | §7 Insights Engine | `generateWinInsights`, `generateOppInsights`, `generateNarrative`, `generateBusinessInsights`, AI prompt builders |
| 2127-2300 | §8 Performance Engine | `usePerformanceEngine` hook (returns the `perf` object) |
| 2301-3720 | §9 UI Components Part 1 | `CollapsibleNarrative`, `StatCard`, `QBadge`, `InsightCard`, `AgentTable`, `RegionComparePanel`, `GainsharePanel`, `FiscalPacingBanner`, `MetricComparePanel`, `PacingPanel`, `GoalsRollup` |
| 3725-3895 | §10 DropZone | First-load file dropper |
| 3900-4035 | §11 SiteDrilldown helpers | `RankingAgentTray` |
| 4035-4990 | §11 SiteDrilldown | The big site-level analytics page |
| 4995-5240 | §11.5 Top-Nav Components | `MenuSection`, `MenuRow`, `SettingsMenu`, `Crumb`, `CRUMB_SEP`, `Breadcrumb`, `topNavLinkStyle`, `TopNav`, `SiteDropdown` |
| ~5300-6055 | §11.6 MBR PPTX Export | `MbrExportModal`, helpers, slide builders |
| ~6140-6695 | §12 TNPSSlide | tNPS analytics page with 4 tabs |
| ~6700-7720 | §12 BusinessOverview | Cross-site dashboard with Overview/Daily/Trends tabs |
| ~7720-8235 | §12.5 Sparklines + SupervisorCard | `Sparkline`, `TrendArrow`, `SupervisorCard`, `TeamsView` |
| ~8240-9265 | §12.6 Trends | `DOWCards`, `WeeklyTrendsPanel`, day-of-week analysis |
| ~9265-9620 | §12.7 CampaignComparisonPanel | Month-over-month comparison |
| ~9625 | (Section 12d tombstone) | "ProgramBySiteTab removed" comment |
| ~9630-9950 | §13 DailyBreakdownPanel | 3-level date drill-down |
| ~10470-10620 | §13.5 ProgramSiteCompareCard | DR vs BZ scorecard for shared programs |
| ~10620-11195 | §13 Slide | Program-level analytics page (overview/agents/teams/goals/daily) |
| ~11195-12055 | §14 TVMode + TodayView | Live OTM data and TV display mode |
| ~13280-end | §14 App Shell | THEMES, App component, all top-level state, render logic |

---

## 16. Common Workflows (Recipes)

### Adding a new top-level nav section
1. Pick a section key (e.g., `"compare"`).
2. Add to App's render: a new branch in the `currentPage.section === "..."` ternary chain.
3. Add a link in `TopNav`: `<button onClick={() => navigate("compare")} style={topNavLinkStyle(isActive("compare"))}>Compare</button>`
4. (Optional) Add breadcrumb support inside `Breadcrumb` if it's a hierarchical page.
5. (Optional) Update `legacyGoToSlide` in App to translate any cross-component links.

### Adding a metric to ProgramSiteCompareCard
1. Add the field to `buildSide`'s returned object (around line 10650).
2. Add a `<Metric>` element to the `Site` sub-component grid (note: grid is `grid-template-columns: repeat(5, 1fr)` — adding a 6th metric needs grid update).
3. (Optional) Add a winner-line entry in the `dQ1`/`dCps` style comparisons.

### Modifying gainshare tiers
- Edit `GAINSHARE_TIERS` (overall) or `GAINSHARE_SITE_TIERS` (per-site) at line ~196 / ~209. Hour gate: `HOUR_GATE_SITE_TIERS` at ~223.
- The `getGainshareTier(pct, site)` function at line ~235 picks the right table.

### Adding a new MBR category
- Edit `getMbrCategory()` at line ~87 — add keyword/regex matchers and/or GL prefix branches.
- Update the `order` array in `SiteDropdown` (~line 5050) so the new category appears in the correct slot in the menu. Unknown categories fall through to the end of the dropdown.

### Adding a new sheet source
1. Add `DEFAULT_X_SHEET_URL` constant near line 460.
2. Add to App's `sheetUrls` state shape and render in the Settings modal map (~line 14180).
3. Add an auto-load `useEffect` near the existing `tnpsSheetUrl` loader (~line 14000).
4. Update `handleRefresh` (~line 13820) to also fetch the new sheet.

### Adding a new tab to a program slide
- Edit Slide's `tabs` array (~line 10780). Add a label-mapping entry to the ternary at ~line 10822.
- Add the render block alongside other tab conditionals (`{tab === "newtab" && (...)}`).

---

## 17. Editing Workflow Tips

### Build/test loop
```bash
# After any edit:
cd "/c/Users/Joshu/Documents/Claude/Performance Intel" && npx vite build 2>&1 | tail -3

# Dev server (auto-reloads on save):
cd "/c/Users/Joshu/Documents/Claude/Performance Intel" && npx vite --host
# Default port 5173; if busy, Vite picks 5174+

# Deploy:
cd "/c/Users/Joshu/Documents/Claude/Performance Intel" && npx vite build && npx gh-pages -d dist -m "Deploy: <message>"
```

### Searching the single file
- Components: `grep -n "^function ComponentName" src/app.jsx`
- All major boundaries: `grep -nE "^// ═{5,}" src/app.jsx`
- Section list: `grep -nE "^// SECTION " src/app.jsx`
- Find a state hook: `grep -n "useState\b" src/app.jsx | head`

### Reading specific ranges
Use `sed -n '1000,1050p' src/app.jsx` instead of `Read` with offset/limit when grepping for a specific symbol, since the Read tool's per-file observation cache can return stale "wasted call" responses on repeated reads of the same file.

### Editing pitfalls
- **Line numbers shift after every insert/delete.** Always re-grep before targeting a line number from a previous query.
- **Edit tool failures** ("File has been modified since read") — the workaround is to re-read the file with a tiny range (`offset`+`limit=3`) to refresh the harness's tracked state, then retry the Edit. This happens often when several Edits run back-to-back.
- **Long Edits in JSX with mixed quotes/template literals**: prefer multiple smaller Edits over one big block. Easier to bisect when an Edit fails to find its target.
- **Brace balance** breaks silently — Vite build will catch it (`Unexpected token`), but a quick visual scan of the surrounding `}`/`)}` is faster.

### State naming pattern
The codebase uses a private/public setter pattern for localStorage-backed state:
```jsx
const [foo, _setFoo] = useState(() => { try { return JSON.parse(localStorage.getItem(KEY)) || default; } catch(e) { return default; } });
const setFoo = useCallback(v => {
  _setFoo(v);
  try { localStorage.setItem(KEY, JSON.stringify(v)); } catch(e) {}
}, []);
```
Match this pattern when adding any new persistent state. The `_set` setter is internal; consumers should call the public `set` wrapper.

### `perf` object shape (returned from `usePerformanceEngine`)
```js
{
  agents,           // normalized agent rows
  goalLookup,       // { byTA, byROC, byProject, byTarget }
  newHires, newHireSet,
  programs,         // array of buildProgram results, sorted by attainment desc
  programMap,       // { [jobType]: program }
  jobTypes,         // sorted array of job type strings
  regions,          // RegionStats[]
  insights,         // generated insights for BusinessOverview
  planTotal, globalGoals, totalHours, uniqueAgentCount,
  allAgentNames,
  globalRgu, globalNewXI, globalXmLines, globalNewXH, globalNewVideo,
  globalPlanRgu, globalPlanNewXI, globalPlanXmLines, globalPlanHours,
  fiscalInfo,       // { fiscalStart, fiscalEnd, lastDataDate, elapsedBDays, totalBDays, remainingBDays, pctElapsed }
  spanishCallback,  // separate stats for Spanish Callback
  tnpsData, tnpsGCS, tnpsOverall, tnpsBySite, tnpsByMonth, tnpsByAgent,
  bpLookup,         // { [ntid]: { name, supervisor, region, hireDate, role } }
}
```

### App-level state (extending the App component)
The App component owns these top-level state slots (in roughly this order):
- `rawData` (CSV rows from agent sheet) — primary trigger for everything
- `lightMode` — theme
- `showToday` — full-screen Today view toggle
- `showSettings` — Settings modal toggle
- `showMbrModal` — MBR Export modal toggle
- `localAI`, `ollamaAvailable` — Ollama integration state
- `hoursThreshold`, `hoursAutoScale` — qualified-hours threshold
- `sheetUrls`, `goalsRaw`, `newHiresRaw`, `priorMonthRaw`, `priorMonthGoalsRaw`, `tnpsRaw` — all sheet-backed state with localStorage persistence
- `currentPage`, `openMenu` — nav state (added in top-nav redesign)
- `sheetLoading`, `priorSheetLoading` — loading flags
- `aiPrefetchDone` — counter that triggers AI cache refresh

When adding a new persistent state slot, follow the localStorage pattern above and pick a key prefix matching your domain.

### Known historical quirks
- **`slideIndex` removed**: The old slide-based nav (`slideIndex`/`navTo`/`goToSlide`) was removed in the top-nav redesign. The `legacyGoToSlide` adapter in App translates old `onNav`/`goToSlide` callbacks (still used by `BusinessOverview`'s click handlers + `CampaignComparisonPanel`'s back button) into `setCurrentPage` calls. Don't reintroduce slideIndex; extend `legacyGoToSlide` instead.
- **`ProgramBySiteTab` removed**: The 314-line `ProgramBySiteTab` function was deleted with the redesign. A tombstone comment marks Section 12d. Don't try to bring it back — the new TopNav's DR/BZ menus + ProgramSiteCompareCard cover its use case.
- **Two `paddingTop` rules**: TopNav is `position: fixed`; the page content wrapper uses `paddingTop: "48px"` always (used to be conditional on `showToday`, but changed when TopNav was kept visible in Today mode).

---

## 18. Corp MBR Export (formerly "Virgil MBR") — Phases 1 & 2

A parallel monthly `.pptx` export targeting Comcast's Director of Vendor Management. Independent of the existing `Export MBR`. Originally named "Virgil MBR" after the audience; renamed to "Corp MBR" mid-Phase-2.

### Current Coverage (Phases 1 & 2 — shipped)
- **Slide 1**: Title (pre-rendered background PNG at `public/corp-mbr-title-bg.png`)
- **Slide 2**: My Performance / Quality (Coaching Standard Attainment, Acknowledgement %, Total Coaching Sessions, myPerformance Login Activity)
- **Slide 3**: All-in Attainment + Scorecard (SPH / CPS / XI / XM for current MTD, Reporting Month, Prior Month, Prior Quarter — plus uploaded scorecard PNG with auto-extract via Ollama vision)
- **Slide 4**: Quartile Reporting (GLU/GLN XM + XI agent performance bucketed by tenure)
- **Slide 5**: Campaign Hours by Funding (plan vs. actual vs. MTD-projected, 4 funding buckets)

### Data Sources (13 URLs in `.env.local`)

You need to provide your own data. The repo ships empty placeholders — copy `.env.example` → `.env.local` and fill in your published Google Sheet CSV URLs.

**Core Performance Intel (6):**
| Env var | Purpose |
|---|---|
| `VITE_DEFAULT_AGENT_SHEET_URL` | Primary agent stats |
| `VITE_DEFAULT_GOALS_SHEET_URL` | Plan targets |
| `VITE_DEFAULT_NH_SHEET_URL` | New hires / roster |
| `VITE_DEFAULT_PRIOR_SHEET_URL` | Prior-period agent snapshot |
| `VITE_DEFAULT_PRIOR_GOALS_SHEET_URL` | Prior-period goals |
| `VITE_DEFAULT_TNPS_SHEET_URL` | tNPS survey |

**Corp MBR–only (7):**
| Env var | Purpose |
|---|---|
| `VITE_DEFAULT_CORP_COACHING_DETAILS_URL` | Slide 2 org totals |
| `VITE_DEFAULT_CORP_COACHING_WEEKLY_URL` | Slide 2 DR/BZ split |
| `VITE_DEFAULT_CORP_LOGIN_BUCKETS_URL` | Slide 2 login distribution |
| `VITE_DEFAULT_CORP_PRIOR_QUARTER_AGENT_URL` | Slide 3 Prior Quarter agent stats |
| `VITE_DEFAULT_CORP_PRIOR_QUARTER_GOALS_URL` | Slide 3 Prior Quarter goals |
| `VITE_DEFAULT_CORP_PRIOR_MONTH_AGENT_URL` | Slide 3 Prior Month agent (Reporting – 1) |
| `VITE_DEFAULT_CORP_PRIOR_MONTH_GOALS_URL` | Slide 3 Prior Month goals |

URLs resolve at build time — changing `.env.local` requires a rebuild (`npx vite build`) or dev-server restart to take effect. Without a populated `.env.local` the app still runs but all URL fields appear empty; users can paste URLs directly in the Settings menus.

### localStorage Keys (per-user cache)
| Source | localStorage key |
|---|---|
| Coaching Details | `perf_intel_coaching_details_v1` |
| Weekly Breakdown | `perf_intel_coaching_weekly_v1` |
| Login Buckets | `perf_intel_login_buckets_v1` |
| Virgil insights persistence | `perf_intel_virgil_insights_v1` |
| Virgil's last name | `perf_intel_virgil_last_name` |
| Corp MBR URLs (3 coaching + Q4 pair + prior-month pair) | `perf_intel_corp_mbr_urls_v1` |

### Key Functions
- `parseCoachingDetails`, `parseCoachingWeekly`, `parseLoginBuckets` — CSV parsers
- `buildCoachingStats(details, weekly, bpLookup, monthLabel)` → `{ org, orgPrior, orgPriorPrior, dr, bz }` — org totals from Coaching Details are authoritative; DR/BZ split derived from Weekly Breakdown joined to `bpLookup`
- `buildLoginDistribution(loginBuckets, monthLabel)` — returns `[{bucket, pct, users}, ...]` in canonical order
- `makeMonthFilter(monthLabel)` — **fiscal** month filter (22nd of prior month through 21st of current month)
- `makeQuarterFilter(year, qNum)`, `makeGoalsMonthFilter`, `makeGoalsQuarterFilter`
- `computeCorpAttainment(agentRaw, goalsRaw, dateFilter, goalsMonthFilter, agentRocFilter, goalsRocFilter)` — returns `{ xi, xm, sph, cps, planSph, planCps }`. Excludes `GS*` (Cox) universally; SPH/CPS additionally exclude `GLB` (XMC).
- `buildQuartileReport(agentRaw, goalsRaw, newHiresRaw, dateFilter, referenceDate)` — GLU=XM, GLN=XI split, tenure-bucketed
- `buildCampaignHoursByFunding(agentRaw, goalsRaw, monthFilter)` — accumulates plan across DR+BZ site rows per ROC; business-days MTD pacing
- `ollamaGenerateWithImage(prompt, imageDataUrl, model="llava")` — scorecard OCR
- `corpPalette`, `drawCorpCard(slide, x, y, w, h)` — unified visual motif (rounded card container)
- `virgilBrandBars(pres, slide)` — teal + purple gradient top/bottom bars + footer
- Slide builders: `buildVirgilTitleSlide`, `buildVirgilMyPerformanceSlide`, `buildCorpOpPerformanceSlide`, `buildCorpQuartileSlide`, `buildCorpCampaignHoursSlide`
- `buildVirgilMbrPresentation(perf, options)` — orchestrator
- UI: `VirgilMbrExportModal`, `CorpMbrDataSourcesModal`

All Corp MBR code lives in `src/app.jsx` under `// VIRGIL MBR —` / `// CORP MBR —` section headers. Line numbers shift — use Grep.

### Fiscal Calendar Notes
- Fiscal month = 22nd of prior calendar month → 21st of current. "Mar '26" = Feb 22 – Mar 21.
- `makeMonthFilter` implements this; legacy code paths using calendar months will mis-filter.
- Q4 = fiscal Sep 22 – Dec 21. The Prior Quarter CSV is already scoped, so passing a null filter is correct.
- MTD pacing uses **business days only** (Mon–Fri) via `bizDaysBetween(start, end)`.

### ROC / Funding Semantics
| Prefix | Meaning | Treatment |
|---|---|---|
| `GLU` | XM campaigns | Kept for all slides |
| `GLN` | XI (HSD) campaigns | Kept for all slides |
| `GLB` | XMC campaigns | Included in XI/XM rollups; **excluded** from SPH/CPS |
| `GS*` | Cox | **Excluded globally** across all Corp MBR slides and the tenure slide |

### Specs & Plans
- Spec: `docs/superpowers/specs/2026-04-12-virgil-mbr-export-design.md` (full 8-slide scope)
- Phase 1 plan: `docs/superpowers/plans/2026-04-12-virgil-mbr-phase-1.md`
- Phase 2 plan: `docs/superpowers/plans/2026-04-12-virgil-mbr-phase-2.md`

### Phase 3 Status
Phase 3 shipped 2026-04-13 — full 8-slide deck live. Campaign Slides fan out per Job Type group.

---

## 19. MyPerformance Coaching Page (shipped 2026-04-15)

An in-app top-nav page that surfaces **MyPerformance coaching attainment** — the same data powering Corp MBR Slide 2 — as a live interactive view. Answers: "Are we hitting the coaching standard?" and "Where are the gaps?" even when org % looks healthy.

### Nav & Routing
- **TopNav button**: "MyPerformance" (between tNPS and pacing pill)
- **Section key**: `{ section: "coaching" }` — persists in `perf-intel-current-page` localStorage
- **Guard**: `hasCoaching` flag — button hidden when no coaching data loaded
- **Empty state**: centered message directing to Settings ⚙ → Data sources

### Tabs
| Tab | Component | Purpose |
|---|---|---|
| Summary | `CoachingSummaryTab` | 4 KPI tiles + Site Comparison bars + Site WoW table + Weekly Trend bars |
| By Supervisor | `CoachingBySupervisorTab` | Supervisor attainment bar chart + expandable grid (click row → agent detail) |
| All Agents | `CoachingAllAgentsTab` | Flat agent grid with search + sortable columns |

### Data Sources (no new sheets)
All three feeds are already loaded for Corp MBR:

| Source | Variable | Parser | What it provides |
|---|---|---|---|
| Coaching Details | `coachingDetails` | `parseCoachingDetails` | Org-level KPI: `Coaching Sessions / Coachings Due`, `Acknowledged %`, `Total Sessions` |
| Weekly Breakdown | `coachingWeekly` | `parseCoachingWeekly` | Per-agent-week: `{ displayName, ntid, fiscalMonth, fiscalWeek, sessions, colorWb, manager, supervisor }` |
| Roster | `perf.bpLookup` | `buildBpLookup` | NTID → `{ name, supervisor, region }` for site/supervisor assignment |

**App-scope memos**: `coachingDetails` and `coachingWeekly` are parsed at App scope (lines ~17604) independently of `VirgilMbrExportModal`'s internal copies. Both exist intentionally — don't consolidate without updating the modal signature.

### Aggregator: `buildCoachingPageData`

Central memoized function (~line 6722). Signature:
```js
buildCoachingPageData(coachingWeekly, coachingDetails, bpLookup, monthFilter)
// monthFilter: { mode: "current" | "select" | "all", months: Set<string> }
```

Returns:
```js
{
  org: { coachingPct, coachingX, coachingY, ackPct, ackX, ackY, totalSessions },
  bySiteRollup: { dr: {x, y, pct}, bz: {x, y, pct} },
  bySite: [{ site, region, x, y, pct }],
  byWeek: [{ week, x, y, pct }],          // hybrid buckets (see below)
  byWeekBySite: [{ week, sites: [{label, x, y, pct}] }],
  bySupervisor: [{ supervisor, site, region, agentCount, weeks, sessionsX, sessionsY, pct, agents }],
  allAgents: [{ ntid, agentName, supervisor, site, region, weeks, sessionsX, sessionsY, pct }],
  fiscalMonths, currentMonth, activeMonths, weekLabels,
  agentCellMode: "count" | "pct",          // "count" single-month, "pct" multi-month
}
```

### Hybrid Bucketing (multi-month)
- **Single-month**: one bucket per fiscal week → labels `"Apr W1"`, `"Apr W2"`, etc.
- **Multi-month**: prior months collapse to single buckets; current month stays per-week → `["Jan", "Feb", "Mar", "Apr W1", "Apr W2", "Apr W3"]`
- Agent cells switch from raw session count (`mode="count"`) to X/Y percentage (`mode="pct"`) via `agentCellMode`

### Math: Uncapped Sessions
All X/Y metrics use **uncapped session sums** — an agent coached 8 times in one week contributes 8 to the numerator. This matches the Comcast `Coaching Sessions / Coachings Due` methodology and surfaces over-indexing (shown as indigo `#6366f1` when X > Y).

### Color Thresholds
| State | Threshold | Color | Row tint (dark/light) |
|---|---|---|---|
| Critical | < 50% or 0 | Red `#dc2626` | `#2a1414` / `#fef2f2` |
| Behind | 50–79% | Amber `#d97706` | `#2a2014` / `#fffbeb` |
| Close | 80–99% | Blue `#2563eb` | `#15212a` / `#eff6ff` |
| On standard | ≥ 100% | Green `#16a34a` | `#14241a` / `#f0fdf4` |
| Over-indexed | > 100% | Indigo `#6366f1` | `#1a1d28` / `#eef2ff` |
| No data | null | Slate `#94a3b8` | transparent |

Per-week agent cells use count-based colors: 0=red, 1=green, 2+=indigo, null=grey `#444`.

### Helpers (module-scope, near `attainColor` and `buildCoachingStats`)
| Helper | Purpose |
|---|---|
| `coachingCellColor(sessions)` | Count → `{bg, fg}` for agent week cells |
| `coachingPctColor(pct)` | Attainment % → hex color (with indigo for >100%) |
| `coachingRowTint(pct)` | Attainment % → `{dark, light}` row backgrounds |
| `coachingSiteFromRegion(region)` | Region → `{site: "DR"\|"BZ"\|null, region}`. Normalizes `SD-Xfinty` typo |
| `coachingRegionLabel(region)` | Friendly label: `SD-Xfinity` → `"Dom. Republic"`, strips `-XOTM` suffix |
| `isValidCoachingRegion(region)` | Returns true only for Xfinity regions (XOTM + SD-Xfin*). Drops SD-Cox, FCC |
| `coachingNormalizedPct(rawVal)` | Handles both 0.84 and 84 conventions |
| `makeSiteFilter(activeChip)` | Returns predicate `(region) → boolean` for site chip filtering |

### Components (module-scope, before `TNPSSlide`)
| Component | Purpose |
|---|---|
| `KpiTile` | Accent-bordered card for summary metrics |
| `WeekCell` | Single cell — `mode="count"` (raw sessions) or `mode="pct"` (X/Y) |
| `SiteChip` | Toggle button for site filtering |
| `AgentRow` | Agent grid row. `indented` prop drops supervisor column. `cellMode` prop switches WeekCell mode |
| `SupervisorRow` | Clickable row with expand → nested AgentRows. Uses `Fragment` |
| `CoachingSiteChips` | 6-chip bar: All / DR / BZ (all) / Belize City / OW / San Ignacio |
| `CoachingSummaryTab` | KPI tiles + site comparison + site WoW table + weekly trend |
| `CoachingBySupervisorTab` | Supervisor bar chart + expandable grid with site chips |
| `CoachingAllAgentsTab` | Flat agent grid with search + sortable column headers |
| `CoachingPage` | Page composer: header, time-mode toggle, tab bar, empty state |

### Critical Gotchas
1. **bpLookup case + prefix**: `buildBpLookup` lowercases keys. `parseCoachingWeekly` strips `BP-` prefix but doesn't lowercase. Aggregator tries 3 key formats: `ntid`, `bp-${ntid}`, `ntid.replace(/^bp-/,"")` — all lowercased.
2. **NCR exclusion**: `colorWb === "No Coaching Required"` rows skipped before any session counting (matches `buildCoachingStats`).
3. **Valid regions only**: `isValidCoachingRegion` drops SD-Cox, FCC, and other non-Xfinity regions.
4. **SD-Xfinty typo**: `coachingSiteFromRegion` normalizes to `SD-Xfinity` automatically.
5. **Manager/departed filter**: Supervisors with <2 agents are hidden from the supervisor grid (catches manager-role and departed supervisors with stale single-agent assignments).
6. **Duplicate App-scope memos**: `coachingDetails`/`coachingWeekly` useMemos exist BOTH in App (~line 17604) AND in `VirgilMbrExportModal` (~line 9484). Intentional — don't consolidate without updating both consumers.
7. **`agentCellMode`**: Drives whether agent cells render count or X/Y. Multi-month = `"pct"`, single-month = `"count"`. Passed through `CoachingPage` → tabs → `SupervisorRow` → `AgentRow`.

### Specs & Plans
- Spec: `docs/superpowers/specs/2026-04-15-coaching-page-design.md`
- Plan: `docs/superpowers/plans/2026-04-15-coaching-page.md`
