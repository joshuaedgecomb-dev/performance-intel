# Virgil MBR Export — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the foundation of the Virgil MBR export — modal shell, Settings-menu entry, new CSV upload flows (Coaching Details, Weekly Breakdown, Login Buckets), Virgil brand helpers, and the first two slides (Title + My Performance/Quality). Deliverable: user can upload the three new CSVs, click "Export Virgil MBR," enter/generate insights text, and download a 2-slide `.pptx`.

**Architecture:** Fully parallel to existing MBR export. New `VirgilMbrExportModal` component, new parsers, new aggregators, new `buildVirgil*` slide builders — all colocated in `src/app.jsx`. Existing `Export MBR` path untouched. Follows existing localStorage-backed-state pattern.

**Tech Stack:** React 18, `pptxgenjs`, Vite, single-file `src/app.jsx`. No test framework — verification is `npx vite build` success + manual UI inspection in `npx vite --host`.

**Related spec:** `docs/superpowers/specs/2026-04-12-virgil-mbr-export-design.md` (Section 6: Slides 1–2; Section 3: Modal; Section 4: Data sources)

---

## Pre-Flight

- [ ] **Verify baseline build passes**

Run: `cd "/c/Users/Joshu/Documents/Claude/Performance Intel" && npx vite build 2>&1 | tail -5`
Expected: `built in Xs` with no errors. If this fails, stop and investigate before making any changes.

- [ ] **Confirm reference data files exist**

Run: `ls "/c/Users/Joshu/Documents/Claude/Performance Intel/Virgil MBR Deck/"`
Expected to see at minimum:
- `Coaching Details_data.csv`
- `Weekly Breakdown_data (5).csv`
- `Weekly Trending Login Buckets - Table (2)_data (1).csv`

These are your test fixtures for Slide 2.

---

## Task 1: Add new localStorage keys and App state slots

**Files:**
- Modify: `src/app.jsx` — App component state declarations (near line 13594, after `showMbrModal`)

Follow the existing private/public setter pattern (see `goalsRaw` at line 13639 as reference).

- [ ] **Step 1.1: Add state slots for new CSVs and modal toggle**

Find the block of state declarations in the App component (roughly lines 13594–13700). After the existing `showMbrModal` declaration (line 13594), add:

```jsx
const [showVirgilMbrModal, setShowVirgilMbrModal] = useState(false);

const [coachingDetailsRaw, _setCoachingDetailsRaw] = useState(() => {
  try { return localStorage.getItem("perf_intel_coaching_details_v1") || ""; } catch(e) { return ""; }
});
const setCoachingDetailsRaw = useCallback(v => {
  _setCoachingDetailsRaw(v);
  try { localStorage.setItem("perf_intel_coaching_details_v1", v || ""); } catch(e) {}
}, []);

const [coachingWeeklyRaw, _setCoachingWeeklyRaw] = useState(() => {
  try { return localStorage.getItem("perf_intel_coaching_weekly_v1") || ""; } catch(e) { return ""; }
});
const setCoachingWeeklyRaw = useCallback(v => {
  _setCoachingWeeklyRaw(v);
  try { localStorage.setItem("perf_intel_coaching_weekly_v1", v || ""); } catch(e) {}
}, []);

const [loginBucketsRaw, _setLoginBucketsRaw] = useState(() => {
  try { return localStorage.getItem("perf_intel_login_buckets_v1") || ""; } catch(e) { return ""; }
});
const setLoginBucketsRaw = useCallback(v => {
  _setLoginBucketsRaw(v);
  try { localStorage.setItem("perf_intel_login_buckets_v1", v || ""); } catch(e) {}
}, []);

const [virgilInsights, _setVirgilInsights] = useState(() => {
  try { return JSON.parse(localStorage.getItem("perf_intel_virgil_insights_v1") || "{}"); } catch(e) { return {}; }
});
const setVirgilInsights = useCallback(v => {
  _setVirgilInsights(v);
  try { localStorage.setItem("perf_intel_virgil_insights_v1", JSON.stringify(v || {})); } catch(e) {}
}, []);
```

- [ ] **Step 1.2: Verify build**

Run: `cd "/c/Users/Joshu/Documents/Claude/Performance Intel" && npx vite build 2>&1 | tail -5`
Expected: clean build. The new state slots are not yet consumed, but adding them should not break anything.

- [ ] **Step 1.3: Commit**

```bash
git add src/app.jsx && git commit -m "feat(virgil): add state slots for Virgil MBR modal and uploads"
```

---

## Task 2: Add upload handlers for the three new CSVs

**Files:**
- Modify: `src/app.jsx` — App component handler region (near existing `handleGoalsUpload` / `handleRosterUpload`)

- [ ] **Step 2.1: Locate existing upload handlers**

Run: `grep -n "handleGoalsUpload\|handleRosterUpload" src/app.jsx`
Note the pattern used. All existing handlers read a file, set the raw text to state via the public setter.

- [ ] **Step 2.2: Add three new upload handlers**

Immediately after the existing `handleRosterUpload` (or equivalent) handler in the App component, add:

