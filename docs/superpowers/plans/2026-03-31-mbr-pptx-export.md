# MBR PPTX Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Generate MBR" button to Performance Intel that exports a polished Monthly Business Review PowerPoint deck from already-crunched performance data.

**Architecture:** All code lives in the monolithic `Project/src/app.jsx`. A new `pptxgenjs` dependency handles in-browser PPTX generation. The export button sits in the hover-revealed data-toolbar, triggers a confirmation modal, gathers AI insights per program, builds slides from the `perf` object, and downloads the file.

**Tech Stack:** React 18, Vite, pptxgenjs (new), existing Ollama AI integration

**Spec:** `docs/superpowers/specs/2026-03-31-mbr-pptx-export-design.md`

---

## File Structure

All changes are in two files:

- **Modify: `Project/package.json`** — add `pptxgenjs` dependency
- **Modify: `Project/src/app.jsx`** — all new code (constants, slide builders, modal, button wiring)

Within `app.jsx`, new code is organized by section convention:

| What | Where in app.jsx | After |
|------|------------------|-------|
| `import pptxgenjs` | Line 1 (import block) | Existing React import |
| `PROGRAM_CATEGORIES` constant | Section 1 (Constants & Utilities, ~line 75) | `Q` object |
| `MBR_COLORS` constant | Section 1 (~line 75) | `PROGRAM_CATEGORIES` |
| `formatFiscalFilename()` utility | Section 1 (~line 80) | `MBR_COLORS` |
| `mbrQuartileColor()` utility | Section 1 (~line 85) | `formatFiscalFilename` |
| `buildMbrTitleSlide()` | New section before `BusinessOverview` (~line 4430) | Section 11 end |
| `buildMbrSummarySlide()` | Same new section | `buildMbrTitleSlide` |
| `buildMbrProgramSlide()` | Same new section | `buildMbrSummarySlide` |
| `buildMbrPlaceholderSlides()` | Same new section | `buildMbrProgramSlide` |
| `generateMBR()` orchestrator | Same new section | `buildMbrPlaceholderSlides` |
| `MbrExportModal` component | Same new section | `generateMBR` |
| Export button in data-toolbar | Line ~11142 | Existing Refresh button |
| `showMbrModal` state + wiring | App component (~line 10658) | Existing state declarations |

---

## Task 1: Install pptxgenjs and verify import

**Files:**
- Modify: `Project/package.json`
- Modify: `Project/src/app.jsx:1`

- [ ] **Step 1: Install pptxgenjs**

```bash
cd Project && npm install pptxgenjs
```

- [ ] **Step 2: Add import to app.jsx**

Add after the React import on line 1:

```javascript
import pptxgen from "pptxgenjs";
```

- [ ] **Step 3: Verify dev server starts**

```bash
cd Project && npm run dev
```

Expected: Vite dev server starts without errors. Visit http://localhost:5173 — app loads normally.

- [ ] **Step 4: Commit**

```bash
git add Project/package.json Project/package-lock.json Project/src/app.jsx
git commit -m "feat: add pptxgenjs dependency for MBR export"
```

---

## Task 2: Add MBR constants and utility functions

**Files:**
- Modify: `Project/src/app.jsx:75-85` (Section 1 — Constants & Utilities)

- [ ] **Step 1: Add PROGRAM_CATEGORIES mapping**

Insert after the `Q` object (after line 75):

```javascript
// ── MBR Export Constants ─────────────────────────────────────────────────────
const PROGRAM_CATEGORIES = {
  "BAU WR NS":       "Acquisition",
  "LOCALIZERS":      "Acquisition",
  "XM UP LIKELY":    "Multi-Product Expansion",
  "XM UP ONBOARDING":"Multi-Product Expansion",
  "XM ADD-A-LINE":   "Multi-Product Expansion",
  "XMC ATTACH":      "Up Tier & Ancillary",
};

const MBR_COLORS = {
  purple:      "6137F4",
  purpleDark:  "4a28c4",
  amber:       "FFAA00",
  green:       "008557",
  blue:        "1F69FF",
  orange:      "E54F00",
  red:         "E5004C",
  textPrimary: "1a1a1a",
  textSecondary:"888888",
  white:       "FFFFFF",
  lightGray:   "FAFAFA",
  cardBorder:  "E2E8F0",
};

const MBR_FONT = "Segoe UI";
```

- [ ] **Step 2: Add filename formatter**

Insert after `MBR_FONT`:

```javascript
function formatFiscalFilename(fiscalEnd) {
  if (!fiscalEnd) return "GCS_MBR_000000.pptx";
  const [y, m, d] = fiscalEnd.split("-");
  return `GCS_MBR_${m}${d}${y.slice(2)}.pptx`;
}
```

- [ ] **Step 3: Add MBR quartile color mapper**

Insert after `formatFiscalFilename`:

```javascript
function mbrQuartileColor(pctToGoal) {
  if (pctToGoal >= 100) return MBR_COLORS.green;
  if (pctToGoal >= 80)  return MBR_COLORS.blue;
  if (pctToGoal > 0)    return MBR_COLORS.amber;
  return MBR_COLORS.red;
}
```

