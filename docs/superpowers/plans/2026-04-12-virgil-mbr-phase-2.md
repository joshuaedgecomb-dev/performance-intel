# Corp MBR Export — Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Slides 3 (All-in Attainment + Scorecard), 4 (Quartile Reporting), and 5 (Campaign Hours Info) to the Corp MBR export. Wire new data sources (Q4 2025 sheet, Scorecard PNG upload) and all aggregators needed.

**Architecture:** Extend the existing `CORP MBR —` section in `src/app.jsx` with new parsers, aggregators, and slide builders that parallel the Slide 1/2 patterns. New data uploads/URLs added to the Corp MBR Data Sources modal and export modal. Existing Export MBR path untouched.

**Tech Stack:** React 18, `pptxgenjs`, Vite, single-file `src/app.jsx`. No test framework — verification is `npx vite build` + manual UI inspection.

**Related:**
- Spec: `docs/superpowers/specs/2026-04-12-virgil-mbr-export-design.md` (Sections 6.3, 6.4, 6.5)
- Phase 1 plan: `docs/superpowers/plans/2026-04-12-virgil-mbr-phase-1.md`

---

## Pre-Flight

- [ ] **Verify baseline build passes**

Run: `cd "/c/Users/Joshu/Documents/Claude/Performance Intel" && npx vite build 2>&1 | tail -5`
Expected: `built in Xs` with no errors.

- [ ] **Confirm Phase 1 state**

Run: `grep -n "^function buildVirgilTitleSlide\|^function buildVirgilMyPerformanceSlide\|^function buildVirgilMbrPresentation\|^function VirgilMbrExportModal" src/app.jsx`
Expected: 4 matches. All 4 functions should exist.

- [ ] **Confirm prior-month data infrastructure already works**

Existing Performance Intel state slots `priorMonthRaw` / `priorMonthGoalsRaw` already exist and auto-fetch from the existing Prior Sheet URLs. Phase 2 piggybacks on them. No changes required for those — user just needs to paste Feb 2026 URLs into Settings → Data sources if not already configured.

---

## Task 1: Add Q4 2025 prior-quarter state slots

**Files:**
- Modify: `src/app.jsx` — App component state region (grep `const [coachingDetailsSheetUrl`)

- [ ] **Step 1.1: Add prior-quarter URL state slots**

Find the block of Corp MBR URL state declarations. Add two new slots immediately after the `loginBucketsSheetUrl` block:

```jsx
const [priorQuarterAgentUrl, _setPriorQuarterAgentUrl] = useState(() => {
  try { return localStorage.getItem("perf_intel_prior_quarter_agent_url_v1") || ""; } catch(e) { return ""; }
});
const setPriorQuarterAgentUrl = useCallback(v => {
  _setPriorQuarterAgentUrl(v);
  try { localStorage.setItem("perf_intel_prior_quarter_agent_url_v1", v || ""); } catch(e) {}
}, []);

const [priorQuarterGoalsUrl, _setPriorQuarterGoalsUrl] = useState(() => {
  try { return localStorage.getItem("perf_intel_prior_quarter_goals_url_v1") || ""; } catch(e) { return ""; }
});
const setPriorQuarterGoalsUrl = useCallback(v => {
  _setPriorQuarterGoalsUrl(v);
  try { localStorage.setItem("perf_intel_prior_quarter_goals_url_v1", v || ""); } catch(e) {}
}, []);
```

- [ ] **Step 1.2: Add cached raw state for fetched content**

Immediately after the URL slots:

```jsx
const [priorQuarterAgentRaw, _setPriorQuarterAgentRaw] = useState(() => {
  try { return localStorage.getItem("perf_intel_prior_quarter_agent_v1") || ""; } catch(e) { return ""; }
});
const setPriorQuarterAgentRaw = useCallback(v => {
  _setPriorQuarterAgentRaw(v);
  try { localStorage.setItem("perf_intel_prior_quarter_agent_v1", v || ""); } catch(e) {}
}, []);

const [priorQuarterGoalsRaw, _setPriorQuarterGoalsRaw] = useState(() => {
  try { return localStorage.getItem("perf_intel_prior_quarter_goals_v1") || ""; } catch(e) { return ""; }
});
const setPriorQuarterGoalsRaw = useCallback(v => {
  _setPriorQuarterGoalsRaw(v);
  try { localStorage.setItem("perf_intel_prior_quarter_goals_v1", v || ""); } catch(e) {}
}, []);
```

- [ ] **Step 1.3: Verify build**

Run: `npx vite build 2>&1 | tail -5`

- [ ] **Step 1.4: Commit**

```bash
git add src/app.jsx && git commit -m "feat(corp-mbr): add prior-quarter URL + raw state slots"
```

---

## Task 2: Auto-fetch prior-quarter URLs

**Files:**
- Modify: `src/app.jsx` — App component `useEffect` region (grep `coachingDetailsSheetUrl.*useEffect\|useEffect.*coachingDetailsSheetUrl`)

- [ ] **Step 2.1: Add two auto-fetch useEffects**

Mirror the existing Corp MBR auto-fetch pattern. Add immediately after the existing `loginBucketsSheetUrl` effect:

```jsx
useEffect(() => {
  if (!priorQuarterAgentUrl) return;
  (async () => {
    try {
      const res = await fetch(priorQuarterAgentUrl);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      setPriorQuarterAgentRaw(text);
    } catch(e) {
      try {
        const res = await fetch(`https://corsproxy.io/?${encodeURIComponent(priorQuarterAgentUrl)}`);
        if (!res.ok) throw new Error(`Proxy HTTP ${res.status}`);
        setPriorQuarterAgentRaw(await res.text());
      } catch(e2) {
        console.error("Prior Quarter Agent sheet fetch failed:", e2);
      }
    }
  })();
}, [priorQuarterAgentUrl]);

useEffect(() => {
  if (!priorQuarterGoalsUrl) return;
  (async () => {
    try {
      const res = await fetch(priorQuarterGoalsUrl);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      setPriorQuarterGoalsRaw(text);
    } catch(e) {
      try {
        const res = await fetch(`https://corsproxy.io/?${encodeURIComponent(priorQuarterGoalsUrl)}`);
        if (!res.ok) throw new Error(`Proxy HTTP ${res.status}`);
        setPriorQuarterGoalsRaw(await res.text());
      } catch(e2) {
        console.error("Prior Quarter Goals sheet fetch failed:", e2);
      }
    }
  })();
}, [priorQuarterGoalsUrl]);
```

- [ ] **Step 2.2: Add fetches to `handleRefresh`**

Find `handleRefresh` (grep `const handleRefresh = useCallback` or `async function handleRefresh`). Add two more parallel fetch blocks for the Corp MBR URLs already extended, including the new prior-quarter URLs. Pattern-match on the existing refresh blocks.

- [ ] **Step 2.3: Verify build**

Run: `npx vite build 2>&1 | tail -5`

- [ ] **Step 2.4: Commit**

```bash
git add src/app.jsx && git commit -m "feat(corp-mbr): auto-fetch prior-quarter sheets + include in refresh"
```

---

## Task 3: Add Q4 URL inputs to Corp MBR Data Sources modal

**Files:**
- Modify: `src/app.jsx` — `CorpMbrDataSourcesModal` component (grep `^function CorpMbrDataSourcesModal`)

- [ ] **Step 3.1: Extend prop destructure**

Add `priorQuarterAgentUrl`, `setPriorQuarterAgentUrl`, `priorQuarterGoalsUrl`, `setPriorQuarterGoalsUrl` to the function signature.

- [ ] **Step 3.2: Add UrlRow entries in the modal body**

Below the existing three Corp MBR URL rows, add:

```jsx
<UrlRow label="Prior Quarter — Agent Data" value={priorQuarterAgentUrl} setValue={setPriorQuarterAgentUrl}
  hint="Q4 2025 agent-level stats (Oct/Nov/Dec '25). Used by Slide 3 comparison table." />