```jsx
const handleCoachingDetailsUpload = useCallback(async (file) => {
  if (!file) return;
  try {
    const text = await file.text();
    setCoachingDetailsRaw(text);
  } catch(e) {
    console.error("Coaching Details upload failed:", e);
  }
}, [setCoachingDetailsRaw]);

const handleCoachingWeeklyUpload = useCallback(async (file) => {
  if (!file) return;
  try {
    const text = await file.text();
    setCoachingWeeklyRaw(text);
  } catch(e) {
    console.error("Weekly Breakdown upload failed:", e);
  }
}, [setCoachingWeeklyRaw]);

const handleLoginBucketsUpload = useCallback(async (file) => {
  if (!file) return;
  try {
    const text = await file.text();
    setLoginBucketsRaw(text);
  } catch(e) {
    console.error("Login Buckets upload failed:", e);
  }
}, [setLoginBucketsRaw]);
```

- [ ] **Step 2.3: Verify build**

Run: `npx vite build 2>&1 | tail -5`

- [ ] **Step 2.4: Commit**

```bash
git add src/app.jsx && git commit -m "feat(virgil): add upload handlers for coaching + login CSVs"
```

---

## Task 3: Wire upload rows into the Settings menu

**Files:**
- Modify: `src/app.jsx` — `SettingsMenu` component (line 5025); `TopNav` component (line 5106); `TopNav` usage in App (near line 14106)

- [ ] **Step 3.1: Extend `SettingsMenu` signature and render**

At line 5025, change the signature from:
```jsx
function SettingsMenu({ onExportMbr, onRefresh, onUploadGoals, onUploadRoster, onUploadPriorGoals, onOpenSettings, ollamaAvailable, localAI, onToggleLocalAI }) {
```
to:
```jsx
function SettingsMenu({ onExportMbr, onExportVirgilMbr, onRefresh, onUploadGoals, onUploadRoster, onUploadPriorGoals, onUploadCoachingDetails, onUploadCoachingWeekly, onUploadLoginBuckets, onOpenSettings, ollamaAvailable, localAI, onToggleLocalAI }) {
```

Then in the menu rows (immediately after the existing `Export MBR` MenuRow at line 5030), add:
```jsx
<MenuRow icon="🎯" label="Export Virgil MBR" hint="monthly" onClick={onExportVirgilMbr} />
```

And in the Data section of the menu (near the existing upload rows), add:
```jsx
<MenuRow icon="📘" label="Upload Coaching Details" hint="CSV" onClick={() => document.getElementById("virgil-coaching-details-input").click()} />
<MenuRow icon="📗" label="Upload Weekly Breakdown" hint="CSV" onClick={() => document.getElementById("virgil-coaching-weekly-input").click()} />
<MenuRow icon="📕" label="Upload Login Buckets" hint="CSV" onClick={() => document.getElementById("virgil-login-buckets-input").click()} />
```

- [ ] **Step 3.2: Add hidden file inputs to the SettingsMenu's root return**

Inside `SettingsMenu`, just before the closing tag of the outermost wrapper, add three hidden file inputs:
```jsx
<input id="virgil-coaching-details-input" type="file" accept=".csv" style={{ display: "none" }}
  onChange={e => { if (e.target.files[0]) onUploadCoachingDetails(e.target.files[0]); e.target.value = ""; }} />
<input id="virgil-coaching-weekly-input" type="file" accept=".csv" style={{ display: "none" }}
  onChange={e => { if (e.target.files[0]) onUploadCoachingWeekly(e.target.files[0]); e.target.value = ""; }} />
<input id="virgil-login-buckets-input" type="file" accept=".csv" style={{ display: "none" }}
  onChange={e => { if (e.target.files[0]) onUploadLoginBuckets(e.target.files[0]); e.target.value = ""; }} />
```

- [ ] **Step 3.3: Pass new props through `TopNav` (line ~5106 and ~5212)**

Add `onExportVirgilMbr`, `onUploadCoachingDetails`, `onUploadCoachingWeekly`, `onUploadLoginBuckets` to `TopNav`'s prop destructuring (line 5106) and in the `SettingsMenu` usage inside TopNav (line 5212), forward them:
```jsx
onExportVirgilMbr={() => { onExportVirgilMbr(); setOpenMenu(null); }}
onUploadCoachingDetails={onUploadCoachingDetails}
onUploadCoachingWeekly={onUploadCoachingWeekly}
onUploadLoginBuckets={onUploadLoginBuckets}
```

- [ ] **Step 3.4: Pass through from App (line ~14106)**

In App's render, find where `TopNav` is mounted (near line 14106) and add:
```jsx
onExportVirgilMbr={() => setShowVirgilMbrModal(true)}
onUploadCoachingDetails={handleCoachingDetailsUpload}
onUploadCoachingWeekly={handleCoachingWeeklyUpload}
onUploadLoginBuckets={handleLoginBucketsUpload}
```

- [ ] **Step 3.5: Verify build + UI**

Run: `npx vite build 2>&1 | tail -5`
Then: `npx vite --host`
Open the dev server URL, click the ⚙ icon. Verify:
- New "Export Virgil MBR" row appears below "Export MBR"
- Three new upload rows appear in the Data section
- Clicking each upload row opens the file picker
- Picking a CSV does not crash the app (check console)

- [ ] **Step 3.6: Commit**

```bash
git add src/app.jsx && git commit -m "feat(virgil): wire settings menu entries and upload inputs"
```

---

## Task 4: Write the three CSV parsers