- [ ] **Step 4: Verify dev server still runs**

```bash
cd Project && npm run dev
```

Expected: No errors. App loads normally.

- [ ] **Step 5: Commit**

```bash
git add Project/src/app.jsx
git commit -m "feat: add MBR export constants and utility functions"
```

---

## Task 3: Build Title Slide (Slide 1)

**Files:**
- Modify: `Project/src/app.jsx` — insert new section before `BusinessOverview` (~line 4430)

- [ ] **Step 1: Add the section comment and title slide builder**

Insert a new section before the `// SECTION 12 — BUSINESS OVERVIEW` comment (~line 4433):

```javascript
// ══════════════════════════════════════════════════════════════════════════════
// SECTION 11.5 — MBR PPTX EXPORT
// Generates a Monthly Business Review PowerPoint deck from perf data.
// ══════════════════════════════════════════════════════════════════════════════

function buildMbrTitleSlide(pres, fiscalInfo) {
  const slide = pres.addSlide();
  slide.bkgd = MBR_COLORS.purple;

  // Main title
  slide.addText("MONTHLY BUSINESS REVIEW", {
    x: 0.5, y: 1.8, w: 9, h: 1,
    fontSize: 36, fontFace: MBR_FONT, color: MBR_COLORS.white,
    bold: true,
  });

  // Subtitle
  slide.addText("GLOBAL CALLCENTER SOLUTIONS (GCS)", {
    x: 0.5, y: 2.8, w: 9, h: 0.6,
    fontSize: 16, fontFace: MBR_FONT, color: MBR_COLORS.amber,
  });

  // Date
  const fiscalEnd = fiscalInfo?.fiscalEnd || "";
  let dateLabel = "";
  if (fiscalEnd) {
    const [y, m] = fiscalEnd.split("-");
    const months = ["","January","February","March","April","May","June","July","August","September","October","November","December"];
    dateLabel = `${months[parseInt(m, 10)] || ""} ${y}`;
  }
  slide.addText(dateLabel, {
    x: 0.5, y: 3.5, w: 9, h: 0.5,
    fontSize: 14, fontFace: MBR_FONT, color: MBR_COLORS.white,
    italic: true,
  });

  // Amber accent line at bottom
  slide.addShape(pres.shapes.RECTANGLE, {
    x: 0, y: 5.15, w: 13.33, h: 0.04,
    fill: { color: MBR_COLORS.amber },
  });
}
```

- [ ] **Step 2: Quick smoke test — add a temporary test button**

Temporarily add a button in the data-toolbar (after line ~11141) to test slide generation:

```javascript
<button onClick={() => {
  const p = new pptxgen();
  p.layout = "LAYOUT_WIDE";
  buildMbrTitleSlide(p, perf.fiscalInfo);
  p.writeFile({ fileName: "test_title.pptx" });
}} style={{ padding: "0.3rem 0.65rem", background: "transparent", border: "1px solid var(--border-muted)", borderRadius: "var(--radius-sm, 6px)", color: "var(--text-muted)", fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.75rem", cursor: "pointer" }}>Test Title</button>
```

Load data in the app, click "Test Title", open the downloaded PPTX. Verify: purple background, white title text, amber subtitle, date, amber line.

- [ ] **Step 3: Remove the temporary test button**

Delete the test button added in step 2.

- [ ] **Step 4: Commit**

```bash
git add Project/src/app.jsx
git commit -m "feat: add MBR title slide builder"
```

---

## Task 4: Build Summary Dashboard Slide (Slide 2)

**Files:**
- Modify: `Project/src/app.jsx` — after `buildMbrTitleSlide`

- [ ] **Step 1: Add the slide header helper**

Insert after `buildMbrTitleSlide`:

```javascript
function addMbrSlideHeader(slide, pres, title, subtitle) {
  // Purple header background
  slide.addShape(pres.shapes.RECTANGLE, {
    x: 0, y: 0, w: 13.33, h: 1.1,
    fill: { color: MBR_COLORS.purple },
  });
  // Amber accent line
  slide.addShape(pres.shapes.RECTANGLE, {
    x: 0, y: 1.1, w: 13.33, h: 0.04,
    fill: { color: MBR_COLORS.amber },
  });
  // GCS branding
  slide.addText("GLOBAL CALLCENTER SOLUTIONS", {
    x: 0.4, y: 0.15, w: 5, h: 0.3,
    fontSize: 8, fontFace: MBR_FONT, color: "C0C0E0",
  });
  // Title
  slide.addText(title, {
    x: 0.4, y: 0.4, w: 7, h: 0.4,
    fontSize: 18, fontFace: MBR_FONT, color: MBR_COLORS.white,
    bold: true,
  });
  // Subtitle row
  if (subtitle) {
    slide.addText(subtitle, {
      x: 0.4, y: 0.75, w: 7, h: 0.3,
      fontSize: 10, fontFace: MBR_FONT, color: MBR_COLORS.amber,
    });
  }
}
```

