# Daily Breakdown Product-Code Columns — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a TodayView-style, data-driven Product Code Columns picker to the Daily Performance Breakdown table (`DailyBreakdownPanel`), sourced from the monthly CSV.

**Architecture:** All changes are in the single file `src/app.jsx`. A module-level product registry + metadata denylist drive which CSV columns are "products." `normalizeAgents` attaches a `products` map per row; `buildDayStats` (inside `DailyBreakdownPanel`) sums products per day; new component state + a mirrored TodayView picker render the selected products as appended table columns. Defaults to no products selected, so the table is unchanged until used.

**Tech Stack:** React 18 (named imports only), Vite build, inline-CSS-in-JSX, localStorage persistence. No test runner — verify with `npx vite build` + manual browser checks + `awk` tallies against the CSV.

## Global Constraints

- Edit only the **root** `src/app.jsx` (NOT `Project/src/app.jsx`). Working folder: `C:\Users\Joshu\Documents\Claude\Performance Intel`.
- Named React imports only — never `React.X` (use `Fragment`, etc.). Use `catch(e) {}`, never bare `catch {}`.
- localStorage state uses the project pattern: `const [x,_setX]=useState(()=>{try{...}catch(e){return d}}); const setX=useCallback(v=>{_setX(v);try{localStorage.setItem(...)}catch(e){}},[])`.
- **Line numbers shift after every edit — re-grep for anchors before each edit.** Verify brace balance; `npx vite build` catches syntax errors (`✓ built in` = success).
- Default selection is **empty** — the table must render byte-identical to today when nothing is selected.
- New localStorage key: `perf_intel_daily_product_cols_v1`. Do not touch TodayView's `today_selected_codes`.
- Reference spec: `docs/superpowers/specs/2026-06-23-daily-product-columns-design.md`.

---

### Task 1: Product registry + metadata denylist + detection helper

**Files:**
- Modify: `src/app.jsx` — add three module-level definitions near the other Section-1 constants (anchor: just before `const VALID_REGIONS =` / `function normalizeAgents`). Re-grep: `grep -n "function normalizeAgents" src/app.jsx`.

**Interfaces:**
- Produces: `DAILY_PRODUCT_REGISTRY` (array of `{col,label,category}`), `DAILY_PRODUCT_DENYLIST` (Set<string>), `getDailyProductCols(rows)` → ordered `Array<{col,label,category}>` (registry entries present in data first, then unknown non-denylist columns as `{col, label:col, category:"Other"}`).

- [ ] **Step 1: Add the registry + denylist + helper.** Insert above `function normalizeAgents`:

