# Virgil MBR Export — Design Spec

**Author**: Josh + Claude
**Date**: 2026-04-12
**Status**: Draft — awaiting user review
**Related**: `docs/superpowers/specs/2026-03-31-mbr-pptx-export-design.md` (existing MBR export — untouched)

---

## 1. Context & Goal

Virgil [Last Name], Director of Vendor Management at Comcast, is the audience for a separate monthly deck distinct from the existing internal MBR. GCS delivers this deck to Virgil monthly to review the full Xfinity telesales program.

This spec adds a new **Export Virgil MBR** action to Performance Intel that produces an 8-slide `.pptx` following Comcast's prescribed format. The existing **Export MBR** action is **untouched** — both exports coexist, separate code paths, separate modals, separate download flows.

## 2. Approach

**Fully parallel implementation.** New `buildVirgil*` functions and `VirgilMbrExportModal` component live alongside the existing `buildMbr*` / `MbrExportModal` in `src/app.jsx`. No refactors, no shared-primitive extraction. Minor duplication of theming helpers is accepted. Shared library extraction can happen later, as a separate cleanup, once both decks are stable.

Library: `pptxgenjs` (already in `package.json`).

## 3. UI Entry Point

**Location**: Settings (⚙) menu → Actions section, directly below the existing **Export MBR** row.

**New row**: `🎯 Export Virgil MBR` — hint `monthly`.

Clicking opens `VirgilMbrExportModal`.

### 3.1 Modal Contents

1. **Reporting-month picker** — defaults to the last complete fiscal month. Drives all "Reporting Month" references throughout the deck.

2. **Data-readiness status rows** (warnings, not blockers):
 - Coaching CSV: loaded / not uploaded
 - Weekly Breakdown CSV: loaded / not uploaded
 - Login Buckets CSV: loaded / not uploaded
 - Extended Agent Stats CSV: loaded / not uploaded (required for Slide 6)
 - Prior Quarter sheet URL: configured / missing
 - Scorecard PNG (Slide 3): uploaded / missing
 - Virgil Agent CSV schema additions: `Actual Leads` column detected / not detected

3. **Insight textareas** (modal-persisted across sessions via `perf_intel_virgil_insights_v1`):
 - Slide 2 — My Performance insights
 - Slide 4 — Quartile Reporting: two textareas (Reporting Month / MTD)
 - Slide 7 — tNPS insights
 - Slide 8 — "How can we support you?" and "Current incentives"
 - Slide 6 — per-campaign Performance Notes: 2 textareas per campaign (Feb / March)

 Each textarea has a button: **✨ AI generate** (uses existing Ollama integration if available; falls back to leaving the field empty). Blank submission is allowed; empty sections render as empty panels in the `.pptx`.

4. **Scorecard PNG upload** (Slide 3) — file picker that accepts an image; stored as a base64 data URL in state for embedding. Replaceable/removable.

5. **Download button** — assembles the `.pptx` and triggers browser download. Filename pattern: `Virgil MBR - <Month> <Year>.pptx`.

## 4. Data Sources

### 4.1 Reused (zero changes)
- Agent CSV (`rawData`) — current Performance Intel source
- Goals CSV (`goalsRaw`) — now extended with `Actual Leads` last column
- Prior-Month data (`priorMonthRaw`, `priorMonthGoalsRaw`)
- Roster CSV (`newHiresRaw`) — supplies Hire Date + End Date for Slide 8
- tNPS CSV (`tnpsRaw`)
- `fiscalInfo`, `buildProgram`, `programMap`, `perf.tnps*`, `bpLookup`

### 4.2 New — uploaded CSVs

