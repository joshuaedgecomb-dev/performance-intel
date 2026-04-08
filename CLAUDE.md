# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Performance Intel is a call center performance analytics dashboard for tracking telesales agent metrics across Xfinity programs (internet/HSD, mobile, video, phone). It displays program-level scorecards, agent leaderboards, quartile distributions, gainshare projections, pacing analysis, supervisor stats, and month-over-month comparisons.

**Stack**: PHP 8.x backend, Microsoft SQL Server (sqlsrv driver), Bootstrap 5 + jQuery frontend via the BaseJS framework, CanvasJS charts.

**Auth**: JWT RS256 via `base.php` using lcobucci/jwt. Every PHP page and endpoint must include `base.php` — never include `SQL.php` directly.

## Architecture

### Single-Page App
`index.php` is the main entry point — a single page with Bootstrap 5 tab navigation (Overview, Programs, Comparison, Today/TV). No iframes. Tabs lazy-load content on first show.

### Data Flow
```
Google Sheets CSV → PHP endpoints (fetch + parse + normalize + cache) → JSON → JavaScript renders UI
```

Data currently comes from Google Sheets via PHP `file_get_contents()`. The PHP layer handles all heavy data processing (normalization, quartile assignment, goal matching, program building). JavaScript handles UI rendering, charts, pacing math, and optional features (MBR export, TV Mode, AI).

### Directory Structure
```
index.php                          — App shell (Bootstrap tabs, modals, global init)
base.php                           — JWT auth middleware (shared, do not modify)
api.php                            — PHP-CRUD-API v2 (shared, do not modify)
Connections/
  SQL.php                          — MSSQL connection (shared)
  sqllib.php                       — SQL query wrapper (shared)
includes/
  csv.php                          — CSV parsing, number formatting, fetchCSV()
  normalize.php                    — 3-pass agent normalization, quartile assignment
  goals.php                        — Goal lookup builder, 7-strategy fuzzy matching
  programs.php                     — Program/region/supervisor/weekly builders
  fiscal.php                       — Fiscal month calendar, pacing calculations
  insights.php                     — Win/opp insights, narrative generation
  cache.php                        — File-based cache (5-min TTL)
JSON/
  get/
    _helpers.php                   — Shared cache-aware data loading functions
    sheet-data.php                 — Fetch + normalize agent CSV from Google Sheets
    sheet-goals.php                — Fetch + parse goals CSV
    sheet-newhires.php             — Fetch + parse new hires CSV
    sheet-prior.php                — Fetch prior month agent CSV
    sheet-prior-goals.php          — Fetch prior month goals CSV
    programs.php                   — Build all program summaries
    business-summary.php           — Global aggregates for overview
    program-detail.php             — Single program with supervisor/weekly/insights
    agent-daily.php                — Day-by-day agent profile
    supervisor-stats.php           — Per-supervisor team stats
    weekly-rollup.php              — Weekly data by supervisor
    comparison-data.php            — Prior vs current month comparison
  config/
    get.php                        — Read config values
    set.php                        — Write config values
script/
  BaseJS/basejs.js                 — Framework loader (see script/BaseJS/CLAUDE.md)
  perf-intel/
    constants.js                   — Quartile defs, gainshare tiers, MBR constants, formatters
    engine.js                      — Pacing, fiscal calendar, health score, sparklines
    overview.js                    — Business Overview tab renderer
    program.js                     — Program Detail tab (8 sub-tabs)
    comparison.js                  — Month-over-Month comparison tab
    today.js                       — Today View + TV Mode (external OTM API)
    mbr.js                         — PowerPoint MBR export (pptxgenjs)
    ai.js                          — Ollama local AI integration
css/
  perf-intel.css                   — Dark/light theme, glassmorphism, all component styles
```

### PHP Include Chain
```
csv.php              — standalone (no deps)
cache.php            — standalone
fiscal.php           — requires csv.php
normalize.php        — requires csv.php
goals.php            — requires csv.php
programs.php         — requires normalize.php + goals.php
insights.php         — requires programs.php (which pulls in normalize + goals)
```

All JSON endpoints require `base.php` (auth) and `_helpers.php` (cache-aware data loaders). The `_helpers.php` file requires `programs.php` + `fiscal.php` + `insights.php` + `cache.php`.