- [ ] **Step 2: Add the summary dashboard builder**

```javascript
function buildMbrSummarySlide(pres, perf) {
  const slide = pres.addSlide();
  slide.bkgd = MBR_COLORS.white;

  const fi = perf.fiscalInfo;
  const fiscalEnd = fi?.fiscalEnd || "";
  let periodLabel = "";
  if (fiscalEnd) {
    const [y, m] = fiscalEnd.split("-");
    const months = ["","JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];
    periodLabel = `${months[parseInt(m, 10)] || ""} ${y} MTD`;
  }

  addMbrSlideHeader(slide, pres, "SUMMARY", periodLabel);

  // KPI cards
  const kpis = [
    { label: "HOURS",    actual: perf.totalHours,    plan: perf.globalPlanHours },
    { label: "SALES",    actual: perf.globalGoals,    plan: perf.planTotal },
    { label: "RGUs",     actual: perf.globalRgu,      plan: perf.globalPlanRgu },
    { label: "XI RGUs",  actual: perf.globalNewXI,    plan: perf.globalPlanNewXI },
    { label: "XM RGUs",  actual: perf.globalXmLines,  plan: perf.globalPlanXmLines },
    { label: "HEADCOUNT",actual: perf.uniqueAgentCount, plan: null },
  ];

  const cols = 3;
  const cardW = 2.7;
  const cardH = 1.2;
  const gapX = 0.3;
  const gapY = 0.25;
  const startX = 0.5;
  const startY = 1.4;

  kpis.forEach((kpi, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = startX + col * (cardW + gapX);
    const y = startY + row * (cardH + gapY);

    const hasPlan = kpi.plan != null && kpi.plan > 0;
    const pctGoal = hasPlan ? (kpi.actual / kpi.plan) * 100 : null;
    const pacing = hasPlan && fi ? calcPacing(kpi.actual, kpi.plan, fi.elapsedBDays, fi.totalBDays) : null;
    const accentColor = pctGoal != null ? mbrQuartileColor(pctGoal) : MBR_COLORS.purple;

    // Card background
    slide.addShape(pres.shapes.ROUNDED_RECTANGLE, {
      x, y, w: cardW, h: cardH,
      fill: { color: MBR_COLORS.lightGray },
      rectRadius: 0.05,
    });
    // Left accent border
    slide.addShape(pres.shapes.RECTANGLE, {
      x, y: y + 0.05, w: 0.04, h: cardH - 0.1,
      fill: { color: accentColor },
    });

    // Label
    slide.addText(kpi.label, {
      x: x + 0.15, y, w: cardW - 0.2, h: 0.3,
      fontSize: 7, fontFace: MBR_FONT, color: MBR_COLORS.textSecondary,
      bold: true,
    });

    // Value
    const valueText = hasPlan ? `${Math.round(pctGoal)}% to Goal` : String(Math.round(kpi.actual));
    slide.addText(valueText, {
      x: x + 0.15, y: y + 0.3, w: cardW - 0.2, h: 0.45,
      fontSize: 20, fontFace: MBR_FONT, color: MBR_COLORS.textPrimary,
      bold: true,
    });

    // Pacing line
    if (pacing) {
      slide.addText(`${Math.round(pacing.projectedPct)}% Pacing`, {
        x: x + 0.15, y: y + 0.75, w: cardW - 0.2, h: 0.3,
        fontSize: 9, fontFace: MBR_FONT, color: accentColor,
        bold: true,
      });
    }
  });

  // Data source attribution
  const lastDate = fi?.lastDataDate || "";
  slide.addText(`Data Source: BI data through ${lastDate}`, {
    x: 0.4, y: 5.05, w: 6, h: 0.25,
    fontSize: 7, fontFace: MBR_FONT, color: MBR_COLORS.textSecondary,
    italic: true,
  });
}
```

- [ ] **Step 3: Smoke test with temporary button**

Temporarily add a button in data-toolbar:

```javascript
<button onClick={() => {
  const p = new pptxgen();
  p.layout = "LAYOUT_WIDE";
  buildMbrTitleSlide(p, perf.fiscalInfo);
  buildMbrSummarySlide(p, perf);
  p.writeFile({ fileName: "test_summary.pptx" });
}} style={{ padding: "0.3rem 0.65rem", background: "transparent", border: "1px solid var(--border-muted)", borderRadius: "var(--radius-sm, 6px)", color: "var(--text-muted)", fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.75rem", cursor: "pointer" }}>Test Summary</button>
```

Load data + goals CSV, click "Test Summary". Verify: Slide 1 = title, Slide 2 = 6 KPI cards with purple header, correct values, pacing percentages, data source line.

- [ ] **Step 4: Remove test button, commit**

```bash
git add Project/src/app.jsx
git commit -m "feat: add MBR summary dashboard slide with KPI cards"
```

---

## Task 5: Build Per-Program Detail Slides (Slides 3–N)

**Files:**
- Modify: `Project/src/app.jsx` — after `buildMbrSummarySlide`

- [ ] **Step 1: Add the per-program slide builder**

