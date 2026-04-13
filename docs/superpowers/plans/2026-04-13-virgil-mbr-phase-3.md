# Corp MBR Export — Phase 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Slides 6 (per-campaign Actual-to-Goal, N slides), 7 (tNPS Customer Experience), and 8 (Partner Experience) to the Corp MBR export. Wire the Extended Agent Stats data source, add unified insights-textarea persistence for the modal, and deliver the 8-slide spec end-to-end.

**Architecture:** Extend the existing `// CORP MBR —` sections of `src/app.jsx` with new parsers, aggregators, and slide builders that parallel the Phase 2 patterns. New Extended Agent Stats upload added to the Corp MBR Data Sources modal. Per-campaign performance-note textareas added to the export modal, stored under a single unified `perf_intel_corp_insights_v1` JSON blob. Slide 7 is a port of the existing `buildMbrTnpsSlide` with reporting-month filtering, Xfinity brand treatment, and the "% Promoters Emailed" element stripped. Slide 8 needs a new aggregator that walks the full roster CSV (unlike `parseNewHires`, which filters to active-within-180-days).

**Tech Stack:** React 18, `pptxgenjs`, Vite. Single-file `src/app.jsx` (~16,600 lines). Verification is `npx vite build` + manual browser inspection of the dev server + inspect downloaded `.pptx` in PowerPoint.

**Related:**
- Spec: `docs/superpowers/specs/2026-04-12-virgil-mbr-export-design.md` (Sections 6.6, 6.7, 6.8)
- Phase 1 plan: `docs/superpowers/plans/2026-04-12-virgil-mbr-phase-1.md`
- Phase 2 plan: `docs/superpowers/plans/2026-04-12-virgil-mbr-phase-2.md`

---

> ⚠ **Rework 2026-04-13 (post-execution):** Tasks 1 and 4 have been effectively reverted — the separate Extended Agent Stats URL / fetch / modal row / env var were dropped. Extended Agent data is now derived from the existing `rawAgentCsv` via `parseExtendedAgentStats` (Task 2 still applies). Task 5's readiness row was removed. Task 10's orchestrator pairs `reportingFilter` / `mtdFilter` on the same `rawAgentCsv`+`goalsRaw` instead of `priorAgentRaw`+`agentRaw`. Slide 6 columns are now **reporting (March) / MTD (April)**, not Feb / March. Notes keys are `.reporting` / `.mtd`, not `.feb` / `.march`. See commits `0c2c604` and `92e9d6d` for the diffs. The task bodies below reflect the ORIGINAL design — read them for context but trust the HEAD-of-main code for current state.

---

**Conventions (locked in by Phase 2):**
- Section header comments are `// CORP MBR — <Section>`
- New Phase 3 slide-builder functions are named `buildCorp<SlideName>Slide` (e.g. `buildCorpCampaignDetailSlide`, `buildCorpTnpsSlide`, `buildCorpPartnerExperienceSlide`)
- Commit messages use the `corp-mbr:` scope
- Dev-server verification path: `cd "/c/Users/Joshu/Documents/Claude/Performance Intel" && npx vite`
- Build verification path: `cd "/c/Users/Joshu/Documents/Claude/Performance Intel" && npx vite build 2>&1 | tail -5`
- The orchestrator function is `buildVirgilMbrPresentation` (unchanged name, matches Phase 1/2)
- The export modal is `VirgilMbrExportModal` (unchanged)
- Theme helpers `virgilTheme`, `virgilBrandBars`, `corpPalette`, `drawCorpCard` already exist (src/app.jsx:6931–7007)

---

## Pre-Flight

- [ ] **Step 0.1: Verify baseline build passes**

Run: `cd "/c/Users/Joshu/Documents/Claude/Performance Intel" && npx vite build 2>&1 | tail -5`

Expected: `built in Xs` with no errors.

- [ ] **Step 0.2: Confirm Phase 2 state is intact**

Run this grep and verify all five function names exist:

```bash
grep -n "^function buildCorpOpPerformanceSlide\|^function buildCorpQuartileSlide\|^function buildCorpCampaignHoursSlide\|^function buildVirgilMbrPresentation\|^function VirgilMbrExportModal" src/app.jsx
```

Expected: 5 matches.

- [ ] **Step 0.3: Confirm insights persistence slot does not yet exist**

Run: `grep -n "perf_intel_corp_insights_v1" src/app.jsx`

Expected: no match. (If it exists, skim — Phase 3 is about to introduce it; a stub version is fine, but a colliding definition must be reconciled before starting Task 3.)

- [ ] **Step 0.4: Confirm `.env.local` has the Corp MBR URLs**

Run: `grep -c "VITE_DEFAULT_CORP_" .env.local 2>&1 || echo "no .env.local"`

Expected: a count ≥ 7 (seven Corp MBR URLs from Phase 2). If zero or `no .env.local`, stop and restore `.env.local` from backup before continuing — Phase 3 adds one more URL to this file.

---

## Task 1: Add Extended Agent Stats URL state + fetch

**Files:**
- Modify: `src/app.jsx` — App component state region (grep `const \[priorQuarterAgentUrl,`)
- Modify: `src/app.jsx` — App component `useEffect` region (grep `useEffect.*priorQuarterAgentUrl`)
- Modify: `.env.local` (gitignored)

- [ ] **Step 1.1: Add the `.env.local` default constant**

Open `src/app.jsx`, find the Corp MBR URL constants block (grep `DEFAULT_CORP_PRIOR_QUARTER_GOALS_URL`). Add immediately after it:

```jsx
const DEFAULT_CORP_EXTENDED_AGENT_URL = import.meta.env.VITE_DEFAULT_CORP_EXTENDED_AGENT_URL || "";
```

- [ ] **Step 1.2: Add URL state slot**

Find the App component body where Phase 2 added `priorQuarterAgentUrl` state (grep `priorQuarterAgentUrl, _setPriorQuarterAgentUrl`). Add immediately after the `priorQuarterGoalsUrl` block:

```jsx
const [corpExtendedAgentUrl, _setCorpExtendedAgentUrl] = useState(() => {
  try { return localStorage.getItem("perf_intel_corp_extended_agent_url_v1") || DEFAULT_CORP_EXTENDED_AGENT_URL; } catch(e) { return DEFAULT_CORP_EXTENDED_AGENT_URL; }
});
const setCorpExtendedAgentUrl = useCallback(v => {
  _setCorpExtendedAgentUrl(v);
  try { localStorage.setItem("perf_intel_corp_extended_agent_url_v1", v || ""); } catch(e) {}
}, []);
```

- [ ] **Step 1.3: Add cached raw state for fetched content**

Immediately after the URL slot:

```jsx
const [corpExtendedAgentRaw, _setCorpExtendedAgentRaw] = useState(() => {
  try { return localStorage.getItem("perf_intel_corp_extended_agent_v1") || ""; } catch(e) { return ""; }
});
const setCorpExtendedAgentRaw = useCallback(v => {
  _setCorpExtendedAgentRaw(v);
  try { localStorage.setItem("perf_intel_corp_extended_agent_v1", v || ""); } catch(e) {}
}, []);
```

- [ ] **Step 1.4: Add auto-fetch useEffect**

Find the `useEffect` block for `priorQuarterGoalsUrl` (grep `useEffect.*priorQuarterGoalsUrl`). Add immediately after the closing `}, [priorQuarterGoalsUrl]);`:

```jsx
useEffect(() => {
  if (!corpExtendedAgentUrl) return;
  (async () => {
    try {
      const res = await fetch(corpExtendedAgentUrl);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      setCorpExtendedAgentRaw(text);
    } catch(e) {
      try {
        const res = await fetch(`https://corsproxy.io/?${encodeURIComponent(corpExtendedAgentUrl)}`);
        if (!res.ok) throw new Error(`Proxy HTTP ${res.status}`);
        setCorpExtendedAgentRaw(await res.text());
      } catch(e2) {
        console.error("Corp Extended Agent Stats fetch failed:", e2);
      }
    }
  })();
}, [corpExtendedAgentUrl]);
```

- [ ] **Step 1.5: Add URL to `.env.local`**

Append to `.env.local` (gitignored):

```
VITE_DEFAULT_CORP_EXTENDED_AGENT_URL=
```

Leave blank — user pastes the Google Sheet CSV URL locally. (If the user already has the URL, they paste it here between the `=` and the newline. Otherwise they can enter it via the Corp MBR Data Sources modal after Task 4.)

- [ ] **Step 1.6: Verify build**

Run: `cd "/c/Users/Joshu/Documents/Claude/Performance Intel" && npx vite build 2>&1 | tail -5`

Expected: clean build, no errors.

- [ ] **Step 1.7: Commit**

```bash
cd "/c/Users/Joshu/Documents/Claude/Performance Intel" && git add src/app.jsx && git commit -m "feat(corp-mbr): add Extended Agent Stats URL state + auto-fetch"
```

---

## Task 2: Parse Extended Agent Stats and build a campaign→aggregates lookup

**Files:**
- Modify: `src/app.jsx` — CORP MBR Parsers section (grep `// CORP MBR — Parsers`)
- Modify: `src/app.jsx` — CORP MBR Aggregators section (grep `// CORP MBR — Aggregators`)

- [ ] **Step 2.1: Add `parseExtendedAgentStats`**

Open `src/app.jsx`. Find `parseLoginBuckets` (grep `^function parseLoginBuckets`). Add immediately after its closing brace:

```jsx
// Extended Agent Stats — per-agent-per-day rows from the richer Extended Agent CSV.
// Columns used by Slide 6: Job (ROC), Date, AgentName, Dials, Contacts, Finals, Goals, Hours.
// Other columns are tolerated but unused (e.g. XMSales, NewVideo, etc.).
function parseExtendedAgentStats(rawCsv) {
  if (!rawCsv || !rawCsv.trim()) return [];
  const rows = parseCSV(rawCsv);
  return rows.map(r => ({
    roc: (r["Job"] || "").trim(),
    date: (r["Date"] || "").trim(),
    agentName: (r["AgentName"] || "").trim(),
    dials: Number(r["Dials"]) || 0,
    contacts: Number(r["Contacts"]) || 0,
    finals: Number(r["Finals"]) || 0,
    goals: Number(r["Goals"]) || 0,
    hours: Number(r["Hours"]) || 0,
  })).filter(r => r.roc || r.agentName);
}
```

- [ ] **Step 2.2: Add `buildExtendedAgentLookup` aggregator**

Find the `// CORP MBR — Aggregators` section header (grep `// CORP MBR — Aggregators`). Add at the END of this section, immediately before the next section header `// CORP MBR — Brand Helpers` (grep `// CORP MBR — Brand Helpers`):

```jsx
// Roll up Extended Agent Stats into per-ROC totals filtered to a month.
// Returns { [roc]: { dials, contacts, finals } } for each ROC present in the filtered rows.
// If the CSV is empty, returns {} — downstream callers render "—" for Contact Rate / Lead Penetration.
function buildExtendedAgentLookup(extendedRows, monthFilter) {
  if (!Array.isArray(extendedRows) || extendedRows.length === 0) return {};
  const out = {};
  for (const r of extendedRows) {
    if (monthFilter && !monthFilter(r.date)) continue;
    if (!r.roc) continue;
    if (!out[r.roc]) out[r.roc] = { dials: 0, contacts: 0, finals: 0 };
    out[r.roc].dials += r.dials;
    out[r.roc].contacts += r.contacts;
    out[r.roc].finals += r.finals;
  }
  return out;
}
```

- [ ] **Step 2.3: Verify build**

Run: `cd "/c/Users/Joshu/Documents/Claude/Performance Intel" && npx vite build 2>&1 | tail -5`