```jsx
// ── Daily Breakdown product columns (data-driven from the CSV) ────────────────
// Known CSV product columns → picker label + category. NewData (HSD) and XMLines
// (XM) are intentionally absent: they're already shown as the HSD / XM columns.
const DAILY_PRODUCT_REGISTRY = [
  { col: "NewVideo",        label: "New Video",            category: "RGU / New Sales" },
  { col: "NewVoice",        label: "New Phone",            category: "RGU / New Sales" },
  { col: "NewSecurity",     label: "New XH",               category: "RGU / New Sales" },
  { col: "WifiPassSales",   label: "Wifi Pass",            category: "RGU / New Sales" },
  { col: "xFiSales",        label: "xFi Complete",         category: "RGU / New Sales" },
  { col: "StormReadySales", label: "Storm Ready",          category: "RGU / New Sales" },
  { col: "UpgradeVideo",    label: "Tier Upgrade – Video", category: "Tier Upgrades" },
  { col: "UpgradeData",     label: "Tier Upgrade – HSD",   category: "Tier Upgrades" },
  { col: "UpgradeVoice",    label: "Tier Upgrade – Phone", category: "Tier Upgrades" },
  { col: "UpgradeSecurity", label: "Tier Upgrade – XH",    category: "Tier Upgrades" },
  { col: "XMUpgrade",       label: "Tier Upgrade – Mobile",category: "Tier Upgrades" },
  { col: "DeviceUpgrade",   label: "Device Upgrade",       category: "Tier Upgrades" },
  { col: "XMSales",         label: "XM Sales",             category: "Mobile (XM)" },
  { col: "NewXM",           label: "New XM",               category: "Mobile (XM)" },
  { col: "SavedXM",         label: "Saved XM",             category: "Mobile (XM)" },
  { col: "AddedXM",         label: "Added XM",             category: "Mobile (XM)" },
  { col: "XMPP",            label: "XM Protection Plan",   category: "Mobile (XM)" },
];
// Columns that are NOT pickable products: all metadata + the two already-shown
// product columns (NewData→HSD, XMLines→XM). Anything else is treated as a product.
const DAILY_PRODUCT_DENYLIST = new Set([
  "Job","Date","Location","AgentTSR","AgentName","SupTSR","SupName","Dials","Goals",
  "Contacts","Finals","NonFinals","Hours","AHTSec","CloseRate","GPH","CPH","DPH","CPS",
  "Region","Week Number","SPH Goal","Goals number","Job Type","NewData","XMLines",
]);
const DAILY_REGISTRY_BY_COL = Object.fromEntries(DAILY_PRODUCT_REGISTRY.map(e => [e.col, e]));
// Ordered list of product columns actually present in the loaded rows.
function getDailyProductCols(rows) {
  if (!rows || !rows.length) return [];
  const present = new Set();
  for (const r of rows) { if (r && r.products) for (const k in r.products) present.add(k); }
  const known = DAILY_PRODUCT_REGISTRY.filter(e => present.has(e.col));
  const knownCols = new Set(DAILY_PRODUCT_REGISTRY.map(e => e.col));
  const unknown = [...present].filter(c => !knownCols.has(c))
    .sort().map(c => ({ col: c, label: c, category: "Other" }));
  return [...known, ...unknown];
}
```

- [ ] **Step 2: Build to verify syntax.** Run: `cd "C:/Users/Joshu/Documents/Claude/Performance Intel" && npx vite build 2>&1 | tail -3`. Expected: `✓ built in …` (no `Unexpected token`).

- [ ] **Step 3: Commit.**

```bash
cp "C:/Users/Joshu/Documents/Claude/Performance Intel/src/app.jsx" "C:/Users/Joshu/Desktop/Performance-Intel/performance-intel-deploy/deploy-package/src/app.jsx"
cd "C:/Users/Joshu/Desktop/Performance-Intel/performance-intel-deploy/deploy-package/"
git add src/app.jsx && git commit -m "feat(daily): add product-column registry + detection helper"
```

---

### Task 2: Attach a `products` map to each normalized agent row

**Files:**
- Modify: `src/app.jsx` inside `function normalizeAgents` (re-grep `grep -n "function normalizeAgents" src/app.jsx`; the per-row object is built ~lines 641–756). Add `products` to the returned row object.

**Interfaces:**
- Consumes: `DAILY_PRODUCT_DENYLIST` (Task 1).
- Produces: every normalized row gains `products: { [csvCol]: number }` covering all non-denylist columns (registry + unknown). `newXI`, `xmLines`, etc. unchanged.

- [ ] **Step 1: Locate the raw row + the returned object.** In `normalizeAgents`, each source row (call it `r` / `row` — confirm the variable name by reading the function) is mapped to a normalized object. Identify the variable holding the raw CSV row (has keys like `r["NewVideo"]`).

- [ ] **Step 2: Build the products map and add it to the returned object.** Just before the row object is returned/assembled, add:

```jsx
const products = {};
for (const k in row) {                       // `row` = the raw CSV row object
  if (!DAILY_PRODUCT_DENYLIST.has(k)) {
    const n = Number(row[k]);
    if (Number.isFinite(n)) products[k] = n; // keep only numeric product cells
  }
}
```

Then include `products` as a field on the normalized row object (e.g. add `products,` to the returned object literal). Match the actual raw-row variable name found in Step 1.

- [ ] **Step 3: Build to verify.** Run: `npx vite build 2>&1 | tail -3`. Expected: `✓ built in …`.

- [ ] **Step 4: Manual sanity check.** Run `npx vite --host`, open the app, load data, and in the browser console inspect a row (or temporarily `console.log` the first normalized agent) — confirm `.products` exists with keys like `NewVideo`, `UpgradeData`, `XMSales` and numeric values, and that `NewData`/`XMLines` are absent (denylisted). Remove any temp log.

