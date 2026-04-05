# SPH % to Goal by Site Chart

**Date:** 2026-04-04
**Status:** Approved
**Scope:** Replace the GPH Trend by Week chart at the bottom of `WeeklyTrendsPanel` (lines ~7556-7596 of app.jsx) with a grouped bar chart showing SPH % to Goal broken down by site per program.

## Problem

The GPH Trend by Week chart shows weekly GPH progression but doesn't tell you which sites are performing well or poorly relative to their goals. The MBR deck has a "SPH % to Goal by Site" chart that answers this question clearly — this brings that same visualization into the live dashboard with dynamic filtering.

## Design

### Chart Type
Grouped bar chart. Programs on the X-axis, grouped bars per site within each program. Bar height represents SPH as a percentage of the SPH goal for that program. No aggregate "All Sites" bar — only individual site bars.

### Visual Elements
- **Bars:** One per site per program, color-coded by site
- **100% reference line:** Horizontal dashed line at 100% marking "at goal"
- **Percentage labels:** Above each bar showing the % value
- **Program labels:** Below each group on the X-axis
- **Y-axis:** 0 to max value (auto-scaled, minimum 100% so the reference line always shows), with gridlines at 20% intervals. Visually capped at 120% — bars above 120% render at 120% height but their label shows the actual value.
- **Legend:** Site color key below the chart
- **Best site highlight:** The highest-performing site per program gets its bar color set to green (`#16a34a`) regardless of its normal site color. Other sites keep their assigned colors. This matches the MBR convention.

### Site Colors (default, when not the best performer)
- Belize City (`Belize City-XOTM`) = `#16a34a` (green)
- Dom. Republic (`SD-Xfinity`) = `#2563eb` (blue)
- San Ignacio (`San Ignacio-XOTM`) = `#7c3aed` (purple)

When a site is the best performer in its program, its bar is green. Since Belize City is already green, the override only visually changes DR (blue→green) or San Ignacio (purple→green) when they lead.

Use `MBR_SITE_NAMES` for display labels: "Belize City", "Dom. Republic", "San Ignacio"

### Data Computation

Use the `programs` prop (pre-built by `buildPrograms()`). Each program has `program.agents` (raw agent rows with `region`, `goals`, `hours` fields) and `program.goalEntry` (siteMap for SPH goal lookup).

For each program:
1. Get SPH goal: average `"SPH GOAL"` values across plan rows using the same approach as the scorecard:
   ```js
   const rows = uniqueRowsFromEntry(program.goalEntry);
   const vals = rows.map(r => parseNum(findCol(r, "SPH GOAL", "SPH Goal"))).filter(v => v > 0);
   const sphGoal = vals.length > 0 ? vals.reduce((s, v) => s + v, 0) / vals.length : null;
   ```
   **Note:** The goals CSV has site keys "BZ" and "DR", not individual region names. Both Belize City and San Ignacio fall under "BZ" and share the same SPH goal. This is correct — there is one SPH goal per program, not per site.

2. If no SPH goal, skip this program entirely.

3. For each unique region in `program.agents`:
   - Filter agents to that region: `program.agents.filter(a => a.region === regionName)`
   - Sum hours and goals across those agents
   - If hours < 10, exclude this site
   - Compute `SPH = totalGoals / totalHours`
   - Compute `pctToGoal = (SPH / sphGoal) * 100`

4. If no sites qualify (all < 10 hours), skip this program.

### Props Changes

`WeeklyTrendsPanel` currently receives:
```js
{ currentAgents, priorAgents, fiscalInfo }
```

Add two new props:
```js
{ currentAgents, priorAgents, fiscalInfo, goalLookup, programs }
```

- `programs` comes from `perf.programs` — the pre-built program array with `agents`, `goalEntry`, `jobType`, etc.
- `goalLookup` is used only for gating (checking if goals are loaded)

Update the call site in `BusinessOverview` (the `{tab === "trends" && ...}` block) to pass `goalLookup={goalLookup} programs={programs}`.

### Filter Integration

The chart responds to the existing `siteFilter` and `programFilter` state in `WeeklyTrendsPanel`.

**How filtering works:** The chart iterates over the `programs` prop array and applies filters within the chart computation (not using the `filterAgents` function which filters `currentAgents`):

- **programFilter:** If not "All", only include programs where `program.jobType === programFilter`.
- **siteFilter:**
  - `"ALL"` — show all regions that have 10+ hours
  - `"BZ"` — only show regions containing "XOTM" (Belize City, San Ignacio)
  - `"DR"` — only show non-XOTM regions (SD-Xfinity)
  - Specific region name (e.g., `"San Ignacio-XOTM"`) — only show that exact region

Both filters applied together.

### Gating

Only render when `goalLookup` is truthy. When not available, show:
```
"Load goals CSV to unlock SPH % to Goal chart"
```
in a muted info box matching the existing "Load prior month data" banner style (indigo tint, left border accent).

### Exclusions

- Sites with < 10 total hours in a program are excluded
- Programs where no site has 10+ hours are excluded entirely
- Programs with no SPH goal are excluded

### Sort Order

Programs ordered by their best site's % to Goal, descending (best-performing programs first).

### Theme Support

Use existing CSS variables:
- Container: `var(--bg-secondary)`, `1px solid var(--border)`, `var(--radius-lg)`
- Text: `var(--text-muted)` for title/labels, `var(--text-dim)` for axis values and bar labels
- 100% reference line: `var(--text-faint)` dashed
- Bar rendering: pure CSS divs with inline styles (no canvas/SVG, matching existing chart patterns)

## What Gets Removed

The entire GPH Trend by Week chart block (lines ~7556-7596), including:
- The `weeks.filter(w => w.cur).length >= 2` gate
- The bar chart with current/prior GPH bars per week
- The current/prior legend

## Implementation Notes

- Built with CSS flexbox divs (same technique as existing GPH trend chart and quartile bars)
- Bar width: flexible, divided equally per program group with gaps between groups
- Bar height: proportional to % to Goal, where 100% maps to a fixed reference height. Values above 120% render at 120% height but label shows actual value.
- Minimum bar height: 2px for zero/near-zero values
- `uniqueRowsFromEntry`, `findCol`, and `parseNum` are all available at module scope in app.jsx