**Files:**
- Modify: `src/app.jsx` — add new section `// ═══ VIRGIL MBR — Parsers ═══` after the existing MBR export section (after line ~6340, before line 6343's `MbrExportModal`)

Use the existing `parseCSV` helper (line ~22) for tokenization — do not re-implement CSV parsing.

- [ ] **Step 4.1: Add `parseCoachingDetails`**

```jsx
// ═══════════════════════════════════════════════════════════════════
// VIRGIL MBR — Parsers
// ═══════════════════════════════════════════════════════════════════

function parseCoachingDetails(rawCsv) {
  if (!rawCsv || !rawCsv.trim()) return {};
  const rows = parseCSV(rawCsv);
  const byMonth = {};
  for (const r of rows) {
    const measure = (r["Measure Names"] || "").trim();
    const month = (r["Fiscal Month"] || "").trim();
    const rawVal = r["Measure Values"];
    if (!measure || !month) continue;
    const n = Number(rawVal);
    if (!byMonth[month]) byMonth[month] = {};
    byMonth[month][measure] = Number.isFinite(n) ? n : rawVal;
  }
  return byMonth;
}
```

- [ ] **Step 4.2: Add `parseCoachingWeekly`**

```jsx
function parseCoachingWeekly(rawCsv) {
  if (!rawCsv || !rawCsv.trim()) return [];
  const rows = parseCSV(rawCsv);
  return rows.map(r => {
    const nameField = (r["Name or NT"] || "").trim();
    const pipeIdx = nameField.lastIndexOf("|");
    const displayName = pipeIdx >= 0 ? nameField.slice(0, pipeIdx).trim() : nameField;
    const bpRaw = pipeIdx >= 0 ? nameField.slice(pipeIdx + 1).trim() : "";
    const ntid = bpRaw.replace(/^BP-/i, "").trim();
    return {
      displayName,
      ntid,
      fiscalMonth: (r["Fiscal Month"] || "").trim(),
      fiscalWeek: (r["new calc"] || "").trim(),
      sessions: Number(r["Coaching Sessions  (copy)"]) || 0,
      colorWb: (r["Color WB"] || "").trim(),
      manager: (r["Manager"] || "").trim(),
      supervisor: (r["Supervisor."] || "").trim(),
    };
  });
}
```

- [ ] **Step 4.3: Add `parseLoginBuckets`**

```jsx
function parseLoginBuckets(rawCsv) {
  if (!rawCsv || !rawCsv.trim()) return {};
  const rows = parseCSV(rawCsv);
  // Shape: { "Oct 25": { "0-3": { pct: 0.35, users: 6 }, "4-7": {...}, ... }, ... }
  const byMonth = {};
  for (const r of rows) {
    const bucket = (r["User Login Bucket (Alternative)"] || "").trim();
    const month = (r["Month vs Week View Label"] || "").trim();
    const measure = (r["Measure Names"] || "").trim();
    const value = Number(r["Measure Values"]);
    if (!bucket || !month || !measure) continue;
    if (!byMonth[month]) byMonth[month] = {};
    if (!byMonth[month][bucket]) byMonth[month][bucket] = { pct: 0, users: 0 };
    if (measure === "% of Total") byMonth[month][bucket].pct = value;
    else if (measure === "Total Users") byMonth[month][bucket].users = value;
  }
  return byMonth;
}
```

- [ ] **Step 4.4: Verify build**

Run: `npx vite build 2>&1 | tail -5`

- [ ] **Step 4.5: Commit**

```bash
git add src/app.jsx && git commit -m "feat(virgil): add parsers for coaching and login CSVs"
```

---

## Task 5: Write the `buildCoachingStats` aggregator

**Files:**
- Modify: `src/app.jsx` — same new Virgil section, right after the parsers

- [ ] **Step 5.1: Add the aggregator**

```jsx
// ═══════════════════════════════════════════════════════════════════
// VIRGIL MBR — Aggregators
// ═══════════════════════════════════════════════════════════════════

// Converts a "Mar '26" / "Mar 26" style fiscal-month label to a canonical form.
function normalizeVirgilMonthKey(s) {
  if (!s) return "";
  return s.replace(/['"`]/g, "").replace(/\s+/g, " ").trim();
}