```javascript
function buildMbrProgramSlide(pres, program, fiscalInfo, narrativeText, oppsText) {
  const slide = pres.addSlide();
  slide.bkgd = MBR_COLORS.white;

  const category = PROGRAM_CATEGORIES[program.jobType.toUpperCase()] || program.jobType;
  const fiscalEnd = fiscalInfo?.fiscalEnd || "";
  let periodLabel = "";
  if (fiscalEnd) {
    const [y, m] = fiscalEnd.split("-");
    const months = ["","JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];
    periodLabel = `${months[parseInt(m, 10)] || ""} ${y} MTD`;
  }

  addMbrSlideHeader(slide, pres, program.jobType, `${category}  |  ${periodLabel}`);

  // ── LEFT COLUMN: Insights ──
  const lx = 0.4;
  const ly = 1.35;

  // Project KPI Insights
  slide.addText("Project KPI Insights", {
    x: lx, y: ly, w: 4.5, h: 0.3,
    fontSize: 10, fontFace: MBR_FONT, color: MBR_COLORS.purple,
    bold: true,
  });
  slide.addText(narrativeText || "Add project insights here", {
    x: lx, y: ly + 0.3, w: 4.5, h: 1.4,
    fontSize: 9, fontFace: MBR_FONT, color: MBR_COLORS.textPrimary,
    valign: "top", wrap: true,
  });

  // Team Insights
  slide.addText("Team Insights", {
    x: lx, y: ly + 1.8, w: 4.5, h: 0.3,
    fontSize: 10, fontFace: MBR_FONT, color: MBR_COLORS.purple,
    bold: true,
  });
  slide.addText(oppsText || "Add team insights here", {
    x: lx, y: ly + 2.1, w: 4.5, h: 1.5,
    fontSize: 9, fontFace: MBR_FONT, color: MBR_COLORS.textPrimary,
    valign: "top", wrap: true,
  });

  // ── RIGHT COLUMN: Quartile Legend + Metrics Table ──
  const rx = 5.2;
  const ry = 1.35;

  // Quartile legend
  const qLegend = [
    { label: "Q1: 100%+ to goal", color: MBR_COLORS.green },
    { label: "Q2: 80-99.9% to goal", color: MBR_COLORS.blue },
    { label: "Q3: 1-79.9% to goal", color: MBR_COLORS.amber },
    { label: "Q4: 0% to goal", color: MBR_COLORS.red },
  ];

  const du = program.distUnique || {};
  qLegend.forEach((q, i) => {
    const qy = ry + i * 0.22;
    const qKey = `Q${i + 1}`;
    const count = du[qKey] || 0;
    slide.addShape(pres.shapes.RECTANGLE, {
      x: rx, y: qy, w: 0.12, h: 0.12,
      fill: { color: q.color },
    });
    slide.addText(`${q.label}  (${count})`, {
      x: rx + 0.18, y: qy - 0.03, w: 4, h: 0.2,
      fontSize: 7, fontFace: MBR_FONT, color: MBR_COLORS.textSecondary,
    });
  });

  // KPI Metrics Table
  const ty = ry + 1.15;
  const fi = fiscalInfo;

  // Build rows from available metrics
  const metricRows = [];
  const addRow = (label, actual, plan) => {
    if (plan == null || plan <= 0) return;
    const variance = actual - plan;
    const pctGoal = (actual / plan) * 100;
    const pacing = fi ? calcPacing(actual, plan, fi.elapsedBDays, fi.totalBDays) : null;
    metricRows.push([
      label,
      Math.round(plan).toLocaleString(),
      Math.round(actual).toLocaleString(),
      (variance >= 0 ? "" : "(") + Math.abs(Math.round(variance)).toLocaleString() + (variance < 0 ? ")" : ""),
      Math.round(pctGoal) + "%",
      pacing ? Math.round(pacing.projectedPct) + "%" : "—",
    ]);
  };

  const ge = program.goalEntry;
  addRow("HOURS",  program.totalHours,    ge ? getPlanForKey(ge, "Hours Goal") : null);
  addRow("SALES",  program.actGoals,      program.planGoals);
  addRow("RGUs",   program.totalRgu,      ge ? getPlanForKey(ge, "RGU GOAL") : null);
  addRow("XI RGUs",program.totalNewXI,    ge ? getPlanForKey(ge, "HSD Sell In Goal") : null);
  addRow("XM RGUs",program.totalXmLines,  ge ? getPlanForKey(ge, "XM GOAL") : null);
  const sphPlanVal = ge ? getPlanForKey(ge, "SPH GOAL") : null;
  if (sphPlanVal && program.totalHours > 0) {
    const sphActual = program.actGoals / program.totalHours;
    const sphPlan = sphPlanVal;
    const sphVar = sphActual - sphPlan;
    const sphPct = (sphActual / sphPlan) * 100;
    metricRows.push([
      "SPH",
      sphPlan.toFixed(2),
      sphActual.toFixed(2),
      (sphVar >= 0 ? "" : "(") + Math.abs(sphVar).toFixed(2) + (sphVar < 0 ? ")" : ""),
      Math.round(sphPct) + "%",
      "—",
    ]);
  }

  // Table header
  const headerRow = [
    { text: "", options: { fontSize: 7, fontFace: MBR_FONT, color: MBR_COLORS.white, fill: { color: MBR_COLORS.purple }, bold: true } },
    { text: "Goal", options: { fontSize: 7, fontFace: MBR_FONT, color: MBR_COLORS.white, fill: { color: MBR_COLORS.purple }, bold: true, align: "right" } },
    { text: "Actual", options: { fontSize: 7, fontFace: MBR_FONT, color: MBR_COLORS.white, fill: { color: MBR_COLORS.purple }, bold: true, align: "right" } },
    { text: "Variance", options: { fontSize: 7, fontFace: MBR_FONT, color: MBR_COLORS.white, fill: { color: MBR_COLORS.purple }, bold: true, align: "right" } },
    { text: "% Goal", options: { fontSize: 7, fontFace: MBR_FONT, color: MBR_COLORS.white, fill: { color: MBR_COLORS.purple }, bold: true, align: "right" } },
    { text: "% Pacing", options: { fontSize: 7, fontFace: MBR_FONT, color: MBR_COLORS.white, fill: { color: MBR_COLORS.purple }, bold: true, align: "right" } },
  ];

  const dataRows = metricRows.map(row => row.map((cell, ci) => ({
    text: cell,
    options: {
      fontSize: 7, fontFace: MBR_FONT,
      color: ci === 0 ? MBR_COLORS.textPrimary : MBR_COLORS.textPrimary,
      bold: ci === 0,
      align: ci === 0 ? "left" : "right",
      fill: { color: MBR_COLORS.white },
    },
  })));

  if (dataRows.length > 0) {
    slide.addTable([headerRow, ...dataRows], {
      x: rx, y: ty, w: 4.4,
      fontSize: 7,
      border: { pt: 0.5, color: MBR_COLORS.cardBorder },
      colW: [0.7, 0.7, 0.7, 0.7, 0.6, 0.6],
      rowH: 0.22,
      margin: [2, 4, 2, 4],
    });
  }

  // Data source attribution
  const lastDate = fi?.lastDataDate || "";
  slide.addText(`Data Source: BI data through ${lastDate}`, {
    x: 0.4, y: 5.05, w: 6, h: 0.25,
    fontSize: 7, fontFace: MBR_FONT, color: MBR_COLORS.textSecondary,
    italic: true,
  });
}
```