| Purpose | localStorage key | Upload action | Schema |
|---|---|---|---|
| Coaching Details (Slide 2 org totals: Acknowledged %, % Coached, etc.) | `perf_intel_coaching_details_v1` | Settings → Upload Coaching Details CSV | Long format: `Measure Names`, `Fiscal Month`, `FM/FW Swap to Month`, `Measure Values` |
| Weekly Breakdown (Slide 2 DR/BZ split) | `perf_intel_coaching_weekly_v1` | Settings → Upload Weekly Breakdown CSV | Per-agent-week: `Name or NT`, `Fiscal Month`, `new calc` (FW end), `Coaching Sessions (copy)`, `Color WB`, `Manager`, `Supervisor.` |
| Login Buckets (Slide 2 login activity) | `perf_intel_login_buckets_v1` | Settings → Upload Login Buckets CSV | `User Login Bucket (Alternative)`, `Month vs Week View Label`, `Measure Names`, `Measure Values` |
| Extended Agent Stats (Slide 6 Dials/Contacts/Finals) | `perf_intel_extended_agent_v1` | Settings → Upload Extended Agent Stats CSV | Per-agent-per-day, matching `April Daily Stats 2026 - Agent Stats.csv` shape (columns: `Job, Date, Location, AgentTSR, AgentName, SupTSR, SupName, Dials, Goals, Contacts, Finals, NonFinals, Hours, AHTSec, CloseRate, GPH, CPH, DPH, CPS, WifiPassSales, xFiSales, NewVideo, UpgradeVideo, NewData, UpgradeData, NewVoice, UpgradeVoice, NewSecurity, UpgradeSecurity, XMSales, XMLines, NewXM, SavedXM, AddedXM, XMUpgrade, DeviceUpgrade, XMPP, Region, StormReadySales, Week Number, SPH Goal, Goals number, Job Type`) |

### 4.3 New — Google Sheet URL

| Purpose | localStorage key | UI |
|---|---|---|
| Prior Quarter Goals + Actuals (Slide 3 Q4 2025 column) | `perf_intel_prior_quarter_v1` | New URL input in Settings → Data Sources modal. Auto-fetched in `useEffect` alongside existing sheet loaders. CSV shape identical to existing Agent+Goals sheets. |

### 4.4 New — PNG upload (ephemeral)

Scorecard PNG for Slide 3 — held in modal state only (not persisted). User re-uploads each export run.

### 4.5 Goals CSV addition

The Goals CSV now includes an `Actual Leads` column (last column). `parseGoals` and `buildGoalLookup` pass this through to goal rows; Slide 6 reads it directly.

## 5. Global Rules

- **MTD column always renders** on slides that call for it (per template CSV — no user toggle).
- Reporting periods are computed relative to the reporting-month picker:
 - **Previous Quarter** = last full fiscal quarter before reporting month (Slide 3)
 - **Previous Month** = month before reporting month (Slides 3, 5, 6)
 - **Reporting Month** = picker value (all slides)
 - **MTD** = month after reporting month, agent data filtered to elapsed days (Slides 3, 4, 5)
- **Xfinity brand treatment** applied to every slide: teal→purple gradient top + bottom bars, "GLOBAL CALLCENTER SOLUTIONS" footer left-aligned, `xfinity | <slide#>` footer right-aligned, section-title eyebrow in uppercase small-caps above main title.
- Site logic reuses existing Performance Intel conventions (DR / BZ / `bpLookup` for NTID→site mapping).

## 6. Slide-by-Slide Spec

### Slide 1 — Intro
- Title: `VIRGIL MBR — <Reporting Month> <Year>`
- Audience line: `Presented to: Virgil <Last Name>, Director of Vendor Management, Comcast`
- GCS logo area + Xfinity watermark
- Fiscal-month-range subtitle (e.g., `Fiscal Month: Feb 22 – Mar 21`)

### Slide 2 — My Performance / Quality
Title: `MY PERFORMANCE / QUALITY — <Reporting Month>`

**Top row — 3 KPI blocks** (Coaching Details = org authoritative, Weekly Breakdown = DR/BZ split):

