# Coaching Standard Attainment — Page Design Spec

> **Date:** 2026-04-15
> **Status:** Design approved; ready for implementation plan
> **Audience for spec:** future implementers (Claude or human) needing to build this page
> **Audience for page:** internal team (supervisors + agents + leadership) using it as a daily-glance "visual reminder" of coaching attainment

---

## 1. Purpose

A new top-nav page in Performance Intel that surfaces **MyPerformance coaching attainment** — the same data already powering Slide 2 of the Corp MBR `.pptx` export — as an in-app live view.

The page must answer two questions at every level (org / site / supervisor / agent):

1. **Are we hitting the standard?** (1 coaching per agent per week, capped per agent-week)
2. **Where are the gaps?** Even when org % looks healthy, individual agents can be missing coachings due to over-indexing on others. The page must make those gaps impossible to miss.

Read-only. No exports. No editing. No alerting.

---

## 2. Source data (no new pipelines)

All three feeds are already parsed and loaded for Corp MBR. This page consumes them — it does not add new sheets.

| Source | Variable in App | Parser | Used for |
|---|---|---|---|
| Coaching Details (long format) | `coachingDetails` | `parseCoachingDetails` (line ~6475) | Org-level KPI tile (`Coaching Sessions / Coachings Due`, `Acknowledged %`, `Total Sessions`) |
| Weekly Breakdown (per-agent-week) | `coachingWeekly` | `parseCoachingWeekly` (line ~6491) | Per-agent-week session counts; site/sup/agent rollups via `bpLookup` join |
| Roster | `bpLookup` (in `perf`) | `buildBpLookup` (existing) | NTID → `{ name, supervisor, region, hireDate, role }`; drives site/supervisor assignment |

**Data flow:** `coachingWeekly` is the primary source for site/sup/agent breakouts. Each row = `{ displayName, ntid, fiscalMonth, fiscalWeek, sessions, colorWb, manager, supervisor }`. Rows where `colorWb === "No Coaching Required"` are excluded from eligibility math (existing convention from `buildCoachingStats`).

**Site mapping rule** (matches `buildCoachingStats`): `bpLookup[ntid].region` → if uppercase contains "XOTM" → `BZ`; else → `DR`. The `region` itself (e.g. `"San Ignacio-XOTM"`) is also retained for sub-site filtering.

---

## 3. New aggregator: `buildCoachingPageData`

A single memoized function in `src/app.jsx` (placed near `buildCoachingStats`, ~line 6685). Returns the structure all three tabs render from.

```js
buildCoachingPageData(coachingWeekly, coachingDetails, bpLookup, monthFilter)
```

**Inputs:**
- `coachingWeekly` — array of weekly rows
- `coachingDetails` — long-format object keyed by month
- `bpLookup` — NTID → roster info
- `monthFilter` — `{ mode: "current" | "select" | "all", months: Set<string> }`

**Output shape:**

```js
{
  org: {
    coachingPct: 0.87,        // from Coaching Details
    coachingX: 142,           // Coaching Sessions
    coachingY: 162,           // Coachings Due
    ackPct: 0.84,             // from Coaching Details
    ackX: 119,                // derived: round(ackPct × totalSessions)
    ackY: 142,                // total sessions
    totalSessions: 142,
  },
  bySite: [
    { site: "DR",          region: "SD-Xfinity",        x: 62,  y: 68,  pct: 0.91 },
    { site: "BZ",          region: "Belize City-XOTM",  x: 18,  y: 22,  pct: 0.82 },
    { site: "BZ",          region: "OW-XOTM",           x: 11,  y: 14,  pct: 0.79 },
    { site: "BZ",          region: "San Ignacio-XOTM",  x: 12,  y: 14,  pct: 0.86 },
  ],
  byWeek: [
    // org-level weekly trend for the Summary chart
    { week: "FW1", pct: 0.92, x: 38, y: 41 },
    { week: "FW2", pct: 0.88, x: 36, y: 41 },
    { week: "FW3", pct: 0.79, x: 34, y: 43 },
    { week: "FW4", pct: null, x: null, y: null },  // future / no data yet
  ],
  bySupervisor: [
    {
      supervisor: "Daysha",
      site: "DR",                        // primary site (mode of agents' sites)
      region: "SD-Xfinity",
      agentCount: 8,
      weeks: [                           // ordered FW1..FWn
        { week: "FW1", x: 8, y: 8, pct: 1.00 },
        { week: "FW2", x: 7, y: 8, pct: 0.875 },
        { week: "FW3", x: 8, y: 8, pct: 1.00 },
        { week: "FW4", x: null, y: null, pct: null },
      ],
      sessionsX: 23, sessionsY: 24, pct: 0.96,
      agents: [                          // each agent in this supervisor's team
        {
          agentName: "Wilson Cruz",
          ntid: "...",
          site: "DR", region: "SD-Xfinity",
          weeks: [
            { week: "FW1", sessions: 1, eligible: true },   // sessions = number of coachings that week
            { week: "FW2", sessions: 1, eligible: true },
            { week: "FW3", sessions: 1, eligible: true },
            { week: "FW4", sessions: null, eligible: false }, // future or "No Coaching Required"
          ],
          sessionsX: 3, sessionsY: 3, pct: 1.00,
        },
        // ... more agents
      ],
    },
    // ... more supervisors
  ],
  allAgents: [
    // flat list, same shape as one of bySupervisor[].agents — for the All Agents tab
    // each agent appears exactly once
  ],
  fiscalMonths: ["Jan '26", "Feb '26", "Mar '26"],   // sorted chronologically; powers the month selector
  currentMonth: "Mar '26",                            // resolved from monthFilter
}
```