// Returns { org: {coachingPct, acknowledgePct, totalSessions}, dr: {...}, bz: {...} }
// Org values come from coachingDetails (authoritative monthly totals).
// DR/BZ splits come from weekly rows joined to bpLookup.
function buildCoachingStats(coachingDetails, coachingWeekly, bpLookup, reportingMonthLabel) {
  const key = normalizeVirgilMonthKey(reportingMonthLabel);
  const monthBucket = coachingDetails[reportingMonthLabel] || coachingDetails[key] || {};
  const org = {
    coachingPct: Number(monthBucket["% Coached"]) || 0,
    acknowledgePct: Number(monthBucket["Acknowledged %"] || monthBucket["Acknowledged % "]) || 0,
    totalSessions: Number(monthBucket["Total Sessions"]) || 0,
  };
  const dr = { eligible: 0, attained: 0, sessions: 0 };
  const bz = { eligible: 0, attained: 0, sessions: 0 };
  for (const row of coachingWeekly || []) {
    if (normalizeVirgilMonthKey(row.fiscalMonth) !== key) continue;
    if (row.colorWb === "No Coaching Required") continue;
    const bp = bpLookup && row.ntid ? bpLookup[row.ntid] : null;
    const region = bp ? (bp.region || "").toUpperCase() : "";
    const site = region.includes("XOTM") ? "BZ" : (region ? "DR" : null);
    if (!site) continue;
    const target = site === "DR" ? dr : bz;
    target.eligible += 1;
    if (row.sessions >= 1) target.attained += 1;
    target.sessions += row.sessions;
  }
  const siteSummary = (s) => ({
    coachingPct: s.eligible ? s.attained / s.eligible : 0,
    acknowledgePct: 0, // weekly CSV has no acknowledgement signal — blank for site split
    totalSessions: s.sessions,
  });
  return { org, dr: siteSummary(dr), bz: siteSummary(bz) };
}
```

- [ ] **Step 5.2: Add `buildLoginDistribution`**

Below `buildCoachingStats`:
```jsx
// Returns an array of { bucket, pct, users } for the reporting month, in canonical bucket order.
function buildLoginDistribution(loginBuckets, reportingMonthLabel) {
  const order = ["0-3", "4-7", "8-15", "16-20+"];
  const monthBucket = loginBuckets[reportingMonthLabel] || {};
  return order.map(b => ({
    bucket: b,
    pct: (monthBucket[b] && monthBucket[b].pct) || 0,
    users: (monthBucket[b] && monthBucket[b].users) || 0,
  }));
}
```

- [ ] **Step 5.3: Verify build**

Run: `npx vite build 2>&1 | tail -5`

- [ ] **Step 5.4: Commit**

```bash
git add src/app.jsx && git commit -m "feat(virgil): add coaching + login aggregators"
```

---

## Task 6: Virgil brand helpers

**Files:**
- Modify: `src/app.jsx` — same new Virgil section, after aggregators

- [ ] **Step 6.1: Add theme constants and brand-bar helper**

```jsx
// ═══════════════════════════════════════════════════════════════════
// VIRGIL MBR — Brand Helpers
// ═══════════════════════════════════════════════════════════════════

const virgilTheme = {
  gradientLeft: "0B5F7A",   // teal
  gradientMid: "3B3F8F",    // deep blue
  gradientRight: "7C3AED",  // purple
  bodyText: "1F2937",
  subtle: "6B7280",
  eyebrow: "4F46E5",
  footerText: "9CA3AF",
  slideBg: "FFFFFF",
};

const virgilFundingColors = {
  Growth: "0E7490",     // teal
  National: "1E293B",   // near-black navy
  Marketing: "8B5CF6",  // violet
  HQ: "374151",         // slate
  Total: "7C3AED",      // purple
};

// Adds the top and bottom teal→purple brand bars to a slide.
// pres is the pptxgenjs instance; slide is the slide object.
function virgilBrandBars(pres, slide) {
  const w = pres.presLayout ? pres.presLayout.width : 13.333;
  slide.addShape("rect", {
    x: 0, y: 0, w, h: 0.22,
    fill: { color: virgilTheme.gradientLeft },
    line: { color: virgilTheme.gradientLeft, width: 0 },
  });
  slide.addShape("rect", {
    x: 0, y: 7.28, w, h: 0.22,
    fill: { color: virgilTheme.gradientRight },
    line: { color: virgilTheme.gradientRight, width: 0 },
  });
  // Footer text
  slide.addText("GLOBAL CALLCENTER SOLUTIONS", {
    x: 0.3, y: 7.05, w: 5, h: 0.2, fontSize: 8, color: virgilTheme.footerText, bold: true,
  });
  slide.addText("xfinity", {
    x: w - 1.0, y: 7.05, w: 0.9, h: 0.2, fontSize: 10, color: virgilTheme.footerText, align: "right",
  });
}
```

- [ ] **Step 6.2: Verify build**

Run: `npx vite build 2>&1 | tail -5`

- [ ] **Step 6.3: Commit**

```bash
git add src/app.jsx && git commit -m "feat(virgil): add brand theme constants and bar helper"
```

---

## Task 7: Build Slide 1 (Title)

**Files:**
- Modify: `src/app.jsx` — same new Virgil section, after brand helpers

- [ ] **Step 7.1: Add `buildVirgilTitleSlide`**

Mirror the structure of existing `buildMbrTitleSlide` (line 5243) for reference, but apply Virgil theming.

```jsx
// ═══════════════════════════════════════════════════════════════════
// VIRGIL MBR — Slide Builders
// ═══════════════════════════════════════════════════════════════════