Expected: clean build.

- [ ] **Step 2.4: Commit**

```bash
cd "/c/Users/Joshu/Documents/Claude/Performance Intel" && git add src/app.jsx && git commit -m "feat(corp-mbr): parseExtendedAgentStats + buildExtendedAgentLookup for Slide 6"
```

---

## Task 3: Unified modal-persisted insights state

**Goal:** All Corp MBR modal textareas (Slide 2, Slide 6 per-campaign notes, Slide 7, Slide 8 support/incentives) share a single `insights` object that round-trips through `localStorage["perf_intel_corp_insights_v1"]`. Phase 1/2 already pass an `insights` prop into the modal; Phase 3 makes it durable.

**Files:**
- Modify: `src/app.jsx` — App component state region (grep `const [showVirgilMbrModal`)
- Modify: `src/app.jsx` — `<VirgilMbrExportModal>` mount site (grep `<VirgilMbrExportModal`)

- [ ] **Step 3.1: Add App-level insights state**

In the App component body, find the `showVirgilMbrModal` state slot (grep `showVirgilMbrModal`). Add immediately after:

```jsx
const [corpInsights, _setCorpInsights] = useState(() => {
  try {
    const raw = localStorage.getItem("perf_intel_corp_insights_v1");
    return raw ? JSON.parse(raw) : {};
  } catch(e) { return {}; }
});
const setCorpInsights = useCallback(updater => {
  _setCorpInsights(prev => {
    const next = typeof updater === "function" ? updater(prev) : updater;
    try { localStorage.setItem("perf_intel_corp_insights_v1", JSON.stringify(next || {})); } catch(e) {}
    return next;
  });
}, []);
```