- [ ] **Step 2: Smoke test with temporary button**

Temporarily add a button in data-toolbar:

```javascript
<button onClick={() => {
  const p = new pptxgen();
  p.layout = "LAYOUT_WIDE";
  buildMbrTitleSlide(p, perf.fiscalInfo);
  buildMbrSummarySlide(p, perf);
  programs.forEach(prog => buildMbrProgramSlide(p, prog, perf.fiscalInfo, null, null));
  p.writeFile({ fileName: "test_programs.pptx" });
}} style={{ padding: "0.3rem 0.65rem", background: "transparent", border: "1px solid var(--border-muted)", borderRadius: "var(--radius-sm, 6px)", color: "var(--text-muted)", fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.75rem", cursor: "pointer" }}>Test Programs</button>
```

Load data + goals CSV, click "Test Programs". Verify:
- Each program gets its own slide
- Purple header with program name and category
- Left column has placeholder insight text
- Right column has quartile legend with counts
- KPI table shows only rows with plan values
- Variance uses parentheses for negatives

- [ ] **Step 3: Remove test button, commit**

```bash
git add Project/src/app.jsx
git commit -m "feat: add MBR per-program detail slide builder"
```

---

## Task 6: Build Placeholder Slides (Member Insights, Operations, Action Items)

**Files:**
- Modify: `Project/src/app.jsx` — after `buildMbrProgramSlide`

- [ ] **Step 1: Add placeholder slide builders**

