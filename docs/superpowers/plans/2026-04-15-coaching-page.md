# Coaching Standard Attainment — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a new top-nav "Coaching" page in Performance Intel that surfaces MyPerformance coaching attainment as a live in-app view with Summary / By Supervisor / All Agents tabs, emphasizing per-agent gap visibility.

**Architecture:** Single new aggregator `buildCoachingPageData` consumes the already-loaded `coachingWeekly` + `coachingDetails` + `bpLookup`. New `CoachingPage` component composes 3 tabs that share module-scope sub-components (`KpiTile`, `WeekCell`, `SiteChip`, `AgentRow`, `SupervisorRow`). App lifts the parsed memos to its scope (independent of the existing copies in `VirgilMbrExportModal` — no breakage), adds a TopNav button, and adds a `currentPage.section === "coaching"` branch.

**Tech Stack:** React 18 (named imports only), inline CSS w/ CSS vars, Vite. No new dependencies. No test framework — verification per task = `npx vite build` succeeds + manual browser smoke test.

**Reference spec:** `docs/superpowers/specs/2026-04-15-coaching-page-design.md`

---

## File structure

Only **`src/app.jsx`** is modified. New code is placed at these approximate locations (line numbers shift after each edit — always re-grep before targeting):

| Insertion | Approx line | What |
|---|---|---|
| `buildCoachingPageData` + helpers | After `buildCoachingStats` (~line 6685) | Pure aggregator |
| `coachingCellColor` helper | Near `attainColor` (~line 78) | Count→color mapping for agent FW cells |
| Sub-components `KpiTile`, `WeekCell`, `SiteChip`, `AgentRow`, `SupervisorRow`, `CoachingSummaryTab`, `CoachingBySupervisorTab`, `CoachingAllAgentsTab`, `CoachingPage` | Just before `function TNPSSlide` (~line 9490) | Module-scope per project convention |
| TopNav button | Inside `TopNav`, after the tNPS button (~line 5239) | New nav link |
| App memos for `coachingDetails`/`coachingWeekly` | Inside App, near other useMemo blocks | Lifted parse |
| App `currentPage.section === "coaching"` branch | Inside the ternary chain (~line 17654, after the tNPS branch) | New page mount |

**No new files. No new dependencies. No new sheet sources.**

---

## Conventions (re-state — easy to forget)

