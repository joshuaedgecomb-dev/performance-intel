# tNPS Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add tNPS survey data to the Performance Intel dashboard — auto-fetched from Google Sheets, with an Overview summary row, a dedicated deep-dive slide with 4 sub-tabs, and agent-level tNPS enrichment on existing views.

**Architecture:** All changes are in the monolithic `src/app.jsx`. tNPS CSV is auto-fetched alongside existing data sources (agents, goals, roster). A new `parseTnps()` function normalizes raw CSV rows. A new `buildBpLookup()` function creates a BP→agent-info map from the roster. A new `TNPSSlide` component renders the deep-dive with 4 sub-tabs. The slide is inserted between Overview (slide 0) and program slides (slide 1+) by shifting the slide index math by 1.

**Tech Stack:** React (inline in monolithic JSX), CSS variables for theming, SVG/CSS bar charts (no external chart library), published Google Sheets CSV auto-fetch

**Spec:** `docs/superpowers/specs/2026-04-04-tnps-integration-design.md`

---

## File Structure

All changes in a single file, following the existing monolithic pattern:

- **Modify:** `src/app.jsx`
  - Section 1 (constants, ~line 455): Add `DEFAULT_TNPS_SHEET_URL`, `TNPS_STORAGE_KEY`
  - Section 2 (data normalization, ~line 604): Add `buildBpLookup()` and `parseTnps()` functions
  - Section 8 (performance engine, ~line 1979): Add `tnpsData` and `bpLookup` to `usePerformanceEngine`
  - Section 9 (UI components, ~line 2085): Add `TNPSSlide` component with 4 sub-tabs
  - Section 12 (BusinessOverview, ~line 5572): Add tNPS KPI row after Program Scorecard
  - Section 14 (App, ~line 12157): Add `tnpsRaw` state, auto-fetch, slide index shift

---

## Phase 1 — Data Layer + Overview + Summary Tab

### Task 1: Constants, URL, and State Wiring

**Files:**
- Modify: `src/app.jsx:455-461` (constants)
- Modify: `src/app.jsx:12157-12220` (App state)
- Modify: `src/app.jsx:12316-12349` (auto-fetch)

- [ ] **Step 1: Add tNPS constants after existing URL constants (~line 461)**

```javascript
const DEFAULT_TNPS_SHEET_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vRagC_XDSQ84y25onmWs6MUOZcEdWZNA6fVRRDFUzNWQp3ginYLtOIQsSrwmbAERkOJ-daTvbHqEtoy/pub?gid=2128252142&single=true&output=csv";
const TNPS_STORAGE_KEY = "perf_intel_tnps_v1";
```

- [ ] **Step 2: Add tnpsRaw state in App (after priorMonthGoalsRaw state, ~line 12248)**

Follow the exact same pattern as `goalsRaw` and `newHiresRaw` — useState with localStorage init, and a setter that persists:

```javascript
// tNPS survey data — persisted to localStorage
const [tnpsRaw, _setTnpsRaw] = useState(() => {
  try { const s = localStorage.getItem(TNPS_STORAGE_KEY); return s ? JSON.parse(s) : null; }
  catch(e) { return null; }
});
const setTnpsRaw = useCallback(data => {
  _setTnpsRaw(data);
  try {
    if (data) localStorage.setItem(TNPS_STORAGE_KEY, JSON.stringify(data));
    else localStorage.removeItem(TNPS_STORAGE_KEY);
  } catch(e) {}
}, []);
```

- [ ] **Step 3: Add tnpsSheetUrl derivation (after priorGoalsSheetUrl, ~line 12204)**

```javascript
const tnpsSheetUrl = sheetUrls.tnps || DEFAULT_TNPS_SHEET_URL;
```

- [ ] **Step 4: Add tNPS auto-fetch inside the existing auto-load useEffect (~line 12348, after the roster fetch block)**

Insert after the `nhSheetUrl` fetch block (before the `} catch (e) {` on line 12350):

```javascript
// Auto-load tNPS sheet if URL configured
if (!cancelled && tnpsSheetUrl && !tnpsRaw) {
  try {
    const proxyT = url => `https://corsproxy.io/?${encodeURIComponent(url)}`;
    let tRes;
    try { tRes = await fetch(tnpsSheetUrl); } catch(e) { tRes = null; }
    if (!tRes || !tRes.ok) tRes = await fetch(proxyT(tnpsSheetUrl));
    if (tRes.ok) { const tRows = parseCSV(await tRes.text()); if (tRows.length > 0) setTnpsRaw(tRows); }
  } catch(e) {}
}
```

- [ ] **Step 5: Pass tnpsRaw to usePerformanceEngine (~line 12264)**

Change:
```javascript
const perf = usePerformanceEngine({ rawData, goalsRaw, newHiresRaw });
```
To:
```javascript
const perf = usePerformanceEngine({ rawData, goalsRaw, newHiresRaw, tnpsRaw });
```

- [ ] **Step 6: Test — verify app still loads, no console errors**

Run: Open the app in the browser. Check that existing data still loads. Check the Network tab for a request to the tNPS sheet URL (gid=2128252142). The raw response should have ~3,656 rows.

- [ ] **Step 7: Commit**

```bash
git add src/app.jsx
git commit -m "feat(tnps): add tNPS constants, state, and auto-fetch wiring"
```

---

### Task 2: buildBpLookup() and parseTnps() Functions

**Files:**
- Modify: `src/app.jsx:604-638` (after parseNewHires, before uniqueQuartileDist)

- [ ] **Step 1: Add buildBpLookup() function after parseNewHires (~line 638)**

This creates a map from `BP` → agent info using the existing roster rows (`newHiresRaw`). The roster is already fetched — we just need to extract more fields.

```javascript
// ── BP→Agent Lookup from roster ───────────────────────────────────────────────
function buildBpLookup(rosterRows = []) {
  const map = {};
  for (const row of rosterRows) {
    const bp = (row["BP"] || "").trim().toLowerCase();
    if (!bp) continue;
    const first = (row["First Name"] || row["First"] || "").trim();
    const last  = (row["Last Name"]  || row["Last"]  || "").trim();
    const name  = [first, last].filter(Boolean).join(" ");
    if (!name) continue;
    const endDate = (row["End Date"] || row["EndDate"] || "").trim();
    if (endDate) continue; // skip inactive
    map[bp] = {
      name,
      firstName: first,
      lastName: last,
      supervisor: (row["Supervisor Name"] || row["Supervisor"] || "").trim(),
      region: (row["Region"] || "").trim(),
      hireDate: (row["Hire Date"] || row["StartDate"] || "").trim(),
      role: (row["Role"] || "").trim(),
    };
  }
  return map;
}
```

- [ ] **Step 2: Add tNPS site mapping and campaign mapping constants**

Place these right after `buildBpLookup`:

```javascript
// ── tNPS Site Mapping ─────────────────────────────────────────────────────────
const TNPS_SITE_MAP = {
  "Global Callcenter Solutions Belize": "Belize City",
  "Global Callcenter Solutions Ignaco": "San Ignacio",
  "Global Callcenter Solutions Santo Domingo": "Dom. Republic",
};
const TNPS_PARTNER_MAP = {
  "Avantive Solutions Guadalajara": "Avantive",
  "Avantive Solutions Mexico City": "Avantive",
  "Global Telesourcing Monterrey": "Global Telesourcing",
  "iGuard Global Telesourcing Monterrey": "Global Telesourcing",
  "Results Alaskaland": "Results",
  "Results Alaskaland Trial": "Results",
  "Results Alaskaland Telesales": "Results",
};
function tnpsSiteLabel(rawSite) {
  return TNPS_SITE_MAP[rawSite] || TNPS_PARTNER_MAP[rawSite] || rawSite;
}
function tnpsIsGCS(rawSite) {
  return !!TNPS_SITE_MAP[rawSite];
}