- [ ] **Step 5: Commit.**

```bash
cp ".../Documents/Claude/Performance Intel/src/app.jsx" ".../deploy-package/src/app.jsx"
cd ".../deploy-package/" && git add src/app.jsx && git commit -m "feat(daily): attach products map to normalized rows"
```

---

### Task 3: Aggregate product sums in `buildDayStats` + rollups

**Files:**
- Modify: `src/app.jsx` `buildDayStats` inside `DailyBreakdownPanel`'s `dailyData` useMemo (re-grep `grep -n "buildDayStats" src/app.jsx`; ~16577). Also the weekly-subtotal and TOTAL rollup reducers (re-grep `grep -n "wHsd\|totalHsd" src/app.jsx`).

**Interfaces:**
- Consumes: row `.products` (Task 2).
- Produces: each day-row object gains `products: { [col]: number }` (summed); weekly-subtotal objects gain `products`; the TOTAL gains `products`.

- [ ] **Step 1: Sum products per date in `buildDayStats`.** In the per-date accumulator init (`byDate[r.date] = { hours:0, ... }`) add `products: {}`. In the per-row accumulation add:

```jsx
if (r.products) for (const k in r.products) {
  byDate[r.date].products[k] = (byDate[r.date].products[k] || 0) + r.products[k];
}
```

In the returned per-date object (both the present-day branch and the `absent` branch) add `products: d ? d.products : {}`.

- [ ] **Step 2: Roll products into weekly subtotals + TOTAL.** Wherever `wHsd`/`wXm` (week) and `totalHsd`/`totalXm` (TOTAL) are reduced, add a parallel product reducer:

```jsx
const sumProducts = (days) => days.reduce((acc, d) => {
  if (d && d.products) for (const k in d.products) acc[k] = (acc[k] || 0) + d.products[k];
  return acc;
}, {});
```

Use `sumProducts(weekDays)` for the week-subtotal row's `products` and `sumProducts(worked)` for the TOTAL row's `products`. (Place `sumProducts` near the existing rollup code; reuse it for both.)

- [ ] **Step 3: Build to verify.** `npx vite build 2>&1 | tail -3` → `✓ built in …`.

- [ ] **Step 4: Cross-check one product total with awk.** Pick a product (e.g. `NewVideo`, CSV col 22) and a CSV with data (June): 

```bash
curl -s -L "<June agent CSV url>" | awk -F',' 'NR>1 && $22!="" {s+=$22} END{print "NewVideo total:", s}'
```

After Task 6 renders columns you'll confirm the TOTAL cell equals this. For now, just confirm the build passes (data is wired, not yet shown).

- [ ] **Step 5: Commit.** (same copy-to-deploy + commit pattern) message: `feat(daily): sum products per day, week, and total`.

---

### Task 4: Picker state + persistence in `DailyBreakdownPanel`

**Files:**
- Modify: `src/app.jsx` near the top of `function DailyBreakdownPanel` (re-grep `grep -n "function DailyBreakdownPanel" src/app.jsx`; ~16491), with the component's other hooks.

**Interfaces:**
- Produces: `selectedProducts` (Set<string>), `setSelectedProducts(setOrUpdater)`, `toggleProduct(col)`. Persisted to `perf_intel_daily_product_cols_v1`.

- [ ] **Step 1: Add state following the project localStorage pattern.**

```jsx
const [selectedProducts, _setSelectedProducts] = useState(() => {
  try { return new Set(JSON.parse(localStorage.getItem("perf_intel_daily_product_cols_v1")) || []); }
  catch(e) { return new Set(); }
});
const setSelectedProducts = useCallback(next => {
  _setSelectedProducts(next);
  try { localStorage.setItem("perf_intel_daily_product_cols_v1", JSON.stringify([...next])); } catch(e) {}
}, []);
const toggleProduct = useCallback(col => {
  _setSelectedProducts(prev => {
    const n = new Set(prev); if (n.has(col)) n.delete(col); else n.add(col);
    try { localStorage.setItem("perf_intel_daily_product_cols_v1", JSON.stringify([...n])); } catch(e) {}
    return n;
  });
}, []);
```

Confirm `useState`, `useCallback` are already imported at the top of the file (they are).