function buildVirgilTitleSlide(pres, reportingMonthLabel, fiscalInfo, virgilLastName) {
  const slide = pres.addSlide();
  slide.background = { color: virgilTheme.slideBg };
  virgilBrandBars(pres, slide);

  slide.addText("GLOBAL CALLCENTER SOLUTIONS", {
    x: 0.5, y: 1.5, w: 12, h: 0.3,
    fontSize: 11, color: virgilTheme.eyebrow, bold: true, charSpacing: 3,
  });
  slide.addText(`VIRGIL MBR — ${reportingMonthLabel}`, {
    x: 0.5, y: 1.9, w: 12, h: 1.0,
    fontSize: 36, color: virgilTheme.bodyText, bold: true,
  });
  const audienceName = virgilLastName ? `Virgil ${virgilLastName}` : "Virgil";
  slide.addText(`Presented to ${audienceName}, Director of Vendor Management, Comcast`, {
    x: 0.5, y: 3.0, w: 12, h: 0.4,
    fontSize: 14, color: virgilTheme.subtle,
  });
  if (fiscalInfo && fiscalInfo.fiscalStart && fiscalInfo.fiscalEnd) {
    const fmt = (d) => {
      try {
        const dt = new Date(d);
        return dt.toLocaleDateString("en-US", { month: "short", day: "numeric" });
      } catch(e) { return String(d); }
    };
    slide.addText(`Fiscal Month: ${fmt(fiscalInfo.fiscalStart)} – ${fmt(fiscalInfo.fiscalEnd)}`, {
      x: 0.5, y: 3.5, w: 12, h: 0.4,
      fontSize: 12, color: virgilTheme.subtle, italic: true,
    });
  }
}
```

- [ ] **Step 7.2: Verify build**

Run: `npx vite build 2>&1 | tail -5`

- [ ] **Step 7.3: Commit**

```bash
git add src/app.jsx && git commit -m "feat(virgil): add Slide 1 (title) builder"
```

---

## Task 8: Build Slide 2 (My Performance / Quality)

**Files:**
- Modify: `src/app.jsx` — same new Virgil section, after Slide 1 builder

- [ ] **Step 8.1: Add `buildVirgilMyPerformanceSlide`**

```jsx
function buildVirgilMyPerformanceSlide(pres, stats, loginDist, reportingMonthLabel, insightsText) {
  const slide = pres.addSlide();
  slide.background = { color: virgilTheme.slideBg };
  virgilBrandBars(pres, slide);

  // Eyebrow + title
  slide.addText("OPERATIONAL PERFORMANCE", {
    x: 0.5, y: 0.35, w: 6, h: 0.25,
    fontSize: 10, color: virgilTheme.eyebrow, bold: true, charSpacing: 2,
  });
  slide.addText(`My Performance / Quality — ${reportingMonthLabel}`, {
    x: 0.5, y: 0.65, w: 12, h: 0.55,
    fontSize: 26, color: virgilTheme.bodyText, bold: true,
  });

  // Top row — 3 KPI blocks
  const blocks = [
    { label: "Coaching Standard Attainment", org: stats.org.coachingPct, dr: stats.dr.coachingPct, bz: stats.bz.coachingPct, pct: true },
    { label: "Acknowledgement %", org: stats.org.acknowledgePct, dr: stats.dr.acknowledgePct, bz: stats.bz.acknowledgePct, pct: true },
    { label: "Total Coaching Sessions", org: stats.org.totalSessions, dr: stats.dr.totalSessions, bz: stats.bz.totalSessions, pct: false },
  ];
  const blockY = 1.5;
  const blockW = 3.9;
  const blockH = 1.8;
  blocks.forEach((b, i) => {
    const x = 0.5 + i * (blockW + 0.2);
    slide.addShape("rect", {
      x, y: blockY, w: blockW, h: blockH,
      fill: { color: "F3F4F6" },
      line: { color: "E5E7EB", width: 0.5 },
    });
    slide.addText(b.label, {
      x: x + 0.2, y: blockY + 0.1, w: blockW - 0.4, h: 0.3,
      fontSize: 11, color: virgilTheme.subtle, bold: true,
    });
    const fmt = (v) => b.pct ? `${(v * 100).toFixed(1)}%` : String(Math.round(v));
    slide.addText(fmt(b.org), {
      x: x + 0.2, y: blockY + 0.4, w: blockW - 0.4, h: 0.6,
      fontSize: 28, color: virgilTheme.bodyText, bold: true,
    });
    slide.addText(`DR ${fmt(b.dr)}   ·   BZ ${fmt(b.bz)}`, {
      x: x + 0.2, y: blockY + 1.1, w: blockW - 0.4, h: 0.4,
      fontSize: 12, color: virgilTheme.subtle,
    });
  });

  // Middle — login activity stacked bar
  slide.addText("myPerformance Login Activity", {
    x: 0.5, y: 3.6, w: 12, h: 0.3,
    fontSize: 14, color: virgilTheme.eyebrow, bold: true,
  });
  const barX = 0.5;
  const barY = 4.0;
  const barW = 12.3;
  const barH = 0.6;
  const bucketColors = ["0E7490", "3B82F6", "8B5CF6", "7C3AED"];
  const totalUsers = loginDist.reduce((s, d) => s + (d.users || 0), 0) || 1;
  let runX = barX;
  loginDist.forEach((d, i) => {
    const segW = (d.pct || 0) * barW;
    if (segW <= 0) return;
    slide.addShape("rect", {
      x: runX, y: barY, w: segW, h: barH,
      fill: { color: bucketColors[i] || "9CA3AF" },
      line: { color: bucketColors[i] || "9CA3AF", width: 0 },
    });
    slide.addText(`${d.bucket}\n${(d.pct * 100).toFixed(0)}% · ${d.users}`, {
      x: runX, y: barY, w: segW, h: barH,
      fontSize: 10, color: "FFFFFF", align: "center", valign: "middle", bold: true,
    });
    runX += segW;
  });
  slide.addText(`Total Users: ${totalUsers}`, {
    x: barX, y: barY + barH + 0.1, w: barW, h: 0.25,
    fontSize: 10, color: virgilTheme.subtle, italic: true,
  });

  // Bottom — insights
  slide.addText("Insights", {
    x: 0.5, y: 5.2, w: 12, h: 0.3,
    fontSize: 14, color: virgilTheme.eyebrow, bold: true,
  });
  slide.addText(insightsText || "", {
    x: 0.5, y: 5.5, w: 12.3, h: 1.3,
    fontSize: 12, color: virgilTheme.bodyText, valign: "top",
  });
}
```

- [ ] **Step 8.2: Verify build**

Run: `npx vite build 2>&1 | tail -5`

- [ ] **Step 8.3: Commit**

```bash
git add src/app.jsx && git commit -m "feat(virgil): add Slide 2 (my performance/quality) builder"
```

---

## Task 9: Build the orchestrator `buildVirgilMbrPresentation`

**Files:**
- Modify: `src/app.jsx` — same Virgil section, after slide builders

- [ ] **Step 9.1: Add the orchestrator**

```jsx
// ═══════════════════════════════════════════════════════════════════
// VIRGIL MBR — Orchestrator
// ═══════════════════════════════════════════════════════════════════