**Cell math (per agent-week):**
- `sessions` = sum of weekly rows for that (ntid, fiscalWeek) — typically 0, 1, 2+
- `eligible` = at least one row exists for that (ntid, fiscalWeek) where `colorWb !== "No Coaching Required"`. If only "No Coaching Required" rows exist, mark `eligible: false` and render the cell as "—" (grey).

**Cell math (per supervisor-week):**
- `x` = count of distinct agents under that supervisor with `sessions ≥ 1` in that week
- `y` = count of distinct eligible agents under that supervisor in that week
- `pct` = `x / y` (or null when `y === 0`)

**Sessions totals:**
- Per agent: `sessionsX = Σ sessions per eligible week (capped at 1 per week if you want pure standard math, OR uncapped to show over-indexing)`. **Decision: uncapped** — so over-indexing shows as 5/4 = 125%. The cap-vs-uncap is the whole point of surfacing over-indexing to the user.
- Per supervisor: `sessionsX = Σ over all of the supervisor's agents' uncapped sessions`; `sessionsY = Σ eligible agent-weeks under that supervisor`.

**Multi-month behavior** (`mode: "select"` or `"all"`):
- Weekly columns extend to FW1..FWn across all included months (e.g. "Feb FW1", "Feb FW2", … "Mar FW4")
- Or, simpler v1: aggregate to month-level columns instead of week-level when more than one month is selected. **Decision: month-level columns when multi-month** (otherwise the table becomes unwieldy). Single-month view keeps FW columns. This is documented as a deliberate UX choice.

---

## 4. Page architecture

### 4.1 Nav placement
- New section key: `{ section: "coaching" }` added to App's `currentPage` state machine
- Top-nav button "Coaching" added to `TopNav` between **tNPS** and the pacing pill, using `topNavLinkStyle` with the existing accent (orange `#d97706` to match tNPS)
- Click from any other page navigates here; clicking it from Today view exits Today AND navigates (existing pattern)
- Persists to `localStorage["perf-intel-current-page"]` (existing key)

### 4.2 Page header
- Title: **"Coaching Standard Attainment — myPerformance"** (left)
- Subtitle: `${activeAgentWeekCount} agent-weeks · ${monthLabel}` (e.g. "162 agent-weeks · Mar '26")
- Right side: **time-mode toggle** — `Current Month` / `Select Month` / `All Time` (mirrors tNPS)
- When `Select Month` is active: a chip row appears below with the available months

### 4.3 Tab bar
Tabs in order: **Summary · By Supervisor · All Agents**. Pattern matches tNPS — orange underline on active, transparent border otherwise. Tab state held in component-local `useState`.

### 4.4 Empty state
If `coachingWeekly.length === 0` AND `Object.keys(coachingDetails).length === 0`, render a centered message:

> "No coaching data loaded — upload Coaching Details and Weekly Breakdown via Settings ⚙ → Data sources."

If only one of the two is empty, render the page with the empty side showing "—" in the affected tiles/columns rather than crashing.

---

## 5. Tab 1: Summary

### 5.1 KPI tiles (4-column grid)