// ── tNPS Campaign → Program mapping ──────────────────────────────────────────
const TNPS_CAMPAIGN_PROGRAM = {
  "Add XM": "XM",
  "Add XMC": "XMC",
  "Non Subs": "Nonsub",
};
function tnpsCampaignLabel(raw) {
  return (raw || "").trim() || "Untagged";
}
function tnpsCampaignProgram(raw) {
  return TNPS_CAMPAIGN_PROGRAM[(raw || "").trim()] || null;
}
```

- [ ] **Step 3: Add parseTnps() function**

```javascript
// ── tNPS Survey Parser ────────────────────────────────────────────────────────
function parseTnps(rows = [], bpLookup = {}) {
  return rows.map(row => {
    const score = parseFloat(row["SMS tNPS"]);
    if (isNaN(score)) return null;

    const rawSite    = (row["Site"] || "").trim();
    const rawCampaign = (row["Telesales Campaign"] || "").trim();
    const ntid       = (row["Employee NTID"] || "").trim().toLowerCase();
    const dateStr    = (row["Transaction Date"] || "").trim();

    // Parse date — format: "3/20/2026 14:34"
    const dateParsed = dateStr ? new Date(dateStr) : null;
    const month      = dateParsed && !isNaN(dateParsed) ? `${dateParsed.getFullYear()}-${String(dateParsed.getMonth() + 1).padStart(2, "0")}` : null;
    const monthLabel = dateParsed && !isNaN(dateParsed) ? dateParsed.toLocaleString("en-US", { month: "short", year: "numeric" }) : "Unknown";

    // Classification
    const category = score >= 9 ? "promoter" : score >= 7 ? "passive" : "detractor";
    const isGCS    = tnpsIsGCS(rawSite);
    const siteLabel = tnpsSiteLabel(rawSite);

    // Agent lookup
    const agent = bpLookup[ntid] || null;

    return {
      score,
      category,
      rawSite,
      siteLabel,
      isGCS,
      campaign: tnpsCampaignLabel(rawCampaign),
      program: tnpsCampaignProgram(rawCampaign),
      ntid,
      agentName: agent ? agent.name : ntid || "Unknown",
      supervisor: agent ? agent.supervisor : "",
      region: agent ? agent.region : "",
      date: dateParsed,
      dateStr,
      month,
      monthLabel,
      reason: (row["Reason for score"] || "").trim(),
      repSat: parseFloat(row["Rep Sat"]) || null,
      topics: (row["Topics Tagged Original"] || "").trim(),
      alertType: (row["Alert type"] || "").trim(),
      alertStatus: (row["Alert Status"] || row["Alert Closure Status"] || "").trim(),
    };
  }).filter(Boolean);
}
```

- [ ] **Step 4: Add tNPS computation helper**

```javascript
// ── tNPS Score Calculator ─────────────────────────────────────────────────────
function calcTnpsScore(surveys) {
  if (!surveys || surveys.length === 0) return { score: null, promoters: 0, passives: 0, detractors: 0, total: 0, promoterPct: 0, passivePct: 0, detractorPct: 0 };
  const promoters  = surveys.filter(s => s.category === "promoter").length;
  const passives   = surveys.filter(s => s.category === "passive").length;
  const detractors = surveys.filter(s => s.category === "detractor").length;
  const total = surveys.length;
  const promoterPct  = (promoters / total) * 100;
  const passivePct   = (passives / total) * 100;
  const detractorPct = (detractors / total) * 100;
  return {
    score: Math.round(promoterPct - detractorPct),
    promoters, passives, detractors, total,
    promoterPct, passivePct, detractorPct,
  };
}

function tnpsColor(score) {
  if (score === null) return "var(--text-dim)";
  if (score >= 50) return "#16a34a";
  if (score >= 20) return "#d97706";
  return "#dc2626";
}
```

- [ ] **Step 5: Test — verify these are pure functions with no side effects**

Temporarily add at the end of `parseTnps`:
```javascript
// Quick sanity check in console (remove after verification):
// console.log("parseTnps test:", parseTnps([{ "SMS tNPS": "10", "Site": "Global Callcenter Solutions Belize", "Telesales Campaign": "Add XM", "Employee NTID": "bp-test", "Transaction Date": "3/20/2026 14:34", "Reason for score": "Great service" }], {}));
```

Open app → DevTools Console. Verify the output has: `score: 10, category: "promoter", siteLabel: "Belize City", isGCS: true, campaign: "Add XM", program: "XM"`. Then remove the console.log.

- [ ] **Step 6: Commit**

```bash
git add src/app.jsx
git commit -m "feat(tnps): add buildBpLookup, parseTnps, and tNPS scoring helpers"
```

---

### Task 3: Wire tNPS Into Performance Engine

**Files:**
- Modify: `src/app.jsx:1979-2081` (usePerformanceEngine)

- [ ] **Step 1: Add tnpsRaw to the hook parameters (~line 1979)**

Change:
```javascript
function usePerformanceEngine({ rawData, goalsRaw, newHiresRaw }) {
```
To:
```javascript
function usePerformanceEngine({ rawData, goalsRaw, newHiresRaw, tnpsRaw }) {
```

- [ ] **Step 2: Add bpLookup and tnpsData memos (after the newHireSet memo, ~line 1994)**

```javascript
  const bpLookup = useMemo(() =>
    buildBpLookup(newHiresRaw || []),
    [newHiresRaw]);

  const tnpsData = useMemo(() =>
    parseTnps(tnpsRaw || [], bpLookup),
    [tnpsRaw, bpLookup]);
```

- [ ] **Step 3: Add computed tNPS aggregates (after tnpsData)**

```javascript
  // tNPS aggregates for GCS only
  const tnpsGCS = useMemo(() => tnpsData.filter(s => s.isGCS), [tnpsData]);
  const tnpsOverall = useMemo(() => calcTnpsScore(tnpsGCS), [tnpsGCS]);

  // tNPS by site (GCS sites + partner companies)
  const tnpsBySite = useMemo(() => {
    const groups = {};
    tnpsData.forEach(s => {
      if (!groups[s.siteLabel]) groups[s.siteLabel] = [];
      groups[s.siteLabel].push(s);
    });
    return Object.entries(groups).map(([label, surveys]) => ({
      label,
      isGCS: surveys[0].isGCS,
      ...calcTnpsScore(surveys),
    })).sort((a, b) => (b.score ?? -999) - (a.score ?? -999));
  }, [tnpsData]);

  // tNPS by month (GCS only, for trending)
  const tnpsByMonth = useMemo(() => {
    const groups = {};
    tnpsGCS.forEach(s => {
      if (!s.month) return;
      if (!groups[s.month]) groups[s.month] = { month: s.month, label: s.monthLabel, surveys: [] };
      groups[s.month].surveys.push(s);
    });
    return Object.values(groups)
      .sort((a, b) => a.month.localeCompare(b.month))
      .map(g => ({ ...g, ...calcTnpsScore(g.surveys) }));
  }, [tnpsGCS]);
```

- [ ] **Step 4: Add tnps fields to the return object (~line 2054)**

Add these fields to the return object alongside existing fields:

```javascript
    tnpsData,
    tnpsGCS,
    tnpsOverall,
    tnpsBySite,
    tnpsByMonth,
    bpLookup,
```

- [ ] **Step 5: Test — verify tNPS data loads**

Open app → DevTools Console. Type:
```javascript
// Check tnpsData is populated (should be ~3656 items)
// Check tnpsGCS is ~400 items
// Check tnpsOverall.score is around +40
```

Look at the Network tab — the tNPS CSV request should complete successfully. No console errors.

- [ ] **Step 6: Commit**

```bash
git add src/app.jsx
git commit -m "feat(tnps): wire tNPS data into performance engine with aggregates"
```

---

### Task 4: Overview tNPS KPI Row

**Files:**
- Modify: `src/app.jsx:5572-5582` (BusinessOverview destructuring)
- Modify: `src/app.jsx:6156-6158` (insert after Program Scorecard, before Wins)

- [ ] **Step 1: Destructure tNPS data in BusinessOverview (~line 5576)**

Add to the destructuring from `perf`:

```javascript
    tnpsOverall, tnpsBySite, tnpsByMonth, tnpsGCS,
```

- [ ] **Step 2: Add tNPS KPI row between the scorecard closing and the Wins section**

Insert this block after line 6156 (the `})()}` that closes the Program Scorecard IIFE) and before line 6158 (`{/* Wins + Opportunities */}`):

```javascript
        {/* tNPS Summary Row — only renders when tNPS data is loaded */}
        {tnpsOverall && tnpsOverall.total > 0 && (() => {
          const gcsScore = tnpsOverall;
          const partnerSurveys = tnpsBySite.filter(s => !s.isGCS);
          const partnerAvg = partnerSurveys.length > 0
            ? Math.round(partnerSurveys.reduce((s, p) => s + (p.score || 0), 0) / partnerSurveys.length)
            : null;
          // MoM delta: compare last two months
          const momDelta = tnpsByMonth.length >= 2
            ? tnpsByMonth[tnpsByMonth.length - 1].score - tnpsByMonth[tnpsByMonth.length - 2].score
            : null;

          return (
            <div
              onClick={() => onNav(1)}
              style={{ background: `var(--bg-secondary)`, border: "1px solid var(--border)", borderRadius: "var(--radius-lg, 16px)", padding: "1rem 1.5rem", cursor: "pointer", transition: "all 200ms", marginTop: "0.75rem" }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = "#d97706"; e.currentTarget.style.boxShadow = "0 0 12px #d9770620"; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = "var(--border)"; e.currentTarget.style.boxShadow = "none"; }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.5rem" }}>
                <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.72rem", letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--text-muted)" }}>
                  Customer Experience — tNPS
                </div>
                <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.72rem", color: "var(--text-faint)" }}>
                  Click to view details →
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "auto 1fr auto auto auto", gap: "1.5rem", alignItems: "center" }}>
                {/* Overall tNPS */}
                <div style={{ textAlign: "center" }}>
                  <div style={{ fontFamily: "var(--font-display, Inter, sans-serif)", fontSize: "2.5rem", fontWeight: 800, color: tnpsColor(gcsScore.score) }}>
                    {gcsScore.score > 0 ? "+" : ""}{gcsScore.score}
                  </div>
                  <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.7rem", color: "var(--text-dim)" }}>
                    GCS tNPS · {gcsScore.total} surveys
                  </div>
                </div>

                {/* Promoter / Passive / Detractor bar */}
                <div>
                  <div style={{ display: "flex", height: 14, borderRadius: 7, overflow: "hidden", gap: 1 }}>
                    <div style={{ flex: gcsScore.promoterPct, background: "#16a34a", minWidth: gcsScore.promoterPct > 0 ? 4 : 0 }} />
                    <div style={{ flex: gcsScore.passivePct, background: "#d97706", minWidth: gcsScore.passivePct > 0 ? 4 : 0 }} />
                    <div style={{ flex: gcsScore.detractorPct, background: "#dc2626", minWidth: gcsScore.detractorPct > 0 ? 4 : 0 }} />
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
                    <span style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.7rem", color: "#16a34a" }}>{Math.round(gcsScore.promoterPct)}% Promoter</span>
                    <span style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.7rem", color: "#d97706" }}>{Math.round(gcsScore.passivePct)}% Passive</span>
                    <span style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.7rem", color: "#dc2626" }}>{Math.round(gcsScore.detractorPct)}% Detractor</span>
                  </div>
                </div>

                {/* vs Partners */}
                {partnerAvg !== null && (
                  <div style={{ textAlign: "center" }}>
                    <div style={{ fontFamily: "var(--font-data, monospace)", fontSize: "1.1rem", fontWeight: 700, color: gcsScore.score >= partnerAvg ? "#16a34a" : "#dc2626" }}>
                      {gcsScore.score >= partnerAvg ? "+" : ""}{gcsScore.score - partnerAvg}
                    </div>
                    <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.65rem", color: "var(--text-dim)" }}>vs Partners</div>
                  </div>
                )}

                {/* MoM Delta */}
                {momDelta !== null && (
                  <div style={{ textAlign: "center" }}>
                    <div style={{ fontFamily: "var(--font-data, monospace)", fontSize: "1.1rem", fontWeight: 700, color: momDelta >= 0 ? "#16a34a" : "#dc2626" }}>
                      {momDelta >= 0 ? "▲" : "▼"} {Math.abs(momDelta)}
                    </div>
                    <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.65rem", color: "var(--text-dim)" }}>MoM</div>
                  </div>
                )}

                {/* Monthly sparkline */}
                {tnpsByMonth.length > 1 && (
                  <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height: 36 }}>
                    {tnpsByMonth.map((m, i) => {
                      const maxScore = Math.max(...tnpsByMonth.map(x => Math.abs(x.score || 0)), 1);
                      const h = Math.max(4, (Math.abs(m.score || 0) / maxScore) * 32);
                      return (
                        <div key={i} style={{ width: 12, height: h, borderRadius: 3, background: tnpsColor(m.score) + "cc" }} title={`${m.label}: ${m.score > 0 ? "+" : ""}${m.score} (${m.total} surveys)`} />
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          );
        })()}