// options: { reportingMonthLabel, virgilLastName, coachingDetails, coachingWeekly, loginBuckets, insights }
function buildVirgilMbrPresentation(perf, options) {
  const pres = new pptxgen();
  pres.layout = "LAYOUT_WIDE"; // 13.333 x 7.5

  const stats = buildCoachingStats(
    options.coachingDetails || {},
    options.coachingWeekly || [],
    perf && perf.bpLookup,
    options.reportingMonthLabel
  );
  const loginDist = buildLoginDistribution(options.loginBuckets || {}, options.reportingMonthLabel);

  buildVirgilTitleSlide(pres, options.reportingMonthLabel, perf && perf.fiscalInfo, options.virgilLastName);
  buildVirgilMyPerformanceSlide(pres, stats, loginDist, options.reportingMonthLabel, (options.insights && options.insights.slide2) || "");

  return pres;
}
```

- [ ] **Step 9.2: Verify build**

Run: `npx vite build 2>&1 | tail -5`

- [ ] **Step 9.3: Commit**

```bash
git add src/app.jsx && git commit -m "feat(virgil): add MBR presentation orchestrator"
```

---

## Task 10: Build `VirgilMbrExportModal`

**Files:**
- Modify: `src/app.jsx` — after the orchestrator, before the next existing section

- [ ] **Step 10.1: Add the modal component**

```jsx
// ═══════════════════════════════════════════════════════════════════
// VIRGIL MBR — Export Modal
// ═══════════════════════════════════════════════════════════════════