```javascript
function buildMbrPlaceholderSlides(pres, programs) {
  // ── Member & Team Insights ──
  const s1 = pres.addSlide();
  s1.bkgd = MBR_COLORS.white;
  addMbrSlideHeader(s1, pres, "MEMBER & TEAM INSIGHTS", "Insights");

  let insightY = 1.4;
  (programs || []).forEach(prog => {
    s1.addText(prog.jobType, {
      x: 0.5, y: insightY, w: 9, h: 0.3,
      fontSize: 11, fontFace: MBR_FONT, color: MBR_COLORS.purple,
      bold: true,
    });
    s1.addText("Add member insights here", {
      x: 0.5, y: insightY + 0.3, w: 9, h: 0.5,
      fontSize: 9, fontFace: MBR_FONT, color: MBR_COLORS.textSecondary,
      italic: true,
    });
    insightY += 0.9;
  });

  // ── Operations ──
  const s2 = pres.addSlide();
  s2.bkgd = MBR_COLORS.white;
  addMbrSlideHeader(s2, pres, "OPERATIONS", "Looking Ahead");

  const opsSections = ["Attrition", "tNPS", "My Performance Stats"];
  opsSections.forEach((sec, i) => {
    const oy = 1.4 + i * 1.1;
    s2.addText(sec, {
      x: 0.5, y: oy, w: 9, h: 0.3,
      fontSize: 12, fontFace: MBR_FONT, color: MBR_COLORS.purple,
      bold: true,
    });
    s2.addText("Add content here", {
      x: 0.5, y: oy + 0.35, w: 9, h: 0.55,
      fontSize: 9, fontFace: MBR_FONT, color: MBR_COLORS.textSecondary,
      italic: true,
    });
  });

  // ── Action Items ──
  const s3 = pres.addSlide();
  s3.bkgd = MBR_COLORS.white;
  addMbrSlideHeader(s3, pres, "ACTION ITEMS", "Looking Ahead");

  // Two columns
  const colHeaders = ["COMCAST TEAM", "PARTNER TEAM"];
  colHeaders.forEach((hdr, i) => {
    const cx = i === 0 ? 0.5 : 5.2;
    s3.addText(hdr, {
      x: cx, y: 1.4, w: 4.3, h: 0.3,
      fontSize: 11, fontFace: MBR_FONT, color: MBR_COLORS.purple,
      bold: true,
    });
    s3.addText("Add action items here", {
      x: cx, y: 1.8, w: 4.3, h: 3,
      fontSize: 9, fontFace: MBR_FONT, color: MBR_COLORS.textSecondary,
      italic: true, valign: "top",
    });
  });
}
```

- [ ] **Step 2: Verify dev server runs**

```bash
cd Project && npm run dev
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add Project/src/app.jsx
git commit -m "feat: add MBR placeholder slides (member insights, operations, action items)"
```

---

## Task 7: Build the generateMBR() orchestration function

**Files:**
- Modify: `Project/src/app.jsx` — after `buildMbrPlaceholderSlides`

- [ ] **Step 1: Add the orchestration function**

```javascript
async function generateMBR(perf, onProgress) {
  const { programs, fiscalInfo } = perf;
  const pres = new pptxgen();
  pres.layout = "LAYOUT_WIDE";
  pres.author = "Performance Intel";
  pres.subject = "Monthly Business Review";

  // 1. Gather AI insights per program
  const insights = {};
  for (let i = 0; i < programs.length; i++) {
    const prog = programs[i];
    if (onProgress) onProgress(`Generating insights for ${prog.jobType}...`, i, programs.length);

    // Build the data object that buildAIPrompt expects
    const aiData = {
      jobType: prog.jobType,
      uniqueAgentCount: prog.uniqueAgentCount,
      totalHours: prog.totalHours,
      totalGoals: prog.totalGoals,
      gph: prog.gph,
      attainment: prog.attainment,
      planGoals: prog.planGoals,
      actGoals: prog.actGoals,
      distUnique: prog.distUnique,
      q1Agents: prog.q1Agents,
      q3Agents: prog.q3Agents,
      q4Agents: prog.q4Agents,
      regions: prog.regions,
      healthScore: prog.healthScore,
      totalNewXI: prog.totalNewXI,
      totalXmLines: prog.totalXmLines,
      newHiresInProgram: prog.newHiresInProgram,
      fiscalInfo,
      totalRgu: prog.totalRgu,
      sphActual: prog.totalHours > 0 ? prog.actGoals / prog.totalHours : 0,
      sphGoal: (() => {
        if (!prog.goalEntry) return null;
        const rows = uniqueRowsFromEntry(prog.goalEntry);
        const vals = rows.map(r => computePlanRow(r).sphGoal).filter(v => v > 0);
        return vals.length ? vals.reduce((s,v) => s+v, 0) / vals.length : null;
      })(),
    };

    // Check cache first, then generate
    // Note: _aiCache stores arrays (split by \n\n or \n), not raw strings.
    // We join cached arrays to strings for the PPTX slide text.
    const cachedNarrative = getAICache("narrative", prog.jobType, prog.totalGoals);
    const cachedOpps = getAICache("opps", prog.jobType, prog.totalGoals);

    let narrative = cachedNarrative ? (Array.isArray(cachedNarrative) ? cachedNarrative.join("\n\n") : cachedNarrative) : null;
    let opps = cachedOpps ? (Array.isArray(cachedOpps) ? cachedOpps.join("\n") : cachedOpps) : null;

    if (!narrative) {
      try {
        const prompt = buildAIPrompt("narrative", aiData);
        const raw = await ollamaGenerate(prompt);
        if (raw) {
          // Store as array (matching prefetchAI format) so in-app display works
          const arr = raw.split(/\n\n+/).filter(l => l.trim());
          setAICache("narrative", prog.jobType, prog.totalGoals, arr);
          narrative = arr.join("\n\n");
        }
      } catch { narrative = null; }
    }
    if (!opps) {
      try {
        const prompt = buildAIPrompt("opps", aiData);
        const raw = await ollamaGenerate(prompt);
        if (raw) {
          const arr = raw.split(/\n/).filter(l => l.trim()).map(l => l.replace(/^[\d\-\.\*\)]+\s*/, "").trim()).filter(Boolean);
          setAICache("opps", prog.jobType, prog.totalGoals, arr);
          opps = arr.join("\n");
        }
      } catch { opps = null; }
    }

    insights[prog.jobType] = { narrative, opps };
  }

  // 2. Build slides
  if (onProgress) onProgress("Building slides...", programs.length, programs.length);

  buildMbrTitleSlide(pres, fiscalInfo);
  buildMbrSummarySlide(pres, perf);

  programs.forEach(prog => {
    const ins = insights[prog.jobType] || {};
    buildMbrProgramSlide(pres, prog, fiscalInfo, ins.narrative, ins.opps);
  });

  buildMbrPlaceholderSlides(pres, programs);

  // 3. Download
  const filename = formatFiscalFilename(fiscalInfo?.fiscalEnd);
  await pres.writeFile({ fileName: filename });

  return filename;
}
```

