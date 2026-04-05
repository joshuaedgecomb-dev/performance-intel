# Program Scorecard Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the dense 11-column Program Scorecard on the Overview tab with a cleaner 9-column design featuring visual progress bars, independent sub-metric coloring, and aligned quartile distribution bars.

**Architecture:** Single-file edit to `src/app.jsx`. The scorecard lives inside an IIFE in the `BusinessOverview` component (lines ~5729-5904). We replace the entire scorecard block — header, thead, tbody rows, and footer — preserving the surrounding container `<div>`. No new files, no new dependencies.

**Tech Stack:** React (inline JSX), existing CSS variables, existing `calcPacing()` and `getPlanForKey()` helpers.

**Spec:** `docs/superpowers/specs/2026-04-04-scorecard-redesign-design.md`

---

### Task 1: Add `projColor` helper and compute Avg Agents/Day

**Files:**
- Modify: `src/app.jsx:~5730-5738` (scorecard IIFE preamble)

This task adds the new color helper and pre-computes per-program data needed by the redesigned rows.

- [ ] **Step 1: Add `projColor` helper inside the scorecard IIFE**

Right after the opening `{(() => {` at line 5730, before the existing `const tHours` line, add:

```js
const projColor = pct => pct >= 100 ? "#16a34a" : pct >= 85 ? "#2563eb" : "#dc2626";
```

- [ ] **Step 2: Add per-program data computation**

After the existing `aheadCount` line (~5738), add the pre-computation block that builds per-program avg/day, pacing, and sub-metric projections. This runs once per render and the results are used in each row:

```js
// Pre-compute per-program scorecard data
const progData = programs.map(p => {
  // Avg agents per day
  const agentsPerDay = {};
  p.agents.forEach(a => {
    if (!a.date || !a.agentName) return;
    if (!agentsPerDay[a.date]) agentsPerDay[a.date] = new Set();
    agentsPerDay[a.date].add(a.agentName);
  });
  const dayCount = Object.keys(agentsPerDay).length;
  const avgDay = dayCount > 0
    ? Math.round(Object.values(agentsPerDay).reduce((sum, set) => sum + set.size, 0) / dayCount)
    : 0;

  // Sales pacing
  const pace = fiscalInfo && p.actGoals && p.planGoals
    ? calcPacing(p.actGoals, p.planGoals, fiscalInfo.elapsedBDays, fiscalInfo.totalBDays)
    : null;

  // GPH goal (SPH GOAL is a rate)
  const sphGoal = p.goalEntry ? getPlanForKey(p.goalEntry, "SPH GOAL") : null;

  // Sub-metric plans
  const planHsd = p.goalEntry ? getPlanForKey(p.goalEntry, "HSD Sell In Goal") : null;
  const planXm  = p.goalEntry ? getPlanForKey(p.goalEntry, "XM GOAL") : null;
  const planRgu = p.goalEntry ? getPlanForKey(p.goalEntry, "RGU GOAL") : null;

  // Sub-metric pacing (projected %)
  const hsdPace = fiscalInfo && planHsd ? calcPacing(p.totalNewXI, planHsd, fiscalInfo.elapsedBDays, fiscalInfo.totalBDays) : null;
  const xmPace  = fiscalInfo && planXm  ? calcPacing(p.totalXmLines, planXm, fiscalInfo.elapsedBDays, fiscalInfo.totalBDays) : null;
  const rguPace = fiscalInfo && planRgu ? calcPacing(p.totalRgu, planRgu, fiscalInfo.elapsedBDays, fiscalInfo.totalBDays) : null;

  // Belize-only detection
  const isBelizeOnly = p.agents.length > 0 && p.agents.every(a =>
    a.region && a.region.includes("XOTM")
  );

  return { ...p, _origIdx: i, avgDay, pace, sphGoal, planHsd, planXm, planRgu, hsdPace, xmPace, rguPace, isBelizeOnly };
});
```

- [ ] **Step 3: Verify the app still builds**

