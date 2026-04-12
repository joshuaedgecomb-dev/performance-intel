# Top Navigation Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace slide-based navigation with a permanent site-first top bar (Overview / DR ▼ / BZ ▼ / MoM / tNPS) where DR and BZ dropdowns list site-scoped programs grouped by MBR category.

**Architecture:** Add four new components (`TopNav`, `SiteDropdown`, `SettingsMenu`, `Breadcrumb`) inside the existing single-file React app. Replace `slideIndex`/`navTo`/`goToSlide` with `currentPage` state shape `{ section, program? }` persisted to localStorage. Pre-compute site-scoped program data (attainment, projection) in App via memoization and pass to dropdowns.

**Tech Stack:** React 18 (single-file), inline CSS with CSS custom properties, localStorage for persistence.

**Spec:** `docs/superpowers/specs/2026-04-12-top-nav-redesign-design.md`

**Note:** Browser test after every UI task. Open http://localhost:5173/ (run `npm run dev` if not already running). The failure mode this codebase is most prone to is dropping a prop, breaking a child component, or getting JSX brace balance wrong — visual inspection catches these immediately.

---

### Task 1: Foundation — currentPage state + computed site data

**Files:**
- Modify: `src/app.jsx` — App component (line ~13553)

This task establishes all the state and memoized data the new nav needs. No UI changes yet — the existing nav still works after this commit.

- [ ] **Step 1: Add the CURRENT_PAGE_KEY constant**

Add near `TOGGLE_KEY` and other localStorage constants (above `const THEMES`, around line 13502):

```jsx
const CURRENT_PAGE_KEY = "perf-intel-current-page";
```

- [ ] **Step 2: Add currentPage and openMenu state inside App()**

Add right after `const [slideIndex, setSlideIndex] = useState(0);` (line ~13556):

```jsx
const [currentPage, _setCurrentPage] = useState(() => {
  try { return JSON.parse(localStorage.getItem(CURRENT_PAGE_KEY)) || { section: "overview" }; }
  catch(e) { return { section: "overview" }; }
});
const setCurrentPage = useCallback(page => {
  _setCurrentPage(page);
  try { localStorage.setItem(CURRENT_PAGE_KEY, JSON.stringify(page)); } catch(e) {}
}, []);
const [openMenu, setOpenMenu] = useState(null); // null | "dr" | "bz" | "settings"
```

- [ ] **Step 3: Add siteRegionGroups memo**

Add after `const priorGoalLookup = useMemo(...)` (around line 13684):

```jsx
const siteRegionGroups = useMemo(() => {
  if (!perf.agents || perf.agents.length === 0) return { dr: [], bz: [] };
  const allRegions = [...new Set(perf.agents.map(a => a.region).filter(Boolean))];
  return {
    dr: allRegions.filter(r => !r.toUpperCase().includes("XOTM")),
    bz: allRegions.filter(r => r.toUpperCase().includes("XOTM")),
  };
}, [perf.agents]);
```

- [ ] **Step 4: Add programsBySite memo**

Add right after `siteRegionGroups`:

```jsx
const programsBySite = useMemo(() => {
  const result = { DR: [], BZ: [] };
  if (!perf.programs || !perf.fiscalInfo) return result;
  const { elapsedBDays, totalBDays } = perf.fiscalInfo;
  [["DR", siteRegionGroups.dr], ["BZ", siteRegionGroups.bz]].forEach(([siteKey, regs]) => {
    if (regs.length === 0) return;
    perf.programs.forEach(prog => {
      const siteAgents = prog.agents.filter(a => regs.includes(a.region));
      if (siteAgents.length === 0) return;
      const sub = buildProgram(siteAgents, prog.jobType, prog.goalEntries, newHireSet);
      const pacing = sub.attainment != null && sub.planGoals
        ? calcPacing(sub.actGoals, sub.planGoals, elapsedBDays, totalBDays) : null;
      result[siteKey].push({
        jobType: prog.jobType,
        attainment: sub.attainment,
        projAttainment: pacing ? pacing.projectedPct : null,
        category: getMbrCategory(prog.jobType),
      });
    });
    result[siteKey].sort((a, b) => (b.attainment ?? -1) - (a.attainment ?? -1));
  });
  return result;
}, [perf.programs, perf.fiscalInfo, siteRegionGroups, newHireSet]);
```

- [ ] **Step 5: Add siteAttainments memo (site-level totals)**

Add right after `programsBySite`. Property names match the spec: `attainment` and `projAttainment`.

```jsx
const siteAttainments = useMemo(() => {
  const result = { DR: { attainment: null, projAttainment: null }, BZ: { attainment: null, projAttainment: null } };
  if (!perf.fiscalInfo) return result;
  const { elapsedBDays, totalBDays } = perf.fiscalInfo;
  [["DR", "dr"], ["BZ", "bz"]].forEach(([siteKey, lc]) => {
    const list = programsBySite[siteKey];
    if (!list || list.length === 0) return;
    let actGoals = 0, planGoals = 0;
    perf.programs.forEach(prog => {
      const siteAgents = prog.agents.filter(a => siteRegionGroups[lc].includes(a.region));
      if (siteAgents.length === 0) return;
      actGoals += siteAgents.reduce((s, a) => s + a.goals, 0);
      const sub = buildProgram(siteAgents, prog.jobType, prog.goalEntries, newHireSet);
      planGoals += sub.planGoals || 0;
    });
    if (planGoals > 0) {
      const attainment = (actGoals / planGoals) * 100;
      const pacing = calcPacing(actGoals, planGoals, elapsedBDays, totalBDays);
      result[siteKey] = { attainment, projAttainment: pacing ? pacing.projectedPct : null };
    }
  });
  return result;
}, [programsBySite, perf.programs, perf.fiscalInfo, siteRegionGroups, newHireSet]);
```

- [ ] **Step 6: Add filteredProgram memo (the program scoped to the current site)**

Add right after `siteAttainments`:

```jsx
const filteredProgram = useMemo(() => {
  if (!currentPage.program) return null;
  if (currentPage.section !== "dr" && currentPage.section !== "bz") return null;
  const baseProgram = perf.programMap[currentPage.program];
  if (!baseProgram) return null;
  const regs = currentPage.section === "dr" ? siteRegionGroups.dr : siteRegionGroups.bz;
  const siteAgents = baseProgram.agents.filter(a => regs.includes(a.region));
  if (siteAgents.length === 0) return null;
  return buildProgram(siteAgents, baseProgram.jobType, baseProgram.goalEntries, newHireSet);
}, [currentPage, perf.programMap, siteRegionGroups, newHireSet]);
```

- [ ] **Step 7: Verify the app still compiles and runs**

Run: `cd "C:/Users/Joshu/Documents/Claude/Performance Intel" && npx vite build 2>&1 | tail -5`
Expected: clean build, no errors.