### JavaScript Load Order
Scripts are loaded in `index.php` in this order (after BaseJS):
1. `constants.js` — shared constants, must load first
2. `engine.js` — pacing/fiscal functions used by all tabs
3. `ai.js` — AI integration (used by overview, program, comparison)
4. `overview.js`, `program.js`, `comparison.js`, `today.js`, `mbr.js` — tab renderers (order doesn't matter)

### Global State
JavaScript stores shared data on `window.PERF`:
```javascript
window.PERF = {
    businessSummary: null,  // from business-summary.php
    fiscalInfo: null,       // fiscal month metadata
    config: {},             // from config/get.php
    localAI: false,         // Ollama toggle
    ollamaAvailable: false, // detected on page load
    todayData: null,        // OTM API data for Today tab
};
```

## Key Business Concepts

### Quartile System
Agents are classified by % to goal (aggregate across the fiscal month):
- **Q1**: >= 100% (Exceeding) — green `#16a34a`
- **Q2**: 80-99.9% (Near Goal) — blue `#2563eb`
- **Q3**: 1-79.9% (Below Goal) — amber `#d97706`
- **Q4**: 0% (No Activity) — red `#dc2626`

### Fiscal Month
Runs 22nd to 21st. Business days only (M-F). Pacing calculations project EOM based on elapsed business days.

### Data Normalization (normalize.php)
Three-pass process:
1. **Parse**: Normalize field names, parse numbers, remap regions (SD-Xfinty→SD-Xfinity, SD-Cox+GL*→SD-Xfinity), filter to valid regions
2. **Rollup**: Group by agent+jobType, sum hours/goals/products, compute aggregate GPH and % to goal
3. **Stamp**: Write the aggregate quartile back onto every daily row

### Goal Matching (goals.php)
7-strategy cascade to match agent job types to goal targets:
0. Direct ROC code match
1. Exact Target Audience
2. Normalized key match
3. Compact key match (strip all separators)
4. Project-level match
5. Substring at word boundary
6. Compact substring
7. Word overlap (70%+ threshold)

### Regions
Four valid regions: `SD-Xfinity`, `Belize City-XOTM`, `OW-XOTM`, `San Ignacio-XOTM`. These map to two site buckets: DR (SD-Xfinity) and BZ (all XOTM regions).

### Gainshare
Two tier tables: overall (GAINSHARE_TIERS) and site-level (GAINSHARE_SITE_TIERS). Tiers map attainment % to bonus/penalty amounts per product type.

## Code Conventions

### PHP
- All endpoints: `require_once base.php` first, then includes, then `header('Content-Type: application/json')`, then `echo json_encode($result, JSON_NUMERIC_CHECK)`
- Use `param($name, $default)` from sqllib.php for request parameters
- Use parameterized queries with `?` placeholders — never concatenate user input into SQL
- Use `cache_get()`/`cache_set()` from cache.php for expensive operations
- All sheet-fetch endpoints accept `?refresh=1` to force cache clear
- Config stored in `includes/.config.json` (not database, since SQL isn't used yet)

### JavaScript
- All page code runs inside `gcs.basejsDone.then(() => { ... })`
- Use `gcs.bsdt()` for data tables (see help.md for full API)
- Use `gcs.chart.buildBarChartData()`, `gcs.chart.buildMultiLineChartData()`, `gcs.chart.buildDoughnutChartData()` for charts
- Use `gcs.toast()` for notifications, `gcs.confirm()` for confirmations
- Tab renderers are global functions: `renderOverview(data)`, `renderProgram(target, name)`, `renderComparison()`, `renderToday()`
- Use CSS classes from perf-intel.css: `.perf-card`, `.stat-card`, `.pacing-banner`, `.insight-win`, `.insight-opp`, `.q1`-`.q4`, `.q-badge`, `.fade-in`
- Reference constants from constants.js: `Q_DEFS`, `GAINSHARE_TIERS`, `GOAL_METRICS`, `REGION_TO_SITE`, `MBR_COLORS`
- Reference functions from engine.js: `calcPacing()`, `getFiscalMonthInfo()`, `calculateHealthScore()`, `buildSparklineSVG()`

### CSS
- Dark theme is default (`:root` variables). Light theme via `[data-theme="light"]` attribute on `<html>`
- Theme toggle uses `gcs.setTheme()` or direct attribute toggle
- All colors use CSS custom properties for instant theme switching
- Glass-morphism: `backdrop-filter: blur(16px) saturate(180%)` on nav and cards

## Development Notes

- **No build system** — no npm/webpack/vite needed for the PHP version. The React/Vite setup (`src/`, `package.json`, `vite.config.js`) is the legacy codebase
- **Testing**: Load `index.php` in a browser on a PHP server with SQL Server configured. Google Sheets URLs are preconfigured with defaults
- **Cache**: Temp files in `sys_get_temp_dir()/perf_intel_cache/`. Clear with `?refresh=1` on any sheet endpoint, or the Refresh button in the UI
- **External APIs**: Today/TV Mode calls `smart-gcs.com/otm2/` endpoints directly from the browser. May need CORS proxy
- **MBR Export**: Loads pptxgenjs dynamically from CDN on first use
- **AI**: Optional Ollama integration (localhost:11434). Checks availability on page load, shows toggle if detected
- **Google Sheets**: Published CSV URLs are configurable via Settings modal. Defaults are hardcoded in `_helpers.php`

## Reference
- `help.md` — Comprehensive BaseJS framework guide (bsdt, sidebar, chart, page template patterns)
- `script/BaseJS/CLAUDE.md` — BaseJS library architecture and conventions