function VirgilMbrExportModal({ perf, coachingDetailsRaw, coachingWeeklyRaw, loginBucketsRaw, insights, setInsights, onClose }) {
  const [reportingMonth, setReportingMonth] = useState(() => {
    // Default to "Mar '26" style label derived from fiscal info if possible
    try {
      const end = perf && perf.fiscalInfo && perf.fiscalInfo.fiscalEnd;
      if (end) {
        const dt = new Date(end);
        const mo = dt.toLocaleDateString("en-US", { month: "short" });
        const yr = String(dt.getFullYear()).slice(2);
        return `${mo} '${yr}`;
      }
    } catch(e) {}
    return "";
  });
  const [virgilLastName, setVirgilLastName] = useState(() => {
    try { return localStorage.getItem("perf_intel_virgil_last_name") || ""; } catch(e) { return ""; }
  });
  useEffect(() => {
    try { localStorage.setItem("perf_intel_virgil_last_name", virgilLastName || ""); } catch(e) {}
  }, [virgilLastName]);

  const coachingDetails = useMemo(() => parseCoachingDetails(coachingDetailsRaw), [coachingDetailsRaw]);
  const coachingWeekly = useMemo(() => parseCoachingWeekly(coachingWeeklyRaw), [coachingWeeklyRaw]);
  const loginBuckets = useMemo(() => parseLoginBuckets(loginBucketsRaw), [loginBucketsRaw]);

  const hasCoachingDetails = !!(coachingDetailsRaw && coachingDetailsRaw.trim());
  const hasCoachingWeekly = !!(coachingWeeklyRaw && coachingWeeklyRaw.trim());
  const hasLoginBuckets = !!(loginBucketsRaw && loginBucketsRaw.trim());

  const setSlide2Insight = useCallback((v) => {
    setInsights({ ...(insights || {}), slide2: v });
  }, [insights, setInsights]);

  const handleDownload = useCallback(async () => {
    const pres = buildVirgilMbrPresentation(perf, {
      reportingMonthLabel: reportingMonth,
      virgilLastName,
      coachingDetails,
      coachingWeekly,
      loginBuckets,
      insights,
    });
    const safeMonth = (reportingMonth || "Virgil").replace(/[^A-Za-z0-9 _-]+/g, "");
    await pres.writeFile({ fileName: `Virgil MBR - ${safeMonth}.pptx` });
  }, [perf, reportingMonth, virgilLastName, coachingDetails, coachingWeekly, loginBuckets, insights]);

  const StatusRow = ({ label, ok }) => (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", fontSize: 13 }}>
      <span>{label}</span>
      <span style={{ color: ok ? "#16a34a" : "#d97706" }}>{ok ? "Loaded" : "Missing"}</span>
    </div>
  );

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 400, display: "flex", alignItems: "center", justifyContent: "center" }}
         onClick={onClose}>
      <div style={{ width: 560, maxHeight: "85vh", overflow: "auto", background: "#fff", borderRadius: 10, padding: 24 }}
           onClick={e => e.stopPropagation()}>
        <h2 style={{ margin: 0, fontSize: 20 }}>Export Virgil MBR</h2>
        <p style={{ color: "#6b7280", fontSize: 13, marginTop: 4 }}>
          Comcast-facing monthly deck. Phase 1: Title + My Performance / Quality.
        </p>

        <label style={{ display: "block", marginTop: 16, fontSize: 13, fontWeight: 600 }}>
          Reporting Month Label
          <input type="text" value={reportingMonth} onChange={e => setReportingMonth(e.target.value)}
            placeholder="Mar '26"
            style={{ display: "block", marginTop: 4, width: "100%", padding: 8, border: "1px solid #d1d5db", borderRadius: 6 }} />
          <small style={{ color: "#6b7280" }}>Must match the "Fiscal Month" value in your Coaching Details CSV.</small>
        </label>

        <label style={{ display: "block", marginTop: 12, fontSize: 13, fontWeight: 600 }}>
          Virgil's last name (optional)
          <input type="text" value={virgilLastName} onChange={e => setVirgilLastName(e.target.value)}
            style={{ display: "block", marginTop: 4, width: "100%", padding: 8, border: "1px solid #d1d5db", borderRadius: 6 }} />
        </label>

        <div style={{ marginTop: 16, padding: 12, background: "#f9fafb", borderRadius: 6 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#374151", marginBottom: 6 }}>Data Readiness</div>
          <StatusRow label="Coaching Details CSV" ok={hasCoachingDetails} />
          <StatusRow label="Weekly Breakdown CSV" ok={hasCoachingWeekly} />
          <StatusRow label="Login Buckets CSV" ok={hasLoginBuckets} />
        </div>

        <label style={{ display: "block", marginTop: 16, fontSize: 13, fontWeight: 600 }}>
          Slide 2 Insights
          <textarea value={(insights && insights.slide2) || ""} onChange={e => setSlide2Insight(e.target.value)}
            rows={4}
            style={{ display: "block", marginTop: 4, width: "100%", padding: 8, border: "1px solid #d1d5db", borderRadius: 6, fontFamily: "inherit" }} />
        </label>

        <div style={{ display: "flex", gap: 8, marginTop: 20, justifyContent: "flex-end" }}>
          <button onClick={onClose} style={{ padding: "8px 14px", border: "1px solid #d1d5db", background: "#fff", borderRadius: 6, cursor: "pointer" }}>Cancel</button>
          <button onClick={handleDownload} style={{ padding: "8px 14px", border: "none", background: "#7C3AED", color: "#fff", borderRadius: 6, cursor: "pointer", fontWeight: 600 }}>Download .pptx</button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 10.2: Verify build**

Run: `npx vite build 2>&1 | tail -5`

- [ ] **Step 10.3: Commit**

```bash
git add src/app.jsx && git commit -m "feat(virgil): add VirgilMbrExportModal component"
```

---

## Task 11: Mount the modal in App and wire props

**Files:**
- Modify: `src/app.jsx` — App component render region (near where `MbrExportModal` is rendered; grep for `<MbrExportModal`)

- [ ] **Step 11.1: Locate existing modal mount**

Run: `grep -n "MbrExportModal" src/app.jsx`
Note the line where `<MbrExportModal ... />` is rendered inside the App's return.

- [ ] **Step 11.2: Add VirgilMbrExportModal mount immediately below it**

```jsx
{showVirgilMbrModal && (
  <VirgilMbrExportModal
    perf={perf}
    coachingDetailsRaw={coachingDetailsRaw}
    coachingWeeklyRaw={coachingWeeklyRaw}
    loginBucketsRaw={loginBucketsRaw}
    insights={virgilInsights}
    setInsights={setVirgilInsights}
    onClose={() => setShowVirgilMbrModal(false)}
  />
)}
```

- [ ] **Step 11.3: Verify build**

Run: `npx vite build 2>&1 | tail -5`

- [ ] **Step 11.4: Commit**

```bash
git add src/app.jsx && git commit -m "feat(virgil): mount VirgilMbrExportModal in App"
```

---

## Task 12: End-to-end manual verification

No code change here — execute the full flow and confirm each piece works.

- [ ] **Step 12.1: Start dev server**

Run: `cd "/c/Users/Joshu/Documents/Claude/Performance Intel" && npx vite --host`
Open the printed URL in a browser.

- [ ] **Step 12.2: Upload the three fixture CSVs**

Click ⚙ → Upload Coaching Details → select `Virgil MBR Deck/Coaching Details_data.csv`.
Click ⚙ → Upload Weekly Breakdown → select `Virgil MBR Deck/Weekly Breakdown_data (5).csv`.
Click ⚙ → Upload Login Buckets → select `Virgil MBR Deck/Weekly Trending Login Buckets - Table (2)_data (1).csv`.

Expected: no console errors. Data persists across a page reload.

- [ ] **Step 12.3: Open the Virgil MBR modal**

Click ⚙ → **Export Virgil MBR**. Modal opens.

Verify:
- Reporting Month defaults to something like `Mar '26` (derived from fiscalInfo)
- Virgil's last name input is empty (or remembers prior value)
- Data Readiness rows show **Loaded** for all three CSVs
- Slide 2 Insights textarea is empty (or remembers prior content)

- [ ] **Step 12.4: Enter inputs and download**

Type `Wolfgang` (or any surname) into Virgil's last name. Type a few sentences into Slide 2 Insights. Click **Download .pptx**.

Expected: a file named `Virgil MBR - Mar '26.pptx` (or similar) downloads.

- [ ] **Step 12.5: Open the file in PowerPoint / Google Slides / Keynote**

Verify:
- **Slide 1**: title reads `VIRGIL MBR — Mar '26`, audience line reads `Presented to Virgil Wolfgang, Director of Vendor Management, Comcast`, teal+purple brand bars top and bottom, `GLOBAL CALLCENTER SOLUTIONS` footer left, `xfinity` footer right
- **Slide 2**: eyebrow reads `OPERATIONAL PERFORMANCE`, title is `My Performance / Quality — Mar '26`, 3 KPI blocks render with org + DR + BZ values, Login Activity stacked bar renders with 4 segments, Insights section shows your typed text

- [ ] **Step 12.6: Test empty-state resilience**

Close the modal. Clear localStorage keys for one of the uploads (e.g., `localStorage.removeItem("perf_intel_coaching_details_v1")` in the browser console). Reopen the modal. Verify the Data Readiness row flips to **Missing** and downloading still succeeds (Slide 2 renders with `0%` values rather than crashing).

- [ ] **Step 12.7: Build production bundle**

Run: `npx vite build 2>&1 | tail -5`
Expected: clean build.

- [ ] **Step 12.8: Commit verification notes (if any fixes were needed)**

If Steps 12.1–12.7 surfaced any minor fixes, commit them:
```bash
git add src/app.jsx && git commit -m "fix(virgil): Phase 1 verification fixes"
```

If nothing needed fixing, skip the commit.

---

## Task 13: Update training documentation

**Files:**
- Modify: `performance-intel-training.md` — add a short section documenting Virgil MBR

- [ ] **Step 13.1: Append a "Virgil MBR Export" section at the end of the document**

Add a new numbered section (e.g., `## 18. Virgil MBR Export — Phase 1`). Content:

```markdown
## 18. Virgil MBR Export — Phase 1

A parallel monthly `.pptx` export targeting Comcast's Director of Vendor Management. Independent of the existing `Export MBR`.

### Current Coverage (Phase 1)
- Slide 1: Title
- Slide 2: My Performance / Quality (Coaching Standard Attainment, Acknowledgement %, Total Coaching Sessions, myPerformance Login Activity)

### New Data Sources
| Source | localStorage key | Upload row label |
|---|---|---|
| Coaching Details | `perf_intel_coaching_details_v1` | Upload Coaching Details |
| Weekly Breakdown (per-agent coaching) | `perf_intel_coaching_weekly_v1` | Upload Weekly Breakdown |
| Login Buckets (login frequency distribution) | `perf_intel_login_buckets_v1` | Upload Login Buckets |
| Virgil insights persistence | `perf_intel_virgil_insights_v1` | (internal) |
| Virgil's last name | `perf_intel_virgil_last_name` | (internal) |

### Key Functions
- `parseCoachingDetails`, `parseCoachingWeekly`, `parseLoginBuckets` — CSV parsers
- `buildCoachingStats(details, weekly, bpLookup, monthLabel)` → `{ org, dr, bz }` — merges the two coaching sources; org totals from Coaching Details are authoritative, DR/BZ split derived from Weekly Breakdown joined to `bpLookup`
- `buildLoginDistribution(loginBuckets, monthLabel)` — returns array `[{bucket, pct, users}, ...]` in canonical order
- `virgilBrandBars(pres, slide)` — teal + purple gradient top/bottom bars + footer
- `buildVirgilTitleSlide`, `buildVirgilMyPerformanceSlide`, `buildVirgilMbrPresentation`
- `VirgilMbrExportModal`

### Still To Do (later phases)
Slides 3–8: Scorecard, Quartile, Campaign Hours, per-campaign detail slides, tNPS, Partner Experience. Tracked in follow-up plans.
```

- [ ] **Step 13.2: Commit**

```bash
git add performance-intel-training.md && git commit -m "docs: document Virgil MBR Phase 1"
```

---

## Task 14: Deploy

- [ ] **Step 14.1: Push to main**

Run:
```bash
cd "/c/Users/Joshu/Documents/Claude/Performance Intel" && git push origin main
```

- [ ] **Step 14.2: Deploy to GitHub Pages**

Run:
```bash
cd "/c/Users/Joshu/Documents/Claude/Performance Intel" && npx vite build && npx gh-pages -d dist -m "Deploy: Virgil MBR Phase 1"
```

- [ ] **Step 14.3: Verify live deployment**

Open `https://joshuaedgecomb-dev.github.io/performance-intel/`. Click ⚙ → Export Virgil MBR. Confirm the modal opens on production.

---

## Done — Phase 1 Exit Criteria

All of the following must be true:
- [ ] `Export MBR` (original) still produces the same output as before Phase 1
- [ ] `Export Virgil MBR` is a new row in the ⚙ menu
- [ ] All three new upload rows appear and successfully persist uploaded CSVs
- [ ] Virgil modal opens, shows data-readiness status, accepts reporting-month label + Virgil's last name + Slide 2 insights
- [ ] Download button produces a 2-slide `.pptx` opening cleanly in PowerPoint and Google Slides
- [ ] Slide 1 renders correct title, audience line, and brand bars
- [ ] Slide 2 renders 3 KPI blocks, login activity bar, and insights content
- [ ] Missing upload sources degrade to zeros/empty without crashing
- [ ] Training doc updated
- [ ] Deployed to GitHub Pages

## Next Phase

Once Phase 1 is validated on production, invoke `superpowers:writing-plans` again with this spec and the scope: **Phase 2 — Slides 3 (All-in Attainment + Scorecard), 4 (Quartile Reporting), 5 (Campaign Hours)**.
