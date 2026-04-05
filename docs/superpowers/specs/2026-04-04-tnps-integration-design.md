# tNPS Integration — Design Spec

**Date:** 2026-04-04
**Status:** Approved
**Scope:** Add tNPS survey data to the Performance Intel dashboard — auto-fetched from Google Sheets, with an Overview summary row, a dedicated deep-dive slide, and agent-level enrichment on existing views.

## Problem

The dashboard tracks sales performance and operational metrics but has no customer experience dimension. tNPS data exists in a separate spreadsheet with 3,656+ surveys across 8 sites. Adding it enables correlation between sales output and customer satisfaction — identifying agents with high sales but poor tNPS, supervisors whose teams need coaching on customer experience, and site-level quality trends.

## Data Sources

All three sources are tabs in the same Google Sheets workbook, auto-fetched as published CSVs:

| Source | GID | Key Fields |
|--------|-----|------------|
| tNPS Surveys | 2128252142 | Employee NTID, SMS tNPS (0-10), Site, Telesales Campaign, Transaction Date, Reason for score, Rep Sat, Topics Tagged Original, Alert type/status |
| Roster | 25912283 | BP (= Employee NTID), First Name, Last Name, Region, Supervisor Name, Hire Date, Role |
| Goals/Plan | 1685208822 | Already loaded |

**Published URL pattern:**
```
https://docs.google.com/spreadsheets/d/e/2PACX-1vRagC_XDSQ84y25onmWs6MUOZcEdWZNA6fVRRDFUzNWQp3ginYLtOIQsSrwmbAERkOJ-daTvbHqEtoy/pub?gid={GID}&single=true&output=csv
```

## Data Parsing & Normalization

### Score Column

The score column is **`SMS tNPS`** (numeric 0-10). Other columns like `Rep Sat` are separate metrics — do not confuse them.

### tNPS Score Classification
- **Promoter:** 9-10
- **Passive:** 7-8
- **Detractor:** 0-6

### tNPS Score Calculation
```
tNPS = (% Promoters - % Detractors) × 100
```
Ranges from -100 to +100. Computed per any grouping (site, campaign, supervisor, agent, month).

### Site Mapping

The authoritative site column is **`Site`** (not `Location`). All grouping and filtering uses this column.

**GCS sites (full detail):**
- "Global Callcenter Solutions Belize" → "Belize City"
- "Global Callcenter Solutions Ignaco" → "San Ignacio"
- "Global Callcenter Solutions Santo Domingo" → "Dom. Republic"

**Other partners (rolled up by company, not location):**
- "Avantive Solutions Guadalajara" + "Avantive Solutions Mexico City" → "Avantive"
- "Global Telesourcing Monterrey" (+ iGuard variant) → "Global Telesourcing"
- "Results Alaskaland" (+ Trial + Telesales variants) → "Results"

GCS sites get full drill-down. Partner companies appear only in the ranking leaderboard as single company-level entries.

**Note:** The roster has a `Region` column (e.g., "Belize City-XOTM") which is more granular than tNPS `Site`. For tNPS grouping, the tNPS `Site` column is authoritative. The roster `Region` is only used for agent-level metadata (hire date, supervisor, etc.), not for tNPS site classification.

### Campaign-to-Program Mapping

**Exhaustive campaign list from data (16 distinct values):**

| Campaign (exact string in data) | Program Badge | Notes |
|--------------------------------|---------------|-------|
| "Add XM" | XM | |
| "Add XMC" | XMC | |
| "Non Subs" | Nonsub | |
| "XM Retargeting" | — | Standalone, do NOT match to XM |
| "Smart Leads" | — | Standalone, do NOT match to XM |
| "Winback Non Sub" | — | Standalone, do NOT match to Nonsub |
| "Repackage" | — | Standalone |
| "Cancelled Installs" | — | Standalone |
| "IBS Follow Up" | — | Standalone |
| "Winback Sub" | — | Standalone |
| "iGuard" | — | Standalone |
| "iGuard Retention" | — | Standalone |
| "XFINITY Home" | — | Standalone |
| "Localizers" | — | Not present in current data; keep mapping if it appears |
| (blank / empty) | "Untagged" | 64 rows have no campaign — display as "Untagged" |
| Any other value | — | Keep as-is, standalone |

**Important:** Do not use substring matching. "XM Retargeting" and "Smart Leads" must NOT be grouped under the XM program. Match only exact strings.

Campaigns that map to a program show a badge linking them. Unmapped campaigns are shown separately — nothing gets lost.

### Agent Matching

Join `Employee NTID` (tNPS) against `BP` (roster) to get:
- Agent display name (`First Name` + `Last Name`)
- Supervisor
- Region
- Hire date

The roster CSV is already fetched for new hires, but a BP→name lookup map does not currently exist in the codebase — it must be built. Parse the roster CSV and create an object keyed by `BP` (lowercased, trimmed) with values containing `firstName`, `lastName`, `supervisor`, `region`, `hireDate`.

### Month Extraction

Parse `Transaction Date` (format: "3/20/2026 14:34") to extract month for trending. Group by calendar month. The data spans **December 2025 through April 2026** (not just Jan-Apr). Include all months present in the data.