- Named React imports only — never `React.Fragment`, use `Fragment`
- Always `catch(e) {}` — never bare `catch {}`
- Module-scope sub-components — never nested in parent (training doc gotcha #14)
- `paddingTop: 48px` already wraps the page area at the App level — don't re-add it inside `CoachingPage`
- Use existing `attainColor(pct)` for percentage→color; only create new helpers when the existing ones don't fit
- Sheet column names like `"Coaching Sessions  (copy)"` (two spaces) are real — don't normalize them away

---

## Per-task verification protocol

Because there is no test runner in this project, every task ends with the same 2-step check:

```bash
cd "/c/Users/Joshu/Documents/Claude/Performance Intel" && npx vite build 2>&1 | tail -10
```
- Expect: "✓ built in" message, no errors. Any "Unexpected token" or "is not defined" = stop and fix.

Then where applicable, smoke test in dev server:
```bash
npx vite --host
```
- Open the URL Vite prints. Navigate to the relevant view. Verify the described behavior.

Commit at the end of each task with the indicated message.

---

## Task 1 — Add `buildCoachingPageData` aggregator

**Files:**
- Modify: `src/app.jsx` — insert helper near line 78 (`attainColor`), insert aggregator after `buildCoachingStats` (~line 6685)

- [ ] **Step 1: Add `coachingCellColor` helper near `attainColor`**

Locate `attainColor` (re-grep `^function attainColor`). Immediately after it, insert:

```js
// Maps an agent's per-week session count to a {bg, fg} color pair.
//   0  → red    (gap)
//   1  → green  (on standard)
//  ≥2  → indigo (over-indexed)
//  null → grey  (future or "No Coaching Required")
function coachingCellColor(sessions) {
  if (sessions === null || sessions === undefined) return { bg: "#444", fg: "#888" };
  if (sessions === 0) return { bg: "#dc2626", fg: "#ffffff" };
  if (sessions === 1) return { bg: "#16a34a", fg: "#ffffff" };
  return { bg: "#6366f1", fg: "#ffffff" };
}

// Same color band as attainColor() but returns indigo when over-indexed (>100%).
// Used by Sessions / % cells where over-indexing is meaningful.
function coachingPctColor(pct) {
  if (pct == null) return "var(--text-faint)";
  if (pct > 1)    return "#6366f1";
  if (pct >= 1)   return "#16a34a";
  if (pct >= 0.8) return "#2563eb";
  if (pct > 0)    return "#d97706";
  return "#dc2626";
}

// Subtle row tint for an attainment percentage.
// Returned as {dark, light} so consumers pick by lightMode.
function coachingRowTint(pct) {
  if (pct == null) return { dark: "transparent", light: "transparent" };
  if (pct > 1)     return { dark: "#1a1d28",  light: "#eef2ff" };
  if (pct >= 1)    return { dark: "#14241a",  light: "#f0fdf4" };
  if (pct >= 0.8)  return { dark: "#15212a",  light: "#eff6ff" };
  if (pct > 0)     return { dark: "#2a2014",  light: "#fffbeb" };
  return { dark: "#2a1414", light: "#fef2f2" };
}
```

- [ ] **Step 2: Add `buildCoachingPageData` aggregator after `buildCoachingStats`**

Locate `buildCoachingStats` (re-grep `^function buildCoachingStats`). Find its closing `}` (the function ends on the line before `// Returns an array of { bucket, pct, users } for the reporting month`). Immediately after that closing `}`, insert:

```js
// Site/sub-site mapping for a region string. Mirrors buildCoachingStats logic
// but also returns the full region for sub-site filtering.
function coachingSiteFromRegion(region) {
  const r = (region || "").trim();
  if (!r) return { site: null, region: null };
  const isBz = r.toUpperCase().includes("XOTM");
  return { site: isBz ? "BZ" : "DR", region: r };
}

// Returns a friendly site label for chips: "DR" → "DR", "Belize City-XOTM" → "Belize City".
function coachingRegionLabel(region) {
  if (!region) return "—";
  const r = String(region).trim();
  if (r.toUpperCase().includes("XOTM")) {
    return r.replace(/-XOTM$/i, "").trim();
  }
  if (r === "SD-Xfinity") return "DR";
  return r;
}

// Reads "Acknowledged %" / "Completed %" defensively — handles both 0.84 and 84 conventions.
function coachingNormalizedPct(rawVal) {
  const n = Number(rawVal);
  if (!Number.isFinite(n)) return 0;
  return n > 1 ? n / 100 : n;
}

// Heart of the page. Returns the structured data for all three tabs.
//
// monthFilter: { mode: "current" | "select" | "all", months: Set<string> }
//   "current" → use the most recent fiscalMonth in coachingWeekly
//   "select"  → use only fiscalMonths in months (or all if months is empty)
//   "all"     → no filter
//
// See spec §3 for full output shape.
function buildCoachingPageData(coachingWeekly, coachingDetails, bpLookup, monthFilter) {
  const safeWeekly = Array.isArray(coachingWeekly) ? coachingWeekly : [];
  const safeDetails = coachingDetails || {};
  const safeBp = bpLookup || {};
  const filter = monthFilter || { mode: "current", months: new Set() };

  // Sorted list of fiscal months present in weekly data (chronological, oldest first).
  const monthNames = ["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"];
  const monthOrder = (label) => {
    const m = String(label || "").trim().match(/^([A-Za-z]{3,})\s*'?(\d{2,4})$/);
    if (!m) return 0;
    const mIdx = monthNames.indexOf(m[1].slice(0, 3).toLowerCase());
    if (mIdx < 0) return 0;
    const yr = Number(m[2].length === 4 ? m[2] : `20${m[2]}`);
    return yr * 12 + mIdx;
  };
  const fiscalMonths = [...new Set(safeWeekly.map(r => r.fiscalMonth).filter(Boolean))]
    .sort((a, b) => monthOrder(a) - monthOrder(b));

  // Resolve which months are active per filter mode.
  const currentMonth = fiscalMonths.length ? fiscalMonths[fiscalMonths.length - 1] : "";
  let activeMonths;
  if (filter.mode === "all") {
    activeMonths = new Set(fiscalMonths);
  } else if (filter.mode === "select") {
    activeMonths = filter.months && filter.months.size > 0 ? new Set(filter.months) : new Set(fiscalMonths);
  } else {
    activeMonths = new Set(currentMonth ? [currentMonth] : []);
  }

  // Filter weekly to active months.
  const activeRows = safeWeekly.filter(r => activeMonths.has(r.fiscalMonth));

  // Determine fiscal-week labels and ordering.
  // Use raw fiscalWeek strings, sorted chronologically. If they parse as dates, sort by date.
  // Otherwise sort lexically. Then label as FW1..FWn within the active period.
  const rawWeeks = [...new Set(activeRows.map(r => r.fiscalWeek).filter(Boolean))];
  const weekKey = (s) => {
    const d = new Date(s);
    return isNaN(d.getTime()) ? String(s) : d.getTime();
  };
  rawWeeks.sort((a, b) => {
    const ka = weekKey(a), kb = weekKey(b);
    if (typeof ka === "number" && typeof kb === "number") return ka - kb;
    return String(a).localeCompare(String(b));
  });
  // For single-month: label FW1..FWn. For multi-month: prefix with month abbrev.
  const isMultiMonth = activeMonths.size > 1;
  const weekLabels = rawWeeks.map((raw, i) => {
    if (isMultiMonth) {
      // Try to extract the month from the date string itself
      const d = new Date(raw);
      if (!isNaN(d.getTime())) {
        const mon = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][d.getMonth()];
        return `${mon} W${i + 1}`;
      }
      return raw;
    }
    return `FW${i + 1}`;
  });

  // Build per-agent week map. Key: ntid|fiscalWeek → {sessions, eligible, supervisor, region}
  // (sums multiple rows for the same agent-week, marks eligible if any non-NCR row exists)
  const agentWeekMap = new Map();
  const agentMeta = new Map(); // ntid → {displayName, supervisor, region, site}
  for (const row of activeRows) {
    if (!row.ntid) continue;
    const bp = safeBp[row.ntid];
    const region = bp ? bp.region : "";
    const { site } = coachingSiteFromRegion(region);
    if (!site) continue; // skip rows with no roster match (per existing convention)
    const supervisor = (bp && bp.supervisor) || row.supervisor || "Unassigned";
    if (!agentMeta.has(row.ntid)) {
      agentMeta.set(row.ntid, { ntid: row.ntid, agentName: row.displayName, supervisor, site, region });
    }
    const key = `${row.ntid}|${row.fiscalWeek}`;
    const existing = agentWeekMap.get(key) || { sessions: 0, eligible: false };
    existing.sessions += row.sessions || 0;
    if (row.colorWb !== "No Coaching Required") existing.eligible = true;
    agentWeekMap.set(key, existing);
  }

  // Helper: weeks array for one agent across rawWeeks
  const weeksForAgent = (ntid) => rawWeeks.map((wk, i) => {
    const v = agentWeekMap.get(`${ntid}|${wk}`);
    return {
      week: weekLabels[i],
      sessions: v && v.eligible ? v.sessions : null,
      eligible: !!(v && v.eligible),
    };
  });

  // Build per-agent rollups
  const allAgents = [];
  for (const [ntid, meta] of agentMeta.entries()) {
    const weeks = weeksForAgent(ntid);
    const sessionsX = weeks.reduce((acc, w) => acc + (w.eligible ? (w.sessions || 0) : 0), 0);
    const sessionsY = weeks.reduce((acc, w) => acc + (w.eligible ? 1 : 0), 0);
    const pct = sessionsY ? sessionsX / sessionsY : null;
    allAgents.push({ ...meta, weeks, sessionsX, sessionsY, pct });
  }
  allAgents.sort((a, b) => (a.pct ?? 999) - (b.pct ?? 999));

  // Group agents by supervisor
  const supMap = new Map();
  for (const ag of allAgents) {
    if (!supMap.has(ag.supervisor)) {
      supMap.set(ag.supervisor, { supervisor: ag.supervisor, agents: [] });
    }
    supMap.get(ag.supervisor).agents.push(ag);
  }
  const bySupervisor = [...supMap.values()].map(g => {
    // primary site = mode of agent regions; ties broken alphabetically
    const regionCounts = {};
    g.agents.forEach(a => { regionCounts[a.region] = (regionCounts[a.region] || 0) + 1; });
    const primaryRegion = Object.keys(regionCounts).sort((a, b) =>
      regionCounts[b] - regionCounts[a] || a.localeCompare(b)
    )[0] || "";
    const { site } = coachingSiteFromRegion(primaryRegion);
    // Per-week supervisor stats: agents coached that week / eligible agents that week
    const weeks = rawWeeks.map((wk, i) => {
      let x = 0, y = 0;
      for (const a of g.agents) {
        const w = a.weeks[i];
        if (w.eligible) {
          y += 1;
          if ((w.sessions || 0) >= 1) x += 1;
        }
      }
      return { week: weekLabels[i], x, y, pct: y ? x / y : null };
    });
    const sessionsX = g.agents.reduce((acc, a) => acc + a.sessionsX, 0);
    const sessionsY = g.agents.reduce((acc, a) => acc + a.sessionsY, 0);
    return {
      supervisor: g.supervisor,
      site,
      region: primaryRegion,
      agentCount: g.agents.length,
      weeks,
      sessionsX,
      sessionsY,
      pct: sessionsY ? sessionsX / sessionsY : null,
      agents: g.agents,
    };
  }).sort((a, b) => (a.pct ?? 999) - (b.pct ?? 999));

  // Per-site stats (sub-region granularity).
  const regionMap = new Map(); // region → { x, y } accumulator
  for (const a of allAgents) {
    if (!regionMap.has(a.region)) regionMap.set(a.region, { x: 0, y: 0 });
    const acc = regionMap.get(a.region);
    a.weeks.forEach(w => {
      if (w.eligible) {
        acc.y += 1;
        if ((w.sessions || 0) >= 1) acc.x += 1;
      }
    });
  }
  const bySite = [...regionMap.entries()].map(([region, s]) => {
    const { site } = coachingSiteFromRegion(region);
    return { site, region, x: s.x, y: s.y, pct: s.y ? s.x / s.y : null };
  });

  // Aggregated DR / BZ totals (for the summary tile + comparison chart).
  const drRollup = bySite.filter(s => s.site === "DR")
    .reduce((acc, s) => ({ x: acc.x + s.x, y: acc.y + s.y }), { x: 0, y: 0 });
  const bzRollup = bySite.filter(s => s.site === "BZ")
    .reduce((acc, s) => ({ x: acc.x + s.x, y: acc.y + s.y }), { x: 0, y: 0 });

  // Org-level KPIs from coachingDetails (Comcast authoritative). Sum across active months.
  let orgCoachingX = 0, orgCoachingY = 0, orgTotalSessions = 0;
  let ackPctSum = 0, ackPctCount = 0;
  for (const month of activeMonths) {
    const bucket = safeDetails[month] || {};
    orgCoachingX += Number(bucket["Coaching Sessions"]) || 0;
    orgCoachingY += Number(bucket["Coachings Due"]) || 0;
    orgTotalSessions += Number(bucket["Total Sessions"]) || 0;
    const ackRaw = bucket["Acknowledged %"] || bucket["Acknowledged % "];
    if (ackRaw !== undefined && ackRaw !== "") {
      ackPctSum += coachingNormalizedPct(ackRaw);
      ackPctCount += 1;
    }
  }
  const orgCoachingPct = orgCoachingY ? orgCoachingX / orgCoachingY : null;
  const ackPct = ackPctCount ? ackPctSum / ackPctCount : null;
  const ackY = orgTotalSessions;
  const ackX = ackPct != null && ackY ? Math.round(ackPct * ackY) : 0;

  // Per-week org trend (sum over all eligible agent-weeks across active months).
  const byWeek = rawWeeks.map((wk, i) => {
    let x = 0, y = 0;
    for (const a of allAgents) {
      const w = a.weeks[i];
      if (w.eligible) {
        y += 1;
        if ((w.sessions || 0) >= 1) x += 1;
      }
    }
    return { week: weekLabels[i], x, y, pct: y ? x / y : null };
  });

  return {
    org: {
      coachingPct: orgCoachingPct,
      coachingX: orgCoachingX,
      coachingY: orgCoachingY,
      ackPct,
      ackX,
      ackY,
      totalSessions: orgTotalSessions,
    },
    bySiteRollup: {
      dr: { x: drRollup.x, y: drRollup.y, pct: drRollup.y ? drRollup.x / drRollup.y : null },
      bz: { x: bzRollup.x, y: bzRollup.y, pct: bzRollup.y ? bzRollup.x / bzRollup.y : null },
    },
    bySite,
    byWeek,
    bySupervisor,
    allAgents,
    fiscalMonths,
    currentMonth,
    activeMonths: [...activeMonths],
    weekLabels,
  };
}
```

- [ ] **Step 3: Run build and verify**

```bash
cd "/c/Users/Joshu/Documents/Claude/Performance Intel" && npx vite build 2>&1 | tail -10
```
Expected: "✓ built in" with no errors.

- [ ] **Step 4: Commit**

```bash
git add src/app.jsx
git commit -m "feat(coaching): add buildCoachingPageData aggregator + color helpers"
```

---

## Task 2 — Add module-scope display sub-components (KpiTile, WeekCell, SiteChip)

**Files:**
- Modify: `src/app.jsx` — insert sub-components just before `function TNPSSlide` (~line 9490, re-grep)

- [ ] **Step 1: Locate insertion point**

```bash
grep -n "^function TNPSSlide" src/app.jsx
```
Note the line number. Insert the following block at the line immediately above.

- [ ] **Step 2: Insert `KpiTile`, `WeekCell`, `SiteChip`**

```jsx
// ═══════════════════════════════════════════════════════════════════
// COACHING PAGE — Module-scope sub-components
// ═══════════════════════════════════════════════════════════════════

function KpiTile({ label, value, sub, accent }) {
  return (
    <div style={{ background: "var(--glass-bg)", border: `1px solid ${accent}18`, borderTop: `3px solid ${accent}`, borderRadius: "var(--radius-md, 10px)", padding: "1rem" }}>
      <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.7rem", color: "var(--text-muted)", letterSpacing: "0.06em", textTransform: "uppercase" }}>{label}</div>
      <div style={{ fontFamily: "var(--font-display, Inter, sans-serif)", fontSize: "2.25rem", color: accent, fontWeight: 800, lineHeight: 1.1 }}>{value}</div>
      <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.72rem", color: "var(--text-dim)" }}>{sub}</div>
    </div>
  );
}

// Renders one fiscal-week cell.
// mode = "count": shows raw session count, color from coachingCellColor
// mode = "pct":   shows "X/Y", color from coachingPctColor band
function WeekCell({ mode, data }) {
  if (!data || (mode === "count" && !data.eligible)) {
    return (
      <span style={{ display: "block", textAlign: "center", background: "#444", color: "#888", fontSize: "0.72rem", fontWeight: 700, padding: "0.25rem 0", borderRadius: 3 }}>—</span>
    );
  }
  if (mode === "count") {
    const c = coachingCellColor(data.sessions);
    return (
      <span style={{ display: "block", textAlign: "center", background: c.bg, color: c.fg, fontSize: "0.78rem", fontWeight: 700, padding: "0.25rem 0", borderRadius: 3 }}>
        {data.sessions}
      </span>
    );
  }
  // mode === "pct"
  if (data.y === 0 || data.pct == null) {
    return (
      <span style={{ display: "block", textAlign: "center", background: "#444", color: "#888", fontSize: "0.72rem", fontWeight: 700, padding: "0.25rem 0", borderRadius: 3 }}>—</span>
    );
  }
  const bg = coachingPctColor(data.pct);
  return (
    <span style={{ display: "block", textAlign: "center", background: bg, color: "#fff", fontSize: "0.78rem", fontWeight: 700, padding: "0.25rem 0", borderRadius: 3 }}>
      {data.x}/{data.y}
    </span>
  );
}

function SiteChip({ label, accent, active, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: "0.3rem 0.75rem",
        borderRadius: "var(--radius-sm, 6px)",
        border: `1px solid ${active ? accent : "var(--border-muted)"}`,
        background: active ? `${accent}18` : "transparent",
        color: active ? accent : "var(--text-dim)",
        fontFamily: "var(--font-ui, Inter, sans-serif)",
        fontSize: "0.78rem",
        fontWeight: active ? 600 : 400,
        cursor: "pointer",
        transition: "all 150ms",
      }}
    >
      {label}
    </button>
  );
}
```

- [ ] **Step 3: Build verify + commit**

```bash
cd "/c/Users/Joshu/Documents/Claude/Performance Intel" && npx vite build 2>&1 | tail -10
```
Expected: "✓ built in".

```bash
git add src/app.jsx
git commit -m "feat(coaching): add KpiTile, WeekCell, SiteChip sub-components"
```

---

## Task 3 — Add `AgentRow` and `SupervisorRow` sub-components

**Files:**
- Modify: `src/app.jsx` — insert after `SiteChip` (just below the Task 2 insertion point)

- [ ] **Step 1: Insert `AgentRow`**

```jsx
// One row in an agent grid (used by All Agents tab + inside expanded supervisor rows).
// columns: 1.5fr supervisor 1.2fr site 0.7fr [weeks] sessions 0.6fr pct 0.5fr
function AgentRow({ agent, weekLabels, lightMode, indented }) {
  const tint = coachingRowTint(agent.pct);
  const overIndexed = agent.sessionsX > agent.sessionsY;
  const sessionsColor = overIndexed ? "#6366f1" : coachingPctColor(agent.pct);
  const pctColor = sessionsColor;
  const accent = coachingPctColor(agent.pct);
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: `1.5fr 1.2fr 1.2fr ${weekLabels.map(() => "0.5fr").join(" ")} 0.7fr 0.5fr`,
        gap: 4,
        padding: indented ? "0.3rem 0.5rem 0.3rem 0.5rem" : "0.4rem 0.5rem",
        alignItems: "center",
        background: lightMode ? tint.light : tint.dark,
        borderLeft: `${indented ? 2 : 3}px solid ${accent}`,
        borderRadius: "0 3px 3px 0",
        marginTop: 3,
      }}
    >
      <span style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: indented ? "0.78rem" : "0.82rem", color: "var(--text-warm)", fontWeight: 500 }}>{agent.agentName}</span>
      <span style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.72rem", color: "var(--text-dim)" }}>{agent.supervisor}</span>
      <span style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.72rem", color: agent.site === "DR" ? "#ed8936" : "#48bb78" }}>{coachingRegionLabel(agent.region)}</span>
      {agent.weeks.map((w, i) => (
        <WeekCell key={i} mode="count" data={w} />
      ))}
      <span style={{ textAlign: "right", fontFamily: "var(--font-data, monospace)", fontSize: "0.82rem", fontWeight: 700, color: sessionsColor }}>
        {agent.sessionsX}/{agent.sessionsY}
      </span>
      <span style={{ textAlign: "right", fontFamily: "var(--font-data, monospace)", fontSize: "0.82rem", fontWeight: 700, color: pctColor }}>
        {agent.pct == null ? "—" : `${Math.round(agent.pct * 100)}%`}
      </span>
    </div>
  );
}
```

- [ ] **Step 2: Insert `SupervisorRow`**

```jsx
// One row in the By Supervisor tab. Click toggles expand state held by parent.
function SupervisorRow({ sup, weekLabels, expanded, onToggle, lightMode }) {
  const tint = coachingRowTint(sup.pct);
  const accent = coachingPctColor(sup.pct);
  const sessionsColor = sup.sessionsX > sup.sessionsY ? "#6366f1" : accent;
  return (
    <Fragment>
      <div
        onClick={onToggle}
        style={{
          display: "grid",
          gridTemplateColumns: `1.4fr 0.9fr 0.5fr ${weekLabels.map(() => "0.7fr").join(" ")} 0.7fr 0.5fr`,
          gap: 4,
          padding: "0.5rem",
          alignItems: "center",
          background: lightMode ? tint.light : tint.dark,
          borderLeft: `3px solid ${accent}`,
          borderRadius: "0 3px 3px 0",
          marginTop: 4,
          cursor: "pointer",
          userSelect: "none",
        }}
      >
        <span style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.85rem", fontWeight: 600, color: "var(--text-warm)" }}>
          {expanded ? "▾" : "▸"} {sup.supervisor}
        </span>
        <span style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.75rem", color: sup.site === "DR" ? "#ed8936" : "#48bb78" }}>
          {coachingRegionLabel(sup.region)}
        </span>
        <span style={{ textAlign: "center", fontFamily: "var(--font-data, monospace)", fontSize: "0.78rem", color: "var(--text-dim)" }}>{sup.agentCount}</span>
        {sup.weeks.map((w, i) => (
          <WeekCell key={i} mode="pct" data={w} />
        ))}
        <span style={{ textAlign: "right", fontFamily: "var(--font-data, monospace)", fontSize: "0.85rem", fontWeight: 700, color: sessionsColor }}>
          {sup.sessionsX}/{sup.sessionsY}
        </span>
        <span style={{ textAlign: "right", fontFamily: "var(--font-data, monospace)", fontSize: "0.85rem", fontWeight: 700, color: sessionsColor }}>
          {sup.pct == null ? "—" : `${Math.round(sup.pct * 100)}%`}
        </span>
      </div>
      {expanded && (
        <div style={{ background: lightMode ? "#fafafa" : "#0f0f0f", padding: "0.5rem 0.75rem 0.75rem 1.5rem", marginLeft: "0.75rem", borderLeft: `1px dashed ${accent}50`, marginTop: 2 }}>
          {sup.agents.map((a, i) => (
            <AgentRow key={i} agent={a} weekLabels={weekLabels} lightMode={lightMode} indented />
          ))}
        </div>
      )}
    </Fragment>
  );
}
```

- [ ] **Step 3: Build verify + commit**

```bash
cd "/c/Users/Joshu/Documents/Claude/Performance Intel" && npx vite build 2>&1 | tail -10
```
Expected: "✓ built in".

```bash
git add src/app.jsx
git commit -m "feat(coaching): add AgentRow and SupervisorRow row components"
```

---

## Task 4 — Add `CoachingSummaryTab`

**Files:**
- Modify: `src/app.jsx` — insert after `SupervisorRow`

- [ ] **Step 1: Insert the component**

```jsx
function CoachingSummaryTab({ data, lightMode }) {
  const { org, bySiteRollup, bySite, byWeek } = data;

  const fmtPct = (p) => p == null ? "—" : `${Math.round(p * 100)}%`;

  // Tile color picks
  const orgAccent  = coachingPctColor(org.coachingPct);
  const drAccent   = coachingPctColor(bySiteRollup.dr.pct);
  const bzAccent   = coachingPctColor(bySiteRollup.bz.pct);
  const ackAccent  = coachingPctColor(org.ackPct);

  // Site comparison max for bar scaling (cap at 100% for height; allow >100% as label).
  const maxBarPct = Math.max(1, ...bySite.map(s => s.pct || 0));
  // Weekly trend — same maxBarPct
  const maxTrendPct = Math.max(1, ...byWeek.map(w => w.pct || 0));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
      {/* KPI tiles */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "0.75rem" }}>
        <KpiTile label="Org Coaching" value={fmtPct(org.coachingPct)} sub={`${org.coachingX} / ${org.coachingY} sessions`} accent={orgAccent} />
        <KpiTile label="DR Coaching" value={fmtPct(bySiteRollup.dr.pct)} sub={`${bySiteRollup.dr.x} / ${bySiteRollup.dr.y} agent-weeks`} accent={drAccent} />
        <KpiTile label="BZ Coaching" value={fmtPct(bySiteRollup.bz.pct)} sub={`${bySiteRollup.bz.x} / ${bySiteRollup.bz.y} agent-weeks`} accent={bzAccent} />
        <KpiTile label="Acknowledgement" value={fmtPct(org.ackPct)} sub={`${org.ackX} / ${org.ackY} sessions`} accent={ackAccent} />
      </div>

      {/* Site comparison bar chart */}
      <div style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg, 16px)", padding: "1.25rem 1.5rem" }}>
        <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.8rem", letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: "1rem" }}>Site Comparison</div>
        {bySite.length === 0 ? (
          <div style={{ color: "var(--text-faint)", fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.85rem" }}>No site data for the selected period.</div>
        ) : (
          <div style={{ display: "flex", gap: "1rem", alignItems: "flex-end", height: 220, paddingTop: 24 }}>
            {bySite.map((s, i) => {
              const pct = s.pct || 0;
              const barH = Math.max(20, (pct / maxBarPct) * 160);
              const color = coachingPctColor(s.pct);
              return (
                <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center" }}>
                  <div style={{ fontFamily: "var(--font-data, monospace)", fontSize: "1.05rem", fontWeight: 700, color, marginBottom: 4 }}>
                    {fmtPct(s.pct)}
                  </div>
                  <div style={{ width: "60%", height: barH, borderRadius: "6px 6px 0 0", background: `${color}cc` }} />
                  <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.78rem", color: "var(--text-warm)", marginTop: 6, fontWeight: 600 }}>{coachingRegionLabel(s.region)}</div>
                  <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.68rem", color: "var(--text-dim)" }}>{s.x}/{s.y}</div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Weekly trend chart */}
      <div style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg, 16px)", padding: "1.25rem 1.5rem" }}>
        <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.8rem", letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: "1rem" }}>Weekly Trend</div>
        {byWeek.length === 0 ? (
          <div style={{ color: "var(--text-faint)", fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.85rem" }}>No weekly data for the selected period.</div>
        ) : (
          <div style={{ display: "flex", gap: "1.5rem", alignItems: "flex-end", height: 180, paddingTop: 24 }}>
            {byWeek.map((w, i) => {
              if (w.pct == null) {
                return (
                  <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center" }}>
                    <div style={{ fontFamily: "var(--font-data, monospace)", fontSize: "0.78rem", color: "var(--text-faint)", marginBottom: 4 }}>—</div>
                    <div style={{ width: "70%", height: 30, borderRadius: "6px 6px 0 0", border: "1px dashed var(--border-muted)", background: "transparent" }} />
                    <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.78rem", color: "var(--text-warm)", marginTop: 6, fontWeight: 600 }}>{w.week}</div>
                  </div>
                );
              }
              const pct = w.pct || 0;
              const barH = Math.max(20, (pct / maxTrendPct) * 130);
              const color = coachingPctColor(w.pct);
              return (
                <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center" }}>
                  <div style={{ fontFamily: "var(--font-data, monospace)", fontSize: "1rem", fontWeight: 700, color, marginBottom: 4 }}>
                    {fmtPct(w.pct)}
                  </div>
                  <div style={{ width: "70%", height: barH, borderRadius: "6px 6px 0 0", background: `${color}cc` }} />
                  <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.78rem", color: "var(--text-warm)", marginTop: 6, fontWeight: 600 }}>{w.week}</div>
                  <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.68rem", color: "var(--text-dim)" }}>{w.x}/{w.y}</div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Build verify + commit**

```bash
cd "/c/Users/Joshu/Documents/Claude/Performance Intel" && npx vite build 2>&1 | tail -10
```
Expected: "✓ built in".

```bash
git add src/app.jsx
git commit -m "feat(coaching): add CoachingSummaryTab with KPIs, site bars, weekly trend"
```

---

## Task 5 — Add `CoachingBySupervisorTab`

**Files:**
- Modify: `src/app.jsx` — insert after `CoachingSummaryTab`

- [ ] **Step 1: Insert the component**

```jsx
// Site filter chip set used by both supervisor and all-agents tabs.
// Returns a predicate (region) → boolean for the active filter.
function makeSiteFilter(activeChip) {
  if (activeChip === "all") return () => true;
  if (activeChip === "dr")  return (r) => !String(r || "").toUpperCase().includes("XOTM");
  if (activeChip === "bz")  return (r) =>  String(r || "").toUpperCase().includes("XOTM");
  // sub-region: exact match on the region label (e.g., "Belize City-XOTM")
  return (r) => coachingRegionLabel(r).toLowerCase() === activeChip.toLowerCase();
}

function CoachingSiteChips({ activeChip, onChange, lightMode }) {
  const chips = [
    { key: "all",          label: "All",         accent: "#d97706" },
    { key: "dr",           label: "DR",          accent: "#ed8936" },
    { key: "bz",           label: "BZ (all)",    accent: "#48bb78" },
    { key: "Belize City",  label: "Belize City", accent: "#48bb78" },
    { key: "OW",           label: "OW",          accent: "#48bb78" },
    { key: "San Ignacio",  label: "San Ignacio", accent: "#48bb78" },
  ];
  return (
    <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap", marginBottom: "0.85rem" }}>
      {chips.map(c => (
        <SiteChip key={c.key} label={c.label} accent={c.accent} active={activeChip === c.key} onClick={() => onChange(c.key)} />
      ))}
    </div>
  );
}

function CoachingBySupervisorTab({ data, lightMode }) {
  const [activeChip, setActiveChip] = useState("all");
  const [expanded, setExpanded] = useState(() => new Set());
  const filterFn = makeSiteFilter(activeChip);

  // Filter supervisors and (when expanded) their agents.
  const filteredSupervisors = useMemo(() => {
    return data.bySupervisor.map(sup => {
      const matchedAgents = sup.agents.filter(a => filterFn(a.region));
      // For chip "all", show every supervisor; for site chips, only show supervisors with matching agents.
      if (activeChip !== "all" && matchedAgents.length === 0) return null;
      // Recompute supervisor-level rollup using only matched agents
      const weeks = data.weekLabels.map((label, i) => {
        let x = 0, y = 0;
        for (const a of matchedAgents) {
          const w = a.weeks[i];
          if (w.eligible) {
            y += 1;
            if ((w.sessions || 0) >= 1) x += 1;
          }
        }
        return { week: label, x, y, pct: y ? x / y : null };
      });
      const sessionsX = matchedAgents.reduce((acc, a) => acc + a.sessionsX, 0);
      const sessionsY = matchedAgents.reduce((acc, a) => acc + a.sessionsY, 0);
      return {
        ...sup,
        agents: matchedAgents,
        agentCount: matchedAgents.length,
        weeks,
        sessionsX,
        sessionsY,
        pct: sessionsY ? sessionsX / sessionsY : null,
      };
    }).filter(Boolean).sort((a, b) => (a.pct ?? 999) - (b.pct ?? 999));
  }, [data.bySupervisor, data.weekLabels, activeChip]);

  const toggle = (key) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  return (
    <div>
      <CoachingSiteChips activeChip={activeChip} onChange={setActiveChip} lightMode={lightMode} />

      {/* Header row */}
      <div style={{
        display: "grid",
        gridTemplateColumns: `1.4fr 0.9fr 0.5fr ${data.weekLabels.map(() => "0.7fr").join(" ")} 0.7fr 0.5fr`,
        gap: 4,
        padding: "0.5rem",
        fontFamily: "var(--font-ui, Inter, sans-serif)",
        fontSize: "0.7rem",
        textTransform: "uppercase",
        letterSpacing: "0.06em",
        color: "var(--text-muted)",
        borderBottom: "1px solid var(--border)",
      }}>
        <span>Supervisor</span>
        <span>Site</span>
        <span style={{ textAlign: "center" }}>Agents</span>
        {data.weekLabels.map((wk, i) => <span key={i} style={{ textAlign: "center" }}>{wk}</span>)}
        <span style={{ textAlign: "right" }}>Sessions</span>
        <span style={{ textAlign: "right" }}>%</span>
      </div>

      {filteredSupervisors.length === 0 ? (
        <div style={{ padding: "2rem 1rem", textAlign: "center", color: "var(--text-faint)", fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.85rem" }}>
          No supervisors match the current site filter.
        </div>
      ) : (
        filteredSupervisors.map((sup, i) => (
          <SupervisorRow
            key={`${sup.supervisor}-${i}`}
            sup={sup}
            weekLabels={data.weekLabels}
            expanded={expanded.has(sup.supervisor)}
            onToggle={() => toggle(sup.supervisor)}
            lightMode={lightMode}
          />
        ))
      )}
    </div>
  );
}
```

- [ ] **Step 2: Build verify + commit**

```bash
cd "/c/Users/Joshu/Documents/Claude/Performance Intel" && npx vite build 2>&1 | tail -10
```
Expected: "✓ built in".

```bash
git add src/app.jsx
git commit -m "feat(coaching): add CoachingBySupervisorTab with site chips + expand"
```

---

## Task 6 — Add `CoachingAllAgentsTab`

**Files:**
- Modify: `src/app.jsx` — insert after `CoachingBySupervisorTab`

- [ ] **Step 1: Insert the component**

```jsx
function CoachingAllAgentsTab({ data, lightMode }) {
  const [activeChip, setActiveChip] = useState("all");
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState("pct"); // "pct" | "name" | "sessions"
  const [sortDir, setSortDir] = useState("asc");

  const filterFn = makeSiteFilter(activeChip);

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    let rows = data.allAgents.filter(a => filterFn(a.region));
    if (s) rows = rows.filter(a => (a.agentName || "").toLowerCase().includes(s));
    rows.sort((a, b) => {
      let av, bv;
      if (sortBy === "name") { av = (a.agentName || "").toLowerCase(); bv = (b.agentName || "").toLowerCase(); }
      else if (sortBy === "sessions") { av = a.sessionsX; bv = b.sessionsX; }
      else { av = a.pct ?? 999; bv = b.pct ?? 999; }
      if (av < bv) return sortDir === "asc" ? -1 : 1;
      if (av > bv) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
    return rows;
  }, [data.allAgents, activeChip, search, sortBy, sortDir]);

  const gappedCount = useMemo(() => filtered.filter(a => (a.pct ?? 0) < 1).length, [filtered]);

  const headerClick = (col) => {
    if (sortBy === col) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortBy(col); setSortDir(col === "name" ? "asc" : col === "sessions" ? "desc" : "asc"); }
  };

  const headerCell = (label, col, align = "left") => (
    <span
      onClick={col ? () => headerClick(col) : undefined}
      style={{
        textAlign: align,
        cursor: col ? "pointer" : "default",
        userSelect: "none",
        color: col === sortBy ? "var(--text-warm)" : "var(--text-muted)",
      }}
    >
      {label}{col === sortBy ? (sortDir === "asc" ? " ▲" : " ▼") : ""}
    </span>
  );

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "1rem", flexWrap: "wrap" }}>
        <CoachingSiteChips activeChip={activeChip} onChange={setActiveChip} lightMode={lightMode} />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search agent name..."
          style={{
            background: "var(--bg-secondary)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-sm, 6px)",
            padding: "0.4rem 0.7rem",
            fontFamily: "var(--font-ui, Inter, sans-serif)",
            fontSize: "0.78rem",
            color: "var(--text-warm)",
            minWidth: 200,
          }}
        />
      </div>

      <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.78rem", color: "var(--text-dim)", marginBottom: "0.6rem" }}>
        {filtered.length} agents · <span style={{ color: gappedCount > 0 ? "#dc2626" : "#16a34a", fontWeight: 600 }}>{gappedCount} with gaps</span>
      </div>

      {/* Header row */}
      <div style={{
        display: "grid",
        gridTemplateColumns: `1.5fr 1.2fr 1.2fr ${data.weekLabels.map(() => "0.5fr").join(" ")} 0.7fr 0.5fr`,
        gap: 4,
        padding: "0.5rem",
        fontFamily: "var(--font-ui, Inter, sans-serif)",
        fontSize: "0.7rem",
        textTransform: "uppercase",
        letterSpacing: "0.06em",
        borderBottom: "1px solid var(--border)",
      }}>
        {headerCell("Agent", "name")}
        {headerCell("Supervisor")}
        {headerCell("Site")}
        {data.weekLabels.map((wk, i) => <span key={i} style={{ textAlign: "center", color: "var(--text-muted)" }}>{wk}</span>)}
        {headerCell("Sessions", "sessions", "right")}
        {headerCell("%", "pct", "right")}
      </div>

      {filtered.length === 0 ? (
        <div style={{ padding: "2rem 1rem", textAlign: "center", color: "var(--text-faint)", fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.85rem" }}>
          No agents match the current filters.
        </div>
      ) : (
        filtered.map((a, i) => (
          <AgentRow key={`${a.ntid || a.agentName}-${i}`} agent={a} weekLabels={data.weekLabels} lightMode={lightMode} />
        ))
      )}
    </div>
  );
}
```

- [ ] **Step 2: Build verify + commit**

```bash
cd "/c/Users/Joshu/Documents/Claude/Performance Intel" && npx vite build 2>&1 | tail -10
```
Expected: "✓ built in".

```bash
git add src/app.jsx
git commit -m "feat(coaching): add CoachingAllAgentsTab with search + sortable headers"
```

---

## Task 7 — Add `CoachingPage` composer (header, time-mode, tabs, empty state)

**Files:**
- Modify: `src/app.jsx` — insert after `CoachingAllAgentsTab`, before `function TNPSSlide`

- [ ] **Step 1: Insert the page composer**

```jsx
function CoachingPage({ coachingWeekly, coachingDetails, bpLookup, lightMode }) {
  const [tab, setTab] = useState("summary");
  const [timeMode, setTimeMode] = useState("current"); // "current" | "select" | "all"
  const [selectedMonths, setSelectedMonths] = useState(() => new Set());

  // Build the page data with the active filter
  const monthFilter = useMemo(() => ({ mode: timeMode, months: selectedMonths }), [timeMode, selectedMonths]);
  const data = useMemo(
    () => buildCoachingPageData(coachingWeekly, coachingDetails, bpLookup, monthFilter),
    [coachingWeekly, coachingDetails, bpLookup, monthFilter]
  );

  const hasWeekly = Array.isArray(coachingWeekly) && coachingWeekly.length > 0;
  const hasDetails = coachingDetails && Object.keys(coachingDetails).length > 0;

  // Empty state: nothing loaded
  if (!hasWeekly && !hasDetails) {
    return (
      <div style={{ minHeight: "60vh", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-faint)", fontFamily: "var(--font-ui, Inter, sans-serif)", textAlign: "center", padding: "2rem" }}>
        <div>
          <div style={{ fontSize: "1rem", marginBottom: "0.5rem", color: "var(--text-warm)" }}>No coaching data loaded</div>
          <div style={{ fontSize: "0.85rem" }}>Upload Coaching Details and Weekly Breakdown via Settings ⚙ → Data sources.</div>
        </div>
      </div>
    );
  }

  const toggleMonth = (m) => setSelectedMonths(prev => {
    const next = new Set(prev);
    if (next.has(m)) next.delete(m); else next.add(m);
    return next;
  });

  const tabs = [
    { key: "summary",    label: "Summary" },
    { key: "supervisor", label: "By Supervisor" },
    { key: "agents",     label: "All Agents" },
  ];

  // Subtitle: count of agent-weeks in active period
  const totalAgentWeeks = data.allAgents.reduce(
    (acc, a) => acc + a.weeks.reduce((s, w) => s + (w.eligible ? 1 : 0), 0),
    0
  );
  const periodLabel = timeMode === "current"
    ? data.currentMonth || "—"
    : timeMode === "all"
      ? "All Time"
      : (selectedMonths.size === 0 ? "All months" : `${selectedMonths.size} month${selectedMonths.size > 1 ? "s" : ""}`);

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: "0 2.5rem 2rem" }}>
      {/* Header */}
      <div style={{ marginBottom: "0.75rem" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "0.5rem" }}>
          <div>
            <div style={{ fontFamily: "var(--font-display, Inter, sans-serif)", fontSize: "1.5rem", fontWeight: 700, color: "var(--text-warm)" }}>
              Coaching Standard Attainment — myPerformance
            </div>
            <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.78rem", color: "var(--text-dim)" }}>
              {totalAgentWeeks} agent-weeks · {periodLabel}
            </div>
          </div>
          <div style={{ display: "flex", gap: "0.25rem" }}>
            {[{ key: "current", label: "Current Month" }, { key: "select", label: "Select Month" }, { key: "all", label: "All Time" }].map(opt => (
              <button
                key={opt.key}
                onClick={() => setTimeMode(opt.key)}
                style={{
                  padding: "0.35rem 0.75rem",
                  borderRadius: "var(--radius-sm, 6px)",
                  border: `1px solid ${timeMode === opt.key ? "#d9770650" : "var(--border-muted)"}`,
                  background: timeMode === opt.key ? "#d9770612" : "transparent",
                  color: timeMode === opt.key ? "#d97706" : "var(--text-dim)",
                  fontFamily: "var(--font-ui, Inter, sans-serif)",
                  fontSize: "0.78rem",
                  cursor: "pointer",
                  fontWeight: timeMode === opt.key ? 600 : 400,
                }}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {timeMode === "select" && (
          <div style={{ display: "flex", gap: "0.3rem", marginTop: "0.5rem", flexWrap: "wrap" }}>
            {data.fiscalMonths.map(m => {
              const selected = selectedMonths.has(m);
              return (
                <button
                  key={m}
                  onClick={() => toggleMonth(m)}
                  style={{
                    padding: "0.3rem 0.65rem",
                    borderRadius: "var(--radius-sm, 6px)",
                    border: `1px solid ${selected ? "#6366f150" : "var(--border-muted)"}`,
                    background: selected ? "#6366f118" : "transparent",
                    color: selected ? "#6366f1" : "var(--text-dim)",
                    fontFamily: "var(--font-ui, Inter, sans-serif)",
                    fontSize: "0.75rem",
                    cursor: "pointer",
                    fontWeight: selected ? 600 : 400,
                  }}
                >
                  {m}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Sub-tab navigation */}
      <div style={{ display: "flex", gap: "0.35rem", marginBottom: "1.25rem", borderBottom: "1px solid var(--border)" }}>
        {tabs.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            style={{
              padding: "0.55rem 1rem",
              border: "none",
              borderBottom: tab === t.key ? "2px solid #d97706" : "2px solid transparent",
              background: "transparent",
              color: tab === t.key ? "var(--text-warm)" : "var(--text-dim)",
              fontFamily: "var(--font-ui, Inter, sans-serif)",
              fontSize: "0.82rem",
              fontWeight: tab === t.key ? 600 : 400,
              cursor: "pointer",
              transition: "all 150ms",
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "summary"    && <CoachingSummaryTab       data={data} lightMode={lightMode} />}
      {tab === "supervisor" && <CoachingBySupervisorTab  data={data} lightMode={lightMode} />}
      {tab === "agents"     && <CoachingAllAgentsTab     data={data} lightMode={lightMode} />}
    </div>
  );
}
```

- [ ] **Step 2: Build verify + commit**

```bash
cd "/c/Users/Joshu/Documents/Claude/Performance Intel" && npx vite build 2>&1 | tail -10
```
Expected: "✓ built in".

```bash
git add src/app.jsx
git commit -m "feat(coaching): add CoachingPage composer with tabs + time-mode toggle"
```

---

## Task 8 — Wire the page into App + TopNav

**Files:**
- Modify: `src/app.jsx` — App body (~line 16623+), TopNav button (~line 5239), App ternary (~line 17654)

- [ ] **Step 1: Add `coachingDetails` and `coachingWeekly` memos to App**

Locate the App component:
```bash
grep -n "^export default function App" src/app.jsx
```

Inside App (after the existing `coachingDetailsRaw`/`coachingWeeklyRaw` state declarations near line 16670–16690), add:

```jsx
  // Parse coaching CSVs once at App scope so both VirgilMbrExportModal and
  // CoachingPage can consume them. The modal also has its own internal memos —
  // duplication is intentional to avoid changing the modal's signature.
  const coachingDetails = useMemo(() => parseCoachingDetails(coachingDetailsRaw), [coachingDetailsRaw]);
  const coachingWeekly  = useMemo(() => parseCoachingWeekly(coachingWeeklyRaw),  [coachingWeeklyRaw]);
```

Place this AFTER the line that defines `coachingWeeklyRaw` (the `setCoachingWeeklyRaw` setter pattern). Search for the closest `useMemo(() =>` near the parsing section to find a natural insertion point. If unclear, insert immediately before the `currentPage` state declaration.

- [ ] **Step 2: Add `hasCoaching` computed flag and add the TopNav button**

In App, near the existing `hasTnps` definition (search `const hasTnps`), add immediately after it:

```jsx
  const hasCoaching = (coachingWeekly && coachingWeekly.length > 0) || (coachingDetails && Object.keys(coachingDetails).length > 0);
```

Then, find where `hasTnps` is passed into `TopNav`. Re-grep:
```bash
grep -n "<TopNav" src/app.jsx
```

Add `hasCoaching={hasCoaching}` to the TopNav props (matching the pattern of `hasTnps={hasTnps}`).

In TopNav's signature (search `function TopNav({`), add `hasCoaching` to the destructured props:

```jsx
function TopNav({
  // ... existing props ...
  hasTnps,
  hasCoaching,
  // ... rest ...
}) {
```

Locate the tNPS button inside TopNav (line ~5239):
```jsx
{hasTnps && <button onClick={() => navigate("tnps")} style={topNavLinkStyle(isActive("tnps"))}>tNPS</button>}
```

Immediately after it, add:

```jsx
{hasCoaching && <button onClick={() => navigate("coaching")} style={topNavLinkStyle(isActive("coaching"))}>Coaching</button>}
```

- [ ] **Step 3: Add the App ternary branch for `coaching`**

Find the existing tNPS branch (~line 17654):
```bash
grep -n 'currentPage.section === "tnps"' src/app.jsx
```

Immediately AFTER the `<TNPSSlide ... />` line and its closing `)` (the line before `: currentPage.section === "mom" ?`), insert a new branch:

```jsx
        ) : currentPage.section === "coaching" && hasCoaching ? (
          <CoachingPage
            coachingWeekly={coachingWeekly}
            coachingDetails={coachingDetails}
            bpLookup={perf && perf.bpLookup}
            lightMode={lightMode}
          />
```

The ternary chain should now read:
```jsx
        ) : currentPage.section === "tnps" && hasTnps ? (
          <TNPSSlide perf={perf} onNav={() => {}} lightMode={lightMode} />
        ) : currentPage.section === "coaching" && hasCoaching ? (
          <CoachingPage
            coachingWeekly={coachingWeekly}
            coachingDetails={coachingDetails}
            bpLookup={perf && perf.bpLookup}
            lightMode={lightMode}
          />
        ) : currentPage.section === "mom" ? (
```

- [ ] **Step 4: Build verify**

```bash
cd "/c/Users/Joshu/Documents/Claude/Performance Intel" && npx vite build 2>&1 | tail -15
```
Expected: "✓ built in" with no errors. If there's a "not defined" error for `hasCoaching` or `coachingWeekly`/`coachingDetails`, the App-scope memos didn't land in the right spot. Re-grep for them (`grep -n "const coachingDetails" src/app.jsx`) — there should now be TWO matches (App + VirgilMbrExportModal). Both are intentional.

- [ ] **Step 5: Commit**

```bash
git add src/app.jsx
git commit -m "feat(coaching): wire CoachingPage into TopNav + App route"
```

---

## Task 9 — Smoke test + verification

**Files:**
- None modified — verification only.

- [ ] **Step 1: Start dev server**

```bash
cd "/c/Users/Joshu/Documents/Claude/Performance Intel" && npx vite --host
```
Note the printed URL (default `http://localhost:5173`). Open it.

- [ ] **Step 2: Verify nav button appears**

In the top nav, you should see `Coaching` between `tNPS` and the green pacing pill. If the user has no coaching data loaded, the button is hidden — that's correct.

- [ ] **Step 3: Click "Coaching" — verify Summary tab renders**

Expected:
- Header reads "Coaching Standard Attainment — myPerformance"
- Subtitle shows "X agent-weeks · <Month>"
- 4 KPI tiles render with values + X/Y subtitles
- Below: "Site Comparison" bar chart with bars per region
- Below: "Weekly Trend" with FW1..FWn bars (future weeks dashed)

- [ ] **Step 4: Click "By Supervisor" tab**

Expected:
- Site chip row: All / DR / BZ (all) / Belize City / OW / San Ignacio
- Header row with FW1..FWn columns
- Supervisor rows sorted worst-first
- Click a supervisor row → expands inline showing their agents in a grid (cells = session counts, indigo for over-indexed)
- Click again → collapses
- Multiple can be open at once
- Click a chip (e.g., "DR") → list filters to DR supervisors only; expanding still shows their agents

- [ ] **Step 5: Click "All Agents" tab**

Expected:
- Same chip row + a "Search agent name..." input on the right
- Summary line "X agents · Y with gaps"
- Header columns with click-to-sort (Agent / Sessions / %)
- Default sort = % ascending (worst first)
- Type into search → list filters by name substring
- Click a chip → list filters by site

- [ ] **Step 6: Toggle time mode**

In the page header, click "Select Month" → a chip row appears below with each fiscal month from the data. Click a month → only that month's data shows. Click "All Time" → all months.

- [ ] **Step 7: Verify empty-state behavior**

In browser DevTools → Application → Local Storage, temporarily clear `perf_intel_coaching_weekly_v1` and `perf_intel_coaching_details_v1`. Reload. The "Coaching" nav button should disappear (since `hasCoaching` is false). Restore the values from a backup or re-fetch via Settings ⚙ → Refresh.

- [ ] **Step 8: Toggle light/dark mode**

Click the ☀/☾ toggle in the top nav. Coaching page rows should re-tint correctly (light backgrounds in light mode). If anything looks broken in light mode, check that `tint.light` / `tint.dark` are being picked correctly in `AgentRow` and `SupervisorRow`.

- [ ] **Step 9: Reload page persistence**

While on the Coaching page, hit refresh. The Coaching page should reload (not bounce to Overview). This relies on the existing `perf-intel-current-page` localStorage key — no new code needed.

- [ ] **Step 10: Final production build**

```bash
cd "/c/Users/Joshu/Documents/Claude/Performance Intel" && npx vite build 2>&1 | tail -10
```
Expected: "✓ built in" with no errors.

- [ ] **Step 11: Final commit (no code changes — empty)**

If steps 2–9 surface bugs, fix them inline and amend or add follow-up commits. If all pass, no commit needed for verification — implementation is complete.

---

## Spec coverage cross-check

| Spec section | Implemented in |
|---|---|
| §1 Purpose | Whole plan |
| §2 Source data | Task 1 (consumes existing parsed data) + Task 8 (App memos) |
| §3 Aggregator | Task 1 (`buildCoachingPageData`) |
| §4.1 Nav placement | Task 8 step 2 |
| §4.2 Page header + subtitle | Task 7 |
| §4.3 Tab bar | Task 7 |
| §4.4 Empty state | Task 7 |
| §5.1 KPI tiles | Task 4 (`CoachingSummaryTab`) |
| §5.2 Site comparison chart | Task 4 |
| §5.3 Weekly trend chart | Task 4 |
| §6.1 Site chips | Task 5 (`CoachingSiteChips`) |
| §6.2 Supervisor table + columns | Task 3 + Task 5 |
| §6.3 Expand behavior (multi-open) | Task 5 (`expanded` Set state) |
| §7.1 Site chips (All Agents) | Task 6 (reuses `CoachingSiteChips`) |
| §7.2 Search input | Task 6 |
| §7.3 Agent table | Task 3 + Task 6 |
| §7.4 Header summary line | Task 6 |
| §8.1 Color scale | Task 1 (`coachingPctColor`, `coachingCellColor`) |
| §8.2 Row backgrounds | Task 1 (`coachingRowTint`) |
| §8.3 Layout container | Task 7 (`maxWidth: 1100`) |
| §9 File placement | Each task indicates insertion point |
| §10 Out of scope | Honored — no exports, no editing, no settings |
| §11 Open questions | Documented in spec; multi-month label fallback handled in Task 1; supervisor primary-region tie-break handled in Task 1 |
| §12 Done definition | Task 9 walks through each item |

No gaps.

---

## Self-review notes (already addressed inline)

- **Type consistency**: `WeekCell` uses `data.sessions`/`data.eligible` for count mode and `data.x`/`data.y`/`data.pct` for pct mode. The aggregator's output shape matches these names exactly (Task 1).
- **No placeholders**: Every step has runnable code or exact commands.
- **Function signatures**: `coachingPctColor(pct)`, `coachingCellColor(sessions)`, `coachingRowTint(pct)`, `makeSiteFilter(activeChip)`, `coachingRegionLabel(region)`, `coachingSiteFromRegion(region)`, `coachingNormalizedPct(rawVal)`, `buildCoachingPageData(weekly, details, bpLookup, monthFilter)` — all referenced consistently across tasks.
- **Imports**: `useState`, `useMemo`, `Fragment` — all already imported at the top of `src/app.jsx`. No new imports needed.
- **Edge cases handled**: empty `coachingWeekly`, missing `bpLookup`, agents without supervisors (default to "Unassigned" via `row.supervisor` fallback), weeks with no data (rendered as "—" grey), over-indexed sessions (indigo override), multi-month label format change.