| Metric | Source | Org | DR | BZ |
|---|---|---|---|---|
| Coaching Standard Attainment (% Coached) | Coaching Details `% Coached` for reporting month | ✓ | from Weekly Breakdown | from Weekly Breakdown |
| Acknowledgement % | Coaching Details `Acknowledged %` | ✓ | from Weekly Breakdown (if derivable) | from Weekly Breakdown |
| Total Coaching Sessions | Coaching Details `Total Sessions` | ✓ | count from Weekly Breakdown | count from Weekly Breakdown |

DR/BZ derivation: parse `Name or NT` for NTID (after the `|` separator); look up site via existing `bpLookup`. Rows where `Color WB = "No Coaching Required"` are excluded from attainment denominators.

**Middle — myPerformance Login Activity**: horizontal stacked bar (org-wide only — source isn't site-split) showing reporting-month distribution across `0-3` / `4-7` / `8-15` / `16-20+` buckets. Each segment labeled with `%` and `Total Users`. Source: Login Buckets CSV filtered to reporting month.

**Bottom — Insights**: textarea content from modal; AI-optional; blank renders as empty panel.

**Caveat**: if DR+BZ implied org total diverges from Coaching Details `% Coached`, the Coaching Details number wins (authoritative headline).

### Slide 3 — All-in Attainment + Scorecard
Title: `OPERATIONAL PERFORMANCE — <Reporting Month>`

**Top table**: 4 columns
- **Q4 2025** (from prior-quarter sheet)
- **Feb 2026** (from `priorMonthRaw` / `priorMonthGoalsRaw`)
- **March 2026** (reporting — from current `rawData` / `goalsRaw`)
- **April MTD** (from current `rawData` filtered to elapsed days of month)

**Rows** (org-wide, one row per metric):
- XI attainment %
- XM attainment %
- SPH
- CPS

Values use existing `buildProgram` aggregations over the appropriate time window. If prior-quarter sheet is missing, Q4 column renders `—`.

**Bottom half — Scorecard BP Comparison (points view)**:
- Embedded PNG from modal upload (Comcast-provided scorecard image for reporting month)
- If no image uploaded, render an empty placeholder rectangle with "Scorecard not uploaded" label

### Slide 4 — Quartile Reporting
Title: `QUARTILE REPORTING — <Reporting Month>`

**Two columns side-by-side**: `Month Reporting On` (March) | `MTD` (April) — **both always render** regardless of how little MTD data exists.

**Inside each column, two sub-sections**:

1. **XM Participation** (ROC prefix `GLU` campaigns only)
2. **XI Participation** (ROC prefix `GLN` campaigns only)

**Per sub-section, two tables**:

**Quartile summary** (small table, left):
| Quartile | Units | % to Goal |
|---|---|---|
| 1 (green) | sum of XI or XM products made by Q1 agents | Q1 aggregate % to goal |
| 2 (yellow) | " | " |
| 3 (orange) | " | " |
| 4 (red) | " | " |

**Tenure × Quartile matrix** (larger table, right):

| Tenure | A (Q1) | B (Q2) | C (Q3) | D (Q4) | Participation % |
|---|---|---|---|---|---|
| 0–30 | count | count | count | count | % |
| 31–60 | | | | | |
| 61–90 | | | | | |
| 91–120 | | | | | |
| 121–150 | | | | | |
| 151–180 | | | | | |
| 181–360 | | | | | |
| 361+ | | | | | |

**Sort + split logic**:
1. Filter to qualified agents within the campaign group (GLU for XM, GLN for XI)
2. Sort descending by **% to Goal**
3. Split into 4 equal-sized groups (25/25/25/25)
4. Per quartile: sum Units, compute aggregate % to Goal

**Participation %** = (agents in tenure bucket with ≥1 unit sold) ÷ (total agents in bucket).

**Tenure** = (reporting-month-end) − (Roster `Hire Date`) in days. For MTD column, tenure recomputed as (today) − (Hire Date).

**Insights** textarea per column (Reporting On / MTD).

### Slide 5 — Campaign Hours Info
Title: `OPERATIONAL PERFORMANCE — Campaign Info (Feb · Mar · MTD)`

**Three horizontal bar groups** stacked top to bottom:
1. **Total February Monthly Budgeted Hours = <N>** (Previous Month)
2. **Total March Monthly Budgeted Hours = <N>** (Reporting Month)
3. **Total April MTD Budgeted Hours = <N>** (MTD)

Each group has:
- Color legend (Growth · National · Marketing · HQ · Total) with funding color swatches
- Row 1: **% to Hours Goal** — stacked segments per funding type
- Row 2: **Hours Actual** — stacked segments per funding type

Data: Goals CSV `Hours Goal` + `Funding` grouped per month; agent-data `Hours` grouped by ROC Numbers → joined to goals via existing `byROC` index.

**Bottom half — two header sections** (matching reference image):
- **Campaign Outlook** (left): Growth Funded column only
- **Base Management** (right): HQ Funded | Marketing Funded | National Funded columns

Each column is a bulleted list of campaigns in that funding bucket: `<Campaign Name> — <Hours> hours`. Data: Goals CSV rows for reporting month grouped by `Funding`. `Funding = Other` rows are omitted with a console warning.

Campaigns within each column sorted by **SPH performance highest → lowest** (per CSV note).

### Slide 6 — Per-Campaign Actual-to-Goal (N slides)

**One slide per campaign worked in Feb or March** (union of active campaigns across both months).

Title: `Actual to Goal – <Campaign Name>` (eyebrow: `OPERATIONAL PERFORMANCE`)

**Two side-by-side tables**: `PREVIOUS MONTH` (Feb) | `MONTH OF DISCUSSION` (March)

**Columns**: `GOALS` | `BUDGET` | `ACTUAL` | `VARIANCE` | `% GOAL`

**Top block rows**:
| Row | Source |
|---|---|
| BUDGET ($) | Hours Goal × $19.77 vs Hours Actual × $19.77 |
| HOURS | Goals CSV `Hours Goal` / sum of agent `Hours` |
| SALES | sum of agent `Goals` |
| RGUs | sum of XI + XM + Video + XH + Phone |
| HSD RGUs | `HSD Sell In Goal` (GOALS col %) / `HSD GOAL` (BUDGET) / actual |
| XM RGUs | `XM Sell In Goal` / `XM GOAL` / actual |
| VIDEO RGUs | `Video Sell In Goal` / `VIDEO GOAL` / actual |
| XH RGUs | `XH Sell In Goal` / `XH GOAL` / actual |
| PHONE RGUs | `Phone Sell In Goal` / `Projected Phone` / actual |

**Bottom block rows**:
| Row | Formula |
|---|---|
| CPS | (Hours Actual × $19.77) ÷ Sales |
| CPRGU | (Hours Actual × $19.77) ÷ RGUs |
| SPH | Sales ÷ Hours Actual |
| RGUPH | RGUs ÷ Hours Actual |
| RGU/HOME | RGUs ÷ Sales |

**Additional rows** (per your yellow-note):
| Row | Formula |
|---|---|
| Total Leads | Goals CSV `Actual Leads` (single number, not split into Goal/Actual/Variance) |
| Sales per Lead | Sales ÷ `Actual Leads` |
| % of Total Leads | (this campaign's `Actual Leads`) ÷ (sum of all campaigns' `Actual Leads` that month) |
| % of Total Hours | (this campaign's actual hours) ÷ (sum of all campaigns' actual hours that month) |
| Contact Rate | Sum(`Contacts` from Extended Agent CSV) ÷ `Actual Leads` × 100 |
| Lead Penetration | Sum(`Finals` from Extended Agent CSV) ÷ `Actual Leads` × 100 |

If Extended Agent CSV isn't uploaded, Contact Rate and Lead Penetration render `—`.

**Performance Notes**: two textareas per campaign slide (Feb / March), modal-entered, AI-optional, blank allowed.

**Slide generation order**: alphabetical by campaign name (stable, review-friendly).

### Slide 7 — Customer Experience (tNPS)

**Port existing `buildMbrTnpsSlide` logic into `buildVirgilTnpsSlide`**, then:

1. **Remove** the "% Promoters Emailed by Month" element
2. Apply Virgil deck theme (teal→purple brand bars, Xfinity footer)

Retained elements from existing slide:
- 4 KPI tiles: GCS tNPS (N surveys), Promoter%, Passive%, Detractor%
- Partner Ranking table — rows: Global Telesourcing, Avantive, Results, GCS (All Sites) + DR/BZ sub-rows — columns: `#` `Site/Partner` `tNPS` `Surveys` `Prom%` `Det%`
- tNPS by Campaign — GCS table — columns: `Campaign` `Program` `tNPS` `Surveys` `Prom%` `Det%`
- Monthly Vendor Ranking — 4-month trend across GCS / Avantive / Global Telesourcing / Results

Data source: existing `perf.tnps*` — no new inputs required.

**Insights** textarea — modal-entered.

### Slide 8 — Partner Experience
Title: `PARTNER EXPERIENCE — <Reporting Month>` (eyebrow: `PEOPLE & OPERATIONS`)

**Top row — two side-by-side text panels** with purple gradient header bars:
- **How Can We Support You?** — single textarea, modal-entered
- **Current Incentives** — newline-split bullet list, modal-entered

**Bottom row — two KPI-style data panels**:
- **New Hires & Training**:
 - Big count = hires where `Hire Date` ∈ reporting month
 - Site split bar (DR / BZ segments, colored orange/green)
 - List of up to 5 hires (Name + Hire Date + Site)
- **Attrition**:
 - Big count = roster rows where `End Date` ∈ reporting month
 - Site split bar
 - List of up to 5 departures (Name + End Date + Site)
 - Retention rate subline: `(active at month start − attrition) ÷ active at month start × 100`

## 7. AI Insights (Optional)

Each modal textarea shows a `✨ AI generate` button. Handler:
1. If `ollamaAvailable && localAI`: invoke existing generation helper with a slide-specific prompt, populate textarea with output
2. Else: no-op (leave textarea as-is — user types manually or leaves blank)

Slide-specific prompt templates live in a new `VIRGIL_AI_PROMPTS` constant near existing `generateNarrative` helpers. Each prompt receives the relevant slide's computed data and returns a 2–3 sentence summary.

Blank textareas are permitted — corresponding panels render empty in the `.pptx`.

## 8. New localStorage Keys

| Key | Shape | Purpose |
|---|---|---|
| `perf_intel_coaching_details_v1` | raw CSV string | Coaching Details upload (org totals) |
| `perf_intel_coaching_weekly_v1` | raw CSV string | Weekly Breakdown upload (DR/BZ split) |
| `perf_intel_login_buckets_v1` | raw CSV string | Login Buckets upload |
| `perf_intel_extended_agent_v1` | raw CSV string | Extended Agent Stats upload |
| `perf_intel_prior_quarter_v1` | raw CSV string | Prior-quarter Google Sheet cache |
| `perf_intel_prior_quarter_url_v1` | URL string | User-configured sheet URL |
| `perf_intel_virgil_insights_v1` | `{ slideKey: textContent }` JSON | Modal textarea persistence across sessions |

All follow the existing private/public setter pattern (`_setFoo` / `setFoo` with try/catch localStorage).

## 9. File Layout (all in `src/app.jsx`)

New code sections, in source order (after existing `§11.6 MBR PPTX Export`):

1. `§11.7 Virgil MBR Export`
 - Parsers: `parseCoachingDetails`, `parseCoachingWeekly`, `parseLoginBuckets`, `parseExtendedAgentStats`, `parsePriorQuarter`
 - Aggregators: `buildCoachingStats`, `buildLoginDistribution`, `buildExtendedAgentLookup`, `buildQuartileBuckets`, `buildCampaignHoursByFunding`, `buildAttritionStats`
 - Brand helpers: `virgilBrandBar(slide, position)`, `virgilFundingColors`, `virgilTheme` object
 - Slide builders: `buildVirgilTitleSlide`, `buildVirgilMyPerformanceSlide`, `buildVirgilScorecardSlide`, `buildVirgilQuartileSlide`, `buildVirgilCampaignHoursSlide`, `buildVirgilCampaignBreakoutSlides` (plural — generates N), `buildVirgilTnpsSlide`, `buildVirgilPartnerExperienceSlide`
 - Orchestrator: `buildVirgilMbrPresentation(pres, perf, options)`
 - Modal: `VirgilMbrExportModal`

App-level additions:
- Settings menu: new `MenuRow` for "Export Virgil MBR"
- Settings menu: new upload rows (Coaching Details, Weekly Breakdown, Login Buckets, Extended Agent Stats)
- Data Sources modal: new URL input for Prior Quarter sheet
- App state: `showVirgilMbrModal`, plus the new localStorage-backed states
- `handleRefresh`: extended to also fetch the prior-quarter sheet

## 10. Open Dependencies

Must be resolved before the **Content** passes of v1 ships (can be implementation-gated but spec-approved now):

1. **Prior Quarter Google Sheet URL** — user provides. Blocks Slide 3 Q4 2025 column only.
2. **Scorecard PNG** — user uploads at export time each month. Blocks Slide 3 bottom half only.
3. **Extended Agent Stats data availability** — user commits to providing monthly. Blocks Slide 6 Contact Rate + Lead Penetration rows only.
4. **Virgil's last name** — for Slide 1 audience line.

None of these block the modal/UI/code skeleton. Each missing input degrades gracefully to `—` or empty panel with a labeled warning in the modal's data-readiness rows.

## 11. Out of Scope (v1)

- Export-to-PDF
- Shared slide-primitive library (refactor deferred; will consider once both decks stabilize)
- Batch/scheduled automated exports
- Presenter-mode or web-rendered view of the Virgil deck (PPTX only)
- Per-site tNPS breakdown on Slide 7 beyond what existing MBR slide already shows
- Switching Performance Intel's core agent data pipeline to the richer schema (Slide 6 alone consumes the extended CSV)

## 12. Testing Checklist

**Pre-Virgil regression**:
- [ ] Existing Export MBR still produces byte-identical output
- [ ] No new console errors in existing flows
- [ ] `handleRefresh` still fetches all legacy sheets

**Virgil-specific**:
- [ ] Export Virgil MBR menu row appears below Export MBR
- [ ] Modal opens with reporting-month picker defaulting to last complete fiscal month
- [ ] Data-readiness rows show accurate status for each dependency
- [ ] Missing data sources produce `—` or empty panels, not crashes
- [ ] Scorecard PNG upload renders at proper aspect ratio on Slide 3
- [ ] Slide 4 tenure buckets include 91–120 (not in Comcast's original reference)
- [ ] Slide 4 quartile split is force-even (25/25/25/25) regardless of sample size
- [ ] Slide 5 `Funding = Other` rows omitted from Campaign Outlook / Base Management with console warning
- [ ] Slide 6 generates one slide per campaign, sorted alphabetically
- [ ] Slide 7 does NOT render "% Promoters Emailed by Month"
- [ ] Slide 8 Retention rate formula matches spec
- [ ] Virgil insights textarea content persists across modal close/reopen via localStorage
- [ ] AI generate button falls back to no-op when Ollama unavailable
- [ ] Final `.pptx` opens cleanly in PowerPoint and Google Slides

## 13. Migration / Rollout

1. Ship modal shell + Slide 1 (title) + Slide 2 first — implement, deploy to GitHub Pages, user validates on prod before continuing
2. Slides 3, 4, 5 next batch
3. Slide 6 (per-campaign N slides) — largest single piece
4. Slides 7, 8 + AI insights wrap-up

Writing-plans will carve these into ordered implementation phases.