- [ ] **Step 2: Verify dev server runs**

```bash
cd Project && npm run dev
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add Project/src/app.jsx
git commit -m "feat: add MBR generateMBR orchestration with AI insights and download"
```

---

## Task 8: Build the MBR Confirmation Modal

**Files:**
- Modify: `Project/src/app.jsx` — after `generateMBR`

- [ ] **Step 1: Add the modal component**

```javascript
function MbrExportModal({ perf, onClose }) {
  const [state, setState] = useState("confirm"); // "confirm" | "generating" | "error"
  const [progress, setProgress] = useState("");
  const [error, setError] = useState(null);
  const { programs, fiscalInfo } = perf;

  const handleGenerate = useCallback(async () => {
    setState("generating");
    try {
      await generateMBR(perf, (msg) => setProgress(msg));
      onClose();
    } catch (e) {
      console.error("MBR generation failed:", e);
      setState("error");
      setError(String(e.message || e));
    }
  }, [perf, onClose]);

  const fiscalEnd = fiscalInfo?.fiscalEnd || "unknown";
  const lastData = fiscalInfo?.lastDataDate || "unknown";

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.5)", backdropFilter: "blur(4px)" }}
      onClick={state === "generating" ? undefined : onClose}>
      <div onClick={e => e.stopPropagation()} style={{
        background: `var(--card-bg, #fff)`, borderRadius: "var(--radius-md, 10px)",
        border: "1px solid var(--glass-border)", padding: "1.5rem", width: "28rem", maxWidth: "90vw",
        fontFamily: "var(--font-ui, Inter, sans-serif)", boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
      }}>
        {state === "confirm" && (<>
          <div style={{ fontSize: "1rem", fontWeight: 700, color: `var(--text-primary)`, marginBottom: "0.75rem" }}>
            Generate Monthly Business Review
          </div>
          <div style={{ fontSize: "0.82rem", color: `var(--text-muted)`, marginBottom: "0.5rem" }}>
            {programs.length} program{programs.length !== 1 ? "s" : ""} &middot; Data through {lastData} &middot; Fiscal end {fiscalEnd}
          </div>
          <div style={{ fontSize: "0.78rem", color: `var(--text-dim)`, marginBottom: "1rem", maxHeight: "8rem", overflowY: "auto" }}>
            {programs.map(p => (
              <div key={p.jobType} style={{ padding: "0.2rem 0", borderBottom: "1px solid var(--border-muted)" }}>
                {p.jobType}
              </div>
            ))}
          </div>
          <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
            <button onClick={onClose} style={{
              padding: "0.4rem 1rem", borderRadius: "var(--radius-sm, 6px)",
              border: "1px solid var(--border-muted)", background: "transparent",
              color: `var(--text-muted)`, fontFamily: "var(--font-ui, Inter, sans-serif)",
              fontSize: "0.82rem", cursor: "pointer",
            }}>Cancel</button>
            <button onClick={handleGenerate} style={{
              padding: "0.4rem 1rem", borderRadius: "var(--radius-sm, 6px)",
              border: "none", background: "#6137F4", color: "#fff",
              fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.82rem",
              cursor: "pointer", fontWeight: 600,
            }}>Generate</button>
          </div>
        </>)}

        {state === "generating" && (
          <div style={{ textAlign: "center", padding: "1rem 0" }}>
            <div style={{ fontSize: "0.9rem", fontWeight: 600, color: `var(--text-primary)`, marginBottom: "0.75rem" }}>
              Generating MBR...
            </div>
            <div style={{ fontSize: "0.82rem", color: `var(--text-muted)` }}>{progress}</div>
          </div>
        )}

        {state === "error" && (<>
          <div style={{ fontSize: "0.9rem", fontWeight: 600, color: "#dc2626", marginBottom: "0.5rem" }}>
            Export Failed
          </div>
          <div style={{ fontSize: "0.82rem", color: `var(--text-muted)`, marginBottom: "1rem" }}>{error}</div>
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button onClick={onClose} style={{
              padding: "0.4rem 1rem", borderRadius: "var(--radius-sm, 6px)",
              border: "1px solid var(--border-muted)", background: "transparent",
              color: `var(--text-muted)`, fontFamily: "var(--font-ui, Inter, sans-serif)",
              fontSize: "0.82rem", cursor: "pointer",
            }}>Close</button>
          </div>
        </>)}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify dev server runs**