Run: `npm start` (or refresh browser with dev server)
Expected: No errors, scorecard renders as before (progData is computed but not yet used)

- [ ] **Step 4: Commit**

```bash
git add src/app.jsx
git commit -m "feat(scorecard): add projColor helper and per-program data pre-computation"
```

---

### Task 2: Replace the scorecard table header

**Files:**
- Modify: `src/app.jsx:~5774-5790` (the `<thead>` block)

- [ ] **Step 1: Replace the `<thead>` block**

Find the existing `<thead>` (starts around line 5774 with `{/* Scorecard table */}`) and replace everything from `<thead>` through `</thead>` with the new 9-column header:

```jsx
<thead>
  <tr style={{ borderBottom: "2px solid var(--border)" }}>
    <th style={{ padding: "0.6rem 0.6rem", textAlign: "left", color: "var(--text-muted)", fontWeight: 600, fontSize: "0.75rem", letterSpacing: "0.04em", textTransform: "uppercase" }}>Program</th>
    <th style={{ padding: "0.6rem 0.5rem", textAlign: "center", color: "var(--text-muted)", fontWeight: 600, fontSize: "0.75rem" }}>Avg/Day</th>
    <th style={{ padding: "0.6rem 0.5rem", textAlign: "left", color: "var(--text-muted)", fontWeight: 600, fontSize: "0.75rem", minWidth: 200 }}>Sales vs Plan</th>
    <th style={{ padding: "0.6rem 0.5rem", textAlign: "center", color: "var(--text-muted)", fontWeight: 600, fontSize: "0.75rem" }}>Hours</th>
    <th style={{ padding: "0.6rem 0.5rem", textAlign: "left", color: "var(--text-muted)", fontWeight: 600, fontSize: "0.75rem", minWidth: 130 }}>GPH vs Goal</th>
    <th style={{ padding: "0.6rem 0.5rem", textAlign: "center", color: "var(--text-muted)", fontWeight: 600, fontSize: "0.75rem" }}>HSD</th>
    <th style={{ padding: "0.6rem 0.5rem", textAlign: "center", color: "var(--text-muted)", fontWeight: 600, fontSize: "0.75rem" }}>XM</th>
    <th style={{ padding: "0.6rem 0.5rem", textAlign: "center", color: "var(--text-muted)", fontWeight: 600, fontSize: "0.75rem" }}>RGU</th>
    <th style={{ padding: "0.6rem 0.5rem", textAlign: "center", color: "var(--text-muted)", fontWeight: 600, fontSize: "0.75rem", minWidth: 140 }}>Quartile Distribution</th>
  </tr>
</thead>
```

- [ ] **Step 2: Verify the app renders the new header**

Run: refresh browser
Expected: Table shows 9 column headers instead of 11. Body rows will look broken (still using old column count) — that's expected.

- [ ] **Step 3: Commit**

```bash
git add src/app.jsx
git commit -m "feat(scorecard): replace table header with 9-column layout"
```

---

### Task 3: Replace the scorecard body rows

**Files:**
- Modify: `src/app.jsx:~5792-5857` (the `<tbody>` program rows, excluding footer)

This is the main visual change. Replace the `.map()` that renders program rows.

- [ ] **Step 1: Replace the program row mapper**

Find the existing row mapper starting at:
```js
{[...programs].sort((a, b) => (b.attainment ?? b.healthScore ?? 0) - (a.attainment ?? a.healthScore ?? 0)).map((p, i) => {
```

Replace everything from that line through the closing `})}` (around line 5857) with the new row mapper that uses `progData`:

```jsx
{[...progData].sort((a, b) => (b.attainment ?? b.healthScore ?? 0) - (a.attainment ?? a.healthScore ?? 0)).map((p, i) => {
  const paceColor = p.pace ? projColor(p.pace.projectedPct) : "var(--text-faint)";
  const rowBg = p.pace && p.pace.projectedPct < 85 ? "#dc262606" : i % 2 === 1 ? "var(--bg-row-alt)" : "transparent";
  const pidx = p._origIdx;
  const gphPct = p.sphGoal ? (p.gph / p.sphGoal) * 100 : null;
  const gphBarColor = gphPct !== null ? projColor(gphPct) : "var(--text-faint)";
  const gphBarW = gphPct !== null ? Math.min(gphPct, 100) : 0;
  const attPct = p.planGoals ? (p.actGoals / p.planGoals) * 100 : null;

  return (
    <tr key={p.jobType} onClick={() => onNav(pidx + 1)} style={{ borderBottom: "1px solid var(--bg-tertiary)", cursor: "pointer", background: rowBg }}>
      {/* Program name + badge */}
      <td style={{ padding: "0.7rem 0.6rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <span style={{ display: "inline-block", width: 6, height: 6, borderRadius: "50%", background: p.pace ? paceColor : "var(--text-faint)", flexShrink: 0 }} />
          <span style={{ color: "var(--text-warm)", fontWeight: 600, fontSize: "0.95rem" }}>{p.jobType}</span>
        </div>
        {p.isBelizeOnly && (
          <div style={{ fontSize: "0.65rem", color: "#7c3aed", marginLeft: 12, marginTop: 2, fontWeight: 600, letterSpacing: "0.04em" }}>BELIZE ONLY</div>
        )}
      </td>

      {/* Avg/Day */}
      <td style={{ padding: "0.7rem 0.5rem", textAlign: "center", color: "var(--text-secondary)", fontSize: "0.95rem" }}>{p.avgDay}</td>

      {/* Sales vs Plan with projection */}
      <td style={{ padding: "0.7rem 0.5rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ flex: 1, height: 6, background: "var(--bg-tertiary)", borderRadius: 3, overflow: "hidden" }}>
            <div style={{ width: `${Math.min(attPct || 0, 100)}%`, height: "100%", background: p.pace ? paceColor : "var(--text-faint)", borderRadius: 3 }} />
          </div>
          <span style={{ fontSize: "0.82rem", color: "var(--text-warm)", whiteSpace: "nowrap", fontWeight: 600 }}>
            {p.actGoals.toLocaleString()}{p.planGoals ? <span style={{ color: "var(--text-faint)", fontWeight: 400 }}> / {p.planGoals.toLocaleString()}</span> : null}
          </span>
        </div>
        {p.pace && (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
              <div style={{ flex: 1, height: 3, background: "var(--bg-tertiary)", borderRadius: 2, overflow: "hidden" }}>
                <div style={{ width: `${Math.min(p.pace.projectedPct, 100)}%`, height: "100%", background: paceColor + "40", borderRadius: 2, borderRight: `2px solid ${paceColor}` }} />
              </div>
              <span style={{ fontSize: "0.75rem", color: paceColor, whiteSpace: "nowrap", fontWeight: 600 }}>{Math.round(p.pace.projectedPct)}%</span>
            </div>
            <div style={{ textAlign: "right", fontSize: "0.68rem", color: paceColor + "90", marginTop: 1 }}>proj {p.pace.projected.toLocaleString()}</div>
          </>
        )}
      </td>

      {/* Hours */}
      <td style={{ padding: "0.7rem 0.5rem", textAlign: "center", color: "var(--text-secondary)", fontSize: "0.95rem" }}>{fmt(p.totalHours, 0)}</td>

      {/* GPH vs Goal */}
      <td style={{ padding: "0.7rem 0.5rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <div style={{ flex: 1, height: 6, background: "var(--bg-tertiary)", borderRadius: 3, overflow: "hidden" }}>
            {gphPct !== null && <div style={{ width: `${gphBarW}%`, height: "100%", background: gphBarColor, borderRadius: 3 }} />}
          </div>
          <span style={{ fontSize: "0.82rem", color: "var(--text-warm)", whiteSpace: "nowrap" }}>
            <span style={{ fontWeight: 600 }}>{p.gph.toFixed(3)}</span>
            {p.sphGoal ? <span style={{ color: "var(--text-faint)" }}> / {p.sphGoal.toFixed(2)}</span> : null}
          </span>
        </div>
      </td>

      {/* HSD */}
      <td style={{ padding: "0.7rem 0.5rem", textAlign: "center" }}>
        {p.planHsd ? (
          <>
            <div style={{ color: "var(--text-secondary)", fontWeight: 600, fontSize: "0.95rem" }}>{p.totalNewXI}</div>
            <div style={{ fontSize: "0.68rem", color: p.hsdPace ? projColor(p.hsdPace.projectedPct) : "var(--text-faint)", fontWeight: 600 }}>
              {p.hsdPace ? `${Math.round(p.hsdPace.projectedPct)}% proj` : "—"}
            </div>
          </>
        ) : p.totalNewXI > 0 ? (
          <div style={{ color: "var(--text-secondary)", fontWeight: 600, fontSize: "0.95rem" }}>{p.totalNewXI}</div>
        ) : (
          <span style={{ color: "var(--text-faint)" }}>—</span>
        )}
      </td>

      {/* XM */}
      <td style={{ padding: "0.7rem 0.5rem", textAlign: "center" }}>
        {p.planXm ? (
          <>
            <div style={{ color: "var(--text-secondary)", fontWeight: 600, fontSize: "0.95rem" }}>{p.totalXmLines}</div>
            <div style={{ fontSize: "0.68rem", color: p.xmPace ? projColor(p.xmPace.projectedPct) : "var(--text-faint)", fontWeight: 600 }}>
              {p.xmPace ? `${Math.round(p.xmPace.projectedPct)}% proj` : "—"}
            </div>
          </>
        ) : p.totalXmLines > 0 ? (
          <div style={{ color: "var(--text-secondary)", fontWeight: 600, fontSize: "0.95rem" }}>{p.totalXmLines}</div>
        ) : (
          <span style={{ color: "var(--text-faint)" }}>—</span>
        )}
      </td>

      {/* RGU */}
      <td style={{ padding: "0.7rem 0.5rem", textAlign: "center" }}>
        {p.planRgu ? (
          <>
            <div style={{ color: "var(--text-secondary)", fontWeight: 600, fontSize: "0.95rem" }}>{p.totalRgu}</div>
            <div style={{ fontSize: "0.68rem", color: p.rguPace ? projColor(p.rguPace.projectedPct) : "var(--text-faint)", fontWeight: 600 }}>
              {p.rguPace ? `${Math.round(p.rguPace.projectedPct)}% proj` : "—"}
            </div>
          </>
        ) : p.totalRgu > 0 ? (
          <div style={{ color: "var(--text-secondary)", fontWeight: 600, fontSize: "0.95rem" }}>{p.totalRgu}</div>
        ) : (
          <span style={{ color: "var(--text-faint)" }}>—</span>
        )}
      </td>

      {/* Quartile Distribution */}
      <td style={{ padding: "0.7rem 0.5rem" }}>
        {(() => {
          const counts = { Q1: p.distUnique.Q1 || 0, Q2: p.distUnique.Q2 || 0, Q3: p.distUnique.Q3 || 0, Q4: p.distUnique.Q4 || 0 };
          const total = counts.Q1 + counts.Q2 + counts.Q3 + counts.Q4;
          if (total === 0) return <div style={{ color: "var(--text-faint)", fontSize: "0.68rem", textAlign: "center" }}>No qualified agents</div>;
          return (
            <>
              <div style={{ display: "flex", height: 10, borderRadius: 5, overflow: "hidden", gap: 1 }}>
                {["Q1","Q2","Q3","Q4"].map(q => (
                  <div key={q} style={{ flex: counts[q], background: Q[q].color }} />
                ))}
              </div>
              <div style={{ display: "flex", marginTop: 3, fontSize: "0.68rem", gap: 1 }}>
                {["Q1","Q2","Q3","Q4"].map(q => (
                  <div key={q} style={{ flex: Math.max(counts[q], 1), textAlign: "center", color: Q[q].color }}>
                    {counts[q]}
                  </div>
                ))}
              </div>
            </>
          );
        })()}
      </td>
    </tr>
  );
})}
```

