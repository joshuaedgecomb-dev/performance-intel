# Top Navigation Redesign — Design Spec

## Summary

Replace the current slide-based navigation (Overview → program slides → MoM → tNPS, with a horizontal program nav bar) with a permanent top bar containing site-first dropdown menus. DR and BZ become first-class navigation entry points so a site supervisor can deploy the URL to their team and see their site's programs front-and-center.

The new bar has six top-level items: `PERF INTEL · Overview · DR ▼ · BZ ▼ · MoM · tNPS`, with right-side controls for pacing status, theme, settings/actions menu, and TODAY.

## Decisions

| Question | Answer |
|----------|--------|
| Top-level structure | Site-first (Overview / DR / BZ / MoM / tNPS) |
| Dropdown menu trigger | Click the menu label opens dropdown; does **not** navigate |
| Click behavior on a sub-item | Full page replacement |
| Dropdown content organization | Categorized — Site Overview link + programs grouped by MBR category |
| Dropdown header format | `DR · 91% to goal | Proj 100%` (current attainment + projected) |
| Sort within category | By attainment, highest first |
| Active state | Top-level item highlighted (orange) + persistent breadcrumb bar below nav |
| Breadcrumb format | `DR · Dom. Republic › Acquisition › Nonsub` with attainment % suffix |
| Right-side controls | Pacing pill, ☀ theme, ⚙ settings menu, ⚡ TODAY (green CTA) |
| ⚙ menu contents | Export MBR, Refresh, file uploads, settings, Local AI toggle |
| Persistence | localStorage `perf-intel-current-page` remembers last view |
| URL routing | None (single-file artifact, base: './' Vite config) |
| Mobile/narrow | Collapse to hamburger drawer below 900px (low priority) |
| "By Site" tabs | Remove from BusinessOverview and Slide; revisit need for dedicated DR/BZ filter buttons post-deploy |

## Architecture

### Top Nav Structure

```
┌────────────────────────────────────────────────────────────────────────────────┐
│ PERF INTEL  Overview  DR ▼  BZ ▼  MoM  tNPS    [Day 14/22] ☀ ⚙  ⚡ TODAY      │
└────────────────────────────────────────────────────────────────────────────────┘
```

- `Overview`, `MoM`, `tNPS` — direct links, no dropdown
- `DR ▼`, `BZ ▼` — dropdown menus only (clicking the label does not navigate)
- Pacing pill, theme, settings, TODAY — right-side controls

### Site Dropdown Content (DR & BZ identical structure)

```
┌─ DR · 91% to goal | Proj 100% ─┐
│  📊 Site Overview               │
│  ─────────────────────────────  │
│  ACQUISITION                    │
│  Nonsub                    94%  │
│  BAU                       72%  │
│  MULTI-PRODUCT EXPANSION        │
│  XM Likely                 87%  │
│  Add a Line                76%  │
│  UP TIER & ANCILLARY            │
│  Add XMC                   81%  │
└─────────────────────────────────┘
```

- Header: `<site> · <attainment>% to goal | Proj <projected>%` (live values)
- Site Overview link → existing `SiteDrilldown` component scoped to that site
- Programs grouped by `getMbrCategory()` (existing function in app.jsx ~line 87)
- Categories shown only if they contain ≥1 program with agents in that site
- Programs sorted by attainment within each category (highest first)
- Programs with zero agents in the current site are hidden from that site's dropdown

### Active State

When on any page deeper than a top-level link:

1. **Top-level highlight** — relevant menu item gets orange `#ed8936` background tint, bold weight, 2px underline below
2. **Breadcrumb bar** — secondary bar between nav and content:
   - Site → Program: `DR · Dom. Republic › Acquisition › Nonsub` with `94% to goal` right-aligned
   - Site Overview: `DR · Dom. Republic › Site Overview`
   - Current item shown in orange
3. **No breadcrumb** on Overview / MoM / tNPS pages — the page header conveys context

### Right-Side Controls

| Control | Behavior |
|---------|----------|
| `[●Day 14 of 22]` pacing pill | Live status from existing `fiscalInfo`, not clickable, ambient context |
| `☀` theme icon | Toggles light/dark mode (existing `setLightMode`) |
| `⚙` settings icon | Opens menu (see below) |
| `⚡ TODAY` green pill | Toggles full-screen `TodayView` (existing `setShowToday`) |

### ⚙ Menu Contents

```
┌─ Settings & Actions ─────────┐
│  ACTIONS                      │
│  📊 Export MBR        monthly │
│  🔄 Refresh from sheet        │
│  ─────────────────────────    │
│  DATA                         │
│  📁 Upload Goals CSV          │
│  📁 Upload Roster CSV         │
│  📁 Upload Prior Goals        │
│  ─────────────────────────    │
│  SETTINGS                     │
│  ⚙ Data sources (Sheet URLs) │
│  ⚙ Hours threshold           │
│  🤖 Local AI              on  │
└───────────────────────────────┘
```

- Each row triggers existing handlers (no behavioral changes)
- Local AI row only appears when `ollamaAvailable === true`

### Page Mapping

| Click → | Page that loads |
|---------|----------------|
| Overview | `BusinessOverview` (Overview/Daily/Trends tabs intact) |
| DR → Site Overview | `SiteDrilldown` filtered to DR regions |
| DR → Nonsub (any program) | `Slide` for that program with `siteFilter="DR"` prop |
| BZ → Site Overview | `SiteDrilldown` filtered to BZ regions |
| BZ → Nonsub (any program) | `Slide` for that program with `siteFilter="BZ"` prop |
| MoM | `CampaignComparisonPanel` |
| tNPS | `TNPSSlide` |
| TODAY | `TodayView` (full-screen replaces nav) |