The existing slide-based UI should still render exactly as before (this task adds state but doesn't rewire UI yet).

- [ ] **Step 8: Commit**

```bash
cd "C:/Users/Joshu/Documents/Claude/Performance Intel"
git add src/app.jsx
git commit -m "feat(nav): add foundation state for top nav redesign"
```

---

### Task 2: SiteDropdown component

**Files:**
- Modify: `src/app.jsx` — add new component after `SiteDrilldown` ends (line ~4770, before MBR section)

- [ ] **Step 1: Add the SiteDropdown component**

Insert after `SiteDrilldown`'s closing brace (find the `}` around line 4770, then add):

```jsx
// ── SiteDropdown — categorized program list for DR/BZ menus ─────────────────
function SiteDropdown({ site, programs, attainment, projAttainment, currentProgram, onSelect, accent }) {
  // Group programs by MBR category, preserve sort-by-attainment within each
  const categories = useMemo(() => {
    const map = {};
    programs.forEach(p => {
      const cat = p.category || "Other";
      if (!map[cat]) map[cat] = [];
      map[cat].push(p);
    });
    // Stable category order matching MBR convention
    const order = ["Acquisition", "Multi-Product Expansion", "Up Tier & Ancillary"];
    return order.filter(c => map[c]).map(c => [c, map[c]])
      .concat(Object.keys(map).filter(c => !order.includes(c)).map(c => [c, map[c]]));
  }, [programs]);

  const headerText = (() => {
    const a = attainment != null ? `${Math.round(attainment)}% to goal` : "no plan";
    const p = projAttainment != null ? ` | Proj ${Math.round(projAttainment)}%` : "";
    return `${site} · ${a}${p}`;
  })();

  const fmtPct = v => v != null ? `${Math.round(v)}%` : "—";

  return (
    <div role="menu" aria-label={`${site} navigation`}
      style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, minWidth: 280, background: "var(--bg-tertiary)", border: "1px solid var(--border)", borderRadius: "var(--radius-md, 10px)", boxShadow: "0 12px 32px rgba(0,0,0,0.35)", padding: "6px 0", zIndex: 250 }}>
      <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.7rem", color: accent, letterSpacing: "0.08em", textTransform: "uppercase", padding: "8px 14px 6px", fontWeight: 600 }}>
        {headerText}
      </div>
      <button onClick={() => onSelect(null)} role="menuitem"
        style={{ display: "flex", justifyContent: "space-between", width: "100%", padding: "7px 14px", border: "none", background: currentProgram === null ? `${accent}18` : "transparent", color: currentProgram === null ? accent : "var(--text-primary)", fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.85rem", cursor: "pointer", textAlign: "left", fontWeight: currentProgram === null ? 600 : 400 }}>
        <span>📊 Site Overview</span>
      </button>
      <div style={{ borderTop: "1px solid var(--border-muted)", margin: "4px 0" }} />
      {categories.map(([cat, items]) => (
        <Fragment key={cat}>
          <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.65rem", color: "var(--text-dim)", letterSpacing: "0.1em", textTransform: "uppercase", padding: "8px 14px 4px", fontWeight: 600 }}>
            {cat}
          </div>
          {items.map(p => {
            const isCurrent = p.jobType === currentProgram;
            return (
              <button key={p.jobType} onClick={() => onSelect(p.jobType)} role="menuitem"
                style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%", padding: "6px 14px", border: "none", background: isCurrent ? `${accent}18` : "transparent", color: isCurrent ? accent : "var(--text-primary)", fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.85rem", cursor: "pointer", textAlign: "left", fontWeight: isCurrent ? 600 : 400 }}>
                <span>{p.jobType}</span>
                <span style={{ fontFamily: "var(--font-data, monospace)", fontSize: "0.72rem", color: isCurrent ? accent : "var(--text-dim)" }}>{fmtPct(p.attainment)}</span>
              </button>
            );
          })}
        </Fragment>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Verify build**

Run: `cd "C:/Users/Joshu/Documents/Claude/Performance Intel" && npx vite build 2>&1 | tail -5`
Expected: clean build. Component isn't rendered yet, so no visual change.

- [ ] **Step 3: Commit**

```bash
cd "C:/Users/Joshu/Documents/Claude/Performance Intel"
git add src/app.jsx
git commit -m "feat(nav): add SiteDropdown component"
```

---

### Task 3: SettingsMenu component

**Files:**
- Modify: `src/app.jsx` — add new component after `SiteDropdown` (the one created in Task 2)

- [ ] **Step 1: Add the SettingsMenu component**

Insert directly after `SiteDropdown`'s closing brace:

```jsx
// ── SettingsMenu — overflow menu with actions, data, settings ───────────────
function SettingsMenu({ onExportMbr, onRefresh, onUploadGoals, onUploadRoster, onUploadPriorGoals, onOpenSettings, ollamaAvailable, localAI, onToggleLocalAI }) {
  const Section = ({ label }) => (
    <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.65rem", color: "var(--text-dim)", letterSpacing: "0.1em", textTransform: "uppercase", padding: "8px 14px 4px", fontWeight: 600 }}>
      {label}
    </div>
  );
  const Row = ({ icon, label, hint, onClick }) => (
    <button onClick={onClick} role="menuitem"
      style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%", padding: "7px 14px", border: "none", background: "transparent", color: "var(--text-primary)", fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.85rem", cursor: "pointer", textAlign: "left" }}>
      <span>{icon} {label}</span>
      {hint && <span style={{ fontFamily: "var(--font-data, monospace)", fontSize: "0.7rem", color: "var(--text-dim)" }}>{hint}</span>}
    </button>
  );
  return (
    <div role="menu" aria-label="Settings and actions"
      style={{ position: "absolute", top: "calc(100% + 4px)", right: 0, minWidth: 240, background: "var(--bg-tertiary)", border: "1px solid var(--border)", borderRadius: "var(--radius-md, 10px)", boxShadow: "0 12px 32px rgba(0,0,0,0.35)", padding: "6px 0", zIndex: 250 }}>
      <Section label="Actions" />
      <Row icon="📊" label="Export MBR" hint="monthly" onClick={onExportMbr} />
      <Row icon="🔄" label="Refresh from sheet" onClick={onRefresh} />
      <div style={{ borderTop: "1px solid var(--border-muted)", margin: "4px 0" }} />
      <Section label="Data" />
      <Row icon="📁" label="Upload Goals CSV" onClick={onUploadGoals} />
      <Row icon="📁" label="Upload Roster CSV" onClick={onUploadRoster} />
      <Row icon="📁" label="Upload Prior Goals" onClick={onUploadPriorGoals} />
      <div style={{ borderTop: "1px solid var(--border-muted)", margin: "4px 0" }} />
      <Section label="Settings" />
      <Row icon="⚙" label="Data sources" onClick={onOpenSettings} />
      {ollamaAvailable && (
        <Row icon="🤖" label="Local AI" hint={localAI ? "on" : "off"} onClick={onToggleLocalAI} />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify build**

Run: `cd "C:/Users/Joshu/Documents/Claude/Performance Intel" && npx vite build 2>&1 | tail -5`
Expected: clean build.

- [ ] **Step 3: Commit**

```bash
cd "C:/Users/Joshu/Documents/Claude/Performance Intel"
git add src/app.jsx
git commit -m "feat(nav): add SettingsMenu component"
```

---

### Task 4: Breadcrumb component

**Files:**
- Modify: `src/app.jsx` — add after `SettingsMenu` from Task 3

- [ ] **Step 1: Add the Breadcrumb component**

Insert directly after `SettingsMenu`'s closing brace:

```jsx
// ── Breadcrumb — secondary nav bar showing site › category › program ────────
function Breadcrumb({ section, program, attainment }) {
  // Only render for site-scoped pages
  if (section !== "dr" && section !== "bz") return null;
  const siteCode = section.toUpperCase();
  const siteName = section === "dr" ? "Dom. Republic" : "Belize";
  const accent = section === "dr" ? "#ed8936" : "#48bb78";
  const sep = (
    <span style={{ color: "var(--text-dim)", opacity: 0.5, fontSize: "0.78rem" }}>›</span>
  );
  const Crumb = ({ label, current }) => (
    <span style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.78rem", color: current ? accent : "var(--text-muted)", fontWeight: current ? 600 : 400 }}>
      {label}
    </span>
  );

  return (
    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", padding: "0.4rem 1.5rem", background: "var(--glass-bg-subtle)", borderBottom: "1px solid var(--glass-border)", backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)" }}>
      <Crumb label={`${siteCode} · ${siteName}`} current={false} />
      {!program && (<>{sep}<Crumb label="Site Overview" current /></>)}
      {program && (
        <>
          {sep}
          <Crumb label={getMbrCategory(program)} current={false} />
          {sep}
          <Crumb label={program} current />
          {attainment != null && (
            <span style={{ marginLeft: "auto", fontFamily: "var(--font-data, monospace)", fontSize: "0.72rem", color: "var(--text-dim)" }}>
              {Math.round(attainment)}% to goal
            </span>
          )}
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify build**

Run: `cd "C:/Users/Joshu/Documents/Claude/Performance Intel" && npx vite build 2>&1 | tail -5`
Expected: clean build.

- [ ] **Step 3: Commit**

```bash
cd "C:/Users/Joshu/Documents/Claude/Performance Intel"
git add src/app.jsx
git commit -m "feat(nav): add Breadcrumb component"
```

---

### Task 5: TopNav component

**Files:**
- Modify: `src/app.jsx` — add after `Breadcrumb` from Task 4

- [ ] **Step 1: Add the TopNav component**

Insert directly after `Breadcrumb`'s closing brace:

```jsx
// ── TopNav — permanent top navigation bar ───────────────────────────────────
function TopNav({
  rawData, currentPage, setCurrentPage, openMenu, setOpenMenu,
  programsBySite, siteAttainments, fiscalInfo, hasTnps,
  lightMode, setLightMode, showToday, setShowToday,
  ollamaAvailable, localAI, setLocalAI,
  onExportMbr, onRefresh, onUploadGoals, onUploadRoster, onUploadPriorGoals, onOpenSettings,
}) {
  const navRef = useRef(null);
  const drRef = useRef(null);
  const bzRef = useRef(null);
  const settingsRef = useRef(null);

  // Close menus on outside click
  useEffect(() => {
    if (!openMenu) return;
    const handler = e => {
      const ref = openMenu === "dr" ? drRef : openMenu === "bz" ? bzRef : settingsRef;
      if (ref.current && !ref.current.contains(e.target)) setOpenMenu(null);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [openMenu, setOpenMenu]);

  // Close menus on Escape
  useEffect(() => {
    if (!openMenu) return;
    const handler = e => { if (e.key === "Escape") setOpenMenu(null); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [openMenu, setOpenMenu]);

  const navigate = (section, program) => {
    setCurrentPage(program ? { section, program } : { section });
    setOpenMenu(null);
  };

  const isActive = section => currentPage.section === section;
  const linkBase = active => ({
    padding: "0.4rem 0.75rem", borderRadius: "var(--radius-sm, 6px)",
    border: active ? "1px solid #ed893650" : "1px solid transparent",
    background: active ? "#ed893618" : "transparent",
    color: active ? "#ed8936" : "var(--text-primary)",
    fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.85rem",
    cursor: "pointer", fontWeight: active ? 600 : 400, position: "relative",
    transition: "all 200ms cubic-bezier(0.4,0,0.2,1)",
  });

  // Don't render when in TODAY view (TodayView has its own header)
  if (showToday) return null;

  const drCount = programsBySite.DR ? programsBySite.DR.length : 0;
  const bzCount = programsBySite.BZ ? programsBySite.BZ.length : 0;

  return (
    <div ref={navRef} style={{ display: "flex", alignItems: "center", gap: "0.35rem", padding: "0.5rem 1.5rem", background: "var(--nav-bg)", backdropFilter: "blur(16px) saturate(180%)", WebkitBackdropFilter: "blur(16px) saturate(180%)", borderBottom: "1px solid var(--glass-border)", position: "fixed", top: 0, left: 0, right: 0, zIndex: 200 }}>
      <span style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.72rem", color: "var(--text-muted)", letterSpacing: "0.08em", fontWeight: 600, marginRight: "0.5rem" }}>PERF INTEL</span>

      {rawData && (
        <>
          <button onClick={() => navigate("overview")} style={linkBase(isActive("overview"))}>Overview</button>

          {drCount > 0 && (
            <div ref={drRef} style={{ position: "relative" }}>
              <button onClick={() => setOpenMenu(openMenu === "dr" ? null : "dr")}
                style={linkBase(isActive("dr"))}>
                DR <span style={{ fontSize: "0.6rem", opacity: 0.6, marginLeft: "0.15rem" }}>▼</span>
              </button>
              {openMenu === "dr" && (
                <SiteDropdown site="DR" programs={programsBySite.DR}
                  attainment={siteAttainments.DR.attainment} projAttainment={siteAttainments.DR.projAttainment}
                  currentProgram={isActive("dr") ? (currentPage.program || null) : undefined}
                  onSelect={prog => navigate("dr", prog)} accent="#ed8936" />
              )}
            </div>
          )}

          {bzCount > 0 && (
            <div ref={bzRef} style={{ position: "relative" }}>
              <button onClick={() => setOpenMenu(openMenu === "bz" ? null : "bz")}
                style={{ ...linkBase(isActive("bz")), color: isActive("bz") ? "#48bb78" : "var(--text-primary)", background: isActive("bz") ? "#48bb7818" : "transparent", borderColor: isActive("bz") ? "#48bb7850" : "transparent" }}>
                BZ <span style={{ fontSize: "0.6rem", opacity: 0.6, marginLeft: "0.15rem" }}>▼</span>
              </button>
              {openMenu === "bz" && (
                <SiteDropdown site="BZ" programs={programsBySite.BZ}
                  attainment={siteAttainments.BZ.attainment} projAttainment={siteAttainments.BZ.projAttainment}
                  currentProgram={isActive("bz") ? (currentPage.program || null) : undefined}
                  onSelect={prog => navigate("bz", prog)} accent="#48bb78" />
              )}
            </div>
          )}

          <button onClick={() => navigate("mom")} style={linkBase(isActive("mom"))}>MoM</button>
          {hasTnps && <button onClick={() => navigate("tnps")} style={linkBase(isActive("tnps"))}>tNPS</button>}
        </>
      )}

      <div style={{ flex: 1 }} />

      {rawData && fiscalInfo && (
        <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", padding: "0.3rem 0.65rem", borderRadius: "var(--radius-sm, 6px)", background: "rgba(22,163,74,0.12)", border: "1px solid rgba(22,163,74,0.3)" }}>
          <span style={{ width: 6, height: 6, borderRadius: 3, background: "#16a34a", boxShadow: "0 0 6px #16a34a80" }} />
          <span style={{ fontFamily: "var(--font-data, monospace)", fontSize: "0.72rem", color: "#16a34a", fontWeight: 500 }}>
            Day {fiscalInfo.elapsedBDays} of {fiscalInfo.totalBDays}
          </span>
        </div>
      )}

      <button onClick={() => setLightMode(v => !v)} title="Toggle theme"
        style={{ width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: "var(--radius-sm, 6px)", border: "1px solid var(--border-muted)", background: "transparent", color: "var(--text-muted)", cursor: "pointer", fontSize: "0.95rem" }}>
        {lightMode ? "\u2600" : "\u263E"}
      </button>

      {rawData && (
        <div ref={settingsRef} style={{ position: "relative" }}>
          <button onClick={() => setOpenMenu(openMenu === "settings" ? null : "settings")} title="Settings & Actions"
            style={{ width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: "var(--radius-sm, 6px)", border: "1px solid var(--border-muted)", background: openMenu === "settings" ? "var(--bg-tertiary)" : "transparent", color: "var(--text-muted)", cursor: "pointer", fontSize: "0.95rem" }}>
            ⚙
          </button>
          {openMenu === "settings" && (
            <SettingsMenu
              onExportMbr={() => { onExportMbr(); setOpenMenu(null); }}
              onRefresh={() => { onRefresh(); setOpenMenu(null); }}
              onUploadGoals={() => { onUploadGoals(); setOpenMenu(null); }}
              onUploadRoster={() => { onUploadRoster(); setOpenMenu(null); }}
              onUploadPriorGoals={() => { onUploadPriorGoals(); setOpenMenu(null); }}
              onOpenSettings={() => { onOpenSettings(); setOpenMenu(null); }}
              ollamaAvailable={ollamaAvailable}
              localAI={localAI}
              onToggleLocalAI={() => { setLocalAI(v => !v); setOpenMenu(null); }}
            />
          )}
        </div>
      )}

      <button onClick={() => setShowToday(v => !v)}
        style={{ padding: "0.4rem 0.85rem", borderRadius: "var(--radius-sm, 6px)", border: "1px solid #16a34a", background: "#16a34a", color: "white", fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.78rem", cursor: "pointer", fontWeight: 600, letterSpacing: "0.04em" }}>
        ⚡ TODAY
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Verify build**

Run: `cd "C:/Users/Joshu/Documents/Claude/Performance Intel" && npx vite build 2>&1 | tail -5`
Expected: clean build. Component isn't rendered in App yet.

- [ ] **Step 3: Commit**

```bash
cd "C:/Users/Joshu/Documents/Claude/Performance Intel"
git add src/app.jsx
git commit -m "feat(nav): add TopNav component"
```

---

### Task 6: Wire TopNav + Breadcrumb into App, replace old render

This is the largest task — it removes the old slide-based nav and connects the new TopNav. After this, the new nav is fully functional but the "By Site" tabs in BusinessOverview/Slide still exist (cleaned up in later tasks).

**Files:**
- Modify: `src/app.jsx` — App component (line ~13553)

- [ ] **Step 1: Add file input refs for the nav menu file uploads**

The existing App already has `goalsInputRef`, `nhInputRef`, `priorGoalsInputRef` — these get used by the menu's upload handlers. No new refs needed.

- [ ] **Step 2: Build the refresh handler that the SettingsMenu will call**

Find where the existing top bar's "Refresh" button is defined (line ~14077). Extract its handler to a named function inside App. Add this above the `return (` of App's main render (around line ~13990):

```jsx
const handleRefresh = useCallback(async () => {
  try {
    setSheetLoading(true);
    const res = await fetch(agentSheetUrl);
    const text = await res.text();
    const rows = parseCSV(text);
    if (rows.length > 0) {
      setRawData(rows);
      setCurrentPage({ section: "overview" });
    }
  } catch(e) { alert("Could not fetch sheet: " + e.message); }
  finally { setSheetLoading(false); }
}, [agentSheetUrl]);
```

- [ ] **Step 3: Replace the entire main render block**

Find the start of the App's main render block — `return (` around line 13937 — and replace from there to the App component's closing `}` at the end of the file.

The new render structure:

```jsx
  return (
    <div style={wrapStyle}>
      {showMbrModal && rawData && <MbrExportModal perf={perf} onClose={() => setShowMbrModal(false)} />}

      {/* Settings panel — keep existing modal, just gate by showSettings */}
      {showSettings && (
        <div style={{ position: "fixed", inset: 0, zIndex: 300, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem" }}
          onClick={e => { if (e.target === e.currentTarget) setShowSettings(false); }}>
          <div style={{ background: "var(--bg-primary)", border: "1px solid var(--glass-border)", borderRadius: "var(--radius-xl, 20px)", padding: "1.75rem", width: "100%", maxWidth: "650px", boxShadow: "0 24px 80px rgba(0,0,0,0.3)" }}>
            <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.78rem", color: "#6366f1", letterSpacing: "0.08em", marginBottom: "1.25rem", fontWeight: 600, textTransform: "uppercase" }}>Data Source Settings</div>
            <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.82rem", color: "var(--text-dim)", marginBottom: "1rem", lineHeight: 1.5 }}>
              Publish Google Sheets as CSV (File → Share → Publish to web → CSV format). Update URLs here when sheets change monthly.
            </div>
            {[
              { key: "agent", label: "Agent Data Sheet", color: "#d97706", current: agentSheetUrl, placeholder: "https://docs.google.com/spreadsheets/.../pub?output=csv" },
              { key: "goals", label: "Goals Sheet", color: "#16a34a", current: goalsSheetUrl, placeholder: "Optional — paste Goals CSV URL" },
              { key: "nh", label: "Roster / New Hires Sheet", color: "#6366f1", current: nhSheetUrl, placeholder: "Optional — paste Roster CSV URL" },
              { key: "prior", label: "Prior Month Agent Data", color: "#d97706", current: priorSheetUrl, placeholder: "Optional — paste Prior Month CSV URL" },
              { key: "priorGoals", label: "Prior Month Goals", color: "#8b5cf6", current: priorGoalsSheetUrl, placeholder: "Optional — paste Prior Month Goals CSV URL" },
            ].map(({ key, label, color, current, placeholder }) => (
              <div key={key} style={{ marginBottom: "1rem" }}>
                <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.78rem", color, letterSpacing: "0.08em", marginBottom: "0.3rem" }}>{label}</div>
                <input defaultValue={current} placeholder={placeholder}
                  onBlur={e => setSheetUrls(prev => ({ ...prev, [key]: e.target.value.trim() }))}
                  style={{ width: "100%", padding: "0.5rem 0.75rem", fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.9rem", background: "var(--bg-secondary)", color: "var(--text-primary)", border: "1px solid var(--border)", borderRadius: "6px", boxSizing: "border-box" }} />
              </div>
            ))}
            <div style={{ display: "flex", gap: "0.5rem", justifyContent: "space-between", marginTop: "1rem" }}>
              <button onClick={() => setSheetUrls({})}
                style={{ padding: "0.4rem 1rem", borderRadius: "6px", border: "1px solid var(--border)", background: "transparent", color: "var(--text-muted)", fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.78rem", cursor: "pointer" }}>
                Reset to Defaults
              </button>
              <button onClick={() => { setShowSettings(false); setRawData(null); setGoalsRaw(null); setNHRaw(null); }}
                style={{ padding: "0.4rem 1rem", borderRadius: "6px", border: "1px solid #2563eb", background: "#2563eb18", color: "#2563eb", fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.78rem", cursor: "pointer", fontWeight: 600 }}>
                Save & Reload
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Hidden file inputs */}
      <input ref={goalsInputRef} type="file" accept=".csv" style={{ display: "none" }} onChange={e => loadFile(e.target.files[0], setGoalsRaw)} />
      <input ref={nhInputRef} type="file" accept=".csv" style={{ display: "none" }} onChange={e => loadFile(e.target.files[0], setNHRaw)} />
      <input ref={priorGoalsInputRef} type="file" accept=".csv" style={{ display: "none" }} onChange={e => loadFile(e.target.files[0], setPriorMonthGoalsRaw)} />

      <TopNav
        rawData={rawData}
        currentPage={currentPage}
        setCurrentPage={setCurrentPage}
        openMenu={openMenu}
        setOpenMenu={setOpenMenu}
        programsBySite={programsBySite}
        siteAttainments={siteAttainments}
        fiscalInfo={perf.fiscalInfo}
        hasTnps={hasTnps}
        lightMode={lightMode}
        setLightMode={setLightMode}
        showToday={showToday}
        setShowToday={setShowToday}
        ollamaAvailable={ollamaAvailable}
        localAI={localAI}
        setLocalAI={setLocalAI}
        onExportMbr={() => setShowMbrModal(true)}
        onRefresh={handleRefresh}
        onUploadGoals={() => goalsInputRef.current.click()}
        onUploadRoster={() => nhInputRef.current.click()}
        onUploadPriorGoals={() => priorGoalsInputRef.current.click()}
        onOpenSettings={() => setShowSettings(true)}
      />

      <Breadcrumb
        section={currentPage.section}
        program={currentPage.program}
        attainment={filteredProgram ? filteredProgram.attainment : null}
      />

      <div style={{ paddingTop: showToday ? 0 : "48px" }}>
        {showToday ? (
          <TodayView recentAgentNames={recentAgentNames} historicalAgentMap={historicalAgentMap} goalLookup={perf.goalLookup} />
        ) : sheetLoading && !rawData ? (
          <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: "var(--bg-primary)", animation: "fadeIn 0.4s ease" }}>
            <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.82rem", color: "var(--text-muted)", letterSpacing: "0.1em", marginBottom: "1.25rem", fontWeight: 500 }}>LOADING FROM GOOGLE SHEETS</div>
            <div style={{ width: "180px", height: "2px", background: "var(--border)", borderRadius: "2px", overflow: "hidden" }}>
              <div style={{ width: "40%", height: "100%", background: "linear-gradient(90deg, #d97706, #f59e0b)", borderRadius: "2px", animation: "shimmer 1.5s ease-in-out infinite" }} />
            </div>
          </div>
        ) : !rawData ? (
          <DropZone
            onData={d => { setRawData(d); setCurrentPage({ section: "overview" }); }}
            goalsRaw={goalsRaw}
            onGoalsLoad={setGoalsRaw}
            newHiresRaw={newHiresRaw}
            onNewHiresLoad={setNHRaw}
          />
        ) : programs.length === 0 ? (
          <div style={{ minHeight: "90vh", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-faint)", fontFamily: "var(--font-ui, Inter, sans-serif)" }}>
            No "Job Type" column found in your data.
          </div>
        ) : currentPage.section === "overview" ? (
          <BusinessOverview perf={perf} onNav={() => {}} goToSlide={() => {}} tnpsSlideIdx={-1} localAI={localAI} priorAgents={priorAgents} priorGoalLookup={priorGoalLookup} lightMode={lightMode} />
        ) : currentPage.section === "tnps" && hasTnps ? (
          <TNPSSlide perf={perf} onNav={() => {}} lightMode={lightMode} />
        ) : currentPage.section === "mom" ? (
          <CampaignComparisonPanel
            currentAgents={perf.agents}
            onNav={() => {}}
            localAI={localAI}
            priorAgents={priorAgents}
            priorGoalLookup={priorGoalLookup}
            priorSheetLoading={priorSheetLoading}
            setPriorRaw={setPriorMonthRaw}
            setPriorGoalsRaw={setPriorMonthGoalsRaw}
          />
        ) : (currentPage.section === "dr" || currentPage.section === "bz") && !currentPage.program ? (
          <SiteDrilldown
            siteLabel={currentPage.section === "dr" ? "Dom. Republic" : "Belize"}
            regions={currentPage.section === "dr" ? siteRegionGroups.dr : siteRegionGroups.bz}
            allAgents={perf.agents}
            programs={programs}
            goalLookup={perf.goalLookup}
            newHireSet={newHireSet}
            fiscalInfo={perf.fiscalInfo}
          />
        ) : (currentPage.section === "dr" || currentPage.section === "bz") && filteredProgram ? (
          <Slide
            key={`${currentPage.section}-${currentPage.program}`}
            program={filteredProgram}
            newHireSet={newHireSet}
            goalLookup={perf.goalLookup}
            fiscalInfo={perf.fiscalInfo}
            slideIndex={0} total={1} onNav={() => {}}
            allAgents={perf.agents}
            localAI={localAI}
            priorAgents={priorAgents}
            tnpsByAgent={perf.tnpsByAgent}
            siteFilter={currentPage.section.toUpperCase()}
          />
        ) : (
          <div style={{ minHeight: "60vh", display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: "1rem", color: "var(--text-dim)", fontFamily: "var(--font-ui, Inter, sans-serif)" }}>
            <div>This view is no longer available.</div>
            <button onClick={() => setCurrentPage({ section: "overview" })}
              style={{ padding: "0.5rem 1rem", borderRadius: "var(--radius-sm, 6px)", border: "1px solid #ed8936", background: "#ed893618", color: "#ed8936", cursor: "pointer", fontWeight: 600 }}>
              Go to Overview
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
```

This replacement removes:
- The fixed top bar with hover-to-expand toolbar
- The shared program nav bar (sorted by attainment)
- All `slideIndex`-based conditional rendering
- The `isOverview`/`isTnpsSlide`/`isCampaignCompare`/`programIdx`/`program` derived variables (now expressed as `currentPage.section` checks)

The DropZone path's standalone top bar (the duplicate `{!rawData && !showToday}` block at lines ~13941-13961 and lines ~13971-13985) is also removed — TopNav handles all states via its `rawData` conditionals.

- [ ] **Step 4: Remove the now-orphaned slideIndex helpers**

Find and delete these inside App (they have no remaining callers after Step 3):
- `const programStartIdx = 1;` (line ~13677)
- `const campaignCompareIdx = programStartIdx + programs.length;`
- `const tnpsSlideIdx = hasTnps ? campaignCompareIdx + 1 : -1;`
- `const totalSlides = 1 + programs.length + 1 + (hasTnps ? 1 : 0);`
- `const navTo = delta => setSlideIndex(...)` (line ~13864)
- `const goToSlide = idx => setSlideIndex(...)` (line ~13865)
- `const [showProgramPicker, setShowProgramPicker] = useState(false);` (no remaining caller)

But **keep**:
- `const [slideIndex, setSlideIndex] = useState(0);` — leave for now; changing the few `setSlideIndex(0)` calls to no-ops in the same task adds risk. (Will be removed in Task 11.)

Actually, since the new render no longer uses slideIndex at all, the simplest approach: replace all remaining `setSlideIndex(0)` calls (in `setRawData` handlers, etc.) with `setCurrentPage({ section: "overview" })`. Then delete `slideIndex`/`setSlideIndex`. Verify with grep:

```bash
cd "C:/Users/Joshu/Documents/Claude/Performance Intel"
grep -n "slideIndex\|setSlideIndex\|navTo\|goToSlide\|programStartIdx\|campaignCompareIdx\|tnpsSlideIdx" src/app.jsx
```

Expected after cleanup: only matches inside the unchanged Slide component (which still receives `slideIndex` and `onNav` as props for now — those become unused but harmless until Task 11 cleanup).

- [ ] **Step 5: Verify build**

Run: `cd "C:/Users/Joshu/Documents/Claude/Performance Intel" && npx vite build 2>&1 | tail -10`
Expected: clean build.

- [ ] **Step 6: Browser test**

Open http://localhost:5173/. Verify:
1. Top nav appears with PERF INTEL · Overview · DR ▼ · BZ ▼ · MoM · tNPS
2. Clicking "DR" opens the dropdown showing programs grouped by category
3. Clicking "Site Overview" inside DR loads the SiteDrilldown filtered to DR
4. Breadcrumb appears: `DR · Dom. Republic › Site Overview`
5. Clicking "Nonsub" inside DR loads the Slide for Nonsub (filtered to DR agents only)
6. Breadcrumb shows: `DR · Dom. Republic › Acquisition › Nonsub` with attainment
7. Clicking "BZ" opens the BZ dropdown with green accent
8. Clicking "Overview" returns to BusinessOverview
9. Clicking "MoM" loads CampaignComparisonPanel
10. Clicking "tNPS" loads TNPSSlide
11. ⚙ menu opens with all the actions
12. ⚡ TODAY toggles TodayView
13. Light/dark toggle works
14. Pacing pill shows `Day X of Y` with green dot
15. Refresh page — last visited page persists (e.g., if you were on DR > Nonsub, refresh stays there)
16. Esc closes any open dropdown
17. Click outside dropdown closes it

If any of these fail, fix before committing.

- [ ] **Step 7: Commit**

```bash
cd "C:/Users/Joshu/Documents/Claude/Performance Intel"
git add src/app.jsx
git commit -m "feat(nav): wire TopNav into App, replace slide-based render"
```

---

### Task 7: Add siteFilter eyebrow to Slide

**The actual filtering of agents to a site is done in App's `filteredProgram` memo (Task 1, Step 6) using `buildProgram(siteAgents, ...)` — Slide receives a fully pre-filtered Program object and renders it normally.** The `siteFilter` prop on Slide is purely for display: it lets Slide show "DR · Acquisition" in the page eyebrow so the user knows they're viewing a site-scoped slice. No filtering logic in Slide itself.

**Files:**
- Modify: `src/app.jsx` — Slide component (line ~10684)

- [ ] **Step 1: Accept siteFilter prop**

Find the Slide function signature:

```jsx
function Slide({ program, newHireSet, goalLookup, fiscalInfo, slideIndex, total, onNav, allAgents, localAI, priorAgents, tnpsByAgent }) {
```

Change to:

```jsx
function Slide({ program, newHireSet, goalLookup, fiscalInfo, slideIndex, total, onNav, allAgents, localAI, priorAgents, tnpsByAgent, siteFilter = null }) {
```

- [ ] **Step 2: Add the eyebrow above the page title**

Find the program header section (search for the line containing `{jobType}` displayed at large font, around line 10773). It currently looks like:

```jsx
<div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.68rem", color: `var(--text-muted)`, letterSpacing: "0.08em", textTransform: "uppercase", fontWeight: 500 }}>
  Program {slideIndex} of {total - 1} <span style={{ display: "inline-block", width: "0.6em" }} /> {totalRowCount} records
</div>
<div style={{ fontFamily: "var(--font-display, Inter, sans-serif)", fontSize: "1.75rem", color: `var(--text-warm)`, fontWeight: 800, letterSpacing: "-0.02em", lineHeight: 1.15, marginTop: "0.15rem" }}>
  {jobType}
</div>
```

Replace the eyebrow div (the "Program X of Y" line) with:

```jsx
<div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.68rem", color: `var(--text-muted)`, letterSpacing: "0.08em", textTransform: "uppercase", fontWeight: 500 }}>
  {siteFilter
    ? `${siteFilter} · ${getMbrCategory(jobType)}`
    : <>Program {slideIndex} of {total - 1} <span style={{ display: "inline-block", width: "0.6em" }} /> {totalRowCount} records</>}
</div>
```

When `siteFilter` is set (called from new nav), eyebrow shows `DR · Acquisition`. When null (legacy callers like Overview's program nav, if any remain), shows the original "Program X of Y" text.

- [ ] **Step 3: Verify build + browser test**

Run: `cd "C:/Users/Joshu/Documents/Claude/Performance Intel" && npx vite build 2>&1 | tail -5`
Expected: clean build.

Open http://localhost:5173/, navigate DR > Nonsub. Verify the eyebrow shows `DR · Acquisition`.

- [ ] **Step 4: Commit**

```bash
cd "C:/Users/Joshu/Documents/Claude/Performance Intel"
git add src/app.jsx
git commit -m "feat(nav): add siteFilter eyebrow to Slide"
```

---

### Task 8: Remove "By Site" tab from BusinessOverview

**Files:**
- Modify: `src/app.jsx` — BusinessOverview component (line ~6700)

- [ ] **Step 1: Remove "bysite" from the tab array**

Find the line (search for `[["overview","Overview"],["bysite","By Site"]`):

```jsx
{[["overview","Overview"],["bysite","By Site"],["daily","Daily"],["trends","Trends"]].map(([t, label]) => (
```

Change to:

```jsx
{[["overview","Overview"],["daily","Daily"],["trends","Trends"]].map(([t, label]) => (
```

- [ ] **Step 2: Remove the "bysite" case from the heading ternary**

Find (search for `tab === "bysite" && activeGroup`):

```jsx
{tab === "bysite" && activeGroup ? activeGroup.label : tab === "daily" ? "Daily Performance" : tab === "trends" ? "Week-over-Week Trends" : "Highlights & Lowlights"}
```

Change to:

```jsx
{tab === "daily" ? "Daily Performance" : tab === "trends" ? "Week-over-Week Trends" : "Highlights & Lowlights"}
```

- [ ] **Step 3: Remove the entire "BY SITE TAB" render block**

Find the `{/* ── BY SITE TAB ── */}` comment in BusinessOverview. Delete from that comment through the matching closing `)}` (the block contains `{tab === "bysite" && (...)}` with site group selector buttons and a `<SiteDrilldown>` render inside).

- [ ] **Step 4: Remove the now-unused state**

Delete these three statements (consecutive in BusinessOverview):

```jsx
const siteGroups = useMemo(() => {
  const allRegions = [...new Set(agents.map(a => (a.region || "Unknown")))].filter(r => r !== "Unknown").sort();
  const bzRegions  = allRegions.filter(r => r.toUpperCase().includes("XOTM"));
  const drRegions  = allRegions.filter(r => !r.toUpperCase().includes("XOTM"));
  const groups = [];
  if (drRegions.length > 0) groups.push({ label: drRegions.length === 1 ? mbrSiteName(drRegions[0]) : "DR", regions: drRegions });
  if (bzRegions.length > 0) groups.push({ label: "BZ", regions: bzRegions });
  return groups;
}, [agents]);

const [selectedGroup, setSelectedGroup] = useState(null);
const activeGroup = selectedGroup || siteGroups[0] || null;
```

- [ ] **Step 5: Verify no orphan references**

Run: `cd "C:/Users/Joshu/Documents/Claude/Performance Intel" && grep -n "siteGroups\|selectedGroup\|activeGroup" src/app.jsx`
Expected: zero matches inside BusinessOverview. Matches in TNPSSlide (line ~6095) for tnps `activeGCS` are unrelated.

- [ ] **Step 6: Verify build + browser test**

Run: `cd "C:/Users/Joshu/Documents/Claude/Performance Intel" && npx vite build 2>&1 | tail -5`
Expected: clean build.

Open http://localhost:5173/. Click Overview. Tabs should be: Overview | Daily | Trends. No "By Site". Click each remaining tab to verify they still render correctly.

- [ ] **Step 7: Commit**

```bash
cd "C:/Users/Joshu/Documents/Claude/Performance Intel"
git add src/app.jsx
git commit -m "refactor(nav): remove By Site tab from BusinessOverview"
```

---

### Task 9: Remove "By Site" tab from Slide

**Files:**
- Modify: `src/app.jsx` — Slide component (line ~10684)

- [ ] **Step 1: Remove "bysite" from the Slide tab array**

Find (search for `...(hasMultipleSites ? ["bysite"] : [])` inside Slide):

```jsx
const tabs = [
  "overview",
  ...(hasMultipleSites ? ["bysite"] : []),
  "agents",
  ...(hasSupervisors || hasWeeklyData ? ["teams"] : []),
  ...(goalLookup ? ["goals"] : []),
  "daily",
];
```

Change to:

```jsx
const tabs = [
  "overview",
  "agents",
  ...(hasSupervisors || hasWeeklyData ? ["teams"] : []),
  ...(goalLookup ? ["goals"] : []),
  "daily",
];
```

- [ ] **Step 2: Remove "bysite" from the tab label mapping**

Find (search for `t === "bysite" ? "By Site"` inside Slide):

```jsx
{t === "overview" ? "Overview" : t === "bysite" ? "By Site" : t === "agents" ? "All Agents" : t === "teams" ? "Teams" : t === "goals" ? "Ranking" : t === "daily" ? "Daily" : t}
```

Change to:

```jsx
{t === "overview" ? "Overview" : t === "agents" ? "All Agents" : t === "teams" ? "Teams" : t === "goals" ? "Ranking" : t === "daily" ? "Daily" : t}
```

- [ ] **Step 3: Remove the BY SITE TAB render block**

Find the `{/* ── BY SITE TAB (program-level) ── */}` comment inside Slide. Delete from that comment through the closing `})()}` (contains the IIFE that builds siteBuckets and renders `<ProgramBySiteTab>`).

- [ ] **Step 4: Remove the now-unused hasMultipleSites variable**

Find inside Slide:

```jsx
const hasMultipleSites = regions.length > 1;
```

Delete it. Verify no other references in Slide:

```bash
cd "C:/Users/Joshu/Documents/Claude/Performance Intel" && grep -n "hasMultipleSites" src/app.jsx
```

Expected: zero matches.

- [ ] **Step 5: Verify build + browser test**

Run: `cd "C:/Users/Joshu/Documents/Claude/Performance Intel" && npx vite build 2>&1 | tail -5`
Expected: clean build.

Open http://localhost:5173/, navigate DR > Nonsub. Tabs should be: Overview | All Agents | Teams | Ranking | Daily. No "By Site". Click each remaining tab.

- [ ] **Step 6: Commit**

```bash
cd "C:/Users/Joshu/Documents/Claude/Performance Intel"
git add src/app.jsx
git commit -m "refactor(nav): remove By Site tab from Slide"
```

---

### Task 10: Delete ProgramBySiteTab dead code

The `ProgramBySiteTab` function (~314 lines) was only called from Slide's "By Site" tab, which was removed in Task 9. It's now unreachable code.

**Files:**
- Modify: `src/app.jsx` — ProgramBySiteTab function (line ~9825 originally)

- [ ] **Step 1: Verify ProgramBySiteTab has no callers**

Run: `cd "C:/Users/Joshu/Documents/Claude/Performance Intel" && grep -n "ProgramBySiteTab" src/app.jsx`
Expected: only one match — the function definition itself (`function ProgramBySiteTab(...)`).

If any other matches appear, do not proceed. Investigate the caller first.

- [ ] **Step 2: Delete the section header comment block**

Find the comment block above the function (search for `SECTION 12d`):

```
// ══════════════════════════════════════════════════════════════════════════════
// SECTION 12d — PROGRAM BY-SITE DRILLDOWN
// For programs that have agents in multiple sites (e.g. DR + BZ), shows
// per-site campaign KPIs, quartile distribution, goals vs plan, and agent lists.
// ══════════════════════════════════════════════════════════════════════════════
```

Replace with a single-line tombstone:

```
// (Section 12d — ProgramBySiteTab removed: site content is now top-level via TopNav)
```

- [ ] **Step 3: Delete the function body**

Delete from `function ProgramBySiteTab(...) {` through its matching closing `}` at the end of the function (~314 lines). The next code after the deletion should be the SECTION 13 separator comment.

To verify the deletion boundaries, before deleting, run:

```bash
cd "C:/Users/Joshu/Documents/Claude/Performance Intel"
grep -n "^// ═.*SECTION 13\|^function ProgramBySiteTab" src/app.jsx
```

This shows the start (`function ProgramBySiteTab`) and end boundary (`SECTION 13` comment). Delete everything between (exclusive of the SECTION 13 comment).

- [ ] **Step 4: Verify build + browser test**

Run: `cd "C:/Users/Joshu/Documents/Claude/Performance Intel" && npx vite build 2>&1 | tail -5`
Expected: clean build.

Open http://localhost:5173/. Quick sanity check: navigate Overview, DR > Site Overview, DR > Nonsub, BZ > Site Overview, BZ > Nonsub, MoM, tNPS, TODAY. Everything should render without errors.

- [ ] **Step 5: Commit**

```bash
cd "C:/Users/Joshu/Documents/Claude/Performance Intel"
git add src/app.jsx
git commit -m "refactor(nav): delete dead ProgramBySiteTab function"
```

---

### Task 11: Final cleanup — remove unused props and slideIndex

After Task 6, the Slide component still accepts `slideIndex`, `total`, `onNav` props that are no longer functionally meaningful (App passes `0`, `1`, `() => {}`). Slide also has prev/next navigation buttons at the bottom (lines ~11359-11371) that no longer make sense in the new nav model — they tried to step through slides linearly, but pages are now selected from the top nav.

Similarly, App still has `slideIndex`/`setSlideIndex` state with no callers using its value.

**Files:**
- Modify: `src/app.jsx` — Slide and App

- [ ] **Step 1: Remove the prev/next slide buttons from Slide**

Find inside Slide (around line 11359) the prev/next button group at the bottom of the page:

```jsx
<button onClick={() => onNav(-1)} disabled={slideIndex === 0}
  style={{ padding: "0.5rem 1.25rem", background: slideIndex===0?"transparent":"var(--bg-tertiary)", ... }}>
  ← PREV
</button>
... dots ...
<button onClick={() => onNav(1)} disabled={slideIndex === total - 1}
  style={{ padding: "0.5rem 1.25rem", background: slideIndex===total-1?"transparent":"var(--bg-tertiary)", ... }}>
  NEXT →
</button>
```

Delete the entire wrapping div containing these buttons. The new top nav supersedes this navigation. (Search for `← PREV` or `NEXT →` to find the exact location — should be near the bottom of Slide's render, around line 11355-11380.)

- [ ] **Step 2: Remove unused props from Slide signature**

Change Slide's signature from:

```jsx
function Slide({ program, newHireSet, goalLookup, fiscalInfo, slideIndex, total, onNav, allAgents, localAI, priorAgents, tnpsByAgent, siteFilter = null }) {
```

To:

```jsx
function Slide({ program, newHireSet, goalLookup, fiscalInfo, allAgents, localAI, priorAgents, tnpsByAgent, siteFilter = null }) {
```

- [ ] **Step 3: Remove the "Program X of Y" eyebrow path now that slideIndex is gone**

Find the eyebrow code touched in Task 7:

```jsx
<div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.68rem", color: `var(--text-muted)`, letterSpacing: "0.08em", textTransform: "uppercase", fontWeight: 500 }}>
  {siteFilter
    ? `${siteFilter} · ${getMbrCategory(jobType)}`
    : <>Program {slideIndex} of {total - 1} <span style={{ display: "inline-block", width: "0.6em" }} /> {totalRowCount} records</>}
</div>
```

Change to:

```jsx
<div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.68rem", color: `var(--text-muted)`, letterSpacing: "0.08em", textTransform: "uppercase", fontWeight: 500 }}>
  {siteFilter ? `${siteFilter} · ${getMbrCategory(jobType)}` : `${totalRowCount} records`}
</div>
```

- [ ] **Step 4: Update App's <Slide /> render to drop unused props**

Find the `<Slide />` JSX inside App's render (added in Task 6). Remove `slideIndex={0} total={1} onNav={() => {}}` from the props.

- [ ] **Step 5: Remove slideIndex state and unused legacy props from BusinessOverview, TNPSSlide, CampaignComparisonPanel calls**

In App's render, the calls to BusinessOverview/TNPSSlide/CampaignComparisonPanel currently pass `onNav={() => {}}` and BusinessOverview also receives `goToSlide={() => {}}` and `tnpsSlideIdx={-1}`. These are vestigial.

For now, keep passing them — they're harmless no-ops. Removing them requires editing those components' signatures, which is out of scope for this task. Leave a follow-up note in commit message.

- [ ] **Step 6: Remove App's slideIndex state**

Find inside App:

```jsx
const [slideIndex, setSlideIndex] = useState(0);
```

Delete it. Verify no callers:

```bash
cd "C:/Users/Joshu/Documents/Claude/Performance Intel" && grep -n "slideIndex\|setSlideIndex" src/app.jsx
```

Expected: zero matches.

- [ ] **Step 7: Verify build + browser test**

Run: `cd "C:/Users/Joshu/Documents/Claude/Performance Intel" && npx vite build 2>&1 | tail -5`
Expected: clean build.

Open http://localhost:5173/, navigate everywhere again:
- Overview tabs (Overview/Daily/Trends)
- DR > Site Overview, DR > each program
- BZ > Site Overview, BZ > each program
- MoM, tNPS, TODAY
- Refresh page — persists last view

No prev/next buttons at the bottom of program slides.

- [ ] **Step 8: Commit**

```bash
cd "C:/Users/Joshu/Documents/Claude/Performance Intel"
git add src/app.jsx
git commit -m "refactor(nav): remove vestigial slideIndex state and prev/next buttons"
```

---

### Task 12: Final integration verification

This task confirms the entire feature works end-to-end and the build/repo are clean.

- [ ] **Step 1: Full feature walk-through in browser**

Open http://localhost:5173/ (run `npm run dev` if needed). Step through:

**Happy path:**
1. Load fresh — should land on whatever page localStorage remembers (or Overview if first load).
2. Click Overview — BusinessOverview renders. Tabs: Overview | Daily | Trends (no By Site).
3. Click DR — dropdown opens with header `DR · X% to goal | Proj Y%`. Site Overview link + categorized programs.
4. Click DR > Site Overview — SiteDrilldown filtered to DR loads. Breadcrumb: `DR · Dom. Republic › Site Overview`.
5. Click DR > Nonsub (or first program in DR) — Slide loads with DR-only data. Breadcrumb: `DR · Dom. Republic › Acquisition › Nonsub` with attainment %. Eyebrow shows `DR · Acquisition`.
6. Click DR header itself — dropdown opens, doesn't navigate.
7. Click Esc — dropdown closes.
8. Click DR, then click outside — dropdown closes.
9. Click BZ > any program — green-themed dropdown, BZ data loads. Breadcrumb green.
10. Click MoM — CampaignComparisonPanel loads.
11. Click tNPS — TNPSSlide loads (only if tNPS data available).
12. Click ⚙ — settings menu opens. Test Export MBR (modal opens). Test Refresh. Test theme toggle.
13. Click ⚡ TODAY — TodayView loads full-screen, top nav hidden.
14. Toggle TODAY off — return to last page.
15. Refresh page — last visited page persists.
16. Open ⚙, then click DR — settings closes, DR opens (only one menu open at a time).
17. Open DevTools console — no errors.

**Edge cases (each should degrade gracefully):**
18. Click "DATA" / Reset to Defaults to clear data sources, then refresh — TopNav should show only logo + theme + ⚙ + TODAY (DR/BZ/MoM/tNPS hidden, no pacing pill).
19. Use the settings to point at an empty data source — when programs.length === 0 and rawData exists, the body shows "No 'Job Type' column found in your data."
20. If tNPS data is unavailable (set tNPS sheet URL to empty in DATA settings, refresh) — tNPS link hidden from TopNav.
21. If BZ has no agents (DR-only dataset) — BZ menu is hidden entirely.
22. If localStorage has a `currentPage` referencing a program that no longer exists — App falls back to Overview gracefully (the catch-all `<div>This view is no longer available.</div>` renders with a "Go to Overview" button).
23. Resize browser to < 900px wide — verify the nav doesn't break catastrophically. Per spec, hamburger collapse is "low priority" and not in scope; horizontal scroll or wrapping is acceptable.
24. With Local AI off (or Ollama not running) — Local AI row should not appear in ⚙ menu.

- [ ] **Step 2: Verify final build size**

Run: `cd "C:/Users/Joshu/Documents/Claude/Performance Intel" && npx vite build 2>&1 | tail -10`
Expected: clean build. Note bundle size — should be similar to or slightly smaller than before (due to ProgramBySiteTab removal).

- [ ] **Step 3: Verify git log is clean**

Run: `cd "C:/Users/Joshu/Documents/Claude/Performance Intel" && git log --oneline 22f4739..HEAD`
Expected: 11 commits (one per Task 1-11) plus the spec commit at the start, all with clear messages.

- [ ] **Step 4: No further commit needed**

This task is verification only. If any step fails, fix and commit appropriately under a follow-up message like `fix(nav): <specific issue>`.