- [ ] **Step 2: Verify program rows render correctly**

Run: refresh browser with data loaded
Expected: Each program row shows 9 columns — Program (with BELIZE ONLY badge on Localizers/XMC), Avg/Day, Sales vs Plan (with projection bar), Hours, GPH vs Goal (with bar), HSD (with projected %), XM (with projected %), RGU (with projected %), and Quartile Distribution (stacked bar with aligned numbers).

- [ ] **Step 3: Commit**

```bash
git add src/app.jsx
git commit -m "feat(scorecard): replace program rows with 9-column visual design"
```

---

### Task 4: Replace the TOTAL footer row

**Files:**
- Modify: `src/app.jsx:~5858-5898` (the totals row inside `{goalLookup && (() => { ... })()}`)

- [ ] **Step 1: Replace the footer row**

Find the existing totals row starting at `{/* Totals row */}` (around line 5858). Replace everything from `{goalLookup && (() => {` through the matching `})()}` with:

```jsx
{goalLookup && (() => {
  const tHsd = programs.reduce((s, p) => s + p.totalNewXI, 0);
  const tXm  = programs.reduce((s, p) => s + p.totalXmLines, 0);
  const tRgu = programs.reduce((s, p) => s + p.totalRgu, 0);
  const tQ1  = programs.reduce((s, p) => s + (p.distUnique.Q1 || 0), 0);
  const tQ2  = programs.reduce((s, p) => s + (p.distUnique.Q2 || 0), 0);
  const tQ3  = programs.reduce((s, p) => s + (p.distUnique.Q3 || 0), 0);
  const tQ4  = programs.reduce((s, p) => s + (p.distUnique.Q4 || 0), 0);
  const tAvgDay = progData.reduce((s, p) => s + p.avgDay, 0);
  const tGph = tHours > 0 ? tGoals / tHours : 0;
  const tSphGoal = null; // No meaningful aggregate SPH goal
  const tCounts = { Q1: tQ1, Q2: tQ2, Q3: tQ3, Q4: tQ4 };
  const tQTotal = tQ1 + tQ2 + tQ3 + tQ4;

  return (
    <tr style={{ borderTop: "2px solid var(--border)" }}>
      <td style={{ padding: "0.75rem 0.6rem", color: "var(--text-warm)", fontWeight: 700, fontSize: "0.95rem" }}>TOTAL</td>
      <td style={{ padding: "0.75rem 0.5rem", textAlign: "center", color: "var(--text-warm)", fontWeight: 700, fontSize: "0.95rem" }}>{tAvgDay}</td>
      <td style={{ padding: "0.75rem 0.5rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ flex: 1, height: 6, background: "var(--bg-tertiary)", borderRadius: 3, overflow: "hidden" }}>
            <div style={{ width: `${Math.min(tAtt || 0, 100)}%`, height: "100%", background: tPace ? projColor(tPace.projectedPct) : "var(--text-faint)", borderRadius: 3 }} />
          </div>
          <span style={{ fontSize: "0.82rem", color: "var(--text-warm)", whiteSpace: "nowrap", fontWeight: 700 }}>
            {tGoals.toLocaleString()}<span style={{ color: "var(--text-faint)", fontWeight: 400 }}> / {tPlan.toLocaleString()}</span>
          </span>
        </div>
        {tPace && (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
              <div style={{ flex: 1, height: 3, background: "var(--bg-tertiary)", borderRadius: 2, overflow: "hidden" }}>
                <div style={{ width: `${Math.min(tPace.projectedPct, 100)}%`, height: "100%", background: projColor(tPace.projectedPct) + "40", borderRadius: 2, borderRight: `2px solid ${projColor(tPace.projectedPct)}` }} />
              </div>
              <span style={{ fontSize: "0.75rem", color: projColor(tPace.projectedPct), whiteSpace: "nowrap", fontWeight: 600 }}>{Math.round(tPace.projectedPct)}%</span>
            </div>
            <div style={{ textAlign: "right", fontSize: "0.68rem", color: projColor(tPace.projectedPct) + "90", marginTop: 1 }}>proj {tPace.projected.toLocaleString()}</div>
          </>
        )}
      </td>
      <td style={{ padding: "0.75rem 0.5rem", textAlign: "center", color: "var(--text-warm)", fontWeight: 700, fontSize: "0.95rem" }}>{fmt(tHours, 0)}</td>
      <td style={{ padding: "0.75rem 0.5rem", textAlign: "center" }}>
        <span style={{ fontSize: "0.95rem", color: "var(--text-warm)", fontWeight: 700 }}>{tGph > 0 ? tGph.toFixed(3) : "—"}</span>
      </td>
      <td style={{ padding: "0.75rem 0.5rem", textAlign: "center", color: "var(--text-warm)", fontWeight: 700, fontSize: "0.95rem" }}>{tHsd}</td>
      <td style={{ padding: "0.75rem 0.5rem", textAlign: "center", color: "var(--text-warm)", fontWeight: 700, fontSize: "0.95rem" }}>{tXm}</td>
      <td style={{ padding: "0.75rem 0.5rem", textAlign: "center", color: "var(--text-warm)", fontWeight: 700, fontSize: "0.95rem" }}>{tRgu}</td>
      <td style={{ padding: "0.75rem 0.5rem" }}>
        {tQTotal > 0 ? (
          <>
            <div style={{ display: "flex", height: 10, borderRadius: 5, overflow: "hidden", gap: 1 }}>
              {["Q1","Q2","Q3","Q4"].map(q => (
                <div key={q} style={{ flex: tCounts[q], background: Q[q].color }} />
              ))}
            </div>
            <div style={{ display: "flex", marginTop: 3, fontSize: "0.68rem", gap: 1 }}>
              {["Q1","Q2","Q3","Q4"].map(q => (
                <div key={q} style={{ flex: Math.max(tCounts[q], 1), textAlign: "center", color: Q[q].color }}>
                  {tCounts[q]}
                </div>
              ))}
            </div>
          </>
        ) : null}
      </td>
    </tr>
  );
})()}
```