<UrlRow label="Prior Quarter — Goals" value={priorQuarterGoalsUrl} setValue={setPriorQuarterGoalsUrl}
  hint="Q4 2025 goals CSV (same shape as March/April goals). Needed to compute Q4 attainment." />
```

- [ ] **Step 3.3: Pass the new props from App's mount**

Grep: `grep -n "<CorpMbrDataSourcesModal" src/app.jsx`. Add the four new props in the mount.

- [ ] **Step 3.4: Verify build**

Run: `npx vite build 2>&1 | tail -5`

- [ ] **Step 3.5: Commit**

```bash
git add src/app.jsx && git commit -m "feat(corp-mbr): add Q4 2025 URL inputs to Corp MBR Data Sources modal"
```

---

## Task 4: Add Scorecard PNG upload to the Corp MBR export modal

**Files:**
- Modify: `src/app.jsx` — `VirgilMbrExportModal` component

- [ ] **Step 4.1: Add in-memory state for the scorecard image**

Near the top of `VirgilMbrExportModal`, add:

```jsx
const [scorecardDataUrl, setScorecardDataUrl] = useState("");
const fileInputRef = useRef(null);
const handleScorecardUpload = useCallback((file) => {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => setScorecardDataUrl(String(e.target?.result || ""));
  reader.readAsDataURL(file);
}, []);
```

(Requires `useRef` — it's already imported at the top of `src/app.jsx`.)

- [ ] **Step 4.2: Add upload UI inside the modal, just above the AI Insights toggle**

```jsx
<div style={{ marginTop: 16, padding: 12, background: "#fafafa", borderRadius: 6, border: "1px solid #d1d5db" }}>
  <div style={{ fontSize: 13, fontWeight: 600 }}>Scorecard PNG (Slide 3)</div>
  <div style={{ fontSize: 12, color: "#6b7280", marginTop: 2 }}>
    {scorecardDataUrl ? "Loaded — will embed into Slide 3." : "Optional. Upload the Comcast scorecard screenshot for the reporting month."}
  </div>
  <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
    <button onClick={() => fileInputRef.current?.click()}
      style={{ padding: "6px 12px", border: "1px solid #d1d5db", background: "#fff", borderRadius: 6, cursor: "pointer", fontSize: 12 }}>
      {scorecardDataUrl ? "Replace" : "Upload PNG"}
    </button>
    {scorecardDataUrl && (
      <button onClick={() => setScorecardDataUrl("")}
        style={{ padding: "6px 12px", border: "1px solid #d1d5db", background: "#fff", borderRadius: 6, cursor: "pointer", fontSize: 12 }}>
        Remove
      </button>
    )}
  </div>
  <input ref={fileInputRef} type="file" accept=".png,.jpg,.jpeg" style={{ display: "none" }}
    onChange={e => { if (e.target.files[0]) handleScorecardUpload(e.target.files[0]); e.target.value = ""; }} />