### Trending Granularity

**Monthly only.** Outbound telesales survey volume is too low for meaningful weekly analysis. Monthly keeps sample sizes meaningful.

## Section 1: Overview Summary Row

**Location:** On the Overview tab, after the Program Scorecard, before Wins & Opportunities. Only renders when tNPS data is loaded.

**Layout:** Compact KPI row (similar to the existing KPI strip style):

| Metric | Display |
|--------|---------|
| Overall tNPS | Headline number (e.g., +42), colored green (≥50) / amber (20-49) / red (<20) |
| Survey Count | Total surveys in current fiscal month |
| Promoter / Passive / Detractor % | Three values with a stacked bar underneath |
| vs Other Partners | GCS aggregate tNPS vs "Other Partners" average benchmark |
| MoM Delta | Arrow up/down with change from prior month |

Clicking the row navigates to the full tNPS slide.

## Section 2: tNPS Deep-Dive Slide

A full slide in the navigation sequence (after Overview, before program slides). Has sub-tabs at the top.

### Tab 2a: Summary

The landing view with:

**KPI Cards:**
- Overall tNPS score (GCS aggregate)
- Total survey volume
- Promoter / Passive / Detractor split with percentages

**GCS Site Comparison:**
- Bar chart showing tNPS score per GCS site (Belize City, San Ignacio, Dom. Republic)
- Survey count label on each bar
- Color-coded: green ≥50, amber 20-49, red <20

**Partner Ranking:**
- Leaderboard table: GCS individual sites + Avantive + Global Telesourcing + Results
- Ranked by tNPS score
- GCS sites visually highlighted (distinct background or border)
- Columns: Rank, Site/Partner, tNPS, Surveys, Promoter %, Detractor %

**Monthly Trend:**
- Bar chart showing GCS overall tNPS by month (Dec 2025 → Apr 2026, all months with data)
- Option to overlay individual GCS sites as grouped bars
- Survey count shown per month for context

### Tab 2b: By Campaign

**Campaign Table:**
- One row per campaign
- Columns: Campaign, Program (badge if mapped), tNPS, Surveys, Promoter %, Detractor %
- Sorted by tNPS score descending
- Campaigns with program mappings show a colored badge (e.g., amber "XM" tag next to "Add XM")

**Campaign Bar Chart:**
- tNPS score per campaign, horizontal or vertical bars
- Color-coded by tNPS threshold

### Tab 2c: By Supervisor

Coaching-oriented view for GCS supervisors only.

**Supervisor Table:**
- One row per supervisor
- Columns: Supervisor, Site, Team tNPS, Surveys, Promoter %, Detractor %, Delta vs Site Avg
- Sorted by tNPS ascending (worst first = most coaching opportunity)
- Supervisors significantly below site average highlighted with red accent

**Expandable Rows:**
- Click a supervisor row to expand
- Shows their agents' individual tNPS: Agent Name, Score Count, tNPS, Promoter/Detractor split
- Agents sorted by tNPS ascending

### Tab 2d: Customer Voices

Feedback feed for reading customer comments.

**Scrollable List:**
- Each entry shows: score (colored chip), agent name, campaign, site, date, full "Reason for score" text
- Detractor comments (0-6) highlighted with red left-border accent
- Promoter comments (9-10) with green left-border accent

**Filters:**
- Score type: All / Promoter / Passive / Detractor
- Site: All GCS / Belize City / San Ignacio / Dom. Republic
- Campaign: dropdown of all campaigns
- Date range: month selector

## Section 3: Agent-Level Enrichment

On existing program slides and agent tables throughout the dashboard:

**tNPS Badge:**
- Agents with tNPS data get a small colored chip next to their name
- Shows their personal tNPS score (or Promoter/Detractor count)
- Green: majority promoter, Red: majority detractor, Gray: insufficient data (<3 surveys)
- Agents without tNPS data show no badge (no empty state clutter)

**Agent Detail Expansion:**
- When expanding/clicking an agent row in existing tables, their tNPS surveys are listed below their performance data
- Each survey: date, score, campaign, reason for score text
- Sorted most recent first

## Implementation Phasing

**Phase 1 — Data + Overview + Summary tab:**
- tNPS CSV auto-fetch and parsing
- Roster BP→name matching
- Site and campaign mapping
- Overview KPI row
- tNPS slide with Summary tab (KPIs, site comparison, partner ranking, monthly trend)

**Phase 2 — Drill-down tabs + Agent enrichment:**
- By Campaign tab
- By Supervisor tab
- Customer Voices tab
- Agent-level tNPS badges and detail expansion on existing views

## Theme Support

All components use existing CSS variables. Follow the same patterns as the scorecard redesign — `var(--bg-secondary)`, `var(--text-warm)`, etc. tNPS-specific colors:
- Promoter: `#16a34a` (green)
- Passive: `#d97706` (amber)
- Detractor: `#dc2626` (red)

## Data Volume Considerations

- 3,656 rows across 4 months, ~400 GCS surveys
- 105 columns but only ~15 are used for display — parse only needed fields
- No performance concern at this scale — in-browser processing is fine
- Roster is 917 rows — BP lookup is a simple object map
