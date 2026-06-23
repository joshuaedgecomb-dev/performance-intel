# Daily Breakdown — Product Code Columns (data-driven)

**Date:** 2026-06-23
**Status:** Approved design, pending spec review → implementation plan
**Component touched:** `DailyBreakdownPanel` (`src/app.jsx`), `normalizeAgents`

## Goal

Add a TodayView-style **Product Code Columns** picker to the Daily Performance
Breakdown table, so users can append per-product sales columns (New Video, Tier
Upgrades, XM types, etc.) to the per-day / weekly / TOTAL rows. The set of
available products is **data-driven from the loaded CSV**, so it grows as columns
are added to the Sheet — no code change needed for new columns.

## Background & constraints

- The Daily table reads the **monthly CSV** (`normalizeAgents` rows), not the live
  OTM feed. Verified: the OTM endpoint (`OTM.php`) returns a **today-only snapshot
  with no date field**, so granular product *history* can only come from the CSV.
- The current CSV exposes **19 product columns** (cols 20–39). The granular OTM
  codes (HSD tiers, TV plans, premium channels) are **not** in the CSV and are
  therefore out of scope for the historical Daily table — they remain live-only in
  TodayView.
- `DailyBreakdownPanel` is shared by **three** views (SiteDrilldown line ~4518,
  BusinessOverview Daily line ~14165, program Slide line ~17884). The picker will
  appear in **all three** (approved) — no gating prop.

## Scope

**In scope**
- Product-column picker on `DailyBreakdownPanel` (all 3 usages).
- Data-driven product detection from the CSV with a curated label/category registry.
- Per-day, weekly-subtotal, and TOTAL aggregation of selected products.

**Out of scope**
- TodayView is untouched (keeps its own picker + `today_selected_codes`).
- No data-pipeline / Sheet changes; no granular OTM codes in history.
- No change to existing HSD / XM / GPH / % to Goal columns.

## Data layer

1. **Product registry** — module-level constant mapping CSV column → `{ label,
   category }`. Categories mirror TodayView: *RGU / New Sales*, *Tier Upgrades*,
   *Mobile (XM)*, *Other*.

   | CSV column | Label | Category | In picker |
   |---|---|---|---|
   | NewVideo | New Video | RGU / New Sales | ✓ |
   | NewVoice | New Phone | RGU / New Sales | ✓ |
   | NewSecurity | New XH | RGU / New Sales | ✓ |
   | WifiPassSales | Wifi Pass | RGU / New Sales | ✓ |
   | xFiSales | xFi Complete | RGU / New Sales | ✓ |
   | StormReadySales | Storm Ready | RGU / New Sales | ✓ |
   | UpgradeVideo | Tier Upgrade – Video | Tier Upgrades | ✓ |
   | UpgradeData | Tier Upgrade – HSD | Tier Upgrades | ✓ |
   | UpgradeVoice | Tier Upgrade – Phone | Tier Upgrades | ✓ |
   | UpgradeSecurity | Tier Upgrade – XH | Tier Upgrades | ✓ |
   | XMUpgrade | Tier Upgrade – Mobile | Tier Upgrades | ✓ |
   | DeviceUpgrade | Device Upgrade | Tier Upgrades | ✓ |
   | XMSales | XM Sales | Mobile (XM) | ✓ |
   | NewXM | New XM | Mobile (XM) | ✓ |
   | SavedXM | Saved XM | Mobile (XM) | ✓ |
   | AddedXM | Added XM | Mobile (XM) | ✓ |
   | XMPP | XM Protection Plan | Mobile (XM) | ✓ |
   | NewData | New HSD | — | ✗ already shown as **HSD** (dedup) |
   | XMLines | New Mobile | — | ✗ already shown as **XM** (dedup) |

2. **`normalizeAgents`** gains a `products` map per row (`{ [csvColumn]: number }`)
   for all recognized product columns. Existing named fields (`newXI`, `xmLines`,
   etc.) are unchanged.

3. **Data-driven detection** — available picker columns = registry columns that
   exist in the CSV header, **plus** any CSV column that is neither in the registry
   nor in a **metadata denylist** (Job, Date, Location, *TSR/*Name, Dials, Goals,
   Contacts, Finals, NonFinals, Hours, AHTSec, CloseRate, GPH, CPH, DPH, CPS,
   Region, Week Number, SPH Goal, Goals number, Job Type). Unknown extras surface
   under *Other* — this is the auto-grow mechanism.

4. **`buildDayStats`** accumulates `products[col]` sums per date alongside the
   existing hours/goals/hsd/xm; weekly-subtotal and TOTAL rollups sum the same
   product fields.

## UI

- A **"Product Code Columns"** bar above the table (matching TodayView's chip +
  categorized-dropdown styling): selected products show as removable chips; a
  "Show All / Close" dropdown lists available products grouped by category with
  toggle buttons.
- Selected products render as appended `<th>`/`<td>` in: header row, each day row,
  each weekly-subtotal row, the TOTAL `<tfoot>` row, and the "absent day"
  placeholder (its `colSpan` is recomputed). Product columns insert **after XM and
  before "% to Goal"** (which stays the last column).
- Each cell shows that day's summed integer count for the product, rendered exactly
  the way the existing **HSD / XM** cells render their values (including how they
  show zero) — match the current cell styling, no new convention.

## Persistence & defaults

- New localStorage key **`perf_intel_daily_product_cols_v1`** holding the selected
  column array. Independent from TodayView's `today_selected_codes`.
- **Default: none selected** → table is byte-identical to today until the user opts
  in (keeps the table from being overloaded and avoids surprising existing users).

## Edge cases

- **Dedup:** `NewData` and `XMLines` excluded from the picker (already shown as HSD
  and XM).
- **Spanish Callback:** already filtered out upstream (`!a.isSpanishCallback`); no
  change.
- **Width:** many products → wide table; rely on the table's existing horizontal
  container behavior; default-off keeps it manageable. (If overflow is ugly, add
  `overflow-x:auto` on the table wrapper — confirm during implementation.)
- **MoM / historical months:** the picker reads whatever CSV is active, so it works
  across month switches with no special handling.
- **Empty current month (e.g., July start):** no rows → existing "absent" handling
  applies; product columns simply show 0/—.

## Verification

- `npx vite build` passes (brace balance / syntax).
- Manual: load a CSV with data (e.g., June via the historical-months switch),
  select 2–3 products, confirm per-day values and the TOTAL match an independent
  tally (`awk` sum on the CSV). Confirm default-off renders the table identically to
  current. Confirm the picker appears on all three daily tables.

## Open questions

- None blocking. Minor implementation calls (exact category ordering, horizontal
  overflow handling) follow existing table conventions and are settled in the plan.