- [ ] **Step 2: Compute available + active product columns** (place after `dailyData` is available, so `getDailyProductCols` sees the rows used by the table):

```jsx
const availableProducts = useMemo(() => getDailyProductCols(regionAgents), [regionAgents]);
const activeProducts = useMemo(
  () => availableProducts.filter(p => selectedProducts.has(p.col)),
  [availableProducts, selectedProducts]
);
```

Use whatever variable in `DailyBreakdownPanel` holds the filtered rows that feed `buildDayStats` (read the function to confirm the name — shown as `regionAgents` here as a placeholder for that real variable).

- [ ] **Step 3: Build to verify.** `npx vite build 2>&1 | tail -3` → success. (No UI yet; state compiles.)

- [ ] **Step 4: Commit.** message: `feat(daily): product-column selection state + persistence`.

---

### Task 5: Picker UI (chip bar + categorized dropdown, mirroring TodayView)

**Files:**
- Modify: `src/app.jsx` — render a picker bar just above the daily table's `<table>` in `DailyBreakdownPanel` (re-grep the table header array `grep -n '"Date","Day","Agents"' src/app.jsx`). Mirror TodayView's picker markup at lines ~19327–19451 (re-grep `grep -n "Product Code Columns" src/app.jsx`).

**Interfaces:**
- Consumes: `availableProducts`, `selectedProducts`, `toggleProduct`, `setSelectedProducts` (Task 4).

- [ ] **Step 1: Read the TodayView picker to mirror its styling.** Read `src/app.jsx` lines around the TodayView picker (the "Product Code Columns" bar, selected chips, and the categorized dropdown with per-category toggle buttons). Note the exact inline styles for: the label bar, the removable chips, the "Show All / Close" toggle, and the category group layout.

- [ ] **Step 2: Render an adapted picker above the daily table.** Add a local `productDropOpen` state (`const [productDropOpen,setProductDropOpen]=useState(false)`). Render, only when `availableProducts.length > 0`:
  - a label bar `PRODUCT CODE COLUMNS` with a `Show All` (selects every `availableProducts[].col`) and `Close (N)` toggle for the dropdown,
  - removable chips for each `selectedProducts` entry (clicking ✕ calls `toggleProduct(col)`),
  - a dropdown (when `productDropOpen`) grouping `availableProducts` by `category` (preserve category order: RGU / New Sales, Tier Upgrades, Mobile (XM), Other), each product a toggle button highlighted when `selectedProducts.has(col)`, calling `toggleProduct(col)`.

  Match the TodayView inline-style values from Step 1 (colors per category, chip styling, button borders) so it visually matches. Use the existing accent/purple palette — do NOT introduce new chrome.

- [ ] **Step 3: Build to verify.** `npx vite build 2>&1 | tail -3` → success.

- [ ] **Step 4: Manual check.** `npx vite --host`, open Overview → Daily. Confirm: the picker bar shows, the dropdown lists products grouped by category, toggling adds/removes chips, selection survives a page reload (localStorage). Columns won't render yet (Task 6).

- [ ] **Step 5: Commit.** message: `feat(daily): product-column picker UI (mirrors TodayView)`.

---

### Task 6: Render selected products as appended columns

**Files:**
- Modify: `src/app.jsx` `DailyBreakdownPanel` table — header array, per-day `<td>`s, weekly-subtotal `<td>`s, TOTAL `<tfoot>` `<td>`s, and the "absent day" `colSpan`. Re-grep anchors: `grep -n '"Date","Day","Agents"' src/app.jsx` (header), `grep -n "colSpan" src/app.jsx` (absent row), `grep -n "Wk " src/app.jsx` (week subtotal).

**Interfaces:**
- Consumes: `activeProducts` (Task 4), each row's `products` (Task 3).

- [ ] **Step 1: Header — insert product `<th>`s before "% to Goal".** The header is a hardcoded array `["Date","Day","Agents","Hours","Goals","GPH","HSD","XM","% to Goal"]`. Replace the `% to Goal` tail so product headers come first:

```jsx
{["Date","Day","Agents","Hours","Goals","GPH","HSD","XM"].map(h => (
  <th key={h} style={/* keep existing th style */}>{h}</th>
))}
{activeProducts.map(p => (
  <th key={p.col} style={/* same th style */} title={p.label}>{p.label}</th>
))}
<th style={/* same th style */}>% to Goal</th>
```

(Copy the exact `<th>` style object already used.)

- [ ] **Step 2: Per-day rows — insert product `<td>`s before the "% to Goal" cell.** For each day row `d`, before its `% to Goal` `<td>` add:

```jsx
{activeProducts.map(p => (
  <td key={p.col} style={/* same numeric td style used by HSD/XM */}>
    {d.products && d.products[p.col] ? d.products[p.col] : "—"}
  </td>
))}
```

Match the exact zero/value rendering the existing **HSD/XM** `<td>`s use (read them and copy the style + zero handling).

- [ ] **Step 3: Weekly-subtotal rows — same insertion** using the week object's `products` (built in Task 3), before its `% to Goal` cell, same cell markup as Step 2.

- [ ] **Step 4: TOTAL `<tfoot>` row — same insertion** using the TOTAL `products`, before its `% to Goal` cell.

- [ ] **Step 5: Fix the "absent day" placeholder `colSpan`.** Find the absent-row `<td colSpan={N}>`. It currently spans the fixed metric columns; make it dynamic: `colSpan={7 + activeProducts.length}` (keep the same base it used before — re-read to confirm the base number, currently 7, and add `activeProducts.length`).

- [ ] **Step 6: Build to verify.** `npx vite build 2>&1 | tail -3` → success.

- [ ] **Step 7: Manual + awk verification.**
  - Open Overview → Daily, select `New Video`. Confirm a `New Video` column appears between `XM` and `% to Goal` across day rows, the weekly subtotal, and TOTAL.
  - Cross-check the TOTAL `New Video` cell against the awk tally from Task 3 Step 4 — they must match.
  - Deselect all → confirm the table is identical to before the feature (no extra columns).
  - Switch to a historical month (June) via the month selector → confirm columns recompute.
  - Spot-check Site Drilldown daily and a program Slide daily — the picker appears there too.

- [ ] **Step 8: Commit.** message: `feat(daily): render selected product columns in day/week/total rows`.

---

### Task 7: Full verification + deploy

**Files:** none (verification + ship).

- [ ] **Step 1: Final build.** `npx vite build 2>&1 | tail -3` → `✓ built in …`.

- [ ] **Step 2: Reconcile-before-deploy (drift guard).** In the deploy repo: `git fetch && git log --oneline --left-right HEAD...origin/main`. If `origin/main` is ahead, stop and reconcile per `project_repo_topology_drift` memory before continuing.

- [ ] **Step 3: Manual end-to-end.** Select a few products across categories; verify day/week/TOTAL math, default-off parity, persistence across reload, and presence on all 3 daily tables.

- [ ] **Step 4: Commit any final changes + push `main`, then deploy.**

```bash
cd "C:/Users/Joshu/Desktop/Performance-Intel/performance-intel-deploy/deploy-package/"
git push
npm run build
npx gh-pages -d dist -m "Deploy: daily product-code columns"
```

Expected: `Published`. Confirm live at https://joshuaedgecomb-dev.github.io/performance-intel/ (~30–60s).

---

## Self-Review

**Spec coverage:** registry/denylist + data-driven detection (T1), `products` on rows (T2), per-day/week/TOTAL aggregation (T3), state+persistence with `perf_intel_daily_product_cols_v1` and default-empty (T4), TodayView-mirrored picker (T5), appended columns before "% to Goal" across all row types + absent colSpan + dedup via denylist (T6), all-3-tables scope (inherent — one component), verification + deploy (T7). TodayView untouched. All spec sections map to a task.

**Placeholders:** Variable names `row`/`regionAgents` are explicitly flagged to confirm against the real function during implementation (not silent placeholders). Inline `<th>/<td>` style objects are "copy the existing one" because they must match current styling exactly — the implementer reads the adjacent cells.

**Type consistency:** `products` is `{ [col]: number }` everywhere (T2 produces, T3 sums, T6 reads). `getDailyProductCols` returns `{col,label,category}[]` consumed by T4/T5/T6. `selectedProducts` is a `Set<string>` of `col` values throughout.