```bash
cd Project && npm run dev
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add Project/src/app.jsx
git commit -m "feat: add MBR export confirmation modal component"
```

---

## Task 9: Wire export button into data-toolbar

**Files:**
- Modify: `Project/src/app.jsx:~10658` (state declaration) and `~11142` (data-toolbar)

- [ ] **Step 1: Add showMbrModal state**

In the `App` component, find the existing state declarations (around line 10658). Add:

```javascript
const [showMbrModal, setShowMbrModal] = useState(false);
```

- [ ] **Step 2: Add Export MBR button to data-toolbar**

In the `[data-toolbar]` section, after the flex spacer (line ~11129) and before the "New File" button (line ~11130), add:

```javascript
{rawData && <button onClick={() => setShowMbrModal(true)} style={{ padding: "0.3rem 0.65rem", background: "transparent", border: "1px solid var(--border-muted)", borderRadius: "var(--radius-sm, 6px)", color: "var(--text-muted)", fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.75rem", cursor: "pointer", fontWeight: 500 }}>Export MBR</button>}
```

- [ ] **Step 3: Render the modal**

Insert after the settings modal block (around line ~11060, after the closing `)}` of the settings panel), before the header bar section. Add:

```javascript
{showMbrModal && rawData && <MbrExportModal perf={perf} onClose={() => setShowMbrModal(false)} />}
```

- [ ] **Step 4: End-to-end test**

1. Start dev server: `cd Project && npm run dev`
2. Load agent data CSV
3. Load goals CSV
4. Hover over the header bar to reveal the data-toolbar
5. Click "Export MBR"
6. Verify: confirmation modal appears with program list, fiscal info
7. Click "Generate"
8. Verify: progress messages appear per program
9. Verify: PPTX downloads with correct filename (e.g., `GCS_MBR_032126.pptx`)
10. Open PPTX and verify all slides:
    - Slide 1: purple title slide with date
    - Slide 2: summary dashboard with KPI cards
    - Slides 3–N: per-program detail with insights (AI or placeholder), quartile legend, KPI table
    - Member Insights: placeholder sections per program
    - Operations: placeholder sections
    - Action Items: two-column placeholder

- [ ] **Step 5: Commit**

```bash
git add Project/src/app.jsx
git commit -m "feat: wire MBR export button and modal into data-toolbar"
```

---

## Task 10: Polish and edge case handling

**Files:**
- Modify: `Project/src/app.jsx`

- [ ] **Step 1: Handle no-goals-loaded edge case**

In `buildMbrSummarySlide`, when plan values are all null (no goals CSV uploaded), KPI cards should show raw actual values instead of "NaN% to Goal". Verify this is already handled by the `hasPlan` check. If not, add guards.

In `buildMbrProgramSlide`, when `program.goalEntry` is null/undefined, the metrics table should be empty or show actuals only. Verify the `getPlanForKey` checks handle this.

- [ ] **Step 2: Handle no-fiscal-info edge case**

In `formatFiscalFilename`, if `fiscalInfo` is null (edge case with very sparse data), the function already falls back to `"GCS_MBR_000000.pptx"`. Verify the title slide and summary slide don't crash with null fiscalInfo.

- [ ] **Step 3: Handle Ollama-unavailable gracefully**

In `generateMBR`, the try/catch around `ollamaGenerate` already falls back to null, and `buildMbrProgramSlide` shows "Add project insights here" for null text. Verify this works by testing with Ollama stopped.

- [ ] **Step 4: Test with different program counts**

Load a dataset with only 1-2 programs. Verify:
- Summary slide shows correct aggregates
- Only the loaded programs appear as slides
- Member Insights placeholder sections match loaded programs
- Filename is still correct

- [ ] **Step 5: Commit**

```bash
git add Project/src/app.jsx
git commit -m "feat: polish MBR export edge cases and verify fallbacks"
```

---

## Verification Checklist

Before considering this feature complete, verify:

- [ ] PPTX downloads with correct filename format (`GCS_MBR_MMDDYY.pptx`)
- [ ] Title slide: purple background, white title, amber subtitle, date
- [ ] Summary slide: 6 KPI cards with correct values and pacing
- [ ] Program slides: one per loaded program, ordered by attainment
- [ ] Program slides: AI insights populated (or placeholder if Ollama down)
- [ ] Program slides: KPI table shows only metrics with plan values
- [ ] Placeholder slides: Member Insights, Operations, Action Items all present
- [ ] Confirmation modal: shows program list, has Generate/Cancel
- [ ] Progress indicator: updates per program during generation
- [ ] Error state: if generation fails, modal shows error with Close button
- [ ] Export button: only visible when data is loaded
- [ ] Export button: sits in hover-revealed data-toolbar, not primary bar
- [ ] No regressions: existing app functionality unaffected