### Slide Component Changes

The `Slide` component receives a new optional `siteFilter` prop:

- `null` (default) — current behavior, cross-site data
- `"DR"` — agents/regions/calculations pre-filtered to DR regions only
- `"BZ"` — same for BZ

When `siteFilter` is set, the Slide:
- Filters its `agents` prop to agents whose region matches the site (XOTM = BZ, else DR)
- Recalculates `regions`, `q1Agents`, `totalHours`, etc. from filtered set
- Hides the existing "By Site" tab (moot when already filtered)
- Shows `siteFilter` value in page header eyebrow (e.g., `DR · Acquisition`)

### Behavior

- **Click outside** an open dropdown closes it
- **Esc** closes any open dropdown
- **One menu open at a time** — opening one closes any other (DR / BZ / ⚙)
- **Persistence** — current page saved to `localStorage["perf-intel-current-page"]` as `{ section: "overview"|"dr"|"bz"|"mom"|"tnps", program?: string }`. Loaded on mount; falls back to Overview if invalid
- **No URL routing** — single-file artifact deployed to GitHub Pages with `base: './'` Vite config; URL routing would conflict

## State Management

New App-level state:

```jsx
// Current page state (replaces slideIndex)
const [currentPage, _setCurrentPage] = useState(() => {
  try { return JSON.parse(localStorage.getItem("perf-intel-current-page")) || { section: "overview" }; }
  catch(e) { return { section: "overview" }; }
});
const setCurrentPage = useCallback(page => {
  _setCurrentPage(page);
  try { localStorage.setItem("perf-intel-current-page", JSON.stringify(page)); } catch(e) {}
}, []);

// Open dropdown state (which menu is open, if any)
const [openMenu, setOpenMenu] = useState(null); // null | "dr" | "bz" | "settings"
```

`slideIndex` and the existing `navTo`/`goToSlide` helpers are removed.

## Components

### New components

- **`TopNav`** — the new permanent top bar. Owns all navigation rendering. Receives `currentPage`, `setCurrentPage`, `openMenu`, `setOpenMenu`, `perf` (for attainment data), and right-side handlers.
- **`SiteDropdown`** — shared dropdown for DR and BZ. Props: `site` ("DR"|"BZ"), `regions`, `programs`, `currentProgram`, `attainment`, `projAttainment`, `onSelect`. Renders header + Site Overview + categorized program list.
- **`SettingsMenu`** — the ⚙ overflow menu. Props: handlers for export, refresh, file uploads, settings modal, theme.
- **`Breadcrumb`** — the secondary bar. Props: `section`, `program`, `attainment`. Returns null on Overview/MoM/tNPS.

### Modified components

- **`App`** — replace `slideIndex` with `currentPage`. Replace the existing top bar + program nav bar with `<TopNav>` + `<Breadcrumb>`. Render the appropriate page based on `currentPage`.
- **`Slide`** — accept new `siteFilter` prop. When set, filter `agents` and recompute derived values. Hide existing "By Site" tab.
- **`BusinessOverview`** — remove "By Site" tab entry, render block, and `siteGroups`/`selectedGroup`/`activeGroup` state.

### Removed components

- **`ProgramBySiteTab`** (~314 lines, currently at lines 9633-9943) — dead after Slide's "By Site" tab is removed. Delete entirely.

## Files Changed

All changes in `src/app.jsx` (the single-file React app):

- New `TopNav` component (~120 lines)
- New `SiteDropdown` component (~80 lines)
- New `SettingsMenu` component (~60 lines)
- New `Breadcrumb` component (~30 lines)
- New `currentPage` state + persistence (~12 lines)
- App render reorganization to use new nav
- Slide: add `siteFilter` prop + filtering logic (~30 lines)
- BusinessOverview: remove "By Site" tab (~50 lines deleted)
- Slide: remove "By Site" tab (~30 lines deleted)
- ProgramBySiteTab: delete entirely (~314 lines deleted)
- Existing Section 12d header comment becomes a tombstone

Net: ~+330 lines added, ~−400 lines deleted. Net file shrinks by ~70 lines.

## Edge Cases

| Scenario | Behavior |
|----------|----------|
| Data not yet loaded | TopNav shows logo + theme + ⚙ + TODAY only; DR/BZ menus and pacing pill hidden |
| Site has zero agents | That site's dropdown is hidden entirely |
| Program has zero agents in a site | Program omitted from that site's dropdown |
| TODAY view active | TopNav hidden (TodayView has its own header — existing behavior) |
| Narrow screen < 900px | TopNav collapses to hamburger drawer (vertical menu); pacing pill hides |
| Local AI unavailable | Local AI row hidden from ⚙ menu |
| Persisted page references missing program | Fall back to Overview (e.g., goals CSV changed and program no longer exists) |
| User on DR → Nonsub, then DR data is removed | Fall back to Overview; localStorage cleared |

## Future Considerations

- **Dedicated DR|BZ filter buttons inside pages** — after deploying the new nav and seeing how it functions, evaluate whether quick site-filter pills should appear on cross-site views (e.g., BusinessOverview's Daily/Trends tabs). The new top nav may obviate the need entirely, or supervisors may still want quick site-toggles in specific contexts.
- **Site Overview Daily/Trends sub-views** — currently the site dropdown only links to a single "Site Overview" page. If supervisors want site-level Daily or Trends views, those could be promoted to dropdown items in a future iteration.
- **URL deep-linking** — would require switching from `base: './'` to a router and losing the GitHub Pages single-file simplicity. Not in scope.

## Visual Reference

See `.superpowers/brainstorm/760-1775965709/content/final-mockup.html` for the consolidated mockup of all three states (Overview, DR menu open, on Nonsub-DR with breadcrumb).