(Uses React's functional-update pattern so `setCorpInsights(prev => ({ ...prev, foo: v }))` works safely even in async contexts.)

- [ ] **Step 3.2: Pass insights into the modal**

Find the `<VirgilMbrExportModal` mount (grep `<VirgilMbrExportModal`). Replace the existing `insights` / `setInsights` props with:

```jsx
insights={corpInsights}
setInsights={setCorpInsights}
```

(If props don't already exist, add them.)

- [ ] **Step 3.3: Replace ephemeral modal insights state with the passed-in props**

Open `VirgilMbrExportModal`. Find any local `useState(() => ({}))` that creates an `insights` state inside the modal (grep inside the function body for `const \[insights, setInsights\] = useState`). If present, delete it — the modal should use the props passed from App. If the modal already destructures `insights, setInsights` from props (Phase 2 convention), no change here.

- [ ] **Step 3.4: Verify build**

Run: `cd "/c/Users/Joshu/Documents/Claude/Performance Intel" && npx vite build 2>&1 | tail -5`

Expected: clean build.

- [ ] **Step 3.5: Manual dev-server smoke test**

```bash
cd "/c/Users/Joshu/Documents/Claude/Performance Intel" && npx vite
```

Open http://localhost:5173, click ⚙ → Export Corp MBR. The Slide 2 insights textarea (or any future textarea) should persist across modal close + reopen. If nothing persists yet because no textarea reads from `insights.*` — that's fine, this is plumbing. Close the modal. Stop the dev server (Ctrl-C in the Vite terminal).

- [ ] **Step 3.6: Commit**

```bash
cd "/c/Users/Joshu/Documents/Claude/Performance Intel" && git add src/app.jsx && git commit -m "feat(corp-mbr): unified insights state persisted to perf_intel_corp_insights_v1"
```

---

## Task 4: Add Extended Agent Stats URL input to Corp MBR Data Sources modal

**Files:**
- Modify: `src/app.jsx` — `CorpMbrDataSourcesModal` component (grep `^function CorpMbrDataSourcesModal`)
- Modify: `src/app.jsx` — `<CorpMbrDataSourcesModal` mount (grep `<CorpMbrDataSourcesModal`)

- [ ] **Step 4.1: Extend the function signature**

In `function CorpMbrDataSourcesModal({ ... })`, add two new destructured props in the parameter object, after `priorQuarterGoalsUrl, setPriorQuarterGoalsUrl`:

```jsx
corpExtendedAgentUrl, setCorpExtendedAgentUrl,
```

- [ ] **Step 4.2: Add a `UrlRow` entry for it**

Inside the modal body, below the last existing `UrlRow` (the `priorQuarterGoalsUrl` one), add:

```jsx
<UrlRow label="Extended Agent Stats (Dials / Contacts / Finals)" value={corpExtendedAgentUrl} setValue={setCorpExtendedAgentUrl}
  hint="Per-agent-per-day richer stats. Drives Slide 6 Contact Rate + Lead Penetration." />
```

- [ ] **Step 4.3: Pass the new props at the mount site**

Find `<CorpMbrDataSourcesModal` (grep `<CorpMbrDataSourcesModal`). Add:

```jsx
corpExtendedAgentUrl={corpExtendedAgentUrl}
setCorpExtendedAgentUrl={setCorpExtendedAgentUrl}
```

- [ ] **Step 4.4: Verify build**

Run: `cd "/c/Users/Joshu/Documents/Claude/Performance Intel" && npx vite build 2>&1 | tail -5`

Expected: clean build.

- [ ] **Step 4.5: Commit**

```bash
cd "/c/Users/Joshu/Documents/Claude/Performance Intel" && git add src/app.jsx && git commit -m "feat(corp-mbr): Extended Agent Stats URL input in Corp MBR Data Sources modal"
```

---

## Task 5: Plumb Extended Agent Stats + readiness status into the export modal

**Files:**
- Modify: `src/app.jsx` — `VirgilMbrExportModal` component (grep `^function VirgilMbrExportModal`)
- Modify: `src/app.jsx` — `<VirgilMbrExportModal>` mount (grep `<VirgilMbrExportModal`)

- [ ] **Step 5.1: Extend the modal prop list**

In the `VirgilMbrExportModal({ ... })` destructure, add after the existing `corpPriorMonthGoalsRaw,` prop:

```jsx
corpExtendedAgentRaw,
```

- [ ] **Step 5.2: Parse it + derive readiness**

Inside the modal body, near the other `useMemo` parsers (grep `parseCoachingDetails\(coachingDetailsRaw\)`), add:

```jsx
const corpExtendedAgent = useMemo(() => parseExtendedAgentStats(corpExtendedAgentRaw), [corpExtendedAgentRaw]);
const hasExtendedAgent = !!(corpExtendedAgentRaw && corpExtendedAgentRaw.trim());
```

- [ ] **Step 5.3: Add Data Readiness row**

In the `Data Readiness` block (grep `StatusRow label="Scorecard PNG`), add BEFORE the Scorecard row:

```jsx
<StatusRow label="Extended Agent Stats (Slide 6 Contact Rate / Lead Penetration)" ok={hasExtendedAgent} />
```

- [ ] **Step 5.4: Pass `corpExtendedAgent` into `handleDownload`'s orchestrator call**

Find `handleDownload` inside `VirgilMbrExportModal` (grep `const handleDownload = useCallback`). In the `buildVirgilMbrPresentation(perf, { ... })` options object, add:

```jsx
corpExtendedAgent,
```

(directly after `corpPriorMonthGoalsRaw: corpPriorMonthGoalsRaw || "",`)

Also add `corpExtendedAgent` (and `corpExtendedAgentRaw` only if used in-line) to the `useCallback` dep array.

- [ ] **Step 5.5: Pass the new prop at the App-level mount**

Find `<VirgilMbrExportModal` (grep `<VirgilMbrExportModal`). Add:

```jsx
corpExtendedAgentRaw={corpExtendedAgentRaw}
```

- [ ] **Step 5.6: Verify build**

Run: `cd "/c/Users/Joshu/Documents/Claude/Performance Intel" && npx vite build 2>&1 | tail -5`

Expected: clean build.

- [ ] **Step 5.7: Commit**

```bash
cd "/c/Users/Joshu/Documents/Claude/Performance Intel" && git add src/app.jsx && git commit -m "feat(corp-mbr): plumb Extended Agent Stats through export modal + readiness row"
```

---

## Task 6: Campaign-universe aggregator for Slide 6

**Goal:** Produce the list of campaigns to render Slide 6 for — union of active ROCs across Feb (prior month) and March (reporting month), sorted alphabetically by campaign name. Each element pairs the canonical campaign name with the aggregated ROC numbers that feed it.

**Files:**
- Modify: `src/app.jsx` — CORP MBR Aggregators section (grep `// CORP MBR — Aggregators`)

- [ ] **Step 6.1: Add `buildCampaignUniverse` aggregator**

Place immediately after `buildExtendedAgentLookup` (the function you added in Task 2.2):

```jsx
// Produce the list of distinct campaigns that had activity (hours or goal) in either month.
// Returns an array of { name, rocs: [string, ...], hoursFeb, hoursMar, goalFeb, goalMar }.
// Sorted alphabetically by campaign name for stable, review-friendly slide order.
function buildCampaignUniverse(priorAgentRaw, priorGoalsRaw, agentRaw, goalsRaw) {
  const agentsPrior = priorAgentRaw && priorAgentRaw.trim() ? parseCSV(priorAgentRaw) : [];
  const agentsCurr = agentRaw && agentRaw.trim() ? parseCSV(agentRaw) : [];
  const goalsPrior = priorGoalsRaw && priorGoalsRaw.trim() ? parseCSV(priorGoalsRaw) : [];
  const goalsCurr = goalsRaw && goalsRaw.trim() ? parseCSV(goalsRaw) : [];

  // Map ROC → { campaignName, hoursGoalFeb, hoursGoalMar }
  const byRoc = {};
  const registerGoal = (goalRows, key) => {
    for (const g of goalRows) {
      const name = (g["Campaign"] || g["Campaign Name"] || "").trim();
      if (!name) continue;
      const rocList = (g["ROC Numbers"] || "").split(",").map(s => s.trim()).filter(Boolean);
      const hoursGoal = Number(g["Hours Goal"]) || 0;
      for (const roc of rocList) {
        if (!byRoc[roc]) byRoc[roc] = { name, rocs: new Set([roc]), hoursFeb: 0, hoursMar: 0, goalFeb: 0, goalMar: 0 };
        byRoc[roc].name = name;
        byRoc[roc].rocs.add(roc);
        byRoc[roc][key] += hoursGoal;
      }
    }
  };
  registerGoal(goalsPrior, "goalFeb");
  registerGoal(goalsCurr, "goalMar");

  const registerActual = (agentRows, key) => {
    for (const r of agentRows) {
      const roc = (r["Job"] || "").trim();
      if (!roc) continue;
      if (!byRoc[roc]) byRoc[roc] = { name: roc, rocs: new Set([roc]), hoursFeb: 0, hoursMar: 0, goalFeb: 0, goalMar: 0 };
      byRoc[roc][key] += Number(r["Hours"]) || 0;
    }
  };
  registerActual(agentsPrior, "hoursFeb");
  registerActual(agentsCurr, "hoursMar");

  // Collapse ROCs into unique campaign names (multiple ROCs may roll up to one campaign)
  const byName = {};
  for (const entry of Object.values(byRoc)) {
    if (!entry.name) continue;
    const key = entry.name;
    if (!byName[key]) byName[key] = { name: key, rocs: new Set(), hoursFeb: 0, hoursMar: 0, goalFeb: 0, goalMar: 0 };
    for (const roc of entry.rocs) byName[key].rocs.add(roc);
    byName[key].hoursFeb += entry.hoursFeb;
    byName[key].hoursMar += entry.hoursMar;
    byName[key].goalFeb += entry.goalFeb;
    byName[key].goalMar += entry.goalMar;
  }

  // Only emit campaigns with actual activity in at least one month (some goal rows are inactive placeholders)
  return Object.values(byName)
    .filter(c => c.hoursFeb > 0 || c.hoursMar > 0 || c.goalFeb > 0 || c.goalMar > 0)
    .map(c => ({ ...c, rocs: [...c.rocs].sort() }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
```

- [ ] **Step 6.2: Verify build**

Run: `cd "/c/Users/Joshu/Documents/Claude/Performance Intel" && npx vite build 2>&1 | tail -5`

Expected: clean build.

- [ ] **Step 6.3: Commit**

```bash
cd "/c/Users/Joshu/Documents/Claude/Performance Intel" && git add src/app.jsx && git commit -m "feat(corp-mbr): buildCampaignUniverse aggregator for Slide 6 per-campaign fan-out"
```

---

## Task 7: Per-campaign single-month aggregator

**Goal:** For a single campaign (name + list of ROCs) + one month, compute every row value needed by the Slide 6 table: BUDGET, HOURS, SALES, RGUs, HSD/XM/Video/XH/Phone split, CPS, CPRGU, SPH, RGUPH, RGU/HOME, Total Leads, Sales per Lead, % of Total Leads, % of Total Hours, Contact Rate, Lead Penetration.

**Files:**
- Modify: `src/app.jsx` — CORP MBR Aggregators section

- [ ] **Step 7.1: Add `buildCampaignMonthDetail`**

Place immediately after `buildCampaignUniverse`:

```jsx
// Compute the full Slide 6 column (GOALS, BUDGET, ACTUAL, VARIANCE, % GOAL) for a single campaign + month.
// Inputs:
//   campaign:   { name, rocs: [string, ...] }
//   agentRaw:   raw agent CSV text for the month
//   goalsRaw:   raw goals CSV text for the month
//   monthFilter: (dateStr) => boolean (or null to accept all rows in agentRaw)
//   extendedLookup: { [roc]: { dials, contacts, finals } } (empty object if unavailable)
//   totalsForMonth: { sumActualLeads, sumHoursActual } — used for % of Total Leads / % of Total Hours
// Returns an object of raw values; downstream formatter turns it into table cells.
function buildCampaignMonthDetail(campaign, agentRaw, goalsRaw, monthFilter, extendedLookup, totalsForMonth) {
  const HOURLY_COST = 19.77;
  const result = {
    hoursActual: 0, hoursGoal: 0,
    salesActual: 0, salesGoal: 0,
    xiActual: 0, xiGoal: 0,
    xmActual: 0, xmGoal: 0,
    videoActual: 0, videoGoal: 0,
    xhActual: 0, xhGoal: 0,
    phoneActual: 0, phoneGoal: 0,
    actualLeads: 0,
    dials: 0, contacts: 0, finals: 0,
  };
  if (!agentRaw || !agentRaw.trim()) return result;

  const rocSet = new Set(campaign.rocs);
  const agentRows = parseCSV(agentRaw);
  for (const r of agentRows) {
    if (monthFilter && !monthFilter((r["Date"] || "").trim())) continue;
    const roc = (r["Job"] || "").trim();
    if (!rocSet.has(roc)) continue;
    result.hoursActual += Number(r["Hours"]) || 0;
    result.salesActual += Number(r["Goals"]) || 0;
    result.xiActual += Number(r["New XI"]) || 0;
    result.xmActual += Number(r["XM Lines"]) || 0;
    result.videoActual += (Number(r["NewVideo"]) || 0) + (Number(r["UpgradeVideo"]) || 0);
    // XH = XFinity Home / security
    result.xhActual += (Number(r["NewSecurity"]) || 0) + (Number(r["UpgradeSecurity"]) || 0);
    result.phoneActual += (Number(r["NewVoice"]) || 0) + (Number(r["UpgradeVoice"]) || 0);
  }

  if (goalsRaw && goalsRaw.trim()) {
    const goalRows = parseCSV(goalsRaw);
    for (const g of goalRows) {
      const name = (g["Campaign"] || g["Campaign Name"] || "").trim();
      if (name !== campaign.name) continue;
      result.hoursGoal += Number(g["Hours Goal"]) || 0;
      result.salesGoal += Number(g["Projected Sales"] || g["Sales Goal"] || g["Goals"]) || 0;
      result.xiGoal += Number(g["HSD GOAL"] || g["HSD Sell In Goal"]) || 0;
      result.xmGoal += Number(g["XM GOAL"] || g["XM Sell In Goal"]) || 0;
      result.videoGoal += Number(g["VIDEO GOAL"] || g["Video Sell In Goal"]) || 0;
      result.xhGoal += Number(g["XH GOAL"] || g["XH Sell In Goal"]) || 0;
      result.phoneGoal += Number(g["Projected Phone"] || g["Phone Sell In Goal"]) || 0;
      result.actualLeads += Number(g["Actual Leads"]) || 0;
    }
  }

  // Extended stats rollup (one entry per ROC)
  for (const roc of campaign.rocs) {
    const ext = extendedLookup[roc];
    if (!ext) continue;
    result.dials += ext.dials;
    result.contacts += ext.contacts;
    result.finals += ext.finals;
  }

  // Derived
  result.budget = result.hoursActual * HOURLY_COST;
  result.budgetGoal = result.hoursGoal * HOURLY_COST;
  result.rgusActual = result.xiActual + result.xmActual + result.videoActual + result.xhActual + result.phoneActual;
  result.rgusGoal = result.xiGoal + result.xmGoal + result.videoGoal + result.xhGoal + result.phoneGoal;
  result.cps = result.salesActual ? result.budget / result.salesActual : 0;
  result.cprgu = result.rgusActual ? result.budget / result.rgusActual : 0;
  result.sph = result.hoursActual ? result.salesActual / result.hoursActual : 0;
  result.rguph = result.hoursActual ? result.rgusActual / result.hoursActual : 0;
  result.rguPerSale = result.salesActual ? result.rgusActual / result.salesActual : 0;
  result.salesPerLead = result.actualLeads ? result.salesActual / result.actualLeads : 0;
  result.pctTotalLeads = totalsForMonth && totalsForMonth.sumActualLeads ? result.actualLeads / totalsForMonth.sumActualLeads : 0;
  result.pctTotalHours = totalsForMonth && totalsForMonth.sumHoursActual ? result.hoursActual / totalsForMonth.sumHoursActual : 0;
  result.contactRate = result.actualLeads ? (result.contacts / result.actualLeads) * 100 : null;
  result.leadPenetration = result.actualLeads ? (result.finals / result.actualLeads) * 100 : null;
  return result;
}
```

- [ ] **Step 7.2: Add `buildCampaignMonthTotals` helper**

Immediately after `buildCampaignMonthDetail`:

```jsx
// Pre-compute sums used as denominators for % of Total Leads / % of Total Hours on Slide 6.
// Returns { sumActualLeads, sumHoursActual } from the full month of data (all campaigns combined).
function buildCampaignMonthTotals(agentRaw, goalsRaw, monthFilter) {
  let sumActualLeads = 0, sumHoursActual = 0;
  if (agentRaw && agentRaw.trim()) {
    const rows = parseCSV(agentRaw);
    for (const r of rows) {
      if (monthFilter && !monthFilter((r["Date"] || "").trim())) continue;
      sumHoursActual += Number(r["Hours"]) || 0;
    }
  }
  if (goalsRaw && goalsRaw.trim()) {
    const rows = parseCSV(goalsRaw);
    for (const g of rows) {
      sumActualLeads += Number(g["Actual Leads"]) || 0;
    }
  }
  return { sumActualLeads, sumHoursActual };
}
```

- [ ] **Step 7.3: Verify build**

Run: `cd "/c/Users/Joshu/Documents/Claude/Performance Intel" && npx vite build 2>&1 | tail -5`

Expected: clean build.

- [ ] **Step 7.4: Commit**

```bash
cd "/c/Users/Joshu/Documents/Claude/Performance Intel" && git add src/app.jsx && git commit -m "feat(corp-mbr): buildCampaignMonthDetail + buildCampaignMonthTotals aggregators for Slide 6"
```

---

## Task 8: Slide 6 table-cell formatter

**Goal:** Turn a `buildCampaignMonthDetail` result + the row definitions into the 5-column pptxgenjs table rows that Slide 6 renders. Two tables per slide — Feb left, March right.

**Files:**
- Modify: `src/app.jsx` — CORP MBR Slide Builders section (place above the to-be-added `buildCorpCampaignDetailSlide`)

- [ ] **Step 8.1: Add `formatCampaignDetailTable` helper**

Find the `// CORP MBR — Slide Builders` section header (grep `// CORP MBR — Slide Builders`). Scroll to the END of the section, immediately before the `// CORP MBR — Orchestrator` header (grep `// CORP MBR — Orchestrator`). Add:

```jsx
// Format a single (campaign × month) detail object into the 6-column table rows for Slide 6.
// Returns an array of pptxgenjs table rows including a header row.
// Each row has 6 cells: [ROW LABEL, GOALS, BUDGET, ACTUAL, VARIANCE, % GOAL].
// For derived ratio rows (CPS, SPH, etc.) and "Total Leads"-style rows, the GOALS / BUDGET / VARIANCE / % GOAL cells are blank — only ACTUAL has data (per spec §6.6).
function formatCampaignDetailTable(detail, columnLabel) {
  const fmtInt = n => (n === null || n === undefined || Number.isNaN(n)) ? "—" : Math.round(n).toLocaleString();
  const fmtIntSigned = n => (n === null || n === undefined || Number.isNaN(n)) ? "—" : `${n >= 0 ? "+" : ""}${Math.round(n).toLocaleString()}`;
  const fmtMoney = n => (n === null || n === undefined || Number.isNaN(n)) ? "—" : `$${Math.round(n).toLocaleString()}`;
  const fmtMoneySigned = n => (n === null || n === undefined || Number.isNaN(n)) ? "—" : `${n >= 0 ? "+" : "-"}$${Math.round(Math.abs(n)).toLocaleString()}`;
  const fmtMoney2 = n => (n === null || n === undefined || Number.isNaN(n)) ? "—" : `$${n.toFixed(2)}`;
  const fmtPct = n => (n === null || n === undefined || Number.isNaN(n)) ? "—" : `${(n * 100).toFixed(1)}%`;
  const fmtRatio = n => (n === null || n === undefined || Number.isNaN(n)) ? "—" : n.toFixed(3);
  const varOf = (act, goal) => (act || 0) - (goal || 0);
  const pctOf = (act, goal) => (goal === 0 ? 0 : act / goal);

  const hdrBase = { fill: { color: corpPalette.purple }, color: "FFFFFF", bold: true, align: "center", fontSize: 9 };
  const labelBase = { bold: true, color: corpPalette.ink, fontSize: 9, align: "left" };
  const cellBase = { color: corpPalette.ink, fontSize: 9, align: "center" };

  const headerRow = [
    { text: columnLabel, options: hdrBase },
    { text: "GOALS", options: hdrBase },
    { text: "BUDGET", options: hdrBase },
    { text: "ACTUAL", options: hdrBase },
    { text: "VARIANCE", options: hdrBase },
    { text: "% GOAL", options: hdrBase },
  ];

  const rows = [];
  const push = (label, goal, budget, actual, variance, pct) => {
    rows.push([
      { text: label, options: labelBase },
      { text: goal, options: cellBase },
      { text: budget, options: cellBase },
      { text: actual, options: cellBase },
      { text: variance, options: cellBase },
      { text: pct, options: cellBase },
    ]);
  };

  // Top block — $/hours/sales/RGU breakdown. Each of these has goal + actual with variance + % Goal.
  push("BUDGET ($)", fmtMoney(detail.budgetGoal), fmtMoney(detail.budgetGoal), fmtMoney(detail.budget), fmtMoneySigned(varOf(detail.budget, detail.budgetGoal)), fmtPct(pctOf(detail.budget, detail.budgetGoal)));
  push("HOURS", fmtInt(detail.hoursGoal), fmtMoney(detail.budgetGoal), fmtInt(detail.hoursActual), fmtIntSigned(varOf(detail.hoursActual, detail.hoursGoal)), fmtPct(pctOf(detail.hoursActual, detail.hoursGoal)));
  push("SALES", fmtInt(detail.salesGoal), "", fmtInt(detail.salesActual), fmtIntSigned(varOf(detail.salesActual, detail.salesGoal)), fmtPct(pctOf(detail.salesActual, detail.salesGoal)));
  push("RGUs", fmtInt(detail.rgusGoal), "", fmtInt(detail.rgusActual), fmtIntSigned(varOf(detail.rgusActual, detail.rgusGoal)), fmtPct(pctOf(detail.rgusActual, detail.rgusGoal)));
  push("HSD RGUs", fmtInt(detail.xiGoal), "", fmtInt(detail.xiActual), fmtIntSigned(varOf(detail.xiActual, detail.xiGoal)), fmtPct(pctOf(detail.xiActual, detail.xiGoal)));
  push("XM RGUs", fmtInt(detail.xmGoal), "", fmtInt(detail.xmActual), fmtIntSigned(varOf(detail.xmActual, detail.xmGoal)), fmtPct(pctOf(detail.xmActual, detail.xmGoal)));
  push("VIDEO RGUs", fmtInt(detail.videoGoal), "", fmtInt(detail.videoActual), fmtIntSigned(varOf(detail.videoActual, detail.videoGoal)), fmtPct(pctOf(detail.videoActual, detail.videoGoal)));
  push("XH RGUs", fmtInt(detail.xhGoal), "", fmtInt(detail.xhActual), fmtIntSigned(varOf(detail.xhActual, detail.xhGoal)), fmtPct(pctOf(detail.xhActual, detail.xhGoal)));
  push("PHONE RGUs", fmtInt(detail.phoneGoal), "", fmtInt(detail.phoneActual), fmtIntSigned(varOf(detail.phoneActual, detail.phoneGoal)), fmtPct(pctOf(detail.phoneActual, detail.phoneGoal)));

  // Bottom block — derived ratios (no goal to compare against)
  push("CPS", "", "", fmtMoney2(detail.cps), "", "");
  push("CPRGU", "", "", fmtMoney2(detail.cprgu), "", "");
  push("SPH", "", "", fmtRatio(detail.sph), "", "");
  push("RGUPH", "", "", fmtRatio(detail.rguph), "", "");
  push("RGU/HOME", "", "", fmtRatio(detail.rguPerSale), "", "");

  // Additional rows — Leads + Extended Agent-derived
  push("Total Leads", "", "", fmtInt(detail.actualLeads), "", "");
  push("Sales per Lead", "", "", detail.actualLeads ? detail.salesPerLead.toFixed(2) : "—", "", "");
  push("% of Total Leads", "", "", fmtPct(detail.pctTotalLeads), "", "");
  push("% of Total Hours", "", "", fmtPct(detail.pctTotalHours), "", "");
  push("Contact Rate", "", "", detail.contactRate === null ? "—" : `${detail.contactRate.toFixed(1)}%`, "", "");
  push("Lead Penetration", "", "", detail.leadPenetration === null ? "—" : `${detail.leadPenetration.toFixed(1)}%`, "", "");

  return [headerRow, ...rows];
}
```

- [ ] **Step 8.2: Verify build**

Run: `cd "/c/Users/Joshu/Documents/Claude/Performance Intel" && npx vite build 2>&1 | tail -5`

Expected: clean build.

- [ ] **Step 8.3: Commit**

```bash
cd "/c/Users/Joshu/Documents/Claude/Performance Intel" && git add src/app.jsx && git commit -m "feat(corp-mbr): formatCampaignDetailTable — Slide 6 row formatting"
```

---

## Task 9: Slide 6 single-slide builder

**Goal:** Render one "Actual to Goal – <Campaign>" slide. Two side-by-side tables plus two Performance Notes text panels below.

**Files:**
- Modify: `src/app.jsx` — CORP MBR Slide Builders section

- [ ] **Step 9.1: Add `buildCorpCampaignDetailSlide`**

Place immediately after `formatCampaignDetailTable` (the function you just added):

```jsx
// Render a single per-campaign slide for Slide 6 fan-out.
// detailPrior / detailCurrent are the output of buildCampaignMonthDetail for each month.
// notes = { feb, march } are the two free-text Performance Notes for this campaign.
function buildCorpCampaignDetailSlide(pres, campaign, detailPrior, detailCurrent, priorMonthLabel, reportingMonthLabel, notes) {
  const slide = pres.addSlide();
  slide.background = { color: virgilTheme.slideBg };
  virgilBrandBars(pres, slide);

  // Eyebrow + title
  slide.addText("OPERATIONAL PERFORMANCE", {
    x: 0.5, y: 0.35, w: 6, h: 0.25,
    fontSize: 10, color: virgilTheme.eyebrow, bold: true, charSpacing: 2,
  });
  slide.addText(`Actual to Goal – ${campaign.name}`, {
    x: 0.5, y: 0.65, w: 12.3, h: 0.55,
    fontSize: 22, color: virgilTheme.bodyText, bold: true,
  });

  // Column sub-titles
  slide.addText("PREVIOUS MONTH", {
    x: 0.5, y: 1.3, w: 6, h: 0.25,
    fontSize: 9, color: virgilTheme.subtle, bold: true, align: "center", charSpacing: 2,
  });
  slide.addText("MONTH OF DISCUSSION", {
    x: 6.8, y: 1.3, w: 6, h: 0.25,
    fontSize: 9, color: virgilTheme.subtle, bold: true, align: "center", charSpacing: 2,
  });

  // Two side-by-side tables
  const priorRows = formatCampaignDetailTable(detailPrior, priorMonthLabel);
  const currRows = formatCampaignDetailTable(detailCurrent, reportingMonthLabel);

  slide.addTable(priorRows, {
    x: 0.5, y: 1.55, w: 6.0,
    colW: [1.55, 0.89, 0.89, 0.89, 0.89, 0.89],
    rowH: 0.22,
    border: { type: "solid", pt: 0.5, color: corpPalette.cardBorder },
    autoPage: false,
  });
  slide.addTable(currRows, {
    x: 6.8, y: 1.55, w: 6.0,
    colW: [1.55, 0.89, 0.89, 0.89, 0.89, 0.89],
    rowH: 0.22,
    border: { type: "solid", pt: 0.5, color: corpPalette.cardBorder },
    autoPage: false,
  });

  // Performance Notes panels (bottom)
  const notesY = 6.3;
  const panelW = 6.0;
  const drawNotePanel = (x, title, body) => {
    slide.addShape("roundRect", {
      x, y: notesY, w: panelW, h: 0.7,
      fill: { color: corpPalette.muted },
      line: { color: corpPalette.cardBorder, width: 0.5 },
      rectRadius: 0.06,
    });
    slide.addText(title, {
      x: x + 0.1, y: notesY + 0.04, w: panelW - 0.2, h: 0.18,
      fontSize: 8, color: virgilTheme.eyebrow, bold: true, charSpacing: 1.5,
    });
    slide.addText(body || "(no notes entered)", {
      x: x + 0.1, y: notesY + 0.22, w: panelW - 0.2, h: 0.46,
      fontSize: 9, color: body ? virgilTheme.bodyText : virgilTheme.subtle,
      italic: !body, valign: "top",
    });
  };
  drawNotePanel(0.5, `${priorMonthLabel.toUpperCase()} — PERFORMANCE NOTES`, (notes && notes.feb) || "");
  drawNotePanel(6.8, `${reportingMonthLabel.toUpperCase()} — PERFORMANCE NOTES`, (notes && notes.march) || "");
}
```

- [ ] **Step 9.2: Verify build**

Run: `cd "/c/Users/Joshu/Documents/Claude/Performance Intel" && npx vite build 2>&1 | tail -5`

Expected: clean build.

- [ ] **Step 9.3: Commit**

```bash
cd "/c/Users/Joshu/Documents/Claude/Performance Intel" && git add src/app.jsx && git commit -m "feat(corp-mbr): buildCorpCampaignDetailSlide — single-campaign Slide 6 render"
```

---

## Task 10: Slide 6 orchestrator fan-out

**Goal:** Iterate the campaign universe, build each slide. Wire into `buildVirgilMbrPresentation`.

**Files:**
- Modify: `src/app.jsx` — `buildVirgilMbrPresentation` function (grep `^function buildVirgilMbrPresentation`)

- [ ] **Step 10.1: Add Slide 6 block inside the orchestrator**

In `buildVirgilMbrPresentation`, after the Slide 5 `buildCorpCampaignHoursSlide(...)` call, add:

```jsx
  // Slide 6 — Per-Campaign Actual-to-Goal (N slides, one per campaign)
  const campaignUniverse = buildCampaignUniverse(
    options.priorAgentRaw || "", options.priorGoalsRaw || "",
    options.agentRaw || "", options.goalsRaw || ""
  );
  const priorFilter = makeMonthFilter(priorMonthKey);
  const currFilter = makeMonthFilter(options.reportingMonthLabel);
  const priorTotals = buildCampaignMonthTotals(options.priorAgentRaw || "", options.priorGoalsRaw || "", priorFilter);
  const currTotals = buildCampaignMonthTotals(options.agentRaw || "", options.goalsRaw || "", currFilter);
  const extendedRows = Array.isArray(options.corpExtendedAgent) ? options.corpExtendedAgent : [];
  const extPriorLookup = buildExtendedAgentLookup(extendedRows, priorFilter);
  const extCurrLookup = buildExtendedAgentLookup(extendedRows, currFilter);
  const perCampaignNotes = (options.insights && options.insights.slide6Notes) || {};
  for (const campaign of campaignUniverse) {
    const detailPrior = buildCampaignMonthDetail(campaign, options.priorAgentRaw || "", options.priorGoalsRaw || "", priorFilter, extPriorLookup, priorTotals);
    const detailCurr = buildCampaignMonthDetail(campaign, options.agentRaw || "", options.goalsRaw || "", currFilter, extCurrLookup, currTotals);
    const notes = perCampaignNotes[campaign.name] || { feb: "", march: "" };
    buildCorpCampaignDetailSlide(pres, campaign, detailPrior, detailCurr, priorMonthKey, options.reportingMonthLabel, notes);
  }
```

- [ ] **Step 10.2: Verify build**

Run: `cd "/c/Users/Joshu/Documents/Claude/Performance Intel" && npx vite build 2>&1 | tail -5`

Expected: clean build.

- [ ] **Step 10.3: Dev-server smoke test**

```bash
cd "/c/Users/Joshu/Documents/Claude/Performance Intel" && npx vite
```

In browser: ⚙ → Export Corp MBR → Download .pptx. Open in PowerPoint. Expect Slides 1–5 unchanged + one additional slide per campaign. Close dev server.

- [ ] **Step 10.4: Commit**

```bash
cd "/c/Users/Joshu/Documents/Claude/Performance Intel" && git add src/app.jsx && git commit -m "feat(corp-mbr): fan-out Slide 6 into N per-campaign detail slides"
```

---

## Task 11: Per-campaign Performance Notes UI in the export modal

**Goal:** Add a "Performance Notes" section to the export modal that lists each campaign (from the campaign universe) with two textareas (Feb / March). Persist to `insights.slide6Notes[<campaignName>] = { feb, march }`.

**Files:**
- Modify: `src/app.jsx` — `VirgilMbrExportModal` component

- [ ] **Step 11.1: Derive the campaign universe inside the modal**

Inside `VirgilMbrExportModal`, near the other `useMemo` parsers, add:

```jsx
const campaignUniverse = useMemo(() => {
  return buildCampaignUniverse(
    priorMonthRaw || "", priorMonthGoalsRaw || "",
    rawAgentCsv || "", goalsRaw || ""
  );
}, [priorMonthRaw, priorMonthGoalsRaw, rawAgentCsv, goalsRaw]);

const priorMonthLabelDisplay = useMemo(() => getPriorMonthLabel(reportingMonth), [reportingMonth]);
```

- [ ] **Step 11.2: Add the Performance Notes block UI**

Inside the modal body, insert AFTER the existing AI Insights toggle and BEFORE the buttons row (grep `<button onClick={handleDownload}` to locate the buttons row). The block:

```jsx
<div style={{ marginTop: 16, padding: 12, background: "#fafafa", borderRadius: 6, border: "1px solid #d1d5db" }}>
  <div style={{ fontSize: 13, fontWeight: 600 }}>Slide 6 — Per-Campaign Performance Notes</div>
  <div style={{ fontSize: 12, color: "#6b7280", marginTop: 2 }}>
    {campaignUniverse.length
      ? `${campaignUniverse.length} campaigns detected across ${priorMonthLabelDisplay} / ${reportingMonth}. Notes render on the per-campaign slides; blank = empty panel.`
      : "No campaigns detected yet — load prior-month + current-month data first."}
  </div>
  <div style={{ maxHeight: 260, overflow: "auto", marginTop: 8 }}>
    {campaignUniverse.map(c => {
      const entry = ((insights && insights.slide6Notes) || {})[c.name] || { feb: "", march: "" };
      const update = (key, v) => {
        setInsights({
          ...(insights || {}),
          slide6Notes: {
            ...((insights && insights.slide6Notes) || {}),
            [c.name]: { ...entry, [key]: v },
          },
        });
      };
      return (
        <div key={c.name} style={{ padding: 8, background: "#fff", borderRadius: 4, marginBottom: 8, border: "1px solid #e5e7eb" }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: "#374151" }}>{c.name}</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 6 }}>
            <label style={{ fontSize: 11, color: "#6b7280" }}>
              {priorMonthLabelDisplay} notes
              <textarea value={entry.feb} onChange={e => update("feb", e.target.value)}
                rows={2} style={{ display: "block", width: "100%", padding: 6, border: "1px solid #d1d5db", borderRadius: 4, marginTop: 2, fontSize: 11, fontFamily: "inherit", resize: "vertical" }} />
            </label>
            <label style={{ fontSize: 11, color: "#6b7280" }}>
              {reportingMonth} notes
              <textarea value={entry.march} onChange={e => update("march", e.target.value)}
                rows={2} style={{ display: "block", width: "100%", padding: 6, border: "1px solid #d1d5db", borderRadius: 4, marginTop: 2, fontSize: 11, fontFamily: "inherit", resize: "vertical" }} />
            </label>
          </div>
        </div>
      );
    })}
  </div>
</div>
```

- [ ] **Step 11.3: Verify build**

Run: `cd "/c/Users/Joshu/Documents/Claude/Performance Intel" && npx vite build 2>&1 | tail -5`

Expected: clean build.

- [ ] **Step 11.4: Dev-server smoke test**

```bash
cd "/c/Users/Joshu/Documents/Claude/Performance Intel" && npx vite
```

In browser: ⚙ → Export Corp MBR. Scroll down — expect the Performance Notes section listing every campaign. Type text in any Feb / March box. Close modal, reopen → text persists. Download .pptx → per-campaign slides render the entered notes (or "(no notes entered)" in italics if blank). Close dev server.

- [ ] **Step 11.5: Commit**

```bash
cd "/c/Users/Joshu/Documents/Claude/Performance Intel" && git add src/app.jsx && git commit -m "feat(corp-mbr): Slide 6 Performance Notes textareas (Feb/March per campaign)"
```

---

## Task 12: Slide 7 — Customer Experience (tNPS) — port + theme

**Goal:** Produce `buildCorpTnpsSlide(pres, perf, reportingMonthLabel, insightText)` that mirrors `buildMbrTnpsSlide` (src/app.jsx:6090) but:
1. Uses Xfinity brand bars (`virgilBrandBars`) + `virgilTheme`
2. Filters tNPS data to the reporting month the user picked in the modal (NOT whatever `perf.fiscalInfo` says is current)
3. Omits the "% Promoters Emailed by Month" element if it exists in the ported code
4. Adds an insights text panel at the bottom

**Files:**
- Modify: `src/app.jsx` — CORP MBR Slide Builders section

- [ ] **Step 12.1: Add `tnpsReportingMonthFilter` helper near the aggregators**

Place immediately after `buildCampaignMonthTotals`:

```jsx
// Filter tNPS survey rows to a picker-driven reporting month ("Mar '26" / "Mar 26").
// tNPS rows carry a `.month` field like "2026-03" — convert label → YYYY-MM and string-compare.
function filterTnpsToMonth(surveys, monthLabel) {
  if (!Array.isArray(surveys) || surveys.length === 0) return [];
  const m = String(monthLabel || "").trim().match(/^([A-Za-z]{3,})\s*'?(\d{2,4})$/);
  if (!m) return surveys;
  const monMap = { jan:"01", feb:"02", mar:"03", apr:"04", may:"05", jun:"06", jul:"07", aug:"08", sep:"09", oct:"10", nov:"11", dec:"12" };
  const monKey = monMap[m[1].slice(0, 3).toLowerCase()];
  if (!monKey) return surveys;
  const yr = m[2].length === 4 ? m[2] : `20${m[2]}`;
  const targetKey = `${yr}-${monKey}`;
  return surveys.filter(s => s.month === targetKey);
}
```

- [ ] **Step 12.2: Add `buildCorpTnpsSlide`**

Find the `// CORP MBR — Orchestrator` section header. Scroll up — the last slide builder is `buildCorpCampaignDetailSlide` (added in Task 9). Insert `buildCorpTnpsSlide` immediately after it:

```jsx
function buildCorpTnpsSlide(pres, perf, reportingMonthLabel, insightText) {
  if (!perf || !perf.tnpsData || perf.tnpsData.length === 0) {
    // Render an empty placeholder so the slide count is predictable
    const slide = pres.addSlide();
    slide.background = { color: virgilTheme.slideBg };
    virgilBrandBars(pres, slide);
    slide.addText("CUSTOMER EXPERIENCE", {
      x: 0.5, y: 0.35, w: 12, h: 0.25,
      fontSize: 10, color: virgilTheme.eyebrow, bold: true, charSpacing: 2,
    });
    slide.addText(`tNPS — ${reportingMonthLabel}`, {
      x: 0.5, y: 0.65, w: 12, h: 0.55,
      fontSize: 22, color: virgilTheme.bodyText, bold: true,
    });
    slide.addText("No tNPS data loaded.", {
      x: 0.5, y: 3.5, w: 12, h: 0.4,
      fontSize: 14, color: virgilTheme.subtle, italic: true, align: "center",
    });
    return;
  }
  const slide = pres.addSlide();
  slide.background = { color: virgilTheme.slideBg };
  virgilBrandBars(pres, slide);

  // Eyebrow + title
  slide.addText("CUSTOMER EXPERIENCE", {
    x: 0.5, y: 0.35, w: 12, h: 0.25,
    fontSize: 10, color: virgilTheme.eyebrow, bold: true, charSpacing: 2,
  });
  slide.addText(`tNPS — ${reportingMonthLabel}`, {
    x: 0.5, y: 0.65, w: 12, h: 0.55,
    fontSize: 22, color: virgilTheme.bodyText, bold: true,
  });

  // Filter ALL data sources to the picker-driven month.
  const monthSurveysAll = filterTnpsToMonth(perf.tnpsData, reportingMonthLabel);
  const monthSurveysGcs = filterTnpsToMonth(perf.tnpsGCS || [], reportingMonthLabel);
  if (monthSurveysGcs.length === 0) {
    slide.addText(`No GCS tNPS surveys recorded for ${reportingMonthLabel}.`, {
      x: 0.5, y: 1.5, w: 12, h: 0.4,
      fontSize: 14, color: virgilTheme.subtle, italic: true, align: "center",
    });
    return;
  }
  const monthOverall = calcTnpsScore(monthSurveysGcs);

  // KPI cards (GCS tNPS, Promoter%, Passive%, Detractor%)
  const kpiY = 1.25;
  const kpiW = 2.95;
  const kpiCards = [
    { label: `GCS tNPS (${monthOverall.total} surveys)`, value: `${monthOverall.score > 0 ? "+" : ""}${monthOverall.score}`, color: monthOverall.score >= 50 ? corpPalette.green : monthOverall.score >= 20 ? corpPalette.q2 : corpPalette.q4 },
    { label: "PROMOTER", value: `${Math.round(monthOverall.promoterPct)}%`, color: corpPalette.green },
    { label: "PASSIVE", value: `${Math.round(monthOverall.passivePct)}%`, color: corpPalette.q2 },
    { label: "DETRACTOR", value: `${Math.round(monthOverall.detractorPct)}%`, color: corpPalette.q4 },
  ];
  kpiCards.forEach((k, i) => {
    const kx = 0.5 + i * (kpiW + 0.15);
    slide.addShape("roundRect", { x: kx, y: kpiY, w: kpiW, h: 0.85, fill: { color: corpPalette.muted }, line: { color: corpPalette.cardBorder, width: 0.5 }, rectRadius: 0.06 });
    slide.addShape("rect", { x: kx, y: kpiY, w: kpiW, h: 0.06, fill: { color: k.color }, line: { color: k.color, width: 0 } });
    slide.addText(k.label, { x: kx, y: kpiY + 0.12, w: kpiW, h: 0.2, fontSize: 9, color: virgilTheme.subtle, align: "center" });
    slide.addText(k.value, { x: kx, y: kpiY + 0.34, w: kpiW, h: 0.45, fontSize: 24, color: k.color, bold: true, align: "center" });
  });

  // Partner Ranking table (left 60%)
  const tableY = 2.5;
  const leftTableW = 7.0;
  slide.addText("PARTNER RANKING", { x: 0.5, y: tableY - 0.25, w: leftTableW, h: 0.2, fontSize: 9, color: virgilTheme.eyebrow, bold: true, charSpacing: 1.5 });

  const siteGroupsAll = {};
  monthSurveysAll.forEach(s => {
    if (!siteGroupsAll[s.siteLabel]) siteGroupsAll[s.siteLabel] = [];
    siteGroupsAll[s.siteLabel].push(s);
  });
  const fiscalBySite = Object.entries(siteGroupsAll).map(([label, surveys]) => ({
    label, isGCS: surveys[0].isGCS, ...calcTnpsScore(surveys),
  })).sort((a, b) => (b.score ?? -999) - (a.score ?? -999));
  const knownVendors = ["GCS", "Avantive", "Global Telesourcing", "Results"];
  const gcsAgg = { label: "GCS (All Sites)", isGCS: true, isAgg: true, ...monthOverall };
  const partnerSites = fiscalBySite.filter(s => !s.isGCS && knownVendors.includes(s.label));
  const gcsSites = fiscalBySite.filter(s => s.isGCS);
  const ranked = [gcsAgg, ...partnerSites].sort((a, b) => (b.score ?? -999) - (a.score ?? -999));
  const aggIdx = ranked.findIndex(s => s.isAgg);
  const allRanked = [...ranked.slice(0, aggIdx + 1), ...gcsSites, ...ranked.slice(aggIdx + 1)];

  const hdrBase = { fill: { color: corpPalette.purple }, color: "FFFFFF", bold: true, align: "center", fontSize: 9 };
  const rankHdr = [
    { text: "#", options: { ...hdrBase, align: "center" } },
    { text: "Site / Partner", options: { ...hdrBase, align: "left" } },
    { text: "tNPS", options: hdrBase },
    { text: "Surveys", options: hdrBase },
    { text: "Prom%", options: hdrBase },
    { text: "Det%", options: hdrBase },
  ];
  let rank = 0;
  const rankRows = allRanked.map((s, i) => {
    const isSub = s.isGCS && !s.isAgg;
    if (!isSub) rank++;
    const rowBg = s.isGCS ? "FFFBEB" : (i % 2 === 0 ? "FFFFFF" : "F5F5FA");
    const base = { fontSize: 8, color: corpPalette.ink, valign: "middle", fill: { color: rowBg } };
    const scoreColor = (s.score ?? 0) >= 50 ? corpPalette.green : (s.score ?? 0) >= 20 ? corpPalette.q2 : corpPalette.q4;
    return [
      { text: isSub ? "" : String(rank), options: { ...base, align: "center", color: virgilTheme.subtle } },
      { text: isSub ? `  ${s.label}` : s.label, options: { ...base, align: "left", bold: s.isAgg, color: isSub ? virgilTheme.subtle : corpPalette.ink, fontSize: isSub ? 7.5 : 8.5 } },
      { text: `${(s.score ?? 0) > 0 ? "+" : ""}${s.score ?? 0}`, options: { ...base, align: "center", bold: true, color: scoreColor, fontSize: 9 } },
      { text: String(s.total || 0), options: { ...base, align: "center", color: virgilTheme.subtle } },
      { text: `${Math.round(s.promoterPct || 0)}%`, options: { ...base, align: "center", color: corpPalette.green } },
      { text: `${Math.round(s.detractorPct || 0)}%`, options: { ...base, align: "center", color: corpPalette.q4 } },
    ];
  });
  slide.addTable([rankHdr, ...rankRows], {
    x: 0.5, y: tableY, w: leftTableW,
    colW: [0.4, 3.0, 0.8, 0.9, 0.7, 0.7],
    rowH: 0.3,
    border: { type: "solid", pt: 0.5, color: corpPalette.cardBorder },
    autoPage: false,
  });

  // tNPS by Campaign — GCS (right side)
  const rightX = 7.85;
  const rightW = 4.95;
  slide.addText("tNPS BY CAMPAIGN — GCS", { x: rightX, y: tableY - 0.25, w: rightW, h: 0.2, fontSize: 9, color: virgilTheme.eyebrow, bold: true, charSpacing: 1.5 });
  const campGroups = {};
  monthSurveysGcs.forEach(s => {
    const key = s.campaign || "(unspecified)";
    if (!campGroups[key]) campGroups[key] = { campaign: key, program: s.program, surveys: [] };
    campGroups[key].surveys.push(s);
  });
  const camps = Object.values(campGroups).map(g => ({ ...g, ...calcTnpsScore(g.surveys) })).sort((a, b) => (b.score ?? -999) - (a.score ?? -999));
  const campHdr = [
    { text: "Campaign", options: { ...hdrBase, align: "left" } },
    { text: "Program", options: { ...hdrBase, align: "left" } },
    { text: "tNPS", options: hdrBase },
    { text: "Surveys", options: hdrBase },
    { text: "Prom%", options: hdrBase },
    { text: "Det%", options: hdrBase },
  ];
  const campRows = camps.map((c, i) => {
    const rowBg = i % 2 === 0 ? "FFFFFF" : "F5F5FA";
    const base = { fontSize: 8, color: corpPalette.ink, valign: "middle", fill: { color: rowBg } };
    const scoreColor = (c.score ?? 0) >= 50 ? corpPalette.green : (c.score ?? 0) >= 20 ? corpPalette.q2 : corpPalette.q4;
    return [
      { text: c.campaign, options: { ...base, align: "left" } },
      { text: c.program || "", options: { ...base, align: "left", color: corpPalette.q2, bold: !!c.program } },
      { text: `${(c.score ?? 0) > 0 ? "+" : ""}${c.score ?? 0}`, options: { ...base, align: "center", bold: true, color: scoreColor } },
      { text: String(c.total || 0), options: { ...base, align: "center", color: virgilTheme.subtle } },
      { text: `${Math.round(c.promoterPct || 0)}%`, options: { ...base, align: "center", color: corpPalette.green } },
      { text: `${Math.round(c.detractorPct || 0)}%`, options: { ...base, align: "center", color: corpPalette.q4 } },
    ];
  });
  slide.addTable([campHdr, ...campRows], {
    x: rightX, y: tableY, w: rightW,
    colW: [1.6, 0.85, 0.65, 0.75, 0.6, 0.5],
    rowH: 0.26,
    border: { type: "solid", pt: 0.5, color: corpPalette.cardBorder },
    autoPage: false,
  });

  // Monthly Vendor Ranking trend — 4-month trailing across GCS / Avantive / Global Telesourcing / Results
  const trendY = 5.45;
  slide.addText("MONTHLY VENDOR RANKING", { x: 0.5, y: trendY - 0.25, w: 12.3, h: 0.2, fontSize: 9, color: virgilTheme.eyebrow, bold: true, charSpacing: 1.5 });
  const vendorColors = { "GCS": corpPalette.q2, "Avantive": corpPalette.navy, "Global Telesourcing": corpPalette.fundHQ, "Results": corpPalette.purple };
  const vendorNames = ["GCS", "Avantive", "Global Telesourcing", "Results"];
  const months = [...new Set((perf.tnpsData || []).filter(s => s.month).map(s => s.month))].sort().slice(-4);
  const vendorMap = {};
  (perf.tnpsData || []).forEach(s => {
    if (!s.month) return;
    if (!months.includes(s.month)) return;
    const vendor = s.isGCS ? "GCS" : s.siteLabel;
    if (!vendorNames.includes(vendor)) return;
    if (!vendorMap[s.month]) vendorMap[s.month] = {};
    if (!vendorMap[s.month][vendor]) vendorMap[s.month][vendor] = [];
    vendorMap[s.month][vendor].push(s);
  });
  vendorNames.forEach((v, i) => {
    slide.addShape("rect", { x: 0.5 + i * 1.8, y: trendY + 0.0, w: 0.15, h: 0.12, fill: { color: vendorColors[v] }, line: { color: vendorColors[v], width: 0 } });
    slide.addText(v, { x: 0.75 + i * 1.8, y: trendY - 0.03, w: 1.55, h: 0.18, fontSize: 7, color: virgilTheme.subtle });
  });
  const trendHdr = [
    { text: "", options: hdrBase },
    ...months.map(m => {
      const [y, mo] = m.split("-").map(Number);
      return { text: new Date(y, mo - 1, 1).toLocaleString("en-US", { month: "short", year: "2-digit" }), options: hdrBase };
    })
  ];
  const trendRows = vendorNames.map(v => {
    const cells = [{ text: v, options: { fontSize: 8, bold: true, color: vendorColors[v], align: "left" } }];
    for (const m of months) {
      const surveys = (vendorMap[m] && vendorMap[m][v]) || [];
      const score = calcTnpsScore(surveys);
      cells.push({ text: surveys.length ? `${score.score > 0 ? "+" : ""}${score.score} (${surveys.length})` : "—", options: { fontSize: 8, align: "center", color: corpPalette.ink } });
    }
    return cells;
  });
  slide.addTable([trendHdr, ...trendRows], {
    x: 0.5, y: trendY + 0.2, w: 12.3,
    colW: [2.3, ...months.map(() => (12.3 - 2.3) / Math.max(1, months.length))],
    rowH: 0.26,
    border: { type: "solid", pt: 0.5, color: corpPalette.cardBorder },
    autoPage: false,
  });

  // Insights text panel (bottom)
  const insightY = 6.7;
  slide.addShape("roundRect", {
    x: 0.5, y: insightY, w: 12.3, h: 0.5,
    fill: { color: corpPalette.muted },
    line: { color: corpPalette.cardBorder, width: 0.5 },
    rectRadius: 0.06,
  });
  slide.addText("INSIGHTS", {
    x: 0.6, y: insightY + 0.04, w: 12, h: 0.18,
    fontSize: 8, color: virgilTheme.eyebrow, bold: true, charSpacing: 1.5,
  });
  slide.addText(insightText || "(no insights entered)", {
    x: 0.6, y: insightY + 0.22, w: 12, h: 0.26,
    fontSize: 9, color: insightText ? virgilTheme.bodyText : virgilTheme.subtle,
    italic: !insightText, valign: "top",
  });
}
```

- [ ] **Step 12.3: Verify build**

Run: `cd "/c/Users/Joshu/Documents/Claude/Performance Intel" && npx vite build 2>&1 | tail -5`

Expected: clean build.

- [ ] **Step 12.4: Commit**

```bash
cd "/c/Users/Joshu/Documents/Claude/Performance Intel" && git add src/app.jsx && git commit -m "feat(corp-mbr): buildCorpTnpsSlide — Slide 7 Xfinity-themed tNPS port"
```

---

## Task 13: Wire Slide 7 + add its insight textarea

**Files:**
- Modify: `src/app.jsx` — `buildVirgilMbrPresentation` orchestrator
- Modify: `src/app.jsx` — `VirgilMbrExportModal` component

- [ ] **Step 13.1: Wire Slide 7 into the orchestrator**

In `buildVirgilMbrPresentation`, immediately after the Slide 6 fan-out (end of the `for (const campaign of campaignUniverse)` loop), add:

```jsx
  // Slide 7 — Customer Experience (tNPS)
  buildCorpTnpsSlide(pres, perf, options.reportingMonthLabel, (options.insights && options.insights.slide7) || "");
```

- [ ] **Step 13.2: Add Slide 7 insights textarea to the modal**

Inside `VirgilMbrExportModal`, insert BEFORE the Slide 6 Performance Notes block (added in Task 11) a new section:

```jsx
<div style={{ marginTop: 16, padding: 12, background: "#fafafa", borderRadius: 6, border: "1px solid #d1d5db" }}>
  <div style={{ fontSize: 13, fontWeight: 600 }}>Slide 7 — tNPS Insights</div>
  <div style={{ fontSize: 12, color: "#6b7280", marginTop: 2 }}>Free-text summary rendered below the tNPS tables. Blank = italicized empty panel.</div>
  <textarea
    value={(insights && insights.slide7) || ""}
    onChange={e => setInsights({ ...(insights || {}), slide7: e.target.value })}
    rows={3}
    style={{ display: "block", width: "100%", marginTop: 6, padding: 8, border: "1px solid #d1d5db", borderRadius: 4, fontSize: 12, fontFamily: "inherit", resize: "vertical" }}
  />
</div>
```

- [ ] **Step 13.3: Verify build**

Run: `cd "/c/Users/Joshu/Documents/Claude/Performance Intel" && npx vite build 2>&1 | tail -5`

Expected: clean build.

- [ ] **Step 13.4: Commit**

```bash
cd "/c/Users/Joshu/Documents/Claude/Performance Intel" && git add src/app.jsx && git commit -m "feat(corp-mbr): wire Slide 7 + add tNPS insights textarea"
```

---

## Task 14: Partner Experience aggregator (Slide 8)

**Goal:** Walk the raw newHires CSV (not the pre-filtered `parseNewHires`) and return:
- `hires` — roster rows where `Hire Date` falls inside the reporting month
- `departures` — roster rows where `End Date` falls inside the reporting month
- `retentionRate` — (active-at-month-start − departures-this-month) ÷ active-at-month-start
- Each hire/departure is enriched with `site` via `bpLookup` (DR / BZ / Unknown)

**Files:**
- Modify: `src/app.jsx` — CORP MBR Aggregators section

- [ ] **Step 14.1: Add `buildPartnerExperienceStats`**

Place immediately after `filterTnpsToMonth` (the helper added in Task 12.1):

```jsx
// For Slide 8: compute hires, departures, and retention for a given reporting month.
// rosterRaw MUST be the raw CSV text (not the 180-day-filtered parseNewHires output).
// bpLookup is the existing BP→site map (perf.bpLookup).
function buildPartnerExperienceStats(rosterRaw, bpLookup, reportingMonthLabel) {
  const empty = { hires: [], departures: [], activeAtStart: 0, retentionRate: null, monthStart: null, monthEnd: null };
  if (!rosterRaw || !rosterRaw.trim()) return empty;

  // Parse reporting month label to a {year, month} pair
  const m = String(reportingMonthLabel || "").trim().match(/^([A-Za-z]{3,})\s*'?(\d{2,4})$/);
  if (!m) return empty;
  const monKey = { jan:0, feb:1, mar:2, apr:3, may:4, jun:5, jul:6, aug:7, sep:8, oct:9, nov:10, dec:11 }[m[1].slice(0, 3).toLowerCase()];
  if (monKey === undefined) return empty;
  const yr = Number(m[2].length === 4 ? m[2] : `20${m[2]}`);
  const monthStart = new Date(yr, monKey, 1);
  const monthEnd = new Date(yr, monKey + 1, 0); // last day of month
  const inMonth = (dateStr) => {
    if (!dateStr) return false;
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return false;
    return d >= monthStart && d <= monthEnd;
  };

  const rows = parseCSV(rosterRaw);
  const siteOfBp = (bp) => {
    if (!bp || !bpLookup) return "Unknown";
    const rec = bpLookup[bp.toLowerCase()] || bpLookup[bp];
    if (!rec) return "Unknown";
    // bpLookup returns NTID→site in some builds; infer from region field if present
    return rec.site || rec.region || "Unknown";
  };

  const hires = [];
  const departures = [];
  let activeAtStart = 0;

  for (const r of rows) {
    const first = (r["First Name"] || r["First"] || "").trim();
    const last = (r["Last Name"] || r["Last"] || "").trim();
    const name = [first, last].filter(Boolean).join(" ") || (r["AgentName"] || r["Name"] || "").trim();
    if (!name) continue;
    const bp = (r["BP"] || "").trim();
    const site = siteOfBp(bp);
    const hireDateStr = (r["Hire Date"] || r["StartDate"] || r["Start Date"] || "").trim();
    const endDateStr = (r["End Date"] || r["EndDate"] || "").trim();
    const hireDate = hireDateStr ? new Date(hireDateStr) : null;
    const endDate = endDateStr ? new Date(endDateStr) : null;

    // Active at month start: hired before month, not ended before month
    const hiredBeforeStart = hireDate && !isNaN(hireDate.getTime()) && hireDate < monthStart;
    const endedBeforeStart = endDate && !isNaN(endDate.getTime()) && endDate < monthStart;
    if (hiredBeforeStart && !endedBeforeStart) activeAtStart++;

    if (hireDate && inMonth(hireDateStr)) {
      hires.push({ name, site, hireDate: hireDateStr });
    }
    if (endDate && inMonth(endDateStr)) {
      departures.push({ name, site, endDate: endDateStr });
    }
  }

  const retentionRate = activeAtStart > 0 ? ((activeAtStart - departures.length) / activeAtStart) * 100 : null;
  return { hires, departures, activeAtStart, retentionRate, monthStart, monthEnd };
}
```

- [ ] **Step 14.2: Verify build**

Run: `cd "/c/Users/Joshu/Documents/Claude/Performance Intel" && npx vite build 2>&1 | tail -5`

Expected: clean build.

- [ ] **Step 14.3: Commit**

```bash
cd "/c/Users/Joshu/Documents/Claude/Performance Intel" && git add src/app.jsx && git commit -m "feat(corp-mbr): buildPartnerExperienceStats aggregator for Slide 8"
```

---

## Task 15: Slide 8 — Partner Experience builder

**Files:**
- Modify: `src/app.jsx` — CORP MBR Slide Builders section

- [ ] **Step 15.1: Add `buildCorpPartnerExperienceSlide`**

Place immediately after `buildCorpTnpsSlide`:

```jsx
function buildCorpPartnerExperienceSlide(pres, stats, reportingMonthLabel, supportText, incentivesText) {
  const slide = pres.addSlide();
  slide.background = { color: virgilTheme.slideBg };
  virgilBrandBars(pres, slide);

  // Eyebrow + title
  slide.addText("PEOPLE & OPERATIONS", {
    x: 0.5, y: 0.35, w: 12, h: 0.25,
    fontSize: 10, color: virgilTheme.eyebrow, bold: true, charSpacing: 2,
  });
  slide.addText(`Partner Experience — ${reportingMonthLabel}`, {
    x: 0.5, y: 0.65, w: 12, h: 0.55,
    fontSize: 22, color: virgilTheme.bodyText, bold: true,
  });

  // Top row — two text panels with purple gradient headers
  const topY = 1.4;
  const panelH = 2.2;
  const drawTextPanel = (x, w, title, body, bullets) => {
    slide.addShape("roundRect", {
      x, y: topY, w, h: panelH,
      fill: { color: corpPalette.surface },
      line: { color: corpPalette.cardBorder, width: 0.75 },
      rectRadius: 0.1,
    });
    // Purple gradient header bar (approximation via solid)
    slide.addShape("rect", {
      x, y: topY, w, h: 0.4,
      fill: { color: corpPalette.purple },
      line: { color: corpPalette.purple, width: 0 },
    });
    slide.addText(title, {
      x: x + 0.15, y: topY + 0.06, w: w - 0.3, h: 0.28,
      fontSize: 11, color: "FFFFFF", bold: true, charSpacing: 1,
    });
    let contentText;
    if (bullets) {
      const items = String(body || "")
        .split(/\r?\n/)
        .map(s => s.trim())
        .filter(Boolean);
      contentText = items.length ? items.map(s => `• ${s}`).join("\n") : "(no entries)";
    } else {
      contentText = body || "(no text entered)";
    }
    slide.addText(contentText, {
      x: x + 0.15, y: topY + 0.5, w: w - 0.3, h: panelH - 0.6,
      fontSize: 10, color: (body ? virgilTheme.bodyText : virgilTheme.subtle),
      italic: !body, valign: "top",
    });
  };
  drawTextPanel(0.5, 6.1, "HOW CAN WE SUPPORT YOU?", supportText, false);
  drawTextPanel(6.75, 6.1, "CURRENT INCENTIVES", incentivesText, true);

  // Bottom row — two KPI panels (hires + attrition)
  const kpiY = 3.9;
  const kpiH = 3.1;
  const drawKpiPanel = (x, w, title, bigCount, bigLabel, items, extraSubline) => {
    slide.addShape("roundRect", {
      x, y: kpiY, w, h: kpiH,
      fill: { color: corpPalette.surface },
      line: { color: corpPalette.cardBorder, width: 0.75 },
      rectRadius: 0.1,
    });
    slide.addText(title, {
      x: x + 0.2, y: kpiY + 0.12, w: w - 0.4, h: 0.25,
      fontSize: 10, color: virgilTheme.eyebrow, bold: true, charSpacing: 1.5,
    });
    slide.addText(String(bigCount), {
      x: x + 0.2, y: kpiY + 0.4, w: w - 0.4, h: 0.8,
      fontSize: 48, color: corpPalette.navy, bold: true, align: "left",
    });
    slide.addText(bigLabel, {
      x: x + 0.2, y: kpiY + 1.2, w: w - 0.4, h: 0.2,
      fontSize: 9, color: virgilTheme.subtle,
    });

    // Site split bar (DR orange, BZ green, Unknown gray)
    const drCount = items.filter(it => it.site === "DR" || it.site === "Dominican Republic").length;
    const bzCount = items.filter(it => it.site === "BZ" || it.site === "Belize" || /Belize|Ignaco/.test(it.site || "")).length;
    const otherCount = Math.max(0, items.length - drCount - bzCount);
    const barY = kpiY + 1.45;
    const barW = w - 0.4;
    const barH = 0.22;
    let xCursor = x + 0.2;
    const drW = items.length ? (drCount / items.length) * barW : 0;
    const bzW = items.length ? (bzCount / items.length) * barW : 0;
    const otherW = items.length ? (otherCount / items.length) * barW : 0;
    if (drW > 0) {
      slide.addShape("rect", { x: xCursor, y: barY, w: drW, h: barH, fill: { color: corpPalette.q3 }, line: { color: corpPalette.q3, width: 0 } });
      slide.addText(`DR ${drCount}`, { x: xCursor, y: barY, w: drW, h: barH, fontSize: 9, color: "FFFFFF", bold: true, align: "center", valign: "middle" });
      xCursor += drW;
    }
    if (bzW > 0) {
      slide.addShape("rect", { x: xCursor, y: barY, w: bzW, h: barH, fill: { color: corpPalette.green }, line: { color: corpPalette.green, width: 0 } });
      slide.addText(`BZ ${bzCount}`, { x: xCursor, y: barY, w: bzW, h: barH, fontSize: 9, color: "FFFFFF", bold: true, align: "center", valign: "middle" });
      xCursor += bzW;
    }
    if (otherW > 0) {
      slide.addShape("rect", { x: xCursor, y: barY, w: otherW, h: barH, fill: { color: corpPalette.inkSubtle }, line: { color: corpPalette.inkSubtle, width: 0 } });
      slide.addText(`Other ${otherCount}`, { x: xCursor, y: barY, w: otherW, h: barH, fontSize: 9, color: "FFFFFF", bold: true, align: "center", valign: "middle" });
    }

    // Up to 5 rows
    const preview = items.slice(0, 5);
    const listY = kpiY + 1.8;
    if (preview.length === 0) {
      slide.addText("(none)", { x: x + 0.2, y: listY, w: w - 0.4, h: 0.3, fontSize: 10, color: virgilTheme.subtle, italic: true });
    } else {
      const listText = preview.map(it => `${it.name} — ${it.hireDate || it.endDate} — ${it.site}`).join("\n");
      slide.addText(listText, {
        x: x + 0.2, y: listY, w: w - 0.4, h: kpiH - 1.9,
        fontSize: 9, color: corpPalette.ink, valign: "top",
      });
    }

    if (extraSubline) {
      slide.addText(extraSubline, {
        x: x + 0.2, y: kpiY + kpiH - 0.3, w: w - 0.4, h: 0.22,
        fontSize: 9, color: virgilTheme.eyebrow, bold: true,
      });
    }
  };
  drawKpiPanel(0.5, 6.1, "NEW HIRES & TRAINING", stats.hires.length, `Hires in ${reportingMonthLabel}`, stats.hires, null);
  const retentionLabel = stats.retentionRate === null ? "Retention: —" : `Retention: ${stats.retentionRate.toFixed(1)}%`;
  drawKpiPanel(6.75, 6.1, "ATTRITION", stats.departures.length, `Departures in ${reportingMonthLabel}`, stats.departures, retentionLabel);
}
```

- [ ] **Step 15.2: Verify build**

Run: `cd "/c/Users/Joshu/Documents/Claude/Performance Intel" && npx vite build 2>&1 | tail -5`

Expected: clean build.

- [ ] **Step 15.3: Commit**

```bash
cd "/c/Users/Joshu/Documents/Claude/Performance Intel" && git add src/app.jsx && git commit -m "feat(corp-mbr): buildCorpPartnerExperienceSlide — Slide 8 render"
```

---

## Task 16: Wire Slide 8 + add its two textareas

**Files:**
- Modify: `src/app.jsx` — `buildVirgilMbrPresentation` orchestrator
- Modify: `src/app.jsx` — `VirgilMbrExportModal` component

- [ ] **Step 16.1: Wire Slide 8 into the orchestrator**

In `buildVirgilMbrPresentation`, immediately after the Slide 7 call, add:

```jsx
  // Slide 8 — Partner Experience
  const partnerStats = buildPartnerExperienceStats(options.newHiresRaw || "", perf && perf.bpLookup, options.reportingMonthLabel);
  buildCorpPartnerExperienceSlide(pres, partnerStats,
    options.reportingMonthLabel,
    (options.insights && options.insights.slide8Support) || "",
    (options.insights && options.insights.slide8Incentives) || "");
```

- [ ] **Step 16.2: Add Slide 8 textareas to the modal**

Inside `VirgilMbrExportModal`, insert BEFORE the Slide 6 Performance Notes block (after the Slide 7 block added in Task 13.2):

```jsx
<div style={{ marginTop: 16, padding: 12, background: "#fafafa", borderRadius: 6, border: "1px solid #d1d5db" }}>
  <div style={{ fontSize: 13, fontWeight: 600 }}>Slide 8 — Partner Experience</div>
  <div style={{ fontSize: 12, color: "#6b7280", marginTop: 2 }}>Two panels on the final slide. Incentives newline-split into bullets.</div>
  <label style={{ display: "block", marginTop: 8, fontSize: 11, color: "#374151" }}>
    How Can We Support You?
    <textarea
      value={(insights && insights.slide8Support) || ""}
      onChange={e => setInsights({ ...(insights || {}), slide8Support: e.target.value })}
      rows={3}
      style={{ display: "block", width: "100%", marginTop: 4, padding: 8, border: "1px solid #d1d5db", borderRadius: 4, fontSize: 12, fontFamily: "inherit", resize: "vertical" }}
    />
  </label>
  <label style={{ display: "block", marginTop: 8, fontSize: 11, color: "#374151" }}>
    Current Incentives (one bullet per line)
    <textarea
      value={(insights && insights.slide8Incentives) || ""}
      onChange={e => setInsights({ ...(insights || {}), slide8Incentives: e.target.value })}
      rows={3}
      style={{ display: "block", width: "100%", marginTop: 4, padding: 8, border: "1px solid #d1d5db", borderRadius: 4, fontSize: 12, fontFamily: "inherit", resize: "vertical" }}
    />
  </label>
</div>
```

- [ ] **Step 16.3: Verify build**

Run: `cd "/c/Users/Joshu/Documents/Claude/Performance Intel" && npx vite build 2>&1 | tail -5`

Expected: clean build.

- [ ] **Step 16.4: Commit**

```bash
cd "/c/Users/Joshu/Documents/Claude/Performance Intel" && git add src/app.jsx && git commit -m "feat(corp-mbr): wire Slide 8 + Support/Incentives textareas"
```

---

## Task 17: End-to-end manual verification

No code changes unless issues surface — exercise the full Phase 3 flow.

- [ ] **Step 17.1: Start dev server**

```bash
cd "/c/Users/Joshu/Documents/Claude/Performance Intel" && npx vite
```

- [ ] **Step 17.2: Configure data**

In ⚙ → **Corp MBR Data Sources**, paste the Extended Agent Stats URL.
In ⚙ → Settings → Data sources, confirm all legacy CSVs + priors still load.

- [ ] **Step 17.3: Open the Export Corp MBR modal**

Confirm:
- Extended Agent Stats readiness row shows "Loaded"
- Slide 6 Performance Notes block lists every campaign alphabetically with Feb/March textareas
- Slide 7 tNPS Insights textarea is present
- Slide 8 has Support + Incentives textareas
- Slide 2 (Phase 1/2) insights field still works

- [ ] **Step 17.4: Enter sample text in a few textareas**

Drop two sentences into Slide 7 insights, bullets into Slide 8 Incentives, notes for one campaign's Feb + March. Close the modal. Reopen — all text persists (localStorage round-trip).

- [ ] **Step 17.5: Download .pptx**

Click **Download .pptx**. Open in PowerPoint. Verify:
- Slides 1–5 unchanged
- One Slide 6 per campaign (alphabetical) with two side-by-side tables + two notes panels
- Slide 7 renders KPI strip, Partner Ranking, Campaign table, Monthly Vendor Ranking trend, Insights panel
- Slide 8 renders four panels (Support / Incentives / New Hires / Attrition) with site-split bars
- All fonts legible, no overflowing cells, brand bars top/bottom

- [ ] **Step 17.6: Empty-data edge cases**

a. Clear the Extended Agent Stats URL via the Corp MBR Data Sources modal. Re-download. Verify Slide 6 Contact Rate + Lead Penetration rows show `—`. No crash.

b. Clear the tNPS URL in Settings → Data sources. Re-download. Verify Slide 7 renders the empty-placeholder variant ("No tNPS data loaded.").

c. If feasible, temporarily clear the roster URL. Re-download. Verify Slide 8 renders both panels with "0" counts and "(none)" placeholders.

- [ ] **Step 17.7: Production build**

```bash
cd "/c/Users/Joshu/Documents/Claude/Performance Intel" && npx vite build 2>&1 | tail -5
```

Expected: `built in Xs` clean.

- [ ] **Step 17.8: Commit any fixes**

If Steps 17.1–17.7 surfaced issues, fix them and commit:

```bash
cd "/c/Users/Joshu/Documents/Claude/Performance Intel" && git add src/app.jsx && git commit -m "fix(corp-mbr): Phase 3 verification fixes"
```

If no fixes needed, skip.

- [ ] **Step 17.9: Stop dev server**

Ctrl-C in the Vite terminal.

---

## Task 18: Update training doc (local-only)

**Files:**
- Modify: `performance-intel-training.md` (gitignored — local only)

- [ ] **Step 18.1: Extend Section 18 with Phase 3 content**

Append under the existing Phase 2 entry:

```markdown
### Phase 3 Coverage
- Slide 6: Per-Campaign Actual-to-Goal — N slides, one per campaign (alphabetical). Two side-by-side tables (previous month / month of discussion) with 21 rows each. Two Performance Notes textareas per campaign.
- Slide 7: Customer Experience (tNPS) — KPI strip + Partner Ranking + Campaign table + 4-month Monthly Vendor Ranking trend + free-text insights. Reporting-month driven (not fiscalInfo).
- Slide 8: Partner Experience — Support + Incentives text panels (top row) + New Hires & Attrition KPI panels (bottom row) with DR/BZ site-split bars and retention subline.

### New Phase 3 Data Sources
| Source | localStorage key | Upload row label |
|---|---|---|
| Extended Agent Stats (Dials/Contacts/Finals) | `perf_intel_corp_extended_agent_v1` | URL input — Corp MBR Data Sources |
| Unified modal insights | `perf_intel_corp_insights_v1` | Persisted as JSON — `{ slide2, slide6Notes: {...}, slide7, slide8Support, slide8Incentives }` |

### New Phase 3 Helpers
- `parseExtendedAgentStats(rawCsv)` + `buildExtendedAgentLookup(rows, monthFilter)`
- `buildCampaignUniverse(priorAgentRaw, priorGoalsRaw, agentRaw, goalsRaw, priorMonthLabel, reportingMonthLabel)` — returns campaigns sorted alphabetically
- `buildCampaignMonthDetail(campaign, agentRaw, goalsRaw, monthFilter, extendedLookup, totalsForMonth)` + `buildCampaignMonthTotals(...)`
- `formatCampaignDetailTable(detail, columnLabel)`
- `filterTnpsToMonth(surveys, monthLabel)`
- `buildPartnerExperienceStats(rosterRaw, bpLookup, reportingMonthLabel)` — returns `{ hires, departures, activeAtStart, retentionRate, monthStart, monthEnd }`
- `buildCorpCampaignDetailSlide`, `buildCorpTnpsSlide`, `buildCorpPartnerExperienceSlide`
```

- [ ] **Step 18.2: Note — doc is gitignored, no commit needed.**

---

## Task 19: Deploy to GitHub Pages

- [ ] **Step 19.1: Push main**

```bash
cd "/c/Users/Joshu/Documents/Claude/Performance Intel" && git push origin main
```

- [ ] **Step 19.2: Build + deploy**

```bash
cd "/c/Users/Joshu/Documents/Claude/Performance Intel" && npx vite build && npx gh-pages -d dist -m "Deploy: Corp MBR Phase 3"
```

- [ ] **Step 19.3: Verify production**

Open `https://joshuaedgecomb-dev.github.io/performance-intel/`. Click ⚙ → Export Corp MBR. Download and confirm Slides 6, 7, 8 all render correctly.

- [ ] **Step 19.4: Spot-check Slide 6 slide count**

Confirm the downloaded .pptx slide count matches `5 + N + 2` where N = number of campaigns active in Feb OR March. If count is off, investigate `buildCampaignUniverse` filter logic before calling Phase 3 done.

---

## Done — Phase 3 Exit Criteria

- [ ] Extended Agent Stats URL + fetch wired end-to-end
- [ ] `perf_intel_corp_insights_v1` persists all modal textareas across sessions
- [ ] Slide 6 renders one slide per campaign (alphabetical) with Feb/March tables + Performance Notes panels
- [ ] Slide 6 Contact Rate + Lead Penetration render `—` when Extended Agent CSV is absent
- [ ] Slide 7 renders Xfinity-themed tNPS port with KPI strip, Partner Ranking, Campaign table, 4-month Monthly Vendor Ranking trend, Insights panel
- [ ] Slide 7 filters by the reporting-month picker (not `perf.fiscalInfo`)
- [ ] Slide 7 does NOT render any "% Promoters Emailed by Month" element
- [ ] Slide 8 renders 4-panel layout (Support / Incentives / New Hires / Attrition)
- [ ] Slide 8 Retention rate = `((active-at-month-start − departures) / active-at-month-start) × 100`, rendered as subline
- [ ] Site-split bars on Slide 8 correctly color DR orange, BZ green, other gray
- [ ] Slide 8 incentives panel bulletizes newline-separated items
- [ ] Training doc locally updated
- [ ] Deployed to GitHub Pages; production download verified

## Next Phase

Once Phase 3 ships, the 8-slide spec is feature-complete. Potential follow-ups:

- **AI insights polish**: wire the per-textarea `✨ AI generate` button described in spec §3.1 item 3 (current implementation uses a single toggle that only generates Slide 2). Would need `VIRGIL_AI_PROMPTS` constants per slide + per-button UX.
- **Shared slide-primitive refactor**: the spec §2 defers this until both decks are stable. Consider extracting `addEyebrow`, `addKpiCard`, `addDataPanel` into a shared helper module now that eight slides exist.
- **Virgil's last name**: unblocks Slide 1 audience line; currently renders as `Presented to: Virgil , Director of Vendor Management, Comcast`. Add a modal text input feeding `options.virgilLastName`.