| Tile | Value | Subtitle | Accent |
|---|---|---|---|
| Org Coaching | `${pct}%` | `${x} / ${y} sessions` | green if ≥100%, blue ≥80%, amber >0%, red 0% |
| DR Coaching | `${pct}%` | `${x} / ${y} agent-weeks` | same scale |
| BZ Coaching | `${pct}%` | `${x} / ${y} agent-weeks` | same scale |
| Acknowledgement | `${pct}%` | `${x} / ${y} sessions` | green ≥90%, blue ≥75%, amber >0%, red 0% |

Card style matches tNPS hero tiles: `var(--glass-bg)` background, 3px colored top border, large display number, small caps label.

### 5.2 Site comparison bar chart
- Bars: DR · Belize City · OW · San Ignacio (sub-site granularity)
- Y axis: attainment % (0–100, or higher if over-indexing)
- Color: each site in its accent (DR orange `#ed8936`, BZ greens `#48bb78`)
- Above each bar: "X/Y" label (e.g. "62/68")
- Below each bar: site name + agent count
- Pattern parallel to tNPS "GCS Site Comparison" chart

### 5.3 Weekly trend chart
- 4 grouped bars per fiscal week (FW1..FW4): one bar each for Org / DR / BZ
- Color: org = neutral grey, DR = orange, BZ = green
- Hover: tooltip shows X/Y and %
- Future weeks: dashed outline placeholders
- When multi-month is selected, X axis becomes month-level (one group per month) instead of week-level

---

## 6. Tab 2: By Supervisor

### 6.1 Site filter chips (sticky to top of tab content)
`All` · `DR` · `BZ (all)` · `Belize City` · `OW` · `San Ignacio`

- "All" is default, orange filled
- Others are outlined with their site accent (DR orange, BZ green for both BZ-all and sub-sites)
- Selection is single-pick (radio behavior, not multi-select)
- Filter applies to the supervisor list (only show supervisors whose primary site matches) AND to the agents shown when expanded

### 6.2 Supervisor table
Columns: **Supervisor · Site · Agents · FW1 · FW2 · FW3 · FW4 · Sessions · %**

- Each row = one supervisor
- Site cell shows the supervisor's primary region (e.g. "Belize City" not "BZ")
- Agents cell = count of distinct eligible agents under this supervisor across the selected period
- FW cells: "X/Y" colored by `pct` (green ≥100%, blue ≥80%, amber >0%, red 0%, grey "—" if `y === 0`)
- Sessions cell: "X/Y" total for the period
- % cell: percentage with same color scale
- Row left-border (3px) colored by overall % (red/amber/blue/green)
- Row background: subtle tint matching state (`#14241a` green / `#2a2014` amber / `#2a1414` red — adjust for light mode via CSS vars)
- Cursor: pointer
- Default sort: % ascending (worst first); column headers clickable to re-sort (Name A→Z, Sessions desc, % asc/desc)