</div>
```

- [ ] **Step 4.3: Pass `scorecardDataUrl` into the orchestrator call**

In `handleDownload`, add `scorecardDataUrl` to the options object passed to `buildVirgilMbrPresentation`:

```jsx
const pres = buildVirgilMbrPresentation(perf, {
  reportingMonthLabel: reportingMonth,
  coachingDetails, coachingWeekly, loginBuckets,
  scorecardDataUrl,
  insights: { ...(insights || {}), slide2: slide2Insights },
});
```

Add `scorecardDataUrl` to the useCallback dep array.

- [ ] **Step 4.4: Verify build**

Run: `npx vite build 2>&1 | tail -5`

- [ ] **Step 4.5: Commit**

```bash
git add src/app.jsx && git commit -m "feat(corp-mbr): add scorecard PNG upload field to export modal"
```

---

## Task 5: Prior-quarter data aggregator

**Files:**
- Modify: `src/app.jsx` — Corp MBR Aggregators section (grep `^function buildLoginActivitySingle`)

- [ ] **Step 5.1: Add `computeMonthlyAttainment` helper**

Place immediately after `buildLoginActivitySingle`. This takes an agent CSV + goals CSV (both raw text) and a month filter, and returns XI%, XM%, SPH, CPS for the org-wide totals over that month (or entire dataset if month is `"*"`).

```jsx
// Compute org-wide XI attainment %, XM attainment %, SPH, CPS for a filtered agent dataset.
// agentRaw / goalsRaw can be the full CSVs; dateFilter(dateStr) => boolean returns whether a row is in scope.
function computeCorpAttainment(agentRaw, goalsRaw, dateFilter) {
  if (!agentRaw || !agentRaw.trim()) {
    return { xiPct: 0, xmPct: 0, sph: 0, cps: 0, sales: 0, hours: 0, xiPlan: 0, xmPlan: 0 };
  }
  const agentRows = parseCSV(agentRaw);
  const goalsRows = goalsRaw && goalsRaw.trim() ? parseCSV(goalsRaw) : [];
  let hours = 0, sales = 0, xi = 0, xm = 0;
  for (const r of agentRows) {
    const d = (r["Date"] || "").trim();
    if (dateFilter && !dateFilter(d)) continue;
    hours += Number(r["Hours"]) || 0;
    sales += Number(r["Goals"]) || 0;
    xi += Number(r["New XI"]) || 0;
    xm += Number(r["XM Lines"]) || 0;
  }
  let xiPlan = 0, xmPlan = 0, hoursPlan = 0;
  for (const r of goalsRows) {
    const hg = Number(r["Hours Goal"]) || 0;
    hoursPlan += hg;
    xiPlan += Number(r["HSD GOAL"] || r["HSD Sell In Goal"]) || 0;
    xmPlan += Number(r["XM GOAL"] || r["XM Sell In Goal"]) || 0;
  }
  const sph = hours ? sales / hours : 0;
  const cps = sales ? (hours * 19.77) / sales : (hours * 19.77);
  return {
    xiPct: xiPlan ? xi / xiPlan : 0,
    xmPct: xmPlan ? xm / xmPlan : 0,
    sph,
    cps,
    sales, hours, xi, xm, xiPlan, xmPlan, hoursPlan,
  };
}
```

- [ ] **Step 5.2: Add month-range filter helper**

Place immediately above `computeCorpAttainment`:

```jsx
// Returns a predicate that accepts a YYYY-MM-DD (or similar) date string and returns true if it's in the named month.
// monthLabel like "Mar '26" / "Mar 26" → year 2026, month 3.
function makeMonthFilter(monthLabel) {
  const m = String(monthLabel || "").trim().match(/^([A-Za-z]{3,})\s*'?(\d{2,4})$/);
  if (!m) return () => true;
  const mon = m[1].slice(0, 3).toLowerCase();
  const monIdx = { jan:1, feb:2, mar:3, apr:4, may:5, jun:6, jul:7, aug:8, sep:9, oct:10, nov:11, dec:12 }[mon];
  const yr = Number(m[2].length === 4 ? m[2] : `20${m[2]}`);
  return (dateStr) => {
    if (!dateStr) return false;
    const parts = dateStr.trim().split(/[-\/]/);
    if (parts.length < 3) return false;
    let y, mo;
    if (parts[0].length === 4) { y = Number(parts[0]); mo = Number(parts[1]); }
    else { y = Number(parts[2].length === 4 ? parts[2] : `20${parts[2]}`); mo = Number(parts[0]); }
    return y === yr && mo === monIdx;
  };
}

// Filter for a quarter like "Q4 2025" or fiscal month range.
function makeQuarterFilter(year, qNum) {
  const startMon = (qNum - 1) * 3 + 1;
  return (dateStr) => {
    if (!dateStr) return false;
    const parts = dateStr.trim().split(/[-\/]/);
    if (parts.length < 3) return false;
    let y, mo;
    if (parts[0].length === 4) { y = Number(parts[0]); mo = Number(parts[1]); }
    else { y = Number(parts[2].length === 4 ? parts[2] : `20${parts[2]}`); mo = Number(parts[0]); }
    return y === year && mo >= startMon && mo <= startMon + 2;
  };
}
```

- [ ] **Step 5.3: Verify build**

Run: `npx vite build 2>&1 | tail -5`

- [ ] **Step 5.4: Commit**

```bash
git add src/app.jsx && git commit -m "feat(corp-mbr): aggregator helpers — computeCorpAttainment + month/quarter filters"
```

---

## Task 6: Build Slide 3 — All-in Attainment + Scorecard

**Files:**
- Modify: `src/app.jsx` — Corp MBR Slide Builders section (after `buildVirgilMyPerformanceSlide`)

- [ ] **Step 6.1: Add `buildCorpOpPerformanceSlide` function**

Insert after `buildVirgilMyPerformanceSlide`:

```jsx
function buildCorpOpPerformanceSlide(pres, agentRaw, goalsRaw, priorAgentRaw, priorGoalsRaw, priorQuarterAgentRaw, priorQuarterGoalsRaw, reportingMonthLabel, scorecardDataUrl) {
  const slide = pres.addSlide();
  slide.background = { color: virgilTheme.slideBg };
  virgilBrandBars(pres, slide);

  // Eyebrow + title
  slide.addText("OPERATIONAL PERFORMANCE", {
    x: 0.5, y: 0.35, w: 6, h: 0.25,
    fontSize: 10, color: virgilTheme.eyebrow, bold: true, charSpacing: 2,
  });
  slide.addText("Global Callcenter Solutions | All-in Attainment", {
    x: 0.5, y: 0.65, w: 12, h: 0.55,
    fontSize: 26, color: virgilTheme.bodyText, bold: true,
  });

  // Time period labels
  const priorKey = getPriorMonthLabel(reportingMonthLabel);
  const monthParts = String(reportingMonthLabel || "").trim().match(/^([A-Za-z]{3,})\s*'?(\d{2,4})$/);
  const year = monthParts ? Number(monthParts[2].length === 4 ? monthParts[2] : `20${monthParts[2]}`) : new Date().getFullYear();
  const q4Label = `Q4 ${year - 1}`;

  // Compute values
  const q4 = computeCorpAttainment(priorQuarterAgentRaw, priorQuarterGoalsRaw, makeQuarterFilter(year - 1, 4));
  const prior = computeCorpAttainment(priorAgentRaw, priorGoalsRaw, makeMonthFilter(priorKey));
  const curr = computeCorpAttainment(agentRaw, goalsRaw, makeMonthFilter(reportingMonthLabel));
  // MTD = partial data for month AFTER reporting month
  const mtdLabel = getPriorMonthLabel(reportingMonthLabel) === priorKey
    ? getNextMonthLabel(reportingMonthLabel)
    : getNextMonthLabel(reportingMonthLabel);
  const mtd = computeCorpAttainment(agentRaw, goalsRaw, makeMonthFilter(mtdLabel));

  // Table
  const tableRows = [
    [
      { text: "", options: { fill: { color: "F3F4F6" }, bold: true } },
      { text: q4Label, options: { fill: { color: "EDE9FE" }, bold: true, align: "center" } },
      { text: priorKey, options: { fill: { color: "E9D5FF" }, bold: true, align: "center" } },
      { text: reportingMonthLabel, options: { fill: { color: "DBEAFE" }, bold: true, align: "center" } },
      { text: `${mtdLabel} MTD`, options: { fill: { color: "FEF3C7" }, bold: true, align: "center" } },
    ],
    [
      { text: "XI Attainment", options: { bold: true } },
      { text: q4.xiPlan ? `${(q4.xiPct * 100).toFixed(1)}%` : "—", options: { align: "center" } },
      { text: prior.xiPlan ? `${(prior.xiPct * 100).toFixed(1)}%` : "—", options: { align: "center" } },
      { text: curr.xiPlan ? `${(curr.xiPct * 100).toFixed(1)}%` : "—", options: { align: "center" } },
      { text: mtd.xiPlan ? `${(mtd.xiPct * 100).toFixed(1)}%` : "—", options: { align: "center" } },
    ],
    [
      { text: "XM Attainment", options: { bold: true } },
      { text: q4.xmPlan ? `${(q4.xmPct * 100).toFixed(1)}%` : "—", options: { align: "center" } },
      { text: prior.xmPlan ? `${(prior.xmPct * 100).toFixed(1)}%` : "—", options: { align: "center" } },
      { text: curr.xmPlan ? `${(curr.xmPct * 100).toFixed(1)}%` : "—", options: { align: "center" } },
      { text: mtd.xmPlan ? `${(mtd.xmPct * 100).toFixed(1)}%` : "—", options: { align: "center" } },
    ],
    [
      { text: "SPH", options: { bold: true } },
      { text: q4.hours ? q4.sph.toFixed(3) : "—", options: { align: "center" } },
      { text: prior.hours ? prior.sph.toFixed(3) : "—", options: { align: "center" } },
      { text: curr.hours ? curr.sph.toFixed(3) : "—", options: { align: "center" } },
      { text: mtd.hours ? mtd.sph.toFixed(3) : "—", options: { align: "center" } },
    ],
    [
      { text: "CPS", options: { bold: true } },
      { text: q4.hours ? `$${q4.cps.toFixed(2)}` : "—", options: { align: "center" } },
      { text: prior.hours ? `$${prior.cps.toFixed(2)}` : "—", options: { align: "center" } },
      { text: curr.hours ? `$${curr.cps.toFixed(2)}` : "—", options: { align: "center" } },
      { text: mtd.hours ? `$${mtd.cps.toFixed(2)}` : "—", options: { align: "center" } },
    ],
  ];

  slide.addTable(tableRows, {
    x: 0.5, y: 1.3, w: 12.3,
    colW: [2.8, 2.4, 2.4, 2.4, 2.3],
    rowH: 0.4,
    fontSize: 11,
    color: virgilTheme.bodyText,
    border: { type: "solid", pt: 0.5, color: "D1D5DB" },
    autoPage: false,
  });

  // Scorecard PNG (bottom half)
  slide.addText("Scorecard BP Comparison — Comcast provided", {
    x: 0.5, y: 3.6, w: 12, h: 0.3,
    fontSize: 12, color: virgilTheme.eyebrow, bold: true,
  });
  if (scorecardDataUrl) {
    slide.addImage({
      data: scorecardDataUrl,
      x: 0.5, y: 3.95, w: 12.3, h: 3.0,
      sizing: { type: "contain", w: 12.3, h: 3.0 },
    });
  } else {
    slide.addShape("rect", {
      x: 0.5, y: 3.95, w: 12.3, h: 3.0,
      fill: { color: "FAFAFA" },
      line: { color: "E5E7EB", width: 0.5, dashType: "dash" },
    });
    slide.addText("Scorecard not uploaded — add the Comcast scorecard PNG in the export modal", {
      x: 0.5, y: 5.25, w: 12.3, h: 0.4,
      fontSize: 11, color: virgilTheme.subtle, italic: true, align: "center",
    });
  }
}
```

- [ ] **Step 6.2: Add `getNextMonthLabel` helper**

Place immediately below `getPriorMonthLabel`:

```jsx
function getNextMonthLabel(label) {
  if (!label) return "";
  const m = String(label).trim().match(/^([A-Za-z]{3,})\s*'?(\d{2,4})$/);
  if (!m) return "";
  const mon = m[1].slice(0, 3).toLowerCase();
  const monIdx = { jan:1, feb:2, mar:3, apr:4, may:5, jun:6, jul:7, aug:8, sep:9, oct:10, nov:11, dec:12 }[mon];
  if (!monIdx) return "";
  const year = Number(m[2].length === 4 ? m[2].slice(2) : m[2]);
  let nMon = monIdx + 1, nYear = year;
  if (nMon === 13) { nMon = 1; nYear = year + 1; }
  const monNames = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${monNames[nMon - 1]} '${String(nYear).padStart(2, "0")}`;
}
```

- [ ] **Step 6.3: Verify build**

Run: `npx vite build 2>&1 | tail -5`

- [ ] **Step 6.4: Commit**

```bash
git add src/app.jsx && git commit -m "feat(corp-mbr): add Slide 3 (All-in Attainment + Scorecard) builder"
```

---

## Task 7: Build Slide 4 — Quartile Reporting aggregator

**Files:**
- Modify: `src/app.jsx` — Corp MBR Aggregators section

- [ ] **Step 7.1: Add `buildQuartileReport` helper**

Place immediately after `computeCorpAttainment`:

```jsx
// Groups qualified agents by campaign type (GLU = XM, GLN = XI), quartiles them by % to Goal,
// and cross-tabs by tenure bucket. Returns { xm: {...}, xi: {...} } per-section data.
function buildQuartileReport(agentRaw, goalsRaw, newHiresRaw, dateFilter, referenceDate) {
  if (!agentRaw || !agentRaw.trim()) return { xm: null, xi: null };
  const agentRows = parseCSV(agentRaw);
  const goalsRows = goalsRaw && goalsRaw.trim() ? parseCSV(goalsRaw) : [];
  const newHireRows = newHiresRaw && newHiresRaw.trim() ? parseCSV(newHiresRaw) : [];

  // Hire-date lookup by agent name (case-insensitive)
  const hireByName = {};
  for (const r of newHireRows) {
    const first = (r["First Name"] || "").trim();
    const last = (r["Last Name"] || "").trim();
    const name = `${first} ${last}`.toLowerCase();
    const hd = (r["Hire Date"] || "").trim();
    if (name && hd) hireByName[name] = hd;
  }

  // Per-campaign goals lookup for SPH target
  const goalByRoc = {};
  for (const r of goalsRows) {
    const rocList = (r["ROC Numbers"] || "").split(",").map(s => s.trim()).filter(Boolean);
    for (const roc of rocList) {
      goalByRoc[roc] = r;
    }
  }

  // Aggregate per-agent for the filtered period
  const byAgent = {};
  for (const r of agentRows) {
    if (dateFilter && !dateFilter((r["Date"] || "").trim())) continue;
    const name = (r["AgentName"] || "").trim();
    if (!name) continue;
    const roc = (r["Job"] || "").trim();
    const isGLU = roc.startsWith("GLU");
    const isGLN = roc.startsWith("GLN");
    if (!isGLU && !isGLN) continue;
    const key = `${name}|${isGLU ? "XM" : "XI"}`;
    if (!byAgent[key]) {
      byAgent[key] = { name, group: isGLU ? "XM" : "XI", hours: 0, sales: 0, xi: 0, xm: 0, roc };
    }
    const a = byAgent[key];
    a.hours += Number(r["Hours"]) || 0;
    a.sales += Number(r["Goals"]) || 0;
    a.xi += Number(r["New XI"]) || 0;
    a.xm += Number(r["XM Lines"]) || 0;
  }

  const refDate = referenceDate ? new Date(referenceDate) : new Date();
  const tenureBuckets = [
    [0, 30], [31, 60], [61, 90], [91, 120], [121, 150], [151, 180], [181, 360], [361, Infinity]
  ];
  const bucketLabel = (lo, hi) => hi === Infinity ? "361+" : `${lo}-${hi}`;

  const buildSection = (group) => {
    const agents = Object.values(byAgent).filter(a => a.group === group);
    // % to Goal: units (xi or xm) / plan for that agent's ROC
    const withMetrics = agents.map(a => {
      const goal = goalByRoc[a.roc];
      let unitGoal = 0;
      if (goal) {
        if (group === "XM") unitGoal = Number(goal["XM GOAL"] || goal["XM Sell In Goal"]) || 0;
        else unitGoal = Number(goal["HSD GOAL"] || goal["HSD Sell In Goal"]) || 0;
      }
      const unitsMade = group === "XM" ? a.xm : a.xi;
      const pctToGoal = unitGoal > 0 ? unitsMade / unitGoal : 0;
      const hireStr = hireByName[a.name.toLowerCase()] || "";
      let tenureDays = 0;
      if (hireStr) {
        try {
          const hd = new Date(hireStr);
          tenureDays = Math.floor((refDate - hd) / (1000 * 60 * 60 * 24));
        } catch(e) {}
      }
      return { ...a, unitsMade, unitGoal, pctToGoal, tenureDays };
    });

    // Sort by % to Goal descending, split into 4 equal quartiles
    withMetrics.sort((x, y) => y.pctToGoal - x.pctToGoal);
    const n = withMetrics.length;
    if (n === 0) return { quartileSummary: [], tenureMatrix: [] };
    const qSize = Math.ceil(n / 4);
    const quartiles = [[], [], [], []];
    for (let i = 0; i < n; i++) {
      const q = Math.min(3, Math.floor(i / qSize));
      quartiles[q].push(withMetrics[i]);
    }

    const quartileSummary = quartiles.map((qAgents, i) => {
      const unitsTotal = qAgents.reduce((s, a) => s + a.unitsMade, 0);
      const goalTotal = qAgents.reduce((s, a) => s + a.unitGoal, 0);
      const qPct = goalTotal > 0 ? unitsTotal / goalTotal : 0;
      return { quartile: i + 1, units: unitsTotal, pctToGoal: qPct, agentCount: qAgents.length };
    });

    // Tenure matrix: rows = tenure buckets, cols = A/B/C/D counts + participation %
    const tenureMatrix = tenureBuckets.map(([lo, hi]) => {
      const inBucket = withMetrics.filter(a => a.tenureDays >= lo && a.tenureDays <= hi);
      const counts = [0, 0, 0, 0];
      inBucket.forEach(a => {
        const q = quartiles.findIndex(qa => qa.includes(a));
        if (q >= 0) counts[q] += 1;
      });
      const anySale = inBucket.filter(a => a.unitsMade >= 1).length;
      const total = inBucket.length;
      const participation = total ? anySale / total : 0;
      return { label: bucketLabel(lo, hi), A: counts[0], B: counts[1], C: counts[2], D: counts[3], participation, total };
    });

    return { quartileSummary, tenureMatrix };
  };

  return { xm: buildSection("XM"), xi: buildSection("XI") };
}
```

- [ ] **Step 7.2: Verify build**

Run: `npx vite build 2>&1 | tail -5`

- [ ] **Step 7.3: Commit**

```bash
git add src/app.jsx && git commit -m "feat(corp-mbr): buildQuartileReport aggregator for Slide 4"
```

---

## Task 8: Build Slide 4 — Quartile Reporting slide builder

**Files:**
- Modify: `src/app.jsx` — Corp MBR Slide Builders section

- [ ] **Step 8.1: Add `buildCorpQuartileSlide` function**

Place after `buildCorpOpPerformanceSlide`:

```jsx
function buildCorpQuartileSlide(pres, agentRaw, goalsRaw, newHiresRaw, reportingMonthLabel) {
  const slide = pres.addSlide();
  slide.background = { color: virgilTheme.slideBg };
  virgilBrandBars(pres, slide);

  slide.addText("OPERATIONAL PERFORMANCE", {
    x: 0.5, y: 0.35, w: 6, h: 0.25,
    fontSize: 10, color: virgilTheme.eyebrow, bold: true, charSpacing: 2,
  });
  slide.addText("Global Callcenter Solutions | Quartile Reporting", {
    x: 0.5, y: 0.65, w: 12, h: 0.5,
    fontSize: 24, color: virgilTheme.bodyText, bold: true,
  });

  // Reporting-month and MTD data (Slide 4 ALWAYS renders MTD)
  const reporting = buildQuartileReport(agentRaw, goalsRaw, newHiresRaw,
    makeMonthFilter(reportingMonthLabel), endOfMonthDate(reportingMonthLabel));
  const mtdLabel = getNextMonthLabel(reportingMonthLabel);
  const mtd = buildQuartileReport(agentRaw, goalsRaw, newHiresRaw,
    makeMonthFilter(mtdLabel), new Date());

  const colW = 6.25;
  const col1X = 0.5;
  const col2X = 6.9;

  const drawQuartileColumn = (xBase, header, report) => {
    slide.addText(header, {
      x: xBase, y: 1.25, w: colW, h: 0.3,
      fontSize: 13, color: virgilTheme.eyebrow, bold: true,
    });
    if (!report || !report.xm) {
      slide.addText("No data", { x: xBase, y: 1.6, w: colW, h: 0.3, fontSize: 11, color: virgilTheme.subtle, italic: true });
      return;
    }
    const drawSection = (y, label, section) => {
      slide.addText(label, {
        x: xBase, y, w: colW, h: 0.25,
        fontSize: 11, color: virgilTheme.bodyText, bold: true,
      });
      if (!section || !section.quartileSummary || section.quartileSummary.length === 0) {
        slide.addText("(no data)", { x: xBase, y: y + 0.25, w: colW, h: 0.25, fontSize: 9, color: virgilTheme.subtle, italic: true });
        return;
      }
      // Quartile summary (compact table, left half of sub-row)
      const qColors = ["16A34A", "F59E0B", "F97316", "DC2626"];
      const summaryRows = [
        [{ text: "Q", options: { bold: true, align: "center", fill: { color: "F3F4F6" } } },
         { text: "Units", options: { bold: true, align: "center", fill: { color: "F3F4F6" } } },
         { text: "% to Goal", options: { bold: true, align: "center", fill: { color: "F3F4F6" } } }],
        ...section.quartileSummary.map((q, i) => ([
          { text: String(q.quartile), options: { align: "center", fill: { color: qColors[i] }, color: "FFFFFF", bold: true } },
          { text: String(q.units), options: { align: "center" } },
          { text: `${(q.pctToGoal * 100).toFixed(1)}%`, options: { align: "center" } },
        ])),
      ];
      slide.addTable(summaryRows, {
        x: xBase, y: y + 0.25, w: 2.6,
        colW: [0.5, 1.0, 1.1],
        rowH: 0.28,
        fontSize: 9,
        border: { type: "solid", pt: 0.5, color: "D1D5DB" },
        autoPage: false,
      });

      // Tenure matrix (right side of sub-row)
      const matrixRows = [
        [
          { text: "Tenure", options: { bold: true, align: "center", fill: { color: "F3F4F6" } } },
          { text: "A", options: { bold: true, align: "center", fill: { color: "16A34A" }, color: "FFFFFF" } },
          { text: "B", options: { bold: true, align: "center", fill: { color: "F59E0B" }, color: "FFFFFF" } },
          { text: "C", options: { bold: true, align: "center", fill: { color: "F97316" }, color: "FFFFFF" } },
          { text: "D", options: { bold: true, align: "center", fill: { color: "DC2626" }, color: "FFFFFF" } },
          { text: "Part %", options: { bold: true, align: "center", fill: { color: "F3F4F6" } } },
        ],
        ...section.tenureMatrix.map(row => ([
          { text: row.label, options: { bold: true, align: "center" } },
          { text: String(row.A), options: { align: "center" } },
          { text: String(row.B), options: { align: "center" } },
          { text: String(row.C), options: { align: "center" } },
          { text: String(row.D), options: { align: "center" } },
          { text: `${(row.participation * 100).toFixed(1)}%`, options: { align: "center" } },
        ])),
      ];
      slide.addTable(matrixRows, {
        x: xBase + 2.7, y: y + 0.25, w: 3.5,
        colW: [0.75, 0.45, 0.45, 0.45, 0.45, 0.95],
        rowH: 0.24,
        fontSize: 8,
        border: { type: "solid", pt: 0.5, color: "D1D5DB" },
        autoPage: false,
      });
    };

    drawSection(1.65, "XM Participation (GLU)", report.xm);
    drawSection(4.55, "XI Participation (GLN)", report.xi);
  };

  drawQuartileColumn(col1X, `Month Reporting On — ${reportingMonthLabel}`, reporting);
  drawQuartileColumn(col2X, `MTD — ${mtdLabel}`, mtd);
}
```

- [ ] **Step 8.2: Add `endOfMonthDate` helper**

Place after `getNextMonthLabel`:

```jsx
function endOfMonthDate(label) {
  if (!label) return new Date();
  const m = String(label).trim().match(/^([A-Za-z]{3,})\s*'?(\d{2,4})$/);
  if (!m) return new Date();
  const mon = m[1].slice(0, 3).toLowerCase();
  const monIdx = { jan:1, feb:2, mar:3, apr:4, may:5, jun:6, jul:7, aug:8, sep:9, oct:10, nov:11, dec:12 }[mon];
  const yr = Number(m[2].length === 4 ? m[2] : `20${m[2]}`);
  return new Date(yr, monIdx, 0);
}
```

- [ ] **Step 8.3: Verify build**

Run: `npx vite build 2>&1 | tail -5`

- [ ] **Step 8.4: Commit**

```bash
git add src/app.jsx && git commit -m "feat(corp-mbr): add Slide 4 (Quartile Reporting) builder + date helpers"
```

---

## Task 9: Build Slide 5 — Campaign Hours Info aggregator

**Files:**
- Modify: `src/app.jsx` — Corp MBR Aggregators section

- [ ] **Step 9.1: Add `buildCampaignHoursByFunding`**

Place after `buildQuartileReport`:

```jsx
// Roll hours up per funding type for a given month.
// Returns { byFunding: { Growth: { plan, actual }, National: {...}, Marketing: {...}, HQ: {...} }, totalPlan, totalActual, campaigns: [{name, funding, hours}] }
function buildCampaignHoursByFunding(agentRaw, goalsRaw, monthFilter) {
  const goalsRows = goalsRaw && goalsRaw.trim() ? parseCSV(goalsRaw) : [];
  const agentRows = agentRaw && agentRaw.trim() ? parseCSV(agentRaw) : [];

  // Map ROC → funding + campaign name + hours goal
  const rocMeta = {};
  for (const r of goalsRows) {
    const funding = (r["Funding"] || "").trim();
    const name = (r["Target Audience"] || r["Target"] || "").trim();
    const rocList = (r["ROC Numbers"] || "").split(",").map(s => s.trim()).filter(Boolean);
    const par = (r["PAR?"] || "").trim().toUpperCase() === "Y";
    const hoursGoal = Number(r["Hours Goal"]) || 0;
    for (const roc of rocList) {
      rocMeta[roc] = { funding, name, hoursGoal, par };
    }
  }

  // Sum actual hours per ROC for the filtered month
  const actualByRoc = {};
  for (const r of agentRows) {
    if (monthFilter && !monthFilter((r["Date"] || "").trim())) continue;
    const roc = (r["Job"] || "").trim();
    if (!roc) continue;
    actualByRoc[roc] = (actualByRoc[roc] || 0) + (Number(r["Hours"]) || 0);
  }

  const byFunding = { Growth: { plan: 0, actual: 0 }, National: { plan: 0, actual: 0 }, Marketing: { plan: 0, actual: 0 }, HQ: { plan: 0, actual: 0 } };
  const campaigns = [];
  let totalPlan = 0, totalActual = 0;
  for (const roc in rocMeta) {
    const meta = rocMeta[roc];
    const act = actualByRoc[roc] || 0;
    if (byFunding[meta.funding]) {
      byFunding[meta.funding].plan += meta.hoursGoal;
      byFunding[meta.funding].actual += act;
    }
    totalPlan += meta.hoursGoal;
    totalActual += act;
    if (meta.name) campaigns.push({ name: meta.name, funding: meta.funding, hoursGoal: meta.hoursGoal, hoursActual: act, par: meta.par, roc });
  }
  return { byFunding, totalPlan, totalActual, campaigns };
}
```

- [ ] **Step 9.2: Verify build**

Run: `npx vite build 2>&1 | tail -5`

- [ ] **Step 9.3: Commit**

```bash
git add src/app.jsx && git commit -m "feat(corp-mbr): buildCampaignHoursByFunding aggregator for Slide 5"
```

---

## Task 10: Build Slide 5 — Campaign Hours Info slide

**Files:**
- Modify: `src/app.jsx` — Corp MBR Slide Builders section

- [ ] **Step 10.1: Add `buildCorpCampaignHoursSlide`**

Place after `buildCorpQuartileSlide`:

```jsx
function buildCorpCampaignHoursSlide(pres, agentRaw, goalsRaw, priorAgentRaw, priorGoalsRaw, reportingMonthLabel) {
  const slide = pres.addSlide();
  slide.background = { color: virgilTheme.slideBg };
  virgilBrandBars(pres, slide);

  slide.addText("OPERATIONAL PERFORMANCE", {
    x: 0.5, y: 0.35, w: 6, h: 0.25,
    fontSize: 10, color: virgilTheme.eyebrow, bold: true, charSpacing: 2,
  });
  slide.addText("Global Callcenter Solutions | Campaign Info", {
    x: 0.5, y: 0.65, w: 12, h: 0.5,
    fontSize: 24, color: virgilTheme.bodyText, bold: true,
  });

  const priorKey = getPriorMonthLabel(reportingMonthLabel);
  const mtdLabel = getNextMonthLabel(reportingMonthLabel);

  const prior = buildCampaignHoursByFunding(priorAgentRaw, priorGoalsRaw, makeMonthFilter(priorKey));
  const curr = buildCampaignHoursByFunding(agentRaw, goalsRaw, makeMonthFilter(reportingMonthLabel));
  const mtd = buildCampaignHoursByFunding(agentRaw, goalsRaw, makeMonthFilter(mtdLabel));

  const fundingOrder = ["Growth", "National", "Marketing", "HQ"];
  const fundingColors = { Growth: "0E7490", National: "1E293B", Marketing: "8B5CF6", HQ: "374151" };

  const drawBarGroup = (y, label, data) => {
    const totalPlan = data.totalPlan || 1;
    const totalActual = data.totalActual || 1;
    slide.addText(`Total ${label} Monthly Budgeted Hours = ${Math.round(data.totalPlan).toLocaleString()}`, {
      x: 0.5, y, w: 12.3, h: 0.25,
      fontSize: 11, color: virgilTheme.bodyText, bold: true, align: "center",
    });
    // % to Hours Goal row (per funding)
    const rowY1 = y + 0.35;
    const rowY2 = y + 0.95;
    slide.addText("% to Hours Goal", { x: 0.3, y: rowY1, w: 1.3, h: 0.3, fontSize: 8, color: virgilTheme.subtle, align: "right" });
    slide.addText("Hours Actual", { x: 0.3, y: rowY2, w: 1.3, h: 0.3, fontSize: 8, color: virgilTheme.subtle, align: "right" });
    let xStart = 1.7;
    const barW = 10.8;
    fundingOrder.forEach(f => {
      const seg = data.byFunding[f];
      const pctW = seg.plan > 0 ? (seg.plan / totalPlan) * barW : 0;
      const actW = totalActual > 0 ? (seg.actual / totalActual) * barW : 0;
      if (pctW > 0) {
        slide.addShape("rect", { x: xStart, y: rowY1, w: pctW, h: 0.4, fill: { color: fundingColors[f] }, line: { type: "none" } });
        const pctVal = seg.plan > 0 ? (seg.actual / seg.plan) * 100 : 0;
        slide.addText(`${pctVal.toFixed(0)}%`, { x: xStart, y: rowY1 + 0.05, w: pctW, h: 0.3, fontSize: 9, color: "FFFFFF", bold: true, align: "center" });
      }
      if (actW > 0) {
        slide.addShape("rect", { x: xStart, y: rowY2, w: actW, h: 0.4, fill: { color: fundingColors[f] }, line: { type: "none" } });
        slide.addText(Math.round(seg.actual).toLocaleString(), { x: xStart, y: rowY2 + 0.05, w: actW, h: 0.3, fontSize: 9, color: "FFFFFF", bold: true, align: "center" });
      }
      xStart += Math.max(pctW, actW);
    });
  };

  drawBarGroup(1.25, priorKey, prior);
  drawBarGroup(2.65, reportingMonthLabel, curr);
  drawBarGroup(4.05, `${mtdLabel} MTD`, mtd);

  // Bottom half: Campaign Outlook (Growth) | Base Management (HQ, Marketing, National)
  const breakoutY = 5.5;
  slide.addText("March Campaign Outlook", { x: 0.5, y: breakoutY, w: 3.0, h: 0.25, fontSize: 11, color: virgilTheme.eyebrow, bold: true });
  slide.addText("Base Management", { x: 4.0, y: breakoutY, w: 9.0, h: 0.25, fontSize: 11, color: virgilTheme.eyebrow, bold: true });

  const drawFundingCol = (x, w, funding, allCampaigns) => {
    const rows = allCampaigns.filter(c => c.funding === funding).sort((a, b) => b.hoursActual - a.hoursActual);
    slide.addShape("rect", { x, y: breakoutY + 0.3, w, h: 0.35, fill: { color: fundingColors[funding] }, line: { type: "none" } });
    slide.addText(`${funding} Funded`, { x, y: breakoutY + 0.3, w, h: 0.35, fontSize: 11, color: "FFFFFF", bold: true, align: "center" });
    const items = rows.slice(0, 5).map(r => `${r.name} — ${Math.round(r.hoursActual).toLocaleString()} hours`);
    slide.addText(items.length ? items.join("\n") : "(none)", {
      x, y: breakoutY + 0.7, w, h: 1.2,
      fontSize: 9, color: virgilTheme.bodyText, valign: "top",
    });
  };
  drawFundingCol(0.5, 3.0, "Growth", curr.campaigns);
  drawFundingCol(4.0, 2.9, "HQ", curr.campaigns);
  drawFundingCol(7.0, 2.9, "Marketing", curr.campaigns);
  drawFundingCol(10.0, 2.8, "National", curr.campaigns);
}
```

- [ ] **Step 10.2: Verify build**

Run: `npx vite build 2>&1 | tail -5`

- [ ] **Step 10.3: Commit**

```bash
git add src/app.jsx && git commit -m "feat(corp-mbr): add Slide 5 (Campaign Hours Info) builder"
```

---

## Task 11: Wire new slides into orchestrator

**Files:**
- Modify: `src/app.jsx` — `buildVirgilMbrPresentation` (grep `^function buildVirgilMbrPresentation`)

- [ ] **Step 11.1: Update function signature + calls**

Add options: `agentRaw`, `goalsRaw`, `priorAgentRaw`, `priorGoalsRaw`, `newHiresRaw`, `priorQuarterAgentRaw`, `priorQuarterGoalsRaw`, `scorecardDataUrl`.

Example orchestrator shape:

```jsx
function buildVirgilMbrPresentation(perf, options) {
  const pres = new pptxgen();
  pres.layout = "LAYOUT_WIDE";

  // Slide 1
  buildVirgilTitleSlide(pres, options.reportingMonthLabel, perf && perf.fiscalInfo, "");
  // Slide 2
  const stats = buildCoachingStats(options.coachingDetails || {}, options.coachingWeekly || [], perf && perf.bpLookup, options.reportingMonthLabel);
  const priorKey = getPriorMonthLabel(options.reportingMonthLabel);
  const priorPriorKey = getPriorMonthLabel(priorKey);
  buildVirgilMyPerformanceSlide(pres, stats, options.loginBuckets || {}, priorPriorKey, priorKey, options.reportingMonthLabel, (options.insights && options.insights.slide2) || "");

  // Slide 3
  buildCorpOpPerformanceSlide(pres,
    options.agentRaw || "", options.goalsRaw || "",
    options.priorAgentRaw || "", options.priorGoalsRaw || "",
    options.priorQuarterAgentRaw || "", options.priorQuarterGoalsRaw || "",
    options.reportingMonthLabel, options.scorecardDataUrl || "");

  // Slide 4
  buildCorpQuartileSlide(pres,
    options.agentRaw || "", options.goalsRaw || "",
    options.newHiresRaw || "", options.reportingMonthLabel);

  // Slide 5
  buildCorpCampaignHoursSlide(pres,
    options.agentRaw || "", options.goalsRaw || "",
    options.priorAgentRaw || "", options.priorGoalsRaw || "",
    options.reportingMonthLabel);

  return pres;
}
```

- [ ] **Step 11.2: Update modal `handleDownload` to pass new options**

In `VirgilMbrExportModal`'s `handleDownload`, source the new fields from the `perf` object (agentRaw is `perf.rawText` if that's named that way in the app) or from App-level raw state. Inspect the existing props to determine how to access these:

```jsx
const pres = buildVirgilMbrPresentation(perf, {
  reportingMonthLabel: reportingMonth,
  coachingDetails, coachingWeekly, loginBuckets,
  agentRaw: rawAgentCsv,
  goalsRaw: rawGoalsCsv,
  priorAgentRaw: rawPriorAgentCsv,
  priorGoalsRaw: rawPriorGoalsCsv,
  newHiresRaw: rawNewHiresCsv,
  priorQuarterAgentRaw: rawPriorQuarterAgentCsv,
  priorQuarterGoalsRaw: rawPriorQuarterGoalsCsv,
  scorecardDataUrl,
  insights: { ...(insights || {}), slide2: slide2Insights },
});
```

To get these raw CSV strings into the modal, extend `VirgilMbrExportModal`'s props in the modal mount at App level (grep `<VirgilMbrExportModal`):

```jsx
<VirgilMbrExportModal
  ...
  rawAgentCsv={rawData ? (/* find the raw text for the agent CSV */ "") : ""}
  rawGoalsCsv={goalsRaw || ""}
  rawPriorAgentCsv={priorMonthRaw || ""}
  rawPriorGoalsCsv={priorMonthGoalsRaw || ""}
  rawNewHiresCsv={newHiresRaw || ""}
  rawPriorQuarterAgentCsv={priorQuarterAgentRaw || ""}
  rawPriorQuarterGoalsCsv={priorQuarterGoalsRaw || ""}
/>
```

**CRITICAL:** The app stores agent data as parsed rows in `rawData`, not as a raw CSV string. You need to find the raw CSV source. Grep for `setRawData\|rawDataCsv\|rawCsv` to locate the original text. If the app only keeps parsed rows, ADD a new state slot `rawAgentCsv` that's set alongside `rawData` wherever the CSV is first parsed. Search for `setRawData` and tee the input text into a parallel `setRawAgentCsv` in the same handler.

- [ ] **Step 11.3: Verify build**

Run: `npx vite build 2>&1 | tail -5`

- [ ] **Step 11.4: Commit**

```bash
git add src/app.jsx && git commit -m "feat(corp-mbr): wire Slides 3-5 into orchestrator + modal data passthrough"
```

---

## Task 12: Data Readiness status rows for new inputs

**Files:**
- Modify: `src/app.jsx` — `VirgilMbrExportModal` Data Readiness block

- [ ] **Step 12.1: Add new status rows**

In the Data Readiness block, add three new `<StatusRow />` entries:

```jsx
<StatusRow label="Prior Quarter Agent (Q4 2025)" ok={!!(rawPriorQuarterAgentCsv && rawPriorQuarterAgentCsv.trim())} />
<StatusRow label="Prior Quarter Goals (Q4 2025)" ok={!!(rawPriorQuarterGoalsCsv && rawPriorQuarterGoalsCsv.trim())} />
<StatusRow label="Scorecard PNG (Slide 3)" ok={!!scorecardDataUrl} />
```

- [ ] **Step 12.2: Verify build**

Run: `npx vite build 2>&1 | tail -5`

- [ ] **Step 12.3: Commit**

```bash
git add src/app.jsx && git commit -m "feat(corp-mbr): show Q4 + scorecard readiness in export modal"
```

---

## Task 13: End-to-end manual verification

No code change — exercise the full Phase 2 flow.

- [ ] **Step 13.1: Start dev server**

```bash
cd "/c/Users/Joshu/Documents/Claude/Performance Intel" && npx vite --host
```

- [ ] **Step 13.2: Configure data URLs**

In ⚙ → **Corp MBR Data Sources**, paste:
- Prior Quarter Agent Data URL
- Prior Quarter Goals URL
- (Feb data via ⚙ → Settings → Data sources)

- [ ] **Step 13.3: Upload a Scorecard PNG**

⚙ → **Export Corp MBR** → click Upload PNG → pick any screenshot. Verify "Loaded" shows next to the label.

- [ ] **Step 13.4: Download and inspect**

Click **Download .pptx**. Open in PowerPoint.
Verify:
- Slide 1: title slide unchanged
- Slide 2: Quality and Coaching unchanged
- Slide 3: 4-column comparison table (Q4/Feb/Mar/Apr MTD) + scorecard PNG embedded below
- Slide 4: Quartile Reporting with Month Reporting On / MTD columns, each with XM + XI subsections
- Slide 5: three stacked hours bar groups (Feb/Mar/Apr MTD) + Campaign Outlook/Base Management breakout

- [ ] **Step 13.5: Test with missing Q4**

Clear Q4 URLs in the Corp MBR Data Sources modal. Re-download. Verify Slide 3's Q4 column shows `—` values without crashing.

- [ ] **Step 13.6: Production build**

```bash
npx vite build 2>&1 | tail -5
```

Expected: clean build.

- [ ] **Step 13.7: Commit any fixes**

If Steps 13.1–13.6 surfaced issues, fix them and commit:
```bash
git add src/app.jsx && git commit -m "fix(corp-mbr): Phase 2 verification fixes"
```

If no fixes needed, skip.

---

## Task 14: Update training doc

**Files:**
- Modify: `performance-intel-training.md` (gitignored — local only)

- [ ] **Step 14.1: Extend the Section 18 (Virgil MBR) subheader with Phase 2 content**

Append under the existing Slide 2 entry:

```markdown
### Phase 2 Coverage
- Slide 3: Operational Performance — 4-column attainment comparison (Q4 / Prior Month / Reporting / MTD) + Scorecard PNG
- Slide 4: Quartile Reporting — GLU/GLN split, equal-quartile-by-%-to-goal, tenure matrix with participation %
- Slide 5: Campaign Hours Info — 3-month horizontal bar groups by funding + Campaign Outlook/Base Management breakout

### New Phase 2 Data Sources
| Source | localStorage key | Upload row label |
|---|---|---|
| Prior Quarter Agent stats | `perf_intel_prior_quarter_agent_v1` | (URL input — Corp MBR Data Sources) |
| Prior Quarter Goals | `perf_intel_prior_quarter_goals_v1` | (URL input — Corp MBR Data Sources) |
| Scorecard PNG | (in-memory only, not persisted) | Export modal Upload button |

### New Phase 2 Helpers
- `computeCorpAttainment`, `makeMonthFilter`, `makeQuarterFilter`, `getNextMonthLabel`, `endOfMonthDate`
- `buildQuartileReport(agentRaw, goalsRaw, newHiresRaw, dateFilter, referenceDate)`
- `buildCampaignHoursByFunding(agentRaw, goalsRaw, monthFilter)`
- `buildCorpOpPerformanceSlide`, `buildCorpQuartileSlide`, `buildCorpCampaignHoursSlide`
```

- [ ] **Step 14.2: Note the doc is gitignored — no commit needed**

The doc update is local-only. Skip git add/commit.

---

## Task 15: Deploy to GitHub Pages

- [ ] **Step 15.1: Push main**

```bash
cd "/c/Users/Joshu/Documents/Claude/Performance Intel" && git push origin main
```

- [ ] **Step 15.2: Deploy**

```bash
cd "/c/Users/Joshu/Documents/Claude/Performance Intel" && npx vite build && npx gh-pages -d dist -m "Deploy: Corp MBR Phase 2"
```

- [ ] **Step 15.3: Verify production**

Open `https://joshuaedgecomb-dev.github.io/performance-intel/`. Click ⚙ → Export Corp MBR. Download and confirm Slides 3, 4, 5 all render.

---

## Done — Phase 2 Exit Criteria

- [ ] Existing Phase 1 flow (Slides 1, 2) unchanged
- [ ] ⚙ → Corp MBR Data Sources shows 5 URL fields (3 original + 2 Q4)
- [ ] ⚙ → Export Corp MBR modal has scorecard upload
- [ ] Data Readiness shows 6 status rows (3 Corp CSVs + 2 Q4 + 1 Scorecard)
- [ ] Slide 3 renders the 4-period table, with `—` fallback when Q4 data missing
- [ ] Slide 3 scorecard region shows uploaded PNG or empty-placeholder label
- [ ] Slide 4 renders 2 columns × 2 sub-sections (XM/XI) × (Quartile summary + Tenure matrix)
- [ ] Slide 4 ALWAYS renders MTD (no toggle — per spec)
- [ ] Slide 5 renders 3 stacked hours bar groups + 4-column funding breakout
- [ ] Training doc locally updated
- [ ] Deployed to GitHub Pages

## Next Phase

Once Phase 2 ships, invoke `superpowers:writing-plans` again for **Phase 3 — Slide 6 (per-campaign N detail slides)**. Phase 3 requires Extended Agent Stats upload (richer CSV with Dials/Contacts/Finals columns).