```

**Important:** The `onNav(1)` call here navigates one slide forward. After Task 6, the tNPS slide will be at index 1 (right after Overview), so this click will go to it. But during this task, before slide index shifting is done, clicking will go to the first program slide. That's fine — we'll fix the navigation target in Task 6.

- [ ] **Step 3: Test — verify tNPS KPI row renders on Overview**

Open the app. On the Overview tab, scroll past the Program Scorecard. You should see a new tNPS row with the headline score, P/P/D bar, partner comparison, MoM delta, and monthly sparkline. Verify colors: green if ≥50, amber if 20-49, red if <20.

- [ ] **Step 4: Commit**

```bash
git add src/app.jsx
git commit -m "feat(tnps): add tNPS KPI summary row to Overview tab"
```

---

### Task 5: TNPSSlide Component — Summary Tab

**Files:**
- Modify: `src/app.jsx` — Add new component before BusinessOverview (~line 5568)

- [ ] **Step 1: Add the TNPSSlide component**

Insert before the `// SECTION 12 — BUSINESS OVERVIEW` comment (~line 5568):

```javascript
// ══════════════════════════════════════════════════════════════════════════════
// SECTION 11b — tNPS DEEP-DIVE SLIDE  (pages/TNPSSlide.jsx)
// Full tNPS analysis with 4 sub-tabs: Summary, By Campaign, By Supervisor, Customer Voices
// ══════════════════════════════════════════════════════════════════════════════

function TNPSSlide({ perf, onNav, lightMode }) {
  const [tab, setTab] = useState("summary");
  const { tnpsData, tnpsGCS, tnpsOverall, tnpsBySite, tnpsByMonth, bpLookup } = perf;

  if (!tnpsData || tnpsData.length === 0) {
    return (
      <div style={{ minHeight: "90vh", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-faint)", fontFamily: "var(--font-ui, Inter, sans-serif)" }}>
        No tNPS data loaded.
      </div>
    );
  }

  const tabs = [
    { key: "summary", label: "Summary" },
    { key: "campaign", label: "By Campaign" },
    { key: "supervisor", label: "By Supervisor" },
    { key: "voices", label: "Customer Voices" },
  ];

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: "0 2.5rem 2rem" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.75rem" }}>
        <div>
          <div style={{ fontFamily: "var(--font-display, Inter, sans-serif)", fontSize: "1.5rem", fontWeight: 700, color: "var(--text-warm)" }}>Customer Experience — tNPS</div>
          <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.78rem", color: "var(--text-dim)" }}>{tnpsData.length} total surveys · {tnpsGCS.length} GCS surveys</div>
        </div>
      </div>

      {/* Sub-tab navigation */}
      <div style={{ display: "flex", gap: "0.35rem", marginBottom: "1.25rem", borderBottom: "1px solid var(--border)" }}>
        {tabs.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            style={{ padding: "0.55rem 1rem", border: "none", borderBottom: tab === t.key ? "2px solid #d97706" : "2px solid transparent", background: "transparent", color: tab === t.key ? "var(--text-warm)" : "var(--text-dim)", fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.82rem", fontWeight: tab === t.key ? 600 : 400, cursor: "pointer", transition: "all 150ms" }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ── SUMMARY TAB ── */}
      {tab === "summary" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>

          {/* KPI Cards */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "0.75rem" }}>
            {[
              { label: "GCS tNPS Score", value: `${tnpsOverall.score > 0 ? "+" : ""}${tnpsOverall.score}`, accent: tnpsColor(tnpsOverall.score), sub: `${tnpsOverall.total} surveys` },
              { label: "Promoters", value: `${Math.round(tnpsOverall.promoterPct)}%`, accent: "#16a34a", sub: `${tnpsOverall.promoters} surveys` },
              { label: "Passives", value: `${Math.round(tnpsOverall.passivePct)}%`, accent: "#d97706", sub: `${tnpsOverall.passives} surveys` },
              { label: "Detractors", value: `${Math.round(tnpsOverall.detractorPct)}%`, accent: "#dc2626", sub: `${tnpsOverall.detractors} surveys` },
            ].map((c, i) => (
              <div key={i} style={{ background: "var(--glass-bg)", border: `1px solid ${c.accent}18`, borderTop: `3px solid ${c.accent}`, borderRadius: "var(--radius-md, 10px)", padding: "1rem" }}>
                <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.7rem", color: "var(--text-muted)", letterSpacing: "0.06em", textTransform: "uppercase" }}>{c.label}</div>
                <div style={{ fontFamily: "var(--font-display, Inter, sans-serif)", fontSize: "2.25rem", color: c.accent, fontWeight: 800 }}>{c.value}</div>
                <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.72rem", color: "var(--text-dim)" }}>{c.sub}</div>
              </div>
            ))}
          </div>

          {/* GCS Site Comparison — bar chart */}
          <div style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg, 16px)", padding: "1.25rem 1.5rem" }}>
            <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.8rem", letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: "1rem" }}>GCS Site Comparison</div>
            <div style={{ display: "flex", gap: "1rem", alignItems: "flex-end", height: 200 }}>
              {tnpsBySite.filter(s => s.isGCS).map((site, i) => {
                const maxScore = Math.max(...tnpsBySite.filter(s => s.isGCS).map(s => Math.abs(s.score || 0)), 1);
                const barH = Math.max(20, (Math.abs(site.score || 0) / maxScore) * 160);
                return (
                  <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center" }}>
                    <div style={{ fontFamily: "var(--font-data, monospace)", fontSize: "1.1rem", fontWeight: 700, color: tnpsColor(site.score), marginBottom: 4 }}>
                      {site.score > 0 ? "+" : ""}{site.score}
                    </div>
                    <div style={{ width: "60%", height: barH, borderRadius: "6px 6px 0 0", background: tnpsColor(site.score) + "cc" }} />
                    <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.78rem", color: "var(--text-warm)", marginTop: 6, fontWeight: 600 }}>{site.label}</div>
                    <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.68rem", color: "var(--text-dim)" }}>{site.total} surveys</div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Partner Ranking Leaderboard */}
          <div style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg, 16px)", padding: "1.25rem 1.5rem" }}>
            <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.8rem", letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: "0.75rem" }}>Partner Ranking</div>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  {["#", "Site / Partner", "tNPS", "Surveys", "Promoter %", "Detractor %"].map((h, i) => (
                    <th key={i} style={{ padding: "0.5rem", textAlign: i > 1 ? "right" : "left", fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.7rem", color: "var(--text-muted)", borderBottom: "1px solid var(--border)", fontWeight: 500, letterSpacing: "0.05em", textTransform: "uppercase" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tnpsBySite.map((site, i) => (
                  <tr key={i} style={{ background: site.isGCS ? (lightMode ? "#fffbeb" : "#d9770608") : "transparent" }}>
                    <td style={{ padding: "0.6rem 0.5rem", fontFamily: "var(--font-data, monospace)", fontSize: "0.82rem", color: "var(--text-dim)" }}>{i + 1}</td>
                    <td style={{ padding: "0.6rem 0.5rem", fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.85rem", color: "var(--text-warm)", fontWeight: site.isGCS ? 600 : 400 }}>
                      {site.label}
                      {site.isGCS && <span style={{ marginLeft: 6, fontSize: "0.65rem", padding: "1px 5px", borderRadius: 3, background: "#d9770618", color: "#d97706", fontWeight: 600 }}>GCS</span>}
                    </td>
                    <td style={{ padding: "0.6rem 0.5rem", textAlign: "right", fontFamily: "var(--font-data, monospace)", fontSize: "0.95rem", fontWeight: 700, color: tnpsColor(site.score) }}>
                      {site.score > 0 ? "+" : ""}{site.score}
                    </td>
                    <td style={{ padding: "0.6rem 0.5rem", textAlign: "right", fontFamily: "var(--font-data, monospace)", fontSize: "0.82rem", color: "var(--text-secondary)" }}>{site.total}</td>
                    <td style={{ padding: "0.6rem 0.5rem", textAlign: "right", fontFamily: "var(--font-data, monospace)", fontSize: "0.82rem", color: "#16a34a" }}>{Math.round(site.promoterPct)}%</td>
                    <td style={{ padding: "0.6rem 0.5rem", textAlign: "right", fontFamily: "var(--font-data, monospace)", fontSize: "0.82rem", color: "#dc2626" }}>{Math.round(site.detractorPct)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Monthly Trend */}
          {tnpsByMonth.length > 0 && (
            <div style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg, 16px)", padding: "1.25rem 1.5rem" }}>
              <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.8rem", letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: "1rem" }}>Monthly Trend — GCS Overall</div>
              <div style={{ display: "flex", gap: "0.75rem", alignItems: "flex-end", height: 180 }}>
                {tnpsByMonth.map((m, i) => {
                  const maxAbs = Math.max(...tnpsByMonth.map(x => Math.abs(x.score || 0)), 1);
                  const barH = Math.max(20, (Math.abs(m.score || 0) / maxAbs) * 140);
                  return (
                    <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center" }}>
                      <div style={{ fontFamily: "var(--font-data, monospace)", fontSize: "1rem", fontWeight: 700, color: tnpsColor(m.score), marginBottom: 4 }}>
                        {m.score > 0 ? "+" : ""}{m.score}
                      </div>
                      <div style={{ width: "70%", height: barH, borderRadius: "6px 6px 0 0", background: tnpsColor(m.score) + "cc" }} />
                      <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.75rem", color: "var(--text-warm)", marginTop: 6, fontWeight: 500 }}>{m.label}</div>
                      <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.65rem", color: "var(--text-dim)" }}>{m.total} surveys</div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Phase 2 tabs render here — placeholder for now */}
      {tab === "campaign" && <div style={{ color: "var(--text-dim)", fontFamily: "var(--font-ui, Inter, sans-serif)", padding: "3rem", textAlign: "center" }}>By Campaign — coming in Phase 2</div>}
      {tab === "supervisor" && <div style={{ color: "var(--text-dim)", fontFamily: "var(--font-ui, Inter, sans-serif)", padding: "3rem", textAlign: "center" }}>By Supervisor — coming in Phase 2</div>}
      {tab === "voices" && <div style={{ color: "var(--text-dim)", fontFamily: "var(--font-ui, Inter, sans-serif)", padding: "3rem", textAlign: "center" }}>Customer Voices — coming in Phase 2</div>}

      {/* Navigation footer */}
      <div style={{ borderTop: "1px solid var(--border)", padding: "0.9rem 0", display: "flex", justifyContent: "space-between", marginTop: "1.5rem" }}>
        <button onClick={() => onNav(-1)}
          style={{ padding: "0.5rem 1.1rem", background: "transparent", border: "1px solid var(--text-faint)", borderRadius: "6px", color: "var(--text-secondary)", fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.82rem", cursor: "pointer" }}>
          ← Overview
        </button>
        <button onClick={() => onNav(1)}
          style={{ padding: "0.5rem 1.1rem", background: "transparent", border: "1px solid var(--text-faint)", borderRadius: "6px", color: "var(--text-secondary)", fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.82rem", cursor: "pointer" }}>
          NEXT →
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Test — verify the component renders (will be wired in Task 6)**

This component is defined but not yet rendered in the App. It will be connected in Task 6. For now, verify no syntax errors by checking the app still loads.

- [ ] **Step 3: Commit**

```bash
git add src/app.jsx
git commit -m "feat(tnps): add TNPSSlide component with Summary tab"
```

---

### Task 6: Insert tNPS Slide Into Navigation

**Files:**
- Modify: `src/app.jsx:12266` (totalSlides)
- Modify: `src/app.jsx:12668-12681` (render switch)
- Modify: `src/app.jsx:12684-12709` (program nav bar)

This is the integration task. The tNPS slide goes at index 1 (after Overview at 0, before program slides). All program slides shift by +1. Campaign Comparison shifts by +1.

- [ ] **Step 1: Update totalSlides (~line 12266)**

Change:
```javascript
const totalSlides = 1 + programs.length + 1; // Overview + programs + Campaign Comparison
```
To:
```javascript
const hasTnps = perf.tnpsData && perf.tnpsData.length > 0;
const totalSlides = 1 + (hasTnps ? 1 : 0) + programs.length + 1; // Overview + tNPS? + programs + Campaign Comparison
```

- [ ] **Step 2: Derive slide offsets for clarity**

Add after totalSlides:
```javascript
const tnpsSlideIdx = hasTnps ? 1 : -1;  // -1 = doesn't exist
const programStartIdx = 1 + (hasTnps ? 1 : 0);
const campaignCompareIdx = programStartIdx + programs.length;
```

- [ ] **Step 3: Update isOverview and program derivation (~line 12265-12266 area)**

Change:
```javascript
const isOverview = slideIndex === 0;
const program = isOverview ? null : programs[slideIndex - 1];
```
To:
```javascript
const isOverview = slideIndex === 0;
const isTnpsSlide = hasTnps && slideIndex === tnpsSlideIdx;
const isCampaignCompare = slideIndex === campaignCompareIdx;
const programIdx = slideIndex - programStartIdx;
const program = (!isOverview && !isTnpsSlide && !isCampaignCompare && programIdx >= 0 && programIdx < programs.length) ? programs[programIdx] : null;
```

Note: Find the existing `isOverview` and `program` derivation lines (should be near line 12265) and replace them.

- [ ] **Step 4: Update the render section (~line 12668-12726)**

Replace the render chain from `isOverview ? (` through the end. The new pattern:

```javascript
        ) : isOverview ? (
          <BusinessOverview perf={perf} onNav={navTo} localAI={localAI} priorAgents={priorAgents} priorGoalLookup={priorGoalLookup} lightMode={lightMode} />
        ) : isTnpsSlide ? (
          <TNPSSlide perf={perf} onNav={navTo} lightMode={lightMode} />
        ) : isCampaignCompare ? (
          <CampaignComparisonPanel
            currentAgents={perf.agents}
            onNav={navTo}
            localAI={localAI}
            priorAgents={priorAgents}
            priorGoalLookup={priorGoalLookup}
            priorSheetLoading={priorSheetLoading}
            setPriorRaw={setPriorMonthRaw}
            setPriorGoalsRaw={setPriorMonthGoalsRaw}
          />
        ) : program ? (
```

- [ ] **Step 5: Update the program navigation bar button indices (~line 12690-12709)**

In the program nav bar, the `goToSlide` calls need to use the shifted indices:

- The "← Overview" button: `onClick={() => goToSlide(0)}` — stays the same
- Each program button: Change `const pIdx = pi + 1;` to `const pIdx = pi + programStartIdx;`
- The "MoM Compare" button: Change `goToSlide(1 + programs.length)` to `goToSlide(campaignCompareIdx)`
- The isActive check: Change `slideIndex === pIdx` — already correct since pIdx is recalculated
- The end button active check: Change `slideIndex === 1 + programs.length` to `slideIndex === campaignCompareIdx`

- [ ] **Step 6: Fix the Overview tNPS KPI row click handler**

In Task 4, we used `onNav(1)` which navigates forward 1 slide. With tNPS at index 1, this correctly navigates from Overview (0) to tNPS (1). No change needed.

- [ ] **Step 7: Add "tNPS" button to program nav bar**

In the program nav bar (after the "← Overview" button and separator), add a tNPS button:

```javascript
{hasTnps && (
  <>
    <button onClick={() => goToSlide(tnpsSlideIdx)}
      style={{ padding: "0.4rem 0.7rem", borderRadius: "var(--radius-sm, 6px)", border: `1px solid ${slideIndex === tnpsSlideIdx ? "#d9770650" : "transparent"}`, background: slideIndex === tnpsSlideIdx ? "#d9770612" : "transparent", color: slideIndex === tnpsSlideIdx ? "#d97706" : "var(--text-dim)", fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.85rem", cursor: "pointer", whiteSpace: "nowrap", flexShrink: 0, fontWeight: slideIndex === tnpsSlideIdx ? 600 : 400 }}>
      tNPS
    </button>
    <div style={{ width: "1px", height: "18px", background: "var(--border-muted)", flexShrink: 0, margin: "0 0.15rem" }} />
  </>
)}
```

- [ ] **Step 8: Test — full navigation flow**

1. Open app → Overview loads at slide 0
2. Click the tNPS KPI row → navigate to tNPS slide (index 1)
3. On the tNPS slide, click "← Overview" → back to Overview
4. Click "NEXT →" → goes to first program slide
5. In the program nav bar, verify "tNPS" button appears and works
6. Navigate to the last program → "MoM Compare" button should go to Campaign Comparison
7. Verify no "No Job Type column" errors on any navigation

- [ ] **Step 9: Commit**

```bash
git add src/app.jsx
git commit -m "feat(tnps): insert tNPS slide into navigation, shift program indices"
```

---

### Task 7: Copy to Dev Server and End-to-End Verification

**Files:**
- Copy: `src/app.jsx` → `Project/src/app.jsx`

- [ ] **Step 1: Copy app.jsx to Project directory**

```bash
cp "src/app.jsx" "Project/src/app.jsx"
```

- [ ] **Step 2: Start dev server if not running**

```bash
cd Project && npm run dev
```

- [ ] **Step 3: End-to-end verification checklist**

Open `http://localhost:5173` and verify:

1. ✅ App loads without console errors
2. ✅ Network tab shows tNPS CSV request completing (gid=2128252142)
3. ✅ Overview tab: tNPS KPI row appears between Scorecard and Wins
4. ✅ KPI row shows: headline score, P/P/D bar, vs Partners, MoM delta, sparkline
5. ✅ Click KPI row → navigates to tNPS slide
6. ✅ tNPS slide: Summary tab with 4 KPI cards, site comparison bars, partner leaderboard, monthly trend
7. ✅ GCS sites highlighted in leaderboard
8. ✅ Sub-tabs visible: Summary / By Campaign / By Supervisor / Customer Voices
9. ✅ Phase 2 tabs show "coming in Phase 2" placeholder
10. ✅ Navigation: Overview → tNPS → Programs → MoM Compare (all work)
11. ✅ Program nav bar shows "tNPS" button
12. ✅ Light mode: all tNPS components look correct
13. ✅ Dark mode: all tNPS components look correct

- [ ] **Step 4: Commit**

```bash
git add src/app.jsx Project/src/app.jsx
git commit -m "feat(tnps): Phase 1 complete — data layer, overview KPI row, summary tab"
```

---

## Phase 2 — Drill-Down Tabs + Agent Enrichment

### Task 8: By Campaign Tab

**Files:**
- Modify: `src/app.jsx` — Inside TNPSSlide component, replace the campaign placeholder

- [ ] **Step 1: Compute campaign data in TNPSSlide**

Add this `useMemo` inside TNPSSlide (after the destructuring, before the JSX return):

```javascript
  // Campaign breakdown (GCS only)
  const tnpsByCampaign = useMemo(() => {
    const groups = {};
    tnpsGCS.forEach(s => {
      const key = s.campaign;
      if (!groups[key]) groups[key] = { campaign: key, program: s.program, surveys: [] };
      groups[key].surveys.push(s);
    });
    return Object.values(groups)
      .map(g => ({ ...g, ...calcTnpsScore(g.surveys) }))
      .sort((a, b) => (b.score ?? -999) - (a.score ?? -999));
  }, [tnpsGCS]);
```

- [ ] **Step 2: Replace the campaign placeholder with full implementation**

Replace:
```javascript
{tab === "campaign" && <div style={{ color: "var(--text-dim)", fontFamily: "var(--font-ui, Inter, sans-serif)", padding: "3rem", textAlign: "center" }}>By Campaign — coming in Phase 2</div>}
```

With:
```javascript
      {tab === "campaign" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
          {/* Campaign Table */}
          <div style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg, 16px)", padding: "1.25rem 1.5rem" }}>
            <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.8rem", letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: "0.75rem" }}>tNPS by Campaign — GCS</div>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  {["Campaign", "Program", "tNPS", "Surveys", "Promoter %", "Detractor %"].map((h, i) => (
                    <th key={i} style={{ padding: "0.5rem", textAlign: i > 1 ? "right" : "left", fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.7rem", color: "var(--text-muted)", borderBottom: "1px solid var(--border)", fontWeight: 500, letterSpacing: "0.05em", textTransform: "uppercase" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tnpsByCampaign.map((c, i) => (
                  <tr key={i} style={{ borderBottom: "1px solid var(--bg-tertiary)" }}>
                    <td style={{ padding: "0.6rem 0.5rem", fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.85rem", color: "var(--text-warm)" }}>{c.campaign}</td>
                    <td style={{ padding: "0.6rem 0.5rem" }}>
                      {c.program && <span style={{ fontSize: "0.68rem", padding: "2px 6px", borderRadius: 3, background: "#d9770618", color: "#d97706", fontWeight: 600, fontFamily: "var(--font-ui, Inter, sans-serif)" }}>{c.program}</span>}
                    </td>
                    <td style={{ padding: "0.6rem 0.5rem", textAlign: "right", fontFamily: "var(--font-data, monospace)", fontSize: "0.95rem", fontWeight: 700, color: tnpsColor(c.score) }}>
                      {c.score > 0 ? "+" : ""}{c.score}
                    </td>
                    <td style={{ padding: "0.6rem 0.5rem", textAlign: "right", fontFamily: "var(--font-data, monospace)", fontSize: "0.82rem", color: "var(--text-secondary)" }}>{c.total}</td>
                    <td style={{ padding: "0.6rem 0.5rem", textAlign: "right", fontFamily: "var(--font-data, monospace)", fontSize: "0.82rem", color: "#16a34a" }}>{Math.round(c.promoterPct)}%</td>
                    <td style={{ padding: "0.6rem 0.5rem", textAlign: "right", fontFamily: "var(--font-data, monospace)", fontSize: "0.82rem", color: "#dc2626" }}>{Math.round(c.detractorPct)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Campaign Bar Chart */}
          <div style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg, 16px)", padding: "1.25rem 1.5rem" }}>
            <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.8rem", letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: "1rem" }}>tNPS Score by Campaign</div>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
              {tnpsByCampaign.map((c, i) => {
                const maxAbs = Math.max(...tnpsByCampaign.map(x => Math.abs(x.score || 0)), 1);
                const barW = Math.max(8, (Math.abs(c.score || 0) / maxAbs) * 100);
                return (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                    <div style={{ width: 130, fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.78rem", color: "var(--text-secondary)", textAlign: "right", flexShrink: 0 }}>{c.campaign}</div>
                    <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 6 }}>
                      <div style={{ width: `${barW}%`, height: 18, borderRadius: 4, background: tnpsColor(c.score) + "cc" }} />
                      <span style={{ fontFamily: "var(--font-data, monospace)", fontSize: "0.78rem", fontWeight: 600, color: tnpsColor(c.score) }}>
                        {c.score > 0 ? "+" : ""}{c.score}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
```

- [ ] **Step 3: Test — verify By Campaign tab renders**

Click "By Campaign" tab. Verify table shows campaigns sorted by tNPS descending, program badges appear for Add XM/Add XMC/Non Subs, horizontal bar chart shows all campaigns.

- [ ] **Step 4: Commit**

```bash
git add src/app.jsx
git commit -m "feat(tnps): add By Campaign tab with table and bar chart"
```

---

### Task 9: By Supervisor Tab

**Files:**
- Modify: `src/app.jsx` — Inside TNPSSlide component, replace the supervisor placeholder

- [ ] **Step 1: Compute supervisor data in TNPSSlide**

Add this `useMemo` after tnpsByCampaign:

```javascript
  // Supervisor breakdown (GCS only, from roster join)
  const tnpsBySupervisor = useMemo(() => {
    // Group by supervisor
    const groups = {};
    tnpsGCS.forEach(s => {
      const sup = s.supervisor || "Unknown";
      if (!groups[sup]) groups[sup] = { supervisor: sup, site: s.siteLabel, surveys: [] };
      groups[sup].surveys.push(s);
    });

    // Calculate site averages for delta
    const siteAvgs = {};
    tnpsBySite.filter(s => s.isGCS).forEach(s => { siteAvgs[s.label] = s.score; });

    return Object.values(groups)
      .map(g => {
        const stats = calcTnpsScore(g.surveys);
        const siteAvg = siteAvgs[g.site] ?? null;
        return {
          ...g,
          ...stats,
          siteAvg,
          delta: siteAvg !== null && stats.score !== null ? stats.score - siteAvg : null,
          agents: (() => {
            const agentGroups = {};
            g.surveys.forEach(s => {
              if (!agentGroups[s.ntid]) agentGroups[s.ntid] = { ntid: s.ntid, name: s.agentName, surveys: [] };
              agentGroups[s.ntid].surveys.push(s);
            });
            return Object.values(agentGroups)
              .map(a => ({ ...a, ...calcTnpsScore(a.surveys) }))
              .sort((a, b) => (a.score ?? 999) - (b.score ?? 999));
          })(),
        };
      })
      .sort((a, b) => (a.score ?? 999) - (b.score ?? 999)); // worst first
  }, [tnpsGCS, tnpsBySite]);
```

- [ ] **Step 2: Add expandedSupervisor state in TNPSSlide**

Add after the `tab` state:
```javascript
  const [expandedSup, setExpandedSup] = useState(null);
```

- [ ] **Step 3: Replace the supervisor placeholder with full implementation**

Replace:
```javascript
{tab === "supervisor" && <div style={{ color: "var(--text-dim)", fontFamily: "var(--font-ui, Inter, sans-serif)", padding: "3rem", textAlign: "center" }}>By Supervisor — coming in Phase 2</div>}
```

With:
```javascript
      {tab === "supervisor" && (
        <div style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg, 16px)", padding: "1.25rem 1.5rem" }}>
          <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.8rem", letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: "0.75rem" }}>tNPS by Supervisor — GCS (sorted by coaching opportunity)</div>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                {["Supervisor", "Site", "Team tNPS", "Surveys", "Promoter %", "Detractor %", "vs Site Avg"].map((h, i) => (
                  <th key={i} style={{ padding: "0.5rem", textAlign: i > 1 ? "right" : "left", fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.7rem", color: "var(--text-muted)", borderBottom: "1px solid var(--border)", fontWeight: 500, letterSpacing: "0.05em", textTransform: "uppercase" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tnpsBySupervisor.map((sup, i) => {
                const isExpanded = expandedSup === sup.supervisor;
                const belowAvg = sup.delta !== null && sup.delta < -10;
                return (
                  <React.Fragment key={i}>
                    <tr
                      onClick={() => setExpandedSup(isExpanded ? null : sup.supervisor)}
                      style={{ cursor: "pointer", borderBottom: "1px solid var(--bg-tertiary)", background: belowAvg ? (lightMode ? "#fef2f2" : "#dc262606") : "transparent" }}
                    >
                      <td style={{ padding: "0.6rem 0.5rem", fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.85rem", color: "var(--text-warm)" }}>
                        <span style={{ marginRight: 6, fontSize: "0.7rem", color: "var(--text-faint)" }}>{isExpanded ? "▼" : "▶"}</span>
                        {sup.supervisor}
                      </td>
                      <td style={{ padding: "0.6rem 0.5rem", fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.82rem", color: "var(--text-secondary)" }}>{sup.site}</td>
                      <td style={{ padding: "0.6rem 0.5rem", textAlign: "right", fontFamily: "var(--font-data, monospace)", fontSize: "0.95rem", fontWeight: 700, color: tnpsColor(sup.score) }}>
                        {sup.score > 0 ? "+" : ""}{sup.score}
                      </td>
                      <td style={{ padding: "0.6rem 0.5rem", textAlign: "right", fontFamily: "var(--font-data, monospace)", fontSize: "0.82rem", color: "var(--text-secondary)" }}>{sup.total}</td>
                      <td style={{ padding: "0.6rem 0.5rem", textAlign: "right", fontFamily: "var(--font-data, monospace)", fontSize: "0.82rem", color: "#16a34a" }}>{Math.round(sup.promoterPct)}%</td>
                      <td style={{ padding: "0.6rem 0.5rem", textAlign: "right", fontFamily: "var(--font-data, monospace)", fontSize: "0.82rem", color: "#dc2626" }}>{Math.round(sup.detractorPct)}%</td>
                      <td style={{ padding: "0.6rem 0.5rem", textAlign: "right", fontFamily: "var(--font-data, monospace)", fontSize: "0.82rem", fontWeight: 600, color: sup.delta !== null ? (sup.delta >= 0 ? "#16a34a" : "#dc2626") : "var(--text-dim)" }}>
                        {sup.delta !== null ? `${sup.delta >= 0 ? "+" : ""}${sup.delta}` : "—"}
                      </td>
                    </tr>
                    {isExpanded && sup.agents.map((agent, ai) => (
                      <tr key={`${i}-${ai}`} style={{ background: lightMode ? "#f8f9fa" : "var(--bg-tertiary)" }}>
                        <td colSpan={2} style={{ padding: "0.4rem 0.5rem 0.4rem 2rem", fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.8rem", color: "var(--text-secondary)" }}>{agent.name}</td>
                        <td style={{ padding: "0.4rem 0.5rem", textAlign: "right", fontFamily: "var(--font-data, monospace)", fontSize: "0.85rem", fontWeight: 600, color: tnpsColor(agent.score) }}>
                          {agent.score !== null ? `${agent.score > 0 ? "+" : ""}${agent.score}` : "—"}
                        </td>
                        <td style={{ padding: "0.4rem 0.5rem", textAlign: "right", fontFamily: "var(--font-data, monospace)", fontSize: "0.78rem", color: "var(--text-dim)" }}>{agent.total}</td>
                        <td style={{ padding: "0.4rem 0.5rem", textAlign: "right", fontFamily: "var(--font-data, monospace)", fontSize: "0.78rem", color: "#16a34a" }}>{Math.round(agent.promoterPct)}%</td>
                        <td style={{ padding: "0.4rem 0.5rem", textAlign: "right", fontFamily: "var(--font-data, monospace)", fontSize: "0.78rem", color: "#dc2626" }}>{Math.round(agent.detractorPct)}%</td>
                        <td />
                      </tr>
                    ))}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
```

- [ ] **Step 3: Test — verify By Supervisor tab**

Click "By Supervisor" tab. Verify: sorted worst-first, supervisors below site avg highlighted red, clicking a row expands to show agents, agents sorted worst-first.

- [ ] **Step 4: Commit**

```bash
git add src/app.jsx
git commit -m "feat(tnps): add By Supervisor tab with expandable agent rows"
```

---

### Task 10: Customer Voices Tab

**Files:**
- Modify: `src/app.jsx` — Inside TNPSSlide component, replace the voices placeholder

- [ ] **Step 1: Add filter state for Customer Voices**

Add after the `expandedSup` state in TNPSSlide:
```javascript
  const [voiceFilter, setVoiceFilter] = useState({ type: "all", site: "all", campaign: "all", month: "all" });
```

- [ ] **Step 2: Add filtered voices computation**

Add after the supervisor useMemo:
```javascript
  // Customer Voices — filtered GCS surveys with reason text
  const voicesSorted = useMemo(() => {
    let filtered = tnpsGCS.filter(s => s.reason);
    if (voiceFilter.type !== "all") filtered = filtered.filter(s => s.category === voiceFilter.type);
    if (voiceFilter.site !== "all") filtered = filtered.filter(s => s.siteLabel === voiceFilter.site);
    if (voiceFilter.campaign !== "all") filtered = filtered.filter(s => s.campaign === voiceFilter.campaign);
    if (voiceFilter.month !== "all") filtered = filtered.filter(s => s.month === voiceFilter.month);
    return filtered.sort((a, b) => (b.date || 0) - (a.date || 0));
  }, [tnpsGCS, voiceFilter]);

  const voiceCampaigns = useMemo(() => [...new Set(tnpsGCS.map(s => s.campaign))].sort(), [tnpsGCS]);
  const voiceMonths = useMemo(() => [...new Set(tnpsGCS.filter(s => s.month).map(s => s.month))].sort(), [tnpsGCS]);
```

- [ ] **Step 3: Replace the voices placeholder with full implementation**

Replace:
```javascript
{tab === "voices" && <div style={{ color: "var(--text-dim)", fontFamily: "var(--font-ui, Inter, sans-serif)", padding: "3rem", textAlign: "center" }}>Customer Voices — coming in Phase 2</div>}
```

With:
```javascript
      {tab === "voices" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          {/* Filters */}
          <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
            {/* Score type filter */}
            <div style={{ display: "flex", gap: "0.25rem" }}>
              {[{ key: "all", label: "All" }, { key: "promoter", label: "Promoter", color: "#16a34a" }, { key: "passive", label: "Passive", color: "#d97706" }, { key: "detractor", label: "Detractor", color: "#dc2626" }].map(f => (
                <button key={f.key} onClick={() => setVoiceFilter(v => ({ ...v, type: f.key }))}
                  style={{ padding: "0.35rem 0.65rem", borderRadius: "var(--radius-sm, 6px)", border: `1px solid ${voiceFilter.type === f.key ? (f.color || "#d97706") + "50" : "var(--border-muted)"}`, background: voiceFilter.type === f.key ? (f.color || "#d97706") + "12" : "transparent", color: voiceFilter.type === f.key ? (f.color || "var(--text-warm)") : "var(--text-dim)", fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.78rem", cursor: "pointer", fontWeight: voiceFilter.type === f.key ? 600 : 400 }}>
                  {f.label}
                </button>
              ))}
            </div>
            {/* Site filter */}
            <select value={voiceFilter.site} onChange={e => setVoiceFilter(v => ({ ...v, site: e.target.value }))}
              style={{ padding: "0.35rem 0.5rem", borderRadius: "var(--radius-sm, 6px)", border: "1px solid var(--border-muted)", background: "var(--bg-secondary)", color: "var(--text-secondary)", fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.78rem" }}>
              <option value="all">All GCS Sites</option>
              {tnpsBySite.filter(s => s.isGCS).map(s => <option key={s.label} value={s.label}>{s.label}</option>)}
            </select>
            {/* Campaign filter */}
            <select value={voiceFilter.campaign} onChange={e => setVoiceFilter(v => ({ ...v, campaign: e.target.value }))}
              style={{ padding: "0.35rem 0.5rem", borderRadius: "var(--radius-sm, 6px)", border: "1px solid var(--border-muted)", background: "var(--bg-secondary)", color: "var(--text-secondary)", fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.78rem" }}>
              <option value="all">All Campaigns</option>
              {voiceCampaigns.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            {/* Month filter */}
            <select value={voiceFilter.month} onChange={e => setVoiceFilter(v => ({ ...v, month: e.target.value }))}
              style={{ padding: "0.35rem 0.5rem", borderRadius: "var(--radius-sm, 6px)", border: "1px solid var(--border-muted)", background: "var(--bg-secondary)", color: "var(--text-secondary)", fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.78rem" }}>
              <option value="all">All Months</option>
              {voiceMonths.map(m => {
                const d = new Date(m + "-01");
                return <option key={m} value={m}>{d.toLocaleString("en-US", { month: "short", year: "numeric" })}</option>;
              })}
            </select>
            <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.75rem", color: "var(--text-dim)", alignSelf: "center" }}>{voicesSorted.length} results</div>
          </div>

          {/* Scrollable list */}
          <div style={{ maxHeight: 600, overflowY: "auto", display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            {voicesSorted.slice(0, 100).map((s, i) => (
              <div key={i} style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)", borderLeft: `4px solid ${s.category === "promoter" ? "#16a34a" : s.category === "detractor" ? "#dc2626" : "#d97706"}`, borderRadius: "var(--radius-md, 10px)", padding: "0.75rem 1rem" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.4rem" }}>
                  <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: 4, fontFamily: "var(--font-data, monospace)", fontSize: "0.78rem", fontWeight: 700, color: "#fff", background: s.category === "promoter" ? "#16a34a" : s.category === "detractor" ? "#dc2626" : "#d97706" }}>{s.score}</span>
                  <span style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.82rem", color: "var(--text-warm)", fontWeight: 600 }}>{s.agentName}</span>
                  <span style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.72rem", color: "var(--text-dim)" }}>{s.campaign} · {s.siteLabel}</span>
                  <span style={{ marginLeft: "auto", fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.7rem", color: "var(--text-faint)" }}>{s.date ? s.date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : ""}</span>
                </div>
                <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.82rem", color: "var(--text-primary)", lineHeight: 1.5 }}>{s.reason}</div>
              </div>
            ))}
            {voicesSorted.length > 100 && (
              <div style={{ textAlign: "center", padding: "1rem", color: "var(--text-dim)", fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.78rem" }}>
                Showing first 100 of {voicesSorted.length} results. Use filters to narrow down.
              </div>
            )}
            {voicesSorted.length === 0 && (
              <div style={{ textAlign: "center", padding: "3rem", color: "var(--text-dim)", fontFamily: "var(--font-ui, Inter, sans-serif)" }}>No customer feedback matches the current filters.</div>
            )}
          </div>
        </div>
      )}
```

- [ ] **Step 3: Test — verify Customer Voices tab**

Click "Customer Voices" tab. Verify: feedback cards with colored left borders, score chips, agent names, filters work (type, site, campaign, month), results count updates, scrollable list with max 100 shown.

- [ ] **Step 4: Commit**

```bash
git add src/app.jsx
git commit -m "feat(tnps): add Customer Voices tab with filters and feedback feed"
```

---

### Task 11: Agent-Level tNPS Enrichment

**Files:**
- Modify: `src/app.jsx:9344` (Slide component — agent tables)

- [ ] **Step 1: Compute per-agent tNPS lookup in performance engine**

Add to `usePerformanceEngine` (after `tnpsByMonth`, before the return object):

```javascript
  // Per-agent tNPS lookup (keyed by normalized agent name)
  const tnpsByAgent = useMemo(() => {
    const map = {};
    tnpsGCS.forEach(s => {
      const key = s.agentName.toLowerCase();
      if (!map[key]) map[key] = [];
      map[key].push(s);
    });
    // Compute score for each agent
    const result = {};
    Object.entries(map).forEach(([key, surveys]) => {
      result[key] = { surveys, ...calcTnpsScore(surveys) };
    });
    return result;
  }, [tnpsGCS]);
```

Add `tnpsByAgent` to the return object.

- [ ] **Step 2: Pass tnpsByAgent to Slide component**

In the App render section where `<Slide>` is rendered (~line 12711), add:
```javascript
tnpsByAgent={perf.tnpsByAgent}
```

- [ ] **Step 3: Accept tnpsByAgent prop in Slide component (~line 9344)**

Change:
```javascript
function Slide({ program, newHireSet, goalLookup, fiscalInfo, slideIndex, total, onNav, allAgents, localAI, priorAgents }) {
```
To:
```javascript
function Slide({ program, newHireSet, goalLookup, fiscalInfo, slideIndex, total, onNav, allAgents, localAI, priorAgents, tnpsByAgent }) {
```

- [ ] **Step 4: Add tNPS badge helper inside Slide (right after the destructured props)**

```javascript
  // tNPS badge for agent tables
  const agentTnpsBadge = (agentName) => {
    if (!tnpsByAgent) return null;
    const data = tnpsByAgent[agentName.toLowerCase()];
    if (!data || data.total < 3) return null; // Insufficient data
    const color = data.promoters > data.detractors ? "#16a34a" : data.detractors > data.promoters ? "#dc2626" : "#6b7280";
    return (
      <span title={`tNPS: ${data.score > 0 ? "+" : ""}${data.score} (${data.total} surveys)`}
        style={{ display: "inline-block", marginLeft: 5, padding: "1px 5px", borderRadius: 3, fontSize: "0.65rem", fontWeight: 600, fontFamily: "var(--font-data, monospace)", background: color + "18", color, verticalAlign: "middle" }}>
        {data.score > 0 ? "+" : ""}{data.score}
      </span>
    );
  };
```

- [ ] **Step 5: Find agent name renders in the Slide component and add badges**

Search inside the Slide component for places where `a.agentName` is rendered (typically in `<td>` cells in agent ranking tables). For each occurrence, append `{agentTnpsBadge(a.agentName)}` right after the agent name text.

The typical pattern to find is:
```javascript
{a.agentName}
{newHireSet.has(a.agentName) && <span ...>NEW</span>}
```

Change to:
```javascript
{a.agentName}
{newHireSet.has(a.agentName) && <span ...>NEW</span>}
{agentTnpsBadge(a.agentName)}
```

Do this for all agent table renders inside Slide. There may be multiple agent listing tables (Q1-Q4 quartiles, full agent table, etc.).

- [ ] **Step 6: Add tNPS detail expansion in agent tables**

Find the expandable agent row pattern inside Slide (the `expandedAgent` state and the expansion `<tr>` block). When an agent row is expanded, if that agent has tNPS data, append their survey list below the existing performance detail.

After the existing expanded detail content, add:

```javascript
{/* tNPS surveys for this agent */}
{tnpsByAgent && tnpsByAgent[a.agentName.toLowerCase()] && tnpsByAgent[a.agentName.toLowerCase()].total >= 1 && (() => {
  const agentTnps = tnpsByAgent[a.agentName.toLowerCase()];
  return (
    <div style={{ marginTop: "0.75rem", borderTop: "1px solid var(--border)", paddingTop: "0.5rem" }}>
      <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.72rem", color: "var(--text-muted)", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: "0.35rem" }}>
        tNPS Surveys ({agentTnps.total}) · Score: {agentTnps.score > 0 ? "+" : ""}{agentTnps.score}
      </div>
      {agentTnps.surveys.sort((a, b) => (b.date || 0) - (a.date || 0)).slice(0, 10).map((s, si) => (
        <div key={si} style={{ display: "flex", alignItems: "flex-start", gap: "0.5rem", padding: "0.3rem 0", borderBottom: "1px solid var(--bg-tertiary)" }}>
          <span style={{ display: "inline-block", padding: "1px 6px", borderRadius: 3, fontSize: "0.72rem", fontWeight: 700, fontFamily: "var(--font-data, monospace)", color: "#fff", background: s.category === "promoter" ? "#16a34a" : s.category === "detractor" ? "#dc2626" : "#d97706", flexShrink: 0 }}>{s.score}</span>
          <span style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.72rem", color: "var(--text-dim)", flexShrink: 0, width: 70 }}>{s.date ? s.date.toLocaleDateString("en-US", { month: "short", day: "numeric" }) : ""}</span>
          <span style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.72rem", color: "var(--text-dim)", flexShrink: 0, width: 80 }}>{s.campaign}</span>
          <span style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.78rem", color: "var(--text-secondary)", flex: 1 }}>{s.reason || "—"}</span>
        </div>
      ))}
    </div>
  );
})()}
```

This block goes inside the expanded agent detail row, showing up to 10 most recent surveys with date, score chip, campaign, and reason text.

- [ ] **Step 7: Test — verify tNPS badges and detail expansion on program slides**

Navigate to a program slide. In agent tables, agents with 3+ tNPS surveys should show a small colored badge with their tNPS score. Agents without tNPS data show nothing. Hover over a badge to see the tooltip. Click an agent with tNPS data to expand — their surveys should appear below the performance detail with score chips, dates, campaigns, and reason text.

- [ ] **Step 8: Commit**

```bash
git add src/app.jsx
git commit -m "feat(tnps): add agent-level tNPS badges on program slides"
```

---

### Task 12: Final Copy to Dev Server and Full Verification

**Files:**
- Copy: `src/app.jsx` → `Project/src/app.jsx`

- [ ] **Step 1: Copy to dev server**

```bash
cp "src/app.jsx" "Project/src/app.jsx"
```

- [ ] **Step 2: Full verification checklist**

Open `http://localhost:5173` and verify:

**Phase 1:**
1. ✅ tNPS data auto-fetches (Network tab)
2. ✅ Overview: tNPS KPI row between Scorecard and Wins
3. ✅ Click KPI row → tNPS slide
4. ✅ Summary tab: 4 KPI cards, site comparison bars, partner leaderboard, monthly trend
5. ✅ Navigation works: Overview → tNPS → Programs → MoM Compare

**Phase 2:**
6. ✅ By Campaign tab: table + bar chart, program badges, sorted by tNPS
7. ✅ By Supervisor tab: sorted worst-first, expandable rows, agents within, delta vs site avg
8. ✅ Customer Voices tab: feedback cards, colored borders/chips, all 4 filters work
9. ✅ Agent badges: appear on program slide agent tables, correct colors, tooltips work
10. ✅ Light mode: all tNPS components render correctly
11. ✅ Dark mode: all tNPS components render correctly
12. ✅ No console errors

- [ ] **Step 3: Commit**

```bash
git add src/app.jsx Project/src/app.jsx
git commit -m "feat(tnps): Phase 2 complete — all 4 tabs and agent enrichment"
```