### 6.3 Expand behavior
- Click row → expand inline below: indented section with the supervisor's agents
- **Multiple supervisors can be open at once.** Default = all collapsed
- Expand/collapse indicator: ▸ / ▾ in front of supervisor name
- Expanded section uses the same agent-grid pattern as Tab 3 (see §7), but scoped to that supervisor's team
- Indented styling (12px left padding + dashed left border at supervisor-row's accent color)

---

## 7. Tab 3: All Agents

### 7.1 Site filter chips
Same chip set and behavior as By Supervisor.

### 7.2 Search input
- Right-aligned in the chips row, placeholder "Search agent name..."
- Filters the agent list by case-insensitive substring match on `agentName`

### 7.3 Agent table
Columns: **Agent · Supervisor · Site · FW1 · FW2 · FW3 · FW4 · Sessions · %**

- Each row = one agent (flat — no grouping)
- FW cells: numeric session count colored as
  - `0` → red `#dc2626` (gap)
  - `1` → green `#16a34a` (on standard)
  - `2+` → indigo `#6366f1` (over-indexed)
  - "—" grey `#444` (future or "No Coaching Required" only)
- Sessions cell: "X/Y" colored by attainment band — indigo `#6366f1` **if X > Y** (over-indexed; takes priority over green); else green ≥100%, blue ≥80%, amber >0%, red 0%
- % cell: same color rules as Sessions cell (indigo when >100%)
- Default sort: % ascending (worst first); ties broken by agent name A→Z
- Column headers clickable

**Why the per-week cells use a different color scale than the supervisor row's per-week cells (§6.2):** they encode different things. Agent cells show a raw session *count* — the relevant question is "did this agent get coached this week, and how many times?" — so the colors map count buckets (0/1/2+). Supervisor cells show *attainment %* across the team — the relevant question is "what fraction of the team got coached this week?" — so the colors map percentage bands (≥100/≥80/etc).

### 7.4 Header summary line above table
"`${filteredAgentCount}` agents · `${gappedAgentCount}` with gaps" — keeps gap visibility prominent even when scrolling.

---

## 8. Visual conventions

### 8.1 Color scale (cell + row tint)

| State | Threshold | Hex | Use |
|---|---|---|---|
| Green | ≥ 100% | `#16a34a` | On standard, KPI ≥ 100%, agent FW = 1 |
| Blue | ≥ 80% | `#2563eb` | KPI partial attainment |
| Amber | > 0% | `#d97706` | Behind, partial week attainment |
| Red | 0% | `#dc2626` | Missed, agent FW = 0 |
| Indigo | over-indexed | `#6366f1` | Agent FW ≥ 2, total > 100% |
| Grey | N/A | `#444` | Future / "No Coaching Required" |

These match existing `attainColor` thresholds — **reuse the helper, don't duplicate.**

### 8.2 Row backgrounds
Subtle tinted backgrounds make state legible at a glance:
- Green row: `#14241a` dark / `#f0fdf4` light
- Amber row: `#2a2014` dark / `#fffbeb` light
- Red row: `#2a1414` dark / `#fef2f2` light
- Indigo (over-indexed): `#1a1d28` dark / `#eef2ff` light

Implement via existing CSS vars where possible; new vars added to `THEMES` if needed.

### 8.3 Layout container
Root: `maxWidth: 1100, margin: "0 auto", padding: "0 2.5rem 2rem"` — matches tNPS / SiteDrilldown.

---

## 9. Component layout in `src/app.jsx`

| New element | Approx insertion point | Notes |
|---|---|---|
| `buildCoachingPageData` aggregator | ~line 6685 (after `buildCoachingStats`) | Module-scope helper, pure function |
| `CoachingPage` component | ~line 9485 (just before `TNPSSlide`) | Top-level page component |
| Sub-components (KPI tile, SupervisorRow, AgentRow, WeekCell, SiteChip) | Module-scope, before `CoachingPage` | Hoisted per existing convention (see §13.14 of training doc) |
| TopNav button | Inside `TopNav` component | Add between tNPS button and pacing pill |
| App's `currentPage` ternary | App render block | New branch for `section === "coaching"` |

**No new files.** All code lives in `src/app.jsx` per project convention.

---

## 10. Out of scope (intentionally)

- No new data uploads, sheet sources, or settings — leverages existing Corp MBR pipeline
- No PPTX/PDF/CSV export from this page (Corp MBR already covers exec reporting)
- No editing of coaching data — read-only
- No alerts, notifications, or scheduled emails
- No drill-down beyond agent → weekly cell (cells do not open a deeper view)
- No comparison to prior period on this page (Corp MBR Slide 2 already does that)
- No tab for "By Site" — site comparison lives only in Summary; site filtering covers per-tab needs

---

## 11. Open questions for implementation

These can be resolved during planning, not blocking spec approval:

1. **Multi-month FW vs month-level columns** — confirm month-level is the right cutover, or do users prefer the wider FW table even with horizontal scroll?
2. **Sub-site supervisor primary** — when a supervisor's agents span multiple sub-sites (e.g., one Belize City agent + two OW agents), what's the supervisor's "primary site"? Default proposal: mode of agent regions, with first-alphabetical tiebreak.
3. **Agents with no supervisor in `bpLookup`** — currently dropped by `buildCoachingStats`. Should the page show them under an "Unassigned" supervisor group or continue to drop them?
4. **Light mode color tuning** — the dark backgrounds above are illustrative; need to verify contrast in light mode and adjust opacity values.
5. **Mobile / narrow-screen layout** — agent grid has 9 columns; below ~900px it'll need horizontal scroll or column collapsing. Not critical for v1 (page is desktop-targeted) but worth noting.

---

## 12. Done definition

- New top-nav "Coaching" link visible alongside tNPS
- All 3 tabs render without errors against current Corp MBR data
- Site chips filter both supervisor and agent lists correctly
- Supervisor expand/collapse works with multi-expand
- Cell colors match the §8.1 scale
- Time-mode toggle (Current/Select/All) works and updates all three tabs
- Empty state shown when no coaching data is loaded
- Vite production build succeeds; manual smoke test passes against the live `gid=671384384` weekly sheet
- Page persists across reload (`perf-intel-current-page` captures it)