- [ ] **Step 2: Verify footer renders**

Run: refresh browser with data loaded (must have goals CSV loaded for footer to appear)
Expected: TOTAL row shows summed Avg/Day, aggregated Sales/Plan with projection bars, total Hours, weighted GPH, summed HSD/XM/RGU, and aggregated quartile bar.

- [ ] **Step 3: Commit**

```bash
git add src/app.jsx
git commit -m "feat(scorecard): replace footer row with 9-column totals"
```

---

### Task 5: Visual verification and edge case testing

**Files:**
- No code changes — testing only

- [ ] **Step 1: Test with goals CSV loaded (full data)**

Load production data with goals CSV. Verify:
- All 5 programs render with correct column count
- Localizers and XMC show BELIZE ONLY badge
- Status dots use pacing colors (green for ahead, red for behind)
- Sales vs Plan has two bars (current + projected) with proj number
- GPH shows `actual / goal` with colored bar
- HSD/XM/RGU each have independently colored projected %
- Quartile numbers align under their bar segments
- TOTAL row shows aggregated data
- Rows are clickable → navigate to program slides

- [ ] **Step 2: Test without goals CSV (no plan data)**

Load data without goals CSV. Verify:
- Sales column shows actual count only, no plan, no projection bar
- GPH shows actual only, no goal
- HSD/XM/RGU show raw counts only, no projected %
- Footer row does not appear (gated by `goalLookup`)
- No errors in console

- [ ] **Step 3: Test light mode**

Toggle to light mode. Verify:
- Progress bar tracks are visible (not invisible on white)
- Behind-pace row wash is visible but subtle
- Text colors are readable
- Quartile colors are visible against white

- [ ] **Step 4: Commit final state**

```bash
git add src/app.jsx
git commit -m "feat(scorecard): redesigned program scorecard — visual bars, independent sub-metric colors, aligned quartiles"
```
