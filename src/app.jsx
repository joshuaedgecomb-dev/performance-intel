import React, { useState, useMemo, useRef, useCallback, useEffect, Fragment, Component } from "react";

// ── Error Boundary — catches rendering crashes and shows a recovery UI ──────
class ErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: "2rem", fontFamily: "monospace", color: "#dc2626", background: "#fef2f2", border: "1px solid #dc2626", borderRadius: "8px", margin: "1rem" }}>
          <div style={{ fontSize: "1.2rem", fontWeight: 700, marginBottom: "0.5rem" }}>Something went wrong</div>
          <div style={{ fontSize: "0.9rem", color: "#991b1b", marginBottom: "1rem" }}>{String(this.state.error?.message || this.state.error)}</div>
          <button onClick={() => this.setState({ error: null })} style={{ padding: "0.3rem 0.8rem", border: "1px solid #dc2626", borderRadius: "5px", background: "transparent", color: "#dc2626", cursor: "pointer", fontFamily: "monospace" }}>Try Again</button>
        </div>
      );
    }
    return this.props.children;
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// SECTION 1 — CONSTANTS & UTILITIES
// Shared primitives. Never import anything from below into this section.
// ══════════════════════════════════════════════════════════════════════════════

function parseCSV(text) {
  // Strip UTF-8 BOM if present
  const clean = text.replace(/^\uFEFF/, "").trim();
  const lines = clean.split(/\r?\n/);
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map(h => h.trim().replace(/^"|"$/g, ""));
  return lines.slice(1).filter(l => l.trim()).map(line => {
    const vals = [];
    let inQ = false, cur = "";
    for (const ch of line + ",") {
      if (ch === '"') { inQ = !inQ; }
      else if (ch === "," && !inQ) { vals.push(cur.trim()); cur = ""; }
      else cur += ch;
    }
    const row = {};
    headers.forEach((h, i) => { row[h] = (vals[i] || "").replace(/^"|"$/g, "").trim(); });
    return row;
  });
}

function parsePct(val) {
  const n = parseFloat(String(val || "0").replace(/%/g, "").trim());
  return isNaN(n) ? 0 : n;
}
function parseNum(val) {
  const n = parseFloat(String(val || "0").replace(/[,%$]/g, "").trim());
  return isNaN(n) ? 0 : n;
}
function fmt(n, dec = 1) { return Number(n).toFixed(dec); }
function fmtPct(n) { return fmt(n, 1) + "%"; }
function fmtGoal(val, fmtType) {
  if (val === null || val === undefined || isNaN(val)) return "—";
  if (fmtType === "dec2") return Number(val).toFixed(2);
  if (fmtType === "pct")  return Number(val).toFixed(1) + "%";
  return Math.round(val).toLocaleString();
}

function getQuartile(pctToGoal) {
  if (pctToGoal >= 100) return "Q1";
  if (pctToGoal >= 80)  return "Q2";
  if (pctToGoal > 0)    return "Q3";
  return "Q4";
}

const Q = {
  Q1: { color: "#16a34a", glow: "#16a34a33", label: "100%+ to Goal",    badge: "EXCEEDING",   icon: "▲" },
  Q2: { color: "#2563eb", glow: "#2563eb33", label: "80–99.9% to Goal",  badge: "NEAR GOAL",   icon: "◆" },
  Q3: { color: "#d97706", glow: "#d9770633", label: "1–79.9% to Goal",   badge: "BELOW GOAL",  icon: "●" },
  Q4: { color: "#dc2626", glow: "#dc262633", label: "0% to Goal",         badge: "NO ACTIVITY", icon: "■" },
};

function attainColor(pct) {
  if (pct >= 100) return Q.Q1.color;
  if (pct >= 80)  return Q.Q2.color;
  if (pct > 0)    return Q.Q3.color;
  return Q.Q4.color;
}

// ── Fiscal Month & Pacing Utilities ──────────────────────────────────────────
// Fiscal period runs 22nd → 21st, counting only M–F business days.
// datestrs = ["YYYY-MM-DD", ...] from agent.date fields in the dataset.
function getFiscalMonthInfo(datestrs) {
  if (!datestrs || !datestrs.length) return null;
  const sorted = [...datestrs].filter(Boolean).sort();
  const minStr = sorted[0];
  const maxStr = sorted[sorted.length - 1];

  // Parse as local dates to avoid UTC offset shifts
  const parseLoc = s => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
  const minDate  = parseLoc(minStr);
  const maxDate  = parseLoc(maxStr);

  // Fiscal end = 21st of the month after the dataset's first date
  const fiscalEnd = new Date(minDate.getFullYear(), minDate.getMonth() + 1, 21);

  const countBD = (a, b) => {
    let n = 0;
    const cur = new Date(a);
    const end = new Date(b);
    while (cur <= end) {
      const dw = cur.getDay();
      if (dw !== 0 && dw !== 6) n++;
      cur.setDate(cur.getDate() + 1);
    }
    return n;
  };

  const elapsedBDays   = countBD(minDate, maxDate);
  const totalBDays     = countBD(minDate, fiscalEnd);
  const remainingBDays = Math.max(0, totalBDays - elapsedBDays);
  const pctElapsed     = totalBDays > 0 ? (elapsedBDays / totalBDays) * 100 : 0;
  const pad2 = n => String(n).padStart(2, "0");
  const fmtD = d => `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`;

  return { fiscalStart: minStr, fiscalEnd: fmtD(fiscalEnd), lastDataDate: maxStr,
           elapsedBDays, remainingBDays, totalBDays, pctElapsed };
}

// Returns projected EOM numbers and gap vs plan given current pace.
function calcPacing(actual, plan, elapsedBDays, totalBDays) {
  if (!plan || !elapsedBDays || !totalBDays) return null;
  const dailyRate     = actual / elapsedBDays;
  const projected     = Math.round(dailyRate * totalBDays);
  const projectedPct  = (projected / plan) * 100;
  const delta         = projected - plan;
  const remainingDays = totalBDays - elapsedBDays;
  const requiredDaily = remainingDays > 0 ? (plan - actual) / remainingDays : null;
  return { dailyRate, projected, projectedPct, delta: Math.round(delta), requiredDaily };
}

// ── Gainshare ─────────────────────────────────────────────────────────────────
// OVERALL (company-wide) — used on program slides
const GAINSHARE_TIERS = [
  { min: 126,    max: Infinity, mobile: 4.00, hsd: 4.00, costPer: 2.00, label: "> 126%" },
  { min: 120,    max: 125.99,   mobile: 3.00, hsd: 3.00, costPer: 1.50, label: "120–126%" },
  { min: 113,    max: 119.99,   mobile: 2.00, hsd: 2.00, costPer: 1.00, label: "113–119%" },
  { min: 106,    max: 112.99,   mobile: 1.00, hsd: 1.00, costPer: 0.50, label: "106–112%" },
  { min: 95,     max: 105.99,   mobile: 0,    hsd: 0,    costPer: 0,    label: "95–105%" },
  { min: 88,     max: 94.99,    mobile:-1.00, hsd:-1.00, costPer:-0.50, label: "88–94%" },
  { min: 81,     max: 87.99,    mobile:-2.00, hsd:-2.00, costPer:-1.00, label: "81–87%" },
  { min: 74,     max: 80.99,    mobile:-3.00, hsd:-3.00, costPer:-1.50, label: "74–80%" },
  { min: 0,      max: 73.99,    mobile:-4.00, hsd:-4.00, costPer:-2.00, label: "< 74%" },
];

// SITE-LEVEL (BZ / DR breakouts) — used on the By Site drilldown
const GAINSHARE_SITE_TIERS = [
  { min: 139, max: Infinity, mobile: 4.00, hsd: 4.00, costPer: 2.50, label: "> 139%" },
  { min: 129, max: 139,      mobile: 3.00, hsd: 3.00, costPer: 2.00, label: "129–139%" },
  { min: 118, max: 128.99,   mobile: 2.00, hsd: 2.00, costPer: 1.50, label: "118–128.99%" },
  { min: 107, max: 117.99,   mobile: 1.00, hsd: 1.00, costPer: 0.50, label: "107–117.99%" },
  { min: 100, max: 106.99,   mobile: 0,    hsd: 0,    costPer: 0,    label: "100–106.99%" },
  { min: 95,  max: 99.99,    mobile:-1.00, hsd:-1.00, costPer:-0.50, label: "95–99.99%" },
  { min: 90,  max: 94.99,    mobile:-2.00, hsd:-2.00, costPer:-1.00, label: "90–94.99%" },
  { min: 85,  max: 89.99,    mobile:-3.00, hsd:-3.00, costPer:-2.00, label: "85–89.99%" },
  { min: 80,  max: 84.99,    mobile:-4.00, hsd:-4.00, costPer:-2.50, label: "80–84.99%" },
  { min: 0,   max: 79.99,    mobile:-5.00, hsd:-5.00, costPer:-3.00, label: "< 79.99%" },
];

function getGainshareTier(pct, site = false) {
  if (pct === null || pct === undefined) return null;
  const tiers = site ? GAINSHARE_SITE_TIERS : GAINSHARE_TIERS;
  return tiers.find(t => pct >= t.min && pct <= t.max) || tiers[tiers.length - 1];
}

function bonusColor(pct) {
  if (pct > 0)  return "#16a34a";
  if (pct < 0)  return "#dc2626";
  return `var(--text-dim)`;
}
const GOAL_METRICS = [
  { goalKey: "Hours Goal",       label: "Hours",     actualKey: "hours",    mode: "sum", fmt: "num"  },
  { goalKey: "SPH GOAL",         label: "SPH / GPH", actualKey: "gph",      mode: "avg", fmt: "dec2" },
  { goalKey: "HOMES GOAL",       label: "Homes",     actualKey: "goals",    mode: "sum", fmt: "num"  },
  { goalKey: "RGU GOAL",         label: "RGU",       actualKey: "rgu",      mode: "sum", fmt: "num"  },
  { goalKey: "HSD Sell In Goal", label: "New XI",    actualKey: "newXI",    mode: "sum", fmt: "num"  },
  { goalKey: "XM GOAL",          label: "XM Lines",  actualKey: "xmLines",  mode: "sum", fmt: "num"  },
  { goalKey: "VIDEO GOAL",       label: "Video",     actualKey: "newVideo", mode: "sum", fmt: "num"  },
  { goalKey: "XH GOAL",          label: "XH",        actualKey: "newXH",    mode: "sum", fmt: "num"  },
  { goalKey: "Projected Phone",  label: "Phone",     actualKey: null,       mode: null,  fmt: "num"  },
];

const REGION_TO_SITE = {
  "SD-Xfinity":        "DR",
  "Belize City-XOTM":  "BZ",
  "OW-XOTM":           "BZ",
  "San Ignacio-XOTM":  "BZ",
};

const GOALS_STORAGE_KEY = "perf_intel_goals_v1";
const NH_STORAGE_KEY    = "perf_intel_newhires_v1";
const SHEET_URLS_KEY    = "perf_intel_sheet_urls_v1";
const PRIOR_MONTH_STORAGE_KEY = "perf_intel_prior_month_v1";
const DEFAULT_AGENT_SHEET_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vRagC_XDSQ84y25onmWs6MUOZcEdWZNA6fVRRDFUzNWQp3ginYLtOIQsSrwmbAERkOJ-daTvbHqEtoy/pub?gid=667346347&single=true&output=csv";
const DEFAULT_GOALS_SHEET_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vRagC_XDSQ84y25onmWs6MUOZcEdWZNA6fVRRDFUzNWQp3ginYLtOIQsSrwmbAERkOJ-daTvbHqEtoy/pub?gid=1685208822&single=true&output=csv";
const DEFAULT_NH_SHEET_URL    = "https://docs.google.com/spreadsheets/d/e/2PACX-1vRagC_XDSQ84y25onmWs6MUOZcEdWZNA6fVRRDFUzNWQp3ginYLtOIQsSrwmbAERkOJ-daTvbHqEtoy/pub?gid=25912283&single=true&output=csv";


// ══════════════════════════════════════════════════════════════════════════════
// SECTION 2 — DATA NORMALIZATION  (engine/normalizeAgents.js)
// Two-pass: first normalize each daily row, then aggregate per-agent totals
// and stamp a single true quartile back onto every row for that agent.
// ══════════════════════════════════════════════════════════════════════════════

const VALID_REGIONS = new Set(["SD-Xfinity", "Belize City-XOTM", "OW-XOTM", "San Ignacio-XOTM"]);

// Week number → human date range label (2026 calendar)
const WEEK_LABELS = {
  "4":  "Jan 22–24",
  "5":  "Jan 25–31",
  "6":  "Feb 1–7",
  "7":  "Feb 8–14",
  "8":  "Feb 15–21",
  "9":  "Feb 22–28",
  "10": "Mar 1–7",
  "52": "Dec 29–31",
};
// How many business days are in each week (partial weeks counted as-is)
const WEEK_BDAYS = { "52": 3, "4": 3, "5": 5, "6": 5, "7": 5, "8": 5, "9": 5, "10": 5 };
function weekLabel(wk) { return WEEK_LABELS[String(wk)] || `Wk ${wk}`; }
function weekDays(wk)  { return WEEK_BDAYS[String(wk)] ?? 5; }

function normalizeAgents(rows = []) {
  // ── Pass 1: normalize each row individually ─────────────────────────────────
  const normalized = rows
    .filter(r => {
      const jt = (r["Job Type"] || "").trim();
      return jt !== "" && jt !== "Job Type" && jt !== "Not Found";
    })
    .map(r => {      const newXI      = parseNum(r["New XI"]      || r["NewData"]     || 0);
      const xmLines    = parseNum(r["XM Lines"]    || r["XMLines"]    || 0);
      const newXH      = parseNum(r["New XH"]      || r["NewXH"]      || 0);
      const newVideo   = parseNum(r["New Video"]   || r["NewVideo"]   || 0);
      const newVoice   = parseNum(r["NewVoice"]    || r["New Voice"]  || 0);
      const newSecurity= parseNum(r["NewSecurity"] || r["New Security"] || 0);
      const rawRegion = (r.Region || r.region || r.REGION || "Unknown").trim();
      const rocCode  = (r.Job || r.job || "").trim().toUpperCase();
      // SD-Cox agents dialing Xfinity campaigns (GL* ROC codes) get remapped to SD-Xfinity
      const region    = rawRegion === "SD-Xfinty" ? "SD-Xfinity"
                      : rawRegion === "SD-Cox" && rocCode.startsWith("GL") ? "SD-Xfinity"
                      : rawRegion;

      // Exclude rows not belonging to the four recognised regions
      if (!VALID_REGIONS.has(region)) return null;
      const sphGoal    = parseNum(r["SPH Goal"] || r["SPH GOAL"] || 0);
      const goalsNum   = parseNum(r["Goals number"] || r["Goals Number"] || 0);
      // day-level % to goal: Goals / Goals number (prorated daily goal)
      const dayGoals   = parseNum(r.Goals);
      const dayPct     = goalsNum > 0 ? (dayGoals / goalsNum) * 100 : 0;

      return {
        ...r,
        hours:      parseNum(r.Hours),
        goals:      parseNum(r.Goals),
        gph:        parseNum(r.GPH),
        newXI, xmLines, newXH, newVideo, newVoice, newSecurity,
        get rgu() { return this.newVideo + this.newXI + this.newVoice + this.newSecurity + this.xmLines; },
        date:       (r.Date || "").trim(),
        weekNum:    (r["Week Number"] || r["Week"] || "").trim(),
        jobType:    (r["Job Type"] || "Unknown").trim(),
        rocCode:    (r.Job || r.job || "").trim(),
        region,
        agentName:  (r.AgentName || "").trim(),
        supervisor: (r.SupName || r["Supervisor"] || "").trim(),
        sphGoal,
        goalsNum,                          // prorated daily goal for this row
        dayGph:      parseNum(r.GPH),
        dayPctToGoal: dayPct,              // Goals / Goals number for this day
        isSpanishCallback: (r["Job Type"] || "").trim() === "Spanish Callback",
      };
    }).filter(Boolean);

  // ── Pass 2: build per-agent aggregate rollups ───────────────────────────────
  // Group by (agentName + jobType) — same agent can appear in multiple programs
  // Spanish Callback rows are excluded — their hours/goals are already counted elsewhere
  const rollupMap = {};
  normalized.forEach(r => {
    if (r.isSpanishCallback) return; // exclude from aggregation
    const key = `${r.agentName}|||${r.jobType}`;
    if (!rollupMap[key]) {
      rollupMap[key] = {
        agentName: r.agentName,
        jobType:   r.jobType,
        sphGoal:   r.sphGoal,
        totalHours: 0, totalGoals: 0, totalGoalsNum: 0,
        totalNewXI: 0, totalXmLines: 0, totalNewXH: 0, totalNewVideo: 0,
        totalNewVoice: 0, totalNewSecurity: 0,
        dates: {},   // date → { hours, goals, gph, worked: bool }
        weeks: new Set(),
        supervisor: r.supervisor,
        region: r.region,
      };
    }
    const agg = rollupMap[key];
    agg.totalHours    += r.hours;
    agg.totalGoals    += r.goals;
    agg.totalGoalsNum += r.goalsNum;
    agg.totalNewXI    += r.newXI;
    agg.totalXmLines  += r.xmLines;
    agg.totalNewXH    += r.newXH;
    agg.totalNewVideo += r.newVideo;
    agg.totalNewVoice    += r.newVoice;
    agg.totalNewSecurity += r.newSecurity;
    if (r.sphGoal > 0) agg.sphGoal = r.sphGoal; // take any non-zero sphGoal
    if (r.weekNum) agg.weeks.add(r.weekNum);
    // Daily profile
    if (r.date) {
      if (!agg.dates[r.date]) agg.dates[r.date] = { hours: 0, goals: 0 };
      agg.dates[r.date].hours += r.hours;
      agg.dates[r.date].goals += r.goals;
    }
  });

  // Compute aggregate GPH → pctToGoal → quartile for each agent
  const aggQuartileMap = {};  // key → { aggGph, aggPctToGoal, aggQuartile }
  Object.entries(rollupMap).forEach(([key, agg]) => {
    const aggGph       = agg.totalHours > 0 ? agg.totalGoals / agg.totalHours : 0;
    // % to Goal = total goals / total prorated goal (Goals number summed)
    const aggPctToGoal = agg.totalGoalsNum > 0 ? (agg.totalGoals / agg.totalGoalsNum) * 100 : 0;
    const aggQuartile  = getQuartile(aggPctToGoal);
    aggQuartileMap[key] = { aggGph, aggPctToGoal, aggQuartile, rollup: agg };
  });

  // ── Pass 3: stamp aggregate quartile onto every row ─────────────────────────
  return normalized.map(r => {
    const key     = `${r.agentName}|||${r.jobType}`;
    const agg     = aggQuartileMap[key] || {};
    const quartile = agg.aggQuartile || "Q4";
    return {
      ...r,
      quartile,
      _q: quartile,
      pctToGoal:  agg.aggPctToGoal || 0,
      aggGph:     agg.aggGph      || 0,
      aggRollup:  agg.rollup      || null,
    };
  });
}

function parseNewHires(rows = []) {
  // NEW: roster format has "First Name", "Last Name", "Hire Date", "End Date"
  // An agent is a "new hire" if:
  //   - Hire Date is within the last 180 days
  //   - End Date is blank (still active)
  const now = Date.now();
  const DAY = 86400000;
  const NEW_HIRE_DAYS = 180;

  return rows.map(row => {
    // Build name from First Name + Last Name columns
    const first = (row["First Name"] || row["First"] || row["first"] || "").trim();
    const last  = (row["Last Name"]  || row["Last"]  || row["last"]  || "").trim();
    let name = [first, last].filter(Boolean).join(" ");

    // Fallback: legacy format with a single AgentName/Name column
    if (!name) name = (row["AgentName"] || row["Name"] || row["Agent Name"] || "").trim();
    if (!name) return null;

    const endDate   = (row["End Date"]  || row["EndDate"]   || "").trim();
    const hireDate  = (row["Hire Date"] || row["StartDate"] || row["Start Date"] || row["start_date"] || "").trim();

    // Skip agents with an end date (no longer active)
    if (endDate) return null;

    const hireDateMs = hireDate ? new Date(hireDate).getTime() : null;
    const days = hireDateMs ? Math.floor((now - hireDateMs) / DAY) : null;

    // Only include if hired within the threshold (or no date = legacy list format, include all)
    if (days !== null && days > NEW_HIRE_DAYS) return null;

    return { name, startDate: hireDate || null, days };
  }).filter(Boolean);
}

// ── uniqueQuartileDist: use aggregate quartile (one true value per agent) ─────
// Since every row for an agent now carries the same aggregate quartile,
// we just deduplicate by agentName and count.
function uniqueQuartileDist(agents) {
  const seen = {};
  agents.forEach(a => {
    const n = a.agentName;
    if (!n) return;
    if (!seen[n]) seen[n] = a.quartile; // all rows have same quartile — just take first
  });
  const dist = { Q1: 0, Q2: 0, Q3: 0, Q4: 0 };
  Object.values(seen).forEach(q => { if (dist[q] !== undefined) dist[q]++; });
  return dist;
}

// ── Per-agent daily profile builder ──────────────────────────────────────────
// Returns rich per-agent analytics for date-level trend display.
function buildAgentDailyProfile(agentName, jobType, allRows) {
  const rows = allRows.filter(r =>
    r.agentName === agentName && (!jobType || r.jobType === jobType) && r.date
  );
  if (!rows.length) return null;

  // All calendar dates in the dataset range
  const allDates = [...new Set(allRows.filter(r => r.date).map(r => r.date))].sort();

  // Group by date
  const byDate = {};
  rows.forEach(r => {
    if (!byDate[r.date]) byDate[r.date] = { hours: 0, goals: 0, hsd: 0, xm: 0, worked: false };
    byDate[r.date].hours  += r.hours;
    byDate[r.date].goals  += r.goals;
    byDate[r.date].hsd    += r.newXI || 0;
    byDate[r.date].xm     += r.xmLines || 0;
    byDate[r.date].worked  = true;
  });

  const sphGoal = rows[0]?.sphGoal || 0;
  const days = allDates.map(date => {
    const d = byDate[date];
    if (!d) return { date, hours: 0, goals: 0, hsd: 0, xm: 0, gph: null, worked: false, absent: true };
    const gph = d.hours > 0 ? d.goals / d.hours : 0;
    return { date, hours: d.hours, goals: d.goals, hsd: d.hsd, xm: d.xm, gph, worked: true, absent: false,
             pct: sphGoal > 0 ? (gph / sphGoal) * 100 : null };
  });

  const workedDays   = days.filter(d => d.worked);
  const absentDays   = days.filter(d => d.absent);
  const lowHourDays  = workedDays.filter(d => d.hours < 6);
  const strongDays   = workedDays.filter(d => d.hours >= 8 && d.gph >= sphGoal * 0.9);

  // Consistency: std dev of daily GPH on worked days
  const gphVals = workedDays.map(d => d.gph).filter(v => v !== null);
  const gphMean = gphVals.length ? gphVals.reduce((s,v)=>s+v,0)/gphVals.length : 0;
  const gphStd  = gphVals.length > 1
    ? Math.sqrt(gphVals.reduce((s,v)=>s+(v-gphMean)**2,0)/gphVals.length)
    : 0;

  // Streak detection: current active streak / longest streak
  let currentStreak = 0, longestStreak = 0, streak = 0;
  days.slice().reverse().forEach((d, i) => {
    if (d.worked) { if (i === 0) currentStreak++; streak++; longestStreak = Math.max(longestStreak, streak); }
    else { if (i === 0) currentStreak = 0; streak = 0; }
  });

  return {
    agentName, jobType, sphGoal, days,
    totalHours:  workedDays.reduce((s,d)=>s+d.hours,0),
    totalGoals:  workedDays.reduce((s,d)=>s+d.goals,0),
    workedDays:  workedDays.length,
    absentDays:  absentDays.length,
    lowHourDays: lowHourDays.length,
    strongDays:  strongDays.length,
    gphMean, gphStd,
    consistency: gphMean > 0 ? Math.max(0, 100 - (gphStd / gphMean) * 100) : 0,
    currentStreak, longestStreak,
    quartile: rows[0]?.quartile || "Q4",
    supervisor: rows[0]?.supervisor || "",
  };
}


// ══════════════════════════════════════════════════════════════════════════════
// SECTION 3 — SELECTORS  (engine/selectors.js)
// Pure functions. No side effects. Composable.
// ══════════════════════════════════════════════════════════════════════════════

const selectQualified   = agents => agents.filter(a => a.hours >= 16);
const selectQ1          = agents => agents.filter(a => a.quartile === "Q1");
const selectQ2          = agents => agents.filter(a => a.quartile === "Q2");
const selectQ3          = agents => agents.filter(a => a.quartile === "Q3");
const selectQ4          = agents => agents.filter(a => a.quartile === "Q4");
const selectActive      = agents => agents.filter(a => a.hours > 0 && a.hours < 16);
const selectByRegion    = (agents, region) => agents.filter(a => a.region === region);
const selectByProgram   = (agents, jobType) => agents.filter(a => a.jobType === jobType);
const selectNewHireOpps = (agents, newHireSet) =>
  selectQualified(agents).filter(a => newHireSet.has(a.agentName) && (a.quartile === "Q3" || a.quartile === "Q4"));

function uniqueNames(agents) {
  return new Set(agents.map(a => a.agentName).filter(Boolean));
}

// Collapse multi-row agents down to one entry per unique agentName.
// Since pctToGoal/quartile are already aggregate-stamped on every row,
// we just sum hours/goals and keep the aggregate fields from the last row.
function collapseToUniqueAgents(rows) {
  const map = {};
  rows.forEach(a => {
    const name = a.agentName;
    if (!name) return;
    if (!map[name]) {
      map[name] = { ...a, hours: 0, goals: 0, goalsNum: 0,
        newXI: 0, xmLines: 0, newXH: 0, newVideo: 0, rocCodes: new Set() };
    }
    map[name].hours    += a.hours;
    map[name].goals    += a.goals;
    map[name].goalsNum += (a.goalsNum || 0);
    map[name].newXI    += (a.newXI    || 0);
    map[name].xmLines  += (a.xmLines  || 0);
    map[name].newXH    += (a.newXH    || 0);
    map[name].newVideo += (a.newVideo  || 0);
    if (a.rocCode) map[name].rocCodes.add(a.rocCode);
  });
  return Object.values(map);
}

function quartileDist(agents) {
  const dist = { Q1: 0, Q2: 0, Q3: 0, Q4: 0 };
  agents.forEach(a => { if (dist[a.quartile] !== undefined) dist[a.quartile]++; });
  return dist;
}

function getActual(agents, actualKey) {
  if (!actualKey) return null;
  if (actualKey === "hours")    return agents.reduce((s, a) => s + a.hours, 0);
  if (actualKey === "gph")      return agents.length && agents.reduce((s,a)=>s+a.hours,0) > 0
    ? agents.reduce((s, a) => s + a.goals, 0) / agents.reduce((s, a) => s + a.hours, 0) : 0;
  if (actualKey === "goals")    return agents.reduce((s, a) => s + a.goals, 0);
  if (actualKey === "rgu")      return agents.reduce((s, a) => s + a.rgu, 0);
  if (actualKey === "newXI")    return agents.some(a => a.newXI > 0) ? agents.reduce((s, a) => s + a.newXI, 0) : null;
  if (actualKey === "xmLines")  return agents.some(a => a.xmLines > 0) ? agents.reduce((s, a) => s + a.xmLines, 0) : null;
  if (actualKey === "newXH")    return agents.some(a => a.newXH > 0) ? agents.reduce((s, a) => s + a.newXH, 0) : null;
  if (actualKey === "newVideo") return agents.some(a => a.newVideo > 0) ? agents.reduce((s, a) => s + a.newVideo, 0) : null;
  return null;
}


// ══════════════════════════════════════════════════════════════════════════════
// SECTION 4 — GOALS ENGINE  (engine/goalsEngine.js)
// Parses goals CSV into lookup, computes per-program attainment.
// ══════════════════════════════════════════════════════════════════════════════

// ── Dynamic column resolver ───────────────────────────────────────────────────
// Normalizes a string for fuzzy matching: lowercase, collapse whitespace, strip
// common punctuation so "HSD Sell In Goal" == "hsd sell in goal" == "HSD_SELL_IN_GOAL"
function normKey(s) {
  return String(s || "").toLowerCase().replace(/[\s_\-\/]+/g, " ").trim();
}

// Ultra-compact: strip ALL whitespace/separators for tightest fuzzy match
// "Non-Sub" → "nonsub", "Nonsub" → "nonsub", "Non Sub" → "nonsub"
function compactKey(s) {
  return String(s || "").toLowerCase().replace(/[\s_\-\/]+/g, "").trim();
}

// Build a normalized key → original key map for a row (computed once per row)
function rowKeyMap(row) {
  const map = {};
  Object.keys(row).forEach(k => { map[normKey(k)] = k; });
  return map;
}

// Find a value from a row by trying multiple candidate names (case/space insensitive)
function findCol(row, ...candidates) {
  const km = rowKeyMap(row);
  for (const c of candidates) {
    const orig = km[normKey(c)];
    if (orig !== undefined && row[orig] !== undefined && row[orig] !== "") return row[orig];
  }
  return "";
}

function buildGoalLookup(goalsRows) {
  if (!goalsRows) return null;
  const byTA      = {};   // { [targetAudience]: { [site]: [row, ...] } }
  const byProject = {};   // { [project]: [targetAudience, ...] } — for fuzzy program matching
  const byROC     = {};   // { [rocCode]: { [site]: [row, ...] } } — direct code matching
  const byTarget  = {};   // { [fullTargetName]: { [site]: [row, ...] } } — preserves NAT/HQ distinction

  goalsRows.forEach(row => {
    const ta      = (findCol(row, "Target Audience", "Target") || "").trim();
    const target  = (findCol(row, "Target") || "").trim(); // full name like "NAT MAR NS Acquisition WRNS"
    const site    = (findCol(row, "Site") || "").trim().toUpperCase();
    const project = (findCol(row, "Project", "Initiative", "Campaign Type") || "").trim();
    const rocRaw  = (findCol(row, "ROC Numbers", "ROC Number", "ROC", "ROC Code", "GL Code") || "").trim().toUpperCase();
    const funding = (findCol(row, "Funding") || "").trim();
    const rocCodes = rocRaw ? rocRaw.split(/[,;\s]+/).map(s => s.trim()).filter(Boolean) : [];
    if (!ta || !site) return;

    // Attach funding and full target name to each row for display
    row._funding = funding;
    row._target = target;
    row._roc = rocCodes[0] || "";

    // Index by Target Audience
    if (!byTA[ta]) byTA[ta] = {};
    if (!byTA[ta][site]) byTA[ta][site] = [];
    byTA[ta][site].push(row);

    // Index by full Target name (preserves NAT vs HQ)
    if (target) {
      if (!byTarget[target]) byTarget[target] = {};
      if (!byTarget[target][site]) byTarget[target][site] = [];
      byTarget[target][site].push(row);
    }

    // Index by each ROC code
    rocCodes.forEach(roc => {
      if (!byROC[roc]) byROC[roc] = {};
      if (!byROC[roc][site]) byROC[roc][site] = [];
      byROC[roc][site].push(row);
    });

    // Secondary index by Project — tracks which TAs belong to each project
    if (project) {
      if (!byProject[project]) byProject[project] = new Set();
      byProject[project].add(ta);
    }
  });

  // Convert Sets to arrays
  Object.keys(byProject).forEach(k => { byProject[k] = [...byProject[k]]; });

  return { byTA, byProject, byROC, byTarget };
}

// Get all goal entries (by Target Audience) that match a job type.
// First tries an exact TA match, then a project-level match (e.g. "Add XM" → AAL + XM Likely).
// Returns [{ targetAudience, siteMap }, ...] — always an array.
function getGoalEntries(goalLookup, jobType, rocCode) {
  if (!goalLookup) return [];
  const { byTA, byProject, byROC } = goalLookup;

  // 0. Direct ROC code match (highest priority — 1:1 key match)
  if (rocCode && byROC) {
    const roc = rocCode.trim().toUpperCase();
    if (byROC[roc]) return [{ targetAudience: rocCode, siteMap: byROC[roc] }];
  }

  // 1. Exact match on Target Audience
  if (byTA[jobType]) return [{ targetAudience: jobType, siteMap: byTA[jobType] }];

  // 2. Normalized match on Target Audience (collapse spaces/hyphens but keep words separate)
  const normJT = normKey(jobType);
  const normMatch = Object.keys(byTA).find(ta => normKey(ta) === normJT);
  if (normMatch) return [{ targetAudience: normMatch, siteMap: byTA[normMatch] }];

  // 3. Compact match on Target Audience (strip ALL separators: "Non-Sub" == "Nonsub")
  const compJT = compactKey(jobType);
  const compMatch = Object.keys(byTA).find(ta => compactKey(ta) === compJT);
  if (compMatch) return [{ targetAudience: compMatch, siteMap: byTA[compMatch] }];

  // 4. Fuzzy: check if jobType matches any Project key (normalize both)
  const matchedProject = Object.keys(byProject).find(p => normKey(p) === normJT);
  if (matchedProject) {
    return byProject[matchedProject].map(ta => ({ targetAudience: ta, siteMap: byTA[ta] }));
  }
  // Also try compact key on Project
  const compProject = Object.keys(byProject).find(p => compactKey(p) === compJT);
  if (compProject) {
    return byProject[compProject].map(ta => ({ targetAudience: ta, siteMap: byTA[ta] }));
  }

  // 5. Fuzzy: check if any TA contains the jobType (or vice versa) via normKey
  //    Require the shorter string to be at least 5 chars and match at a word boundary
  const fuzzyTAs = Object.keys(byTA).filter(ta => {
    const nta = normKey(ta);
    if (nta === normJT) return false; // already checked in step 2
    const shorter = nta.length < normJT.length ? nta : normJT;
    const longer = nta.length < normJT.length ? normJT : nta;
    if (shorter.length < 5) return false;
    // Check word-boundary match: shorter must start at a word boundary in longer
    const idx = longer.indexOf(shorter);
    if (idx === -1) return false;
    const before = idx === 0 || longer[idx - 1] === " ";
    const after = idx + shorter.length >= longer.length || longer[idx + shorter.length] === " ";
    return before || after;
  });
  if (fuzzyTAs.length > 0) {
    return fuzzyTAs.map(ta => ({ targetAudience: ta, siteMap: byTA[ta] }));
  }

  // 6. Last resort: compact includes (strips all separators then checks substring)
  const compactFuzzy = Object.keys(byTA).filter(ta =>
    compactKey(ta).includes(compJT) || compJT.includes(compactKey(ta))
  );
  if (compactFuzzy.length > 0) {
    return compactFuzzy.map(ta => ({ targetAudience: ta, siteMap: byTA[ta] }));
  }

  // 7. Word overlap: match if 70%+ of the job type's significant words appear in the target name
  //    Handles cases like "MAR Acquisition WRNS" matching "NAT MAR NS Acquisition WRNS"
  const jtWords = normJT.split(/\s+/).filter(w => w.length > 2);
  if (jtWords.length >= 2) {
    const wordOverlap = Object.keys(byTA).filter(ta => {
      const taWords = normKey(ta).split(/\s+/).filter(w => w.length > 2);
      if (taWords.length < 2) return false;
      const common = jtWords.filter(w => taWords.some(tw => tw.includes(w) || w.includes(tw)));
      return common.length >= Math.min(jtWords.length, taWords.length) * 0.7 && common.length >= 2;
    });
    if (wordOverlap.length > 0) {
      return wordOverlap.map(ta => ({ targetAudience: ta, siteMap: byTA[ta] }));
    }
  }

  return [];
}

// ── Core plan computation from a single goals CSV row ─────────────────────────
function computePlanRow(row) {
  return {
    homesGoal: Math.ceil(parseNum(findCol(row, "HOMES GOAL", "Homes Goal", "Home Goal", "Homes"))),
    rguGoal:   Math.ceil(parseNum(findCol(row, "RGU GOAL", "RGU Goal", "RGU"))),
    // Integer GOAL columns must come BEFORE the "Sell In Goal" percentage columns
    hsdGoal:   Math.ceil(parseNum(findCol(row, "HSD GOAL", "HSD Goal", "HSD Sell In Goal", "New XI Goal"))),
    xmGoal:    Math.ceil(parseNum(findCol(row, "XM GOAL",  "XM Goal",  "XM Sell In Goal",  "XM Lines Goal"))),
    videoGoal: Math.ceil(parseNum(findCol(row, "VIDEO GOAL", "Video Goal", "Video Sell In Goal", "New Video Goal"))),
    xhGoal:    Math.ceil(parseNum(findCol(row, "XH GOAL",  "XH Goal",  "XH Sell In Goal",  "New XH Goal"))),
    hoursGoal: Math.ceil(parseNum(findCol(row, "Hours Goal", "HOURS GOAL", "Hour Goal"))),
    sphGoal:   parseNum(findCol(row, "SPH GOAL", "SPH Goal", "SPH")),
  };
}

// Returns every row for a siteMap as a flat array (all sites, all rows)
function uniqueRowsFromEntry(siteMap) {
  if (!siteMap) return [];
  return Object.values(siteMap).flat();
}

function getPlanGoals(goalEntry) {
  // goalEntry is still a siteMap { [site]: [row,...] } — used by buildProgram
  const rows = uniqueRowsFromEntry(goalEntry);
  const total = rows.reduce((s, r) => s + computePlanRow(r).homesGoal, 0);
  return total > 0 ? total : null;
}

function getPlanForKey(goalEntry, metricKey) {
  const rows = uniqueRowsFromEntry(goalEntry);
  let total = 0;
  rows.forEach(r => {
    const p = computePlanRow(r);
    if      (metricKey === "HOMES GOAL")       total += p.homesGoal;
    else if (metricKey === "RGU GOAL")          total += p.rguGoal;
    else if (metricKey === "HSD Sell In Goal")  total += p.hsdGoal;
    else if (metricKey === "XM GOAL")           total += p.xmGoal;
    else if (metricKey === "VIDEO GOAL")        total += p.videoGoal;
    else if (metricKey === "XH GOAL")           total += p.xhGoal;
    else if (metricKey === "Hours Goal")        total += p.hoursGoal;
    else total += parseNum(r[metricKey] || 0);
  });
  return total > 0 ? total : null;
}

function getGlobalPlanGoals(goalLookup) {
  if (!goalLookup) return null;
  let total = 0;
  Object.values(goalLookup.byTA || {}).forEach(siteMap => {
    uniqueRowsFromEntry(siteMap).forEach(r => { total += computePlanRow(r).homesGoal; });
  });
  return total > 0 ? total : null;
}

function getGlobalPlanForKey(goalLookup, metricKey) {
  if (!goalLookup) return null;
  let total = 0;
  Object.values(goalLookup.byTA || {}).forEach(siteMap => {
    uniqueRowsFromEntry(siteMap).forEach(r => {
      const p = computePlanRow(r);
      if      (metricKey === "HOMES GOAL")       total += p.homesGoal;
      else if (metricKey === "RGU GOAL")          total += p.rguGoal;
      else if (metricKey === "HSD Sell In Goal")  total += p.hsdGoal;
      else if (metricKey === "XM GOAL")           total += p.xmGoal;
      else if (metricKey === "VIDEO GOAL")        total += p.videoGoal;
      else if (metricKey === "XH GOAL")           total += p.xhGoal;
      else if (metricKey === "Hours Goal")        total += p.hoursGoal;
      else total += parseNum(r[metricKey] || 0);
    });
  });
  return total > 0 ? total : null;
}


// ══════════════════════════════════════════════════════════════════════════════
// SECTION 5 — REGION BUILDER  (engine/regionBuilder.js)
// Produces RegionStat[] from normalized agents.
// ══════════════════════════════════════════════════════════════════════════════

function buildRegions(agents) {
  const map = {};
  agents.forEach(a => {
    const r = a.region;
    if (!map[r]) map[r] = { agents: [] };
    map[r].agents.push(a);
  });
  return Object.entries(map).map(([name, d]) => {
    const aa   = d.agents;
    const dist = quartileDist(aa);
    return {
      name,
      count:       aa.length,
      totalHours:  aa.reduce((s, a) => s + a.hours, 0),
      totalGoals:  aa.reduce((s, a) => s + a.goals, 0),
      avgPct:      aa.length ? aa.reduce((s, a) => s + a.pctToGoal, 0) / aa.length : 0,
      avgGPH:      aa.length ? aa.reduce((s, a) => s + a.gph,       0) / aa.length : 0,
      q1Count: dist.Q1, q2Count: dist.Q2, q3Count: dist.Q3, q4Count: dist.Q4,
      // Unique counts
      uniqueQ1: new Set(selectQ1(aa).map(a => a.agentName).filter(Boolean)).size,
      uniqueQ4: new Set(selectQ4(aa).map(a => a.agentName).filter(Boolean)).size,
      uniqueAgents: uniqueNames(aa).size,
    };
  }).sort((a, b) => b.avgPct - a.avgPct);
}


// ══════════════════════════════════════════════════════════════════════════════
// SECTION 6 — PROGRAM BUILDER  (engine/programBuilder.js)
// Produces a rich Program object per Job Type, including health score.
// ══════════════════════════════════════════════════════════════════════════════

function calculateHealthScore({ attainment, q1Rate, hoursUtilization, stability }) {
  // 40% goal attainment (or q1Rate if no goals), 30% Q1 density,
  // 20% hours utilization, 10% stability
  const att = Math.min(attainment ?? q1Rate, 150); // cap at 150
  return (
    att              * 0.40 +
    q1Rate           * 0.30 +
    hoursUtilization * 0.20 +
    stability        * 0.10
  );
}

function buildProgram(agents, jobType, goalEntries, newHireSet) {
  // goalEntries = [{ targetAudience, siteMap }, ...]
  // For backward compat, collapse all entries into a single siteMap for plan totals
  const combinedSiteMap = {};
  goalEntries.forEach(({ siteMap }) => {
    Object.entries(siteMap).forEach(([site, rows]) => {
      if (!combinedSiteMap[site]) combinedSiteMap[site] = [];
      combinedSiteMap[site].push(...rows);
    });
  });
  const goalEntry = Object.keys(combinedSiteMap).length > 0 ? combinedSiteMap : null;

  // Deduplicate: one entry per unique agent (hours/goals summed across all rows)
  // pctToGoal and quartile are already aggregate-stamped on every row
  const uniqueAgents = collapseToUniqueAgents(agents);

  const qualified = uniqueAgents.filter(a => a.hours >= 16);
  const q1 = uniqueAgents.filter(a => a.quartile === "Q1").sort((a, b) => b.hours - a.hours);
  const q2 = uniqueAgents.filter(a => a.quartile === "Q2").sort((a, b) => b.hours - a.hours);
  const q3 = uniqueAgents.filter(a => a.quartile === "Q3");
  const q4 = uniqueAgents.filter(a => a.quartile === "Q4").sort((a, b) => b.hours - a.hours);

  const names        = uniqueNames(agents);
  const totalHours   = agents.reduce((s, a) => s + a.hours, 0);
  const totalGoals   = agents.reduce((s, a) => s + a.goals, 0);
  const gph          = totalHours > 0 ? totalGoals / totalHours : 0; // sum/sum, not avg of rates
  const dist         = quartileDist(agents);
  const distUnique   = uniqueQuartileDist(agents);

  // Use deduplicated arrays for rates — avoids inflating counts with multi-row agents
  const uniqueQ1Count    = q1.length;
  const q1Rate           = names.size > 0 ? (uniqueQ1Count / names.size) * 100 : 0;
  const hoursUtilization = names.size > 0 ? (qualified.length  / names.size) * 100 : 0;

  const regions  = buildRegions(agents);
  const variance = regions.length > 1
    ? regions[0].avgPct - regions[regions.length - 1].avgPct
    : 0;
  const stability = Math.max(0, 100 - variance); // 100 = no variance

  const actGoals  = totalGoals;
  const planGoals = getPlanGoals(goalEntry);
  const attainment = planGoals ? (actGoals / planGoals) * 100 : null;

  const healthScore = calculateHealthScore({ attainment, q1Rate, hoursUtilization, stability });

  const topAgent   = q1[0] || null;  // highest-hours Q1 agent
  const worstAgent = q4.filter(a => a.hours >= 16)[0] || q4[0] || null;

  return {
    jobType,
    agents,
    regions,
    // Counts
    totalRowCount:     agents.length,
    uniqueAgentCount:  names.size,
    totalHours,
    totalGoals: actGoals,
    gph,
    // Sub-metric totals
    totalNewXI:    agents.reduce((s, a) => s + a.newXI, 0),
    totalXmLines:  agents.reduce((s, a) => s + a.xmLines, 0),
    totalNewXH:    agents.reduce((s, a) => s + a.newXH, 0),
    totalNewVideo: agents.reduce((s, a) => s + a.newVideo, 0),
    totalRgu:      agents.reduce((s, a) => s + a.rgu, 0),
    // Distribution
    dist,        // raw row counts
    distUnique,  // unique-name counts
    q1Rate,
    hoursUtilization,
    stability,
    healthScore,
    // Filtered sets
    qualified,
    q1Agents: q1, q2Agents: q2, q3Agents: q3, q4Agents: q4,
    topAgent, worstAgent,
    // Goals
    goalEntry,        // combined siteMap for MetricComparePanel / stat card
    goalEntries,      // per-TA entries for GoalsRollup tab (separated sections)
    planGoals,
    actGoals,
    attainment,
    // Sub-metric flags — check both old column names and new aliases
    hasNewXI:   agents.some(a => a.newXI   > 0),
    hasXMLines: agents.some(a => a.xmLines > 0),
    hasNewXH:   agents.some(a => a.newXH   > 0),
    hasNewVideo:agents.some(a => a.newVideo > 0),
    // New hires in this program
    newHiresInProgram: uniqueAgents.filter(a => newHireSet.has(a.agentName)),
  };
}

function buildPrograms(agents, goalLookup, newHireSet) {
  // Spanish Callback is excluded — tracked separately via buildSpanishCallbackStats
  const mainAgents = agents.filter(a => !a.isSpanishCallback);
  const jobTypes = [...new Set(mainAgents.map(a => a.jobType))].sort();
  return jobTypes.map(jt => {
    const progAgents  = selectByProgram(mainAgents, jt);
    // Collect ROC codes from agents in this program for precise goal matching
    const agentRocs = [...new Set(progAgents.map(a => a.rocCode).filter(Boolean))];
    let goalEntries = [];
    if (goalLookup) {
      // Try ROC-based matching first if agents have ROC codes
      if (agentRocs.length > 0) {
        agentRocs.forEach(roc => {
          const rocEntries = getGoalEntries(goalLookup, jt, roc);
          rocEntries.forEach(e => {
            // Avoid duplicates
            if (!goalEntries.some(existing => existing.targetAudience === e.targetAudience)) {
              goalEntries.push(e);
            }
          });
        });
      }
      // Fall back to name-based matching if no ROC matches found
      if (goalEntries.length === 0) {
        goalEntries = getGoalEntries(goalLookup, jt);
      }
    }
    return buildProgram(progAgents, jt, goalEntries, newHireSet);
  }).sort((a, b) => {
    if (a.attainment !== null && b.attainment !== null) return b.attainment - a.attainment;
    return b.healthScore - a.healthScore;
  });
}

// ── Spanish Callback comparative stats ───────────────────────────────────────
function buildSpanishCallbackStats(agents) {
  const scAgents = agents.filter(a => a.isSpanishCallback);
  if (!scAgents.length) return null;

  const totalHours = scAgents.reduce((s, a) => s + a.hours, 0);
  const totalGoals = scAgents.reduce((s, a) => s + a.goals, 0);
  const gph        = totalHours > 0 ? totalGoals / totalHours : 0;
  const uNames     = [...new Set(scAgents.map(a => a.agentName).filter(Boolean))];

  // Per-agent rollup: sum hours+goals within SC only
  const agentMap = {};
  scAgents.forEach(a => {
    if (!a.agentName) return;
    if (!agentMap[a.agentName]) agentMap[a.agentName] = { hours: 0, goals: 0, goalsNum: 0, supervisor: a.supervisor, region: a.region };
    agentMap[a.agentName].hours    += a.hours;
    agentMap[a.agentName].goals    += a.goals;
    agentMap[a.agentName].goalsNum += a.goalsNum;
  });

  const agentList = Object.entries(agentMap)
    .filter(([, d]) => d.hours > 0)
    .map(([name, d]) => {
      const agGph = d.hours > 0 ? d.goals / d.hours : 0;
      const pct   = d.goalsNum > 0 ? (d.goals / d.goalsNum) * 100 : 0;
      return { name, ...d, agGph, pct, quartile: getQuartile(pct) };
    })
    .sort((a, b) => b.agGph - a.agGph);

  // Weekly rollup
  const weekMap = {};
  scAgents.forEach(a => {
    const wk = a.weekNum || "?";
    if (!weekMap[wk]) weekMap[wk] = { goals: 0, hours: 0 };
    weekMap[wk].goals += a.goals;
    weekMap[wk].hours += a.hours;
  });
  const WEEK_ORDER = ["52","4","5","6","7","8","9","10"];
  const weeklyTrend = Object.entries(weekMap)
    .sort(([a],[b]) => (WEEK_ORDER.indexOf(b)||99) - (WEEK_ORDER.indexOf(a)||99))
    .map(([wk, d]) => ({ week: wk, ...d, gph: d.hours > 0 ? d.goals / d.hours : 0 }));

  const distU = { Q1: 0, Q2: 0, Q3: 0, Q4: 0 };
  agentList.forEach(a => { if (distU[a.quartile] !== undefined) distU[a.quartile]++; });

  return { totalHours, totalGoals, gph, uNames, agentList, weeklyTrend, distU };
}

// ── Supervisor / Team aggregation ─────────────────────────────────────────────
// Returns sorted array of supervisor scorecards for a given agent set.
function buildSupervisorStats(agents) {
  const map = {};
  agents.forEach(a => {
    const sup = a.supervisor || "Unknown";
    if (!map[sup]) map[sup] = { supervisor: sup, agentRows: {} };
    // group rows by agentName so we can aggregate correctly
    if (!map[sup].agentRows[a.agentName]) map[sup].agentRows[a.agentName] = [];
    map[sup].agentRows[a.agentName].push(a);
  });
  return Object.values(map).map(({ supervisor, agentRows }) => {
    const agentList = Object.entries(agentRows).map(([name, rows]) => {
      const totalGoals = rows.reduce((s, a) => s + a.goals, 0);
      const totalHours = rows.reduce((s, a) => s + a.hours, 0);
      const aggGph     = totalHours > 0 ? totalGoals / totalHours : 0;
      const totalHsd   = rows.reduce((s, a) => s + (a.newXI || 0), 0);
      const totalXm    = rows.reduce((s, a) => s + (a.xmLines || 0), 0);
      const region     = rows[0]?.region || "";
      return { agentName: name, totalGoals, totalHours, aggGph, quartile: rows[0].quartile, totalHsd, totalXm, region };
    });
    const totalGoals = agentList.reduce((s, a) => s + a.totalGoals, 0);
    const totalHours = agentList.reduce((s, a) => s + a.totalHours, 0);
    const totalHsd   = agentList.reduce((s, a) => s + a.totalHsd, 0);
    const totalXm    = agentList.reduce((s, a) => s + a.totalXm, 0);
    const gph        = totalHours > 0 ? totalGoals / totalHours : 0;
    const distU      = { Q1: 0, Q2: 0, Q3: 0, Q4: 0 };
    agentList.forEach(a => { if (distU[a.quartile] !== undefined) distU[a.quartile]++; });
    const uNames  = agentList.length;
    const q1Rate  = uNames > 0 ? (distU.Q1 / uNames) * 100 : 0;
    // Keep all raw rows for weekly rollup
    const rows    = agents.filter(a => (a.supervisor || "Unknown") === supervisor);
    // Sort agents by hours highest to lowest
    agentList.sort((a, b) => b.totalHours - a.totalHours);
    return { supervisor, totalGoals, totalHours, totalHsd, totalXm, gph, distU, uNames, q1Rate, rows, agentList };
  }).sort((a, b) => b.gph - a.gph);
}

// ── Weekly rollup ─────────────────────────────────────────────────────────────
// Returns { weeks: [...], bySupervisor: { supName: [{ week, goals, hours, gph, q1Rate }] } }
function buildWeeklyRollup(agents) {
  const WEEK_ORDER = ["52", "4", "5", "6", "7", "8", "9", "10"];
  const weeks = [...new Set(agents.map(a => a.weekNum).filter(w => w && w !== ""))];
  weeks.sort((a, b) => {
    const ai = WEEK_ORDER.indexOf(a), bi = WEEK_ORDER.indexOf(b);
    return (bi === -1 ? 99 : bi) - (ai === -1 ? 99 : ai);
  });

  const supMap = {};
  agents.forEach(a => {
    const sup = a.supervisor || "Unknown";
    const wk  = a.weekNum || "";
    if (!wk) return;
    if (!supMap[sup]) supMap[sup] = {};
    if (!supMap[sup][wk]) supMap[sup][wk] = { goals: 0, hours: 0, agentRows: [] };
    supMap[sup][wk].goals += a.goals;
    supMap[sup][wk].hours += a.hours;
    supMap[sup][wk].agentRows.push(a);
  });

  const bySupervisor = {};
  Object.entries(supMap).forEach(([sup, wkMap]) => {
    bySupervisor[sup] = weeks.map(wk => {
      const d    = wkMap[wk] || { goals: 0, hours: 0, agentRows: [] };
      const gph  = d.hours > 0 ? d.goals / d.hours : null;
      const dU   = uniqueQuartileDist(d.agentRows);
      const uN   = uniqueNames(d.agentRows).size;
      const q1R  = uN > 0 ? (dU.Q1 / uN) * 100 : 0;
      return { week: wk, goals: d.goals, hours: d.hours, gph, q1Rate: q1R, agentCount: uN };
    });
  });

  // Also build program-level weekly rollup (all agents combined)
  const programWeekly = weeks.map(wk => {
    const wa = agents.filter(a => a.weekNum === wk);
    const g  = wa.reduce((s, a) => s + a.goals, 0);
    const h  = wa.reduce((s, a) => s + a.hours, 0);
    const dU = uniqueQuartileDist(wa);
    const uN = uniqueNames(wa).size;
    return { week: wk, goals: g, hours: h, gph: h > 0 ? g / h : null, distU: dU, agentCount: uN };
  });

  return { weeks, bySupervisor, programWeekly };
}


// ══════════════════════════════════════════════════════════════════════════════
// SECTION 7 — INSIGHTS ENGINE  (engine/insights.js)
// All insight generators return { type, priority, category, text }.
// Never return plain strings from here.
// ══════════════════════════════════════════════════════════════════════════════

function insight(type, priority, category, text) {
  return { type, priority, category, text };
}

function generateWinInsights(program) {
  const { q1Agents, q2Agents, regions, topAgent, qualified } = program;
  // q1/q2 are already deduplicated unique agents — filter to 16+ hrs for qualified insights
  const q1Qual = q1Agents.filter(a => a.hours >= 16);
  const q2Qual = q2Agents.filter(a => a.hours >= 16);
  const results = [];

  if (q1Qual.length === 0 && q2Qual.length === 0) {
    return [insight("win", "low", "performance",
      "No top-tier performers with 16+ hours in this program yet. Focus energy on getting more agents to the 16-hour threshold while moving Q3 agents toward the 80% goal mark.")];
  }

  if (topAgent) {
    const over = (topAgent.pctToGoal - 100).toFixed(1);
    const gph  = topAgent.hours > 0 ? (topAgent.goals / topAgent.hours).toFixed(3) : "0.000";
    results.push(insight("win", "high", "coaching",
      `${topAgent.agentName} leads Q1 in volume with ${fmt(topAgent.hours, 1)} hours at ${Math.round(topAgent.pctToGoal)}% to goal — ${over}% above target sustained across meaningful volume (${gph} GPH). Sustained high performance at scale is the gold standard. Record a call review and use their approach as a training asset.`));
  }

  if (q1Qual.length >= 3) {
    const names = q1Qual.slice(0, 3).map(a => a.agentName).join(", ");
    results.push(insight("win", "high", "performance",
      `${q1Qual.length} agents with 16+ hours are exceeding 100% of goal, including ${names}. This concentration signals a healthy program culture. Leverage these agents to lead small-group huddles — peer coaching at this level is consistently more effective than top-down training.`));
  }

  if (q2Qual.length > 0) {
    // Weighted average: sum(goals) / sum(goalsNum) gives true group pct
    const totGoals    = q2Qual.reduce((s, a) => s + a.goals, 0);
    const totGoalsNum = q2Qual.reduce((s, a) => s + (a.goalsNum || 0), 0);
    const avgPct = totGoalsNum > 0 ? ((totGoals / totGoalsNum) * 100).toFixed(1) : q2Qual[0].pctToGoal.toFixed(1);
    const avgHrs = (q2Qual.reduce((s, a) => s + a.hours, 0) / q2Qual.length).toFixed(0);
    results.push(insight("win", "medium", "coaching",
      `${q2Qual.length} agent${q2Qual.length > 1 ? "s are" : " is"} in Q2 averaging ${avgPct}% to goal across ${avgHrs} hours — within striking distance of the 100% threshold. A targeted objection-handling refresher could realistically move several into Q1 this cycle.`));
  }

  if (regions.length > 1) {
    const top = regions[0];
    const gap = (top.avgPct - regions[regions.length - 1].avgPct).toFixed(1);
    results.push(insight("win", "medium", "regional",
      `${top.name} leads all sites at ${fmtPct(top.avgPct)} avg to goal. ${parseFloat(gap) > 15
        ? `A ${gap}% gap vs. the lowest site suggests meaningful process or coaching differences worth investigating.`
        : "Regional performance is relatively consistent, reflecting well on program-wide alignment."}`));
  }

  // Top GPH among 16+ hr agents only — excludes low-volume outliers
  const topGPH = [...qualified].filter(a => a.hours >= 16 && a.goals > 0).sort((a, b) => (b.goals/b.hours) - (a.goals/a.hours))[0];
  if (topGPH && topGPH.hours > 0) {
    const gph = (topGPH.goals / topGPH.hours).toFixed(3);
    results.push(insight("win", "low", "performance",
      `${topGPH.agentName} leads in efficiency with ${gph} GPH over ${fmt(topGPH.hours, 1)} hours. High GPH at meaningful volume indicates excellent call flow — key behavior to spotlight in your next calibration.`));
  }

  return results;
}

function generateOppInsights(program, allAgents, newHireSet) {
  const { q4Agents, q3Agents, qualified, agents, jobType } = program;
  // q3/q4 are already deduplicated — filter to 16+ hrs for coaching insights
  const q3Qual = q3Agents.filter(a => a.hours >= 16);
  const q4Qual = q4Agents.filter(a => a.hours >= 16);
  const results = [];

  const highHoursLow = qualified.filter(a => a.pctToGoal < 50);
  // under16: unique agents with hours logged but not yet qualified
  const under16     = collapseToUniqueAgents(agents).filter(a => a.hours > 0 && a.hours < 16);
  const newHireOpps = qualified.filter(a =>
    newHireSet.has(a.agentName) && (a.quartile === "Q3" || a.quartile === "Q4")
  );

  if (q4Qual.length === 0 && q3Qual.length === 0 && under16.length < 15) {
    return [insight("opp", "low", "performance",
      "No significant performance concerns among qualified (16+ hr) agents. Maintain current coaching cadence and focus on sustaining Q1/Q2 momentum.")];
  }

  if (q4Qual.length > 0) {
    const names    = q4Qual.slice(0, 3).map(a => a.agentName).join(", ");
    const totalHrs = q4Qual.reduce((s, a) => s + a.hours, 0);
    results.push(insight("opp", "high", "coaching",
      `${q4Qual.length} agent${q4Qual.length > 1 ? "s" : ""} with 16+ hours recorded 0% to goal — zero conversions across ${fmt(totalHrs, 0)} invested hours: ${names}${q4Qual.length > 3 ? `, plus ${q4Qual.length - 3} more` : ""}. Pull call recordings within 24 hours and assess pitch delivery, product knowledge, and attendance consistency.`));
  }

  if (q3Qual.length > 0) {
    // True weighted average: total goals / total prorated goals
    const totGoals    = q3Qual.reduce((s, a) => s + a.goals, 0);
    const totGoalsNum = q3Qual.reduce((s, a) => s + (a.goalsNum || 0), 0);
    const avgPct  = totGoalsNum > 0 ? ((totGoals / totGoalsNum) * 100).toFixed(1) : "—";
    const totalHrs = q3Qual.reduce((s, a) => s + a.hours, 0);
    const lowestQ3 = [...q3Qual].sort((a, b) => a.pctToGoal - b.pctToGoal)[0];
    results.push(insight("opp", "high", "coaching",
      `${q3Qual.length} agents with 16+ hours in Q3 averaging ${avgPct}% to goal across ${fmt(totalHrs, 0)} total hours. ${lowestQ3.agentName} is furthest from the 80% threshold at ${Math.round(lowestQ3.pctToGoal)}%. Close-rate improvement is the coaching priority.`));
  }

  const lowQ3 = highHoursLow.filter(a => a.quartile === "Q3");
  if (lowQ3.length > 0) {
    const names = lowQ3.map(a => a.agentName).join(", ");
    results.push(insight("opp", "medium", "coaching",
      `${names} logged significant hours yet remain under 50% to goal — this is a conversion quality issue, not effort. Pair with a Q1 agent for a side-by-side listen.`));
  }

  if (under16.length >= 15) {
    const totalHrs = under16.reduce((s, a) => s + a.hours, 0);
    const avgHrs   = (totalHrs / under16.length).toFixed(1);
    results.push(insight("opp", "medium", "volume",
      `${under16.length} agents are contributing hours but haven't hit the 16-hour threshold (avg ${avgHrs} hrs, ${fmt(totalHrs, 0)} hrs total). Review scheduling constraints — if even half reached 16 hours, goal impact would be significant.`));
  }

  if (newHireOpps.length > 0) {
    const names = newHireOpps.map(a => a.agentName).join(", ");
    results.push(insight("opp", "medium", "coaching",
      `New hire${newHireOpps.length > 1 ? "s" : ""} ${names} have logged 16+ hours but are in lower tiers. Don't benchmark against tenured staff — track weekly trajectory. Escalate to a formal support plan if not trending upward by week 6–8.`));
  }

  return results;
}

// ── NARRATIVE SUMMARY ENGINE ──────────────────────────────────────────────────
// Generates a rich, multi-paragraph written summary for each program that a
// supervisor could paste directly into an email or presentation notes.

function generateNarrative(program, fiscalInfo, newHireSet) {
  const {
    jobType, regions, uniqueAgentCount, totalHours, totalGoals, gph,
    distUnique, q1Rate, attainment, planGoals, actGoals,
    q1Agents, q4Agents, qualified, healthScore,
    totalNewXI, totalXmLines, totalRgu, newHiresInProgram,
    hasNewXI, hasXMLines,
  } = program;

  const lines = [];
  const pct = n => `${Math.round(n)}%`;
  const f = (n, d=1) => Number(n).toFixed(d);

  // ── Opening: Status + Attainment ──
  const remaining = fiscalInfo ? fiscalInfo.remainingBDays : null;
  const elapsed = fiscalInfo ? pct(fiscalInfo.pctElapsed) : null;
  if (attainment !== null && fiscalInfo) {
    const pace = attainment > (fiscalInfo.pctElapsed * 1.05) ? "ahead of" : attainment < (fiscalInfo.pctElapsed * 0.9) ? "behind" : "tracking with";
    lines.push(`${jobType} is at ${pct(attainment)} to goal (${actGoals} of ${planGoals} homes) with ${remaining} business day${remaining !== 1 ? "s" : ""} remaining. The program is ${pace} pace — the month is ${elapsed} elapsed.`);
  } else if (attainment !== null) {
    lines.push(`${jobType} is at ${pct(attainment)} to goal with ${actGoals} of ${planGoals} homes sold.`);
  } else {
    lines.push(`${jobType} has ${totalGoals} sales across ${uniqueAgentCount} agents and ${f(totalHours, 0)} total hours (${f(gph, 3)} GPH).`);
  }

  // ── Workforce composition ──
  const q1n = distUnique.Q1, q4n = distUnique.Q4;
  const q1pct = uniqueAgentCount > 0 ? (q1n / uniqueAgentCount) * 100 : 0;
  const q4pct = uniqueAgentCount > 0 ? (q4n / uniqueAgentCount) * 100 : 0;
  let comp = `The ${uniqueAgentCount}-agent roster breaks down to ${q1n} Q1 (${pct(q1pct)}), ${distUnique.Q2} Q2, ${distUnique.Q3} Q3, and ${q4n} Q4.`;
  if (q1pct >= 30) comp += ` The Q1 density is strong — nearly a third of agents are at or above goal.`;
  else if (q4pct >= 40) comp += ` Q4 density is a concern — ${pct(q4pct)} of agents are at zero attainment.`;
  lines.push(comp);

  // ── Site comparison (if multi-site) ──
  if (regions.length > 1) {
    const sorted = [...regions].sort((a, b) => b.avgPct - a.avgPct);
    const top = sorted[0], bottom = sorted[sorted.length - 1];
    const gap = Math.round(top.avgPct - bottom.avgPct);
    if (gap > 10) {
      lines.push(`${top.name} is outperforming ${bottom.name} by ${gap} percentage points (${pct(top.avgPct)} vs ${pct(bottom.avgPct)} avg % to goal). This gap warrants a coaching alignment review between sites.`);
    } else {
      lines.push(`Performance is relatively balanced across sites — ${top.name} leads at ${pct(top.avgPct)} avg with only a ${gap}-point gap to ${bottom.name}.`);
    }
  }

  // ── Top performers ──
  const topQ1 = q1Agents.filter(a => a.hours >= 16).slice(0, 3);
  if (topQ1.length > 0) {
    const names = topQ1.map(a => `${a.agentName} (${f(a.hours, 0)} hrs, ${f(a.hours > 0 ? a.goals / a.hours : 0, 3)} GPH)`);
    lines.push(`Top performers: ${names.join("; ")}. ${topQ1.length > 1 ? "These agents" : topQ1[0].agentName} should be recognized and their approaches documented for coaching replication.`);
  }

  // ── Risk agents ──
  const highHoursLowPerf = q4Agents.filter(a => a.hours >= 16);
  if (highHoursLowPerf.length > 0) {
    const names = highHoursLowPerf.slice(0, 3).map(a => `${a.agentName} (${f(a.hours, 0)} hrs)`);
    lines.push(`Key risk: ${highHoursLowPerf.length} agent${highHoursLowPerf.length > 1 ? "s" : ""} with 16+ hours still in Q4 — ${names.join(", ")}. These represent the highest-impact coaching opportunities since they have the volume but not the conversion.`);
  }

  // ── New hires ──
  if (newHiresInProgram && newHiresInProgram.length > 0) {
    const nhQ4 = newHiresInProgram.filter(a => a.quartile === "Q4" || a.quartile === "Q3");
    const nhQ1 = newHiresInProgram.filter(a => a.quartile === "Q1");
    let nhLine = `${newHiresInProgram.length} new hire${newHiresInProgram.length > 1 ? "s" : ""} (≤60 days) active in this program.`;
    if (nhQ1.length > 0) nhLine += ` ${nhQ1.length} already performing at Q1 — fast ramp success.`;
    if (nhQ4.length > 0) nhLine += ` ${nhQ4.length} in Q3/Q4 — daily coaching touchpoints critical in first 60 days.`;
    lines.push(nhLine);
  }

  // ── Product mix highlights ──
  const mixParts = [];
  if (hasNewXI && totalNewXI > 0) mixParts.push(`${totalNewXI} HSD`);
  if (hasXMLines && totalXmLines > 0) mixParts.push(`${totalXmLines} XM`);
  if (totalRgu > 0) mixParts.push(`${totalRgu} RGU`);
  if (mixParts.length >= 2) {
    lines.push(`Product mix: ${mixParts.join(", ")} across the program. ${totalNewXI > totalXmLines && hasXMLines ? "XM attach rates may have room to improve relative to HSD volume." : ""}`);
  }

  // ── Pacing projection ──
  if (fiscalInfo && attainment !== null && fiscalInfo.pctElapsed > 0) {
    const projected = Math.round(actGoals / (fiscalInfo.pctElapsed / 100));
    const projPct = planGoals ? Math.round((projected / planGoals) * 100) : null;
    if (projPct !== null) {
      const outlook = projPct >= 100 ? "on track to meet or exceed" : projPct >= 85 ? "within striking distance of" : "at risk of missing";
      lines.push(`At current pace, the program is projected to finish at ${projected} homes (${projPct}% to plan) — ${outlook} goal.`);
    }
  }

  // ── Closing recommendation ──
  if (healthScore >= 80) {
    lines.push(`Overall health score: ${Math.round(healthScore)}/100. This program is performing well. Focus on sustaining momentum and replicating top-performer behaviors across the team.`);
  } else if (healthScore >= 50) {
    lines.push(`Overall health score: ${Math.round(healthScore)}/100. Performance is mixed. Prioritize Q4→Q3 conversion coaching and investigate site-level gaps.`);
  } else {
    lines.push(`Overall health score: ${Math.round(healthScore)}/100. This program needs immediate attention. Focus on fundamentals: call quality reviews, daily coaching touchpoints, and supervisor ride-alongs for bottom-quartile agents.`);
  }

  return lines;
}

function generateBusinessNarrative(perf, fiscalInfo) {
  const { programs, globalGoals, planTotal, totalHours, uniqueAgentCount, regions } = perf;
  const lines = [];
  const pct = n => `${Math.round(n)}%`;
  const f = (n, d=1) => Number(n).toFixed(d);

  // Overall status
  const globalAtt = planTotal ? (globalGoals / planTotal) * 100 : null;
  if (globalAtt !== null && fiscalInfo) {
    const pace = globalAtt > (fiscalInfo.pctElapsed * 1.05) ? "ahead of" : globalAtt < (fiscalInfo.pctElapsed * 0.9) ? "behind" : "tracking with";
    lines.push(`Business-wide: ${globalGoals} of ${planTotal} homes sold (${pct(globalAtt)}). ${fiscalInfo.remainingBDays} business days remaining, month is ${pct(fiscalInfo.pctElapsed)} elapsed. Operations are ${pace} pace.`);
  } else {
    lines.push(`Business-wide: ${globalGoals} homes sold across ${programs.length} programs and ${uniqueAgentCount} agents with ${f(totalHours, 0)} total hours.`);
  }

  // Program ranking
  const ranked = [...programs].sort((a, b) => (b.attainment ?? b.healthScore) - (a.attainment ?? a.healthScore));
  const topProg = ranked[0];
  const botProg = ranked[ranked.length - 1];
  if (topProg && botProg && ranked.length > 1) {
    lines.push(`Strongest program: ${topProg.jobType} at ${topProg.attainment !== null ? pct(topProg.attainment) + " to goal" : "health score " + Math.round(topProg.healthScore)}. Needs attention: ${botProg.jobType} at ${botProg.attainment !== null ? pct(botProg.attainment) + " to goal" : "health score " + Math.round(botProg.healthScore)}.`);
  }

  // Site summary
  if (regions.length > 1) {
    const drRegs = regions.filter(r => !r.name.toUpperCase().includes("XOTM"));
    const bzRegs = regions.filter(r => r.name.toUpperCase().includes("XOTM"));
    const drHrs = drRegs.reduce((s, r) => s + r.totalHours, 0);
    const bzHrs = bzRegs.reduce((s, r) => s + r.totalHours, 0);
    const drGoals = drRegs.reduce((s, r) => s + r.totalGoals, 0);
    const bzGoals = bzRegs.reduce((s, r) => s + r.totalGoals, 0);
    const drGph = drHrs > 0 ? drGoals / drHrs : 0;
    const bzGph = bzHrs > 0 ? bzGoals / bzHrs : 0;
    lines.push(`DR (SD-Xfinity): ${drGoals} sales, ${f(drGph, 3)} GPH across ${f(drHrs, 0)} hours. Belize: ${bzGoals} sales, ${f(bzGph, 3)} GPH across ${f(bzHrs, 0)} hours.`);
  }

  // Pacing projection
  if (fiscalInfo && globalAtt !== null && fiscalInfo.pctElapsed > 0) {
    const projected = Math.round(globalGoals / (fiscalInfo.pctElapsed / 100));
    const projPct = planTotal ? Math.round((projected / planTotal) * 100) : null;
    if (projPct !== null) {
      lines.push(`Projected EOM: ${projected} homes (${projPct}% to plan).`);
    }
  }

  return lines;
}

function generateSiteNarrative(siteLabel, agents, programs, goalLookup, fiscalInfo, sitePlanKey) {
  const lines = [];
  const pct = n => `${Math.round(n)}%`;
  const f = (n, d=1) => Number(n).toFixed(d);
  if (!agents.length) return lines;

  const totalHrs = agents.reduce((s, a) => s + a.hours, 0);
  const totalG = agents.reduce((s, a) => s + a.goals, 0);
  const gph = totalHrs > 0 ? totalG / totalHrs : 0;
  const uCount = uniqueNames(agents).size;
  const distU = uniqueQuartileDist(agents);
  const q1pct = uCount > 0 ? (distU.Q1 / uCount) * 100 : 0;

  lines.push(`${siteLabel} has ${uCount} active agents producing ${totalG.toLocaleString()} sales across ${f(totalHrs, 0)} hours (${f(gph, 3)} GPH). Q1 density is ${pct(q1pct)} (${distU.Q1} agents at or above goal).`);

  // Site plan attainment
  if (goalLookup && sitePlanKey) {
    let planHomes = 0;
    Object.values(goalLookup.byTA || {}).forEach(siteMap => {
      (siteMap[sitePlanKey] || []).forEach(r => { planHomes += computePlanRow(r).homesGoal; });
    });
    if (planHomes > 0) {
      const att = (totalG / planHomes) * 100;
      const pace = fiscalInfo && fiscalInfo.pctElapsed > 0 ? (att > fiscalInfo.pctElapsed * 1.05 ? "ahead of" : att < fiscalInfo.pctElapsed * 0.9 ? "behind" : "tracking with") : "";
      lines.push(`Site attainment: ${pct(att)} to goal (${totalG.toLocaleString()} of ${planHomes.toLocaleString()} homes).${pace ? ` The site is ${pace} pace.` : ""}`);
    }
  }

  // Program breakdown ranked by % to goal
  const siteProgs = programs.map(p => {
    const pa = p.agents.filter(a => agents.includes(a));
    if (!pa.length) return null;
    const pg = pa.reduce((s, a) => s + a.goals, 0);
    const ph = pa.reduce((s, a) => s + a.hours, 0);
    const progGph = ph > 0 ? pg / ph : 0;
    // Compute site-specific % to goal
    const siteRows = p.goalEntry ? (p.goalEntry[sitePlanKey] || []) : [];
    const sitePlanGoals = siteRows.reduce((s2, r) => s2 + computePlanRow(r).homesGoal, 0);
    const pctToGoal = sitePlanGoals > 0 ? (pg / sitePlanGoals) * 100 : null;
    return { name: p.jobType, goals: pg, hours: ph, gph: progGph, agents: uniqueNames(pa).size, pctToGoal, sitePlanGoals };
  }).filter(Boolean);

  // Sort by % to goal descending (null at end)
  siteProgs.sort((a, b) => (b.pctToGoal ?? -1) - (a.pctToGoal ?? -1));

  if (siteProgs.length > 1) {
    const top = siteProgs[0];
    const bot = siteProgs[siteProgs.length - 1];
    const topDesc = top.pctToGoal !== null ? `${pct(top.pctToGoal)} to goal (${top.goals} of ${top.sitePlanGoals} homes)` : `${top.goals} sales, ${f(top.gph, 3)} GPH`;
    const botDesc = bot.pctToGoal !== null ? `${pct(bot.pctToGoal)} to goal (${bot.goals} of ${bot.sitePlanGoals} homes)` : `${bot.goals} sales, ${f(bot.gph, 3)} GPH`;
    lines.push(`Strongest program: ${top.name} at ${topDesc}. Needs attention: ${bot.name} at ${botDesc}.`);
  } else if (siteProgs.length === 1) {
    const p = siteProgs[0];
    const desc = p.pctToGoal !== null ? `${pct(p.pctToGoal)} to goal (${p.goals} of ${p.sitePlanGoals} homes)` : `${p.goals} sales, ${f(p.gph, 3)} GPH`;
    lines.push(`Program ${p.name}: ${desc} with ${p.agents} agents.`);
  }

  // Highest risk agents — Q4 with most hours, listed by name
  const riskAgents = collapseToUniqueAgents(agents.filter(a => a.quartile === "Q4" || a.quartile === "Q3"))
    .filter(a => a.hours >= 16)
    .sort((a, b) => b.hours - a.hours);

  if (riskAgents.length > 0) {
    const q4Risk = riskAgents.filter(a => a.quartile === "Q4");
    const q3Risk = riskAgents.filter(a => a.quartile === "Q3");
    if (q4Risk.length > 0) {
      const named = q4Risk.slice(0, 5).map(a => `${a.agentName} (${f(a.hours, 0)} hrs, ${f(a.hours > 0 ? a.goals / a.hours : 0, 3)} GPH)`);
      lines.push(`Highest risk — Q4 agents with 16+ hours: ${named.join("; ")}${q4Risk.length > 5 ? ` and ${q4Risk.length - 5} more` : ""}. These agents have volume but zero conversion — immediate coaching intervention needed.`);
    }
    if (q3Risk.length > 0) {
      const named = q3Risk.slice(0, 3).map(a => `${a.agentName} (${f(a.hours, 0)} hrs, ${a.goals} sales)`);
      lines.push(`Bubble agents — Q3 with 16+ hours: ${named.join("; ")}${q3Risk.length > 3 ? ` and ${q3Risk.length - 3} more` : ""}. Close to Q2 threshold — targeted coaching could push these over.`);
    }
  }

  // New hires
  const nhCount = agents.filter(a => a.isNewHire).length;
  if (nhCount > 0) {
    lines.push(`${nhCount} new hire${nhCount > 1 ? "s" : ""} active at this site. Monitor daily performance and ensure coaching cadence is in place.`);
  }

  return lines;
}

function generateTeamsNarrative(program, agents) {
  const lines = [];
  const f = (n, d=1) => Number(n).toFixed(d);
  const pct = n => `${Math.round(n)}%`;

  // Build supervisor stats with weekly trends
  const supMap = {};
  agents.forEach(a => {
    const sup = a.supervisor || "Unknown";
    if (!supMap[sup]) supMap[sup] = { name: sup, agentNames: new Set(), hours: 0, goals: 0, q1: 0, q2: 0, q3: 0, q4: 0, rows: [], newHires: 0 };
    supMap[sup].agentNames.add(a.agentName);
    supMap[sup].hours += a.hours;
    supMap[sup].goals += a.goals;
    supMap[sup].rows.push(a);
    if (a.quartile === "Q1") supMap[sup].q1++;
    if (a.quartile === "Q2") supMap[sup].q2++;
    if (a.quartile === "Q3") supMap[sup].q3++;
    if (a.quartile === "Q4") supMap[sup].q4++;
    if (a.isNewHire) supMap[sup].newHires++;
  });
  const sups = Object.values(supMap).map(s => {
    const count = s.agentNames.size;
    const gph = s.hours > 0 ? s.goals / s.hours : 0;
    // Compute weekly GPH trend for this supervisor
    const weekMap = {};
    s.rows.forEach(r => {
      if (!r.weekNum) return;
      if (!weekMap[r.weekNum]) weekMap[r.weekNum] = { hours: 0, goals: 0 };
      weekMap[r.weekNum].hours += r.hours;
      weekMap[r.weekNum].goals += r.goals;
    });
    const weekKeys = Object.keys(weekMap).sort();
    const weeklyGph = weekKeys.map(w => weekMap[w].hours > 0 ? weekMap[w].goals / weekMap[w].hours : 0);
    // Trend: compare last week to first week
    const trending = weeklyGph.length >= 2 ? (weeklyGph[weeklyGph.length - 1] > weeklyGph[0] ? "up" : weeklyGph[weeklyGph.length - 1] < weeklyGph[0] * 0.9 ? "down" : "flat") : "unknown";
    // Q4 agents with high hours (coaching drain)
    const q4heavy = [...s.agentNames].filter(name => {
      const aRows = s.rows.filter(r => r.agentName === name);
      const totalH = aRows.reduce((sum, r) => sum + r.hours, 0);
      const q = aRows[0]?.quartile;
      return q === "Q4" && totalH >= 16;
    });
    return { ...s, count, gph, trending, weeklyGph, q4heavy, weekKeys };
  }).filter(s => s.name !== "Unknown").sort((a, b) => b.gph - a.gph);

  if (sups.length === 0) return lines;

  // 1. Coaching efficiency — which sups have the most wasted hours (Q4 agents with high volume)
  const coachingDrain = [...sups].sort((a, b) => b.q4heavy.length - a.q4heavy.length).filter(s => s.q4heavy.length > 0);
  if (coachingDrain.length > 0) {
    const worst = coachingDrain[0];
    lines.push(`Coaching priority: ${worst.name}'s team has ${worst.q4heavy.length} Q4 agent${worst.q4heavy.length > 1 ? "s" : ""} with 16+ hours (${worst.q4heavy.slice(0, 3).join(", ")}${worst.q4heavy.length > 3 ? "..." : ""}). These agents are producing volume without conversion — the highest-ROI coaching opportunity.`);
  }

  // 2. Trending — which sups are improving vs declining
  const trendingUp = sups.filter(s => s.trending === "up");
  const trendingDown = sups.filter(s => s.trending === "down");
  if (trendingUp.length > 0 || trendingDown.length > 0) {
    let trendLine = "";
    if (trendingUp.length > 0) {
      trendLine += `Trending up: ${trendingUp.map(s => `${s.name} (${f(s.weeklyGph[0], 3)} \u2192 ${f(s.weeklyGph[s.weeklyGph.length-1], 3)} GPH)`).join("; ")}. `;
    }
    if (trendingDown.length > 0) {
      trendLine += `Trending down: ${trendingDown.map(s => `${s.name} (${f(s.weeklyGph[0], 3)} \u2192 ${f(s.weeklyGph[s.weeklyGph.length-1], 3)} GPH)`).join("; ")}. Investigate what changed.`;
    }
    if (trendLine) lines.push(trendLine);
  }

  // 3. Q1 conversion rate — which sup is best at getting agents to goal
  if (sups.length > 1) {
    const byQ1Rate = [...sups].sort((a, b) => (b.q1 / (b.count || 1)) - (a.q1 / (a.count || 1)));
    const best = byQ1Rate[0];
    const bestRate = best.count > 0 ? (best.q1 / best.count) * 100 : 0;
    const worst = byQ1Rate[byQ1Rate.length - 1];
    const worstRate = worst.count > 0 ? (worst.q1 / worst.count) * 100 : 0;
    if (bestRate > worstRate + 15) {
      lines.push(`${best.name} converts ${pct(bestRate)} of agents to Q1 vs ${worst.name} at ${pct(worstRate)}. A ${Math.round(bestRate - worstRate)}-point gap suggests process differences worth investigating through call shadowing or joint coaching sessions.`);
    }
  }

  // 4. New hire distribution — are new hires concentrated under one sup?
  const supsWithNH = sups.filter(s => s.newHires > 0);
  if (supsWithNH.length > 0) {
    const totalNH = supsWithNH.reduce((s2, s) => s2 + s.newHires, 0);
    const heaviest = supsWithNH.sort((a, b) => b.newHires - a.newHires)[0];
    if (heaviest.newHires > totalNH * 0.6 && totalNH > 2) {
      lines.push(`${heaviest.name} is carrying ${heaviest.newHires} of ${totalNH} new hires (${pct(heaviest.newHires / totalNH * 100)}). Heavy new hire load limits coaching bandwidth for existing agents. Consider rebalancing.`);
    }
  }

  // 5. Team size vs output — identify if small teams are outperforming large ones
  if (sups.length > 1) {
    const smallest = [...sups].sort((a, b) => a.count - b.count)[0];
    const largest = [...sups].sort((a, b) => b.count - a.count)[0];
    if (smallest.gph > largest.gph && largest.count > smallest.count * 1.5) {
      lines.push(`${smallest.name}'s smaller team (${smallest.count} agents) outperforms ${largest.name}'s larger team (${largest.count} agents) in GPH (${f(smallest.gph, 3)} vs ${f(largest.gph, 3)}). Smaller teams may benefit from more focused coaching time per agent.`);
    }
  }

  return lines;
}

function generateBusinessInsights({ programs, regions, newHireSet, globalGoals, planTotal }) {
  const results = [];
  if (!programs.length) return results;

  const sorted    = [...programs].sort((a, b) => (b.attainment ?? b.healthScore) - (a.attainment ?? a.healthScore));
  const topProg   = sorted[0];
  const lowProg   = sorted[sorted.length - 1];
  const topRegion = regions[0];
  const lowRegion = regions[regions.length - 1];

  const allAgents     = programs.flatMap(p => p.agents);
  // q1Agents are already unique per program — deduplicate across programs by name
  const totalUniqueQ1 = new Set(programs.flatMap(p => p.q1Agents).map(a => a.agentName).filter(Boolean)).size;
  const totalUnique   = new Set(allAgents.map(a => a.agentName).filter(Boolean)).size;
  // under16: collapse all agent rows to unique, then filter
  const under16All    = collapseToUniqueAgents(allAgents).filter(a => a.hours > 0 && a.hours < 16);
  const activeNH      = newHireSet.size;

  // Wins
  if (topProg) {
    const metric = topProg.attainment !== null
      ? `${Math.round(topProg.attainment)}% of plan`
      : `${topProg.q1Agents.length} Q1 agents`;
    results.push(insight("win", "high", "performance",
      `${topProg.jobType} leads all programs at ${metric} with ${topProg.uniqueAgentCount} unique agents. This program sets the benchmark and should be the first reference point for cross-program learning.`));
  }

  if (topRegion) {
    results.push(insight("win", "high", "regional",
      `${topRegion.name} is the top-performing region with ${topRegion.totalGoals.toLocaleString()} total goals and ${topRegion.uniqueQ1} Q1 agents out of ${topRegion.uniqueAgents}. Worth investigating for replicable process advantages.`));
  }

  if (totalUniqueQ1 > 0) {
    results.push(insight("win", "medium", "performance",
      `${totalUniqueQ1} unique agent${totalUniqueQ1 > 1 ? "s" : ""} are exceeding 100% of goal across the business — ${Math.round(totalUniqueQ1 / totalUnique * 100)}% of the workforce. A meaningful baseline to amplify through peer coaching.`));
  }

  const atGoalPrograms = programs.filter(p => (p.attainment ?? p.healthScore) >= 80);
  if (atGoalPrograms.length > 0) {
    results.push(insight("win", "medium", "performance",
      `${atGoalPrograms.length} of ${programs.length} programs are at or above 80% of target. The focus should be narrowing the spread rather than systemic repair.`));
  }

  // Opportunities
  // q4Agents per program are already unique — deduplicate across programs by name
  const allQ4Qualified = programs.flatMap(p => p.q4Agents.filter(a => a.hours >= 16));
  const uniqueQ4Names  = new Set(allQ4Qualified.map(a => a.agentName).filter(Boolean));
  if (uniqueQ4Names.size > 0) {
    results.push(insight("opp", "high", "coaching",
      `${uniqueQ4Names.size} unique agent${uniqueQ4Names.size > 1 ? "s" : ""} across the business recorded zero conversions with 16+ hours invested. These represent the most urgent individual coaching cases.`));
  }

  if (lowProg && (lowProg.attainment ?? lowProg.healthScore) < 80) {
    const metric = lowProg.attainment !== null
      ? `${Math.round(lowProg.attainment)}% of plan`
      : `${lowProg.q4Agents.filter(a => a.hours >= 16).length} Q4 agents`;
    results.push(insight("opp", "high", "performance",
      `${lowProg.jobType} is the lowest-performing program at ${metric} with ${lowProg.uniqueAgentCount} agents. A targeted recovery plan is needed — not just routine coaching cadence.`));
  }

  if (regions.length > 1 && topRegion && lowRegion && lowRegion.avgPct < topRegion.avgPct - 15) {
    results.push(insight("opp", "medium", "regional",
      `${lowRegion.name} is lagging all other regions — a significant gap vs. the top site. Regional coaching alignment and a process audit are warranted.`));
  }

  if (under16All.length >= 15) {
    const hrs = under16All.reduce((s, a) => s + a.hours, 0);
    results.push(insight("opp", "medium", "volume",
      `${under16All.length} agents across the business are contributing hours but remain under the 16-hour threshold, representing ${fmt(hrs, 0)} hours of potential production not fully activated.`));
  }

  if (activeNH > 0) {
    results.push(insight("opp", "low", "coaching",
      `${activeNH} new hire${activeNH > 1 ? "s are" : " is"} active across programs. Weekly trend reviews and daily coaching touchpoints are critical in the first 60 days.`));
  }

  return results;
}


// ══════════════════════════════════════════════════════════════════════════════
// SECTION 8 — PERFORMANCE ENGINE HOOK  (engine/usePerformanceEngine.js)
// Central data orchestration. All memos live here. UI consumes results only.
// ══════════════════════════════════════════════════════════════════════════════

function usePerformanceEngine({ rawData, goalsRaw, newHiresRaw }) {
  const agents = useMemo(() =>
    normalizeAgents(rawData || []),
    [rawData]);

  const goalLookup = useMemo(() =>
    buildGoalLookup(goalsRaw),
    [goalsRaw]);

  const newHires = useMemo(() =>
    parseNewHires(newHiresRaw || []),
    [newHiresRaw]);

  const newHireSet = useMemo(() =>
    new Set(newHires.filter(h => h.days <= 60).map(h => h.name)),
    [newHires]);

  const programs = useMemo(() =>
    buildPrograms(agents, goalLookup, newHireSet),
    [agents, goalLookup, newHireSet]);

  const regions = useMemo(() =>
    buildRegions(agents),
    [agents]);

  const planTotal = useMemo(() =>
    getGlobalPlanGoals(goalLookup),
    [goalLookup]);

  const globalGoals = useMemo(() =>
    agents.reduce((s, a) => s + a.goals, 0),
    [agents]);

  const insights = useMemo(() =>
    generateBusinessInsights({ programs, regions, newHireSet, globalGoals, planTotal }),
    [programs, regions, newHireSet, globalGoals, planTotal]);

  // Keyed program map for fast slide lookup
  const programMap = useMemo(() => {
    const m = {};
    programs.forEach(p => { m[p.jobType] = p; });
    return m;
  }, [programs]);

  const jobTypes = useMemo(() =>
    programs.map(p => p.jobType),
    [programs]);

  const allAgentNames = useMemo(() =>
    [...new Set(agents.map(a => a.agentName).filter(Boolean))].sort(),
    [agents]);

  const totalHours = useMemo(() => agents.reduce((s, a) => s + a.hours, 0), [agents]);
  const uniqueAgentCount = useMemo(() => uniqueNames(agents).size, [agents]);

  // Global sub-metric totals
  const globalRgu      = useMemo(() => agents.reduce((s, a) => s + a.rgu, 0), [agents]);
  const globalNewXI    = useMemo(() => agents.reduce((s, a) => s + a.newXI, 0), [agents]);
  const globalXmLines  = useMemo(() => agents.reduce((s, a) => s + a.xmLines, 0), [agents]);
  const globalNewXH    = useMemo(() => agents.reduce((s, a) => s + a.newXH, 0), [agents]);
  const globalNewVideo = useMemo(() => agents.reduce((s, a) => s + a.newVideo, 0), [agents]);

  // Global plan goals for sub-metrics (sum across all programs, BZ counted once)
  const globalPlanRgu     = useMemo(() => getGlobalPlanForKey(goalLookup, "RGU GOAL"), [goalLookup]);
  const globalPlanNewXI   = useMemo(() => getGlobalPlanForKey(goalLookup, "HSD Sell In Goal"), [goalLookup]);
  const globalPlanXmLines = useMemo(() => getGlobalPlanForKey(goalLookup, "XM GOAL"), [goalLookup]);
  const globalPlanHours   = useMemo(() => getGlobalPlanForKey(goalLookup, "Hours Goal"), [goalLookup]);

  const fiscalInfo = useMemo(() => {
    const dates = [...new Set(agents.filter(a => a.date).map(a => a.date))];
    return getFiscalMonthInfo(dates);
  }, [agents]);

  const spanishCallback = useMemo(() => buildSpanishCallbackStats(agents), [agents]);

  return {
    agents,
    goalLookup,
    newHires,
    newHireSet,
    programs,
    programMap,
    jobTypes,
    regions,
    insights,
    planTotal,
    globalGoals,
    totalHours,
    uniqueAgentCount,
    allAgentNames,
    globalRgu,
    globalNewXI,
    globalXmLines,
    globalNewXH,
    globalNewVideo,
    globalPlanRgu,
    globalPlanNewXI,
    globalPlanXmLines,
    globalPlanHours,
    fiscalInfo,
    spanishCallback,
  };
}


// ══════════════════════════════════════════════════════════════════════════════
// SECTION 9 — UI COMPONENTS  (components/)
// Pure presentation. No heavy computation. Consume pre-built data only.
// ══════════════════════════════════════════════════════════════════════════════

// ── Collapsible Narrative Panel ───────────────────────────────────────────────
function CollapsibleNarrative({ title = "Executive Summary", lines = [], defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  if (!lines || lines.length === 0) return null;
  return (
    <div style={{ background: `var(--bg-secondary)`, border: "1px solid var(--border)", borderRadius: "12px", overflow: "hidden" }}>
      <div onClick={() => setOpen(v => !v)}
        style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0.85rem 1.5rem", cursor: "pointer", userSelect: "none" }}>
        <div style={{ fontFamily: "monospace", fontSize: "0.9rem", color: `var(--text-faint)`, letterSpacing: "0.12em", textTransform: "uppercase" }}>{title}</div>
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
          <button onClick={e => { e.stopPropagation(); navigator.clipboard?.writeText(lines.join("\n\n")); }}
            style={{ background: "transparent", border: "1px solid var(--border-muted)", borderRadius: "4px", color: `var(--text-faint)`, padding: "0.1rem 0.4rem", fontFamily: "monospace", fontSize: "0.8rem", cursor: "pointer" }}>
            Copy
          </button>
          <span style={{ fontFamily: "monospace", fontSize: "1.1rem", color: `var(--text-faint)`, transition: "transform 0.2s", transform: open ? "rotate(180deg)" : "rotate(0deg)" }}>{"\u25BC"}</span>
        </div>
      </div>
      {open && (
        <div style={{ padding: "0 1.5rem 1.25rem" }}>
          {lines.map((para, i) => (
            <p key={i} style={{ fontFamily: "Georgia, serif", fontSize: "1.05rem", color: i === 0 ? `var(--text-warm)` : `var(--text-secondary)`, lineHeight: 1.55, margin: i < lines.length - 1 ? "0 0 0.65rem 0" : 0, fontWeight: i === 0 ? 600 : 400 }}>
              {para}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, sub, accent }) {
  return (
    <div style={{ background: `var(--bg-secondary)`, border: `1px solid ${accent}22`, borderRadius: "10px", padding: "1.25rem", borderTop: `3px solid ${accent}` }}>
      <div style={{ fontFamily: "monospace", fontSize: "1.08rem", color: `var(--text-muted)`, textTransform: "uppercase", letterSpacing: "0.12em" }}>{label}</div>
      <div style={{ fontFamily: "'Cormorant Garamond', Georgia, serif", fontSize: "3.15rem", color: `var(--text-warm)`, fontWeight: 700, marginTop: "0.1rem", lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontFamily: "monospace", fontSize: "1.08rem", color: `var(--text-dim)`, marginTop: "0.3rem" }}>{sub}</div>}
    </div>
  );
}

function QBadge({ q, size = "sm" }) {
  const cfg = Q[q] || Q.Q4;
  const pad = size === "sm" ? "0.15rem 0.5rem" : "0.3rem 0.75rem";
  const fs  = size === "sm" ? "0.6rem" : "0.75rem";
  return (
    <span style={{ background: cfg.color + "22", color: cfg.color, border: `1px solid ${cfg.color}44`, borderRadius: "4px", padding: pad, fontFamily: "monospace", fontSize: fs, fontWeight: 700, letterSpacing: "0.05em", whiteSpace: "nowrap" }}>
      {q} · {cfg.badge}
    </span>
  );
}

// InsightCard accepts structured insight objects { type, priority, category, text }
function InsightCard({ type, insights }) {
  const isWin = type === "win";
  const color = isWin ? "#16a34a" : "#dc2626";
  const icon  = isWin ? "🏆" : "⚡";
  const title = isWin ? "Wins & Key Learnings" : "Opportunities & Action Items";

  // Render sorted by priority (high → medium → low)
  const priorityRank = { high: 0, medium: 1, low: 2 };
  const sorted = [...insights].sort((a, b) =>
    (priorityRank[a.priority] ?? 1) - (priorityRank[b.priority] ?? 1));

  return (
    <div style={{ background: `var(--bg-secondary)`, border: `1px solid ${color}33`, borderRadius: "12px", padding: "1.5rem", borderLeft: `4px solid ${color}` }}>
      <div style={{ fontFamily: "monospace", fontSize: "1.14rem", color, letterSpacing: "0.15em", textTransform: "uppercase", marginBottom: "1.25rem", display: "flex", alignItems: "center", gap: "0.5rem" }}>
        <span>{icon}</span> {title}
      </div>
      {sorted.map((ins, i) => (
        <div key={i} style={{ display: "flex", gap: "0.75rem", marginBottom: i < sorted.length - 1 ? "1rem" : 0, paddingBottom: i < sorted.length - 1 ? "1rem" : 0, borderBottom: i < sorted.length - 1 ? `1px solid ${color}18` : "none" }}>
          <div style={{ color, marginTop: "0.15rem", flexShrink: 0, fontSize: "1.05rem" }}>▸</div>
          <div style={{ fontFamily: "Georgia, serif", fontSize: "1.23rem", color: `var(--text-secondary)`, lineHeight: 1.65 }}>{ins.text}</div>
        </div>
      ))}
    </div>
  );
}

function AgentTable({ agents, newHireSet }) {
  const [sort, setSort] = useState({ key: "gph", dir: -1 });
  const [regionFilter, setRegionFilter] = useState(null);

  // Collapse daily rows → one aggregate row per unique agent
  const agentRollups = useMemo(() => {
    const map = {};
    agents.forEach(a => {
      const name = a.agentName;
      if (!name) return;
      if (!map[name]) {
        map[name] = {
          agentName: name,
          region:    a.region,
          jobType:   a.jobType,
          supervisor: a.supervisor,
          quartile:  a.quartile,
          sphGoal:   a.sphGoal,
          hours: 0, goals: 0, goalsNum: 0,
          newXI: 0, xmLines: 0,
          newVoice: 0, newVideo: 0, newSecurity: 0,
        };
      }
      const row = map[name];
      row.hours       += a.hours;
      row.goals       += a.goals;
      row.goalsNum    += a.goalsNum;
      row.newXI       += a.newXI;
      row.xmLines     += a.xmLines;
      row.newVoice    += a.newVoice;
      row.newVideo    += a.newVideo;
      row.newSecurity += a.newSecurity;
    });
    return Object.values(map).map(row => ({
      ...row,
      gph:      row.hours > 0 ? row.goals / row.hours : 0,
      pctToGoal: row.goalsNum > 0 ? (row.goals / row.goalsNum) * 100 : 0,
      rgu:       row.newXI + row.xmLines + row.newVoice + row.newVideo + row.newSecurity,
    }));
  }, [agents]);

  // Get unique regions sorted
  const regionList = useMemo(() => {
    const regMap = {};
    agentRollups.forEach(a => {
      const reg = a.region || "Unknown";
      if (!regMap[reg]) regMap[reg] = { name: reg, count: 0, hours: 0, goals: 0 };
      regMap[reg].count++;
      regMap[reg].hours += a.hours;
      regMap[reg].goals += a.goals;
    });
    return Object.values(regMap).filter(r => r.name !== "Unknown").sort((a, b) => b.goals - a.goals);
  }, [agentRollups]);

  // Apply region filter
  const filteredRollups = useMemo(() => {
    if (!regionFilter) return agentRollups;
    return agentRollups.filter(a => (a.region || "Unknown") === regionFilter);
  }, [agentRollups, regionFilter]);

  const sorted = useMemo(() => {
    return [...filteredRollups].sort((a, b) => {
      const va = a[sort.key] ?? 0;
      const vb = b[sort.key] ?? 0;
      if (typeof va === "string") return va.localeCompare(vb) * sort.dir;
      return (va - vb) * sort.dir;
    });
  }, [filteredRollups, sort]);

  const toggle = key => setSort(s => ({ key, dir: s.key === key ? -s.dir : -1 }));
  const Th = ({ k, label, right }) => (
    <th onClick={() => toggle(k)}
      style={{ padding: "0.5rem 0.75rem", textAlign: right ? "right" : "left",
        color: sort.key === k ? "#d97706" : `var(--text-dim)`, fontWeight: 400, cursor: "pointer",
        whiteSpace: "nowrap", userSelect: "none" }}>
      {label} {sort.key === k ? (sort.dir === -1 ? "↓" : "↑") : ""}
    </th>
  );

  return (
    <div style={{ overflowX: "auto" }}>
      {/* Region filter */}
      {regionList.length > 1 && (
        <div style={{ display: "flex", gap: "0.35rem", flexWrap: "wrap", marginBottom: "0.75rem" }}>
          <button onClick={() => setRegionFilter(null)}
            style={{ padding: "0.25rem 0.7rem", borderRadius: "5px", border: `1px solid ${!regionFilter ? "#d97706" : "var(--border)"}`, background: !regionFilter ? "#d9770618" : "transparent", color: !regionFilter ? "#d97706" : `var(--text-dim)`, fontFamily: "monospace", fontSize: "1rem", cursor: "pointer", fontWeight: !regionFilter ? 700 : 400 }}>
            All Regions ({agentRollups.length})
          </button>
          {regionList.map(r => {
            const active = regionFilter === r.name;
            const regGph = r.hours > 0 ? r.goals / r.hours : 0;
            return (
              <button key={r.name} onClick={() => setRegionFilter(active ? null : r.name)}
                style={{ padding: "0.25rem 0.7rem", borderRadius: "5px", border: `1px solid ${active ? "#6366f1" : "var(--border)"}`, background: active ? "#6366f118" : "transparent", color: active ? "#6366f1" : `var(--text-dim)`, fontFamily: "monospace", fontSize: "1rem", cursor: "pointer", fontWeight: active ? 700 : 400 }}>
                {r.name} <span style={{ opacity: 0.5, fontSize: "0.9rem" }}>{r.count} · {regGph.toFixed(3)}</span>
              </button>
            );
          })}
        </div>
      )}
      <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "monospace", fontSize: "1.08rem" }}>
        <thead>
          <tr style={{ borderBottom: "2px solid var(--border)" }}>
            <th style={{ padding: "0.5rem 0.75rem", color: `var(--text-dim)`, fontWeight: 400 }}>Q</th>
            <Th k="agentName"  label="Agent"      />
            <Th k="region"     label="Region"     />
            <Th k="supervisor" label="Supervisor" />
            <Th k="hours"      label="Hours"   right />
            <Th k="goals"      label="Goals"   right />
            <Th k="gph"        label="GPH"     right />
            <Th k="pctToGoal"  label="% to Goal" right />
            <Th k="newXI"      label="HSD"     right />
            <Th k="xmLines"    label="XM Lines" right />
            <Th k="rgu"        label="RGU"     right />
            <th style={{ padding: "0.5rem 0.75rem", color: `var(--text-dim)`, fontWeight: 400 }}>Flags</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((a, i) => {
            const isNew = newHireSet.has(a.agentName);
            const color = Q[a.quartile]?.color || `var(--text-secondary)`;
            return (
              <tr key={a.agentName} style={{ borderBottom: "1px solid var(--bg-tertiary)", background: i % 2 === 0 ? "transparent" : `var(--bg-row-alt)` }}>
                <td style={{ padding: "0.5rem 0.75rem" }}><QBadge q={a.quartile} /></td>
                <td style={{ padding: "0.5rem 0.75rem", color: `var(--text-warm)`, fontFamily: "Georgia, serif", fontSize: "1.2rem" }}>{a.agentName}</td>
                <td style={{ padding: "0.5rem 0.75rem", color: `var(--text-secondary)` }}>{a.region}</td>
                <td style={{ padding: "0.5rem 0.75rem", color: `var(--text-muted)`, fontSize: "1.14rem" }}>{a.supervisor || "—"}</td>
                <td style={{ padding: "0.5rem 0.75rem", color: a.hours >= 16 ? "#6366f1" : `var(--text-secondary)`, textAlign: "right" }}>{fmt(a.hours, 1)}</td>
                <td style={{ padding: "0.5rem 0.75rem", color: `var(--text-secondary)`, textAlign: "right" }}>{a.goals}</td>
                <td style={{ padding: "0.5rem 0.75rem", color, fontWeight: 600, textAlign: "right" }}>{a.gph.toFixed(3)}</td>
                <td style={{ padding: "0.5rem 0.75rem", color, fontWeight: 700, textAlign: "right" }}>{a.pctToGoal > 0 ? `${Math.round(a.pctToGoal)}%` : "—"}</td>
                <td style={{ padding: "0.5rem 0.75rem", color: a.newXI > 0 ? `var(--text-secondary)` : `var(--text-faint)`, textAlign: "right" }}>{a.newXI || "—"}</td>
                <td style={{ padding: "0.5rem 0.75rem", color: a.xmLines > 0 ? `var(--text-secondary)` : `var(--text-faint)`, textAlign: "right" }}>{a.xmLines || "—"}</td>
                <td style={{ padding: "0.5rem 0.75rem", color: a.rgu > 0 ? `var(--text-secondary)` : `var(--text-faint)`, textAlign: "right" }}>{a.rgu || "—"}</td>
                <td style={{ padding: "0.5rem 0.75rem", whiteSpace: "nowrap" }}>
                  {isNew && <span style={{ background: "#d9770620", color: "#d97706", border: "1px solid #d9770640", borderRadius: "3px", padding: "0.1rem 0.4rem", fontSize: "1.14rem" }}>NEW HIRE</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div style={{ fontFamily: "monospace", fontSize: "1.11rem", color: `var(--text-faint)`, padding: "0.5rem 0.75rem" }}>
        {sorted.length} agents{regionFilter ? ` · ${regionFilter}` : ""} · hours and goals summed across all working days
      </div>
    </div>
  );
}

// RegionComparePanel — receives pre-built RegionStat[] from engine
function RegionComparePanel({ regionStats, agents = [] }) {
  if (regionStats.length < 2) {
    return (
      <div style={{ background: `var(--bg-secondary)`, border: "1px solid var(--border)", borderRadius: "12px", padding: "1.5rem" }}>
        <div style={{ fontFamily: "monospace", fontSize: "1.14rem", color: `var(--text-muted)`, letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: "0.75rem" }}>Region Breakdown</div>
        {regionStats.length === 1 && (
          <div style={{ display: "flex", gap: "1.5rem", fontFamily: "monospace", fontSize: "1.05rem", color: `var(--text-muted)` }}>
            <span>{regionStats[0].name}</span>
            <span>{regionStats[0].count} agents</span>
            <span>{fmt(regionStats[0].totalHours, 0)} hrs total</span>
            <span>{fmtPct(regionStats[0].avgPct)} avg to goal</span>
          </div>
        )}
        {regionStats.length === 0 && <div style={{ color: `var(--text-dim)`, fontFamily: "Georgia, serif", fontSize: "1.27rem" }}>No region data found.</div>}
      </div>
    );
  }

  const best     = regionStats[0];
  const worst    = regionStats[regionStats.length - 1];
  const variance = (best.avgPct - worst.avgPct).toFixed(1);
  const maxPct   = Math.max(...regionStats.map(r => r.avgPct));
  const maxHours = Math.max(...regionStats.map(r => r.totalHours));

  return (
    <div style={{ background: `var(--bg-secondary)`, border: "1px solid var(--border)", borderRadius: "12px", padding: "1.5rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "1.25rem" }}>
        <div style={{ fontFamily: "monospace", fontSize: "1.14rem", color: "#d97706", letterSpacing: "0.12em", textTransform: "uppercase" }}>Regional Variance Analysis</div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontFamily: "monospace", fontSize: "1.08rem", color: parseFloat(variance) > 20 ? "#dc2626" : parseFloat(variance) > 10 ? "#d97706" : "#16a34a" }}>
            {variance}% spread
          </div>
          <div style={{ fontFamily: "monospace", fontSize: "1.14rem", color: `var(--text-dim)` }}>{regionStats.length} regions</div>
        </div>
      </div>

      {parseFloat(variance) > 15 && (
        <div style={{ background: "#d9770610", border: "1px solid #d9770630", borderRadius: "8px", padding: "0.75rem 1rem", marginBottom: "1.25rem", fontFamily: "Georgia, serif", fontSize: "1.17rem", color: "#fde68a", lineHeight: 1.5 }}>
          {variance}% variance between {best.name} ({fmtPct(best.avgPct)}) and {worst.name} ({fmtPct(worst.avgPct)}). Regional coaching alignment is recommended.
        </div>
      )}

      {regionStats.map((r, i) => {
        const barW      = maxPct > 0 ? (r.avgPct / maxPct) * 100 : 0;
        const hoursBarW = maxHours > 0 ? (r.totalHours / maxHours) * 100 : 0;
        const qColor    = r.avgPct >= 100 ? Q.Q1.color : r.avgPct >= 80 ? Q.Q2.color : r.avgPct > 0 ? Q.Q3.color : Q.Q4.color;
        const isTop     = i === 0;
        const delta     = (r.avgPct - best.avgPct).toFixed(1);
        const over16    = agents.filter(a => a.region === r.name && a.hours > 16).length;
        return (
          <div key={r.name} style={{ marginBottom: "1rem", padding: "0.9rem 1rem", background: isTop ? "#ffffff05" : "transparent", border: isTop ? "1px solid #ffffff0a" : "1px solid transparent", borderRadius: "8px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
                {isTop && <span style={{ fontFamily: "monospace", fontSize: "1.08rem", color: "#d97706", background: "#d9770620", padding: "0.1rem 0.4rem", borderRadius: "3px" }}>BEST</span>}
                <span style={{ color: `var(--text-primary)`, fontFamily: "Georgia, serif", fontSize: "1.32rem" }}>{r.name}</span>
                <span style={{ fontFamily: "monospace", fontSize: "1.08rem", color: `var(--text-muted)` }}>{r.count} agents</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                {i > 0 && <span style={{ fontFamily: "monospace", fontSize: "1.08rem", color: "#dc2626" }}>{delta}%</span>}
                <span style={{ fontFamily: "'Cormorant Garamond', Georgia, serif", fontSize: "1.95rem", color: qColor, fontWeight: 700 }}>{fmtPct(r.avgPct)}</span>
              </div>
            </div>
            <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", marginBottom: "0.4rem" }}>
              <div style={{ width: "5rem", fontFamily: "monospace", fontSize: "1.14rem", color: `var(--text-dim)`, textAlign: "right", flexShrink: 0 }}>% to goal</div>
              <div style={{ flex: 1, background: `var(--bg-tertiary)`, borderRadius: "4px", height: "5px", overflow: "hidden" }}>
                <div style={{ width: `${barW}%`, height: "100%", background: qColor, borderRadius: "4px", transition: "width 0.7s ease" }} />
              </div>
            </div>
            <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", marginBottom: "0.5rem" }}>
              <div style={{ width: "5rem", fontFamily: "monospace", fontSize: "1.14rem", color: `var(--text-dim)`, textAlign: "right", flexShrink: 0 }}>hours</div>
              <div style={{ flex: 1, background: `var(--bg-tertiary)`, borderRadius: "4px", height: "5px", overflow: "hidden" }}>
                <div style={{ width: `${hoursBarW}%`, height: "100%", background: "#6366f1", borderRadius: "4px", transition: "width 0.7s ease" }} />
              </div>
            </div>
            <div style={{ display: "flex", gap: "1.25rem", paddingLeft: "5.5rem" }}>
              <span style={{ fontFamily: "monospace", fontSize: "1.17rem", color: `var(--text-muted)` }}>GPH {fmt(r.avgGPH, 2)}</span>
              <span style={{ fontFamily: "monospace", fontSize: "1.17rem", color: `var(--text-muted)` }}>{fmt(r.totalHours, 0)} hrs</span>
              <span style={{ fontFamily: "monospace", fontSize: "1.17rem", color: Q.Q1.color }}>Q1: {r.q1Count}</span>
              <span style={{ fontFamily: "monospace", fontSize: "1.17rem", color: Q.Q2.color }}>Q2: {r.q2Count}</span>
              <span style={{ fontFamily: "monospace", fontSize: "1.17rem", color: Q.Q3.color }}>Q3: {r.q3Count}</span>
              <span style={{ fontFamily: "monospace", fontSize: "1.17rem", color: Q.Q4.color }}>Q4: {r.q4Count}</span>
              {over16 > 0 && <span style={{ fontFamily: "monospace", fontSize: "1.17rem", color: "#6366f1" }}>{over16} over 16hr</span>}
            </div>
          </div>
        );
      })}
    </div>
  );
}


// ── GainsharePanel ────────────────────────────────────────────────────────────
// Shows Mobile, HSD, and Cost Per gainshare tiers with current tier highlighted.
// Pass fiscalInfo + raw actual/plan per column to unlock the PACING toggle,
// which projects EOM attainment and highlights the projected tier in amber.
function GainsharePanel({
  mobileAttain, hsdAttain, costPerAttain, siteMode = false,
  fiscalInfo,
  mobileActual, mobilePlan,
  hsdActual, hsdPlan,
  costPerActual, costPerPlan,
}) {
  const [showPacing, setShowPacing] = useState(false);

  const mobileTier    = getGainshareTier(mobileAttain, siteMode);
  const hsdTier       = getGainshareTier(hsdAttain, siteMode);
  const costPerTier   = getGainshareTier(costPerAttain, siteMode);
  const TIERS         = siteMode ? GAINSHARE_SITE_TIERS : GAINSHARE_TIERS;

  const totalBonus = (mobileTier?.mobile ?? 0) + (hsdTier?.hsd ?? 0) + (costPerTier?.costPer ?? 0);
  const bonusAvailable = mobileAttain !== null || hsdAttain !== null || costPerAttain !== null;
  if (!bonusAvailable) return null;

  // Compute pacing projections when fiscalInfo + raw numbers are available
  const canPace = !!(fiscalInfo && fiscalInfo.elapsedBDays > 0);
  const pMobile  = canPace && mobilePlan   ? calcPacing(mobileActual,  mobilePlan,  fiscalInfo.elapsedBDays, fiscalInfo.totalBDays) : null;
  const pHsd     = canPace && hsdPlan      ? calcPacing(hsdActual,     hsdPlan,     fiscalInfo.elapsedBDays, fiscalInfo.totalBDays) : null;
  const pCostPer = canPace && costPerPlan  ? calcPacing(costPerActual, costPerPlan, fiscalInfo.elapsedBDays, fiscalInfo.totalBDays) : null;

  const projMobilePct  = pMobile  ? pMobile.projectedPct  : null;
  const projHsdPct     = pHsd     ? pHsd.projectedPct     : null;
  const projCostPerPct = pCostPer ? pCostPer.projectedPct : null;

  const projMobileTier  = projMobilePct  !== null ? getGainshareTier(projMobilePct,  siteMode) : null;
  const projHsdTier     = projHsdPct     !== null ? getGainshareTier(projHsdPct,     siteMode) : null;
  const projCostPerTier = projCostPerPct !== null ? getGainshareTier(projCostPerPct, siteMode) : null;

  const projTotalBonus = showPacing
    ? ((projMobileTier?.mobile ?? mobileTier?.mobile ?? 0) +
       (projHsdTier?.hsd       ?? hsdTier?.hsd       ?? 0) +
       (projCostPerTier?.costPer ?? costPerTier?.costPer ?? 0))
    : totalBonus;

  const ColDef = ({ label, attain, tierKey, tier, projAttain, projTier }) => (
    <div style={{ flex: 1 }}>
      <div style={{ fontFamily: "monospace", fontSize: "1.17rem", color: `var(--text-muted)`, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "0.5rem", textAlign: "center" }}>{label}</div>

      {/* Current attainment (always shown) */}
      {attain !== null && (
        <div style={{ textAlign: "center", marginBottom: showPacing && projAttain !== null ? "0.2rem" : "0.5rem" }}>
          <span style={{ fontFamily: "'Cormorant Garamond', Georgia, serif", fontSize: "1.8rem", color: attainColor(attain), fontWeight: 700 }}>{Math.round(attain)}%</span>
          <span style={{ fontFamily: "monospace", fontSize: "1.02rem", color: `var(--text-dim)`, marginLeft: "0.3rem" }}>to date</span>
        </div>
      )}

      {/* Projected attainment (pacing mode only) */}
      {showPacing && projAttain !== null && (
        <div style={{ textAlign: "center", marginBottom: "0.5rem", padding: "0.2rem 0.4rem", background: "#d9770615", borderRadius: "4px", border: "1px dashed #d9770650" }}>
          <span style={{ fontFamily: "'Cormorant Garamond', Georgia, serif", fontSize: "1.65rem", color: "#d97706", fontWeight: 700 }}>{Math.round(projAttain)}%</span>
          <span style={{ fontFamily: "monospace", fontSize: "0.93rem", color: "#d97706aa", marginLeft: "0.3rem" }}>proj. EOM</span>
        </div>
      )}

      {TIERS.map((t, i) => {
        const isActive    = tier === t;
        const isProjected = showPacing && projTier && projTier === t && projTier !== tier;
        const isBoth      = showPacing && projTier && projTier === t && projTier === tier;
        const val  = t[tierKey];
        const sign = val > 0 ? "+" : "";

        let bg, border;
        if (isBoth) {
          bg     = val > 0 ? "#16a34a28" : val < 0 ? "#dc262628" : "var(--text-faint)22";
          border = `1px solid ${val > 0 ? "#16a34a70" : val < 0 ? "#dc262670" : "var(--text-faint)70"}`;
        } else if (isActive) {
          bg     = val > 0 ? "#16a34a22" : val < 0 ? "#dc262622" : "var(--text-faint)22";
          border = `1px solid ${val > 0 ? "#16a34a55" : val < 0 ? "#dc262655" : "var(--text-faint)55"}`;
        } else if (isProjected) {
          bg     = "#d9770618";
          border = "1px dashed #d9770660";
        } else {
          bg = "transparent"; border = "1px solid transparent";
        }

        return (
          <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center",
            padding: "0.2rem 0.5rem", borderRadius: "4px", marginBottom: "1px", background: bg, border }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.35rem" }}>
              <span style={{ fontFamily: "monospace", fontSize: "1.42rem", color: (isActive || isProjected || isBoth) ? `var(--text-primary)` : `var(--text-faint)` }}>{t.label}</span>
              {isProjected && <span style={{ fontFamily: "monospace", fontSize: "0.72rem", color: "#d97706", background: "#d9770622", padding: "0.05rem 0.25rem", borderRadius: "2px" }}>PROJ</span>}
              {isBoth && <span style={{ fontFamily: "monospace", fontSize: "0.72rem", color: "#16a34a", background: "#16a34a22", padding: "0.05rem 0.25rem", borderRadius: "2px" }}>NOW+PROJ</span>}
            </div>
            <span style={{ fontFamily: "monospace", fontSize: (isActive || isProjected || isBoth) ? "1.5rem" : "1.42rem",
              color: (isActive || isBoth) ? bonusColor(val) : isProjected ? "#d97706" : `var(--text-faint)`,
              fontWeight: (isActive || isProjected || isBoth) ? 700 : 400 }}>
              {sign}{val.toFixed(2)}%
            </span>
          </div>
        );
      })}
    </div>
  );

  return (
    <div style={{ background: `var(--bg-secondary)`, border: "1px solid var(--border)", borderRadius: "12px", padding: "1.5rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.25rem", flexWrap: "wrap", gap: "0.5rem" }}>
        <div style={{ fontFamily: "monospace", fontSize: "1.14rem", color: `var(--text-muted)`, letterSpacing: "0.12em", textTransform: "uppercase" }}>
          Gainshare — Telesales
          <span style={{ marginLeft: "0.6rem", color: `var(--text-faint)`, fontSize: "1.14rem" }}>
            {siteMode ? "Site Table" : "Overall Table"}
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
          {canPace && (
            <button onClick={() => setShowPacing(v => !v)}
              style={{ padding: "0.25rem 0.65rem", borderRadius: "5px", border: `1px solid ${showPacing ? "#d97706" : "var(--border)"}`, background: showPacing ? "#d9770618" : "transparent", color: showPacing ? "#d97706" : "var(--text-muted)", fontFamily: "monospace", fontSize: "1.02rem", cursor: "pointer", letterSpacing: "0.05em" }}>
              {showPacing ? "📈 PACING ON" : "📈 PACING"}
            </button>
          )}
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <span style={{ fontFamily: "monospace", fontSize: "1.17rem", color: `var(--text-dim)` }}>
              {showPacing ? "Proj. Bonus:" : "Current Bonus:"}
            </span>
            <span style={{ fontFamily: "'Cormorant Garamond', Georgia, serif", fontSize: "2.25rem", color: bonusColor(projTotalBonus), fontWeight: 700 }}>
              {projTotalBonus > 0 ? "+" : ""}{projTotalBonus.toFixed(2)}%
            </span>
          </div>
        </div>
      </div>
      <div style={{ display: "flex", gap: "1rem" }}>
        {mobileAttain !== null  && <ColDef label="Mobile Attainment"   attain={mobileAttain}  tierKey="mobile"  tier={mobileTier}  projAttain={projMobilePct}  projTier={projMobileTier}  />}
        {hsdAttain !== null     && <ColDef label="HSD Attainment"      attain={hsdAttain}     tierKey="hsd"     tier={hsdTier}     projAttain={projHsdPct}     projTier={projHsdTier}     />}
        {costPerAttain !== null && <ColDef label="Cost Per Attainment" attain={costPerAttain} tierKey="costPer" tier={costPerTier} projAttain={projCostPerPct} projTier={projCostPerTier} />}
      </div>
    </div>
  );
}

// ── FiscalPacingBanner ────────────────────────────────────────────────────────
// Compact banner showing fiscal period progress: days in, days left, total days,
// and an animated progress bar. Matches the "PACING — BUSINESS WIDE" design.
function FiscalPacingBanner({ fiscalInfo, title = "PACING — BUSINESS WIDE" }) {
  if (!fiscalInfo) return null;
  const { fiscalStart, fiscalEnd, lastDataDate, elapsedBDays, remainingBDays, totalBDays, pctElapsed } = fiscalInfo;
  const pct = Math.min(pctElapsed, 100);

  return (
    <div style={{ background: `var(--bg-secondary)`, border: "1px solid var(--border)", borderRadius: "10px", padding: "0.85rem 1.25rem" }}>
      {/* Top row: title + date range + day counters */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "0.65rem" }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <span style={{ fontSize: "1.13rem" }}>📅</span>
            <span style={{ fontFamily: "monospace", fontSize: "1.08rem", color: "#d97706", letterSpacing: "0.15em", textTransform: "uppercase", fontWeight: 700 }}>
              {title}
            </span>
          </div>
          <div style={{ fontFamily: "monospace", fontSize: "0.96rem", color: `var(--text-faint)`, marginTop: "0.2rem" }}>
            Fiscal {fiscalStart} → {fiscalEnd} · data through {lastDataDate}
          </div>
        </div>
        <div style={{ display: "flex", gap: "1.5rem", alignItems: "center" }}>
          {[
            { value: elapsedBDays, label: "Days In",    color: "#d97706" },
            { value: remainingBDays, label: "Days Left", color: "#6366f1" },
            { value: totalBDays,   label: "Total BDays", color: `var(--text-muted)` },
          ].map(({ value, label, color }) => (
            <div key={label} style={{ textAlign: "center" }}>
              <div style={{ fontFamily: "'Cormorant Garamond', Georgia, serif", fontSize: "2.63rem", color, fontWeight: 700, lineHeight: 1 }}>{value}</div>
              <div style={{ fontFamily: "monospace", fontSize: "0.9rem", color: `var(--text-faint)`, marginTop: "0.1rem" }}>{label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Progress bar row */}
      <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
        <span style={{ fontFamily: "monospace", fontSize: "0.96rem", color: `var(--text-faint)`, flexShrink: 0 }}>Month elapsed</span>
        <div style={{ flex: 1, position: "relative", height: "6px", background: `var(--bg-tertiary)`, borderRadius: "4px", overflow: "hidden" }}>
          <div style={{ position: "absolute", left: 0, top: 0, height: "100%", width: `${pct}%`, background: "#d97706", borderRadius: "4px", transition: "width 0.8s ease" }} />
        </div>
        <span style={{ fontFamily: "monospace", fontSize: "0.96rem", color: "#d97706", flexShrink: 0, minWidth: "7rem", textAlign: "right" }}>
          {pct.toFixed(0)}% of fiscal month
        </span>
      </div>
    </div>
  );
}


// ── MetricComparePanel ────────────────────────────────────────────────────────
// Shows key metrics as visual gauge bars: actual vs plan.
// Pass fiscalInfo to unlock an internal PACING toggle that projects EOM inline.
// metrics = [{ label, actual, plan }]
function MetricComparePanel({ metrics, title = "Goals vs Plan", fiscalInfo }) {
  const [showPacing, setShowPacing] = useState(false);

  const hasAny   = metrics.some(m => m.plan > 0);
  if (!hasAny) return null;

  const canPace = !!(fiscalInfo && fiscalInfo.elapsedBDays > 0);
  const cols    = metrics.filter(m => m.plan > 0).length;

  return (
    <div style={{ background: `var(--bg-secondary)`, border: "1px solid var(--border)", borderRadius: "12px", padding: "1.5rem" }}>
      {/* Header row */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.25rem" }}>
        <div style={{ fontFamily: "monospace", fontSize: "1.14rem", color: `var(--text-muted)`, letterSpacing: "0.12em", textTransform: "uppercase" }}>{title}</div>
        {canPace && (
          <button onClick={() => setShowPacing(v => !v)}
            style={{ padding: "0.25rem 0.65rem", borderRadius: "5px", border: `1px solid ${showPacing ? "#d97706" : "var(--border)"}`, background: showPacing ? "#d9770618" : "transparent", color: showPacing ? "#d97706" : "var(--text-muted)", fontFamily: "monospace", fontSize: "1.02rem", cursor: "pointer", letterSpacing: "0.05em" }}>
            {showPacing ? "📈 PACING ON" : "📈 PACING"}
          </button>
        )}
      </div>

      {/* Fiscal pacing strip — only when pacing toggled on */}
      {showPacing && canPace && (
        <FiscalPacingBanner fiscalInfo={fiscalInfo} title={`PACING — ${title.replace(/^Goals vs Plan — ?/i, "").toUpperCase() || "BUSINESS WIDE"}`} />
      )}

      <div style={{ display: "grid", gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: "0.75rem", marginTop: showPacing && canPace ? "1rem" : 0 }}>
        {metrics.map((m, i) => {
          if (!m.plan) return null;
          const attain = m.plan > 0 ? (m.actual / m.plan) * 100 : null;
          const color  = attain !== null ? attainColor(attain) : `var(--text-faint)`;
          const barW   = attain !== null ? Math.min(attain, 100) : 0;
          const overBy = attain !== null && attain > 100 ? attain - 100 : 0;

          // Pacing
          const pace       = showPacing && canPace ? calcPacing(m.actual, m.plan, fiscalInfo.elapsedBDays, fiscalInfo.totalBDays) : null;
          const projColor  = pace ? attainColor(pace.projectedPct) : null;
          const projBarW   = pace ? Math.min((pace.projected / m.plan) * 100, 100) : 0;
          const isAhead    = pace ? pace.delta >= 0 : false;

          return (
            <div key={i} style={{ background: `var(--bg-primary)`, border: `1px solid ${color}25`, borderRadius: "10px", padding: "1rem", borderTop: `3px solid ${color}` }}>
              {/* Label */}
              <div style={{ fontFamily: "monospace", fontSize: "1.17rem", color: `var(--text-muted)`, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "0.6rem" }}>{m.label}</div>

              {/* Actual big number */}
              <div style={{ fontFamily: "'Cormorant Garamond', Georgia, serif", fontSize: "2.85rem", color: `var(--text-warm)`, fontWeight: 700, lineHeight: 1 }}>
                {Math.round(m.actual).toLocaleString()}
              </div>
              <div style={{ fontFamily: "monospace", fontSize: "1.01rem", color: `var(--text-dim)`, marginTop: "0.2rem", marginBottom: "0.5rem" }}>
                of {Math.round(m.plan).toLocaleString()} plan
              </div>

              {/* Current attainment bar */}
              <div style={{ position: "relative", height: "6px", background: `var(--bg-tertiary)`, borderRadius: "4px", overflow: "hidden", marginBottom: "0.35rem" }}>
                <div style={{ position: "absolute", left: 0, top: 0, height: "100%", width: `${barW}%`, background: color, borderRadius: "4px", transition: "width 0.6s ease" }} />
                <div style={{ position: "absolute", left: "calc(100% - 1px)", top: 0, width: "1px", height: "100%", background: `var(--text-faint)` }} />
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: pace ? "0.75rem" : 0 }}>
                <div style={{ fontFamily: "monospace", fontSize: "1.17rem", color, fontWeight: 700 }}>
                  {attain !== null ? `${Math.round(attain)}%` : "—"}
                </div>
                {overBy > 0 && !pace && (
                  <div style={{ fontFamily: "monospace", fontSize: "1.14rem", color: Q.Q1.color }}>+{Math.round(overBy)}% over</div>
                )}
                {pace && (
                  <div style={{ fontFamily: "monospace", fontSize: "0.9rem", color: `var(--text-faint)` }}>to date</div>
                )}
              </div>

              {/* Projected EOM section — only when pacing on */}
              {pace && (
                <div style={{ borderTop: "1px solid var(--bg-tertiary)", paddingTop: "0.6rem" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "0.3rem" }}>
                    <span style={{ fontFamily: "monospace", fontSize: "0.78rem", color: "var(--text-dim)" }}>PROJ. EOM</span>
                    <span style={{ fontFamily: "'Cormorant Garamond', Georgia, serif", fontSize: "2.1rem", color: projColor, fontWeight: 700, lineHeight: 1 }}>
                      {pace.projected.toLocaleString()}
                    </span>
                  </div>
                  {/* Projected bar */}
                  <div style={{ position: "relative", height: "8px", background: `var(--bg-tertiary)`, borderRadius: "4px", overflow: "hidden", marginBottom: "0.35rem" }}>
                    <div style={{ position: "absolute", left: 0, top: 0, height: "100%", width: `${projBarW}%`, background: projColor, borderRadius: "4px", transition: "width 0.6s ease" }} />
                    <div style={{ position: "absolute", left: "calc(100% - 1px)", top: 0, width: "1px", height: "100%", background: `var(--text-faint)` }} />
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
                    <div>
                      <span style={{ fontFamily: "monospace", fontSize: "1.05rem", color: projColor, fontWeight: 700 }}>
                        {Math.round(pace.projectedPct)}% of plan
                      </span>
                      {!isAhead && (
                        <div style={{ fontFamily: "monospace", fontSize: "0.98rem", color: "#dc2626", fontWeight: 700, marginTop: "0.2rem" }}>
                          ▼ -{Math.abs(pace.delta).toLocaleString()}
                        </div>
                      )}
                      {isAhead && (
                        <div style={{ fontFamily: "monospace", fontSize: "0.98rem", color: "#16a34a", fontWeight: 700, marginTop: "0.2rem" }}>
                          ▲ +{Math.abs(pace.delta).toLocaleString()}
                        </div>
                      )}
                    </div>
                    {!isAhead && pace.requiredDaily !== null && (
                      <div style={{ textAlign: "right" }}>
                        <div style={{ fontFamily: "monospace", fontSize: "0.78rem", color: `var(--text-dim)`, marginBottom: "0.1rem" }}>NEED/DAY TO CLOSE</div>
                        <div style={{ fontFamily: "'Cormorant Garamond', Georgia, serif", fontSize: "1.65rem", color: "#dc2626", fontWeight: 700, lineHeight: 1 }}>
                          {Math.ceil(pace.requiredDaily).toLocaleString()}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── PacingPanel ───────────────────────────────────────────────────────────────
// Shows end-of-month projections based on current pace vs plan.
// metrics = [{ label, actual, plan }] — pass null plan to suppress a card.
function PacingPanel({ fiscalInfo, metrics, title = "Pacing Analysis" }) {
  if (!fiscalInfo) return null;
  const { elapsedBDays, remainingBDays, totalBDays, pctElapsed,
          fiscalStart, fiscalEnd, lastDataDate } = fiscalInfo;

  const hasAnyPlan = metrics.some(m => m.plan > 0);
  if (!hasAnyPlan) return null;

  const monthBarW = Math.min(pctElapsed, 100);

  return (
    <div style={{ background: "var(--bg-secondary)", border: "1px solid #d9770640", borderRadius: "12px", padding: "1.5rem", borderLeft: "4px solid #d97706" }}>
      {/* Header row */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "1.25rem", flexWrap: "wrap", gap: "0.75rem" }}>
        <div>
          <div style={{ fontFamily: "monospace", fontSize: "0.98rem", color: "#d97706", letterSpacing: "0.15em", textTransform: "uppercase", marginBottom: "0.25rem" }}>
            📈 {title}
          </div>
          <div style={{ fontFamily: "monospace", fontSize: "0.81rem", color: "var(--text-dim)" }}>
            Fiscal {fiscalStart} → {fiscalEnd} · data through {lastDataDate}
          </div>
        </div>
        <div style={{ display: "flex", gap: "1.5rem" }}>
          {[
            { v: elapsedBDays,   l: "Days In",    c: "#d97706" },
            { v: remainingBDays, l: "Days Left",  c: "#6366f1" },
            { v: totalBDays,     l: "Total BDays",c: "var(--text-dim)" },
          ].map(({ v, l, c }) => (
            <div key={l} style={{ textAlign: "center" }}>
              <div style={{ fontFamily: "'Cormorant Garamond', Georgia, serif", fontSize: "2.4rem", color: c, fontWeight: 700, lineHeight: 1 }}>{v}</div>
              <div style={{ fontFamily: "monospace", fontSize: "0.72rem", color: "var(--text-dim)", marginTop: "0.1rem" }}>{l}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Month progress bar */}
      <div style={{ marginBottom: "1.5rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.3rem" }}>
          <span style={{ fontFamily: "monospace", fontSize: "0.83rem", color: "var(--text-muted)" }}>Month elapsed</span>
          <span style={{ fontFamily: "monospace", fontSize: "0.83rem", color: "#d97706", fontWeight: 700 }}>{Math.round(pctElapsed)}% of fiscal month</span>
        </div>
        <div style={{ height: "8px", background: "var(--bg-tertiary)", borderRadius: "4px", overflow: "hidden" }}>
          <div style={{ width: `${monthBarW}%`, height: "100%", background: "#d97706", borderRadius: "4px", transition: "width 0.6s" }} />
        </div>
      </div>

      {/* Metric pacing cards */}
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${metrics.filter(m => m.plan > 0).length}, 1fr)`, gap: "0.75rem" }}>
        {metrics.map((m, i) => {
          if (!m.plan || m.plan <= 0) return null;
          const p = calcPacing(m.actual, m.plan, elapsedBDays, totalBDays);
          if (!p) return null;
          const color       = attainColor(p.projectedPct);
          const isAhead     = p.delta >= 0;
          const actualBarW  = Math.min((m.actual / m.plan) * 100, 100);
          const projBarW    = Math.min((p.projected / m.plan) * 100, 100);

          return (
            <div key={i} style={{ background: "var(--bg-primary)", border: `1px solid ${color}25`, borderRadius: "10px", padding: "1rem", borderTop: `3px solid ${color}` }}>
              {/* Metric label */}
              <div style={{ fontFamily: "monospace", fontSize: "0.84rem", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "0.75rem" }}>{m.label}</div>

              {/* Actual so far */}
              <div style={{ marginBottom: "0.6rem" }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.2rem" }}>
                  <span style={{ fontFamily: "monospace", fontSize: "0.75rem", color: "var(--text-dim)" }}>Actual · {Math.round(pctElapsed)}% thru</span>
                  <span style={{ fontFamily: "monospace", fontSize: "0.87rem", color: "var(--text-primary)", fontWeight: 600 }}>{Math.round(m.actual).toLocaleString()}</span>
                </div>
                <div style={{ height: "4px", background: "var(--bg-tertiary)", borderRadius: "2px", overflow: "hidden" }}>
                  <div style={{ width: `${actualBarW}%`, height: "100%", background: "var(--text-dim)", borderRadius: "2px" }} />
                </div>
              </div>

              {/* Projected EOM */}
              <div style={{ marginBottom: "0.75rem" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: "0.2rem" }}>
                  <span style={{ fontFamily: "monospace", fontSize: "0.75rem", color: "var(--text-dim)" }}>Proj. end-of-month</span>
                  <span style={{ fontFamily: "'Cormorant Garamond', Georgia, serif", fontSize: "1.95rem", color, fontWeight: 700, lineHeight: 1 }}>{p.projected.toLocaleString()}</span>
                </div>
                <div style={{ height: "6px", background: "var(--bg-tertiary)", borderRadius: "3px", overflow: "hidden" }}>
                  <div style={{ width: `${projBarW}%`, height: "100%", background: color, borderRadius: "3px", transition: "width 0.6s" }} />
                </div>
              </div>

              {/* Bottom stats: % of plan + gap/pace */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", borderTop: `1px solid ${color}22`, paddingTop: "0.5rem" }}>
                <div>
                  <div style={{ fontFamily: "monospace", fontSize: "0.98rem", color, fontWeight: 700 }}>
                    {Math.round(p.projectedPct)}% of plan
                  </div>
                  <div style={{ fontFamily: "monospace", fontSize: "0.78rem", color: isAhead ? "#16a34a" : "#dc2626", marginTop: "0.1rem" }}>
                    {isAhead ? "▲ +" : "▼ "}{Math.abs(p.delta).toLocaleString()} vs plan
                  </div>
                </div>
                <div style={{ textAlign: "right" }}>
                  {!isAhead && p.requiredDaily !== null ? (
                    <>
                      <div style={{ fontFamily: "monospace", fontSize: "0.72rem", color: "var(--text-dim)" }}>need/day to close</div>
                      <div style={{ fontFamily: "monospace", fontSize: "1.05rem", color: "#dc2626", fontWeight: 700 }}>{Math.ceil(p.requiredDaily).toLocaleString()}</div>
                    </>
                  ) : (
                    <>
                      <div style={{ fontFamily: "monospace", fontSize: "0.72rem", color: "var(--text-dim)" }}>pace / day</div>
                      <div style={{ fontFamily: "monospace", fontSize: "1.05rem", color: "#16a34a", fontWeight: 700 }}>{Math.round(p.dailyRate).toLocaleString()}</div>
                    </>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function GoalsRollup({ agents, goalEntries, goalLookup, fiscalInfo }) {
  // Build entries from byTarget (full name) to preserve NAT/HQ distinction
  // Fall back to byTA if byTarget is empty
  const entries = useMemo(() => {
    if (goalEntries && goalEntries.length > 0) {
      // Expand goalEntries: for each entry, check if its rows have distinct _target names
      // If so, split into separate sub-entries
      const expanded = [];
      goalEntries.forEach(entry => {
        const allRows = Object.values(entry.siteMap).flat();
        const targets = [...new Set(allRows.map(r => r._target).filter(Boolean))];
        if (targets.length > 1) {
          // Split by target name
          targets.forEach(t => {
            const subMap = {};
            Object.entries(entry.siteMap).forEach(([site, rows]) => {
              const filtered = rows.filter(r => r._target === t);
              if (filtered.length) subMap[site] = filtered;
            });
            if (Object.keys(subMap).length > 0) {
              const roc = allRows.find(r => r._target === t)?._roc || "";
              const funding = allRows.find(r => r._target === t)?._funding || "";
              expanded.push({ targetAudience: t, siteMap: subMap, roc, funding });
            }
          });
        } else {
          const roc = allRows[0]?._roc || "";
          const funding = allRows[0]?._funding || "";
          expanded.push({ ...entry, roc, funding });
        }
      });
      return expanded;
    }
    if (goalLookup && goalLookup.byTarget) {
      return Object.entries(goalLookup.byTarget).map(([target, siteMap]) => {
        const allRows = Object.values(siteMap).flat();
        return { targetAudience: target, siteMap, roc: allRows[0]?._roc || "", funding: allRows[0]?._funding || "" };
      });
    }
    if (goalLookup) {
      return Object.entries(goalLookup.byTA || {}).map(([ta, siteMap]) => ({ targetAudience: ta, siteMap, roc: "", funding: "" }));
    }
    return [];
  }, [goalEntries, goalLookup]);

  if (entries.length === 0) {
    return (
      <div style={{ background: `var(--bg-secondary)`, border: "1px solid var(--border)", borderRadius: "12px", padding: "2rem", textAlign: "center" }}>
        <div style={{ color: `var(--text-faint)`, fontFamily: "Georgia, serif", fontSize: "1.35rem" }}>No goal data loaded.</div>
        <div style={{ color: `var(--text-faint)`, fontFamily: "monospace", fontSize: "1.11rem", marginTop: "0.4rem" }}>Upload a goals CSV using the ⊕ GOALS button above.</div>
      </div>
    );
  }

  const hasNewXI = agents.some(a => a["New XI"] && a["New XI"] !== "");
  const filteredMetrics = GOAL_METRICS.filter(m => !(m.actualKey === "newXI" && !hasNewXI));

  function planValFromRow(row, metric) {
    if (!row) return 0;
    const p = computePlanRow(row);
    if (metric.goalKey === "HOMES GOAL")       return p.homesGoal;
    if (metric.goalKey === "RGU GOAL")          return p.rguGoal;
    if (metric.goalKey === "HSD Sell In Goal")  return p.hsdGoal;
    if (metric.goalKey === "XM GOAL")           return p.xmGoal;
    if (metric.goalKey === "VIDEO GOAL")        return p.videoGoal;
    if (metric.goalKey === "XH GOAL")           return p.xhGoal;
    if (metric.goalKey === "SPH GOAL")          return p.sphGoal;
    if (metric.goalKey === "Hours Goal")        return p.hoursGoal;
    return parseNum(findCol(row, metric.goalKey, metric.label) || 0);
  }

  function planFromRows(rows, metric) {
    if (!rows || rows.length === 0) return null;
    if (metric.mode === "avg") {
      const vals = rows.map(r => planValFromRow(r, metric)).filter(v => v > 0);
      return vals.length ? vals.reduce((s,v)=>s+v,0)/vals.length : null;
    }
    const total = rows.reduce((s, r) => s + planValFromRow(r, metric), 0);
    return total > 0 ? total : null;
  }

  const ColHeaders = () => (
    <div style={{ display: "grid", gridTemplateColumns: "8rem 1fr 5.5rem 5.5rem 4.5rem", gap: "0.75rem", padding: "0 0 0.4rem 0", borderBottom: "1px solid var(--border)", marginBottom: "0.25rem" }}>
      {["Metric","","Goal","Actual","Attain"].map(h => (
        <div key={h} style={{ fontFamily: "monospace", fontSize: "1.14rem", color: `var(--text-faint)`, textTransform: "uppercase", letterSpacing: "0.08em", textAlign: h === "Metric" || h === "" ? "left" : "right" }}>{h}</div>
      ))}
    </div>
  );

  const MetricRow = ({ metric, planVal, actual }) => {
    const goalNum   = planVal || 0;
    const actualNum = actual !== null ? actual : null;
    const attain    = goalNum > 0 && actualNum !== null ? (actualNum / goalNum) * 100 : null;
    const color     = attain !== null ? attainColor(attain) : `var(--text-faint)`;
    const isNoData  = actual === null;
    return (
      <div style={{ display: "grid", gridTemplateColumns: "8rem 1fr 5.5rem 5.5rem 4.5rem", gap: "0.75rem", alignItems: "center", padding: "0.55rem 0", borderBottom: "1px solid var(--bg-tertiary)" }}>
        <div style={{ fontFamily: "monospace", fontSize: "1.11rem", color: `var(--text-muted)` }}>{metric.label}</div>
        <div style={{ background: `var(--bg-tertiary)`, borderRadius: "3px", height: "5px", overflow: "hidden" }}>
          <div style={{ width: `${Math.min(attain || 0, 100)}%`, height: "100%", background: isNoData ? `var(--border)` : color, borderRadius: "3px", transition: "width 0.5s ease" }} />
        </div>
        <div style={{ fontFamily: "monospace", fontSize: "0.95rem", color: `var(--text-dim)`, textAlign: "right" }}>{goalNum > 0 ? fmtGoal(goalNum, metric.fmt) : "—"}</div>
        <div style={{ fontFamily: "monospace", fontSize: "0.95rem", color: isNoData ? `var(--text-faint)` : `var(--text-primary)`, textAlign: "right", fontStyle: isNoData ? "italic" : "normal" }}>
          {isNoData ? "no data" : fmtGoal(actualNum, metric.fmt)}
        </div>
        <div style={{ fontFamily: "monospace", fontSize: "1.14rem", color, textAlign: "right", fontWeight: 700 }}>
          {attain !== null ? fmtPct(attain) : "—"}
        </div>
      </div>
    );
  };

  // One panel per Target Audience entry
  const TASection = ({ targetAudience, siteMap, roc, funding }) => {
    const drRows = siteMap["DR"] || [];
    const bzRows = siteMap["BZ"] || [];
    const allRows = [...drRows, ...bzRows];

    // Identify DR and BZ region names from agents
    const allRegions = [...new Set(agents.map(a => (a.Region || a.region || "Unknown").trim()))];
    const drRegions  = allRegions.filter(r => !r.toUpperCase().includes("XOTM") && r !== "Unknown");
    const bzRegions  = allRegions.filter(r =>  r.toUpperCase().includes("XOTM"));

    // Global plan for this TA (DR + BZ combined)
    const globalPlan = {};
    filteredMetrics.forEach(m => { globalPlan[m.goalKey] = planFromRows(allRows, m); });

    // Per-site definitions
    // DR gets its own combined row; BZ gets a "Combined (BZ)" row with the full BZ plan
    // when there are multiple BZ sub-sites. Individual BZ sub-sites show actuals only
    // (plan can't be split below BZ level). If only 1 BZ site, it gets the plan directly.
    const SITE_DEFS = [
      ...(drRows.length > 0 && drRegions.length > 0 ? [{ label: drRegions.join(" / "), regions: drRegions, rows: drRows }] : []),
      ...(bzRows.length > 0 && bzRegions.length > 1 ? [{ label: "Combined (BZ)", regions: bzRegions, rows: bzRows }] : []),
      ...(bzRows.length > 0 ? bzRegions.map(r => ({ label: r, regions: [r], rows: bzRegions.length === 1 ? bzRows : null })) : []),
    ];

    return (
      <div style={{ background: `var(--bg-secondary)`, border: "1px solid var(--border)", borderRadius: "12px", padding: "1.5rem", display: "flex", flexDirection: "column", gap: "1.25rem" }}>
        {/* TA header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontFamily: "monospace", fontSize: "1.14rem", color: `var(--text-muted)`, letterSpacing: "0.12em", textTransform: "uppercase" }}>
              Target{funding ? ` \u2014 ${funding}` : ""}
            </div>
            <div style={{ fontFamily: "'Cormorant Garamond', Georgia, serif", fontSize: "2.1rem", color: `var(--text-warm)`, fontWeight: 700, lineHeight: 1.1 }}>
              {targetAudience}
              {roc && <span style={{ fontFamily: "monospace", fontSize: "1rem", color: `var(--text-dim)`, marginLeft: "0.75rem", fontWeight: 400 }}>{roc}</span>}
            </div>
          </div>
          <div style={{ fontFamily: "monospace", fontSize: "1.01rem", color: `var(--text-dim)` }}>
            {agents.length} agents · {fmt(agents.reduce((s,a)=>s+a.hours,0),0)} total hrs
          </div>
        </div>

        {/* Global rollup for this TA */}
        <div>
          <div style={{ fontFamily: "monospace", fontSize: "1.08rem", color: `var(--text-muted)`, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: "0.75rem" }}>All Sites Combined</div>
          <ColHeaders />
          {filteredMetrics.map(m => (
            <MetricRow key={m.goalKey} metric={m} planVal={globalPlan[m.goalKey]} actual={getActual(agents, m.actualKey)} />
          ))}
        </div>

        {/* Per-site breakdown */}
        {SITE_DEFS.length > 1 && (
          <div>
            <div style={{ fontFamily: "monospace", fontSize: "1.08rem", color: `var(--text-muted)`, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: "0.75rem" }}>By Site</div>
            {SITE_DEFS.map(s => {
              const sAgents  = agents.filter(a => s.regions.includes((a.Region || a.region || "Unknown").trim()));
              const hasPlan  = s.rows && s.rows.length > 0;
              const sitePlan = {};
              if (hasPlan) filteredMetrics.forEach(m => { sitePlan[m.goalKey] = planFromRows(s.rows, m); });
              const isBzSub = !hasPlan && bzRegions.includes(s.label);
              return (
                <div key={s.label} style={{ marginBottom: "1.5rem" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "0.6rem" }}>
                    <div style={{ fontFamily: "monospace", fontSize: "1.08rem", color: s.label.includes("Combined") ? "#16a34a" : "#d97706", background: s.label.includes("Combined") ? "#16a34a15" : "#d9770615", border: `1px solid ${s.label.includes("Combined") ? "#16a34a30" : "#d9770630"}`, borderRadius: "4px", padding: "0.15rem 0.5rem" }}>{s.label}</div>
                    <span style={{ fontFamily: "monospace", fontSize: "1.01rem", color: `var(--text-dim)` }}>
                      {sAgents.length} agents · {fmt(sAgents.reduce((a,ag)=>a+ag.hours,0), 0)} hrs
                    </span>
                  </div>
                  <ColHeaders />
                  {filteredMetrics.map(m => (
                    <MetricRow key={m.goalKey} metric={m} planVal={hasPlan ? sitePlan[m.goalKey] : null} actual={getActual(sAgents, m.actualKey)} />
                  ))}
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  // ── Pacing & Projection calculations ──
  const pacingData = useMemo(() => {
    if (!fiscalInfo || !entries.length) return null;
    const { elapsedBDays, remainingBDays, totalBDays, pctElapsed } = fiscalInfo;
    if (!totalBDays || !elapsedBDays) return null;

    const results = entries.map(entry => {
      const allRows = Object.values(entry.siteMap).flat();
      const planHomes = allRows.reduce((s, r) => s + computePlanRow(r).homesGoal, 0);
      const planHours = allRows.reduce((s, r) => s + computePlanRow(r).hoursGoal, 0);
      const planSph = planHours > 0 && planHomes > 0 ? planHomes / planHours : 0;
      const actualHomes = agents.reduce((s, a) => s + a.goals, 0);
      const actualHours = agents.reduce((s, a) => s + a.hours, 0);
      const actualSph = actualHours > 0 ? actualHomes / actualHours : 0;

      const dailyRate = elapsedBDays > 0 ? actualHomes / elapsedBDays : 0;
      const dailyHrsRate = elapsedBDays > 0 ? actualHours / elapsedBDays : 0;
      const projectedHomes = Math.round(dailyRate * totalBDays);
      const projectedHours = Math.round(dailyHrsRate * totalBDays);
      const homesNeeded = Math.max(0, planHomes - actualHomes);
      const reqDailyRate = remainingBDays > 0 ? homesNeeded / remainingBDays : 0;
      const reqSph = remainingBDays > 0 && dailyHrsRate > 0 ? reqDailyRate / dailyHrsRate : 0;
      const gapPct = planHomes > 0 ? ((projectedHomes - planHomes) / planHomes) * 100 : 0;

      // Per-site breakdown
      const drRows = entry.siteMap["DR"] || [];
      const bzRows = entry.siteMap["BZ"] || [];
      const sites = [];
      if (drRows.length) {
        const drAgents = agents.filter(a => !(a.region || "").toUpperCase().includes("XOTM"));
        const drPlanH = drRows.reduce((s, r) => s + computePlanRow(r).homesGoal, 0);
        const drActH = drAgents.reduce((s, a) => s + a.goals, 0);
        const drHrs = drAgents.reduce((s, a) => s + a.hours, 0);
        const drDailyRate = elapsedBDays > 0 ? drActH / elapsedBDays : 0;
        const drProj = Math.round(drDailyRate * totalBDays);
        sites.push({ label: "DR", plan: drPlanH, actual: drActH, projected: drProj, hours: drHrs });
      }
      if (bzRows.length) {
        const bzAgents = agents.filter(a => (a.region || "").toUpperCase().includes("XOTM"));
        const bzPlanH = bzRows.reduce((s, r) => s + computePlanRow(r).homesGoal, 0);
        const bzActH = bzAgents.reduce((s, a) => s + a.goals, 0);
        const bzHrs = bzAgents.reduce((s, a) => s + a.hours, 0);
        const bzDailyRate = elapsedBDays > 0 ? bzActH / elapsedBDays : 0;
        const bzProj = Math.round(bzDailyRate * totalBDays);
        sites.push({ label: "BZ", plan: bzPlanH, actual: bzActH, projected: bzProj, hours: bzHrs });
      }

      return {
        name: entry.targetAudience, roc: entry.roc, funding: entry.funding,
        planHomes, planHours, planSph, actualHomes, actualHours, actualSph,
        projectedHomes, projectedHours, dailyRate, reqDailyRate, reqSph, homesNeeded, gapPct, sites,
        pctElapsed, remainingBDays, elapsedBDays
      };
    });
    return results;
  }, [entries, agents, fiscalInfo]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>

      {/* Pacing Dashboard */}
      {pacingData && pacingData.length > 0 && (
        <div style={{ background: `var(--bg-secondary)`, border: "1px solid var(--border)", borderRadius: "12px", padding: "1.5rem" }}>
          <div style={{ fontFamily: "monospace", fontSize: "1.14rem", color: `var(--text-muted)`, letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: "1rem" }}>
            Pacing & Projections
          </div>

          {pacingData.map(p => {
            const attain = p.planHomes > 0 ? (p.actualHomes / p.planHomes) * 100 : 0;
            const projAttain = p.planHomes > 0 ? (p.projectedHomes / p.planHomes) * 100 : 0;
            const onTrack = projAttain >= 95;
            const atRisk = projAttain < 80;
            const statusColor = onTrack ? "#16a34a" : atRisk ? "#dc2626" : "#d97706";
            const statusLabel = onTrack ? "ON TRACK" : atRisk ? "AT RISK" : "MONITOR";

            return (
              <div key={p.name + p.roc} style={{ marginBottom: "1.5rem" }}>
                {/* Header */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem" }}>
                  <div>
                    <span style={{ fontFamily: "Georgia, serif", fontSize: "1.35rem", color: `var(--text-warm)`, fontWeight: 700 }}>{p.name}</span>
                    {p.roc && <span style={{ fontFamily: "monospace", fontSize: "0.9rem", color: `var(--text-dim)`, marginLeft: "0.5rem" }}>{p.roc}</span>}
                    {p.funding && <span style={{ fontFamily: "monospace", fontSize: "0.85rem", color: `var(--text-faint)`, marginLeft: "0.5rem" }}>({p.funding})</span>}
                  </div>
                  <span style={{ fontFamily: "monospace", fontSize: "0.95rem", color: statusColor, fontWeight: 700, background: statusColor + "15", border: `1px solid ${statusColor}30`, borderRadius: "4px", padding: "0.2rem 0.6rem" }}>{statusLabel}</span>
                </div>

                {/* Progress bar */}
                <div style={{ position: "relative", height: "28px", background: `var(--bg-tertiary)`, borderRadius: "6px", overflow: "hidden", marginBottom: "0.5rem" }}>
                  <div style={{ position: "absolute", left: 0, top: 0, height: "100%", width: `${Math.min(attain, 100)}%`, background: statusColor + "40", borderRadius: "6px", transition: "width 0.5s" }} />
                  <div style={{ position: "absolute", left: `${Math.min(p.pctElapsed, 100)}%`, top: 0, height: "100%", width: "2px", background: `var(--text-faint)` }} />
                  <div style={{ position: "absolute", left: 0, top: 0, height: "100%", display: "flex", alignItems: "center", padding: "0 0.75rem", fontFamily: "monospace", fontSize: "0.9rem", color: `var(--text-warm)`, fontWeight: 700 }}>
                    {Math.round(attain)}% ({p.actualHomes.toLocaleString()} / {p.planHomes.toLocaleString()})
                  </div>
                </div>

                {/* Key metrics grid */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: "0.5rem", marginBottom: "0.75rem" }}>
                  {[
                    { label: "Projected", value: p.projectedHomes.toLocaleString(), sub: `${Math.round(projAttain)}% of plan`, color: statusColor },
                    { label: "Homes Needed", value: p.homesNeeded.toLocaleString(), sub: `${p.remainingBDays} days left`, color: p.homesNeeded > 0 ? "#d97706" : "#16a34a" },
                    { label: "Current Pace", value: `${p.dailyRate.toFixed(1)}/day`, sub: `${p.actualSph.toFixed(3)} SPH`, color: "#6366f1" },
                    { label: "Required Pace", value: `${p.reqDailyRate.toFixed(1)}/day`, sub: p.reqSph > 0 ? `${p.reqSph.toFixed(3)} SPH needed` : "met", color: p.reqDailyRate > p.dailyRate * 1.2 ? "#dc2626" : "#16a34a" },
                    { label: "Gap", value: `${p.gapPct >= 0 ? "+" : ""}${Math.round(p.gapPct)}%`, sub: p.gapPct >= 0 ? "surplus" : "shortfall", color: p.gapPct >= 0 ? "#16a34a" : "#dc2626" },
                  ].map(m => (
                    <div key={m.label} style={{ padding: "0.6rem", borderRadius: "8px", background: m.color + "08", border: `1px solid ${m.color}20` }}>
                      <div style={{ fontFamily: "monospace", fontSize: "0.8rem", color: `var(--text-faint)`, letterSpacing: "0.05em", textTransform: "uppercase" }}>{m.label}</div>
                      <div style={{ fontFamily: "'Cormorant Garamond', Georgia, serif", fontSize: "1.5rem", color: m.color, fontWeight: 700, lineHeight: 1 }}>{m.value}</div>
                      <div style={{ fontFamily: "monospace", fontSize: "0.8rem", color: `var(--text-dim)`, marginTop: "0.15rem" }}>{m.sub}</div>
                    </div>
                  ))}
                </div>

                {/* Per-site pacing */}
                {p.sites.length > 1 && (
                  <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "monospace", fontSize: "0.9rem" }}>
                    <thead><tr style={{ borderBottom: "1px solid var(--border)" }}>
                      {["Site", "Plan", "Actual", "Attain", "Projected", "Proj %", "Gap"].map(h => (
                        <th key={h} style={{ padding: "0.3rem 0.5rem", textAlign: h === "Site" ? "left" : "right", color: `var(--text-faint)`, fontWeight: 600 }}>{h}</th>
                      ))}
                    </tr></thead>
                    <tbody>
                      {p.sites.map(s => {
                        const sAtt = s.plan > 0 ? (s.actual / s.plan) * 100 : 0;
                        const sProjAtt = s.plan > 0 ? (s.projected / s.plan) * 100 : 0;
                        const sGap = s.projected - s.plan;
                        const sColor = sProjAtt >= 95 ? "#16a34a" : sProjAtt < 80 ? "#dc2626" : "#d97706";
                        return (
                          <tr key={s.label} style={{ borderBottom: "1px solid var(--bg-tertiary)" }}>
                            <td style={{ padding: "0.3rem 0.5rem", color: s.label === "BZ" ? "#16a34a" : "#6366f1", fontWeight: 700 }}>{s.label === "BZ" ? "Belize" : s.label}</td>
                            <td style={{ padding: "0.3rem 0.5rem", textAlign: "right", color: `var(--text-dim)` }}>{s.plan.toLocaleString()}</td>
                            <td style={{ padding: "0.3rem 0.5rem", textAlign: "right", color: `var(--text-warm)` }}>{s.actual.toLocaleString()}</td>
                            <td style={{ padding: "0.3rem 0.5rem", textAlign: "right", color: attainColor(sAtt), fontWeight: 700 }}>{Math.round(sAtt)}%</td>
                            <td style={{ padding: "0.3rem 0.5rem", textAlign: "right" }}>{s.projected.toLocaleString()}</td>
                            <td style={{ padding: "0.3rem 0.5rem", textAlign: "right", color: sColor, fontWeight: 700 }}>{Math.round(sProjAtt)}%</td>
                            <td style={{ padding: "0.3rem 0.5rem", textAlign: "right", color: sGap >= 0 ? "#16a34a" : "#dc2626" }}>{sGap >= 0 ? "+" : ""}{sGap}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Existing goal-vs-actual detail sections */}
      {entries.map(({ targetAudience, siteMap, roc, funding }) => (
        <TASection key={targetAudience + (roc||"")} targetAudience={targetAudience} siteMap={siteMap} roc={roc} funding={funding} />
      ))}
    </div>
  );
}


// ══════════════════════════════════════════════════════════════════════════════
// SECTION 11 — DROP ZONE  (pages/DropZone.jsx)
// ══════════════════════════════════════════════════════════════════════════════

function DropZone({ onData, goalsRaw, onGoalsLoad, newHiresRaw, onNewHiresLoad }) {
  const [draggingAgent, setDraggingAgent] = useState(false);
  const [draggingGoals, setDraggingGoals] = useState(false);
  const [draggingNH,    setDraggingNH]    = useState(false);
  const [pasteMode, setPasteMode] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [pasteTarget, setPasteTarget] = useState(null); // "agent" | "goals" | "nh"
  const agentRef = useRef();
  const goalsRef = useRef();
  const nhRef    = useRef();

  const readFile = (f, cb) => { const r = new FileReader(); r.onload = e => cb(parseCSV(e.target.result)); r.readAsText(f); };
  const handlePasteSubmit = () => {
    if (!pasteText.trim()) return;
    const rows = parseCSV(pasteText);
    if (rows.length === 0) return;
    if (pasteTarget === "agent") onData(rows);
    else if (pasteTarget === "goals") onGoalsLoad(rows);
    else if (pasteTarget === "nh") onNewHiresLoad(rows);
    setPasteMode(false); setPasteText(""); setPasteTarget(null);
  };

  const MiniDrop = ({ label, num, icon, color, dragging, onDragOver, onDragLeave, onDrop, onClick, inputRef, onChange, loaded, loadedLabel, hint }) => (
    <div>
      <div style={{ fontFamily: "monospace", fontSize: "1.17rem", color: loaded ? color : `var(--text-muted)`, letterSpacing: "0.15em", textTransform: "uppercase", marginBottom: "0.6rem" }}>
        {num} {label} {!loaded && <span style={{ color: `var(--text-faint)` }}>optional</span>}
        {loaded && <span style={{ marginLeft: "0.5rem", color }}>✓</span>}
      </div>
      <div onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop} onClick={onClick}
        style={{ border: `2px dashed ${loaded ? color+"55" : dragging ? color : `var(--border)`}`, borderRadius: "12px", padding: "2rem 1rem", textAlign: "center", cursor: "pointer", background: loaded ? color+"08" : dragging ? color+"08" : `var(--bg-secondary)`, transition: "all 0.2s ease", minHeight: "130px", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
        <div style={{ fontSize: "2.63rem", marginBottom: "0.6rem" }}>{loaded ? "✅" : icon}</div>
        {loaded
          ? <div style={{ color, fontFamily: "Georgia, serif", fontSize: "1.2rem" }}>{loadedLabel}</div>
          : <div style={{ color: `var(--text-secondary)`, fontFamily: "Georgia, serif", fontSize: "1.2rem" }}>Drop CSV or <span style={{ color }}>browse</span></div>}
        <div style={{ fontFamily: "monospace", fontSize: "0.99rem", color: `var(--text-faint)`, marginTop: "0.35rem" }}>{loaded ? "click to replace" : hint}</div>
        <input ref={inputRef} type="file" accept=".csv" style={{ display: "none" }} onChange={onChange} />
      </div>
    </div>
  );

  return (
    <div style={{ minHeight: "100vh", background: `var(--bg-primary)`, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-start", padding: "3rem 2rem 4rem", overflowY: "auto" }}>
      <div style={{ textAlign: "center", marginBottom: "3rem" }}>
        <div style={{ fontFamily: "monospace", fontSize: "1.14rem", color: "#d97706", letterSpacing: "0.3em", textTransform: "uppercase", marginBottom: "1rem" }}>Campaign Intelligence Suite</div>
        <div style={{ fontFamily: "'Cormorant Garamond', Georgia, serif", fontSize: "6rem", fontWeight: 700, color: `var(--text-warm)`, letterSpacing: "-2px", lineHeight: 0.95 }}>
          Performance<br /><span style={{ color: "#d97706" }}>Insights</span>
        </div>
        <div style={{ color: `var(--text-dim)`, fontFamily: "Georgia, serif", fontSize: "1.23rem", marginTop: "1.25rem" }}>
          Load your files below, then generate your program analysis.
        </div>
      </div>

      <div style={{ width: "100%", maxWidth: "720px", marginBottom: "1.25rem" }}>
        <div style={{ fontFamily: "monospace", fontSize: "1.08rem", color: "#d97706", letterSpacing: "0.15em", textTransform: "uppercase", marginBottom: "0.6rem" }}>
          ① Agent Data <span style={{ color: "#dc2626" }}>required</span>
        </div>
        <div
          onDragOver={e => { e.preventDefault(); setDraggingAgent(true); }}
          onDragLeave={() => setDraggingAgent(false)}
          onDrop={e => { e.preventDefault(); setDraggingAgent(false); readFile(e.dataTransfer.files[0], onData); }}
          onClick={() => agentRef.current.click()}
          style={{ border: `2px dashed ${draggingAgent ? "#d97706" : `var(--border)`}`, borderRadius: "12px", padding: "2.5rem 2rem", textAlign: "center", cursor: "pointer", background: draggingAgent ? "#d9770608" : `var(--bg-secondary)`, transition: "all 0.2s ease" }}>
          <div style={{ fontSize: "3.38rem", marginBottom: "0.75rem" }}>📊</div>
          <div style={{ color: `var(--text-secondary)`, fontFamily: "Georgia, serif", fontSize: "1.35rem" }}>Drop your agent CSV here, or <span style={{ color: "#d97706" }}>click to browse</span></div>
          <div style={{ fontFamily: "monospace", fontSize: "1.08rem", color: `var(--text-faint)`, marginTop: "0.4rem" }}>Job Type · Region · AgentName · Hours · Goals · GPH · % to Goal</div>
          <input ref={agentRef} type="file" accept=".csv" style={{ display: "none" }} onChange={e => readFile(e.target.files[0], onData)} />
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1.25rem", width: "100%", maxWidth: "720px", marginBottom: "2rem" }}>
        <MiniDrop
          label="Goals File" num="②" icon="🎯" color="#16a34a"
          dragging={draggingGoals}
          onDragOver={e => { e.preventDefault(); setDraggingGoals(true); }}
          onDragLeave={() => setDraggingGoals(false)}
          onDrop={e => { e.preventDefault(); setDraggingGoals(false); readFile(e.dataTransfer.files[0], onGoalsLoad); }}
          onClick={() => goalsRef.current.click()}
          inputRef={goalsRef}
          onChange={e => readFile(e.target.files[0], onGoalsLoad)}
          loaded={!!goalsRaw}
          loadedLabel={`${goalsRaw?.length || 0} rows · saved locally · click to replace`}
          hint="Unlocks Goals tab per program"
        />
        <MiniDrop
          label="Roster CSV" num="③" icon="🌱" color="#d97706"
          dragging={draggingNH}
          onDragOver={e => { e.preventDefault(); setDraggingNH(true); }}
          onDragLeave={() => setDraggingNH(false)}
          onDrop={e => { e.preventDefault(); setDraggingNH(false); readFile(e.dataTransfer.files[0], onNewHiresLoad); }}
          onClick={() => nhRef.current.click()}
          inputRef={nhRef}
          onChange={e => readFile(e.target.files[0], onNewHiresLoad)}
          loaded={!!newHiresRaw}
          loadedLabel={`${newHiresRaw?.length || 0} rows · roster saved`}
          hint="Columns: First Name, Last Name, Hire Date, End Date"
        />
      </div>

      {!newHiresRaw && (
        <div style={{ width: "100%", maxWidth: "720px", background: `var(--bg-secondary)`, border: "1px solid var(--border)", borderRadius: "8px", padding: "0.85rem 1.25rem", marginBottom: "2rem", display: "flex", gap: "1rem", alignItems: "center" }}>
          <span style={{ fontFamily: "monospace", fontSize: "1.17rem", color: `var(--text-dim)` }}>ROSTER FORMAT →</span>
          <code style={{ fontFamily: "monospace", fontSize: "1.14rem", color: `var(--text-muted)` }}>First Name, Last Name, Hire Date, End Date</code>
          <code style={{ fontFamily: "monospace", fontSize: "1.14rem", color: `var(--text-faint)` }}>Agents hired within 180 days auto-flagged as new hires</code>
        </div>
      )}

      {/* Mobile paste modal */}
      {pasteMode && (
        <div style={{ position: "fixed", inset: 0, zIndex: 999, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem" }}
          onClick={e => { if (e.target === e.currentTarget) { setPasteMode(false); setPasteTarget(null); } }}>
          <div style={{ background: `var(--bg-primary)`, border: "1px solid var(--border)", borderRadius: "12px", padding: "1.5rem", width: "100%", maxWidth: "600px", maxHeight: "80vh", display: "flex", flexDirection: "column" }}>
            <div style={{ fontFamily: "monospace", fontSize: "1.08rem", color: "#d97706", letterSpacing: "0.1em", marginBottom: "0.75rem" }}>
              PASTE {pasteTarget === "agent" ? "AGENT DATA" : pasteTarget === "goals" ? "GOALS" : "ROSTER"} CSV
            </div>
            <div style={{ fontFamily: "monospace", fontSize: "0.9rem", color: `var(--text-dim)`, marginBottom: "0.5rem" }}>
              Open the CSV file, Select All, Copy, then paste below
            </div>
            <textarea value={pasteText} onChange={e => setPasteText(e.target.value)}
              placeholder="Paste CSV content here..."
              style={{ flex: 1, minHeight: "200px", fontFamily: "monospace", fontSize: "0.9rem", background: `var(--bg-secondary)`, color: `var(--text-primary)`, border: "1px solid var(--border)", borderRadius: "8px", padding: "0.75rem", resize: "vertical" }} />
            <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.75rem", justifyContent: "flex-end" }}>
              <button onClick={() => { setPasteMode(false); setPasteTarget(null); setPasteText(""); }}
                style={{ padding: "0.4rem 1rem", borderRadius: "6px", border: "1px solid var(--border)", background: "transparent", color: `var(--text-muted)`, fontFamily: "monospace", fontSize: "1rem", cursor: "pointer" }}>Cancel</button>
              <button onClick={handlePasteSubmit}
                style={{ padding: "0.4rem 1rem", borderRadius: "6px", border: "1px solid #d97706", background: "#d9770618", color: "#d97706", fontFamily: "monospace", fontSize: "1rem", cursor: "pointer", fontWeight: 600 }}>Load Data</button>
            </div>
          </div>
        </div>
      )}

      {/* Mobile helper: paste buttons below the main drop zones */}
      <div style={{ width: "100%", maxWidth: "720px", display: "flex", gap: "0.5rem", flexWrap: "wrap", marginBottom: "1.25rem", justifyContent: "center" }}>
        <div style={{ fontFamily: "monospace", fontSize: "0.88rem", color: `var(--text-faint)`, width: "100%", textAlign: "center", marginBottom: "0.25rem" }}>On mobile? Paste CSV text instead</div>
        <button onClick={() => { setPasteTarget("agent"); setPasteMode(true); }}
          style={{ padding: "0.35rem 0.8rem", borderRadius: "5px", border: "1px solid #d97706", background: "transparent", color: "#d97706", fontFamily: "monospace", fontSize: "0.95rem", cursor: "pointer" }}>
          Paste Agent Data
        </button>
        <button onClick={() => { setPasteTarget("goals"); setPasteMode(true); }}
          style={{ padding: "0.35rem 0.8rem", borderRadius: "5px", border: "1px solid #16a34a", background: "transparent", color: "#16a34a", fontFamily: "monospace", fontSize: "0.95rem", cursor: "pointer" }}>
          Paste Goals
        </button>
        <button onClick={() => { setPasteTarget("nh"); setPasteMode(true); }}
          style={{ padding: "0.35rem 0.8rem", borderRadius: "5px", border: "1px solid #6366f1", background: "transparent", color: "#6366f1", fontFamily: "monospace", fontSize: "0.95rem", cursor: "pointer" }}>
          Paste Roster
        </button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "0.75rem", maxWidth: "720px", width: "100%" }}>
        {[
          ["Job Type", "One slide per program"],
          ["Region",   "SD-Xfinity · BZ sites"],
          ["% to Goal","Quartile ranking engine"],
          ["AgentName · Hours","Agent-level detail & flags"],
          ["Goals · GPH","Conversion metrics"],
          ["New XI · XM Lines","Optional sub-metrics"],
        ].map(([title, desc]) => (
          <div key={title} style={{ background: `var(--bg-secondary)`, border: "1px solid var(--border)", borderRadius: "8px", padding: "0.75rem 1rem" }}>
            <div style={{ fontFamily: "monospace", fontSize: "0.99rem", color: "#d97706", letterSpacing: "0.08em", marginBottom: "0.25rem" }}>{title}</div>
            <div style={{ color: `var(--text-muted)`, fontSize: "1.17rem", fontFamily: "Georgia, serif" }}>{desc}</div>
          </div>
        ))}
      </div>
    </div>
  );
}


// ══════════════════════════════════════════════════════════════════════════════
// SECTION 12a — SITE DRILLDOWN  (pages/SiteDrilldown.jsx)
// Shows all programs for a single region/site, like a mini-overview.
// ══════════════════════════════════════════════════════════════════════════════

function SiteDrilldown({ siteLabel, regions, allAgents, programs, goalLookup, newHireSet, fiscalInfo }) {
  const [subRegion, setSubRegion] = useState(null);
  const [siteRankSort, setSiteRankSort] = useState({ key: "pctToGoal", dir: -1 });
  const [dtFundingFilter, setDtFundingFilter] = useState(null);
  const hasMultipleRegions = regions.length > 1;

  const activeRegions = (subRegion && hasMultipleRegions) ? [subRegion] : regions;
  const agents   = allAgents.filter(a => !a.isSpanishCallback && activeRegions.includes((a.Region || a.region || "Unknown").trim()));
  const totalHrs = agents.reduce((s, a) => s + a.hours, 0);
  const distU    = uniqueQuartileDist(agents);
  const uCount   = uniqueNames(agents).size;
  const q1Rate   = uCount > 0 ? ((distU.Q1 / uCount) * 100).toFixed(1) : "0.0";
  const totalG   = agents.reduce((s, a) => s + a.goals, 0);
  const gph      = totalHrs > 0 ? totalG / totalHrs : 0;

  // Map display label → goals CSV site key ("DR" or "BZ")
  // BZ group contains XOTM regions; DR is everything else
  const sitePlanKey = regions.some(r => r.toUpperCase().includes("XOTM")) ? "BZ" : "DR";
  const sitePlanMetrics = useMemo(() => {
    if (!goalLookup) return null;
    let goals = 0, rgu = 0, hsd = 0, xm = 0, hours = 0;
    Object.values(goalLookup.byTA || {}).forEach(siteMap => {
      const rows = siteMap[sitePlanKey] || [];
      rows.forEach(r => {
        const p = computePlanRow(r);
        goals += p.homesGoal;
        rgu   += p.rguGoal;
        hsd   += p.hsdGoal;
        xm    += p.xmGoal;
        hours += p.hoursGoal;
      });
    });
    return goals > 0 ? { goals, rgu, hsd, xm, hours } : null;
  }, [goalLookup, sitePlanKey]);

  // Site-level actuals
  const siteActRgu = agents.reduce((s, a) => s + a.rgu,    0);
  const siteActHsd = agents.reduce((s, a) => s + a.newXI,  0);
  const siteActXm  = agents.reduce((s, a) => s + a.xmLines, 0);

  // Gainshare attainments for the site (site-tier table)
  const siteMobileAttain  = sitePlanMetrics && sitePlanMetrics.goals > 0 ? (totalG       / sitePlanMetrics.goals) * 100 : null;
  const siteHsdAttain     = sitePlanMetrics && sitePlanMetrics.hsd   > 0 ? (siteActHsd   / sitePlanMetrics.hsd)   * 100 : null;
  const siteCostPerAttain = sitePlanMetrics && sitePlanMetrics.rgu   > 0 ? (siteActRgu   / sitePlanMetrics.rgu)   * 100 : null;

  const regionStats = regions.map(r => {
    const ra = allAgents.filter(a => (a.Region || a.region || "Unknown").trim() === r);
    const rg = ra.reduce((s, a) => s + a.goals, 0);
    const rh = ra.reduce((s, a) => s + a.hours, 0);
    const rd = uniqueQuartileDist(ra);
    const ru = uniqueNames(ra).size;
    return { name: r, agents: ra, goals: rg, hours: rh, dist: rd, unique: ru, gph: rh > 0 ? rg / rh : 0 };
  });

  const sitePrograms = programs.map(p => {
    const pa = p.agents.filter(a => activeRegions.includes((a.Region || a.region || "Unknown").trim()));
    if (!pa.length) return null;
    const totalGoals = pa.reduce((s, a) => s + a.goals, 0);
    const totalHours = pa.reduce((s, a) => s + a.hours, 0);
    const distUn     = uniqueQuartileDist(pa);
    const uNames     = uniqueNames(pa).size;
    const siteGph    = totalHours > 0 ? totalGoals / totalHours : 0;

    // Use site-specific plan rows only (DR or BZ), not the combined program plan
    const siteRows   = p.goalEntry ? (p.goalEntry[sitePlanKey] || []) : [];
    const sitePlanGoals = siteRows.reduce((s, r) => s + computePlanRow(r).homesGoal, 0) || null;
    const sitePlanRgu   = siteRows.reduce((s, r) => s + computePlanRow(r).rguGoal,   0) || null;
    const sitePlanHsd   = siteRows.reduce((s, r) => s + computePlanRow(r).hsdGoal,   0) || null;
    const sitePlanXm    = siteRows.reduce((s, r) => s + computePlanRow(r).xmGoal,    0) || null;
    const sitePlanHours = siteRows.reduce((s, r) => s + computePlanRow(r).hoursGoal, 0) || null;

    // Breakout by Target/ROC within this site (preserves NAT vs HQ)
    const goalBreakout = [];
    const targetGroups = {};
    siteRows.forEach(r => {
      const t = r._target || "Unknown";
      if (!targetGroups[t]) targetGroups[t] = { target: t, roc: r._roc || "", funding: r._funding || "", rows: [] };
      targetGroups[t].rows.push(r);
    });
    Object.values(targetGroups).forEach(g => {
      const pr = g.rows.map(r => computePlanRow(r));
      goalBreakout.push({
        target: g.target, roc: g.roc, funding: g.funding,
        homes: pr.reduce((s, p2) => s + p2.homesGoal, 0),
        hours: pr.reduce((s, p2) => s + p2.hoursGoal, 0),
        sph: pr.length > 0 ? pr.reduce((s, p2) => s + p2.sphGoal, 0) / pr.length : 0,
      });
    });

    const attain = sitePlanGoals && sitePlanGoals > 0 ? (totalGoals / sitePlanGoals) * 100 : null;
    const hsdAct = pa.reduce((s, a) => s + a.newXI, 0);
    const hsdAtt = sitePlanHsd && sitePlanHsd > 0  ? (hsdAct / sitePlanHsd) * 100 : null;
    const rguAct = pa.reduce((s, a) => s + a.rgu,   0);
    const cpAtt  = sitePlanRgu && sitePlanRgu > 0  ? (rguAct / sitePlanRgu) * 100 : null;
    const xmAct  = pa.reduce((s, a) => s + a.xmLines, 0);

    return { ...p, siteAgents: pa, totalGoals, totalHours, siteGph, distUn, uNames,
             attain, hsdAtt, cpAtt, sitePlanGoals, sitePlanHsd, sitePlanXm, sitePlanHours, hsdAct, xmAct, goalBreakout };
  }).filter(Boolean);

  const displayLabel = subRegion || siteLabel;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>

      {/* Sub-region tabs — only shown when group has multiple regions */}
      {hasMultipleRegions && (
        <div style={{ background: `var(--bg-secondary)`, border: "1px solid var(--border)", borderRadius: "12px", padding: "1.25rem" }}>
          <div style={{ fontFamily: "monospace", fontSize: "1.17rem", color: `var(--text-muted)`, letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: "0.9rem" }}>Site Breakdown</div>
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginBottom: "1rem" }}>
            <button onClick={() => setSubRegion(null)}
              style={{ padding: "0.35rem 0.9rem", borderRadius: "6px", border: `1px solid ${!subRegion?"#d97706":`var(--border)`}`, background: !subRegion?"#d9770618":"transparent", color: !subRegion?"#d97706":`var(--text-muted)`, fontFamily: "monospace", fontSize: "1.11rem", cursor: "pointer" }}>
              All Combined
            </button>
            {regions.map(r => (
              <button key={r} onClick={() => setSubRegion(r)}
                style={{ padding: "0.35rem 0.9rem", borderRadius: "6px", border: `1px solid ${subRegion===r?"#6366f1":`var(--border)`}`, background: subRegion===r?"#6366f118":"transparent", color: subRegion===r?"#818cf8":`var(--text-muted)`, fontFamily: "monospace", fontSize: "1.11rem", cursor: "pointer" }}>
                {r}
              </button>
            ))}
          </div>
          {/* Mini comparison bars */}
          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            {regionStats.map(r => {
              const maxG = Math.max(...regionStats.map(x => x.goals), 1);
              const barW = (r.goals / maxG) * 100;
              const isActive = !subRegion || subRegion === r.name;
              return (
                <div key={r.name} onClick={() => setSubRegion(subRegion === r.name ? null : r.name)}
                  style={{ cursor: "pointer", padding: "0.6rem 0.75rem", borderRadius: "8px", background: subRegion===r.name?"#6366f115":"transparent", border: `1px solid ${subRegion===r.name?"#6366f140":`var(--bg-tertiary)`}`, opacity: isActive ? 1 : 0.45, transition: "all 0.2s" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.3rem" }}>
                    <span style={{ fontFamily: "Georgia, serif", fontSize: "1.2rem", color: `var(--text-primary)` }}>{r.name}</span>
                    <div style={{ display: "flex", gap: "1rem" }}>
                      <span style={{ fontFamily: "monospace", fontSize: "1.14rem", color: "#16a34a" }}>{r.goals.toLocaleString()} goals</span>
                      <span style={{ fontFamily: "monospace", fontSize: "1.14rem", color: `var(--text-muted)` }}>GPH {fmt(r.gph, 2)}</span>
                      <span style={{ fontFamily: "monospace", fontSize: "1.14rem", color: `var(--text-muted)` }}>{r.unique} agents</span>
                      <span style={{ fontFamily: "monospace", fontSize: "1.14rem", color: Q.Q1.color }}>Q1: {r.dist.Q1}</span>
                      <span style={{ fontFamily: "monospace", fontSize: "1.14rem", color: Q.Q4.color }}>Q4: {r.dist.Q4}</span>
                    </div>
                  </div>
                  <div style={{ display: "flex", height: "4px", background: `var(--bg-tertiary)`, borderRadius: "2px", overflow: "hidden" }}>
                    <div style={{ width: `${barW}%`, background: "#6366f1", borderRadius: "2px", transition: "width 0.5s" }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* KPI strip */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: "0.75rem" }}>
        <StatCard label="Q1 Rate"       value={`${q1Rate}%`}             sub={`${distU.Q1} of ${uCount} agents`}        accent="#d97706" />
        <StatCard label="GPH"           value={fmt(gph, 2)}              sub="sum goals / sum hours"                    accent="#2563eb" />
        <StatCard label="Total Goals"   value={totalG.toLocaleString()}  sub={`${sitePrograms.length} programs`}        accent="#16a34a" />
        <StatCard label="Total Hours"   value={fmt(totalHrs, 0)}         sub={`${agents.length} rows`}                  accent="#6366f1" />
        <StatCard label="Unique Agents" value={uCount}                   sub={`${agents.filter(a=>a.hours>=16).length} at 16+ hrs`} accent="#6366f1" />
      </div>

      {/* Site Executive Summary */}
      <CollapsibleNarrative
        title={`Site Summary \u2014 ${displayLabel}`}
        lines={generateSiteNarrative(displayLabel, agents, programs, goalLookup, fiscalInfo, sitePlanKey)}
        defaultOpen={false}
      />

      {/* Goals vs Plan */}
      {sitePlanMetrics && (
        <MetricComparePanel
          title={`Goals vs Plan — ${displayLabel}`}
          fiscalInfo={fiscalInfo}
          metrics={[
            { label: "Total Hours",   actual: totalHrs,    plan: sitePlanMetrics.hours },
            { label: "Total Goals",   actual: totalG,      plan: sitePlanMetrics.goals },
            { label: "Total RGU",     actual: siteActRgu,  plan: sitePlanMetrics.rgu   },
            { label: "New XI (HSD)",  actual: siteActHsd,  plan: sitePlanMetrics.hsd   },
            { label: "XM Lines",      actual: siteActXm,   plan: sitePlanMetrics.xm    },
          ]}
        />
      )}

      {/* Gainshare — site-level tiers */}
      {sitePlanMetrics && (
        <GainsharePanel
          mobileAttain={siteMobileAttain}
          hsdAttain={siteHsdAttain}
          costPerAttain={siteCostPerAttain}
          siteMode={true}
          fiscalInfo={fiscalInfo}
          mobileActual={totalG}      mobilePlan={sitePlanMetrics?.goals || 0}
          hsdActual={siteActHsd}     hsdPlan={sitePlanMetrics?.hsd || 0}
          costPerActual={siteActRgu} costPerPlan={sitePlanMetrics?.rgu || 0}
        />
      )}

      {/* Supervisor Ranking by % to Goal */}
      {(() => {
        const supMap = {};
        agents.forEach(a => {
          const sup = a.supervisor || "Unknown";
          if (!supMap[sup]) supMap[sup] = { name: sup, hours: 0, goals: 0, agents: {}, newXI: 0, xmLines: 0, programs: new Set(), weekData: {} };
          supMap[sup].hours += a.hours; supMap[sup].goals += a.goals;
          supMap[sup].newXI += a.newXI || 0; supMap[sup].xmLines += a.xmLines || 0;
          if (a.jobType) supMap[sup].programs.add(a.jobType);
          const aName = a.agentName || "";
          if (aName && !supMap[sup].agents[aName]) supMap[sup].agents[aName] = { hours: 0, goals: 0, goalsNum: 0 };
          if (aName) { supMap[sup].agents[aName].hours += a.hours; supMap[sup].agents[aName].goals += a.goals; supMap[sup].agents[aName].goalsNum += a.goalsNum || 0; }
          if (a.weekNum) {
            if (!supMap[sup].weekData[a.weekNum]) supMap[sup].weekData[a.weekNum] = { hours: 0, goals: 0 };
            supMap[sup].weekData[a.weekNum].hours += a.hours; supMap[sup].weekData[a.weekNum].goals += a.goals;
          }
        });

        // Compute site-wide average SPH goal from all programs at this site
        const siteAvgSph = sitePlanMetrics && sitePlanMetrics.goals > 0 && sitePlanMetrics.hours > 0
          ? sitePlanMetrics.goals / sitePlanMetrics.hours : null;

        const sups = Object.values(supMap).filter(s => s.name !== "Unknown").map(s => {
          const uniqueAgents = Object.entries(s.agents);
          const count = uniqueAgents.length;
          let q1 = 0, q2 = 0, q3 = 0, q4 = 0;
          uniqueAgents.forEach(([name, ag]) => {
            const pct = ag.goalsNum > 0 ? (ag.goals / ag.goalsNum) * 100 : (ag.goals > 0 ? 50 : 0);
            if (pct >= 100) q1++; else if (pct >= 75) q2++; else if (pct >= 50) q3++; else q4++;
          });
          s.q1 = q1; s.q2 = q2; s.q3 = q3; s.q4 = q4;
          const gph = s.hours > 0 ? s.goals / s.hours : 0;
          const pctToGoal = siteAvgSph && siteAvgSph > 0 ? (gph / siteAvgSph) * 100 : null;
          const cps = s.goals > 0 ? (s.hours * 19.77) / s.goals : s.hours * 19.77;
          const q1Rate = count > 0 ? (q1 / count) * 100 : 0;
          const wks = Object.keys(s.weekData).sort();
          const weeklyGph = wks.map(w => s.weekData[w].hours > 0 ? s.weekData[w].goals / s.weekData[w].hours : 0);
          const trending = weeklyGph.length >= 2 ? (weeklyGph[weeklyGph.length-1] > weeklyGph[0] ? "up" : weeklyGph[weeklyGph.length-1] < weeklyGph[0] * 0.9 ? "down" : "flat") : null;
          return { ...s, count, gph, pctToGoal, cps, q1Rate, trending, programList: [...s.programs].join(", ") };
        }).sort((a, b) => {
          const va = a[siteRankSort.key] ?? -9999;
          const vb = b[siteRankSort.key] ?? -9999;
          if (typeof va === "string") return va.localeCompare(vb) * siteRankSort.dir;
          return (va - vb) * siteRankSort.dir;
        });

        if (sups.length === 0) return null;

        const toggleSort = k => setSiteRankSort(s => ({ key: k, dir: s.key === k ? -s.dir : -1 }));
        const RkTh = ({ k, label, left }) => (
          <th onClick={() => toggleSort(k)}
            style={{ padding: "0.4rem 0.5rem", textAlign: left ? "left" : "right", color: siteRankSort.key === k ? "#d97706" : `var(--text-faint)`, fontWeight: 600, fontSize: "0.85rem", whiteSpace: "nowrap", cursor: "pointer", userSelect: "none" }}>
            {label} {siteRankSort.key === k ? (siteRankSort.dir === -1 ? "\u2193" : "\u2191") : ""}
          </th>
        );

        const sTotHrs = sups.reduce((s, x) => s + x.hours, 0);
        const sTotGoals = sups.reduce((s, x) => s + x.goals, 0);
        const sTotGph = sTotHrs > 0 ? sTotGoals / sTotHrs : 0;
        const sTotPct = siteAvgSph ? (sTotGph / siteAvgSph) * 100 : null;

        return (
          <div style={{ background: `var(--bg-secondary)`, border: "1px solid var(--border)", borderRadius: "12px", padding: "1.25rem" }}>
            <div style={{ fontFamily: "monospace", fontSize: "1.14rem", color: `var(--text-muted)`, letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: "0.75rem" }}>
              Supervisor Ranking {"\u2014"} {displayLabel} {siteAvgSph ? `\u00b7 Site SPH Goal: ${siteAvgSph.toFixed(3)}` : ""}
            </div>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "monospace", fontSize: "0.92rem" }}>
                <thead><tr style={{ borderBottom: "2px solid var(--border)" }}>
                  <th style={{ padding: "0.4rem 0.5rem", textAlign: "left", color: `var(--text-faint)`, fontWeight: 600, fontSize: "0.85rem" }}>#</th>
                  <RkTh k="name" label="Supervisor" left />
                  <RkTh k="count" label="Agents" />
                  <th style={{ padding: "0.4rem 0.5rem", textAlign: "left", color: `var(--text-faint)`, fontWeight: 600, fontSize: "0.85rem" }}>Programs</th>
                  <RkTh k="hours" label="Hours" />
                  <RkTh k="goals" label="Sales" />
                  <RkTh k="gph" label="GPH" />
                  <RkTh k="pctToGoal" label="% Goal" />
                  <RkTh k="cps" label="CPS" />
                  <RkTh k="q1Rate" label="Q1%" />
                  <RkTh k="q1" label="Q1" />
                  <RkTh k="q2" label="Q2" />
                  <RkTh k="q3" label="Q3" />
                  <RkTh k="q4" label="Q4" />
                  <th style={{ padding: "0.4rem 0.5rem", textAlign: "right", color: `var(--text-faint)`, fontWeight: 600, fontSize: "0.85rem" }}>Trend</th>
                </tr></thead>
                <tbody>
                  {sups.map((s, i) => {
                    const pColor = s.pctToGoal !== null ? attainColor(s.pctToGoal) : `var(--text-dim)`;
                    const isTop = i === 0 && sups.length > 1;
                    return (
                      <tr key={s.name} style={{ borderBottom: "1px solid var(--bg-tertiary)", background: isTop ? "#16a34a08" : i % 2 === 0 ? "transparent" : `var(--bg-row-alt)` }}>
                        <td style={{ padding: "0.35rem 0.5rem", color: isTop ? "#16a34a" : `var(--text-dim)`, fontWeight: 700 }}>{i + 1}</td>
                        <td style={{ padding: "0.35rem 0.5rem", color: `var(--text-warm)`, fontFamily: "Georgia, serif" }}>
                          {s.name}
                          {isTop && <span style={{ marginLeft: "0.4rem", fontSize: "0.75rem", color: "#16a34a", background: "#16a34a15", border: "1px solid #16a34a30", borderRadius: "3px", padding: "0.05rem 0.25rem" }}>TOP</span>}
                        </td>
                        <td style={{ padding: "0.35rem 0.5rem", textAlign: "right", color: `var(--text-dim)` }}>{s.count}</td>
                        <td style={{ padding: "0.35rem 0.5rem", color: `var(--text-dim)`, fontSize: "0.82rem", maxWidth: "130px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={s.programList}>{s.programList}</td>
                        <td style={{ padding: "0.35rem 0.5rem", textAlign: "right", color: "#6366f1" }}>{fmt(s.hours, 1)}</td>
                        <td style={{ padding: "0.35rem 0.5rem", textAlign: "right", color: s.goals > 0 ? "#d97706" : `var(--text-faint)`, fontWeight: 700 }}>{s.goals || "\u2014"}</td>
                        <td style={{ padding: "0.35rem 0.5rem", textAlign: "right", color: pColor, fontWeight: 600 }}>{s.gph > 0 ? s.gph.toFixed(3) : "\u2014"}</td>
                        <td style={{ padding: "0.35rem 0.5rem", textAlign: "right" }}>
                          {s.pctToGoal !== null ? (
                            <span style={{ color: pColor, fontWeight: 700, background: pColor + "12", border: `1px solid ${pColor}30`, borderRadius: "3px", padding: "0.1rem 0.3rem" }}>{Math.round(s.pctToGoal)}%</span>
                          ) : "\u2014"}
                        </td>
                        <td style={{ padding: "0.35rem 0.5rem", textAlign: "right", color: pColor }}>${s.cps.toFixed(2)}</td>
                        <td style={{ padding: "0.35rem 0.5rem", textAlign: "right", color: s.q1Rate >= 40 ? "#16a34a" : s.q1Rate >= 20 ? "#d97706" : "#dc2626", fontWeight: 600 }}>{Math.round(s.q1Rate)}%</td>
                        {["q1","q2","q3","q4"].map(q => (
                          <td key={q} style={{ padding: "0.35rem 0.4rem", textAlign: "right", color: Q[q.toUpperCase()].color }}>{s[q]}</td>
                        ))}
                        <td style={{ padding: "0.35rem 0.5rem", textAlign: "right" }}>
                          {s.trending === "up" && <span style={{ color: "#16a34a" }}>{"\u2191"}</span>}
                          {s.trending === "down" && <span style={{ color: "#dc2626" }}>{"\u2193"}</span>}
                          {s.trending === "flat" && <span style={{ color: `var(--text-faint)` }}>{"\u2192"}</span>}
                          {!s.trending && "\u2014"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot><tr style={{ borderTop: "2px solid var(--border)", background: `var(--bg-row-alt)` }}>
                  <td></td>
                  <td style={{ padding: "0.4rem 0.5rem", fontWeight: 700, color: `var(--text-warm)` }}>TOTAL</td>
                  <td style={{ padding: "0.4rem 0.5rem", textAlign: "right", fontWeight: 700 }}>{uCount}</td>
                  <td></td>
                  <td style={{ padding: "0.4rem 0.5rem", textAlign: "right", fontWeight: 700, color: "#6366f1" }}>{fmt(sTotHrs, 1)}</td>
                  <td style={{ padding: "0.4rem 0.5rem", textAlign: "right", fontWeight: 700, color: "#d97706" }}>{sTotGoals}</td>
                  <td style={{ padding: "0.4rem 0.5rem", textAlign: "right", fontWeight: 700 }}>{sTotGph.toFixed(3)}</td>
                  <td style={{ padding: "0.4rem 0.5rem", textAlign: "right" }}>
                    {sTotPct !== null ? <span style={{ color: attainColor(sTotPct), fontWeight: 700 }}>{Math.round(sTotPct)}%</span> : "\u2014"}
                  </td>
                  <td style={{ padding: "0.4rem 0.5rem", textAlign: "right", fontWeight: 700 }}>${sTotGoals > 0 ? ((sTotHrs * 19.77) / sTotGoals).toFixed(2) : (sTotHrs * 19.77).toFixed(2)}</td>
                  <td colSpan={6}></td>
                </tr></tfoot>
              </table>
            </div>
          </div>
        );
      })()}

      {/* Daily Targets — Hours, Homes, HSD & XM Lines required per day to finish on goal */}
      {fiscalInfo && sitePrograms.some(p => p.sitePlanHsd || p.sitePlanXm || p.sitePlanGoals || p.sitePlanHours) && (() => {
        const dtColors = [
          { label: "Hours",    color: "#6366f1", bg: "#6366f108" },
          { label: "Homes",    color: "#16a34a", bg: "#16a34a08" },
          { label: "HSD",      color: "#2563eb", bg: "#2563eb08" },
          { label: "XM Lines", color: "#8b5cf6", bg: "#8b5cf608" },
        ];
        const dtPrograms = sitePrograms.filter(p => p.sitePlanHsd || p.sitePlanXm || p.sitePlanGoals || p.sitePlanHours);
        const filteredDtPrograms = (() => {
          if (!dtFundingFilter) return dtPrograms;
          // When funding filter active, split programs into per-funding rows
          const rows = [];
          dtPrograms.forEach(p => {
            const matchingBreakouts = (p.goalBreakout || []).filter(g => g.funding === dtFundingFilter);
            if (matchingBreakouts.length === 0) return; // skip programs with no matching funding
            matchingBreakouts.forEach(fb => {
              // Filter agents to only those with matching ROC code
              const rocAgents = fb.roc ? p.siteAgents.filter(a => a.rocCode === fb.roc) : p.siteAgents;
              const rocGoals = rocAgents.reduce((s, a) => s + a.goals, 0);
              const rocHours = rocAgents.reduce((s, a) => s + a.hours, 0);
              const rocHsd = rocAgents.reduce((s, a) => s + (a.newXI || 0), 0);
              const rocXm = rocAgents.reduce((s, a) => s + (a.xmLines || 0), 0);
              rows.push({
                ...p,
                _fundingLabel: fb.funding,
                _fundingRoc: fb.roc,
                sitePlanHours: fb.hours || 0,
                sitePlanGoals: fb.homes || 0,
                totalHours: rocHours,
                totalGoals: rocGoals,
                hsdAct: rocHsd,
                xmAct: rocXm,
                siteAgents: rocAgents,
                uNames: new Set(rocAgents.map(a => a.agentName).filter(Boolean)).size,
              });
            });
          });
          return rows;
        })();
        const gridCols = "2.2fr 3px 1fr 1fr 1fr 3px 1fr 1fr 1fr 3px 1fr 1fr 1fr 3px 1fr 1fr 1fr";
        // Column indices: 0=prog, 1=div, 2-4=hours, 5=div, 6-8=homes, 9=div, 10-12=hsd, 13=div, 14-16=xm
        const dividerIndices = [1, 5, 9, 13];
        const groupStartCols = [2, 6, 10, 14]; // first data col of each group

        // Use site-level canonical plan totals (sitePlanMetrics) — not per-program sums
        // which can double-count when programs share overlapping TA goal entries
        const canonPlanHours = sitePlanMetrics ? sitePlanMetrics.hours : 0;
        const canonPlanGoals = sitePlanMetrics ? sitePlanMetrics.goals : 0;
        const canonPlanHsd   = sitePlanMetrics ? sitePlanMetrics.hsd   : 0;
        const canonPlanXm    = sitePlanMetrics ? sitePlanMetrics.xm    : 0;

        const DtCell = ({ children, style }) => (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "0.3rem 0.2rem", ...style }}>{children}</div>
        );
        const Divider = ({ color, style }) => (
          <div style={{ background: color, borderRadius: "1px", ...style }} />
        );

        const renderMetricCells = (metrics, rowBg) => {
          const cells = [];
          metrics.forEach((m, gi) => {
            const g = dtColors[gi];
            const diff = (m.actual || 0) - (m.plan || 0);
            const remain = Math.max(-diff, 0);
            const noDaysLeft = !fiscalInfo.remainingBDays || fiscalInfo.remainingBDays <= 0;
            const perDay = remain > 0 && !noDaysLeft ? remain / fiscalInfo.remainingBDays : 0;
            const onTrack = m.plan ? (m.actual / m.plan) * 100 >= (fiscalInfo.pctElapsed - 5) : true;
            const isOver = diff > 0;
            cells.push(<Divider key={`d${gi}`} color={`${g.color}40`} />);
            cells.push(
              <DtCell key={`p${gi}`} style={{ background: g.bg }}>
                <span style={{ fontFamily: "monospace", fontSize: rowBg ? "1.11rem" : "1.08rem", color: `var(--text-dim)`, fontWeight: rowBg ? 700 : 400 }}>
                  {m.plan ? m.fmtFn(m.plan) : "\u2014"}
                </span>
              </DtCell>
            );
            cells.push(
              <DtCell key={`a${gi}`} style={{ background: g.bg }}>
                <span style={{ fontFamily: "monospace", fontSize: rowBg ? "1.11rem" : "1.08rem", color: `var(--text-primary)`, fontWeight: rowBg ? 700 : 400 }}>
                  {m.actual ? m.fmtFn(m.actual) : "0"}
                </span>
              </DtCell>
            );
            cells.push(
              <DtCell key={`r${gi}`} style={{ background: g.bg }}>
                {m.plan ? (
                  isOver
                    ? <span style={{ fontFamily: "monospace", fontSize: rowBg ? "1.08rem" : "0.92rem", color: gi === 0 ? "#dc2626" : "#16a34a", fontWeight: 700 }}>
                        +{m.fmtFn(Math.abs(diff))}
                      </span>
                    : remain === 0
                      ? <span style={{ fontFamily: "monospace", fontSize: "1.05rem", color: "#16a34a", fontWeight: 700 }}>0</span>
                      : noDaysLeft
                        ? <span style={{ fontFamily: "monospace", fontSize: rowBg ? "1.08rem" : "0.92rem", color: "#dc2626", fontWeight: 700 }}>
                            -{m.fmtFn(remain)}
                          </span>
                      : <span style={{ fontFamily: "'Cormorant Garamond', Georgia, serif", fontSize: rowBg ? "1.95rem" : "1.65rem", color: rowBg ? "#d97706" : (onTrack ? "#16a34a" : "#dc2626"), fontWeight: 700, lineHeight: 1 }}>
                          {perDay < 1 ? perDay.toFixed(1) : Math.ceil(perDay)}
                        </span>
                ) : <span style={{ fontFamily: "monospace", fontSize: "1.08rem", color: `var(--text-faint)` }}>{"\u2014"}</span>}
              </DtCell>
            );
          });
          return cells;
        };

        return (
        <div style={{ background: `var(--bg-secondary)`, border: "1px solid var(--border)", borderRadius: "12px", padding: "1.5rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <span style={{ fontSize: "1.5rem" }}>🎯</span>
                <span style={{ fontFamily: "monospace", fontSize: "1.17rem", color: "#d97706", letterSpacing: "0.12em", textTransform: "uppercase", fontWeight: 700 }}>
                  Daily Targets — {displayLabel}
                </span>
              </div>
              <div style={{ fontFamily: "monospace", fontSize: "1.02rem", color: `var(--text-faint)`, marginTop: "0.2rem" }}>
                Required per day to finish on goal · {fiscalInfo.remainingBDays > 0 ? `${fiscalInfo.remainingBDays} business days remaining` : "No scheduled business days remaining"}
              </div>
            </div>
          </div>

          {/* Funding source filter */}
          {(() => {
            const fundingSources = [...new Set(dtPrograms.flatMap(p => (p.goalBreakout || []).map(g => g.funding)).filter(Boolean))];
            if (fundingSources.length <= 1) return null;
            return (
              <div style={{ display: "flex", gap: "0.3rem", flexWrap: "wrap", marginBottom: "0.75rem" }}>
                <button onClick={() => setDtFundingFilter(null)}
                  style={{ padding: "0.2rem 0.6rem", borderRadius: "4px", border: `1px solid ${!dtFundingFilter ? "#d97706" : "var(--border)"}`, background: !dtFundingFilter ? "#d9770618" : "transparent", color: !dtFundingFilter ? "#d97706" : `var(--text-dim)`, fontFamily: "monospace", fontSize: "0.9rem", cursor: "pointer", fontWeight: !dtFundingFilter ? 700 : 400 }}>
                  All Funding
                </button>
                {fundingSources.map(f => {
                  const active = dtFundingFilter === f;
                  return (
                    <button key={f} onClick={() => setDtFundingFilter(active ? null : f)}
                      style={{ padding: "0.2rem 0.6rem", borderRadius: "4px", border: `1px solid ${active ? "#2563eb" : "var(--border)"}`, background: active ? "#2563eb18" : "transparent", color: active ? "#2563eb" : `var(--text-dim)`, fontFamily: "monospace", fontSize: "0.9rem", cursor: "pointer", fontWeight: active ? 700 : 400 }}>
                      {f}
                    </button>
                  );
                })}
              </div>
            );
          })()}

          {/* Group header row */}
          <div style={{ display: "grid", gridTemplateColumns: gridCols, marginBottom: "0" }}>
            <div />
            {dtColors.map((g, gi) => (
              <React.Fragment key={g.label}>
                <div style={{ background: `${g.color}40` }} />
                <div style={{ gridColumn: "span 3", textAlign: "center", padding: "0.4rem 0", background: `${g.color}18`, borderBottom: `2px solid ${g.color}40`, borderTop: `2px solid ${g.color}30`, borderRadius: gi === 0 ? "6px 0 0 0" : gi === 3 ? "0 6px 0 0" : "0" }}>
                  <span style={{ fontFamily: "monospace", fontSize: "1.05rem", color: g.color, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700 }}>{g.label}</span>
                </div>
              </React.Fragment>
            ))}
          </div>

          {/* Sub-header row */}
          <div style={{ display: "grid", gridTemplateColumns: gridCols, borderBottom: "2px solid var(--border)" }}>
            <div style={{ padding: "0.35rem 0.75rem", fontFamily: "monospace", fontSize: "0.96rem", color: `var(--text-muted)`, textTransform: "uppercase", letterSpacing: "0.06em" }}>Program</div>
            {dtColors.map((g, gi) => (
              <React.Fragment key={gi}>
                <div style={{ background: `${g.color}25` }} />
                <div style={{ fontFamily: "monospace", fontSize: "0.96rem", color: `var(--text-faint)`, textAlign: "center", padding: "0.35rem 0", background: g.bg }}>Plan</div>
                <div style={{ fontFamily: "monospace", fontSize: "0.96rem", color: `var(--text-faint)`, textAlign: "center", padding: "0.35rem 0", background: g.bg }}>Actual</div>
                <div style={{ fontFamily: "monospace", fontSize: "0.96rem", color: "#d97706", textAlign: "center", padding: "0.35rem 0", fontWeight: 700, background: g.bg }}>/ Day</div>
              </React.Fragment>
            ))}
          </div>

          {/* Program data rows */}
          {filteredDtPrograms.map((p, pi) => {
            const metrics = [
              { plan: p.sitePlanHours, actual: p.totalHours, fmtFn: v => fmt(v, 0) },
              { plan: p.sitePlanGoals, actual: p.totalGoals, fmtFn: v => v.toLocaleString() },
              { plan: p.sitePlanHsd,   actual: p.hsdAct,     fmtFn: v => v.toLocaleString() },
              { plan: p.sitePlanXm,    actual: p.xmAct,      fmtFn: v => v.toLocaleString() },
            ];
            const rocLabel = p._fundingRoc || (p.goalBreakout ? p.goalBreakout.map(g => g.roc).filter(Boolean).join(", ") : "");
            return (
              <div key={p.jobType + (p._fundingRoc || String(pi))} style={{ display: "grid", gridTemplateColumns: gridCols, borderBottom: "1px solid var(--bg-tertiary)", alignItems: "center" }}>
                <div style={{ padding: "0.5rem 0.75rem" }}>
                  <div style={{ fontFamily: "Georgia, serif", fontSize: "1.2rem", color: `var(--text-warm)` }}>{p.jobType}</div>
                  {rocLabel && <div style={{ fontFamily: "monospace", fontSize: "0.8rem", color: `var(--text-faint)` }}>{rocLabel}</div>}
                </div>
                {renderMetricCells(metrics, false)}
              </div>
            );
          })}

          {/* Totals row */}
          {(() => {
            const tots = [
              { plan: dtFundingFilter ? filteredDtPrograms.reduce((s, p) => s + (p.sitePlanHours || 0), 0) : canonPlanHours, actual: filteredDtPrograms.reduce((s, p) => s + p.totalHours, 0), fmtFn: v => fmt(v, 0) },
              { plan: dtFundingFilter ? filteredDtPrograms.reduce((s, p) => s + (p.sitePlanGoals || 0), 0) : canonPlanGoals, actual: filteredDtPrograms.reduce((s, p) => s + p.totalGoals, 0), fmtFn: v => v.toLocaleString() },
              { plan: dtFundingFilter ? filteredDtPrograms.reduce((s, p) => s + (p.sitePlanHsd || 0), 0) : canonPlanHsd,   actual: filteredDtPrograms.reduce((s, p) => s + (p.hsdAct || 0), 0), fmtFn: v => v.toLocaleString() },
              { plan: dtFundingFilter ? filteredDtPrograms.reduce((s, p) => s + (p.sitePlanXm || 0), 0) : canonPlanXm,    actual: filteredDtPrograms.reduce((s, p) => s + (p.xmAct || 0), 0), fmtFn: v => v.toLocaleString() },
            ];
            return (
              <div style={{ display: "grid", gridTemplateColumns: gridCols, borderTop: "2px solid var(--border)", marginTop: "0.25rem", alignItems: "center" }}>
                <div style={{ padding: "0.65rem 0.75rem", fontFamily: "monospace", fontSize: "1.14rem", color: `var(--text-muted)`, textTransform: "uppercase", fontWeight: 700 }}>TOTAL</div>
                {renderMetricCells(tots, true)}
              </div>
            );
          })()}
        </div>
        );
      })()}

      {/* Quartile bar */}
      <div style={{ background: `var(--bg-secondary)`, border: "1px solid var(--border)", borderRadius: "12px", padding: "1.25rem" }}>
        <div style={{ fontFamily: "monospace", fontSize: "1.11rem", color: `var(--text-muted)`, letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: "0.75rem" }}>Quartile Mix — {displayLabel}</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "0.5rem", marginBottom: "0.75rem" }}>
          {["Q1","Q2","Q3","Q4"].map(q => (
            <div key={q} style={{ padding: "0.75rem", borderRadius: "8px", background: Q[q].color+"12", border: `1px solid ${Q[q].color}30`, textAlign: "center" }}>
              <div style={{ fontFamily: "'Cormorant Garamond', Georgia, serif", fontSize: "3rem", color: Q[q].color, fontWeight: 700 }}>{distU[q]}</div>
              <div style={{ fontFamily: "monospace", fontSize: "1.17rem", color: Q[q].color }}>{q} · unique</div>
            </div>
          ))}
        </div>
        <div style={{ display: "flex", height: "8px", borderRadius: "4px", overflow: "hidden" }}>
          {["Q1","Q2","Q3","Q4"].map(q => (
            <div key={q} style={{ flex: distU[q] || 0, background: Q[q].color, transition: "flex 0.5s" }} />
          ))}
        </div>
      </div>

      {/* Per-program breakdown */}
      <div style={{ background: `var(--bg-secondary)`, border: "1px solid var(--border)", borderRadius: "12px", padding: "1.5rem" }}>
        <div style={{ fontFamily: "monospace", fontSize: "1.14rem", color: `var(--text-muted)`, letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: "1.25rem" }}>Programs — {displayLabel}</div>
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          {sitePrograms.map(p => {
            const maxGoals   = Math.max(...sitePrograms.map(x => x.totalGoals), 1);
            const barW       = (p.totalGoals / maxGoals) * 100;
            const color      = p.attain !== null ? attainColor(p.attain) : attainColor((p.distUn.Q1 / (p.uNames||1)) * 100);
            return (
              <div key={p.jobType} style={{ padding: "1rem", background: `var(--bg-primary)`, borderRadius: "10px", border: `1px solid ${color}20` }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "0.6rem" }}>
                  <div>
                    <div style={{ fontFamily: "Georgia, serif", fontSize: "1.42rem", color: `var(--text-warm)` }}>{p.jobType}</div>
                    <div style={{ fontFamily: "monospace", fontSize: "0.99rem", color: `var(--text-dim)`, marginTop: "0.1rem" }}>
                      {p.uNames} agents · {fmt(p.totalHours, 0)} hrs · GPH {fmt(p.siteGph, 2)}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: "0.75rem", alignItems: "center" }}>
                    {p.attain !== null && (
                      <div style={{ textAlign: "right" }}>
                        <div style={{ fontFamily: "'Cormorant Garamond', Georgia, serif", fontSize: "1.95rem", color, fontWeight: 700 }}>{Math.round(p.attain)}%</div>
                        <div style={{ fontFamily: "monospace", fontSize: "1.08rem", color: `var(--text-dim)` }}>attainment</div>
                      </div>
                    )}
                  </div>
                </div>
                <div style={{ display: "flex", height: "5px", background: `var(--bg-tertiary)`, borderRadius: "3px", overflow: "hidden", marginBottom: "0.5rem" }}>
                  <div style={{ width: `${barW}%`, background: color, borderRadius: "3px", transition: "width 0.5s" }} />
                </div>
                <div style={{ display: "flex", gap: "0.75rem" }}>
                  {["Q1","Q2","Q3","Q4"].map(q => (
                    <span key={q} style={{ fontFamily: "monospace", fontSize: "1.14rem", color: Q[q].color }}>
                      {q}: {p.distUn[q]}
                    </span>
                  ))}
                  <span style={{ fontFamily: "monospace", fontSize: "1.14rem", color: "#16a34a" }}>
                    {p.totalGoals.toLocaleString()} goals
                  </span>
                  {p.attain !== null && p.sitePlanGoals && (
                    <span style={{ fontFamily: "monospace", fontSize: "1.14rem", color: `var(--text-dim)` }}>
                      of {p.sitePlanGoals.toLocaleString()} plan
                    </span>
                  )}
                </div>
                {/* ROC/Target breakout when multiple funding sources */}
                {p.goalBreakout && p.goalBreakout.length > 1 && (
                  <div style={{ marginTop: "0.6rem", borderTop: `1px solid var(--border)`, paddingTop: "0.5rem" }}>
                    <div style={{ fontFamily: "monospace", fontSize: "0.85rem", color: `var(--text-faint)`, letterSpacing: "0.1em", marginBottom: "0.3rem" }}>GOAL BREAKOUT</div>
                    {p.goalBreakout.map(g => (
                      <div key={g.roc || g.target} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0.25rem 0", borderBottom: "1px solid var(--bg-tertiary)" }}>
                        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                          <span style={{ fontFamily: "monospace", fontSize: "0.9rem", color: `var(--text-muted)` }}>{g.roc}</span>
                          <span style={{ fontFamily: "Georgia, serif", fontSize: "1rem", color: `var(--text-secondary)` }}>{g.target}</span>
                          {g.funding && <span style={{ fontFamily: "monospace", fontSize: "0.85rem", color: "#6366f1", background: "#6366f108", border: "1px solid #6366f130", borderRadius: "3px", padding: "0 0.3rem" }}>{g.funding}</span>}
                        </div>
                        <div style={{ display: "flex", gap: "1rem", fontFamily: "monospace", fontSize: "0.95rem" }}>
                          <span style={{ color: `var(--text-dim)` }}>{g.homes.toLocaleString()} homes</span>
                          <span style={{ color: `var(--text-dim)` }}>{Math.round(g.hours).toLocaleString()} hrs</span>
                          <span style={{ color: `var(--text-dim)` }}>SPH {g.sph.toFixed(3)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}


// ══════════════════════════════════════════════════════════════════════════════
// SECTION 12 — BUSINESS OVERVIEW  (pages/BusinessOverview.jsx)
// Consumes engine output directly. No computation inside.
// ══════════════════════════════════════════════════════════════════════════════

function BusinessOverview({ perf, onNav }) {
  const [tab, setTab] = useState("overview");

  const {
    programs, regions, insights, agents, goalLookup,
    planTotal, globalGoals, uniqueAgentCount, totalHours, newHireSet,
    globalRgu, globalNewXI, globalXmLines,
    globalPlanRgu, globalPlanNewXI, globalPlanXmLines,
    globalPlanHours, fiscalInfo,
    spanishCallback,
  } = perf;

  // Group regions: XOTM = BZ, everything else = individual DR sites
  const siteGroups = useMemo(() => {
    const allRegions = [...new Set(agents.map(a => (a.Region || a.region || "Unknown").trim()))].filter(r => r !== "Unknown").sort();
    const bzRegions  = allRegions.filter(r => r.toUpperCase().includes("XOTM"));
    const drRegions  = allRegions.filter(r => !r.toUpperCase().includes("XOTM"));
    const groups = [];
    if (drRegions.length > 0) groups.push({ label: drRegions.length === 1 ? drRegions[0] : "DR", regions: drRegions });
    if (bzRegions.length > 0) groups.push({ label: "BZ", regions: bzRegions });
    return groups;
  }, [agents]);

  const [selectedGroup, setSelectedGroup] = useState(null);
  const activeGroup = selectedGroup || siteGroups[0] || null;

  const wins = insights.filter(i => i.type === "win");
  const opps = insights.filter(i => i.type === "opp");

  const distUnique = useMemo(() => uniqueQuartileDist(agents), [agents]);
  const uniqueQ1   = distUnique.Q1;
  const atGoalRate = uniqueAgentCount > 0
    ? ((distUnique.Q1 + distUnique.Q2) / uniqueAgentCount) * 100 : 0;

  const goalsAttain = planTotal ? (globalGoals / planTotal) * 100 : null;

  // Holistic gainshare attainments (overall table)
  const globalHsdAttain    = globalPlanNewXI  ? (globalNewXI  / globalPlanNewXI)  * 100 : null;
  const globalCostPerAttain = globalPlanRgu ? (globalRgu / globalPlanRgu) * 100 : null;

  const kpi1 = goalLookup && planTotal
    ? { label: "Goals vs Plan", value: `${Math.round(goalsAttain)}%`, sub: `${globalGoals.toLocaleString()} of ${planTotal.toLocaleString()}`, accent: attainColor(goalsAttain) }
    : { label: "Q1 Rate",       value: `${Math.round(atGoalRate)}%`,  sub: `${distUnique.Q1 + distUnique.Q2} at/above goal`, accent: attainColor(atGoalRate) };

  const globalQ4Priority = programs.flatMap(p => p.q4Agents.filter(a => a.hours >= 16))
    .sort((a, b) => b.hours - a.hours).slice(0, 8);

  const qColor = pct => pct >= 100 ? Q.Q1.color : pct >= 80 ? Q.Q2.color : pct > 0 ? Q.Q3.color : Q.Q4.color;

  return (
    <div style={{ minHeight: "100vh", background: `var(--bg-primary)`, display: "flex", flexDirection: "column" }}>
      <div style={{ background: `var(--bg-secondary)`, borderBottom: "1px solid var(--border)", padding: "1.25rem 2.5rem", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <div style={{ fontFamily: "monospace", fontSize: "1.08rem", color: `var(--text-muted)`, letterSpacing: "0.15em", textTransform: "uppercase" }}>Business Overview</div>
          <div style={{ fontFamily: "'Cormorant Garamond', Georgia, serif", fontSize: "3.38rem", color: `var(--text-warm)`, fontWeight: 700, letterSpacing: "-0.5px", lineHeight: 1.1 }}>
            {tab === "bysite" && activeGroup ? activeGroup.label : tab === "daily" ? "Daily Performance" : "Highlights & Lowlights"}
          </div>
        </div>
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
          {[["overview","Overview"],["bysite","By Site"],["daily","Daily"]].map(([t, label]) => (
            <button key={t} onClick={() => setTab(t)}
              style={{ padding: "0.4rem 0.9rem", borderRadius: "6px", border: `1px solid ${tab===t?"#d97706":`var(--border)`}`, background: tab===t?"#d9770618":"transparent", color: tab===t?"#d97706":`var(--text-muted)`, fontFamily: "monospace", fontSize: "1.14rem", cursor: "pointer", letterSpacing: "0.05em" }}>
              {label}
            </button>
          ))}
          <button onClick={() => onNav(1)}
            style={{ padding: "0.5rem 1.25rem", background: "#d9770618", border: "1px solid #d97706", borderRadius: "6px", color: "#d97706", fontFamily: "monospace", fontSize: "1.17rem", cursor: "pointer" }}>
            PROGRAMS →
          </button>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "2rem 2.5rem", display: "flex", flexDirection: "column", gap: "1.5rem" }}>

        {!goalLookup && tab === "overview" && (
          <div style={{ background: "#d9770610", border: "1px solid #d9770640", borderLeft: "4px solid #d97706", borderRadius: "8px", padding: "0.9rem 1.25rem", display: "flex", alignItems: "center", gap: "0.9rem" }}>
            <span style={{ fontSize: "1.65rem" }}>🎯</span>
            <div>
              <div style={{ fontFamily: "monospace", fontSize: "1.11rem", color: "#d97706", letterSpacing: "0.1em", textTransform: "uppercase" }}>Goals file not loaded</div>
              <div style={{ fontFamily: "Georgia, serif", fontSize: "1.17rem", color: `var(--text-secondary)`, marginTop: "0.2rem" }}>
                Upload your goals CSV to unlock Goals vs Plan comparisons and a Goals tab on every program slide. Until then, metrics reflect performance distribution only.
              </div>
            </div>
          </div>
        )}

        {/* ── BY SITE TAB ── */}
        {tab === "bysite" && (
          <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
            {/* Site group selector */}
            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
              {siteGroups.map(g => (
                <button key={g.label} onClick={() => setSelectedGroup(g)}
                  style={{ padding: "0.4rem 1rem", borderRadius: "6px", border: `1px solid ${activeGroup?.label===g.label?"#d97706":`var(--border)`}`, background: activeGroup?.label===g.label?"#d9770618":"transparent", color: activeGroup?.label===g.label?"#d97706":`var(--text-muted)`, fontFamily: "monospace", fontSize: "1.14rem", cursor: "pointer" }}>
                  {g.label}
                  <span style={{ fontFamily: "monospace", fontSize: "1.11rem", color: `var(--text-dim)`, marginLeft: "0.4rem" }}>
                    ({g.regions.length > 1 ? `${g.regions.length} sites` : g.regions[0]})
                  </span>
                </button>
              ))}
            </div>
            {activeGroup && (
              <ErrorBoundary>
              <SiteDrilldown
                siteLabel={activeGroup.label}
                regions={activeGroup.regions}
                allAgents={agents}
                programs={programs}
                goalLookup={goalLookup}
                newHireSet={newHireSet}
                fiscalInfo={fiscalInfo}
              />
              </ErrorBoundary>
            )}
          </div>
        )}

        {tab === "overview" && (
          <>
            {/* KPI strip */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: "0.75rem" }}>
          {[
            kpi1,
            { label: "Unique Agents",  value: uniqueAgentCount,             sub: `${programs.length} programs`,                              accent: "#6366f1" },
            { label: "Total Hours",    value: fmt(totalHours, 0),            sub: goalLookup && globalPlanHours ? `of ${Math.round(globalPlanHours).toLocaleString()} planned` : `${new Set(agents.filter(a=>a.hours>=16).map(a=>a.agentName).filter(Boolean)).size} at 16+`, accent: "#6366f1" },
            { label: "Total Goals",    value: globalGoals.toLocaleString(),  sub: "conversions",                                              accent: "#16a34a" },
            { label: "Q1 Agents",      value: uniqueQ1,                      sub: `${Math.round(uniqueQ1/uniqueAgentCount*100)}% of workforce`, accent: Q.Q1.color },
          ].map(c => (
            <div key={c.label} style={{ background: `var(--bg-secondary)`, border: `1px solid ${c.accent}22`, borderRadius: "10px", padding: "1.1rem", borderTop: `3px solid ${c.accent}` }}>
              <div style={{ fontFamily: "monospace", fontSize: "1.17rem", color: `var(--text-muted)`, textTransform: "uppercase", letterSpacing: "0.1em" }}>{c.label}</div>
              <div style={{ fontFamily: "'Cormorant Garamond', Georgia, serif", fontSize: "3rem", color: `var(--text-warm)`, fontWeight: 700, marginTop: "0.1rem", lineHeight: 1 }}>{c.value}</div>
              <div style={{ fontFamily: "monospace", fontSize: "1.01rem", color: `var(--text-dim)`, marginTop: "0.25rem" }}>{c.sub}</div>
            </div>
          ))}
        </div>

        {/* Goals vs Plan metrics row */}
        {(() => {
          const bizNarrative = generateBusinessNarrative(perf, fiscalInfo);
          return <CollapsibleNarrative title="Executive Summary" lines={bizNarrative} defaultOpen={true} />;
        })()}
        {goalLookup && (
          <MetricComparePanel
            title="Goals vs Plan — Business Wide"
            fiscalInfo={fiscalInfo}
            metrics={[
              { label: "Total Hours",   actual: totalHours,    plan: globalPlanHours     },
              { label: "Total Goals",   actual: globalGoals,   plan: planTotal           },
              { label: "Total RGU",     actual: globalRgu,     plan: globalPlanRgu       },
              { label: "New XI (HSD)",  actual: globalNewXI,   plan: globalPlanNewXI     },
              { label: "XM Lines",      actual: globalXmLines, plan: globalPlanXmLines   },
            ]}
          />
        )}

        {/* Gainshare — holistic / company-wide */}
        {goalLookup && (
          <GainsharePanel
            mobileAttain={goalsAttain}
            hsdAttain={globalHsdAttain}
            costPerAttain={globalCostPerAttain}
            fiscalInfo={fiscalInfo}
            mobileActual={globalGoals}   mobilePlan={planTotal}
            hsdActual={globalNewXI}      hsdPlan={globalPlanNewXI}
            costPerActual={globalRgu}    costPerPlan={globalPlanRgu}
          />
        )}

        {/* Quartile distribution */}
        <div style={{ background: `var(--bg-secondary)`, border: "1px solid var(--border)", borderRadius: "12px", padding: "1.25rem 1.5rem" }}>
          <div style={{ fontFamily: "monospace", fontSize: "1.11rem", color: `var(--text-muted)`, letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: "0.9rem" }}>Workforce Distribution — Unique Agents</div>
          {(() => {
            // Build one total-hours entry and one quartile per unique agent name
            const agentHours = {};
            const agentQ = {};
            agents.forEach(a => {
              if (!a.agentName) return;
              agentHours[a.agentName] = (agentHours[a.agentName] || 0) + a.hours;
              if (!agentQ[a.agentName]) agentQ[a.agentName] = a.quartile;
            });
            const totalUnique = Object.keys(agentQ).length;
            return (
              <>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "0.5rem", marginBottom: "0.75rem" }}>
                  {["Q1","Q2","Q3","Q4"].map(q => {
                    const names   = Object.keys(agentQ).filter(n => agentQ[n] === q);
                    const count   = names.length;
                    const active  = names.filter(n => (agentHours[n] || 0) >= 16).length;
                    const pctTeam = totalUnique ? Math.round(count / totalUnique * 100) : 0;
                    return (
                      <div key={q} style={{ padding: "0.75rem", borderRadius: "8px", background: Q[q].color+"12", border: `1px solid ${Q[q].color}30`, textAlign: "center" }}>
                        <div style={{ fontFamily: "'Cormorant Garamond', Georgia, serif", fontSize: "3rem", color: Q[q].color, fontWeight: 700, lineHeight: 1 }}>{active}</div>
                        <div style={{ fontFamily: "monospace", fontSize: "1.17rem", color: Q[q].color, marginTop: "0.15rem" }}>{q} · 16+ hrs</div>
                        <div style={{ fontFamily: "monospace", fontSize: "1.14rem", color: `var(--text-dim)`, marginTop: "0.2rem" }}>{count} total · {pctTeam}%</div>
                      </div>
                    );
                  })}
                </div>
                <div style={{ display: "flex", height: "7px", borderRadius: "4px", overflow: "hidden" }}>
                  {["Q1","Q2","Q3","Q4"].map(q => {
                    const c = Object.keys(agentQ).filter(n => agentQ[n] === q).length;
                    return <div key={q} style={{ flex: c||0, background: Q[q].color, transition: "flex 0.6s" }} />;
                  })}
                </div>
              </>
            );
          })()}
        </div>

        {/* Program + Region rankings */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1.25rem" }}>
          {/* Programs */}
          <div style={{ background: `var(--bg-secondary)`, border: "1px solid var(--border)", borderRadius: "12px", padding: "1.25rem" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
              <div style={{ fontFamily: "monospace", fontSize: "1.11rem", color: `var(--text-muted)`, letterSpacing: "0.12em", textTransform: "uppercase" }}>Program Rankings</div>
              <div style={{ fontFamily: "monospace", fontSize: "1.14rem", color: `var(--text-faint)` }}>{goalLookup ? "vs plan" : "by health score"}</div>
            </div>
            {programs.map((p, i) => {
              const metric  = p.attainment !== null ? p.attainment : p.healthScore;
              const maxM    = programs.reduce((m, x) => Math.max(m, x.attainment ?? x.healthScore), 1);
              const barW    = Math.min((metric / maxM) * 100, 100);
              const color   = qColor(p.attainment ?? p.q1Rate);
              return (
                <div key={p.jobType} onClick={() => onNav(i + 1)} style={{ padding: "0.6rem 0", borderBottom: "1px solid var(--bg-tertiary)", cursor: "pointer" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.3rem" }}>
                    <span style={{ fontFamily: "Georgia, serif", fontSize: "1.2rem", color: `var(--text-primary)` }}>{p.jobType}</span>
                    <div style={{ display: "flex", gap: "0.75rem", alignItems: "center" }}>
                      <span style={{ fontFamily: "monospace", fontSize: "1.01rem", color: `var(--text-dim)` }}>{p.uniqueAgentCount} agents</span>
                      {p.attainment !== null
                        ? <span style={{ fontFamily: "'Cormorant Garamond', Georgia, serif", fontSize: "1.65rem", color, fontWeight: 700 }}>{Math.round(p.attainment)}%<span style={{ fontFamily: "monospace", fontSize: "1.14rem", color: `var(--text-dim)` }}> plan</span></span>
                        : <span style={{ fontFamily: "'Cormorant Garamond', Georgia, serif", fontSize: "1.65rem", color, fontWeight: 700 }}>{p.distUnique.Q1} Q1</span>
                      }
                    </div>
                  </div>
                  <div style={{ display: "flex", height: "4px", background: `var(--bg-tertiary)`, borderRadius: "2px", overflow: "hidden" }}>
                    <div style={{ width: `${barW}%`, background: color, borderRadius: "2px", transition: "width 0.6s" }} />
                  </div>
                  <div style={{ display: "flex", gap: "0.75rem", marginTop: "0.25rem" }}>
                    <span style={{ fontFamily: "monospace", fontSize: "1.14rem", color: Q.Q1.color }}>Q1: {p.distUnique.Q1}</span>
                    <span style={{ fontFamily: "monospace", fontSize: "1.14rem", color: Q.Q4.color }}>Q4: {p.distUnique.Q4}</span>
                    {p.planGoals && <span style={{ fontFamily: "monospace", fontSize: "1.14rem", color: `var(--text-faint)` }}>{p.actGoals} / {p.planGoals} homes</span>}
                    <span style={{ fontFamily: "monospace", fontSize: "1.14rem", color: `var(--text-faint)` }}>{fmt(p.totalHours, 0)} hrs</span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Regions */}
          <div style={{ background: `var(--bg-secondary)`, border: "1px solid var(--border)", borderRadius: "12px", padding: "1.25rem" }}>
            <div style={{ fontFamily: "monospace", fontSize: "1.11rem", color: `var(--text-muted)`, letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: "1rem" }}>Region Rankings</div>
            {regions.map((r, i) => {
              const maxR  = regions[0].avgPct;
              const barW  = maxR > 0 ? Math.min((r.avgPct/maxR)*100, 100) : 0;
              const color = qColor(r.avgPct);
              const isTop = i === 0;
              const isBot = i === regions.length - 1 && regions.length > 1;
              return (
                <div key={r.name} style={{ padding: "0.6rem 0", borderBottom: "1px solid var(--bg-tertiary)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.3rem" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
                      {isTop && <span style={{ fontFamily: "monospace", fontSize: "1.08rem", color: "#d97706", background: "#d9770618", padding: "0.05rem 0.3rem", borderRadius: "2px" }}>BEST</span>}
                      {isBot && <span style={{ fontFamily: "monospace", fontSize: "1.08rem", color: "#dc2626", background: "#dc262618", padding: "0.05rem 0.3rem", borderRadius: "2px" }}>LAGGING</span>}
                      <span style={{ fontFamily: "Georgia, serif", fontSize: "1.2rem", color: `var(--text-primary)` }}>{r.name}</span>
                    </div>
                    <span style={{ fontFamily: "'Cormorant Garamond', Georgia, serif", fontSize: "1.65rem", color, fontWeight: 700 }}>
                      {r.totalGoals.toLocaleString()} <span style={{ fontFamily: "monospace", fontSize: "1.14rem", color: `var(--text-dim)` }}>goals</span>
                    </span>
                  </div>
                  <div style={{ display: "flex", height: "4px", background: `var(--bg-tertiary)`, borderRadius: "2px", overflow: "hidden", marginBottom: "0.25rem" }}>
                    <div style={{ width: `${barW}%`, background: color, borderRadius: "2px", transition: "width 0.6s" }} />
                  </div>
                  <div style={{ display: "flex", gap: "0.75rem" }}>
                    <span style={{ fontFamily: "monospace", fontSize: "1.14rem", color: `var(--text-dim)` }}>{r.uniqueAgents} agents</span>
                    <span style={{ fontFamily: "monospace", fontSize: "1.14rem", color: Q.Q1.color }}>Q1: {r.uniqueQ1}</span>
                    <span style={{ fontFamily: "monospace", fontSize: "1.14rem", color: Q.Q4.color }}>Q4: {r.uniqueQ4}</span>
                    <span style={{ fontFamily: "monospace", fontSize: "1.14rem", color: `var(--text-faint)` }}>{fmt(r.totalHours, 0)} hrs</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Wins + Opportunities from engine insights */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1.25rem" }}>
          <InsightCard type="win" insights={wins} />
          <InsightCard type="opp" insights={opps} />
        </div>

        {/* Priority Coaching — business-wide */}
        {globalQ4Priority.length > 0 && (
          <div style={{ background: `var(--bg-secondary)`, border: "1px solid var(--border)", borderRadius: "12px", padding: "1.25rem" }}>
            <div style={{ fontFamily: "monospace", fontSize: "1.11rem", color: "#dc2626", letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: "0.35rem" }}>Priority Coaching — Business Wide</div>
            <div style={{ fontFamily: "monospace", fontSize: "1.14rem", color: `var(--text-dim)`, marginBottom: "0.9rem" }}>Zero sales · 16+ hours · all programs · ranked by hours</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "0.5rem 1.5rem" }}>
              {globalQ4Priority.map((a, i) => (
                <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0.5rem 0", borderBottom: "1px solid var(--bg-tertiary)" }}>
                  <div>
                    <div style={{ color: `var(--text-warm)`, fontFamily: "Georgia, serif", fontSize: "1.2rem" }}>
                      {a.agentName}
                      {newHireSet.has(a.agentName) && <span style={{ fontFamily: "monospace", fontSize: "1.17rem", color: "#d97706", background: "#d9770620", padding: "0.05rem 0.25rem", borderRadius: "2px", marginLeft: "0.35rem" }}>NEW</span>}
                    </div>
                    <div style={{ fontFamily: "monospace", fontSize: "0.99rem", color: `var(--text-dim)` }}>{a.jobType} · {a.region}</div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontFamily: "'Cormorant Garamond', Georgia, serif", fontSize: "1.5rem", color: "#6366f1", fontWeight: 700 }}>{fmt(a.hours, 1)} hrs</div>
                    <div style={{ fontFamily: "monospace", fontSize: "1.08rem", color: "#dc2626" }}>0 sales</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        </>
        )}

        {/* ── DAILY TAB ── */}
        {tab === "daily" && (
          <DailyBreakdownPanel agents={agents.filter(a => !a.isSpanishCallback)} regions={regions} jobType="All Programs" sphGoal={null} programs={programs} goalLookup={goalLookup} />
        )}
      </div>

      <div style={{ borderTop: "1px solid var(--border)", padding: "0.9rem 2.5rem", display: "flex", justifyContent: "flex-end", background: `var(--bg-row-alt)` }}>
        <button onClick={() => onNav(1)}
          style={{ padding: "0.5rem 1.1rem", background: "transparent", border: "1px solid var(--text-faint)", borderRadius: "6px", color: `var(--text-secondary)`, fontFamily: "monospace", fontSize: "1.17rem", cursor: "pointer" }}>
          NEXT →
        </button>
      </div>
    </div>
  );
}


// ══════════════════════════════════════════════════════════════════════════════
// SECTION 12b — TEAMS VIEW  (components/TeamsView.jsx)
// Supervisor scorecards + weekly trend sparklines per program.
// ══════════════════════════════════════════════════════════════════════════════

function Sparkline({ points, color = "#d97706", height = 32, width = 80 }) {
  if (!points || points.length < 2) return <div style={{ width, height }} />;
  const vals = points.map(p => p ?? 0);
  const min  = Math.min(...vals);
  const max  = Math.max(...vals);
  const range = max - min || 1;
  const padX = 4, padY = 4;
  const w = width - padX * 2, h = height - padY * 2;
  const pts = vals.map((v, i) => {
    const x = padX + (i / (vals.length - 1)) * w;
    const y = padY + h - ((v - min) / range) * h;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  const trend = vals[vals.length - 1] - vals[0];
  const trendColor = trend > 0.005 ? "#16a34a" : trend < -0.005 ? "#dc2626" : color;
  return (
    <svg width={width} height={height} style={{ overflow: "visible" }}>
      <polyline points={pts} fill="none" stroke={trendColor} strokeWidth="1.5" strokeLinejoin="round" />
      {vals.map((v, i) => {
        const x = padX + (i / (vals.length - 1)) * w;
        const y = padY + h - ((v - min) / range) * h;
        return <circle key={i} cx={x} cy={y} r="2" fill={trendColor} />;
      })}
    </svg>
  );
}

function TrendArrow({ points }) {
  if (!points || points.length < 2) return null;
  const valid = points.filter(p => p !== null);
  if (valid.length < 2) return null;
  const last = valid[valid.length - 1], first = valid[0];
  const delta = last - first;
  const pct   = first > 0 ? (delta / first) * 100 : 0;
  if (Math.abs(pct) < 2) return <span style={{ color: `var(--text-dim)`, fontSize: "1.14rem" }}>→</span>;
  return (
    <span style={{ color: delta > 0 ? "#16a34a" : "#dc2626", fontSize: "1.14rem", fontWeight: 700 }}>
      {delta > 0 ? "↑" : "↓"} {Math.abs(pct).toFixed(0)}%
    </span>
  );
}

function buildSupInsights(s, supWeeks, crossProgramMap, lastDataDate, currentJobType) {
  const out = [];
  crossProgramMap = crossProgramMap || {};

  // Helper: determine how many business days have elapsed in a given week
  // using the last data date to detect partial/current weeks
  const weekElapsedBDays = (wk) => {
    const fullDays = weekDays(wk);
    if (!lastDataDate) return fullDays;
    // Get the ISO week start (Monday) for lastDataDate
    const ld = new Date(lastDataDate + "T00:00:00");
    const ldDay = ld.getDay();
    const ldMon = new Date(ld);
    ldMon.setDate(ld.getDate() - ((ldDay + 6) % 7));
    // Get the week number of lastDataDate
    const oneJan = new Date(ld.getFullYear(), 0, 1);
    const ldWeekNum = String(Math.ceil(((ld - oneJan) / 86400000 + oneJan.getDay() + 1) / 7));
    // If this week number matches, the week is partial — count only elapsed bdays
    if (String(wk) === ldWeekNum || String(Number(wk)) === String(Number(ldWeekNum))) {
      // Count Mon-Fri from Monday to lastDataDate
      let elapsed = 0;
      const cur = new Date(ldMon);
      while (cur <= ld) {
        const dw = cur.getDay();
        if (dw !== 0 && dw !== 6) elapsed++;
        cur.setDate(cur.getDate() + 1);
      }
      return elapsed;
    }
    return fullDays;
  };

  // ── Per-agent day-level analysis ────────────────────────────────────────────
  const agentDays = {};
  (s.rows || []).forEach(r => {
    if (!r.agentName || !r.date) return;
    if (!agentDays[r.agentName]) agentDays[r.agentName] = {};
    if (!agentDays[r.agentName][r.date]) agentDays[r.agentName][r.date] = { hours: 0, goals: 0 };
    agentDays[r.agentName][r.date].hours += r.hours;
    agentDays[r.agentName][r.date].goals += r.goals;
  });

  for (const [name, days] of Object.entries(agentDays)) {
    const first = name.split(" ")[0];
    const workedDates = Object.keys(days).sort();
    if (!workedDates.length) continue;
    const totalHoursThisJob  = Object.values(days).reduce((s, d) => s + d.hours, 0);
    const avgDayThisJob      = totalHoursThisJob / workedDates.length;

    // Cross-reference: get total daily hours across ALL jobs
    const crossDaily = crossProgramMap[name]?._daily || {};
    const crossAvgDay = workedDates.length > 0
      ? workedDates.reduce((s, dt) => s + (crossDaily[dt]?.totalHrs || days[dt]?.hours || 0), 0) / workedDates.length
      : avgDayThisJob;

    // Only flag low hours if they're low even accounting for ALL campaigns
    const lowDays = workedDates.filter(d => {
      const crossHrs = crossDaily[d]?.totalHrs || days[d]?.hours || 0;
      return crossHrs > 0 && crossHrs < 7;
    });
    if (lowDays.length > 0 && lowDays.length / workedDates.length >= 0.5) {
      // Check if they work other programs
      const otherProgs = new Set();
      workedDates.forEach(dt => {
        const progs = crossDaily[dt]?.programs || {};
        Object.keys(progs).forEach(p => { if (p !== currentJobType) otherProgs.add(p); });
      });
      if (otherProgs.size > 0) {
        out.push(`${first} averages ${avgDayThisJob.toFixed(1)} hrs/day in this program (${crossAvgDay.toFixed(1)} hrs/day total across ${otherProgs.size + 1} programs: ${currentJobType}, ${[...otherProgs].join(", ")})`);
      } else {
        out.push(`${first} averages ${crossAvgDay.toFixed(1)} hrs/day across ${workedDates.length} days — below 8-hr expectation`);
      }
    }

    // Per-week low hours — cross-reference all programs, skip partial weeks
    const agentWeekHours = {};
    (s.rows || []).filter(r => r.agentName === name && r.weekNum).forEach(r => {
      agentWeekHours[r.weekNum] = (agentWeekHours[r.weekNum] || 0) + r.hours;
    });
    for (const [wk, hrsThisJob] of Object.entries(agentWeekHours)) {
      const elapsedDays = weekElapsedBDays(wk);
      const expected = elapsedDays * 8;
      if (expected <= 0) continue;

      // Cross-program total for this week
      const crossWeek = crossProgramMap[name]?.[wk];
      const totalHrsAllJobs = crossWeek?.totalHrs || hrsThisJob;
      const otherProgs = crossWeek?.programs ? Object.keys(crossWeek.programs).filter(p => p !== currentJobType) : [];

      // Only flag if total across ALL programs is low for the elapsed days
      if (totalHrsAllJobs < expected * 0.6) {
        const splitDetails = otherProgs.length > 0 ? (() => {
          const parts = [`${currentJobType} (${fmt(hrsThisJob,1)}h)`];
          otherProgs.forEach(p => {
            const pd = crossWeek?.programs?.[p];
            if (!pd) return;
            const ph = typeof pd === "number" ? pd : pd?.hrs || 0;
            const pg = typeof pd === "number" ? 0 : pd?.goals || 0;
            const pgph = ph > 0 ? (pg / ph).toFixed(3) : "0";
            parts.push(`${p} (${fmt(ph,1)}h, ${pg} sales, ${pgph} GPH)`);
          });
          return ` — split across: ${parts.join(", ")}`;
        })() : "";
        out.push(`${first} logged ${fmt(totalHrsAllJobs, 1)} total hrs in ${weekLabel(wk)} (${elapsedDays}-day week, expected ~${expected} hrs)${splitDetails}`);
      } else if (hrsThisJob < expected * 0.5 && otherProgs.length > 0) {
        // Low in THIS program but fine overall — show detailed breakdown of other programs
        const progDetails = otherProgs.map(p => {
          const pd = crossWeek?.programs?.[p];
          if (!pd || typeof pd === "number") return `${p} ${fmt(typeof pd === "number" ? pd : pd?.hrs || 0, 1)}h`;
          const progGph = pd.hrs > 0 ? (pd.goals / pd.hrs).toFixed(3) : "0";
          const dateList = pd.dates ? [...pd.dates].sort() : [];
          const dateRange = dateList.length > 1 ? `${dateList[0]} \u2192 ${dateList[dateList.length-1]}` : dateList[0] || "";
          return `${p}: ${fmt(pd.hrs, 1)}h, ${pd.goals} sales, ${progGph} GPH${dateRange ? ` (${dateRange})` : ""}`;
        });
        out.push(`${first}: ${fmt(hrsThisJob, 1)} hrs in ${weekLabel(wk)} for this program (${fmt(totalHrsAllJobs, 1)} hrs total). Other programs: ${progDetails.join("; ")}`);
      }
    }

    // Multi-day gap: 3+ calendar days absent then returned
    for (let i = 1; i < workedDates.length; i++) {
      const diff = Math.round((new Date(workedDates[i]) - new Date(workedDates[i-1])) / 86400000);
      if (diff >= 5) {
        // Show what they did on the days around the gap
        const returnDate = workedDates[i];
        const lastBefore = workedDates[i-1];
        const crossDaily = crossProgramMap[name]?._daily || {};

        // Performance on last day before absence
        const beforeDay = crossDaily[lastBefore];
        const beforeDetail = beforeDay ? Object.entries(beforeDay.programs).map(([p, pd]) => {
          const ph = typeof pd === "number" ? pd : pd?.hrs || 0;
          const pg = typeof pd === "number" ? 0 : pd?.goals || 0;
          return `${p}: ${fmt(ph, 1)}h, ${pg} sales`;
        }).join("; ") : "";

        // Performance on return day
        const returnDay = crossDaily[returnDate];
        const returnDetail = returnDay ? Object.entries(returnDay.programs).map(([p, pd]) => {
          const ph = typeof pd === "number" ? pd : pd?.hrs || 0;
          const pg = typeof pd === "number" ? 0 : pd?.goals || 0;
          return `${p}: ${fmt(ph, 1)}h, ${pg} sales`;
        }).join("; ") : "";

        let gapMsg = `${first} missed ${diff - 1} days (last worked ${lastBefore}`;
        if (beforeDetail) gapMsg += ` [${beforeDetail}]`;
        gapMsg += ` \u2192 returned ${returnDate}`;
        if (returnDetail) gapMsg += ` [${returnDetail}]`;
        gapMsg += ")";
        out.push(gapMsg);
        i++;
      }
    }
  }

  // ── Team-level week insights ──────────────────────────────────────────────
  if (supWeeks.length > 1) {
    supWeeks.forEach(w => {
      const bdays    = weekElapsedBDays(w.week);
      const expected = (s.uNames || 1) * bdays * 8;
      if ((w.hours || 0) > 0 && (w.hours || 0) < expected * 0.70) {
        out.push(`Team-wide low hours in ${weekLabel(w.week)}: ${fmt(w.hours||0,0)} hrs vs ~${fmt(expected*0.8,0)} expected (${bdays}-day week${bdays < weekDays(w.week) ? ", partial week" : ""})`);
      }
    });

    // GPH trend
    const nonNull = supWeeks.filter(w => w.gph);
    if (nonNull.length >= 2) {
      const first = nonNull[0].gph, last = nonNull[nonNull.length-1].gph;
      const trend = ((last - first) / first) * 100;
      if (Math.abs(trend) >= 10)
        out.push(`GPH ${trend > 0 ? "↑ up" : "↓ down"} ${Math.abs(trend).toFixed(0)}% from ${weekLabel(nonNull[0].week)} to ${weekLabel(nonNull[nonNull.length-1].week)}`);
    }

    // High variance
    const gphVals = supWeeks.map(w => w.gph).filter(Boolean);
    if (gphVals.length > 2) {
      const mean = gphVals.reduce((a,b)=>a+b,0)/gphVals.length;
      const std  = Math.sqrt(gphVals.reduce((a,v)=>a+(v-mean)**2,0)/gphVals.length);
      if (std/mean > 0.2) out.push(`High week-to-week GPH variance (σ=${std.toFixed(3)}) — inconsistent output`);
    }

    // Best week
    const best = [...supWeeks].filter(w=>w.gph).sort((a,b)=>b.gph-a.gph)[0];
    if (best) out.push(`Best week: ${weekLabel(best.week)} — ${best.gph.toFixed(3)} GPH, ${fmt(best.hours||0,0)} hours`);
  }

  // Q4 concentration
  const q4Rate = s.uNames > 0 ? s.distU.Q4 / s.uNames : 0;
  if (q4Rate > 0.4) out.push(`${Math.round(q4Rate*100)}% of team in Q4 — high proportion below goal`);

  if (!out.length) out.push("No attendance anomalies detected.");
  return out;
}

function SupervisorCard({ s, rank, totalSups, maxGph, supWeeks, hasDates, sphGoal, selectedAgent, setSelectedAgent, crossProgramMap, lastDataDate, jobType }) {
  const [showInsights, setShowInsights] = useState(false);
  const weekPoints = hasDates ? [...supWeeks].reverse().map(w => w.gph) : [];
  const barW  = (s.gph / maxGph) * 100;
  const color = sphGoal ? attainColor((s.gph / sphGoal) * 100) : attainColor(s.q1Rate);
  const isTop = rank === 0;
  const isBot = rank === totalSups - 1 && rank > 0;

  const insights = buildSupInsights(s, supWeeks, crossProgramMap, lastDataDate, jobType);

  return (
    <div style={{ padding: "1rem", background: `var(--bg-primary)`, borderRadius: "10px", border: `1px solid ${color}22` }}>
      {/* Header row */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "0.6rem" }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            {isTop && <span style={{ fontFamily: "monospace", fontSize: "1.17rem", color: "#d97706", background: "#d9770618", border: "1px solid #d9770640", borderRadius: "3px", padding: "0.05rem 0.3rem" }}>TOP</span>}
            {isBot && <span style={{ fontFamily: "monospace", fontSize: "1.17rem", color: "#dc2626", background: "#dc262618", border: "1px solid #dc262640", borderRadius: "3px", padding: "0.05rem 0.3rem" }}>LAGGING</span>}
            <span style={{ fontFamily: "Georgia, serif", fontSize: "1.38rem", color: `var(--text-warm)` }}>{s.supervisor}</span>
          </div>
          <div style={{ fontFamily: "monospace", fontSize: "0.99rem", color: `var(--text-dim)`, marginTop: "0.15rem" }}>
            {s.uNames} agents · {fmt(s.totalHours, 0)} hrs · {s.totalGoals.toLocaleString()} goals · {s.totalHsd} HSD · {s.totalXm} XM
          </div>
        </div>
        <div style={{ display: "flex", gap: "1.25rem", alignItems: "center" }}>
          {hasDates && weekPoints.length > 1 && (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "0.2rem" }}>
              <Sparkline points={weekPoints} color={color} width={90} height={32} />
              <TrendArrow points={weekPoints} />
            </div>
          )}
          <div style={{ textAlign: "right" }}>
            <div style={{ fontFamily: "'Cormorant Garamond', Georgia, serif", fontSize: "2.25rem", color, fontWeight: 700, lineHeight: 1 }}>{s.gph.toFixed(3)}</div>
            <div style={{ fontFamily: "monospace", fontSize: "1.08rem", color: `var(--text-dim)` }}>GPH</div>
          </div>
        </div>
      </div>

      {/* GPH bar */}
      <div style={{ display: "flex", height: "4px", background: `var(--bg-tertiary)`, borderRadius: "2px", overflow: "hidden", marginBottom: "0.6rem" }}>
        <div style={{ width: `${barW}%`, background: color, borderRadius: "2px", transition: "width 0.5s" }} />
      </div>

      {/* Quartile mix */}
      <div style={{ display: "flex", gap: "0.75rem", alignItems: "center", marginBottom: "0.5rem" }}>
        {["Q1","Q2","Q3","Q4"].map(q => (
          <span key={q} style={{ fontFamily: "monospace", fontSize: "1.14rem", color: Q[q].color }}>
            {q}: {s.distU[q]}
          </span>
        ))}
        <span style={{ fontFamily: "monospace", fontSize: "1.14rem", color: "#d97706" }}>Q1 rate: {s.q1Rate.toFixed(0)}%</span>
      </div>

      {/* Weekly breakdown */}
      {hasDates && supWeeks.length > 0 && (
        <div style={{ display: "flex", gap: "0.75rem", overflowX: "auto", marginBottom: "0.6rem", paddingBottom: "0.25rem" }}>
          {[...supWeeks].reverse().map(w => (
              <div key={w.week} style={{ textAlign: "center" }}>
                <div style={{ fontFamily: "monospace", fontSize: "1.11rem", color: w.gph ? attainColor(sphGoal ? (w.gph/sphGoal)*100 : w.q1Rate) : `var(--text-faint)`, fontWeight: 600 }}>
                  {w.gph ? w.gph.toFixed(3) : "—"}
                </div>
                <div style={{ fontFamily: "monospace", fontSize: "0.99rem", color: `var(--text-muted)` }}>{weekLabel(w.week)}</div>
                <div style={{ fontFamily: "monospace", fontSize: "0.81rem", color: `var(--text-faint)` }}>{fmt(w.hours||0, 0)} hours</div>
              </div>
            ))}
          </div>
        )}

      {/* Attendance & consistency insights dropdown */}
      <div style={{ borderTop: "1px solid var(--bg-tertiary)", paddingTop: "0.5rem", marginBottom: "0.5rem" }}>
        <button onClick={() => setShowInsights(v => !v)}
          style={{ background: "transparent", border: "none", cursor: "pointer", display: "flex", alignItems: "center", gap: "0.4rem",
            fontFamily: "monospace", fontSize: "1.11rem", color: `var(--text-dim)`, padding: 0 }}>
          <span>{showInsights ? "▾" : "▸"}</span>
          Attendance &amp; Consistency Insights
        </button>
        {showInsights && (
          <div style={{ marginTop: "0.5rem", display: "flex", flexDirection: "column", gap: "0.3rem" }}>
            {insights.map((txt, i) => (
              <div key={i} style={{ fontFamily: "monospace", fontSize: "1.11rem", color: `var(--text-secondary)`,
                background: `var(--bg-secondary)`, borderRadius: "4px", padding: "0.3rem 0.6rem",
                borderLeft: `2px solid ${color}66` }}>
                {txt}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Agent chips */}
      <div style={{ display: "flex", gap: "0.35rem", flexWrap: "wrap" }}>
        {s.agentList.map(a => (
          <button key={a.agentName} onClick={() => setSelectedAgent(selectedAgent === a.agentName ? null : a.agentName)}
            style={{ fontFamily: "monospace", fontSize: "1.08rem", padding: "0.2rem 0.5rem", borderRadius: "3px", cursor: "pointer",
              background: selectedAgent===a.agentName ? Q[a.quartile].color+"33" : Q[a.quartile].color+"12",
              border: `1px solid ${Q[a.quartile].color}${selectedAgent===a.agentName?"88":"33"}`,
              color: selectedAgent===a.agentName ? `var(--text-warm)` : Q[a.quartile].color }}>
            {a.agentName.split(" ")[0]}
            <span style={{ opacity: 0.7, marginLeft: "0.3rem" }}>
              {fmt(a.totalHours, 0)}h · {a.totalGoals}g · {a.aggGph.toFixed(3)}
              {a.totalHsd > 0 && <span style={{ color: "#2563eb" }}> · {a.totalHsd}H</span>}
              {a.totalXm > 0 && <span style={{ color: "#8b5cf6" }}> · {a.totalXm}X</span>}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

function TeamsView({ agents, jobType, sphGoal, allAgents }) {
  const [selectedAgent, setSelectedAgent] = useState(null);
  const [teamRegion,    setTeamRegion]    = useState("All");

  const teamRegColor = r => {
    const u = (r || "").toUpperCase();
    if (u.includes("XOTM") && u.includes("BELIZE"))     return "#16a34a";
    if (u.includes("XOTM") && u.includes("OW"))         return "#2563eb";
    if (u.includes("XOTM") && u.includes("SAN"))        return "#d97706";
    if (u.includes("SD"))                                 return "#6366f1";
    return "#8b5cf6";
  };
  const supStats   = useMemo(() => buildSupervisorStats(agents), [agents]);
  const { weeks, bySupervisor, programWeekly } = useMemo(() => buildWeeklyRollup(agents), [agents]);
  const hasDates   = weeks.length > 0;
  const hasSups    = supStats.some(s => s.supervisor !== "Unknown");

  // Cross-program hours lookup: agentName → { [weekNum]: { totalHrs, programs: {jobType: hrs} } }
  const crossProgramMap = useMemo(() => {
    const map = {};
    (allAgents || []).forEach(a => {
      if (!a.agentName || !a.weekNum) return;
      if (!map[a.agentName]) map[a.agentName] = {};
      if (!map[a.agentName][a.weekNum]) map[a.agentName][a.weekNum] = { totalHrs: 0, totalGoals: 0, programs: {} };
      map[a.agentName][a.weekNum].totalHrs += a.hours;
      map[a.agentName][a.weekNum].totalGoals += a.goals;
      const jt = a.jobType || "Unknown";
      if (!map[a.agentName][a.weekNum].programs[jt]) map[a.agentName][a.weekNum].programs[jt] = { hrs: 0, goals: 0, dates: new Set() };
      map[a.agentName][a.weekNum].programs[jt].hrs += a.hours;
      map[a.agentName][a.weekNum].programs[jt].goals += a.goals;
      if (a.date) map[a.agentName][a.weekNum].programs[jt].dates.add(a.date);
    });
    // Also build per-agent per-date cross-program totals
    (allAgents || []).forEach(a => {
      if (!a.agentName || !a.date) return;
      if (!map[a.agentName]) map[a.agentName] = {};
      if (!map[a.agentName]._daily) map[a.agentName]._daily = {};
      if (!map[a.agentName]._daily[a.date]) map[a.agentName]._daily[a.date] = { totalHrs: 0, totalGoals: 0, programs: {} };
      map[a.agentName]._daily[a.date].totalHrs += a.hours;
      map[a.agentName]._daily[a.date].totalGoals += a.goals;
      const jt = a.jobType || "Unknown";
      if (!map[a.agentName]._daily[a.date].programs[jt]) map[a.agentName]._daily[a.date].programs[jt] = { hrs: 0, goals: 0 };
      map[a.agentName]._daily[a.date].programs[jt].hrs += a.hours;
      map[a.agentName]._daily[a.date].programs[jt].goals += a.goals;
    });
    return map;
  }, [allAgents]);

  // Last date in the dataset — used to detect incomplete current week
  const lastDataDate = useMemo(() => {
    const dates = (allAgents || []).map(a => a.date).filter(Boolean).sort();
    return dates.length > 0 ? dates[dates.length - 1] : null;
  }, [allAgents]);

  // Unique regions across all agents in this program
  const uniqueRegions = useMemo(() => {
    const regs = new Set(agents.map(a => a.region).filter(Boolean));
    return [...regs].sort();
  }, [agents]);

  // Filter supervisor stats by region
  const filteredSupStats = useMemo(() => {
    if (teamRegion === "All") return supStats;
    return supStats.map(s => {
      const filteredAgents = s.agentList.filter(a => a.region === teamRegion);
      if (filteredAgents.length === 0) return null;
      const totalGoals = filteredAgents.reduce((sum, a) => sum + a.totalGoals, 0);
      const totalHours = filteredAgents.reduce((sum, a) => sum + a.totalHours, 0);
      const totalHsd   = filteredAgents.reduce((sum, a) => sum + a.totalHsd, 0);
      const totalXm    = filteredAgents.reduce((sum, a) => sum + a.totalXm, 0);
      const gph        = totalHours > 0 ? totalGoals / totalHours : 0;
      const distU      = { Q1: 0, Q2: 0, Q3: 0, Q4: 0 };
      filteredAgents.forEach(a => { if (distU[a.quartile] !== undefined) distU[a.quartile]++; });
      const uNames = filteredAgents.length;
      const q1Rate = uNames > 0 ? (distU.Q1 / uNames) * 100 : 0;
      return { ...s, totalGoals, totalHours, totalHsd, totalXm, gph, distU, uNames, q1Rate, agentList: filteredAgents };
    }).filter(Boolean).sort((a, b) => b.gph - a.gph);
  }, [supStats, teamRegion]);

  // All dates in dataset for attendance grid
  const allDates = useMemo(() =>
    [...new Set(agents.filter(a => a.date).map(a => a.date))].sort(),
    [agents]);

  // Agent daily profile when one is selected
  const agentProfile = useMemo(() =>
    selectedAgent ? buildAgentDailyProfile(selectedAgent, jobType, agents) : null,
    [selectedAgent, jobType, agents]);

  // For the agent picker: unique agents with their aggregate stats
  const agentRollups = useMemo(() => {
    const seen = {};
    agents.forEach(a => {
      if (!a.agentName) return;
      if (!seen[a.agentName]) seen[a.agentName] = { ...a.aggRollup, agentName: a.agentName, quartile: a.quartile, supervisor: a.supervisor, region: a.region };
    });
    return Object.values(seen).sort((a, b) => (b.totalGoals||0) - (a.totalGoals||0));
  }, [agents]);

  if (!hasSups && !hasDates) {
    return (
      <div style={{ background: `var(--bg-secondary)`, border: "1px solid var(--border)", borderRadius: "12px", padding: "2rem", textAlign: "center", color: `var(--text-faint)`, fontFamily: "Georgia, serif" }}>
        No supervisor or date data found in this file.
      </div>
    );
  }

  // ── Agent Daily Profile panel ──────────────────────────────────────────────
  const AgentProfilePanel = ({ profile }) => {
    if (!profile) return null;
    const { days, workedDays, absentDays, lowHourDays, strongDays,
            gphMean, consistency, currentStreak, longestStreak, sphGoal: sg } = profile;

    const worked = days.filter(d => d.worked);
    const totalHsd = worked.reduce((s, d) => s + (d.hsd || 0), 0);
    const totalXm  = worked.reduce((s, d) => s + (d.xm || 0), 0);
    const totalGoals = worked.reduce((s, d) => s + d.goals, 0);
    const totalHours = worked.reduce((s, d) => s + d.hours, 0);
    const overallGph = totalHours > 0 ? totalGoals / totalHours : 0;

    // Group days by week for weekly subtotals
    const weekGroups = [];
    let curWeek = null;
    days.forEach(d => {
      // Use ISO week: Mon-based
      const dt = new Date(d.date + "T00:00:00");
      const dayOfWeek = dt.getDay();
      // Week label = Monday's date of this week
      const mon = new Date(dt);
      mon.setDate(dt.getDate() - ((dayOfWeek + 6) % 7));
      const wk = mon.toISOString().slice(0, 10);
      if (!curWeek || curWeek.wk !== wk) {
        curWeek = { wk, days: [] };
        weekGroups.push(curWeek);
      }
      curWeek.days.push(d);
    });

    const dayLabel = dateStr => {
      const dt = new Date(dateStr + "T00:00:00");
      const names = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
      return names[dt.getDay()];
    };

    return (
      <div style={{ background: `var(--bg-secondary)`, border: "1px solid var(--border)", borderRadius: "12px", padding: "1.5rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "1.25rem" }}>
          <div>
            <div style={{ fontFamily: "monospace", fontSize: "1.14rem", color: `var(--text-muted)`, letterSpacing: "0.12em", textTransform: "uppercase" }}>Agent Daily Profile</div>
            <div style={{ fontFamily: "'Cormorant Garamond', Georgia, serif", fontSize: "2.25rem", color: `var(--text-warm)`, fontWeight: 700 }}>{profile.agentName}</div>
            <div style={{ fontFamily: "monospace", fontSize: "1.14rem", color: `var(--text-dim)`, marginTop: "0.2rem" }}>{profile.supervisor} · {profile.jobType} · {profile.quartile}</div>
          </div>
          <button onClick={() => setSelectedAgent(null)}
            style={{ background: "transparent", border: "1px solid var(--text-faint)", borderRadius: "4px", color: `var(--text-muted)`, fontFamily: "monospace", fontSize: "1.08rem", padding: "0.25rem 0.6rem", cursor: "pointer" }}>✕ close</button>
        </div>

        {/* KPI mini-strip */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(8, 1fr)", gap: "0.5rem", marginBottom: "1.25rem" }}>
          {[
            { label: "Days Worked",   value: workedDays,              color: "#16a34a" },
            { label: "Days Absent",   value: absentDays,              color: absentDays > 5 ? "#dc2626" : `var(--text-dim)` },
            { label: "Avg GPH",       value: gphMean.toFixed(3),      color: sg > 0 ? attainColor((gphMean / sg) * 100) : `var(--text-dim)` },
            { label: "Strong Days",   value: strongDays,              color: "#2563eb" },
            { label: "Consistency",   value: `${consistency.toFixed(0)}%`, color: consistency >= 70 ? "#16a34a" : consistency >= 40 ? "#d97706" : "#dc2626" },
            { label: "Cur. Streak",   value: currentStreak,           color: currentStreak >= 5 ? "#16a34a" : `var(--text-dim)` },
            { label: "Total HSD",     value: totalHsd,                color: "#2563eb" },
            { label: "Total XM",      value: totalXm,                 color: "#8b5cf6" },
          ].map(c => (
            <div key={c.label} style={{ background: `var(--bg-primary)`, borderRadius: "8px", padding: "0.5rem", textAlign: "center", border: `1px solid ${c.color}22` }}>
              <div style={{ fontFamily: "'Cormorant Garamond', Georgia, serif", fontSize: "1.65rem", color: c.color, fontWeight: 700 }}>{c.value}</div>
              <div style={{ fontFamily: "monospace", fontSize: "0.9rem", color: `var(--text-dim)`, marginTop: "0.1rem" }}>{c.label}</div>
            </div>
          ))}
        </div>

        {/* Daily performance table — grouped by week */}
        <div style={{ fontFamily: "monospace", fontSize: "1.08rem", color: `var(--text-muted)`, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: "0.5rem" }}>
          Daily Performance Breakdown
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "monospace", fontSize: "1.05rem" }}>
            <thead>
              <tr style={{ borderBottom: "2px solid var(--border)" }}>
                {["Date","Day","Hours","Goals","GPH","HSD","XM","% to Goal"].map(h => (
                  <th key={h} style={{ padding: "0.4rem 0.6rem", textAlign: h === "Date" || h === "Day" ? "left" : "right",
                    fontWeight: 400, color: `var(--text-dim)`, whiteSpace: "nowrap" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {weekGroups.map((wg, wi) => {
                const wWorked = wg.days.filter(d => d.worked);
                const wHrs = wWorked.reduce((s, d) => s + d.hours, 0);
                const wGoals = wWorked.reduce((s, d) => s + d.goals, 0);
                const wHsd = wWorked.reduce((s, d) => s + (d.hsd || 0), 0);
                const wXm = wWorked.reduce((s, d) => s + (d.xm || 0), 0);
                const wGph = wHrs > 0 ? wGoals / wHrs : 0;
                const wPct = sg > 0 && wHrs > 0 ? (wGph / sg) * 100 : null;
                return [
                  ...wg.days.map((d, di) => {
                    if (d.absent) {
                      return (
                        <tr key={d.date} style={{ background: `var(--bg-primary)`, opacity: 0.4 }}>
                          <td style={{ padding: "0.35rem 0.6rem", color: `var(--text-faint)` }}>{d.date?.slice(5)}</td>
                          <td style={{ padding: "0.35rem 0.6rem", color: `var(--text-faint)` }}>{dayLabel(d.date)}</td>
                          <td colSpan={6} style={{ padding: "0.35rem 0.6rem", textAlign: "center", color: `var(--text-faint)`, fontStyle: "italic" }}>absent</td>
                        </tr>
                      );
                    }
                    const pct = d.pct;
                    const pctColor = pct !== null ? attainColor(pct) : `var(--text-faint)`;
                    const gphColor = sg > 0 ? attainColor((d.gph / sg) * 100) : `var(--text-dim)`;
                    const hrsColor = d.hours < 4 ? "#dc2626" : d.hours < 6 ? "#d97706" : `var(--text-secondary)`;
                    return (
                      <tr key={d.date} style={{ borderBottom: "1px solid var(--bg-tertiary)",
                        background: di % 2 === 0 ? "transparent" : `var(--bg-row-alt)` }}>
                        <td style={{ padding: "0.35rem 0.6rem", color: `var(--text-secondary)` }}>{d.date?.slice(5)}</td>
                        <td style={{ padding: "0.35rem 0.6rem", color: `var(--text-dim)` }}>{dayLabel(d.date)}</td>
                        <td style={{ padding: "0.35rem 0.6rem", textAlign: "right", color: hrsColor }}>{d.hours.toFixed(1)}</td>
                        <td style={{ padding: "0.35rem 0.6rem", textAlign: "right", color: d.goals > 0 ? "#d97706" : `var(--text-faint)`, fontWeight: d.goals > 0 ? 700 : 400 }}>{d.goals || "—"}</td>
                        <td style={{ padding: "0.35rem 0.6rem", textAlign: "right", color: gphColor, fontWeight: 600 }}>{d.gph !== null && d.gph > 0 ? d.gph.toFixed(3) : "—"}</td>
                        <td style={{ padding: "0.35rem 0.6rem", textAlign: "right", color: d.hsd > 0 ? "#2563eb" : `var(--text-faint)`, fontWeight: d.hsd > 0 ? 700 : 400 }}>{d.hsd || "—"}</td>
                        <td style={{ padding: "0.35rem 0.6rem", textAlign: "right", color: d.xm > 0 ? "#8b5cf6" : `var(--text-faint)`, fontWeight: d.xm > 0 ? 700 : 400 }}>{d.xm || "—"}</td>
                        <td style={{ padding: "0.35rem 0.6rem", textAlign: "right" }}>
                          {pct !== null ? (
                            <span style={{ color: pctColor, fontWeight: 700, background: pctColor + "12", border: `1px solid ${pctColor}30`, borderRadius: "3px", padding: "0.1rem 0.35rem" }}>
                              {Math.round(pct)}%
                            </span>
                          ) : "—"}
                        </td>
                      </tr>
                    );
                  }),
                  // Weekly subtotal row
                  wWorked.length > 0 && (
                    <tr key={`wk-${wg.wk}`} style={{ borderBottom: "2px solid var(--border)", background: `var(--bg-tertiary)` }}>
                      <td colSpan={2} style={{ padding: "0.4rem 0.6rem", color: `var(--text-muted)`, fontWeight: 700 }}>
                        Wk {wg.wk.slice(5)}
                      </td>
                      <td style={{ padding: "0.4rem 0.6rem", textAlign: "right", color: `var(--text-secondary)`, fontWeight: 700 }}>{wHrs.toFixed(1)}</td>
                      <td style={{ padding: "0.4rem 0.6rem", textAlign: "right", color: wGoals > 0 ? "#d97706" : `var(--text-faint)`, fontWeight: 700 }}>{wGoals || "—"}</td>
                      <td style={{ padding: "0.4rem 0.6rem", textAlign: "right", color: sg > 0 ? attainColor((wGph / sg) * 100) : `var(--text-dim)`, fontWeight: 700 }}>{wGph > 0 ? wGph.toFixed(3) : "—"}</td>
                      <td style={{ padding: "0.4rem 0.6rem", textAlign: "right", color: wHsd > 0 ? "#2563eb" : `var(--text-faint)`, fontWeight: 700 }}>{wHsd || "—"}</td>
                      <td style={{ padding: "0.4rem 0.6rem", textAlign: "right", color: wXm > 0 ? "#8b5cf6" : `var(--text-faint)`, fontWeight: 700 }}>{wXm || "—"}</td>
                      <td style={{ padding: "0.4rem 0.6rem", textAlign: "right" }}>
                        {wPct !== null ? (
                          <span style={{ color: attainColor(wPct), fontWeight: 700 }}>{Math.round(wPct)}%</span>
                        ) : "—"}
                      </td>
                    </tr>
                  ),
                  false && (() => {
                    const wkAgents = activeAgents.filter(a => {
                      if (!a.date) return false;
                      const dt = new Date(a.date + "T00:00:00");
                      const dayOfWeek = dt.getDay();
                      const mon = new Date(dt);
                      mon.setDate(dt.getDate() - ((dayOfWeek + 6) % 7));
                      return mon.toISOString().slice(0, 10) === wg.wk && a.hours > 0;
                    });
                    const byJob = {};
                    wkAgents.forEach(a => {
                      const jt = a.jobType || "Unknown";
                      if (!byJob[jt]) byJob[jt] = { hrs: 0, goals: 0, agents: {} };
                      byJob[jt].hrs += a.hours;
                      byJob[jt].goals += a.goals;
                      if (!byJob[jt].agents[a.agentName]) byJob[jt].agents[a.agentName] = { name: a.agentName, sup: a.supervisor, hrs: 0, goals: 0, hsd: 0, xm: 0, quartile: a.quartile };
                      byJob[jt].agents[a.agentName].hrs += a.hours;
                      byJob[jt].agents[a.agentName].goals += a.goals;
                      byJob[jt].agents[a.agentName].hsd += a.newXI || 0;
                      byJob[jt].agents[a.agentName].xm += a.xmLines || 0;
                    });
                    const jobs = Object.entries(byJob).sort((a, b) => b[1].goals - a[1].goals);
                    return (
                      <tr key={`wk-detail-${wg.wk}`}><td colSpan={9} style={{ padding: 0 }}>
                        <div style={{ padding: "0.6rem 1rem", background: "#6366f108", borderLeft: "3px solid #6366f1" }}>
                          <div style={{ fontFamily: "monospace", fontSize: "0.85rem", color: `var(--text-faint)`, letterSpacing: "0.08em", marginBottom: "0.5rem" }}>
                            WEEK DETAIL \u2014 Wk {wg.wk.slice(5)} ({wWorked.length} days worked)
                          </div>
                          {jobs.map(([jt, data]) => {
                            const agentList = Object.values(data.agents).sort((x, y) => y.hrs - x.hrs);
                            return (
                              <div key={jt} style={{ marginBottom: "0.6rem" }}>
                                <div style={{ fontFamily: "Georgia, serif", fontSize: "1.05rem", color: `var(--text-warm)`, marginBottom: "0.25rem" }}>
                                  <span style={{ fontWeight: 700 }}>{jt}</span>
                                  <span style={{ fontFamily: "monospace", fontSize: "0.9rem", color: `var(--text-dim)`, marginLeft: "0.75rem" }}>{agentList.length} agents \u00b7 {data.goals} sales \u00b7 {data.hrs.toFixed(1)} hrs \u00b7 {data.hrs > 0 ? (data.goals / data.hrs).toFixed(3) : "0"} GPH</span>
                                </div>
                                <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "monospace", fontSize: "0.88rem" }}>
                                  <thead><tr style={{ borderBottom: "1px solid var(--border)" }}>
                                    {["Agent","Supervisor","Hours","Sales","GPH","HSD","XM"].map(h => (
                                      <th key={h} style={{ padding: "0.2rem 0.5rem", textAlign: h === "Agent" || h === "Supervisor" ? "left" : "right", color: `var(--text-faint)`, fontWeight: 400 }}>{h}</th>
                                    ))}
                                  </tr></thead>
                                  <tbody>
                                    {agentList.map((a, ai) => {
                                      const aGph = a.hrs > 0 ? a.goals / a.hrs : 0;
                                      const qColor = Q[a.quartile]?.color || `var(--text-faint)`;
                                      return (
                                        <tr key={a.name} style={{ borderBottom: "1px solid var(--bg-tertiary)", background: ai % 2 === 0 ? "transparent" : `var(--bg-row-alt)` }}>
                                          <td style={{ padding: "0.2rem 0.5rem", color: qColor }}>{a.name}</td>
                                          <td style={{ padding: "0.2rem 0.5rem", color: `var(--text-dim)` }}>{a.sup || "\u2014"}</td>
                                          <td style={{ padding: "0.2rem 0.5rem", textAlign: "right", color: "#6366f1" }}>{a.hrs.toFixed(1)}</td>
                                          <td style={{ padding: "0.2rem 0.5rem", textAlign: "right", color: a.goals > 0 ? "#d97706" : `var(--text-faint)`, fontWeight: a.goals > 0 ? 700 : 400 }}>{a.goals || "\u2014"}</td>
                                          <td style={{ padding: "0.2rem 0.5rem", textAlign: "right", color: sg ? attainColor(aGph / sg * 100) : `var(--text-secondary)` }}>{aGph > 0 ? aGph.toFixed(3) : "\u2014"}</td>
                                          <td style={{ padding: "0.2rem 0.5rem", textAlign: "right", color: a.hsd > 0 ? "#2563eb" : `var(--text-faint)` }}>{a.hsd || "\u2014"}</td>
                                          <td style={{ padding: "0.2rem 0.5rem", textAlign: "right", color: a.xm > 0 ? "#8b5cf6" : `var(--text-faint)` }}>{a.xm || "\u2014"}</td>
                                        </tr>
                                      );
                                    })}
                                  </tbody>
                                </table>
                              </div>
                            );
                          })}
                        </div>
                      </td></tr>
                    );
                  })(),
                ];
              })}
            </tbody>
            <tfoot>
              <tr style={{ borderTop: "2px solid var(--border)", background: `var(--bg-row-alt)` }}>
                <td colSpan={2} style={{ padding: "0.5rem 0.6rem", color: `var(--text-warm)`, fontWeight: 700 }}>TOTAL</td>
                <td style={{ padding: "0.5rem 0.6rem", textAlign: "right", color: `var(--text-warm)`, fontWeight: 700 }}>{totalHours.toFixed(1)}</td>
                <td style={{ padding: "0.5rem 0.6rem", textAlign: "right", color: totalGoals > 0 ? "#d97706" : `var(--text-faint)`, fontWeight: 700 }}>{totalGoals || "—"}</td>
                <td style={{ padding: "0.5rem 0.6rem", textAlign: "right", color: sg > 0 ? attainColor((overallGph / sg) * 100) : `var(--text-dim)`, fontWeight: 700 }}>{overallGph > 0 ? overallGph.toFixed(3) : "—"}</td>
                <td style={{ padding: "0.5rem 0.6rem", textAlign: "right", color: totalHsd > 0 ? "#2563eb" : `var(--text-faint)`, fontWeight: 700 }}>{totalHsd || "—"}</td>
                <td style={{ padding: "0.5rem 0.6rem", textAlign: "right", color: totalXm > 0 ? "#8b5cf6" : `var(--text-faint)`, fontWeight: 700 }}>{totalXm || "—"}</td>
                <td style={{ padding: "0.5rem 0.6rem", textAlign: "right" }}>
                  {sg > 0 ? (
                    <span style={{ color: attainColor((overallGph / sg) * 100), fontWeight: 700, background: attainColor((overallGph / sg) * 100) + "12", border: `1px solid ${attainColor((overallGph / sg) * 100)}30`, borderRadius: "3px", padding: "0.1rem 0.35rem" }}>
                      {Math.round((overallGph / sg) * 100)}%
                    </span>
                  ) : "—"}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>

        {/* Attendance gap callouts */}
        {(() => {
          const gaps = [];
          for (let i = 1; i < days.length; i++) {
            if (days[i].absent && days[i-1].worked) {
              let gapLen = 0;
              while (i + gapLen < days.length && days[i + gapLen].absent) gapLen++;
              if (gapLen >= 2) gaps.push({ start: days[i].date, len: gapLen });
            }
          }
          if (!gaps.length) return null;
          return (
            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginTop: "0.75rem" }}>
              {gaps.map((g, i) => (
                <div key={i} style={{ fontFamily: "monospace", fontSize: "1.11rem", color: "#d97706", background: "#d9770612", border: "1px solid #d9770630", borderRadius: "4px", padding: "0.2rem 0.5rem" }}>
                  {g.len}-day gap starting {g.start}
                </div>
              ))}
            </div>
          );
        })()}
      </div>
    );
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>

      {/* Teams Executive Summary */}
      <CollapsibleNarrative
        title={`Teams Summary \u2014 ${jobType}`}
        lines={generateTeamsNarrative({ jobType, uniqueAgentCount: uniqueNames(agents).size }, agents)}
        defaultOpen={false}
      />

      {/* Weekly Program Trend */}
      {hasDates && programWeekly.length > 1 && (
        <div style={{ background: `var(--bg-secondary)`, border: "1px solid var(--border)", borderRadius: "12px", padding: "1.5rem" }}>
          <div style={{ fontFamily: "monospace", fontSize: "1.14rem", color: `var(--text-muted)`, letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: "1.1rem" }}>
            Weekly Trend — {jobType}
          </div>
          <div style={{ display: "flex", gap: "0.5rem", alignItems: "flex-end", minHeight: "96px" }}>
            {[...programWeekly].reverse().map(w => {
              const maxGph = Math.max(...programWeekly.map(x => x.gph || 0), 0.001);
              const barH   = w.gph ? Math.max(4, (w.gph / maxGph) * 80) : 2;
              const color  = sphGoal ? attainColor((w.gph || 0) / sphGoal * 100) : "#d97706";
              return (
                <div key={w.week} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: "0.25rem", justifyContent: "flex-end" }}>
                  <div style={{ fontFamily: "monospace", fontSize: "1.08rem", color }}>{w.gph ? w.gph.toFixed(3) : "—"}</div>
                  <div style={{ width: "100%", height: `${barH}px`, background: color, borderRadius: "3px 3px 0 0", opacity: 0.85 }} />
                  <div style={{ fontFamily: "monospace", fontSize: "1.17rem", color: `var(--text-dim)`, textAlign: "center" }}>{weekLabel(w.week)}</div>
                  <div style={{ fontFamily: "monospace", fontSize: "0.99rem", color: `var(--text-faint)`, textAlign: "center" }}>{fmt(w.hours||0,0)} hours</div>
                  <div style={{ fontFamily: "monospace", fontSize: "0.81rem", color: `var(--text-faint)` }}>{w.goals}G · {w.agentCount}A</div>
                </div>
              );
            })}
          </div>
          {sphGoal && <div style={{ fontFamily: "monospace", fontSize: "1.11rem", color: `var(--text-dim)`, marginTop: "0.5rem" }}>Goal: {sphGoal.toFixed(3)} GPH</div>}
        </div>
      )}

      {/* Region Drilldown with Supervisor Cards */}
      <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>

        {/* Region tabs */}
        {uniqueRegions.length > 0 && (
          <div style={{ display: "flex", gap: "0.35rem", flexWrap: "wrap" }}>
            {["All", ...uniqueRegions].map(r => {
              const active = teamRegion === r;
              const btnColor = r === "All" ? `var(--text-muted)` : teamRegColor(r);
              return (
                <button key={r} onClick={() => { setTeamRegion(r); setSelectedAgent(null); }}
                  style={{ background: active ? (r === "All" ? `var(--text-muted)` : btnColor) + "20" : "transparent",
                    border: `1px solid ${active ? (r === "All" ? `var(--text-muted)` : btnColor) : `var(--border)`}`, borderRadius: "5px",
                    color: active ? (r === "All" ? `var(--text-muted)` : btnColor) : `var(--text-dim)`,
                    padding: "0.25rem 0.65rem", fontFamily: "monospace", fontSize: "1.05rem", cursor: "pointer", transition: "all 0.15s" }}>
                  {r}
                </button>
              );
            })}
          </div>
        )}

        {/* Region summary cards when "All" is selected */}
        {teamRegion === "All" && uniqueRegions.length > 1 && (
          <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.min(uniqueRegions.length, 4)}, 1fr)`, gap: "0.75rem" }}>
            {uniqueRegions.map(reg => {
              const regClr = teamRegColor(reg);
              const ra = agents.filter(a => a.region === reg);
              const rHrs = ra.reduce((s, a) => s + a.hours, 0);
              const rGoals = ra.reduce((s, a) => s + a.goals, 0);
              const rGph = rHrs > 0 ? rGoals / rHrs : 0;
              const rCount = new Set(ra.map(a => a.agentName).filter(Boolean)).size;
              const rDistU = uniqueQuartileDist(ra);
              return (
                <div key={reg} onClick={() => { setTeamRegion(reg); setSelectedAgent(null); }}
                  style={{ padding: "0.9rem", borderRadius: "10px", background: regClr + "08", border: `1px solid ${regClr}30`, cursor: "pointer", transition: "all 0.15s" }}>
                  <div style={{ fontFamily: "Georgia, serif", fontSize: "1.25rem", color: regClr, fontWeight: 700, marginBottom: "0.3rem" }}>{reg}</div>
                  <div style={{ fontFamily: "monospace", fontSize: "0.9rem", color: `var(--text-dim)` }}>{rCount} agents</div>
                  <div style={{ fontFamily: "'Cormorant Garamond', Georgia, serif", fontSize: "2rem", color: `var(--text-warm)`, fontWeight: 700, lineHeight: 1, margin: "0.3rem 0" }}>{rGph.toFixed(3)}</div>
                  <div style={{ fontFamily: "monospace", fontSize: "0.85rem", color: `var(--text-dim)` }}>GPH · {rGoals} sales · {fmt(rHrs, 0)} hrs</div>
                  <div style={{ display: "flex", gap: "0.4rem", marginTop: "0.3rem" }}>
                    {["Q1","Q2","Q3","Q4"].map(q => (
                      <span key={q} style={{ fontFamily: "monospace", fontSize: "0.85rem", color: Q[q].color }}>{q}:{rDistU[q]}</span>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Supervisor cards grouped by region */}
        {(() => {
          const visibleSups = filteredSupStats.filter(s => s.supervisor !== "Unknown");
          const regionsToShow = teamRegion === "All"
            ? [...new Set(visibleSups.flatMap(s => s.agentList.map(a => a.region)).filter(Boolean))].sort()
            : [teamRegion];

          if (regionsToShow.length <= 1 && teamRegion !== "All") {
            return (
              <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                {visibleSups.map((s, rank) => (
                  <div key={s.supervisor}>
                    <SupervisorCard s={s} rank={rank} totalSups={visibleSups.length} maxGph={Math.max(...visibleSups.map(x => x.gph), 0.001)} supWeeks={bySupervisor[s.supervisor] || []} hasDates={hasDates} sphGoal={sphGoal} selectedAgent={selectedAgent} setSelectedAgent={setSelectedAgent} crossProgramMap={crossProgramMap} lastDataDate={lastDataDate} jobType={jobType} />
                    {selectedAgent && agentProfile && s.agentList.some(a => a.agentName === selectedAgent) && (
                      <div style={{ marginTop: "0.75rem" }}><AgentProfilePanel profile={agentProfile} /></div>
                    )}
                  </div>
                ))}
              </div>
            );
          }

          return regionsToShow.map(reg => {
            const regClr = teamRegColor(reg);
            const regSups = visibleSups.filter(s => s.agentList.some(a => a.region === reg));
            if (regSups.length === 0) return null;
            const regAgentNames = new Set(regSups.flatMap(s => s.agentList.filter(a => a.region === reg).map(a => a.agentName)));
            const regHrs = regSups.reduce((s2, s) => s2 + s.agentList.filter(a => a.region === reg).reduce((h, a) => h + a.totalHours, 0), 0);
            const regGoals = regSups.reduce((s2, s) => s2 + s.agentList.filter(a => a.region === reg).reduce((h, a) => h + a.totalGoals, 0), 0);
            const regGph = regHrs > 0 ? regGoals / regHrs : 0;

            return (
              <div key={reg}>
                {regionsToShow.length > 1 && (
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0.6rem 0.75rem", background: regClr + "10", border: `1px solid ${regClr}30`, borderRadius: "8px", marginBottom: "0.75rem" }}>
                    <div style={{ display: "flex", gap: "0.75rem", alignItems: "center" }}>
                      <span style={{ fontFamily: "Georgia, serif", fontSize: "1.35rem", color: regClr, fontWeight: 700 }}>{reg}</span>
                      <span style={{ fontFamily: "monospace", fontSize: "0.95rem", color: `var(--text-dim)` }}>{regAgentNames.size} agents · {regSups.length} sup{regSups.length !== 1 ? "s" : ""}</span>
                    </div>
                    <div style={{ display: "flex", gap: "1rem", fontFamily: "monospace", fontSize: "0.95rem" }}>
                      <span style={{ color: "#16a34a" }}>{regGoals} sales</span>
                      <span style={{ color: "#6366f1" }}>{fmt(regHrs, 0)} hrs</span>
                      <span style={{ color: regClr, fontWeight: 700 }}>{regGph.toFixed(3)} GPH</span>
                    </div>
                  </div>
                )}
                <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", marginBottom: "1.25rem" }}>
                  {regSups.map((s, rank) => (
                    <div key={s.supervisor}>
                      <SupervisorCard s={s} rank={rank} totalSups={regSups.length} maxGph={Math.max(...regSups.map(x => x.gph), 0.001)} supWeeks={bySupervisor[s.supervisor] || []} hasDates={hasDates} sphGoal={sphGoal} selectedAgent={selectedAgent} setSelectedAgent={setSelectedAgent} crossProgramMap={crossProgramMap} lastDataDate={lastDataDate} jobType={jobType} />
                      {selectedAgent && agentProfile && s.agentList.some(a => a.agentName === selectedAgent) && (
                        <div style={{ marginTop: "0.75rem" }}><AgentProfilePanel profile={agentProfile} /></div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            );
          });
        })()}
      </div>
    </div>
  );
}




// \u2550/ ══════════════════════════════════════════════════════════════════════════════
// ══════════════════════════════════════════════════════════════════════════════
// SECTION 12c — CAMPAIGN COMPARISON PANEL (Month-over-Month)
// ══════════════════════════════════════════════════════════════════════════════

// Replaces Spanish Callback. Shows all job types with MoM agent
// job type with MoM agent % to goal comparisons.

function buildMoMAgentStats(currentAgents, priorAgents) {
  const rollup = (rows) => {
    const map = {};
    rows.forEach(a => {
      const n = a.agentName;
      if (!n) return;
      if (!map[n]) map[n] = { hours: 0, goals: 0, goalsNum: 0, newXI: 0, xmLines: 0, newXH: 0, newVideo: 0, newVoice: 0, region: a.region, supervisor: a.supervisor };
      map[n].hours += a.hours; map[n].goals += a.goals; map[n].goalsNum += a.goalsNum;
      map[n].newXI += a.newXI; map[n].xmLines += a.xmLines; map[n].newXH += a.newXH;
      map[n].newVideo += a.newVideo; map[n].newVoice += (a.newVoice || 0);
    });
    return map;
  };
  const cur = rollup(currentAgents), prev = rollup(priorAgents);
  const allNames = [...new Set([...Object.keys(cur), ...Object.keys(prev)])].sort();
  return allNames.map(name => {
    const c = cur[name] || { hours:0, goals:0, goalsNum:0, newXI:0, xmLines:0, newXH:0, newVideo:0, newVoice:0 };
    const p = prev[name] || { hours:0, goals:0, goalsNum:0, newXI:0, xmLines:0, newXH:0, newVideo:0, newVoice:0 };
    const curPct = c.goalsNum > 0 ? (c.goals / c.goalsNum) * 100 : 0;
    const prevPct = p.goalsNum > 0 ? (p.goals / p.goalsNum) * 100 : 0;
    const curGph = c.hours > 0 ? c.goals / c.hours : 0;
    const prevGph = p.hours > 0 ? p.goals / p.hours : 0;
    return { name, inCurrent: !!cur[name], inPrior: !!prev[name],
      region: (cur[name]||prev[name]).region||"", supervisor: (cur[name]||prev[name]).supervisor||"",
      cur: { ...c, pct: curPct, gph: curGph }, prev: { ...p, pct: prevPct, gph: prevGph }, delta: curPct - prevPct };
  });
}

function CampaignComparisonPanel({ currentAgents, onNav }) {
  const [activeJobType, setActiveJobType] = useState(null);
  const [sortCol, setSortCol] = useState("delta");
  const [sortDir, setSortDir] = useState(-1);
  const [siteFilter, setSiteFilter] = useState("ALL"); // ALL | DR | BZ
  const [hideLeft, setHideLeft] = useState(true);
  const [expandedAgent, setExpandedAgent] = useState(null);

  // Self-contained prior month data (persisted to localStorage)
  const [priorRaw, _setPriorRaw] = useState(() => {
    try { const s = localStorage.getItem(PRIOR_MONTH_STORAGE_KEY); return s ? JSON.parse(s) : null; } catch(e) { return null; }
  });
  const setPriorRaw = useCallback(data => {
    _setPriorRaw(data);
    try { if (data) localStorage.setItem(PRIOR_MONTH_STORAGE_KEY, JSON.stringify(data)); else localStorage.removeItem(PRIOR_MONTH_STORAGE_KEY); } catch(e) {}
  }, []);
  const [priorGoalsRaw, _setPriorGoalsRaw] = useState(() => {
    try { const s = localStorage.getItem(PRIOR_MONTH_STORAGE_KEY + "_goals"); return s ? JSON.parse(s) : null; } catch(e) { return null; }
  });
  const setPriorGoalsRaw = useCallback(data => {
    _setPriorGoalsRaw(data);
    try { if (data) localStorage.setItem(PRIOR_MONTH_STORAGE_KEY + "_goals", JSON.stringify(data)); else localStorage.removeItem(PRIOR_MONTH_STORAGE_KEY + "_goals"); } catch(e) {}
  }, []);
  const priorDataRef = useRef();
  const priorGoalsRef = useRef();
  const loadFileCamp = (f, setter) => { const r = new FileReader(); r.onload = e => setter(parseCSV(e.target.result)); r.readAsText(f); };
  const priorAgents = useMemo(() => normalizeAgents(priorRaw || []), [priorRaw]);
  const priorGoalLookup = useMemo(() => buildGoalLookup(priorGoalsRaw), [priorGoalsRaw]);

  // Fiscal pacing from current month data
  const fiscalInfo = useMemo(() => {
    const dates = [...new Set(currentAgents.filter(a => a.date).map(a => a.date))];
    return getFiscalMonthInfo(dates);
  }, [currentAgents]);
  const pctElapsed = fiscalInfo ? fiscalInfo.pctElapsed / 100 : 0; // 0-1

  // Site filter helper: map region to DR/BZ
  const agentSite = (a) => REGION_TO_SITE[a.region] || "DR";
  const filterBySite = (agents) => {
    if (siteFilter === "ALL") return agents;
    return agents.filter(a => agentSite(a) === siteFilter);
  };

  const allJobTypes = useMemo(() => {
    const jts = new Set([
      ...currentAgents.filter(a => !a.isSpanishCallback).map(a => a.jobType),
      ...priorAgents.filter(a => !a.isSpanishCallback).map(a => a.jobType),
    ]);
    return [...jts].filter(Boolean).sort();
  }, [currentAgents, priorAgents]);

  useEffect(() => { if (allJobTypes.length > 0 && !activeJobType) setActiveJobType(allJobTypes[0]); }, [allJobTypes, activeJobType]);

  const agentStats = useMemo(() => {
    if (!activeJobType) return [];
    const curFiltered = filterBySite(currentAgents.filter(a => a.jobType === activeJobType));
    const prevFiltered = filterBySite(priorAgents.filter(a => a.jobType === activeJobType));
    const stats = buildMoMAgentStats(curFiltered, prevFiltered);
    if (pctElapsed > 0) {
      stats.forEach(a => {
        if (a.inCurrent && a.cur.goalsNum > 0) {
          const projectedGoals = a.cur.goals / pctElapsed;
          a.pacedPct = (projectedGoals / a.cur.goalsNum) * 100;
        } else { a.pacedPct = null; }
      });
    }
    return stats;
  }, [activeJobType, currentAgents, priorAgents, siteFilter, pctElapsed]);

  const summary = useMemo(() => {
    if (!agentStats.length) return null;
    const withBoth = agentStats.filter(a => a.inCurrent && a.inPrior);
    const improvedCount = withBoth.filter(a => a.delta > 0).length;
    const declinedCount = withBoth.filter(a => a.delta < 0).length;
    const avgDelta = withBoth.length > 0 ? withBoth.reduce((s, a) => s + a.delta, 0) / withBoth.length : 0;
    const cur = agentStats.filter(a => a.inCurrent), prev = agentStats.filter(a => a.inPrior);
    const sC = (k) => cur.reduce((s, a) => s + a.cur[k], 0);
    const sP = (k) => prev.reduce((s, a) => s + a.prev[k], 0);
    return { curAgents: cur.length, prevAgents: prev.length, improvedCount, declinedCount, avgDelta,
      curGoals: sC("goals"), prevGoals: sP("goals"), curHours: sC("hours"), prevHours: sP("hours"),
      curGph: sC("hours") > 0 ? sC("goals") / sC("hours") : 0, prevGph: sP("hours") > 0 ? sP("goals") / sP("hours") : 0,
      curHsd: sC("newXI"), prevHsd: sP("newXI"), curXm: sC("xmLines"), prevXm: sP("xmLines"),
      curXh: sC("newXH"), prevXh: sP("newXH"), curXv: sC("newVideo"), prevXv: sP("newVideo"),
      curPhone: sC("newVoice"), prevPhone: sP("newVoice"),
      topMovers: [...withBoth].sort((a, b) => b.delta - a.delta).slice(0, 3),
      bottomMovers: [...withBoth].sort((a, b) => a.delta - b.delta).slice(0, 3),
      pacedGoals: pctElapsed > 0 ? Math.round(sC("goals") / pctElapsed) : null,
      pacedHsd: pctElapsed > 0 ? Math.round(sC("newXI") / pctElapsed) : null,
      pacedXm: pctElapsed > 0 ? Math.round(sC("xmLines") / pctElapsed) : null,
      pacedXh: pctElapsed > 0 ? Math.round(sC("newXH") / pctElapsed) : null,
      pacedXv: pctElapsed > 0 ? Math.round(sC("newVideo") / pctElapsed) : null,
      pacedPhone: pctElapsed > 0 ? Math.round(sC("newVoice") / pctElapsed) : null,
      pacedHours: pctElapsed > 0 ? Math.round(sC("hours") / pctElapsed) : null,
      pacedGph: (pctElapsed > 0 && sC("hours") > 0) ? (sC("goals") / sC("hours")) : null };
  }, [agentStats, pctElapsed]);

  const sorted = useMemo(() => {
    const arr = [...agentStats];
    const getVal = (a) => {
      const m = { name: a.name.toLowerCase(), prevPct: a.prev.pct, curPct: a.cur.pct, delta: a.delta,
        prevHours: a.prev.hours, curHours: a.cur.hours, curGoals: a.cur.goals, curGph: a.cur.gph, curHsd: a.cur.newXI, curXm: a.cur.xmLines,
        curXh: a.cur.newXH, curXv: a.cur.newVideo, curPhone: a.cur.newVoice, prevGph: a.prev.gph, curGphCol: a.cur.gph };
      return m[sortCol] !== undefined ? m[sortCol] : a.delta;
    };
    arr.sort((a, b) => { const va = getVal(a), vb = getVal(b);
      return typeof va === "string" ? sortDir * va.localeCompare(vb) : sortDir * (va - vb); });
    return arr;
  }, [agentStats, sortCol, sortDir]);

  const handleSort = (col) => { if (sortCol === col) setSortDir(d => -d); else { setSortCol(col); setSortDir(-1); } };
  const sortArrow = (col) => sortCol === col ? (sortDir === -1 ? " \u25BC" : " \u25B2") : "";

  const MetricMoM = ({ label, curVal, prevVal, pacedVal, fmtFn }) => {
    const d = curVal - prevVal;
    const color = d > 0 ? "#16a34a" : d < 0 ? "#dc2626" : "var(--text-dim)";
    const arrow = d > 0 ? "\u25B2" : d < 0 ? "\u25BC" : "\u2013";
    const disp = fmtFn || (v => v.toLocaleString());
    return (<div style={{ display:"grid", gridTemplateColumns:"7rem 5rem 5rem 5rem 5.5rem", gap:"0.5rem", alignItems:"center", padding:"0.45rem 0", borderBottom:"1px solid var(--bg-tertiary)" }}>
      <div style={{ fontFamily:"monospace", fontSize:"0.95rem", color:"var(--text-muted)" }}>{label}</div>
      <div style={{ fontFamily:"monospace", fontSize:"0.95rem", color:"var(--text-dim)", textAlign:"right" }}>{disp(prevVal)}</div>
      <div style={{ fontFamily:"monospace", fontSize:"0.95rem", color:"var(--text-primary)", textAlign:"right", fontWeight:600 }}>{disp(curVal)}</div>
      <div style={{ fontFamily:"monospace", fontSize:"0.95rem", color:pacedVal!=null?(pacedVal>prevVal?"#16a34a":pacedVal<prevVal?"#dc2626":"var(--text-dim)"):"var(--text-faint)", textAlign:"right", fontWeight:600, fontStyle:"italic" }}>{pacedVal != null ? disp(Math.round(pacedVal)) : "—"}</div>
      <div style={{ fontFamily:"monospace", fontSize:"0.95rem", color, textAlign:"right", fontWeight:600 }}>{arrow} {disp(Math.abs(d))}</div>
    </div>);
  };

  return (
    <div style={{ padding:"2rem 2.5rem", minHeight:"90vh", background:"var(--bg-primary)" }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:"1.5rem" }}>
        <div>
          <div style={{ fontFamily:"monospace", fontSize:"1.08rem", color:"var(--text-dim)", letterSpacing:"0.15em" }}>CAMPAIGN COMPARISON \u00B7 Month over Month</div>
          <div style={{ fontFamily:"'Cormorant Garamond', Georgia, serif", fontSize:"3.38rem", color:"var(--text-warm)", fontWeight:700, letterSpacing:"-0.5px", lineHeight:1.1 }}>Campaign Analysis</div>
        </div>
        <button onClick={() => onNav(-1)} style={{ background:"transparent", border:"1px solid var(--border-muted)", borderRadius:"5px", color:"var(--text-muted)", padding:"0.3rem 0.8rem", fontFamily:"monospace", fontSize:"1.05rem", cursor:"pointer" }}>{"\u2190"} Back</button>
      </div>

      {/* Data upload strip */}
      <div style={{ background:"var(--bg-secondary)", border:"1px solid var(--border)", borderRadius:"12px", padding:"1.25rem", marginBottom:"1.5rem", display:"flex", gap:"1rem", alignItems:"center", flexWrap:"wrap" }}>
        <div style={{ fontFamily:"monospace", fontSize:"1.08rem", color:"var(--text-muted)", letterSpacing:"0.1em", marginRight:"0.5rem" }}>DATA</div>
        <button onClick={() => priorDataRef.current.click()}
          style={{ background:priorRaw?"#6366f118":"transparent", border:`1px solid ${priorRaw?"#6366f1":"var(--border-muted)"}`, borderRadius:"5px", color:priorRaw?"#6366f1":"var(--text-muted)", padding:"0.35rem 0.9rem", fontFamily:"monospace", fontSize:"1.08rem", cursor:"pointer" }}>
          {priorRaw ? `Prior Month Data (${priorAgents.length} rows)` : "Upload Prior Month Data"}
        </button>
        {priorRaw && <button onClick={() => setPriorRaw(null)} title="Clear" style={{ background:"transparent", border:"1px solid var(--text-faint)", borderRadius:"5px", color:"var(--text-dim)", padding:"0.2rem 0.5rem", fontFamily:"monospace", fontSize:"1.08rem", cursor:"pointer" }}>{"✕"}</button>}
        <input ref={priorDataRef} type="file" accept=".csv" style={{ display:"none" }} onChange={e => { if (e.target.files[0]) loadFileCamp(e.target.files[0], setPriorRaw); e.target.value=""; }} />
        <div style={{ width:"1px", height:"24px", background:"var(--border)", margin:"0 0.25rem" }} />
        <button onClick={() => priorGoalsRef.current.click()}
          style={{ background:priorGoalsRaw?"#16a34a18":"transparent", border:`1px solid ${priorGoalsRaw?"#16a34a":"var(--border-muted)"}`, borderRadius:"5px", color:priorGoalsRaw?"#16a34a":"var(--text-muted)", padding:"0.35rem 0.9rem", fontFamily:"monospace", fontSize:"1.08rem", cursor:"pointer" }}>
          {priorGoalsRaw ? "Prior Month Goals" : "Upload Prior Month Goals"}
        </button>
        {priorGoalsRaw && <button onClick={() => setPriorGoalsRaw(null)} title="Clear" style={{ background:"transparent", border:"1px solid var(--text-faint)", borderRadius:"5px", color:"var(--text-dim)", padding:"0.2rem 0.5rem", fontFamily:"monospace", fontSize:"1.08rem", cursor:"pointer" }}>{"✕"}</button>}
        <input ref={priorGoalsRef} type="file" accept=".csv" style={{ display:"none" }} onChange={e => { if (e.target.files[0]) loadFileCamp(e.target.files[0], setPriorGoalsRaw); e.target.value=""; }} />
        {(priorRaw || priorGoalsRaw) && <div style={{ marginLeft:"auto", fontFamily:"monospace", fontSize:"0.9rem", color:"var(--text-faint)" }}>saved to browser</div>}
      </div>

      {priorAgents.length === 0 ? (
        <div style={{ background:"var(--bg-secondary)", border:"1px solid #6366f130", borderRadius:"12px", padding:"3rem", textAlign:"center" }}>
          <div style={{ fontFamily:"Georgia, serif", fontSize:"1.5rem", color:"var(--text-warm)", marginBottom:"0.75rem" }}>Upload Prior Month Data to Begin</div>
          <div style={{ fontFamily:"monospace", fontSize:"1.11rem", color:"var(--text-dim)", maxWidth:"500px", margin:"0 auto" }}>Use the buttons above to load your prior month performance data CSV and optionally the prior month goals CSV.</div>
        </div>
      ) : allJobTypes.length === 0 ? (
        <div style={{ background:"var(--bg-secondary)", border:"1px solid var(--border)", borderRadius:"12px", padding:"3rem", textAlign:"center" }}>
          <div style={{ fontFamily:"Georgia, serif", fontSize:"1.5rem", color:"var(--text-warm)", marginBottom:"0.75rem" }}>No Job Types Found</div>
          <div style={{ fontFamily:"monospace", fontSize:"1.11rem", color:"var(--text-dim)" }}>No job types were found across either dataset.</div>
        </div>
      ) : (<>
        <div style={{ display:"flex", gap:"0.4rem", flexWrap:"wrap", marginBottom:"1.5rem" }}>
          {allJobTypes.map(jt => (<button key={jt} onClick={() => setActiveJobType(jt)}
            style={{ padding:"0.45rem 1.1rem", borderRadius:"6px", border:`1px solid ${activeJobType===jt?"#d97706":"var(--border)"}`, background:activeJobType===jt?"#d9770618":"transparent", color:activeJobType===jt?"#d97706":"var(--text-muted)", fontFamily:"monospace", fontSize:"1.11rem", cursor:"pointer", fontWeight:activeJobType===jt?600:400 }}>{jt}</button>))}
        </div>
        <div style={{ display:"flex", gap:"0.5rem", alignItems:"center", marginBottom:"1.25rem" }}>
          <div style={{ fontFamily:"monospace", fontSize:"0.95rem", color:"var(--text-faint)", marginRight:"0.25rem" }}>SITE</div>
          {["ALL","DR","BZ"].map(s => (<button key={s} onClick={() => setSiteFilter(s)}
            style={{ padding:"0.3rem 0.9rem", borderRadius:"5px", border:`1px solid ${siteFilter===s?"#6366f1":"var(--border)"}`, background:siteFilter===s?"#6366f118":"transparent", color:siteFilter===s?"#818cf8":"var(--text-muted)", fontFamily:"monospace", fontSize:"1.05rem", cursor:"pointer", fontWeight:siteFilter===s?600:400 }}>{s}</button>))}
          {fiscalInfo && <div style={{ marginLeft:"auto", fontFamily:"monospace", fontSize:"0.95rem", color:"var(--text-faint)" }}>
            Pacing: {fiscalInfo.elapsedBDays}/{fiscalInfo.totalBDays} biz days ({Math.round(fiscalInfo.pctElapsed)}%) {"·"} through {fiscalInfo.lastDataDate}
          </div>}
        </div>
        {activeJobType && summary && (<>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(4, 1fr)", gap:"0.75rem", marginBottom:"1.5rem" }}>
            <StatCard label="Current Agents" value={summary.curAgents} sub={`vs ${summary.prevAgents} prior`} accent="#6366f1" />
            <StatCard label={`Avg \u0394 % to Goal`} value={`${summary.avgDelta >= 0 ? "+" : ""}${summary.avgDelta.toFixed(1)}%`} sub={`${summary.improvedCount} improved \u00B7 ${summary.declinedCount} declined`} accent={summary.avgDelta >= 0 ? "#16a34a" : "#dc2626"} />
            <StatCard label="Current Sales" value={summary.curGoals.toLocaleString()} sub={`vs ${summary.prevGoals.toLocaleString()} prior`} accent="#16a34a" />
            <StatCard label="Current Hours" value={fmt(summary.curHours, 0)} sub={`vs ${fmt(summary.prevHours, 0)} prior`} accent="#2563eb" />
          </div>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"1.25rem", marginBottom:"1.5rem" }}>
            <div style={{ background:"var(--bg-secondary)", border:"1px solid var(--border)", borderRadius:"12px", padding:"1.25rem" }}>
              <div style={{ fontFamily:"monospace", fontSize:"1.08rem", color:"#d97706", letterSpacing:"0.12em", textTransform:"uppercase", marginBottom:"0.75rem" }}>Month-over-Month Metrics</div>
              <div style={{ display:"grid", gridTemplateColumns:"7rem 5rem 5rem 5rem 5.5rem", gap:"0.5rem", padding:"0 0 0.4rem 0", borderBottom:"1px solid var(--border)", marginBottom:"0.25rem" }}>
                {["Metric","Prior","Current","Paced","Change"].map(h => (<div key={h} style={{ fontFamily:"monospace", fontSize:"0.85rem", color:"var(--text-faint)", textTransform:"uppercase", letterSpacing:"0.06em", textAlign:h==="Metric"?"left":"right" }}>{h}</div>))}
              </div>
              <MetricMoM label="Hours" curVal={summary.curHours} prevVal={summary.prevHours} pacedVal={summary.pacedHours} fmtFn={v => fmt(v, 0)} />
              <MetricMoM label="Sales" curVal={summary.curGoals} prevVal={summary.prevGoals} pacedVal={summary.pacedGoals} />
              <MetricMoM label="GPH" curVal={summary.curGph} prevVal={summary.prevGph} pacedVal={summary.pacedGph} fmtFn={v => typeof v === "number" ? v.toFixed(3) : "0"} />
              <MetricMoM label="New HSD" curVal={summary.curHsd} prevVal={summary.prevHsd} pacedVal={summary.pacedHsd} />
              <MetricMoM label="New XM" curVal={summary.curXm} prevVal={summary.prevXm} pacedVal={summary.pacedXm} />
              <MetricMoM label="New XH" curVal={summary.curXh} prevVal={summary.prevXh} pacedVal={summary.pacedXh} />
              <MetricMoM label="New XV" curVal={summary.curXv} prevVal={summary.prevXv} pacedVal={summary.pacedXv} />
              <MetricMoM label="New Phone" curVal={summary.curPhone} prevVal={summary.prevPhone} pacedVal={summary.pacedPhone} />
            </div>
            <div style={{ display:"flex", flexDirection:"column", gap:"1rem" }}>
              <div style={{ background:"var(--bg-secondary)", border:"1px solid #16a34a25", borderRadius:"12px", padding:"1.25rem", flex:1 }}>
                <div style={{ fontFamily:"monospace", fontSize:"1.08rem", color:"#16a34a", letterSpacing:"0.12em", textTransform:"uppercase", marginBottom:"0.6rem" }}>Top Improvers</div>
                {summary.topMovers.filter(a => a.delta > 0).length === 0
                  ? <div style={{ color:"var(--text-faint)", fontFamily:"Georgia, serif" }}>No agents improved</div>
                  : summary.topMovers.filter(a => a.delta > 0).map((a, i) => (
                    <div key={a.name} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"0.4rem 0", borderBottom:i<2?"1px solid var(--bg-tertiary)":"none" }}>
                      <div><div style={{ fontFamily:"Georgia, serif", fontSize:"1.15rem", color:"var(--text-warm)" }}>{a.name}</div>
                        <div style={{ fontFamily:"monospace", fontSize:"0.9rem", color:"var(--text-dim)" }}>{fmtPct(a.prev.pct)} {"\u2192"} {fmtPct(a.cur.pct)}</div></div>
                      <div style={{ fontFamily:"'Cormorant Garamond', Georgia, serif", fontSize:"1.65rem", color:"#16a34a", fontWeight:700 }}>+{fmtPct(a.delta)}</div>
                    </div>))}
              </div>
              <div style={{ background:"var(--bg-secondary)", border:"1px solid #dc262625", borderRadius:"12px", padding:"1.25rem", flex:1 }}>
                <div style={{ fontFamily:"monospace", fontSize:"1.08rem", color:"#dc2626", letterSpacing:"0.12em", textTransform:"uppercase", marginBottom:"0.6rem" }}>Biggest Declines</div>
                {summary.bottomMovers.filter(a => a.delta < 0).length === 0
                  ? <div style={{ color:"var(--text-faint)", fontFamily:"Georgia, serif" }}>No agents declined</div>
                  : summary.bottomMovers.filter(a => a.delta < 0).map((a, i) => (
                    <div key={a.name} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"0.4rem 0", borderBottom:i<2?"1px solid var(--bg-tertiary)":"none" }}>
                      <div><div style={{ fontFamily:"Georgia, serif", fontSize:"1.15rem", color:"var(--text-warm)" }}>{a.name}</div>
                        <div style={{ fontFamily:"monospace", fontSize:"0.9rem", color:"var(--text-dim)" }}>{fmtPct(a.prev.pct)} {"\u2192"} {fmtPct(a.cur.pct)}</div></div>
                      <div style={{ fontFamily:"'Cormorant Garamond', Georgia, serif", fontSize:"1.65rem", color:"#dc2626", fontWeight:700 }}>{fmtPct(a.delta)}</div>
                    </div>))}
              </div>
            </div>
          </div>
          <div style={{ background:"var(--bg-secondary)", border:"1px solid var(--border)", borderRadius:"12px", padding:"1.25rem" }}>
            <div style={{ fontFamily:"monospace", fontSize:"1.08rem", color:"var(--text-muted)", letterSpacing:"0.12em", textTransform:"uppercase", marginBottom:"0.75rem", display:"flex", alignItems:"center" }}>
              Agent Detail {"\u2014"} {activeJobType} {"\u00B7"} {sorted.filter(a => !hideLeft || a.inCurrent).length} agents {"\u00B7"} click headers to sort
                <button onClick={() => setHideLeft(v => !v)}
                  style={{ marginLeft:"1rem", padding:"0.2rem 0.7rem", borderRadius:"4px", border:`1px solid ${hideLeft?"var(--border)":"#6366f1"}`, background:hideLeft?"transparent":"#6366f118", color:hideLeft?"var(--text-muted)":"#818cf8", fontFamily:"monospace", fontSize:"0.88rem", cursor:"pointer" }}>
                  {hideLeft ? "Show Removed" : "Hide Removed"}
                </button>
            </div>
            <div style={{ overflowX:"auto" }}>
              <table style={{ width:"100%", borderCollapse:"collapse", fontFamily:"monospace", fontSize:"0.9rem" }}>
                <thead><tr style={{ borderBottom:"2px solid var(--border)" }}>
                  {[{key:"name",label:"Agent",align:"left"},{key:"prevHours",label:"Prev Hrs",align:"right"},{key:"curHours",label:"Hours",align:"right"},{key:"curGoals",label:"Sales",align:"right"},{key:"curGph",label:"GPH",align:"right"},
                    {key:"curHsd",label:"New HSD",align:"right"},{key:"curXm",label:"New XM",align:"right"},{key:"curXh",label:"New XH",align:"right"},
                    {key:"curXv",label:"New XV",align:"right"},{key:"curPhone",label:"New Phone",align:"right"},
                    {key:"prevGph",label:"Prev GPH",align:"right"},{key:"curGphCol",label:"Cur GPH",align:"right"},
                    {key:"prevPct",label:"Prior %",align:"right"},{key:"curPct",label:"Current %",align:"right"},{key:"delta",label:"\u0394",align:"right"}
                  ].map(col => (<th key={col.key} onClick={() => handleSort(col.key)}
                    style={{ padding:"0.5rem 0.6rem", textAlign:col.align, color:"var(--text-muted)", cursor:"pointer", userSelect:"none", whiteSpace:"nowrap", fontWeight:sortCol===col.key?700:400, letterSpacing:"0.04em", fontSize:"0.85rem", borderLeft:["prevGph","curHsd"].includes(col.key)?"2px solid var(--border)":"none" }}>{col.label}{sortArrow(col.key)}</th>))}
                </tr></thead>
                <tbody>{sorted.filter(a => !hideLeft || a.inCurrent).flatMap((a, idx) => {
                  const dColor = a.delta > 0 ? "#16a34a" : a.delta < 0 ? "#dc2626" : "var(--text-dim)";
                  const stripe = idx % 2 === 1 ? "var(--bg-tertiary)" : "transparent";
                  const rowBg = a.delta > 15 ? "#16a34a0c" : a.delta < -15 ? "#dc26260c" : stripe;
                  const rows = [<tr key={a.name} style={{ borderBottom:"1px solid var(--border)", background:rowBg }}>
                    <td style={{ padding:"0.5rem 0.6rem", color:"var(--text-warm)", fontFamily:"Georgia, serif", fontSize:"1.05rem", whiteSpace:"nowrap", cursor:"pointer" }} onClick={() => setExpandedAgent(expandedAgent === a.name ? null : a.name)}>
                      <span style={{ borderBottom:expandedAgent===a.name?"2px solid #d97706":"1px dashed var(--border)", paddingBottom:"1px" }}>{a.name}</span>
                      {!a.inPrior && <span style={{ fontSize:"0.78rem", color:"#d97706", background:"#d9770620", padding:"0.05rem 0.3rem", borderRadius:"2px", marginLeft:"0.3rem" }}>NEW</span>}
                      {!a.inCurrent && <span style={{ fontSize:"0.78rem", color:"#6366f1", background:"#6366f120", padding:"0.05rem 0.3rem", borderRadius:"2px", marginLeft:"0.3rem" }}>LEFT</span>}
                    </td>
                    <td style={{ padding:"0.5rem 0.6rem", textAlign:"right", color:"var(--text-dim)" }}>{a.inPrior ? fmt(a.prev.hours, 1) : "\u2014"}</td>
                    <td style={{ padding:"0.5rem 0.6rem", textAlign:"right", color:"var(--text-secondary)" }}>{fmt(a.cur.hours, 1)}</td>
                    <td style={{ padding:"0.5rem 0.6rem", textAlign:"right", color:"var(--text-secondary)" }}>{a.cur.goals}</td>
                    <td style={{ padding:"0.5rem 0.6rem", textAlign:"right", color:"var(--text-secondary)" }}>{a.cur.gph > 0 ? a.cur.gph.toFixed(3) : "—"}</td>
                    <td style={{ padding:"0.5rem 0.6rem", textAlign:"right", color:"var(--text-secondary)", borderLeft:"2px solid var(--border)" }}>{a.cur.newXI}</td>
                    <td style={{ padding:"0.5rem 0.6rem", textAlign:"right", color:"var(--text-secondary)" }}>{a.cur.xmLines}</td>
                    <td style={{ padding:"0.5rem 0.6rem", textAlign:"right", color:"var(--text-secondary)" }}>{a.cur.newXH}</td>
                    <td style={{ padding:"0.5rem 0.6rem", textAlign:"right", color:"var(--text-secondary)" }}>{a.cur.newVideo}</td>
                    <td style={{ padding:"0.5rem 0.6rem", textAlign:"right", color:"var(--text-secondary)" }}>{a.cur.newVoice || 0}</td>
                    <td style={{ padding:"0.5rem 0.6rem", textAlign:"right", color:"var(--text-dim)", borderLeft:"2px solid var(--border)" }}>{a.inPrior && a.prev.gph > 0 ? a.prev.gph.toFixed(3) : "\u2014"}</td>
                    <td style={{ padding:"0.5rem 0.6rem", textAlign:"right", color:"var(--text-secondary)" }}>{a.inCurrent && a.cur.gph > 0 ? a.cur.gph.toFixed(3) : "\u2014"}</td>
                    <td style={{ padding:"0.5rem 0.6rem", textAlign:"right", color:"var(--text-dim)" }}>{a.inPrior ? fmtPct(a.prev.pct) : "\u2014"}</td>
                    <td style={{ padding:"0.5rem 0.6rem", textAlign:"right", color:attainColor(a.cur.pct), fontWeight:600 }}>{a.inCurrent ? fmtPct(a.cur.pct) : "\u2014"}</td>
                    <td style={{ padding:"0.5rem 0.6rem", textAlign:"right", color:dColor, fontWeight:700, fontSize:"1.02rem" }}>
                      {(a.inCurrent && a.inPrior) ? `${a.delta >= 0 ? "+" : ""}${fmtPct(a.delta)}` : "\u2014"}</td>
                  </tr>];
                  if (expandedAgent === a.name && a.inCurrent) {
                    // Build weekly rollup (grouped by Mon of week) with date ranges
                    const curRows = filterBySite(currentAgents.filter(r => r.agentName === a.name && r.jobType === activeJobType && r.date));
                    const prevRows = filterBySite(priorAgents.filter(r => r.agentName === a.name && r.jobType === activeJobType && r.date));
                    const getMonday = (ds) => {
                      const [y,mo,d] = ds.split("-").map(Number);
                      const dt = new Date(y, mo-1, d);
                      const day = dt.getDay(); const diff = day === 0 ? -6 : 1 - day;
                      dt.setDate(dt.getDate() + diff);
                      const p = n => String(n).padStart(2,"0");
                      return dt.getFullYear()+"-"+p(dt.getMonth()+1)+"-"+p(dt.getDate());
                    };
                    const rollupByWeek = (rows) => {
                      const m = {};
                      rows.forEach(r => {
                        const mon = getMonday(r.date);
                        if (!m[mon]) m[mon] = { hours:0, goals:0, goalsNum:0, newXI:0, xmLines:0, newXH:0, newVideo:0, newVoice:0, minD:r.date, maxD:r.date };
                        const w = m[mon]; w.hours+=r.hours; w.goals+=r.goals; w.goalsNum+=r.goalsNum;
                        w.newXI+=r.newXI; w.xmLines+=r.xmLines; w.newXH+=r.newXH; w.newVideo+=r.newVideo; w.newVoice+=(r.newVoice||0);
                        if (r.date < w.minD) w.minD = r.date;
                        if (r.date > w.maxD) w.maxD = r.date;
                      });
                      return m;
                    };
                    const fmtRange = (wkData) => {
                      const a2 = wkData.minD.slice(5), b2 = wkData.maxD.slice(5);
                      return a2 === b2 ? a2 : a2+" \u2013 "+b2;
                    };
                    const curDates = rollupByWeek(curRows);
                    const prevDates = rollupByWeek(prevRows);
                    const allDts = [...new Set([...Object.keys(curDates), ...Object.keys(prevDates)])].sort();
                    const colSpan = 15; // total columns in table
                    rows.push(
                      <tr key={a.name+"_detail"}>
                        <td colSpan={colSpan} style={{ padding:"0.5rem 1rem 1rem 2rem", background:"var(--bg-tertiary)", borderBottom:"2px solid var(--border)" }}>
                          <div style={{ fontFamily:"monospace", fontSize:"0.88rem", color:"#d97706", letterSpacing:"0.1em", textTransform:"uppercase", marginBottom:"0.5rem" }}>
                            Week-by-Week {"\u2014"} {a.name} ({activeJobType})
                          </div>
                          <table style={{ width:"100%", borderCollapse:"collapse", fontFamily:"monospace", fontSize:"0.85rem" }}>
                            <thead><tr style={{ borderBottom:"2px solid var(--border)" }}>
                              <th style={{ padding:"0.3rem 0.5rem", textAlign:"left", color:"var(--text-muted)" }}>Period</th>
                              <th style={{ padding:"0.3rem 0.5rem", textAlign:"left", color:"var(--text-muted)" }}>Week</th>
                              <th style={{ padding:"0.3rem 0.5rem", textAlign:"right", color:"var(--text-muted)" }}>Hours</th>
                              <th style={{ padding:"0.3rem 0.5rem", textAlign:"right", color:"var(--text-muted)" }}>Sales</th>
                              <th style={{ padding:"0.3rem 0.5rem", textAlign:"right", color:"var(--text-muted)" }}>GPH</th>
                              <th style={{ padding:"0.3rem 0.5rem", textAlign:"right", color:"var(--text-muted)" }}>HSD</th>
                              <th style={{ padding:"0.3rem 0.5rem", textAlign:"right", color:"var(--text-muted)" }}>XM</th>
                              <th style={{ padding:"0.3rem 0.5rem", textAlign:"right", color:"var(--text-muted)" }}>XH</th>
                              <th style={{ padding:"0.3rem 0.5rem", textAlign:"right", color:"var(--text-muted)" }}>XV</th>
                              <th style={{ padding:"0.3rem 0.5rem", textAlign:"right", color:"var(--text-muted)" }}>Phone</th>
                              <th style={{ padding:"0.3rem 0.5rem", textAlign:"right", color:"var(--text-muted)" }}>% Goal</th>
                            </tr></thead>
                            <tbody>
                              {Object.keys(prevDates).length > 0 && (<>
                                {allDts.filter(dt => prevDates[dt]).map((dt,wi) => {
                                  const w = prevDates[dt];
                                  const gph = w.hours > 0 ? (w.goals / w.hours) : 0;
                                  const pct = w.goalsNum > 0 ? (w.goals / w.goalsNum)*100 : 0;
                                  return (<tr key={"p"+dt} style={{ background:wi%2===1?"var(--bg-secondary)":"transparent", borderBottom:"1px solid var(--bg-tertiary)" }}>
                                    {wi===0 && <td rowSpan={allDts.filter(dt2=>prevDates[dt2]).length} style={{ padding:"0.3rem 0.5rem", color:"var(--text-faint)", fontWeight:600, verticalAlign:"top" }}>Prior</td>}
                                    <td style={{ padding:"0.3rem 0.5rem", color:"var(--text-dim)" }}>  {fmtRange(prevDates[dt])}</td>
                                    <td style={{ padding:"0.3rem 0.5rem", textAlign:"right", color:"var(--text-dim)" }}>{fmt(w.hours,1)}</td>
                                    <td style={{ padding:"0.3rem 0.5rem", textAlign:"right", color:"var(--text-dim)" }}>{w.goals}</td>
                                    <td style={{ padding:"0.3rem 0.5rem", textAlign:"right", color:"var(--text-dim)" }}>{gph.toFixed(3)}</td>
                                    <td style={{ padding:"0.3rem 0.5rem", textAlign:"right", color:"var(--text-dim)" }}>{w.newXI}</td>
                                    <td style={{ padding:"0.3rem 0.5rem", textAlign:"right", color:"var(--text-dim)" }}>{w.xmLines}</td>
                                    <td style={{ padding:"0.3rem 0.5rem", textAlign:"right", color:"var(--text-dim)" }}>{w.newXH}</td>
                                    <td style={{ padding:"0.3rem 0.5rem", textAlign:"right", color:"var(--text-dim)" }}>{w.newVideo}</td>
                                    <td style={{ padding:"0.3rem 0.5rem", textAlign:"right", color:"var(--text-dim)" }}>{w.newVoice||0}</td>
                                    <td style={{ padding:"0.3rem 0.5rem", textAlign:"right", color:attainColor(pct) }}>{fmtPct(pct)}</td>
                                  </tr>);
                                })}
                                <tr style={{ borderBottom:"2px solid var(--border)", background:"var(--bg-secondary)" }}>
                                  <td colSpan={2} style={{ padding:"0.3rem 0.5rem", color:"var(--text-muted)", fontWeight:700 }}>Prior Total</td>
                                  <td style={{ padding:"0.3rem 0.5rem", textAlign:"right", fontWeight:700, color:"var(--text-dim)" }}>{fmt(a.prev.hours,1)}</td>
                                  <td style={{ padding:"0.3rem 0.5rem", textAlign:"right", fontWeight:700, color:"var(--text-dim)" }}>{a.prev.goals}</td>
                                  <td style={{ padding:"0.3rem 0.5rem", textAlign:"right", fontWeight:700, color:"var(--text-dim)" }}>{a.prev.gph.toFixed(3)}</td>
                                  <td style={{ padding:"0.3rem 0.5rem", textAlign:"right", fontWeight:700, color:"var(--text-dim)" }}>{a.prev.newXI}</td>
                                  <td style={{ padding:"0.3rem 0.5rem", textAlign:"right", fontWeight:700, color:"var(--text-dim)" }}>{a.prev.xmLines}</td>
                                  <td style={{ padding:"0.3rem 0.5rem", textAlign:"right", fontWeight:700, color:"var(--text-dim)" }}>{a.prev.newXH}</td>
                                  <td style={{ padding:"0.3rem 0.5rem", textAlign:"right", fontWeight:700, color:"var(--text-dim)" }}>{a.prev.newVideo}</td>
                                  <td style={{ padding:"0.3rem 0.5rem", textAlign:"right", fontWeight:700, color:"var(--text-dim)" }}>{a.prev.newVoice||0}</td>
                                  <td style={{ padding:"0.3rem 0.5rem", textAlign:"right", fontWeight:700, color:attainColor(a.prev.pct) }}>{fmtPct(a.prev.pct)}</td>
                                </tr>
                              </>)}
                              {allDts.filter(dt => curDates[dt]).map((dt,wi) => {
                                const w = curDates[dt];
                                const gph = w.hours > 0 ? (w.goals / w.hours) : 0;
                                const pct = w.goalsNum > 0 ? (w.goals / w.goalsNum)*100 : 0;
                                return (<tr key={"c"+dt} style={{ background:wi%2===1?"var(--bg-secondary)":"transparent", borderBottom:"1px solid var(--bg-tertiary)" }}>
                                  {wi===0 && <td rowSpan={allDts.filter(dt2=>curDates[dt2]).length} style={{ padding:"0.3rem 0.5rem", color:"#d97706", fontWeight:600, verticalAlign:"top" }}>Current</td>}
                                  <td style={{ padding:"0.3rem 0.5rem", color:"var(--text-secondary)" }}>  {fmtRange(curDates[dt])}</td>
                                  <td style={{ padding:"0.3rem 0.5rem", textAlign:"right", color:"var(--text-secondary)" }}>{fmt(w.hours,1)}</td>
                                  <td style={{ padding:"0.3rem 0.5rem", textAlign:"right", color:"var(--text-secondary)" }}>{w.goals}</td>
                                  <td style={{ padding:"0.3rem 0.5rem", textAlign:"right", color:"var(--text-secondary)" }}>{gph.toFixed(3)}</td>
                                  <td style={{ padding:"0.3rem 0.5rem", textAlign:"right", color:"var(--text-secondary)" }}>{w.newXI}</td>
                                  <td style={{ padding:"0.3rem 0.5rem", textAlign:"right", color:"var(--text-secondary)" }}>{w.xmLines}</td>
                                  <td style={{ padding:"0.3rem 0.5rem", textAlign:"right", color:"var(--text-secondary)" }}>{w.newXH}</td>
                                  <td style={{ padding:"0.3rem 0.5rem", textAlign:"right", color:"var(--text-secondary)" }}>{w.newVideo}</td>
                                  <td style={{ padding:"0.3rem 0.5rem", textAlign:"right", color:"var(--text-secondary)" }}>{w.newVoice||0}</td>
                                  <td style={{ padding:"0.3rem 0.5rem", textAlign:"right", color:attainColor(pct) }}>{fmtPct(pct)}</td>
                                </tr>);
                              })}
                              <tr style={{ borderTop:"2px solid var(--border)", background:"var(--bg-secondary)" }}>
                                <td colSpan={2} style={{ padding:"0.3rem 0.5rem", color:"#d97706", fontWeight:700 }}>Current Total</td>
                                <td style={{ padding:"0.3rem 0.5rem", textAlign:"right", fontWeight:700, color:"var(--text-primary)" }}>{fmt(a.cur.hours,1)}</td>
                                <td style={{ padding:"0.3rem 0.5rem", textAlign:"right", fontWeight:700, color:"var(--text-primary)" }}>{a.cur.goals}</td>
                                <td style={{ padding:"0.3rem 0.5rem", textAlign:"right", fontWeight:700, color:"var(--text-primary)" }}>{a.cur.gph.toFixed(3)}</td>
                                <td style={{ padding:"0.3rem 0.5rem", textAlign:"right", fontWeight:700, color:"var(--text-primary)" }}>{a.cur.newXI}</td>
                                <td style={{ padding:"0.3rem 0.5rem", textAlign:"right", fontWeight:700, color:"var(--text-primary)" }}>{a.cur.xmLines}</td>
                                <td style={{ padding:"0.3rem 0.5rem", textAlign:"right", fontWeight:700, color:"var(--text-primary)" }}>{a.cur.newXH}</td>
                                <td style={{ padding:"0.3rem 0.5rem", textAlign:"right", fontWeight:700, color:"var(--text-primary)" }}>{a.cur.newVideo}</td>
                                <td style={{ padding:"0.3rem 0.5rem", textAlign:"right", fontWeight:700, color:"var(--text-primary)" }}>{a.cur.newVoice||0}</td>
                                <td style={{ padding:"0.3rem 0.5rem", textAlign:"right", fontWeight:700, color:attainColor(a.cur.pct) }}>{fmtPct(a.cur.pct)}</td>
                              </tr>
                            </tbody>
                          </table>
                        </td>
                      </tr>
                    );
                  }
                  return rows;
                })}</tbody>
              </table>
            </div>
          </div>
        </>)}
      </>)}
    </div>
  );
}


// SECTION 12d — PROGRAM BY-SITE DRILLDOWN
// For programs that have agents in multiple sites (e.g. DR + BZ), shows
// per-site campaign KPIs, quartile distribution, goals vs plan, and agent lists.

// ══════════════════════════════════════════════════════════════════════════════
// SECTION 12d — PROGRAM BY-SITE DRILLDOWN
// For programs that have agents in multiple sites (e.g. DR + BZ), shows
// per-site campaign KPIs, quartile distribution, goals vs plan, and agent lists.
// ══════════════════════════════════════════════════════════════════════════════

function ProgramBySiteTab({ agents, regions, siteBuckets, jobType, goalEntry, goalLookup, fiscalInfo, newHireSet }) {
  const [activeSite, setActiveSite] = useState(null);

  // Build per-site stats
  const siteStats = useMemo(() => {
    return siteBuckets.map(bucket => {
      const siteAgents = agents.filter(a => bucket.regions.includes(a.region));
      const uniqueAgents = collapseToUniqueAgents(siteAgents);
      const totalHours = siteAgents.reduce((s, a) => s + a.hours, 0);
      const totalGoals = siteAgents.reduce((s, a) => s + a.goals, 0);
      const gph = totalHours > 0 ? totalGoals / totalHours : 0;
      const distU = uniqueQuartileDist(siteAgents);
      const uCount = uniqueNames(siteAgents).size;
      const q1Rate = uCount > 0 ? (distU.Q1 / uCount) * 100 : 0;
      const totalRgu = siteAgents.reduce((s, a) => s + a.rgu, 0);
      const totalNewXI = siteAgents.reduce((s, a) => s + a.newXI, 0);
      const totalXmLines = siteAgents.reduce((s, a) => s + a.xmLines, 0);

      // Site-specific plan from goals CSV
      const sitePlanKey = bucket.regions.some(r => r.toUpperCase().includes("XOTM")) ? "BZ" : "DR";
      const siteRows = goalEntry ? (goalEntry[sitePlanKey] || []) : [];
      const sitePlanGoals = siteRows.reduce((s, r) => s + computePlanRow(r).homesGoal, 0) || null;
      const sitePlanRgu = siteRows.reduce((s, r) => s + computePlanRow(r).rguGoal, 0) || null;
      const sitePlanHsd = siteRows.reduce((s, r) => s + computePlanRow(r).hsdGoal, 0) || null;
      const sitePlanXm = siteRows.reduce((s, r) => s + computePlanRow(r).xmGoal, 0) || null;
      const sitePlanHours = siteRows.reduce((s, r) => s + computePlanRow(r).hoursGoal, 0) || null;
      const attain = sitePlanGoals ? (totalGoals / sitePlanGoals) * 100 : null;

      // Gainshare attainments
      const hsdAttain = sitePlanHsd ? (totalNewXI / sitePlanHsd) * 100 : null;
      const rguAttain = sitePlanRgu ? (totalRgu / sitePlanRgu) * 100 : null;

      // Top/bottom agents
      const q1List = uniqueAgents.filter(a => a.quartile === "Q1" && a.hours >= 16).sort((a, b) => b.hours - a.hours);
      const q4List = uniqueAgents.filter(a => a.quartile === "Q4").sort((a, b) => b.hours - a.hours);

      return {
        ...bucket,
        siteAgents, uniqueAgents, totalHours, totalGoals, gph, distU, uCount, q1Rate,
        totalRgu, totalNewXI, totalXmLines,
        sitePlanKey, sitePlanGoals, sitePlanRgu, sitePlanHsd, sitePlanXm, sitePlanHours,
        attain, hsdAttain, rguAttain,
        q1List, q4List,
      };
    });
  }, [agents, siteBuckets, goalEntry]);

  const activeStats = activeSite !== null ? siteStats.find(s => s.label === activeSite) : null;
  const displayStats = activeStats ? [activeStats] : siteStats;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>

      {/* Site selector tabs */}
      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
        <button onClick={() => setActiveSite(null)}
          style={{ padding: "0.4rem 1rem", borderRadius: "6px", border: `1px solid ${activeSite===null?"#d97706":`var(--border)`}`, background: activeSite===null?"#d9770618":"transparent", color: activeSite===null?"#d97706":`var(--text-muted)`, fontFamily: "monospace", fontSize: "1.14rem", cursor: "pointer" }}>
          All Sites
        </button>
        {siteStats.map(s => (
          <button key={s.label} onClick={() => setActiveSite(activeSite === s.label ? null : s.label)}
            style={{ padding: "0.4rem 1rem", borderRadius: "6px", border: `1px solid ${activeSite===s.label?"#6366f1":`var(--border)`}`, background: activeSite===s.label?"#6366f118":"transparent", color: activeSite===s.label?"#818cf8":`var(--text-muted)`, fontFamily: "monospace", fontSize: "1.14rem", cursor: "pointer" }}>
            {s.label}
            <span style={{ fontFamily: "monospace", fontSize: "1.17rem", color: `var(--text-dim)`, marginLeft: "0.4rem" }}>
              ({s.uCount} agents)
            </span>
          </button>
        ))}
      </div>

      {/* Comparison strip when showing all */}
      {activeSite === null && siteStats.length > 1 && (
        <div style={{ background: `var(--bg-secondary)`, border: "1px solid var(--border)", borderRadius: "12px", padding: "1.5rem" }}>
          <div style={{ fontFamily: "monospace", fontSize: "1.14rem", color: "#d97706", letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: "1.25rem" }}>
            Site Comparison — {jobType}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: `repeat(${siteStats.length}, 1fr)`, gap: "1rem" }}>
            {siteStats.map(s => {
              const color = s.attain !== null ? attainColor(s.attain) : attainColor(s.q1Rate);
              return (
                <div key={s.label} onClick={() => setActiveSite(s.label)}
                  style={{ cursor: "pointer", padding: "1.25rem", background: `var(--bg-primary)`, borderRadius: "10px", border: `1px solid ${color}25`, borderTop: `3px solid ${color}`, transition: "all 0.2s" }}>
                  <div style={{ fontFamily: "Georgia, serif", fontSize: "1.5rem", color: `var(--text-warm)`, marginBottom: "0.75rem", fontWeight: 600 }}>{s.label}</div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem 1rem" }}>
                    {[
                      { l: "Agents", v: s.uCount, c: `var(--text-secondary)` },
                      { l: "Hours", v: fmt(s.totalHours, 0), c: "#6366f1" },
                      { l: "Goals", v: s.totalGoals.toLocaleString(), c: "#16a34a" },
                      { l: "GPH", v: fmt(s.gph, 3), c: s.gph > 0 ? "#16a34a" : `var(--text-faint)` },
                      { l: "Q1 Rate", v: `${s.q1Rate.toFixed(0)}%`, c: "#d97706" },
                      { l: "Attainment", v: s.attain !== null ? `${Math.round(s.attain)}%` : "—", c: color },
                    ].map(({ l, v, c }) => (
                      <div key={l}>
                        <div style={{ fontFamily: "'Cormorant Garamond', Georgia, serif", fontSize: "1.88rem", color: c, fontWeight: 700, lineHeight: 1 }}>{v}</div>
                        <div style={{ fontFamily: "monospace", fontSize: "0.9rem", color: `var(--text-dim)`, marginTop: "0.1rem" }}>{l}</div>
                      </div>
                    ))}
                  </div>
                  {/* Quartile bar */}
                  <div style={{ display: "flex", height: "6px", borderRadius: "3px", overflow: "hidden", marginTop: "0.75rem" }}>
                    {["Q1","Q2","Q3","Q4"].map(q => s.distU[q] > 0 && (
                      <div key={q} style={{ flex: s.distU[q], background: Q[q].color }} />
                    ))}
                  </div>
                  <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.3rem" }}>
                    {["Q1","Q2","Q3","Q4"].map(q => (
                      <span key={q} style={{ fontFamily: "monospace", fontSize: "0.9rem", color: Q[q].color }}>{q}: {s.distU[q]}</span>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Combined Goals vs Plan + Pacing when showing All Sites */}
      {activeSite === null && siteStats.length > 1 && (() => {
        const combHours   = siteStats.reduce((s, x) => s + x.totalHours, 0);
        const combGoals   = siteStats.reduce((s, x) => s + x.totalGoals, 0);
        const combRgu     = siteStats.reduce((s, x) => s + x.totalRgu, 0);
        const combNewXI   = siteStats.reduce((s, x) => s + x.totalNewXI, 0);
        const combXm      = siteStats.reduce((s, x) => s + x.totalXmLines, 0);
        const combPlanHrs = siteStats.reduce((s, x) => s + (x.sitePlanHours || 0), 0) || null;
        const combPlanG   = siteStats.reduce((s, x) => s + (x.sitePlanGoals || 0), 0) || null;
        const combPlanRgu = siteStats.reduce((s, x) => s + (x.sitePlanRgu || 0), 0) || null;
        const combPlanHsd = siteStats.reduce((s, x) => s + (x.sitePlanHsd || 0), 0) || null;
        const combPlanXm  = siteStats.reduce((s, x) => s + (x.sitePlanXm || 0), 0) || null;
        const hasXM       = combXm > 0;
        if (!combPlanG && !combPlanHrs) return null;
        return (
          <MetricComparePanel
            title={`Goals vs Plan — ${jobType} (Combined)`}
            fiscalInfo={fiscalInfo}
            metrics={[
              { label: "Total Hours",  actual: combHours, plan: combPlanHrs },
              { label: "Total Goals",  actual: combGoals, plan: combPlanG   },
              { label: "Total RGU",    actual: combRgu,   plan: combPlanRgu },
              { label: "New XI (HSD)", actual: combNewXI, plan: combPlanHsd },
              { label: "XM Lines",     actual: combXm,    plan: hasXM ? combPlanXm : null },
            ]}
          />
        );
      })()}

      {/* Per-site detail cards */}
      {displayStats.map(s => {
        const color = s.attain !== null ? attainColor(s.attain) : attainColor(s.q1Rate);
        return (
          <div key={s.label} style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
            {/* KPI strip */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: "0.75rem" }}>
              <StatCard label="Q1 Rate" value={`${s.q1Rate.toFixed(1)}%`} sub={`${s.distU.Q1} of ${s.uCount} agents`} accent="#d97706" />
              <StatCard label="GPH" value={fmt(s.gph, 3)} sub="sum goals / sum hours" accent="#2563eb" />
              <StatCard label="Goals" value={s.totalGoals.toLocaleString()} sub={s.sitePlanGoals ? `of ${s.sitePlanGoals.toLocaleString()} plan` : "conversions"} accent="#16a34a" />
              <StatCard label="Hours" value={fmt(s.totalHours, 0)} sub={`${s.uniqueAgents.filter(a=>a.hours>=16).length} at 16+ hrs`} accent="#6366f1" />
              <StatCard label="Attainment" value={s.attain !== null ? `${Math.round(s.attain)}%` : "—"} sub={s.sitePlanKey + " site plan"} accent={color} />
            </div>

            {/* Goals vs Plan — site-specific (with hours + pacing) */}
            {(s.sitePlanGoals || s.sitePlanHours) && (
              <MetricComparePanel
                title={`Goals vs Plan — ${s.label}`}
                fiscalInfo={fiscalInfo}
                metrics={[
                  { label: "Hours", actual: s.totalHours, plan: s.sitePlanHours },
                  { label: "Goals", actual: s.totalGoals, plan: s.sitePlanGoals },
                  { label: "RGU", actual: s.totalRgu, plan: s.sitePlanRgu },
                  { label: "HSD", actual: s.totalNewXI, plan: s.sitePlanHsd },
                  { label: "XM Lines", actual: s.totalXmLines, plan: s.sitePlanXm },
                ]}
              />
            )}

            {/* Quartile breakdown */}
            <div style={{ background: `var(--bg-secondary)`, border: "1px solid var(--border)", borderRadius: "12px", padding: "1.25rem" }}>
              <div style={{ fontFamily: "monospace", fontSize: "1.14rem", color: `var(--text-muted)`, letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: "0.75rem" }}>
                Quartile Mix — {s.label}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "0.5rem", marginBottom: "0.75rem" }}>
                {["Q1","Q2","Q3","Q4"].map(q => (
                  <div key={q} style={{ padding: "0.75rem", borderRadius: "8px", background: Q[q].color+"12", border: `1px solid ${Q[q].color}30`, textAlign: "center" }}>
                    <div style={{ fontFamily: "'Cormorant Garamond', Georgia, serif", fontSize: "3rem", color: Q[q].color, fontWeight: 700 }}>{s.distU[q]}</div>
                    <div style={{ fontFamily: "monospace", fontSize: "1.17rem", color: Q[q].color }}>{q} · unique</div>
                  </div>
                ))}
              </div>
              <div style={{ display: "flex", height: "8px", borderRadius: "4px", overflow: "hidden" }}>
                {["Q1","Q2","Q3","Q4"].map(q => (
                  <div key={q} style={{ flex: s.distU[q] || 0, background: Q[q].color, transition: "flex 0.5s" }} />
                ))}
              </div>
            </div>

            {/* Top performers + Priority coaching side by side */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1.25rem" }}>
              <div style={{ background: `var(--bg-secondary)`, border: "1px solid var(--border)", borderRadius: "12px", padding: "1.25rem" }}>
                <div style={{ fontFamily: "monospace", fontSize: "1.08rem", color: "#16a34a", letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: "0.35rem" }}>Top Performers — {s.label}</div>
                <div style={{ fontFamily: "monospace", fontSize: "1.14rem", color: `var(--text-dim)`, marginBottom: "0.9rem" }}>Q1 · 16+ hours</div>
                {s.q1List.length === 0
                  ? <div style={{ color: `var(--text-faint)`, fontFamily: "Georgia, serif", fontSize: "1.2rem" }}>No Q1 agents with 16+ hours at this site</div>
                  : s.q1List.slice(0, 5).map((a, i) => {
                    const agph = a.hours > 0 ? (a.goals / a.hours).toFixed(3) : "0.000";
                    return (
                      <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0.5rem 0", borderBottom: i < Math.min(s.q1List.length, 5) - 1 ? "1px solid var(--bg-tertiary)" : "none" }}>
                        <div>
                          <div style={{ color: `var(--text-warm)`, fontFamily: "Georgia, serif", fontSize: "1.23rem" }}>
                            {a.agentName}
                            {newHireSet.has(a.agentName) && <span style={{ fontFamily: "monospace", fontSize: "1.08rem", color: "#d97706", background: "#d9770620", padding: "0.05rem 0.3rem", borderRadius: "2px", marginLeft: "0.35rem" }}>NEW</span>}
                          </div>
                          <div style={{ fontFamily: "monospace", fontSize: "1.17rem", color: `var(--text-dim)` }}>{fmt(a.hours, 1)} hrs · {agph} GPH</div>
                        </div>
                        <div style={{ fontFamily: "'Cormorant Garamond', Georgia, serif", fontSize: "1.65rem", color: Q.Q1.color, fontWeight: 700 }}>{Math.round(a.pctToGoal)}%</div>
                      </div>
                    );
                  })}
              </div>

              <div style={{ background: `var(--bg-secondary)`, border: "1px solid var(--border)", borderRadius: "12px", padding: "1.25rem" }}>
                <div style={{ fontFamily: "monospace", fontSize: "1.08rem", color: "#dc2626", letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: "0.35rem" }}>Priority Coaching — {s.label}</div>
                <div style={{ fontFamily: "monospace", fontSize: "1.14rem", color: `var(--text-dim)`, marginBottom: "0.9rem" }}>Zero sales · ranked by hours</div>
                {s.q4List.length === 0
                  ? <div style={{ color: `var(--text-faint)`, fontFamily: "Georgia, serif", fontSize: "1.2rem" }}>No Q4 agents at this site — excellent!</div>
                  : s.q4List.slice(0, 5).map((a, i) => (
                    <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0.5rem 0", borderBottom: i < Math.min(s.q4List.length, 5) - 1 ? "1px solid var(--bg-tertiary)" : "none" }}>
                      <div>
                        <div style={{ color: `var(--text-warm)`, fontFamily: "Georgia, serif", fontSize: "1.23rem" }}>
                          {a.agentName}
                          {newHireSet.has(a.agentName) && <span style={{ fontFamily: "monospace", fontSize: "1.08rem", color: "#d97706", background: "#d9770620", padding: "0.05rem 0.3rem", borderRadius: "2px", marginLeft: "0.35rem" }}>NEW</span>}
                        </div>
                        <div style={{ fontFamily: "monospace", fontSize: "1.17rem", color: `var(--text-dim)` }}>{a.region} · 0 sales</div>
                      </div>
                      <div style={{ fontFamily: "'Cormorant Garamond', Georgia, serif", fontSize: "1.65rem", color: "#6366f1", fontWeight: 700 }}>{fmt(a.hours, 1)} hrs</div>
                    </div>
                  ))}
              </div>
            </div>

            {/* Sub-region breakdown when viewing BZ (multiple XOTM sites) */}
            {s.regions.length > 1 && (
              <div style={{ background: `var(--bg-secondary)`, border: "1px solid var(--border)", borderRadius: "12px", padding: "1.25rem" }}>
                <div style={{ fontFamily: "monospace", fontSize: "1.14rem", color: `var(--text-muted)`, letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: "1rem" }}>
                  Sub-regions — {s.label}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                  {s.regions.map(regName => {
                    const rAgents = s.siteAgents.filter(a => a.region === regName);
                    const rGoals = rAgents.reduce((sum, a) => sum + a.goals, 0);
                    const rHours = rAgents.reduce((sum, a) => sum + a.hours, 0);
                    const rGph = rHours > 0 ? rGoals / rHours : 0;
                    const rDist = uniqueQuartileDist(rAgents);
                    const rU = uniqueNames(rAgents).size;
                    const maxGoals = Math.max(...s.regions.map(rn => s.siteAgents.filter(a => a.region === rn).reduce((sum, a) => sum + a.goals, 0)), 1);
                    const barW = (rGoals / maxGoals) * 100;
                    return (
                      <div key={regName} style={{ padding: "0.85rem 1rem", background: `var(--bg-primary)`, borderRadius: "8px", border: "1px solid var(--bg-tertiary)" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.4rem" }}>
                          <span style={{ fontFamily: "Georgia, serif", fontSize: "1.27rem", color: `var(--text-primary)` }}>{regName}</span>
                          <span style={{ fontFamily: "monospace", fontSize: "1.17rem", color: `var(--text-muted)` }}>{rU} agents · {fmt(rHours, 0)} hrs</span>
                        </div>
                        <div style={{ display: "flex", height: "5px", background: `var(--bg-tertiary)`, borderRadius: "3px", overflow: "hidden", marginBottom: "0.4rem" }}>
                          <div style={{ width: `${barW}%`, background: "#6366f1", borderRadius: "3px", transition: "width 0.5s" }} />
                        </div>
                        <div style={{ display: "flex", gap: "0.75rem" }}>
                          <span style={{ fontFamily: "monospace", fontSize: "1.17rem", color: "#16a34a" }}>{rGoals} goals</span>
                          <span style={{ fontFamily: "monospace", fontSize: "1.17rem", color: `var(--text-muted)` }}>GPH {fmt(rGph, 3)}</span>
                          {["Q1","Q2","Q3","Q4"].map(q => rDist[q] > 0 && (
                            <span key={q} style={{ fontFamily: "monospace", fontSize: "1.17rem", color: Q[q].color }}>{q}: {rDist[q]}</span>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}


// ══════════════════════════════════════════════════════════════════════════════
// SECTION 13 — SLIDE  (pages/Slide.jsx)
// Receives a pre-built Program object. No heavy computation inside.
// ══════════════════════════════════════════════════════════════════════════════

// ── Daily Breakdown Panel ─────────────────────────────────────────────────────
// Shows performance by day, by region/site, with combined view and region tabs.
// When programs[] is passed (from BusinessOverview), shows program drill-down tabs.
function DailyBreakdownPanel({ agents: allAgentsProp, regions, jobType, sphGoal, programs, goalLookup, singleProgram }) {
  const [dailyRegion, setDailyRegion] = useState("Combined");
  const [dailyProgram, setDailyProgram] = useState("All");
  const [dailyRocFilter, setDailyRocFilter] = useState(null);
  const [selectedDate, setSelectedDate] = useState(null); // date string or "wk-YYYY-MM-DD" for week
  const [selectedDrillJob, setSelectedDrillJob] = useState(null); // job type within a selected date

  // Determine active agents: filter by selected program, then by ROC if drilled down
  const activeAgents = useMemo(() => {
    let filtered = allAgentsProp;
    if (programs && dailyProgram !== "All") {
      filtered = filtered.filter(a => (a.jobType || "Unknown") === dailyProgram);
    }
    if (dailyRocFilter) {
      filtered = filtered.filter(a => a.rocCode === dailyRocFilter);
    }
    return filtered;
  }, [allAgentsProp, programs, dailyProgram, dailyRocFilter]);

  // Active sphGoal: use program-specific sphGoal when drilled into a program
  const activeSphGoal = useMemo(() => {
    // If ROC filter is active, use that ROC's specific SPH goal
    if (dailyRocFilter && goalLookup && dailyProgram !== "All") {
      const entries = getGoalEntries(goalLookup, dailyProgram);
      const allRows = entries.flatMap(e => Object.values(e.siteMap).flat());
      const rocRows = allRows.filter(r => r._roc === dailyRocFilter);
      if (rocRows.length > 0) {
        const vals = rocRows.map(r => computePlanRow(r).sphGoal).filter(v => v > 0);
        if (vals.length > 0) return vals.reduce((s,v) => s + v, 0) / vals.length;
      }
    }
    if (sphGoal) return sphGoal;
    if (!programs || dailyProgram === "All") return null;
    const vals = activeAgents.map(a => a.sphGoal).filter(v => v > 0);
    return vals.length > 0 ? vals[0] : null;
  }, [sphGoal, programs, dailyProgram, activeAgents, dailyRocFilter, goalLookup]);

  // ROC-filtered plan totals for display in table header
  const rocPlanInfo = useMemo(() => {
    if (!goalLookup || dailyProgram === "All") return null;
    const entries = getGoalEntries(goalLookup, dailyProgram);
    const allRows = entries.flatMap(e => Object.values(e.siteMap).flat());
    const rows = dailyRocFilter ? allRows.filter(r => r._roc === dailyRocFilter) : allRows;
    if (rows.length === 0) return null;
    const pr = rows.map(r => computePlanRow(r));
    const target = rows[0]?._target || "";
    const funding = rows[0]?._funding || "";
    return {
      target, funding,
      homes: pr.reduce((a, p) => a + p.homesGoal, 0),
      hours: pr.reduce((a, p) => a + p.hoursGoal, 0),
      sph: pr.reduce((a, p) => a + p.sphGoal, 0) / pr.length,
    };
  }, [goalLookup, dailyProgram, dailyRocFilter]);

  // Build region names from active agents — group BZ sites together
  const regionInfo = useMemo(() => {
    const regs = [...new Set(activeAgents.map(a => a.region).filter(Boolean))].sort();
    const bzRegs = regs.filter(r => r.toUpperCase().includes("XOTM"));
    const drRegs = regs.filter(r => !r.toUpperCase().includes("XOTM"));
    // Build ordered tab list: Combined (All) | DR sites | Combined (BZ) | individual BZ sites
    const tabs = ["Combined"];
    drRegs.forEach(r => tabs.push(r));
    if (bzRegs.length > 1) tabs.push("Combined (BZ)");
    bzRegs.forEach(r => tabs.push(r));
    return { all: regs, bz: bzRegs, dr: drRegs, tabs };
  }, [activeAgents]);

  // Program list for drill-down (sorted by total goals desc)
  const programList = useMemo(() => {
    if (!programs) return [];
    return programs.map(p => ({
      jobType: p.jobType,
      totalGoals: p.totalGoals || 0,
      totalHours: p.totalHours || 0,
      gph: p.gph || 0,
    })).sort((a, b) => b.totalGoals - a.totalGoals);
  }, [programs]);

  // Build daily data grouped by region
  const dailyData = useMemo(() => {
    const allDates = [...new Set(activeAgents.filter(a => a.date).map(a => a.date))].sort().reverse();
    if (!allDates.length) return null;

    const buildDayStats = (rows) => {
      const byDate = {};
      rows.forEach(r => {
        if (!r.date) return;
        if (!byDate[r.date]) byDate[r.date] = { hours: 0, goals: 0, hsd: 0, xm: 0, agents: new Set() };
        byDate[r.date].hours += r.hours;
        byDate[r.date].goals += r.goals;
        byDate[r.date].hsd   += r.newXI || 0;
        byDate[r.date].xm    += r.xmLines || 0;
        byDate[r.date].agents.add(r.agentName);
      });
      return allDates.map(date => {
        const d = byDate[date];
        if (!d) return { date, hours: 0, goals: 0, hsd: 0, xm: 0, agentCount: 0, gph: null, absent: true };
        const gph = d.hours > 0 ? d.goals / d.hours : 0;
        return { date, hours: d.hours, goals: d.goals, hsd: d.hsd, xm: d.xm,
                 agentCount: d.agents.size, gph, absent: false };
      });
    };

    const combined = buildDayStats(activeAgents);
    const byRegion = {};
    regionInfo.all.forEach(rn => {
      byRegion[rn] = buildDayStats(activeAgents.filter(a => a.region === rn));
    });
    // Combined BZ
    if (regionInfo.bz.length > 1) {
      byRegion["Combined (BZ)"] = buildDayStats(activeAgents.filter(a => regionInfo.bz.includes(a.region)));
    }

    return { allDates, combined, byRegion };
  }, [activeAgents, regionInfo]);

  if (!dailyData || dailyData.allDates.length === 0) {
    return (
      <div style={{ background: `var(--bg-secondary)`, border: "1px solid var(--border)", borderRadius: "12px", padding: "2rem", textAlign: "center", color: `var(--text-faint)`, fontFamily: "Georgia, serif" }}>
        No date data available for daily breakdown.
      </div>
    );
  }

  const sg = activeSphGoal;
  const days = dailyRegion === "Combined" ? dailyData.combined : (dailyData.byRegion[dailyRegion] || dailyData.combined);

  // Group days by week
  const weekGroups = [];
  let curWeek = null;
  days.forEach(d => {
    const dt = new Date(d.date + "T00:00:00");
    const dayOfWeek = dt.getDay();
    const mon = new Date(dt);
    mon.setDate(dt.getDate() - ((dayOfWeek + 6) % 7));
    const wk = mon.toISOString().slice(0, 10);
    if (!curWeek || curWeek.wk !== wk) {
      curWeek = { wk, days: [] };
      weekGroups.push(curWeek);
    }
    curWeek.days.push(d);
  });

  const dayLabel = dateStr => {
    const dt = new Date(dateStr + "T00:00:00");
    return ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][dt.getDay()];
  };

  const displayLabel = dailyProgram !== "All" ? dailyProgram : jobType;
  const worked = days.filter(d => !d.absent);
  const totalHrs = worked.reduce((s, d) => s + d.hours, 0);
  const totalGoals = worked.reduce((s, d) => s + d.goals, 0);
  const totalHsd = worked.reduce((s, d) => s + d.hsd, 0);
  const totalXm = worked.reduce((s, d) => s + d.xm, 0);
  const overallGph = totalHrs > 0 ? totalGoals / totalHrs : 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
      <div style={{ background: `var(--bg-secondary)`, border: "1px solid var(--border)", borderRadius: "12px", padding: "1.5rem" }}>
        <div style={{ fontFamily: "monospace", fontSize: "1.14rem", color: `var(--text-muted)`, letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: "0.75rem" }}>
          Daily Performance Breakdown — {displayLabel}
          {dailyRocFilter && rocPlanInfo && (
            <span style={{ marginLeft: "0.75rem", fontSize: "0.95rem", color: "#6366f1", letterSpacing: "0.05em", textTransform: "none" }}>
              {dailyRocFilter} {rocPlanInfo.funding ? `(${rocPlanInfo.funding})` : ""} — {rocPlanInfo.homes.toLocaleString()} homes / {Math.round(rocPlanInfo.hours).toLocaleString()} hrs / SPH {rocPlanInfo.sph.toFixed(3)}
            </span>
          )}
        </div>

        {/* Region/site tabs */}
        {regionInfo.tabs.length > 2 && (
          <div style={{ marginBottom: "0.75rem" }}>
            <div style={{ fontFamily: "monospace", fontSize: "0.9rem", color: `var(--text-faint)`, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: "0.35rem" }}>Region</div>
            <div style={{ display: "flex", gap: "0.35rem", flexWrap: "wrap", alignItems: "center" }}>
              {regionInfo.tabs.map(r => {
                const active = dailyRegion === r;
                const isBzCombo = r === "Combined (BZ)";
                const isCombined = r === "Combined";
                const isBzSite = !isCombined && !isBzCombo && regionInfo.bz.includes(r);
                const btnColor = isCombined ? "#d97706" : isBzCombo ? "#16a34a" : isBzSite ? "#16a34a" : "#6366f1";
                return (
                  <button key={r} onClick={() => setDailyRegion(r)}
                    style={{ padding: "0.25rem 0.7rem", borderRadius: "5px",
                      border: `1px solid ${active ? btnColor : `var(--border)`}`,
                      background: active ? btnColor + "18" : "transparent",
                      color: active ? btnColor : `var(--text-dim)`,
                      fontFamily: "monospace", fontSize: "1.05rem", cursor: "pointer", transition: "all 0.15s",
                      ...(isBzCombo && !active ? { borderLeftWidth: "3px", borderLeftColor: "#16a34a44" } : {}) }}>
                    {r}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Program drill-down tabs (only in All Programs mode) */}
        {/* Funding / ROC goal breakout for current program */}
        {goalLookup && dailyProgram !== "All" && (() => {
          const entries = getGoalEntries(goalLookup, dailyProgram);
          const allRows = entries.flatMap(e => Object.values(e.siteMap).flat());
          let targets = [...new Set(allRows.map(r => r._target).filter(Boolean))];
          if (dailyRocFilter) targets = targets.filter(t => allRows.some(r => r._target === t && r._roc === dailyRocFilter));
          if (targets.length === 0) return null;
          const isBZ = dailyRegion !== "Combined" && dailyRegion.toUpperCase().includes("XOTM");
          const isDR = dailyRegion !== "Combined" && !isBZ && dailyRegion !== "Combined (BZ)";
          const isBZCombo = dailyRegion === "Combined (BZ)";
          const siteKey = isDR ? "DR" : (isBZ || isBZCombo) ? "BZ" : null;
          return (
            <div style={{ background: `var(--bg-tertiary)`, borderRadius: "8px", padding: "0.75rem 1rem", marginBottom: "0.75rem" }}>
              <div style={{ fontFamily: "monospace", fontSize: "0.85rem", color: `var(--text-faint)`, letterSpacing: "0.08em", marginBottom: "0.4rem" }}>GOAL TARGETS BY FUNDING</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem" }}>
                {targets.map(t => {
                  const tRows = allRows.filter(r => r._target === t);
                  const filtered = siteKey ? tRows.filter(r => (findCol(r, "Site") || "").trim().toUpperCase() === siteKey) : tRows;
                  if (filtered.length === 0) return null;
                  const pr = filtered.map(r => computePlanRow(r));
                  const homes = pr.reduce((a, p) => a + p.homesGoal, 0);
                  const hours = pr.reduce((a, p) => a + p.hoursGoal, 0);
                  const sphG = pr.length > 0 ? pr.reduce((a, p) => a + p.sphGoal, 0) / pr.length : 0;
                  const funding = tRows[0]?._funding || "";
                  const roc = tRows[0]?._roc || "";
                  return (
                    <div key={t} style={{ display: "flex", gap: "0.5rem", alignItems: "center", padding: "0.3rem 0.6rem", background: `var(--bg-secondary)`, borderRadius: "6px", border: "1px solid var(--border)" }}>
                      {funding && <span style={{ fontFamily: "monospace", fontSize: "0.8rem", color: "#6366f1", background: "#6366f108", border: "1px solid #6366f130", borderRadius: "3px", padding: "0 0.25rem" }}>{funding}</span>}
                      <span style={{ fontFamily: "monospace", fontSize: "0.85rem", color: `var(--text-dim)` }}>{roc}</span>
                      <span style={{ fontFamily: "monospace", fontSize: "0.9rem", color: `var(--text-secondary)` }}>{homes.toLocaleString()} homes</span>
                      <span style={{ fontFamily: "monospace", fontSize: "0.9rem", color: `var(--text-dim)` }}>{Math.round(hours).toLocaleString()} hrs</span>
                      <span style={{ fontFamily: "monospace", fontSize: "0.9rem", color: `var(--text-dim)` }}>SPH {sphG.toFixed(3)}</span>
                    </div>
                  );
                }).filter(Boolean)}
              </div>
            </div>
          );
        })()}
        {programList.length > 0 && (
          <div style={{ marginBottom: "0.75rem" }}>
            <div style={{ fontFamily: "monospace", fontSize: "0.9rem", color: `var(--text-faint)`, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: "0.35rem" }}>Program</div>
            <div style={{ display: "flex", gap: "0.35rem", flexWrap: "wrap" }}>
              <button onClick={() => { setDailyProgram("All"); setDailyRocFilter(null); }}
                style={{ padding: "0.3rem 0.75rem", borderRadius: "5px",
                  border: `1px solid ${dailyProgram === "All" ? "#d97706" : `var(--border)`}`,
                  background: dailyProgram === "All" ? "#d9770618" : "transparent",
                  color: dailyProgram === "All" ? "#d97706" : `var(--text-dim)`,
                  fontFamily: "monospace", fontSize: "1.05rem", cursor: "pointer", fontWeight: dailyProgram === "All" ? 700 : 400 }}>
                All Programs
              </button>
              {programList.map(p => {
                const active = dailyProgram === p.jobType;
                return (
                  <button key={p.jobType} onClick={() => { setDailyProgram(p.jobType); setDailyRegion("Combined"); setDailyRocFilter(null); }}
                    style={{ padding: "0.3rem 0.75rem", borderRadius: "5px",
                      border: `1px solid ${active ? "#2563eb" : `var(--border)`}`,
                      background: active ? "#2563eb18" : "transparent",
                      color: active ? "#2563eb" : `var(--text-dim)`,
                      fontFamily: "monospace", fontSize: "1.05rem", cursor: "pointer", fontWeight: active ? 700 : 400 }}>
                    {p.jobType}
                    <span style={{ opacity: 0.5, marginLeft: "0.3rem", fontSize: "0.9rem" }}>{p.totalGoals}g</span>
                  </button>
                );
              })}
            </div>
            {/* ROC drilldown buttons — appear when selected program has multiple funding sources */}
            {dailyProgram !== "All" && goalLookup && (() => {
              const entries = getGoalEntries(goalLookup, dailyProgram);
              const allRows = entries.flatMap(e => Object.values(e.siteMap).flat());
              const targets = [...new Set(allRows.map(r => r._target).filter(Boolean))];
              if (targets.length <= 1) return null;
              const opts = targets.map(t => {
                const row = allRows.find(r => r._target === t);
                return { target: t, roc: row?._roc || "", funding: row?._funding || "" };
              });
              return (
                <div style={{ display: "flex", gap: "0.35rem", flexWrap: "wrap", marginTop: "0.5rem" }}>
                  <button onClick={() => setDailyRocFilter(null)}
                    style={{ padding: "0.2rem 0.6rem", borderRadius: "5px", border: `1px solid ${!dailyRocFilter ? "#6366f1" : "var(--border)"}`, background: !dailyRocFilter ? "#6366f118" : "transparent", color: !dailyRocFilter ? "#6366f1" : `var(--text-dim)`, fontFamily: "monospace", fontSize: "0.9rem", cursor: "pointer" }}>
                    All ROCs
                  </button>
                  {opts.map(opt => (
                    <button key={opt.roc} onClick={() => setDailyRocFilter(dailyRocFilter === opt.roc ? null : opt.roc)}
                      style={{ padding: "0.2rem 0.6rem", borderRadius: "5px", border: `1px solid ${dailyRocFilter === opt.roc ? "#6366f1" : "var(--border)"}`, background: dailyRocFilter === opt.roc ? "#6366f118" : "transparent", color: dailyRocFilter === opt.roc ? "#6366f1" : `var(--text-dim)`, fontFamily: "monospace", fontSize: "0.9rem", cursor: "pointer", display: "flex", gap: "0.3rem", alignItems: "center" }}>
                      <span>{opt.roc}</span>
                      {opt.funding && <span style={{ fontSize: "0.8rem", color: dailyRocFilter === opt.roc ? "#818cf8" : `var(--text-faint)` }}>{opt.funding}</span>}
                    </button>
                  ))}
                </div>
              );
            })()}
          </div>
        )}

        {/* Summary strip */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: "0.5rem", marginBottom: "1rem", padding: "0.75rem", background: `var(--bg-primary)`, borderRadius: "8px", border: "1px solid var(--border)" }}>
          {[
            { l: "Days Worked", v: worked.length, c: "#16a34a" },
            { l: "Total Hours", v: fmt(totalHrs, 1), c: "#6366f1" },
            { l: "Total Goals", v: totalGoals || "—", c: "#d97706" },
            { l: "Avg GPH", v: overallGph > 0 ? overallGph.toFixed(3) : "—", c: sg ? attainColor((overallGph / sg) * 100) : "#16a34a" },
            { l: "Total HSD", v: totalHsd || "—", c: "#2563eb" },
            { l: "Total XM", v: totalXm || "—", c: "#8b5cf6" },
            { l: "% to Goal", v: sg && overallGph > 0 ? Math.round((overallGph / sg) * 100) + "%" : "—", c: sg ? attainColor((overallGph / sg) * 100) : `var(--text-dim)` },
          ].map(({ l, v, c }) => (
            <div key={l} style={{ textAlign: "center" }}>
              <div style={{ fontFamily: "'Cormorant Garamond', Georgia, serif", fontSize: "1.65rem", color: c, fontWeight: 700, lineHeight: 1 }}>{v}</div>
              <div style={{ fontFamily: "monospace", fontSize: "0.85rem", color: `var(--text-dim)`, marginTop: "0.15rem" }}>{l}</div>
            </div>
          ))}
        </div>

        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "monospace", fontSize: "1.05rem" }}>
            <thead>
              <tr style={{ borderBottom: "2px solid var(--border)" }}>
                {["Date","Day","Agents","Hours","Goals","GPH","HSD","XM","% to Goal"].map(h => (
                  <th key={h} style={{ padding: "0.4rem 0.6rem", textAlign: h === "Date" || h === "Day" ? "left" : "right",
                    fontWeight: 400, color: `var(--text-dim)`, whiteSpace: "nowrap" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {weekGroups.map((wg, wi) => {
                const wWorked = wg.days.filter(d => !d.absent);
                const wHrs = wWorked.reduce((s, d) => s + d.hours, 0);
                const wGoals = wWorked.reduce((s, d) => s + d.goals, 0);
                const wHsd = wWorked.reduce((s, d) => s + d.hsd, 0);
                const wXm = wWorked.reduce((s, d) => s + d.xm, 0);
                const wAgentCount = wWorked.length > 0 ? Math.round(wWorked.reduce((s, d) => s + d.agentCount, 0) / wWorked.length) : 0;
                const wGph = wHrs > 0 ? wGoals / wHrs : 0;
                const wPct = sg && wHrs > 0 ? (wGph / sg) * 100 : null;
                return [
                  ...wg.days.map((d, di) => {
                    if (d.absent) {
                      return (
                        <tr key={d.date} style={{ background: `var(--bg-primary)`, opacity: 0.4 }}>
                          <td style={{ padding: "0.35rem 0.6rem", color: `var(--text-faint)` }}>{d.date?.slice(5)}</td>
                          <td style={{ padding: "0.35rem 0.6rem", color: `var(--text-faint)` }}>{dayLabel(d.date)}</td>
                          <td colSpan={7} style={{ padding: "0.35rem 0.6rem", textAlign: "center", color: `var(--text-faint)`, fontStyle: "italic" }}>no activity</td>
                        </tr>
                      );
                    }
                    const pct = sg && d.gph > 0 ? (d.gph / sg) * 100 : null;
                    const pctColor = pct !== null ? attainColor(pct) : `var(--text-faint)`;
                    const gphColor = sg && d.gph > 0 ? attainColor((d.gph / sg) * 100) : d.gph > 0 ? `var(--text-secondary)` : `var(--text-faint)`;
                    return (
                      <Fragment key={d.date}>
                      <tr style={{ borderBottom: "1px solid var(--bg-tertiary)",
                        background: selectedDate === d.date ? "#d9770618" : di % 2 === 0 ? "transparent" : `var(--bg-row-alt)`, cursor: "pointer" }}
                        onClick={() => { setSelectedDate(selectedDate === d.date ? null : d.date); setSelectedDrillJob(null); }}>
                        <td style={{ padding: "0.35rem 0.6rem", color: `var(--text-secondary)` }}>{d.date?.slice(5)}</td>
                        <td style={{ padding: "0.35rem 0.6rem", color: `var(--text-dim)` }}>{dayLabel(d.date)}</td>
                        <td style={{ padding: "0.35rem 0.6rem", textAlign: "right", color: `var(--text-secondary)` }}>{d.agentCount}</td>
                        <td style={{ padding: "0.35rem 0.6rem", textAlign: "right", color: "#6366f1" }}>{d.hours.toFixed(1)}</td>
                        <td style={{ padding: "0.35rem 0.6rem", textAlign: "right", color: d.goals > 0 ? "#d97706" : `var(--text-faint)`, fontWeight: d.goals > 0 ? 700 : 400 }}>{d.goals || "—"}</td>
                        <td style={{ padding: "0.35rem 0.6rem", textAlign: "right", color: gphColor, fontWeight: 600 }}>{d.gph > 0 ? d.gph.toFixed(3) : "—"}</td>
                        <td style={{ padding: "0.35rem 0.6rem", textAlign: "right", color: d.hsd > 0 ? "#2563eb" : `var(--text-faint)`, fontWeight: d.hsd > 0 ? 700 : 400 }}>{d.hsd || "—"}</td>
                        <td style={{ padding: "0.35rem 0.6rem", textAlign: "right", color: d.xm > 0 ? "#8b5cf6" : `var(--text-faint)`, fontWeight: d.xm > 0 ? 700 : 400 }}>{d.xm || "—"}</td>
                        <td style={{ padding: "0.35rem 0.6rem", textAlign: "right" }}>
                          {pct !== null ? (
                            <span style={{ color: pctColor, fontWeight: 700, background: pctColor + "12", border: `1px solid ${pctColor}30`, borderRadius: "3px", padding: "0.1rem 0.35rem" }}>
                              {Math.round(pct)}%
                            </span>
                          ) : "—"}
                        </td>
                      </tr>
                      {selectedDate === d.date && (() => {
                        let dateAgents = activeAgents.filter(a => a.date === d.date && a.hours > 0);
                        if (dailyRegion !== "Combined") {
                          if (dailyRegion === "Combined (BZ)") {
                            dateAgents = dateAgents.filter(a => regionInfo.bz.includes(a.region));
                          } else {
                            dateAgents = dateAgents.filter(a => a.region === dailyRegion);
                          }
                        }
                        const byJob = {};
                        dateAgents.forEach(a => {
                          const jt = a.jobType || "Unknown";
                          if (!byJob[jt]) byJob[jt] = { hrs: 0, goals: 0, goalsNum: 0, hsd: 0, xm: 0, agents: [] };
                          byJob[jt].hrs += a.hours; byJob[jt].goals += a.goals; byJob[jt].goalsNum += a.goalsNum || 0;
                          byJob[jt].hsd += a.newXI || 0; byJob[jt].xm += a.xmLines || 0;
                          byJob[jt].agents.push(a);
                        });
                        const jobs = Object.entries(byJob).sort((a, b) => b[1].goals - a[1].goals);
                        return (
                          <tr><td colSpan={9} style={{ padding: 0 }}>
                            <div style={{ padding: "0.6rem 1rem", background: "#d9770608", borderLeft: "3px solid #d97706" }}>
                              <div style={{ fontFamily: "monospace", fontSize: "0.85rem", color: `var(--text-faint)`, letterSpacing: "0.08em", marginBottom: "0.5rem" }}>
                                {singleProgram ? "AGENT DETAIL" : (selectedDrillJob ? "AGENT DETAIL" : "PROGRAM BREAKDOWN")} {"\u2014"} {d.date} ({dayLabel(d.date)})
                                {!singleProgram && selectedDrillJob && (
                                  <button onClick={e => { e.stopPropagation(); setSelectedDrillJob(null); }}
                                    style={{ marginLeft: "0.75rem", padding: "0.15rem 0.5rem", borderRadius: "4px", border: "1px solid #d97706", background: "#d9770618", color: "#d97706", fontFamily: "monospace", fontSize: "0.85rem", cursor: "pointer" }}>
                                    {"\u2190"} Back to Programs
                                  </button>
                                )}
                              </div>
                              {!singleProgram && !selectedDrillJob && (
                                <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "monospace", fontSize: "0.9rem" }}>
                                  <thead><tr style={{ borderBottom: "1px solid var(--border)" }}>
                                    {["Program", "Agents", "Hours", "Sales", "GPH", "% Goal", "CPS", "HSD", "XM"].map(h => (
                                      <th key={h} style={{ padding: "0.3rem 0.5rem", textAlign: h === "Program" ? "left" : "right", color: `var(--text-faint)`, fontWeight: 400 }}>{h}</th>
                                    ))}
                                  </tr></thead>
                                  <tbody>
                                    {jobs.map(([jt, data], ji) => {
                                      const jGph = data.hrs > 0 ? data.goals / data.hrs : 0;
                                      const jCps = data.goals > 0 ? (data.hrs * 19.77) / data.goals : data.hrs * 19.77;
                                      const jPctGoal = data.goalsNum > 0 ? (data.goals / data.goalsNum) * 100 : null;
                                      const pColor = jPctGoal !== null ? attainColor(jPctGoal) : (sg ? attainColor(jGph / sg * 100) : `var(--text-primary)`);
                                      return (
                                        <tr key={jt} onClick={e => { e.stopPropagation(); setSelectedDrillJob(jt); }}
                                          style={{ borderBottom: "1px solid var(--bg-tertiary)", cursor: "pointer", background: ji % 2 === 0 ? "transparent" : `var(--bg-row-alt)` }}>
                                          <td style={{ padding: "0.3rem 0.5rem", color: `var(--text-warm)`, fontFamily: "Georgia, serif" }}>{jt}</td>
                                          <td style={{ padding: "0.3rem 0.5rem", textAlign: "right", color: `var(--text-dim)` }}>{data.agents.length}</td>
                                          <td style={{ padding: "0.3rem 0.5rem", textAlign: "right", color: "#6366f1" }}>{data.hrs.toFixed(1)}</td>
                                          <td style={{ padding: "0.3rem 0.5rem", textAlign: "right", color: data.goals > 0 ? "#d97706" : `var(--text-faint)`, fontWeight: 700 }}>{data.goals || "\u2014"}</td>
                                          <td style={{ padding: "0.3rem 0.5rem", textAlign: "right", color: pColor, fontWeight: 600 }}>{jGph > 0 ? jGph.toFixed(3) : "\u2014"}</td>
                                          <td style={{ padding: "0.3rem 0.5rem", textAlign: "right" }}>
                                            {jPctGoal !== null ? (
                                              <span style={{ color: pColor, fontWeight: 700, background: pColor + "12", border: `1px solid ${pColor}30`, borderRadius: "3px", padding: "0.1rem 0.3rem" }}>{Math.round(jPctGoal)}%</span>
                                            ) : "\u2014"}
                                          </td>
                                          <td style={{ padding: "0.3rem 0.5rem", textAlign: "right", color: pColor }}>${jCps.toFixed(2)}</td>
                                          <td style={{ padding: "0.3rem 0.5rem", textAlign: "right", color: data.hsd > 0 ? "#2563eb" : `var(--text-faint)` }}>{data.hsd || "\u2014"}</td>
                                          <td style={{ padding: "0.3rem 0.5rem", textAlign: "right", color: data.xm > 0 ? "#8b5cf6" : `var(--text-faint)` }}>{data.xm || "\u2014"}</td>
                                        </tr>);
                                    })}
                                  </tbody>
                                </table>
                              )}
                              {(singleProgram || selectedDrillJob) && (() => {
                                const drillJob = singleProgram ? (jobs.length > 0 ? jobs[0][0] : null) : selectedDrillJob;
                                const data = drillJob ? byJob[drillJob] : null;
                                if (!data) return null;
                                return (
                                  <div>
                                    <div style={{ fontFamily: "Georgia, serif", fontSize: "1.05rem", color: `var(--text-warm)`, marginBottom: "0.3rem" }}>
                                      <span style={{ fontWeight: 700 }}>{drillJob}</span>
                                      <span style={{ fontFamily: "monospace", fontSize: "0.9rem", color: `var(--text-dim)`, marginLeft: "0.75rem" }}>{data.agents.length} agents {"\u00b7"} {data.goals} sales {"\u00b7"} {data.hrs.toFixed(1)} hrs</span>
                                    </div>
                                    <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "monospace", fontSize: "0.88rem" }}>
                                      <thead><tr style={{ borderBottom: "1px solid var(--border)" }}>
                                        {["Agent","Supervisor","Hours","Sales","GPH","% Goal","CPS","HSD","XM"].map(h => (
                                          <th key={h} style={{ padding: "0.2rem 0.5rem", textAlign: h === "Agent" || h === "Supervisor" ? "left" : "right", color: `var(--text-faint)`, fontWeight: 400 }}>{h}</th>
                                        ))}
                                      </tr></thead>
                                      <tbody>
                                        {data.agents.sort((x, y) => y.hours - x.hours).map((a, ai) => {
                                          const aGph = a.hours > 0 ? a.goals / a.hours : 0;
                                          const aCps = a.goals > 0 ? (a.hours * 19.77) / a.goals : a.hours * 19.77;
                                          const aPctGoal = a.goalsNum > 0 ? (a.goals / a.goalsNum) * 100 : null;
                                          const pClr = aPctGoal !== null ? attainColor(aPctGoal) : (sg ? attainColor(aGph / sg * 100) : `var(--text-secondary)`);
                                          const qColor = Q[a.quartile]?.color || `var(--text-faint)`;
                                          return (
                                            <tr key={a.agentName} style={{ borderBottom: "1px solid var(--bg-tertiary)", background: ai % 2 === 0 ? "transparent" : `var(--bg-row-alt)` }}>
                                              <td style={{ padding: "0.2rem 0.5rem", color: qColor }}>{a.agentName}</td>
                                              <td style={{ padding: "0.2rem 0.5rem", color: `var(--text-dim)` }}>{a.supervisor || "\u2014"}</td>
                                              <td style={{ padding: "0.2rem 0.5rem", textAlign: "right", color: "#6366f1" }}>{a.hours.toFixed(1)}</td>
                                              <td style={{ padding: "0.2rem 0.5rem", textAlign: "right", color: a.goals > 0 ? "#d97706" : `var(--text-faint)`, fontWeight: a.goals > 0 ? 700 : 400 }}>{a.goals || "\u2014"}</td>
                                              <td style={{ padding: "0.2rem 0.5rem", textAlign: "right", color: pClr, fontWeight: 600 }}>{aGph > 0 ? aGph.toFixed(3) : "\u2014"}</td>
                                              <td style={{ padding: "0.2rem 0.5rem", textAlign: "right" }}>
                                                {aPctGoal !== null ? (
                                                  <span style={{ color: pClr, fontWeight: 700, background: pClr + "12", border: `1px solid ${pClr}30`, borderRadius: "3px", padding: "0.05rem 0.25rem", fontSize: "0.85rem" }}>{Math.round(aPctGoal)}%</span>
                                                ) : "\u2014"}
                                              </td>
                                              <td style={{ padding: "0.2rem 0.5rem", textAlign: "right", color: pClr }}>${aCps.toFixed(2)}</td>
                                              <td style={{ padding: "0.2rem 0.5rem", textAlign: "right", color: (a.newXI || 0) > 0 ? "#2563eb" : `var(--text-faint)` }}>{a.newXI || "\u2014"}</td>
                                              <td style={{ padding: "0.2rem 0.5rem", textAlign: "right", color: (a.xmLines || 0) > 0 ? "#8b5cf6" : `var(--text-faint)` }}>{a.xmLines || "\u2014"}</td>
                                            </tr>);
                                        })}
                                      </tbody>
                                    </table>
                                  </div>
                                );
                              })()}
                            </div>
                          </td></tr>
                        );
                      })()}
                      </Fragment>
                    );
                  }),
                  wWorked.length > 0 && (
                    <tr key={`wk-${wg.wk}`} style={{ borderBottom: "2px solid var(--border)", background: `var(--bg-tertiary)`, cursor: "pointer" }}
                      onClick={() => { const wkKey = `wk-${wg.wk}`; setSelectedDate(selectedDate === wkKey ? null : wkKey); }}>
                      <td colSpan={2} style={{ padding: "0.4rem 0.6rem", color: `var(--text-muted)`, fontWeight: 700 }}>
                        Wk {wg.wk.slice(5)}
                      </td>
                      <td style={{ padding: "0.4rem 0.6rem", textAlign: "right", color: `var(--text-muted)`, fontWeight: 700 }}>~{wAgentCount}</td>
                      <td style={{ padding: "0.4rem 0.6rem", textAlign: "right", color: "#6366f1", fontWeight: 700 }}>{wHrs.toFixed(1)}</td>
                      <td style={{ padding: "0.4rem 0.6rem", textAlign: "right", color: wGoals > 0 ? "#d97706" : `var(--text-faint)`, fontWeight: 700 }}>{wGoals || "—"}</td>
                      <td style={{ padding: "0.4rem 0.6rem", textAlign: "right", color: sg ? attainColor((wGph / sg) * 100) : `var(--text-dim)`, fontWeight: 700 }}>{wGph > 0 ? wGph.toFixed(3) : "—"}</td>
                      <td style={{ padding: "0.4rem 0.6rem", textAlign: "right", color: wHsd > 0 ? "#2563eb" : `var(--text-faint)`, fontWeight: 700 }}>{wHsd || "—"}</td>
                      <td style={{ padding: "0.4rem 0.6rem", textAlign: "right", color: wXm > 0 ? "#8b5cf6" : `var(--text-faint)`, fontWeight: 700 }}>{wXm || "—"}</td>
                      <td style={{ padding: "0.4rem 0.6rem", textAlign: "right" }}>
                        {wPct !== null ? (
                          <span style={{ color: attainColor(wPct), fontWeight: 700 }}>{Math.round(wPct)}%</span>
                        ) : "—"}
                      </td>
                    </tr>
                  ),
                ];
              })}
            </tbody>
            <tfoot>
              <tr style={{ borderTop: "2px solid var(--border)", background: `var(--bg-row-alt)` }}>
                <td colSpan={2} style={{ padding: "0.5rem 0.6rem", color: `var(--text-warm)`, fontWeight: 700 }}>TOTAL</td>
                <td style={{ padding: "0.5rem 0.6rem", textAlign: "right", color: `var(--text-warm)`, fontWeight: 700 }}></td>
                <td style={{ padding: "0.5rem 0.6rem", textAlign: "right", color: "#6366f1", fontWeight: 700 }}>{totalHrs.toFixed(1)}</td>
                <td style={{ padding: "0.5rem 0.6rem", textAlign: "right", color: totalGoals > 0 ? "#d97706" : `var(--text-faint)`, fontWeight: 700 }}>{totalGoals || "—"}</td>
                <td style={{ padding: "0.5rem 0.6rem", textAlign: "right", color: sg ? attainColor((overallGph / sg) * 100) : `var(--text-dim)`, fontWeight: 700 }}>{overallGph > 0 ? overallGph.toFixed(3) : "—"}</td>
                <td style={{ padding: "0.5rem 0.6rem", textAlign: "right", color: totalHsd > 0 ? "#2563eb" : `var(--text-faint)`, fontWeight: 700 }}>{totalHsd || "—"}</td>
                <td style={{ padding: "0.5rem 0.6rem", textAlign: "right", color: totalXm > 0 ? "#8b5cf6" : `var(--text-faint)`, fontWeight: 700 }}>{totalXm || "—"}</td>
                <td style={{ padding: "0.5rem 0.6rem", textAlign: "right" }}>
                  {sg && overallGph > 0 ? (
                    <span style={{ color: attainColor((overallGph / sg) * 100), fontWeight: 700, background: attainColor((overallGph / sg) * 100) + "12", border: `1px solid ${attainColor((overallGph / sg) * 100)}30`, borderRadius: "3px", padding: "0.1rem 0.35rem" }}>
                      {Math.round((overallGph / sg) * 100)}%
                    </span>
                  ) : "—"}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  );
}

function Slide({ program, newHireSet, goalLookup, fiscalInfo, slideIndex, total, onNav, allAgents }) {
  const [tab, setTab] = useState("overview");
  const [rocFilter, setRocFilter] = useState(null); // null = all, or a specific ROC code
  const [rankSort, setRankSort] = useState({ key: "pctToGoal", dir: -1 });

  const {
    jobType, agents, regions,
    q1Agents, q2Agents, q3Agents, q4Agents,
    totalHours, totalGoals, gph,
    dist, distUnique,
    uniqueAgentCount, totalRowCount,
    hasNewXI, hasXMLines, hasNewXH, hasNewVideo,
    goalEntry, attainment, planGoals, actGoals,
    goalEntries,
    totalNewXI, totalXmLines, totalRgu,
    newHiresInProgram, healthScore,
  } = program;

  const allAgentsCtx = useMemo(() => agents, [agents]);

  // ROC-filtered agents for drilldown
  const filteredAgents = useMemo(() => {
    if (!rocFilter) return agents;
    return agents.filter(a => a.rocCode === rocFilter);
  }, [agents, rocFilter]);
  const fTotalHours = rocFilter ? filteredAgents.reduce((s, a) => s + a.hours, 0) : totalHours;
  const fTotalGoals = rocFilter ? filteredAgents.reduce((s, a) => s + a.goals, 0) : totalGoals;
  const fGph = fTotalHours > 0 ? fTotalGoals / fTotalHours : 0;
  const fTotalNewXI = rocFilter ? filteredAgents.reduce((s, a) => s + a.newXI, 0) : totalNewXI;
  const fTotalXmLines = rocFilter ? filteredAgents.reduce((s, a) => s + a.xmLines, 0) : totalXmLines;
  const fTotalRgu = rocFilter ? filteredAgents.reduce((s, a) => s + a.rgu, 0) : totalRgu;
  const fUniqueCount = rocFilter ? uniqueNames(filteredAgents).size : uniqueAgentCount;
  const winInsights  = useMemo(() => generateWinInsights(program), [program]);
  const narrative    = useMemo(() => generateNarrative(program, fiscalInfo, newHireSet), [program, fiscalInfo, newHireSet]);
  const oppInsights  = useMemo(() => generateOppInsights(program, allAgentsCtx, newHireSet), [program, allAgentsCtx, newHireSet]);

  const hasSupervisors = agents.some(a => a.supervisor);
  const hasWeeklyData  = agents.some(a => a.weekNum);
  const hasMultipleSites = regions.length > 1;

  // ROC/funding drilldown options
  const rocOptions = useMemo(() => {
    if (!goalEntry) return [];
    const allRows = Object.values(goalEntry).flat();
    const targets = [...new Set(allRows.map(r => r._target).filter(Boolean))];
    if (targets.length <= 1) return [];
    return targets.map(t => {
      const row = allRows.find(r => r._target === t);
      return { target: t, roc: row?._roc || "", funding: row?._funding || "" };
    });
  }, [goalEntry]);
  const tabs = [
    "overview",
    ...(hasMultipleSites ? ["bysite"] : []),
    "agents",
    ...(hasSupervisors || hasWeeklyData ? ["teams"] : []),
    ...(goalLookup ? ["goals"] : []),
    "daily",
  ];

  const q1Rate         = uniqueAgentCount > 0 ? ((distUnique.Q1 / uniqueAgentCount) * 100).toFixed(1) : "0.0";
  const highHoursCount = agents.filter(a => a.hours > 16).length;

  return (
    <div style={{ height: "calc(100vh - 32px)", background: `var(--bg-primary)`, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      {/* Header */}
      <div style={{ background: `var(--bg-secondary)`, borderBottom: "1px solid var(--border)", padding: "1.25rem 2.5rem", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "1rem", flexShrink: 0 }}>
        <div>
          <div style={{ fontFamily: "monospace", fontSize: "1.08rem", color: `var(--text-muted)`, letterSpacing: "0.15em", textTransform: "uppercase" }}>
            Program {slideIndex} of {total - 1} · {totalRowCount} records
          </div>
          <div style={{ fontFamily: "'Cormorant Garamond', Georgia, serif", fontSize: "3.38rem", color: `var(--text-warm)`, fontWeight: 700, letterSpacing: "-0.5px", lineHeight: 1.1 }}>
            {jobType}
          </div>
          {rocOptions.length > 0 && (
            <div style={{ display: "flex", gap: "0.35rem", marginTop: "0.4rem", flexWrap: "wrap" }}>
              <button onClick={() => setRocFilter(null)}
                style={{ padding: "0.2rem 0.6rem", borderRadius: "5px", border: `1px solid ${!rocFilter ? "#d97706" : "var(--border)"}`, background: !rocFilter ? "#d9770618" : "transparent", color: !rocFilter ? "#d97706" : `var(--text-dim)`, fontFamily: "monospace", fontSize: "0.9rem", cursor: "pointer" }}>
                All
              </button>
              {rocOptions.map(opt => (
                <button key={opt.roc} onClick={() => setRocFilter(rocFilter === opt.roc ? null : opt.roc)}
                  style={{ padding: "0.2rem 0.6rem", borderRadius: "5px", border: `1px solid ${rocFilter === opt.roc ? "#6366f1" : "var(--border)"}`, background: rocFilter === opt.roc ? "#6366f118" : "transparent", color: rocFilter === opt.roc ? "#6366f1" : `var(--text-dim)`, fontFamily: "monospace", fontSize: "0.9rem", cursor: "pointer", display: "flex", gap: "0.3rem", alignItems: "center" }}>
                  <span>{opt.roc}</span>
                  {opt.funding && <span style={{ fontSize: "0.8rem", color: rocFilter === opt.roc ? "#818cf8" : `var(--text-faint)` }}>{opt.funding}</span>}
                </button>
              ))}
            </div>
          )}
        </div>
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          {tabs.map(t => (
            <button key={t} onClick={() => setTab(t)}
              style={{ padding: "0.4rem 0.9rem", borderRadius: "6px", border: `1px solid ${tab===t?"#d97706":`var(--border)`}`, background: tab===t?"#d9770618":"transparent", color: tab===t?"#d97706":`var(--text-muted)`, fontFamily: "monospace", fontSize: "1.14rem", cursor: "pointer", textTransform: "capitalize", letterSpacing: "0.05em" }}>
              {t === "overview" ? "Overview" : t === "bysite" ? "By Site" : t === "agents" ? "All Agents" : t === "teams" ? "Teams" : t === "goals" ? "Ranking" : t === "daily" ? "Daily" : t}
            </button>
          ))}
        </div>
      </div>

      {/* Scrollable content */}
      <div style={{ flex: 1, overflowY: "auto", padding: "2rem 2.5rem" }}>

        {/* ── OVERVIEW TAB ── */}
        {tab === "overview" && (
          <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
            {/* Stat cards */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: "0.75rem" }}>
              <StatCard label="Agents"       value={fUniqueCount}            sub={rocFilter ? `filtered by ${rocFilter}` : `${distUnique.Q1} Q1 of ${uniqueAgentCount}`} accent="#d97706" />
              <StatCard label="GPH"          value={fmt(fGph, 2)}            sub="sum goals / sum hours"                                   accent="#2563eb" />
              <StatCard label="Total Goals"  value={fTotalGoals}             sub={planGoals ? `of ${planGoals} plan (${Math.round(attainment)}%)` : "conversions"} accent="#16a34a" />
              <StatCard label="Total Hours"  value={fmt(fTotalHours, 0)}     sub={rocFilter ? `${rocFilter} agents` : `${highHoursCount} over 16 hrs`} accent="#6366f1" />
              <StatCard label="Health Score" value={Math.round(healthScore)} sub="0\u2013100 composite"                                         accent={attainColor(healthScore)} />
            </div>

            {/* Narrative Summary */}
            <CollapsibleNarrative title="Executive Summary" lines={narrative} defaultOpen={false} />

            {/* Goals vs Plan — immediately after stat cards when goals loaded */}
            {goalEntry && (() => {
              // Filter goalEntry rows by selected ROC if active
              const filteredEntry = rocFilter ? Object.fromEntries(
                Object.entries(goalEntry).map(([site, rows]) => [site, rows.filter(r => r._roc === rocFilter)]).filter(([, rows]) => rows.length > 0)
              ) : goalEntry;
              const rocLabel = rocFilter ? rocOptions.find(o => o.roc === rocFilter) : null;
              const title = rocFilter ? `Goals vs Plan — ${rocLabel?.target || rocFilter} (${rocLabel?.funding || ""})` : `Goals vs Plan — ${jobType}`;
              if (Object.keys(filteredEntry).length === 0) return null;
              return (
                <MetricComparePanel
                  title={title}
                  fiscalInfo={fiscalInfo}
                  metrics={[
                    { label: "Total Hours",  actual: totalHours,   plan: getPlanForKey(filteredEntry, "Hours Goal")      },
                    { label: "Total Goals",  actual: actGoals,     plan: getPlanForKey(filteredEntry, "HOMES GOAL")       },
                    { label: "Total RGU",    actual: totalRgu,     plan: getPlanForKey(filteredEntry, "RGU GOAL")         },
                    { label: "New XI (HSD)", actual: totalNewXI,   plan: getPlanForKey(filteredEntry, "HSD Sell In Goal") },
                    { label: "XM Lines",     actual: totalXmLines, plan: hasXMLines ? getPlanForKey(filteredEntry, "XM GOAL") : null },
                  ]}
                />
              );
            })()}

            {/* Funding / ROC breakout — shows goal targets per funding source */}
            {(() => {
              if (!goalEntry) return null;
              const allRows = Object.values(goalEntry).flat();
              const targets = [...new Set(allRows.map(r => r._target).filter(Boolean))];
              if (targets.length === 0) return null;
              const sites = Object.keys(goalEntry);
              return (
                <div style={{ background: `var(--bg-secondary)`, border: "1px solid var(--border)", borderRadius: "12px", padding: "1.25rem 1.5rem" }}>
                  <div style={{ fontFamily: "monospace", fontSize: "0.95rem", color: `var(--text-faint)`, letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: "0.75rem" }}>
                    GOAL BREAKOUT BY FUNDING
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: `2.5fr ${sites.map(() => "1fr 1fr 1fr").join(" ")}`, gap: "0.4rem 0.75rem", alignItems: "center" }}>
                    {/* Header */}
                    <div style={{ fontFamily: "monospace", fontSize: "0.85rem", color: `var(--text-faint)` }}>Target</div>
                    {sites.map(s => (
                      <Fragment key={s}>
                        <div style={{ fontFamily: "monospace", fontSize: "0.85rem", color: `var(--text-faint)`, textAlign: "right" }}>{s} Homes</div>
                        <div style={{ fontFamily: "monospace", fontSize: "0.85rem", color: `var(--text-faint)`, textAlign: "right" }}>{s} Hours</div>
                        <div style={{ fontFamily: "monospace", fontSize: "0.85rem", color: `var(--text-faint)`, textAlign: "right" }}>{s} SPH</div>
                      </Fragment>
                    ))}
                    {/* Rows per target */}
                    {targets.map(t => {
                      const tRows = allRows.filter(r => r._target === t);
                      const funding = tRows[0]?._funding || "";
                      const roc = tRows[0]?._roc || "";
                      return (
                        <Fragment key={t}>
                          <div style={{ display: "flex", gap: "0.4rem", alignItems: "center", padding: "0.3rem 0", borderTop: "1px solid var(--bg-tertiary)" }}>
                            <span style={{ fontFamily: "monospace", fontSize: "0.88rem", color: `var(--text-dim)` }}>{roc}</span>
                            <span style={{ fontFamily: "Georgia, serif", fontSize: "1rem", color: `var(--text-secondary)` }}>{t}</span>
                            {funding && <span style={{ fontFamily: "monospace", fontSize: "0.8rem", color: "#6366f1", background: "#6366f108", border: "1px solid #6366f130", borderRadius: "3px", padding: "0 0.25rem" }}>{funding}</span>}
                          </div>
                          {sites.map(s => {
                            const sRows = tRows.filter(r => {
                              const rSite = (findCol(r, "Site") || "").trim().toUpperCase();
                              return rSite === s;
                            });
                            if (sRows.length === 0) return (
                              <Fragment key={s}>
                                <div style={{ textAlign: "right", fontFamily: "monospace", fontSize: "0.95rem", color: `var(--text-faint)`, borderTop: "1px solid var(--bg-tertiary)", padding: "0.3rem 0" }}>{"\u2014"}</div>
                                <div style={{ textAlign: "right", fontFamily: "monospace", fontSize: "0.95rem", color: `var(--text-faint)`, borderTop: "1px solid var(--bg-tertiary)", padding: "0.3rem 0" }}>{"\u2014"}</div>
                                <div style={{ textAlign: "right", fontFamily: "monospace", fontSize: "0.95rem", color: `var(--text-faint)`, borderTop: "1px solid var(--bg-tertiary)", padding: "0.3rem 0" }}>{"\u2014"}</div>
                              </Fragment>
                            );
                            const pr = sRows.map(r => computePlanRow(r));
                            const homes = pr.reduce((a, p) => a + p.homesGoal, 0);
                            const hours = pr.reduce((a, p) => a + p.hoursGoal, 0);
                            const sph = pr.length > 0 ? pr.reduce((a, p) => a + p.sphGoal, 0) / pr.length : 0;
                            return (
                              <Fragment key={s}>
                                <div style={{ textAlign: "right", fontFamily: "monospace", fontSize: "0.95rem", color: `var(--text-primary)`, borderTop: "1px solid var(--bg-tertiary)", padding: "0.3rem 0" }}>{homes.toLocaleString()}</div>
                                <div style={{ textAlign: "right", fontFamily: "monospace", fontSize: "0.95rem", color: `var(--text-primary)`, borderTop: "1px solid var(--bg-tertiary)", padding: "0.3rem 0" }}>{Math.round(hours).toLocaleString()}</div>
                                <div style={{ textAlign: "right", fontFamily: "monospace", fontSize: "0.95rem", color: `var(--text-primary)`, borderTop: "1px solid var(--bg-tertiary)", padding: "0.3rem 0" }}>{sph.toFixed(3)}</div>
                              </Fragment>
                            );
                          })}
                        </Fragment>
                      );
                    })}
                  </div>
                </div>
              );
            })()}

            {/* Quartile breakdown */}
            <div style={{ background: `var(--bg-secondary)`, border: "1px solid var(--border)", borderRadius: "12px", padding: "1.5rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.1rem" }}>
                <div style={{ fontFamily: "monospace", fontSize: "1.14rem", color: `var(--text-muted)`, letterSpacing: "0.12em", textTransform: "uppercase" }}>Quartile Distribution</div>
                <div style={{ fontFamily: "monospace", fontSize: "1.17rem", color: `var(--text-faint)` }}>ranked on total period GPH</div>
              </div>
              {(() => {
                // Aggregate per unique agent: sum hours, goals, goalsNum
                const agentAgg = {};
                agents.forEach(a => {
                  if (!a.agentName) return;
                  if (!agentAgg[a.agentName]) agentAgg[a.agentName] = { hours: 0, goals: 0, goalsNum: 0, quartile: a.quartile };
                  agentAgg[a.agentName].hours    += a.hours;
                  agentAgg[a.agentName].goals    += a.goals;
                  agentAgg[a.agentName].goalsNum += a.goalsNum;
                });
                const agentList = Object.values(agentAgg);
                const total = agentList.length;
                return (
                  <>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "0.75rem", marginBottom: "1rem" }}>
                      {["Q1","Q2","Q3","Q4"].map(q => {
                        const inQ    = agentList.filter(a => a.quartile === q);
                        const total  = inQ.length;
                        const active = inQ.filter(a => a.hours >= 16).length;
                        const pct    = agentList.length ? Math.round(total / agentList.length * 100) : 0;
                        const qHours = inQ.reduce((s, a) => s + a.hours, 0);
                        return (
                          <div key={q} style={{ padding: "1rem", borderRadius: "8px", background: Q[q].color+"12", border: `1px solid ${Q[q].color}30`, textAlign: "center" }}>
                            <div style={{ fontFamily: "'Cormorant Garamond', Georgia, serif", fontSize: "4.2rem", color: Q[q].color, fontWeight: 700, lineHeight: 1 }}>{active}</div>
                            <div style={{ fontFamily: "monospace", fontSize: "1.08rem", color: Q[q].color, marginTop: "0.2rem" }}>{q} · 16+ hrs</div>
                            <div style={{ fontFamily: "Georgia, serif", fontSize: "1.11rem", color: `var(--text-muted)`, marginTop: "0.15rem" }}>{Q[q].label}</div>
                            <div style={{ marginTop: "0.5rem", paddingTop: "0.5rem", borderTop: `1px solid ${Q[q].color}20` }}>
                              <div style={{ fontFamily: "monospace", fontSize: "1.08rem", color: `var(--text-dim)` }}>{total} total · {pct}%</div>
                              <div style={{ fontFamily: "monospace", fontSize: "1.08rem", color: "#6366f1", marginTop: "0.2rem" }}>{fmt(qHours, 0)} hrs</div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    <div style={{ marginBottom: "0.4rem" }}>
                      <div style={{ fontFamily: "monospace", fontSize: "1.14rem", color: `var(--text-dim)`, marginBottom: "0.25rem" }}>UNIQUE AGENTS BY QUARTILE</div>
                      <div style={{ display: "flex", height: "8px", borderRadius: "6px", overflow: "hidden" }}>
                        {["Q1","Q2","Q3","Q4"].map(q => (
                          <div key={q} style={{ flex: agentList.filter(a=>a.quartile===q).length||0, background: Q[q].color, transition: "flex 0.6s" }} />
                        ))}
                      </div>
                    </div>
                    <div>
                      <div style={{ fontFamily: "monospace", fontSize: "1.14rem", color: `var(--text-dim)`, marginBottom: "0.25rem" }}>HOURS BY QUARTILE</div>
                      <div style={{ display: "flex", height: "6px", borderRadius: "4px", overflow: "hidden" }}>
                        {["Q1","Q2","Q3","Q4"].map(q => {
                          const h = agentList.filter(a=>a.quartile===q).reduce((s,a)=>s+a.hours,0);
                          return <div key={q} style={{ flex: h||0, background: Q[q].color+"99", transition: "flex 0.6s" }} />;
                        })}
                      </div>
                    </div>
                  </>
                );
              })()}
            </div>

            {/* Site quartile breakdown — unique agents per region */}
            {regions.length > 0 && (
              <div style={{ background: `var(--bg-secondary)`, border: "1px solid var(--border)", borderRadius: "12px", padding: "1.5rem" }}>
                <div style={{ fontFamily: "monospace", fontSize: "1.14rem", color: `var(--text-muted)`, letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: "1.1rem" }}>Quartile Breakdown by Site</div>
                <div style={{ display: "grid", gap: "1rem" }}>
                  {regions.map(r => {
                    // Aggregate hours+goals per unique agent within this region
                    const regionAgentAgg = {};
                    agents.filter(a => a.region === r.name).forEach(a => {
                      if (!a.agentName) return;
                      if (!regionAgentAgg[a.agentName]) regionAgentAgg[a.agentName] = { hours: 0, goals: 0, quartile: a.quartile };
                      regionAgentAgg[a.agentName].hours += a.hours;
                      regionAgentAgg[a.agentName].goals += a.goals;
                    });
                    const regionAgents = Object.values(regionAgentAgg);
                    const rd         = { Q1: 0, Q2: 0, Q3: 0, Q4: 0 };
                    const rHoursByQ  = { Q1: 0, Q2: 0, Q3: 0, Q4: 0 };
                    regionAgents.forEach(a => {
                      if (rd[a.quartile] !== undefined) rd[a.quartile]++;
                      rHoursByQ[a.quartile] = (rHoursByQ[a.quartile] || 0) + a.hours;
                    });
                    const totalRHrs = regionAgents.reduce((s, a) => s + a.hours, 0);
                    const over16    = regionAgents.filter(a => a.hours >= 16).length;
                    const rTotal    = regionAgents.length;
                    return (
                      <div key={r.name} style={{ padding: "0.9rem 1rem", background: `var(--bg-primary)`, borderRadius: "8px", border: "1px solid var(--bg-tertiary)" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.6rem" }}>
                          <span style={{ fontFamily: "Georgia, serif", fontSize: "1.27rem", color: `var(--text-primary)`, fontWeight: 600 }}>{r.name}</span>
                          <div style={{ display: "flex", gap: "1rem", alignItems: "center" }}>
                            <span style={{ fontFamily: "monospace", fontSize: "1.17rem", color: "#6366f1" }}>{fmt(totalRHrs, 0)} hrs{over16 > 0 ? ` · ${over16} at 16+` : ""}</span>
                            <span style={{ fontFamily: "monospace", fontSize: "1.17rem", color: `var(--text-muted)` }}>{rTotal} agents</span>
                          </div>
                        </div>
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "0.4rem", marginBottom: "0.5rem" }}>
                          {["Q1","Q2","Q3","Q4"].map(q => {
                            const inQ    = regionAgents.filter(a => a.quartile === q);
                            const active = inQ.filter(a => a.hours >= 16).length;
                            return (
                            <div key={q} style={{ padding: "0.4rem 0.5rem", borderRadius: "5px", background: Q[q].color+"15", border: `1px solid ${Q[q].color}30`, textAlign: "center" }}>
                              <div style={{ fontFamily: "'Cormorant Garamond', Georgia, serif", fontSize: "2.1rem", color: Q[q].color, fontWeight: 700, lineHeight: 1 }}>{active}</div>
                              <div style={{ fontFamily: "monospace", fontSize: "1.17rem", color: Q[q].color+"cc", marginTop: "0.1rem" }}>{q} · 16+</div>
                              <div style={{ fontFamily: "monospace", fontSize: "0.81rem", color: `var(--text-faint)`, marginTop: "0.1rem" }}>{rd[q]} total</div>
                            </div>
                            );
                          })}
                        </div>
                        <div style={{ display: "flex", height: "8px", borderRadius: "4px", overflow: "hidden", gap: "1px" }}>
                          {["Q1","Q2","Q3","Q4"].map(q => rd[q] > 0 && (
                            <div key={q} style={{ flex: rd[q], background: Q[q].color }} />
                          ))}
                        </div>
                        <div style={{ display: "flex", gap: "0.75rem", marginTop: "0.35rem" }}>
                          {["Q1","Q2","Q3","Q4"].map(q => rHoursByQ[q] > 0 && (
                            <span key={q} style={{ fontFamily: "monospace", fontSize: "0.8rem", color: Q[q].color+"99" }}>{q}: {fmt(rHoursByQ[q], 0)}h</span>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* New hires banner */}
            {newHiresInProgram.length > 0 && (
              <div style={{ background: "#d9770610", border: "1px solid #d9770630", borderRadius: "10px", padding: "0.85rem 1.25rem", display: "flex", alignItems: "center", gap: "0.75rem" }}>
                <span style={{ fontSize: "1.5rem" }}>🌱</span>
                <span style={{ fontFamily: "Georgia, serif", fontSize: "1.2rem", color: "#fde68a" }}>
                  <strong style={{ color: "#d97706" }}>{newHiresInProgram.length} new hire{newHiresInProgram.length > 1 ? "s" : ""}</strong> active in this program ({newHiresInProgram.map(a => a.agentName).join(", ")}). Enhanced contextual insights included below.
                </span>
              </div>
            )}

            {/* Insights */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1.25rem" }}>
              <InsightCard type="win" insights={winInsights} />
              <InsightCard type="opp" insights={oppInsights} />
            </div>

            {/* Top performers + Priority Coaching */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1.25rem" }}>
              <div style={{ background: `var(--bg-secondary)`, border: "1px solid var(--border)", borderRadius: "12px", padding: "1.25rem" }}>
                <div style={{ fontFamily: "monospace", fontSize: "1.08rem", color: "#16a34a", letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: "0.35rem" }}>Top Performers</div>
                <div style={{ fontFamily: "monospace", fontSize: "1.14rem", color: `var(--text-dim)`, marginBottom: "0.9rem" }}>Q1 & Q2 · 16+ hours only</div>
                {(() => {
                  const topList = [...q1Agents, ...q2Agents].filter(a => a.hours >= 16).sort((a, b) => b.hours - a.hours).slice(0, 5);
                  if (topList.length === 0) return <div style={{ color: `var(--text-faint)`, fontFamily: "Georgia, serif", fontSize: "1.2rem" }}>No Q1/Q2 agents with 16+ hours yet</div>;
                  return topList.map((a, i) => {
                    const gph = a.hours > 0 ? (a.goals / a.hours).toFixed(3) : "0.000";
                    const pct = `${Math.round(a.pctToGoal)}%`;
                    return (
                    <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0.5rem 0", borderBottom: i < topList.length-1 ? "1px solid var(--bg-tertiary)" : "none" }}>
                      <div>
                        <div style={{ color: `var(--text-warm)`, fontFamily: "Georgia, serif", fontSize: "1.23rem", display: "flex", alignItems: "center", gap: "0.4rem" }}>
                          {a.agentName}
                          {newHireSet.has(a.agentName) && <span style={{ fontFamily: "monospace", fontSize: "1.08rem", color: "#d97706", background: "#d9770620", padding: "0.05rem 0.3rem", borderRadius: "2px" }}>NEW</span>}
                        </div>
                        <div style={{ fontFamily: "monospace", fontSize: "1.17rem", color: `var(--text-dim)` }}>{a.region} · {fmt(a.hours, 1)} hrs · {gph} GPH</div>
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "0.25rem" }}>
                        <div style={{ fontFamily: "'Cormorant Garamond', Georgia, serif", fontSize: "1.65rem", color: Q[a.quartile].color, fontWeight: 700 }}>{pct}</div>
                        <QBadge q={a.quartile} />
                      </div>
                    </div>
                    );
                  });
                })()}
              </div>

              <div style={{ background: `var(--bg-secondary)`, border: "1px solid var(--border)", borderRadius: "12px", padding: "1.25rem" }}>
                <div style={{ fontFamily: "monospace", fontSize: "1.08rem", color: "#dc2626", letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: "0.35rem" }}>Priority Coaching</div>
                <div style={{ fontFamily: "monospace", fontSize: "1.14rem", color: `var(--text-dim)`, marginBottom: "0.9rem" }}>Zero sales · ranked by hours invested</div>
                {q4Agents.length === 0 ? (
                  <div style={{ color: `var(--text-faint)`, fontFamily: "Georgia, serif", fontSize: "1.2rem" }}>No Q4 agents — excellent!</div>
                ) : q4Agents.slice(0, 5).map((a, i) => (
                  <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0.5rem 0", borderBottom: i < Math.min(q4Agents.length,5)-1 ? "1px solid var(--bg-tertiary)" : "none" }}>
                    <div>
                      <div style={{ color: `var(--text-warm)`, fontFamily: "Georgia, serif", fontSize: "1.23rem", display: "flex", alignItems: "center", gap: "0.4rem" }}>
                        {a.agentName}
                        {newHireSet.has(a.agentName) && <span style={{ fontFamily: "monospace", fontSize: "1.08rem", color: "#d97706", background: "#d9770620", padding: "0.05rem 0.3rem", borderRadius: "2px" }}>NEW</span>}
                        {a.hours > 16 && <span style={{ fontFamily: "monospace", fontSize: "1.08rem", color: "#6366f1", background: "#6366f120", padding: "0.05rem 0.3rem", borderRadius: "2px" }}>16+ HRS</span>}
                      </div>
                      <div style={{ fontFamily: "monospace", fontSize: "1.17rem", color: `var(--text-dim)` }}>{a.region} · 0 sales</div>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "0.25rem" }}>
                      <div style={{ fontFamily: "'Cormorant Garamond', Georgia, serif", fontSize: "1.65rem", color: "#6366f1", fontWeight: 700 }}>{fmt(a.hours, 1)} hrs</div>
                      <QBadge q={a._q} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ── BY SITE TAB (program-level) ── */}
        {tab === "bysite" && hasMultipleSites && (() => {
          // Group regions into site buckets: XOTM = BZ, everything else = DR
          const bzRegs = regions.filter(r => r.name.toUpperCase().includes("XOTM")).map(r => r.name);
          const drRegs = regions.filter(r => !r.name.toUpperCase().includes("XOTM")).map(r => r.name);
          const siteBuckets = [];
          if (drRegs.length > 0) siteBuckets.push({ label: drRegs.length === 1 ? drRegs[0] : "DR", regions: drRegs });
          if (bzRegs.length > 0) siteBuckets.push({ label: "BZ", regions: bzRegs });

          return (
            <ProgramBySiteTab
              agents={agents}
              regions={regions}
              siteBuckets={siteBuckets}
              jobType={jobType}
              goalEntry={goalEntry}
              goalLookup={goalLookup}
              fiscalInfo={fiscalInfo}
              newHireSet={newHireSet}
            />
          );
        })()}

        {/* ── REGIONS TAB ── */}
        {/* ── AGENTS TAB ── */}
        {tab === "agents" && (
          <div style={{ background: `var(--bg-secondary)`, border: "1px solid var(--border)", borderRadius: "12px", padding: "1.5rem" }}>
            <div style={{ fontFamily: "monospace", fontSize: "1.14rem", color: `var(--text-muted)`, letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: "1.1rem" }}>
              All Agents — {totalRowCount} records · click column headers to sort
            </div>
            <AgentTable agents={agents} newHireSet={newHireSet} />
          </div>
        )}

        {/* ── TEAMS TAB ── */}
        {tab === "teams" && (
          <TeamsView agents={agents} jobType={jobType} allAgents={allAgents} sphGoal={
            goalEntries.length > 0
              ? (() => {
                  const allRows = goalEntries.flatMap(e => Object.values(e.siteMap).flat());
                  const vals = allRows.map(r => computePlanRow(r).sphGoal).filter(v => v > 0);
                  return vals.length ? vals.reduce((s,v)=>s+v,0)/vals.length : null;
                })()
              : null
          } />
        )}

        {/* ── SUPERVISOR RANKING TAB ── */}
        {tab === "goals" && (() => {
          // Build supervisor stats for this program
          const supMap = {};
          const progAgents = filteredAgents;
          const progSphGoal = goalEntries.length > 0
            ? (() => { const allRows = goalEntries.flatMap(e => Object.values(e.siteMap).flat()); const vals = allRows.map(r => computePlanRow(r).sphGoal).filter(v => v > 0); return vals.length ? vals.reduce((s,v)=>s+v,0)/vals.length : null; })()
            : null;

          progAgents.forEach(a => {
            const sup = a.supervisor || "Unknown";
            if (!supMap[sup]) supMap[sup] = { name: sup, hours: 0, goals: 0, agents: {}, newXI: 0, xmLines: 0, regions: new Set(), weekData: {} };
            supMap[sup].hours += a.hours; supMap[sup].goals += a.goals;
            supMap[sup].newXI += a.newXI || 0; supMap[sup].xmLines += a.xmLines || 0;
            const aName2 = a.agentName || "";
            if (aName2 && !supMap[sup].agents[aName2]) supMap[sup].agents[aName2] = { hours: 0, goals: 0, goalsNum: 0 };
            if (aName2) { supMap[sup].agents[aName2].hours += a.hours; supMap[sup].agents[aName2].goals += a.goals; supMap[sup].agents[aName2].goalsNum += a.goalsNum || 0; }
            if (a.region) supMap[sup].regions.add(a.region);
            if (a.weekNum) {
              if (!supMap[sup].weekData[a.weekNum]) supMap[sup].weekData[a.weekNum] = { hours: 0, goals: 0 };
              supMap[sup].weekData[a.weekNum].hours += a.hours;
              supMap[sup].weekData[a.weekNum].goals += a.goals;
            }
          });

          const sups = Object.values(supMap).filter(s => s.name !== "Unknown").map(s => {
            const uniqueAgents = Object.entries(s.agents);
            const count = uniqueAgents.length;
            let q1 = 0, q2 = 0, q3 = 0, q4 = 0;
            uniqueAgents.forEach(([name, ag]) => {
              const pct = ag.goalsNum > 0 ? (ag.goals / ag.goalsNum) * 100 : (ag.goals > 0 ? 50 : 0);
              if (pct >= 100) q1++; else if (pct >= 75) q2++; else if (pct >= 50) q3++; else q4++;
            });
            s.q1 = q1; s.q2 = q2; s.q3 = q3; s.q4 = q4;
            const gph = s.hours > 0 ? s.goals / s.hours : 0;
            const pctToGoal = progSphGoal && progSphGoal > 0 ? (gph / progSphGoal) * 100 : null;
            const cps = s.goals > 0 ? (s.hours * 19.77) / s.goals : s.hours * 19.77;
            const q1Rate = count > 0 ? (q1 / count) * 100 : 0;
            // Weekly trend
            const wks = Object.keys(s.weekData).sort();
            const weeklyGph = wks.map(w => s.weekData[w].hours > 0 ? s.weekData[w].goals / s.weekData[w].hours : 0);
            const trending = weeklyGph.length >= 2 ? (weeklyGph[weeklyGph.length - 1] > weeklyGph[0] ? "up" : weeklyGph[weeklyGph.length - 1] < weeklyGph[0] * 0.9 ? "down" : "flat") : null;
            return { ...s, count, gph, pctToGoal, cps, q1Rate, weeklyGph, trending, regions: [...s.regions].join(", ") };
          }).sort((a, b) => {
            const va = a[rankSort.key] ?? -9999;
            const vb = b[rankSort.key] ?? -9999;
            if (typeof va === "string") return va.localeCompare(vb) * rankSort.dir;
            return (va - vb) * rankSort.dir;
          });

          const toggleSort = k => setRankSort(s => ({ key: k, dir: s.key === k ? -s.dir : -1 }));
          const RankTh = ({ k, label, left }) => (
            <th onClick={() => toggleSort(k)}
              style={{ padding: "0.4rem 0.5rem", textAlign: left ? "left" : "right", color: rankSort.key === k ? "#d97706" : `var(--text-faint)`, fontWeight: 600, fontSize: "0.85rem", whiteSpace: "nowrap", cursor: "pointer", userSelect: "none" }}>
              {label} {rankSort.key === k ? (rankSort.dir === -1 ? "\u2193" : "\u2191") : ""}
            </th>
          );

          const totHrs = sups.reduce((s, x) => s + x.hours, 0);
          const totGoals = sups.reduce((s, x) => s + x.goals, 0);
          const totGph = totHrs > 0 ? totGoals / totHrs : 0;
          const totPct = progSphGoal ? (totGph / progSphGoal) * 100 : null;

          return (
            <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
              {/* Header */}
              <div style={{ fontFamily: "monospace", fontSize: "1.14rem", color: `var(--text-muted)`, letterSpacing: "0.12em", textTransform: "uppercase" }}>
                Supervisor Ranking {progSphGoal ? `\u00b7 SPH Goal: ${progSphGoal.toFixed(3)}` : ""}
              </div>

              {/* Ranking table */}
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "monospace", fontSize: "0.95rem" }}>
                  <thead><tr style={{ borderBottom: "2px solid var(--border)" }}>
                    <th style={{ padding: "0.4rem 0.5rem", textAlign: "left", color: `var(--text-faint)`, fontWeight: 600, fontSize: "0.85rem" }}>#</th>
                    <RankTh k="name" label="Supervisor" left />
                    <th style={{ padding: "0.4rem 0.5rem", textAlign: "left", color: `var(--text-faint)`, fontWeight: 600, fontSize: "0.85rem" }}>Region</th>
                    <RankTh k="count" label="Agents" />
                    <RankTh k="hours" label="Hours" />
                    <RankTh k="goals" label="Sales" />
                    <RankTh k="gph" label="GPH" />
                    <RankTh k="pctToGoal" label="% Goal" />
                    <RankTh k="cps" label="CPS" />
                    <RankTh k="q1Rate" label="Q1%" />
                    <RankTh k="q1" label="Q1" />
                    <RankTh k="q2" label="Q2" />
                    <RankTh k="q3" label="Q3" />
                    <RankTh k="q4" label="Q4" />
                    <th style={{ padding: "0.4rem 0.5rem", textAlign: "right", color: `var(--text-faint)`, fontWeight: 600, fontSize: "0.85rem" }}>Trend</th>
                  </tr></thead>
                  <tbody>
                    {sups.map((s, i) => {
                      const pColor = s.pctToGoal !== null ? attainColor(s.pctToGoal) : `var(--text-dim)`;
                      const isTop = i === 0 && sups.length > 1;
                      const isBot = i === sups.length - 1 && sups.length > 1;
                      return (
                        <tr key={s.name} style={{ borderBottom: "1px solid var(--bg-tertiary)", background: isTop ? "#16a34a08" : isBot ? "#dc262608" : i % 2 === 0 ? "transparent" : `var(--bg-row-alt)` }}>
                          <td style={{ padding: "0.4rem 0.5rem", color: isTop ? "#16a34a" : isBot ? "#dc2626" : `var(--text-dim)`, fontWeight: 700 }}>{i + 1}</td>
                          <td style={{ padding: "0.4rem 0.5rem", color: `var(--text-warm)`, fontFamily: "Georgia, serif" }}>
                            {s.name}
                            {isTop && <span style={{ marginLeft: "0.4rem", fontSize: "0.8rem", color: "#16a34a", background: "#16a34a15", border: "1px solid #16a34a30", borderRadius: "3px", padding: "0.05rem 0.3rem" }}>TOP</span>}
                          </td>
                          <td style={{ padding: "0.4rem 0.5rem", color: `var(--text-dim)`, fontSize: "0.85rem", maxWidth: "120px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={s.regions}>{s.regions}</td>
                          <td style={{ padding: "0.4rem 0.5rem", textAlign: "right", color: `var(--text-dim)` }}>{s.count}</td>
                          <td style={{ padding: "0.4rem 0.5rem", textAlign: "right", color: "#6366f1" }}>{fmt(s.hours, 1)}</td>
                          <td style={{ padding: "0.4rem 0.5rem", textAlign: "right", color: s.goals > 0 ? "#d97706" : `var(--text-faint)`, fontWeight: 700 }}>{s.goals || "\u2014"}</td>
                          <td style={{ padding: "0.4rem 0.5rem", textAlign: "right", color: pColor, fontWeight: 600 }}>{s.gph > 0 ? s.gph.toFixed(3) : "\u2014"}</td>
                          <td style={{ padding: "0.4rem 0.5rem", textAlign: "right" }}>
                            {s.pctToGoal !== null ? (
                              <span style={{ color: pColor, fontWeight: 700, background: pColor + "12", border: `1px solid ${pColor}30`, borderRadius: "3px", padding: "0.1rem 0.35rem" }}>{Math.round(s.pctToGoal)}%</span>
                            ) : "\u2014"}
                          </td>
                          <td style={{ padding: "0.4rem 0.5rem", textAlign: "right", color: pColor }}>${s.cps.toFixed(2)}</td>
                          <td style={{ padding: "0.4rem 0.5rem", textAlign: "right", color: s.q1Rate >= 40 ? "#16a34a" : s.q1Rate >= 20 ? "#d97706" : "#dc2626", fontWeight: 600 }}>{Math.round(s.q1Rate)}%</td>
                          {["q1","q2","q3","q4"].map(q => (
                            <td key={q} style={{ padding: "0.4rem 0.4rem", textAlign: "right", color: Q[q.toUpperCase()].color }}>{s[q]}</td>
                          ))}
                          <td style={{ padding: "0.4rem 0.5rem", textAlign: "right" }}>
                            {s.trending === "up" && <span style={{ color: "#16a34a" }}>{"\u2191"}</span>}
                            {s.trending === "down" && <span style={{ color: "#dc2626" }}>{"\u2193"}</span>}
                            {s.trending === "flat" && <span style={{ color: `var(--text-faint)` }}>{"\u2192"}</span>}
                            {!s.trending && "\u2014"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot><tr style={{ borderTop: "2px solid var(--border)", background: `var(--bg-row-alt)` }}>
                    <td></td>
                    <td style={{ padding: "0.4rem 0.5rem", fontWeight: 700, color: `var(--text-warm)` }}>TOTAL</td>
                    <td></td>
                    <td style={{ padding: "0.4rem 0.5rem", textAlign: "right", fontWeight: 700 }}>{uniqueNames(progAgents).size}</td>
                    <td style={{ padding: "0.4rem 0.5rem", textAlign: "right", fontWeight: 700, color: "#6366f1" }}>{fmt(totHrs, 1)}</td>
                    <td style={{ padding: "0.4rem 0.5rem", textAlign: "right", fontWeight: 700, color: "#d97706" }}>{totGoals}</td>
                    <td style={{ padding: "0.4rem 0.5rem", textAlign: "right", fontWeight: 700 }}>{totGph.toFixed(3)}</td>
                    <td style={{ padding: "0.4rem 0.5rem", textAlign: "right" }}>
                      {totPct !== null ? <span style={{ color: attainColor(totPct), fontWeight: 700 }}>{Math.round(totPct)}%</span> : "\u2014"}
                    </td>
                    <td style={{ padding: "0.4rem 0.5rem", textAlign: "right", fontWeight: 700 }}>${totGoals > 0 ? ((totHrs * 19.77) / totGoals).toFixed(2) : (totHrs * 19.77).toFixed(2)}</td>
                    <td colSpan={6}></td>
                  </tr></tfoot>
                </table>
              </div>
            </div>
          );
        })()}

        {/* ── DAILY TAB ── */}
        {tab === "daily" && (
          <DailyBreakdownPanel agents={filteredAgents} regions={regions} jobType={jobType} singleProgram={true} sphGoal={
            goalEntries.length > 0
              ? (() => {
                  const allRows = goalEntries.flatMap(e => Object.values(e.siteMap).flat());
                  const vals = allRows.map(r => computePlanRow(r).sphGoal).filter(v => v > 0);
                  return vals.length ? vals.reduce((s,v)=>s+v,0)/vals.length : null;
                })()
              : null
          } />
        )}
      </div>

      {/* Sticky nav — always visible, never scrolls away */}
      <div style={{ flexShrink: 0, borderTop: "1px solid var(--border)", padding: "0.75rem 2.5rem", display: "flex", alignItems: "center", justifyContent: "space-between", background: `var(--bg-row-alt)` }}>
        <button onClick={() => onNav(-1)} disabled={slideIndex === 0}
          style={{ padding: "0.5rem 1.25rem", background: slideIndex===0?"transparent":"var(--bg-tertiary)", border: `1px solid ${slideIndex===0?`var(--border)`:`var(--text-faint)`}`, borderRadius: "6px", color: slideIndex===0?`var(--border)`:`var(--text-secondary)`, fontFamily: "monospace", fontSize: "1.17rem", cursor: slideIndex===0?"not-allowed":"pointer", letterSpacing: "0.05em" }}>
          ← PREV
        </button>
        <div style={{ display: "flex", gap: "0.35rem", alignItems: "center" }}>
          {Array.from({ length: total }).map((_, i) => (
            <div key={i} onClick={() => onNav(i - slideIndex)}
              style={{ width: i===slideIndex?"22px":"6px", height: "6px", borderRadius: "3px", background: i===slideIndex?"#d97706":`var(--border)`, cursor: "pointer", transition: "all 0.2s" }} />
          ))}
        </div>
        <button onClick={() => onNav(1)} disabled={slideIndex === total - 1}
          style={{ padding: "0.5rem 1.25rem", background: slideIndex===total-1?"transparent":"var(--bg-tertiary)", border: `1px solid ${slideIndex===total-1?`var(--border)`:`var(--text-faint)`}`, borderRadius: "6px", color: slideIndex===total-1?`var(--border)`:`var(--text-secondary)`, fontFamily: "monospace", fontSize: "1.17rem", cursor: slideIndex===total-1?"not-allowed":"pointer", letterSpacing: "0.05em" }}>
          NEXT →
        </button>
      </div>
    </div>
  );
}


// ══════════════════════════════════════════════════════════════════════════════
// SECTION 14a — TODAY VIEW  (live OTM data)
// ══════════════════════════════════════════════════════════════════════════════

const OTM_URL  = "https://smart-gcs.com/otm2/JSON/get/OTM.php?grp=1&job=1&loc=1&reg=1&sup=0&agt=1&dir=0";
const CODE_URL = "https://smart-gcs.com/otm2/JSON/get/Code.php";
// Product codes that count as "goals" from Code.php
const GOAL_CODES = new Set(["420","600","601","602","603","604","605","625","626","627","628","696","706","714"]);

// Distinct colors for each region in Today tab
const REG_COLORS = {
  "SD-Xfinity":       "#d97706",  // amber
  "Belize City-XOTM": "#6366f1",  // indigo
  "OW-XOTM":          "#0891b2",  // cyan/teal
  "San Ignacio-XOTM": "#c026d3",  // fuchsia
};
const getRegColor = (reg) => REG_COLORS[reg] || "#6366f1";

// Human-readable display names for product codes (from Sales_page_names.csv)
const PRODUCT_LABELS = {
  "401": "HBO MAX",
  "402": "Showtime",
  "403": "STARZ",
  "404": "Cinemax",
  "405": "The Movie Channel",
  "409": "Latino Add On",
  "415": "Easy Enroll",
  "417": "Epix",
  "418": "AutoPay",
  "419": "No Upgrade Repackage",
  "432": "Samsung Handset",
  "433": "iPhone Handset",
  "434": "LG Handset",
  "435": "Motorola Handset",
  "436": "BYOD Handset (XMC)",
  "437": "Google Pixel",
  "438": "Tablet",
  "439": "Smart Watch",
  "440": "Case",
  "441": "Screen Protector",
  "442": "Memory Card",
  "443": "Portable Charger",
  "444": "Charging Pad",
  "445": "Charging Stand",
  "446": "Wall Charger",
  "459": "Sports & News Pack",
  "460": "Kids & Family Pack",
  "461": "Entertainment Pack",
  "462": "More Sports & Entertainment",
  "463": "Deportes Add On",
  "464": "Scheduled Install",
  "465": "Xfinity Flex",
  "466": "SIK",
  "467": "XH Consult",
  "468": "xFi Complete",
  "469": "XH Camera",
  "470": "XH In-home Consult",
  "475": "X1 HD/DVR",
  "481": "Corrected Order",
  "482": "Gateway Modem",
  "483": "xCam",
  "484": "Unlimited HSD",
  "486": "Comcast Doorbell",
  "487": "Comcast Smartlock",
  "488": "Wifi Pass",
  "489": "Premiums Add On",
  "490": "Carefree World 300",
  "491": "Carefree Latin America 300",
  "492": "XM Device Upgrade",
  "493": "Xumo Stream Box",
  "495": "Streamsaver",
  "500": "Choice TV",
  "501": "Popular TV",
  "502": "Ultimate TV",
  "503": "NowTV",
  "504": "Prepaid Video",
  "513": "Prepaid HSD",
  "514": "Xfinity Voice",
  "515": "Pro Protection XH",
  "516": "Pro Protection Plus XH",
  "517": "Self Protection",
  "518": "Unlimited Intro XM",
  "519": "Unlimited Plus XM",
  "522": "Unlimited Premium XM",
  "523": "By The Gig XM",
  "524": "Now XI 200",
  "525": "Now XI 100",
  "550": "5 Year Price Lock",
  "551": "NowTV Latino",
  "552": "Next Gen 300MB HSD",
  "553": "Next Gen 500MB HSD",
  "554": "Next Gen Gig HSD",
  "555": "Next Gen 2Gig HSD",
  "556": "1 Year Price Lock",
  "600": "HSD Beyond Fast",
  "601": "HSD Super Fast",
  "602": "HSD Even Faster",
  "603": "HSD",
  "604": "HSD Fast",
  "605": "HSD (605)",
  "610": "Voice",
  "696": "Cox Unlimited",
  "701": "New Video",
  "702": "New HSD",
  "703": "New Phone",
  "704": "New XH",
  "706": "HSD Save RGU",
  "713": "Tier Upgrade - Video",
  "714": "Tier Upgrade - HSD",
  "715": "Tier Upgrade - Phone",
  "716": "Tier Upgrade - XH",
  "717": "New Mobile",
  "725": "Tier Upgrade - Mobile",
  "740": "New NOW XI 100",
  "742": "New NOW XI 200",
  "744": "New NOW XM",
  "817": "XM Protection Plan",
};
const prodLabel = (cod, apiCodes) =>
  PRODUCT_LABELS[String(cod)] || apiCodes[String(cod)] || `Code ${cod}`;

// HSD Sell-In % = New RGU - HSD (code 702) / Sales
// Mobile Sell-In % = New RGU - Mobile (code 717) / Sales
const NEW_HSD_CODE = "702";
const NEW_MOBILE_CODE = "717";
const deriveHsdXm = (products) => ({
  hsd: Number(products[NEW_HSD_CODE]) || 0,
  xml: Number(products[NEW_MOBILE_CODE]) || 0,
});

function TodayView({ recentAgentNames, historicalAgentMap, goalLookup }) {
  const [raw,         setRaw]         = useState(() => {
    try {
      const saved = localStorage.getItem("today_raw_data");
      return saved ? JSON.parse(saved) : null;
    } catch(e) { return null; }
  });
  const [codes,       setCodes]       = useState(() => {
    try {
      const saved = localStorage.getItem("today_codes");
      return saved ? JSON.parse(saved) : {};
    } catch(e) { return {}; }
  });
  const [loading,     setLoading]     = useState(false);
  const [error,       setError]       = useState(null);
  const [lastRefresh, setLastRefresh] = useState(() => {
    try {
      const saved = localStorage.getItem("today_last_refresh");
      return saved ? new Date(saved) : null;
    } catch(e) { return null; }
  });
  const [sortBy,      setSortBy]      = useState("hrs");
  const [sortDir,     setSortDir]     = useState(-1);
  const [showAbsent,  setShowAbsent]  = useState(true);
  const [pasteMode,   setPasteMode]   = useState(false);
  const [pasteText,   setPasteText]   = useState("");
  const [pasteError,  setPasteError]  = useState(null);
  const [progSortBy,  setProgSortBy]  = useState("hrs");
  const [progSortDir, setProgSortDir] = useState(-1);
  const [progSiteFilter, setProgSiteFilter] = useState(null);
  const [bzSiteFilter,   setBzSiteFilter]   = useState(null); // null = combined BZ, or specific region name
  const [lbRegion,    setLbRegion]    = useState("All");
  const [lbJob,       setLbJob]       = useState(null);
  const [selectedCodes, setSelectedCodes] = useState(() => {
    try {
      const saved = localStorage.getItem("today_selected_codes");
      return saved ? new Set(JSON.parse(saved)) : new Set();
    } catch(e) { return new Set(); }
  });
  const [codeDropOpen,  setCodeDropOpen]  = useState(false);

  // Persist code selection to localStorage whenever it changes
  useEffect(() => {
    try {
      localStorage.setItem("today_selected_codes", JSON.stringify([...selectedCodes]));
    } catch(e) {}
  }, [selectedCodes]);

  // Persist raw data, codes, and refresh timestamp to localStorage
  useEffect(() => {
    try {
      if (raw) localStorage.setItem("today_raw_data", JSON.stringify(raw));
    } catch(e) {}
  }, [raw]);
  useEffect(() => {
    try {
      if (codes && Object.keys(codes).length > 0) localStorage.setItem("today_codes", JSON.stringify(codes));
    } catch(e) {}
  }, [codes]);
  useEffect(() => {
    try {
      if (lastRefresh) localStorage.setItem("today_last_refresh", lastRefresh.toISOString());
    } catch(e) {}
  }, [lastRefresh]);

  // Try a live fetch first; if it fails, try CORS proxy, then fall through to paste mode
  const doFetch = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      let otm, cArr;
      try {
        // Direct fetch first
        const [otmRes, codeRes] = await Promise.all([fetch(OTM_URL), fetch(CODE_URL)]);
        otm  = await otmRes.json();
        cArr = await codeRes.json();
      } catch(e) {
        // If direct fails (CORS), try with no-cors or proxy
        const proxyUrl = url => `https://corsproxy.io/?${encodeURIComponent(url)}`;
        const [otmRes, codeRes] = await Promise.all([fetch(proxyUrl(OTM_URL)), fetch(proxyUrl(CODE_URL))]);
        otm  = await otmRes.json();
        cArr = await codeRes.json();
      }
      if (!Array.isArray(otm)) throw new Error("Unexpected response format");
      const cMap = {};
      cArr.forEach(c => { cMap[String(c.cod)] = c.nam; });
      setCodes(cMap);
      setRaw(otm);
      setLastRefresh(new Date());
      setPasteMode(false);
    } catch(e) {
      // All fetch methods failed — switch to paste mode only if no cached data
      if (!raw) setPasteMode(true);
    } finally {
      setLoading(false);
    }
  }, []);

  const handlePaste = useCallback(() => {
    setPasteError(null);
    try {
      const parsed = JSON.parse(pasteText.trim());
      if (!Array.isArray(parsed)) throw new Error("Expected a JSON array — make sure you copied the full page content.");
      setRaw(parsed);
      setLastRefresh(new Date());
      setPasteMode(false);
      setPasteText("");
    } catch(e) {
      setPasteError(e.message);
    }
  }, [pasteText]);

  useEffect(() => {
    doFetch();
    // Auto-refresh every 5 minutes
    const interval = setInterval(doFetch, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [doFetch]);

  const d = useMemo(() => {
    if (!raw) return null;
    // Guard: OTM endpoint must return an array
    if (!Array.isArray(raw)) return null;

    // ── Filter to known regions only ────────────────────────────────────────
    const ALLOWED_REGIONS = new Set([
      "Belize City-XOTM", "OW-XOTM", "SD-Xfinty", "San Ignacio-XOTM",
      // also accept the corrected spelling just in case
      "SD-Xfinity",
      // SD-Cox included so GL-job agents can be remapped
      "SD-Cox",
    ]);
    // Exclude GS jobs and anything with "cox" in the group name
    // BUT allow SD-Cox agents dialing GL (Xfinity) campaigns
    const filtered = raw.filter(row => {
      const reg = (row.reg || "").trim();
      const job = String(row.job || "").trim().toUpperCase();
      const grp = String(row.grp || "").trim().toUpperCase();
      if (!ALLOWED_REGIONS.has(reg)) return false;
      // SD-Cox: only include if job starts with GL (Xfinity program)
      if (reg === "SD-Cox") return job.startsWith("GL");
      // For all other regions, exclude GS jobs and Cox group names
      return !job.startsWith("GS") && !grp.includes("COX");
    });

    // ── Per-unique-agent aggregate ──────────────────────────────────────────
    // Normalize region spelling (match historical data)
    const fixReg = r => {
      const t = (r || "?").trim();
      return t === "SD-Xfinty" ? "SD-Xfinity" : t === "SD-Cox" ? "SD-Xfinity" : t;
    };
    const agentMap = {};
    // Per-agent-per-job map for job-level drilldowns
    const agentJobMap = {};
    filtered.forEach(row => {
      const name = (row.agt || "").trim();
      if (!name) return;
      const grp = row.grp || "?";
      const regNorm = fixReg(row.reg);
      // Unique agent aggregate
      if (!agentMap[name]) {
        agentMap[name] = {
          name, loc: row.loc || "?", reg: regNorm,
          grps: new Set(), hrs: 0, sal: 0, rgu: 0, goals: 0,
          products: {},
        };
      }
      const a = agentMap[name];
      a.hrs  += Number(row.hrs)  || 0;
      a.sal  += Number(row.sal)  || 0;
      a.rgu  += Number(row.rgu)  || 0;
      a.reg   = regNorm;
      a.grps.add(grp);
      // Per-agent-per-job aggregate
      const ajKey = `${name}|||${grp}`;
      if (!agentJobMap[ajKey]) {
        agentJobMap[ajKey] = {
          name, loc: row.loc || "?", reg: regNorm,
          grps: new Set([grp]), job: grp, hrs: 0, sal: 0, rgu: 0, goals: 0,
          products: {},
        };
      }
      const aj = agentJobMap[ajKey];
      aj.hrs += Number(row.hrs) || 0;
      aj.sal += Number(row.sal) || 0;
      aj.rgu += Number(row.rgu) || 0;
      aj.reg  = regNorm;
      // Track ALL numeric product code columns (not just GOAL_CODES)
      Object.keys(row).forEach(k => {
        const v = Number(row[k]);
        if (v > 0 && /^\d+$/.test(k)) {
          a.products[k] = (a.products[k] || 0) + v;
          aj.products[k] = (aj.products[k] || 0) + v;
          if (GOAL_CODES.has(k)) { a.goals += v; aj.goals += v; }
        }
      });
    });

    const agents = Object.values(agentMap).map(a => {
      const effectiveGoals = a.sal > 0 ? a.sal : a.goals;
      const hist = historicalAgentMap[a.name.toLowerCase()];
      const sphGoal = hist?.sphGoal || 0;
      const pctToGoal = sphGoal > 0 && a.hrs > 0
        ? (effectiveGoals / (sphGoal * a.hrs)) * 100
        : null;
      return { ...a, effectiveGoals, sphGoal, pctToGoal, quartile: hist?.quartile || null, jobType: hist?.jobType || [...a.grps][0] || "?", ...deriveHsdXm(a.products) };
    });

    // Per-agent-per-job finalized entries (for job drilldowns)
    const agentsByJob = Object.values(agentJobMap).map(a => {
      const effectiveGoals = a.sal > 0 ? a.sal : a.goals;
      const hist = historicalAgentMap[a.name.toLowerCase()];
      const sphGoal = hist?.sphGoal || 0;
      const pctToGoal = sphGoal > 0 && a.hrs > 0
        ? (effectiveGoals / (sphGoal * a.hrs)) * 100
        : null;
      return { ...a, effectiveGoals, sphGoal, pctToGoal, quartile: hist?.quartile || null, jobType: a.job, ...deriveHsdXm(a.products) };
    });
    const todayNames = new Set(agents.map(a => a.name));

    // ── Attendance analysis — split by region ───────────────────────────────
    const absent   = [...recentAgentNames].filter(n => !todayNames.has(n));
    const newFaces = [...todayNames].filter(n => {
      if (recentAgentNames.has(n)) return false;
      // Only show new faces that are in valid regions
      const agent = agents.find(a => a.name === n);
      return agent && VALID_REGIONS.has(agent.reg);
    });

    // Group absent agents by their historical region — only show known valid regions
    const absentByRegion = {};
    const validAbsent = [];
    absent.forEach(name => {
      const hist = historicalAgentMap[name.toLowerCase()];
      const reg  = hist?.region || "Unknown";
      if (!VALID_REGIONS.has(reg)) return; // omit Unknown / non-valid regions
      if (!absentByRegion[reg]) absentByRegion[reg] = [];
      absentByRegion[reg].push({ name, quartile: hist?.quartile || null });
      validAbsent.push(name);
    });

    // ── By Region — built from RAW ROWS, not agent aggregates ──────────────
    // CRITICAL: agents[] merges all rows per name and sets .reg to the LAST
    // seen region. Any agent appearing in programs from two different regions
    // (e.g. SD-Xfinity + BZ) would have ALL their hours mis-attributed to
    // whichever region processed last. We must sum hours at the row level so
    // each row's hours land in that row's region.
    const byReg = {};
    const byRegAgentSets = {}; // reg → Set<agentName> for unique head count
    filtered.forEach(row => {
      const r  = fixReg(row.reg);
      if (!VALID_REGIONS.has(r)) return;
      const nm = (row.agt || "").trim();
      if (!byReg[r]) {
        byReg[r] = { count: 0, hrs: 0, goals: 0, sal: 0, rgu: 0, pctSum: 0, pctCount: 0, products: {} };
        byRegAgentSets[r] = new Set();
      }
      byRegAgentSets[r].add(nm);
      byReg[r].hrs += Number(row.hrs) || 0;
      byReg[r].sal += Number(row.sal) || 0;
      byReg[r].rgu += Number(row.rgu) || 0;
      Object.keys(row).forEach(k => {
        const v = Number(row[k]);
        if (v > 0 && /^\d+$/.test(k)) {
          byReg[r].products[k] = (byReg[r].products[k] || 0) + v;
          if (GOAL_CODES.has(k)) byReg[r].goals += v;
        }
      });
    });
    // Finalise: agent count, goals fallback, pct-to-goal average
    Object.entries(byReg).forEach(([r, s]) => {
      s.count  = byRegAgentSets[r].size;
      s.goals  = s.sal > 0 ? s.sal : s.goals;
      agents.filter(a => byRegAgentSets[r].has(a.name)).forEach(a => {
        if (a.pctToGoal !== null) { s.pctSum += a.pctToGoal; s.pctCount++; }
      });
    });

    // ── By Location (kept for legacy pulse cards) ────────────────────────────
    const byLoc = {};
    agents.forEach(a => {
      const l = a.loc;
      if (!byLoc[l]) byLoc[l] = { count: 0, hrs: 0, goals: 0 };
      byLoc[l].count++;
      byLoc[l].hrs   += a.hrs;
      byLoc[l].goals += a.effectiveGoals;
    });

    // ── By program/group — with % to goal via goalLookup ────────────────────
    const grpMap = {};
    filtered.forEach(row => {
      const g       = row.grp || "Unknown";
      const regNorm = fixReg(row.reg);
      const jobCode = (row.job || "").trim();
      // Key by reg|job so each ROC code gets its own row. Fall back to grp if no job.
      const key = jobCode ? `${regNorm}|${jobCode}` : `${regNorm}|${g}`;
      if (!grpMap[key]) grpMap[key] = { grp: g, loc: row.loc || "?", reg: regNorm, roc: jobCode, agts: new Set(), hrs: 0, sal: 0, goals: 0, rgu: 0, products: {} };
      grpMap[key].agts.add((row.agt || "").trim());
      grpMap[key].hrs += Number(row.hrs) || 0;
      grpMap[key].sal += Number(row.sal) || 0;
      grpMap[key].rgu += Number(row.rgu) || 0;
      Object.keys(row).forEach(k => {
        const v = Number(row[k]);
        if (v > 0 && /^\d+$/.test(k)) {
          grpMap[key].products[k] = (grpMap[key].products[k] || 0) + v;
          if (GOAL_CODES.has(k)) grpMap[key].goals += v;
        }
      });
    });
    // Build agent pctToGoal lookup for program-level fallback
    const agentPctMap = {};
    agents.forEach(a => { if (a.pctToGoal !== null) agentPctMap[a.name] = a.pctToGoal; });

    const programs = Object.values(grpMap).map(p => {
      // Use sal as primary goals metric, fall back to GOAL_CODES sum
      const effectiveGoals = p.sal > 0 ? p.sal : p.goals;
      // Try to find a daily goal for this program via goalLookup (sphGoal × hrs)
      let sphGoal = null;
      if (goalLookup) {
        // Try ROC code match first (direct 1:1)
        let entries = p.roc ? getGoalEntries(goalLookup, p.grp, p.roc) : [];
        // Fall back to name matching
        if (entries.length === 0) entries = getGoalEntries(goalLookup, p.grp);
        if (entries.length > 0) {
          // Use site-specific SPH goal: BZ regions get BZ goal, DR gets DR goal
          const isBZ = (p.reg || "").toUpperCase().includes("XOTM");
          const siteKey = isBZ ? "BZ" : "DR";
          const siteRows = entries.flatMap(e => e.siteMap[siteKey] || []);
          const goalRows = siteRows.length > 0 ? siteRows : entries.flatMap(e => Object.values(e.siteMap).flat());
          const vals = goalRows.map(r => computePlanRow(r).sphGoal).filter(v => v > 0);
          if (vals.length) sphGoal = vals.reduce((s,v)=>s+v,0) / vals.length;
        }
      }
      let pctToGoal = sphGoal && p.hrs > 0 ? (effectiveGoals / (sphGoal * p.hrs)) * 100 : null;
      // Fallback: average pctToGoal of agents in this program (mirrors byReg logic)
      // But only if the program actually has sales — 0 sales = 0% regardless of agent averages
      if (pctToGoal === null && effectiveGoals > 0) {
        const agentPcts = [...p.agts].map(n => agentPctMap[n]).filter(v => v !== undefined);
        if (agentPcts.length > 0) pctToGoal = agentPcts.reduce((s, v) => s + v, 0) / agentPcts.length;
      } else if (pctToGoal === null && effectiveGoals === 0 && p.hrs > 0) {
        pctToGoal = 0;
      }
      return { ...p, effectiveGoals, agentCount: p.agts.size, sphGoal, pctToGoal, ...deriveHsdXm(p.products) };
    }).sort((a, b) => b.hrs - a.hrs);

    // ── Unique regions for site filter ──────────────────────────────────────
    const uniqueRegs = [...new Set(agents.map(a => a.reg))].sort();

    // ── Product mix ─────────────────────────────────────────────────────────
    const productTotals = {};
    agents.forEach(a => {
      Object.entries(a.products).forEach(([k, v]) => {
        productTotals[k] = (productTotals[k] || 0) + v;
      });
    });

    // ── Collect all unique product codes for dynamic columns ─────────────
    const allProductCodes = [...new Set(agents.flatMap(a => Object.keys(a.products)))].sort();

    return {
      agents, agentsByJob,
      totalHrs:   agents.reduce((s,a) => s + a.hrs,   0),
      totalGoals: agents.reduce((s,a) => s + a.effectiveGoals,  0),
      totalSal:   agents.reduce((s,a) => s + a.sal,    0),
      totalRgu:   agents.reduce((s,a) => s + a.rgu,    0),
      presentCount: todayNames.size,
      absent: validAbsent, newFaces, absentByRegion,
      byLoc, byReg, programs, productTotals, uniqueRegs, allProductCodes,
    };
  }, [raw, recentAgentNames, historicalAgentMap, goalLookup]);

  const sortedAgents = useMemo(() => {
    if (!d) return [];
    // When job filter is active, use per-agent-per-job entries (agents appear per-job)
    // When no job filter, use unique agent entries
    let list;
    if (lbJob) {
      list = d.agentsByJob.filter(a => a.job === lbJob);
      if (lbRegion !== "All") list = list.filter(a => a.reg === lbRegion);
    } else {
      list = d.agents;
      if (lbRegion !== "All") list = list.filter(a => a.reg === lbRegion);
    }
    return [...list].sort((a, b) => {
      const key = sortBy === "goals" ? "effectiveGoals" : sortBy;
      return ((a[key]||0) - (b[key]||0)) * sortDir;
    });
  }, [d, sortBy, sortDir, lbRegion, lbJob]);

  const sortedPrograms = useMemo(() => {
    if (!d) return [];
    let list = d.programs;
    // Site filter: group regions into DR (non-XOTM) and BZ (XOTM)
    if (progSiteFilter) {
      list = list.filter(p => {
        const isBZ = (p.reg || "").toUpperCase().includes("XOTM");
        if (progSiteFilter === "BZ") {
          // If a specific BZ site is selected, filter to just that site
          if (bzSiteFilter) return isBZ && p.reg === bzSiteFilter;
          return isBZ;
        }
        return !isBZ;
      });
    }
    return [...list].sort((a, b) => {
      let va, vb;
      if (progSortBy === "grp") return progSortDir * a.grp.localeCompare(b.grp);
      if (progSortBy === "roc") return progSortDir * (a.roc || "").localeCompare(b.roc || "");
      if (progSortBy === "reg") return progSortDir * (a.reg || "").localeCompare(b.reg || "");
      if (progSortBy === "agentCount") { va = a.agentCount; vb = b.agentCount; }
      else if (progSortBy === "hrs") { va = a.hrs; vb = b.hrs; }
      else if (progSortBy === "goals") { va = a.effectiveGoals; vb = b.effectiveGoals; }
      else if (progSortBy === "gph") { va = a.hrs > 0 ? a.effectiveGoals / a.hrs : 0; vb = b.hrs > 0 ? b.effectiveGoals / b.hrs : 0; }
      else if (progSortBy === "cps") { va = a.effectiveGoals > 0 ? (a.hrs * 19.77) / a.effectiveGoals : a.hrs * 19.77; vb = b.effectiveGoals > 0 ? (b.hrs * 19.77) / b.effectiveGoals : b.hrs * 19.77; }
      else if (progSortBy === "rgu") { va = a.rgu || 0; vb = b.rgu || 0; }
      else if (progSortBy === "pctToGoal") { va = a.pctToGoal ?? -1; vb = b.pctToGoal ?? -1; }
      else { va = a[progSortBy] || 0; vb = b[progSortBy] || 0; }
      return ((va || 0) - (vb || 0)) * progSortDir;
    });
  }, [d, progSortBy, progSortDir, progSiteFilter, bzSiteFilter]);

  // All codes present in today's data (for the selector dropdown)
  const allAvailableCodes = useMemo(() => {
    if (!d) return [];
    return [...new Set([
      ...d.agents.flatMap(a => Object.keys(a.products)),
      ...d.programs.flatMap(p => Object.keys(p.products || {})),
    ])].sort((a, b) => Number(a) - Number(b));
  }, [d]);

  // Codes to actually display (filtered by selector; empty selection = show all)
  const displayCodes = useMemo(() => {
    if (selectedCodes.size === 0) return allAvailableCodes;
    return allAvailableCodes.filter(c => selectedCodes.has(c));
  }, [allAvailableCodes, selectedCodes]);

  // Leaderboard: codes among visible agents
  const activeCodes = useMemo(() => {
    if (!d) return displayCodes;
    const agentCodes = new Set(sortedAgents.flatMap(a => Object.keys(a.products)));
    return displayCodes.filter(c => agentCodes.has(c));
  }, [displayCodes, sortedAgents]);

  // Programs: codes among visible programs
  const progActiveCodes = useMemo(() => {
    if (!d) return displayCodes;
    const pCodes = new Set(sortedPrograms.flatMap(p => Object.keys(p.products || {})));
    return displayCodes.filter(c => pCodes.has(c));
  }, [displayCodes, sortedPrograms]);

  const toggleCode = cod => {
    setSelectedCodes(prev => {
      const next = new Set(prev);
      if (next.has(cod)) next.delete(cod); else next.add(cod);
      return next;
    });
  };

  const toggleSort = key => {
    if (sortBy === key) setSortDir(v => -v);
    else { setSortBy(key); setSortDir(-1); }
  };

  const toggleProgSort = key => {
    if (progSortBy === key) setProgSortDir(v => -v);
    else { setProgSortBy(key); setProgSortDir(-1); }
  };

  const SortTh = ({ k, label, right }) => (
    <th onClick={() => toggleSort(k)}
      style={{ padding: "0.4rem 0.6rem", textAlign: right?"right":"left", fontWeight: 400,
        color: sortBy===k ? "#d97706" : `var(--text-dim)`, cursor: "pointer", whiteSpace: "nowrap",
        fontFamily: "monospace", fontSize: "1.08rem", userSelect: "none" }}>
      {label}{sortBy===k?(sortDir===-1?" ↓":" ↑"):""}
    </th>
  );

  const ProgSortTh = ({ k, label, right }) => (
    <th onClick={() => toggleProgSort(k)}
      style={{ padding: "0.4rem 0.75rem", textAlign: right?"right":"left", fontWeight: 400,
        color: progSortBy===k ? "#d97706" : `var(--text-dim)`, cursor: "pointer", whiteSpace: "nowrap",
        fontFamily: "monospace", fontSize: "1.08rem", userSelect: "none" }}>
      {label}{progSortBy===k?(progSortDir===-1?" ↓":" ↑"):""}
    </th>
  );

  const now = lastRefresh ? (() => {
    const today = new Date();
    const isToday = lastRefresh.toDateString() === today.toDateString();
    const time = lastRefresh.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    return isToday ? time : `${lastRefresh.toLocaleDateString([], { month: "short", day: "numeric" })} ${time}`;
  })() : "—";

  if (loading) return (
    <div style={{ minHeight: "90vh", display: "flex", alignItems: "center", justifyContent: "center", background: `var(--bg-primary)` }}>
      <div style={{ fontFamily: "monospace", fontSize: "1.05rem", color: `var(--text-dim)` }}>Checking connection…</div>
    </div>
  );

  if (pasteMode) return (
    <div style={{ minHeight: "90vh", background: `var(--bg-primary)`, padding: "3rem 2.5rem" }}>
      <div style={{ maxWidth: "640px", margin: "0 auto" }}>
        <div style={{ fontFamily: "monospace", fontSize: "1.17rem", color: "#16a34a", letterSpacing: "0.15em", textTransform: "uppercase", marginBottom: "0.5rem" }}>Today's Operations — Manual Data Load</div>
        <div style={{ fontFamily: "'Cormorant Garamond', Georgia, serif", fontSize: "3rem", color: `var(--text-warm)`, fontWeight: 700, marginBottom: "1.5rem" }}>Paste Live Data</div>

        <div style={{ background: `var(--bg-secondary)`, border: "1px solid var(--border)", borderRadius: "12px", padding: "1.5rem", marginBottom: "1.25rem" }}>
          <div style={{ fontFamily: "monospace", fontSize: "1.11rem", color: `var(--text-muted)`, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: "1rem" }}>Step 1 — Open the live data URL</div>
          <a href={OTM_URL} target="_blank" rel="noreferrer"
            style={{ display: "inline-block", background: "#16a34a18", border: "1px solid #16a34a55", borderRadius: "6px", color: "#16a34a", padding: "0.5rem 1rem", fontFamily: "monospace", fontSize: "1.14rem", textDecoration: "none", marginBottom: "0.5rem" }}>
            ↗ Open OTM Data Feed
          </a>
          <div style={{ fontFamily: "monospace", fontSize: "1.14rem", color: `var(--text-faint)`, marginTop: "0.5rem" }}>
            This opens the live data in a new tab. You'll see raw JSON text.
          </div>
        </div>

        <div style={{ background: `var(--bg-secondary)`, border: "1px solid var(--border)", borderRadius: "12px", padding: "1.5rem", marginBottom: "1.25rem" }}>
          <div style={{ fontFamily: "monospace", fontSize: "1.11rem", color: `var(--text-muted)`, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: "1rem" }}>Step 2 — Copy & paste the data here</div>
          <div style={{ fontFamily: "Georgia, serif", fontSize: "1.17rem", color: `var(--text-muted)`, marginBottom: "0.75rem" }}>
            In that tab, press <kbd style={{ background: `var(--bg-tertiary)`, border: "1px solid var(--text-faint)", borderRadius: "3px", padding: "0.1rem 0.35rem", fontFamily: "monospace", fontSize: "1.05rem" }}>Ctrl+A</kbd> then <kbd style={{ background: `var(--bg-tertiary)`, border: "1px solid var(--text-faint)", borderRadius: "3px", padding: "0.1rem 0.35rem", fontFamily: "monospace", fontSize: "1.05rem" }}>Ctrl+C</kbd> to copy everything, then paste it below.
          </div>
          <textarea
            value={pasteText}
            onChange={e => { setPasteText(e.target.value); setPasteError(null); }}
            placeholder='Paste JSON here… (starts with [{"agt":…)'
            style={{ width: "100%", height: "120px", background: `var(--bg-primary)`, border: `1px solid ${pasteError ? "#dc2626" : `var(--border)`}`, borderRadius: "6px", color: `var(--text-secondary)`, fontFamily: "monospace", fontSize: "1.11rem", padding: "0.75rem", resize: "vertical", boxSizing: "border-box" }}
          />
          {pasteError && (
            <div style={{ fontFamily: "monospace", fontSize: "1.17rem", color: "#dc2626", marginTop: "0.4rem" }}>⚠ {pasteError}</div>
          )}
          <button onClick={handlePaste} disabled={!pasteText.trim()}
            style={{ marginTop: "0.75rem", padding: "0.5rem 1.25rem", background: pasteText.trim() ? "#16a34a18" : "transparent", border: `1px solid ${pasteText.trim() ? "#16a34a" : `var(--border)`}`, borderRadius: "6px", color: pasteText.trim() ? "#16a34a" : `var(--text-faint)`, fontFamily: "monospace", fontSize: "1.14rem", cursor: pasteText.trim() ? "pointer" : "not-allowed" }}>
            Load Data →
          </button>
        </div>

        <div style={{ fontFamily: "monospace", fontSize: "1.11rem", color: `var(--text-faint)`, textAlign: "center" }}>
          Direct fetch is blocked in this environment. Pasting the data works identically — you'll see all the same live stats.
        </div>
      </div>
    </div>
  );

  if (!d) return (
    <div style={{ minHeight: "90vh", display: "flex", alignItems: "center", justifyContent: "center", background: `var(--bg-primary)` }}>
      <div style={{ fontFamily: "monospace", fontSize: "1.05rem", color: `var(--text-dim)`, textAlign: "center" }}>
        <div style={{ fontSize: "1.8rem", marginBottom: "0.5rem" }}>{loading ? "\u23F3" : "\uD83D\uDCE1"}</div>
        {loading ? "Fetching live data..." : "No data available."}
        <div style={{ marginTop: "0.75rem", display: "flex", gap: "0.5rem", justifyContent: "center" }}>
          <button onClick={doFetch} style={{ background: "transparent", border: "1px solid #16a34a", borderRadius: "5px", color: "#16a34a", padding: "0.3rem 0.8rem", cursor: "pointer", fontFamily: "monospace", fontSize: "1.11rem" }}>
            {loading ? "Fetching..." : "Try Auto-Fetch"}
          </button>
          <button onClick={() => setPasteMode(true)} style={{ background: "transparent", border: "1px solid var(--text-faint)", borderRadius: "5px", color: `var(--text-muted)`, padding: "0.3rem 0.8rem", cursor: "pointer", fontFamily: "monospace", fontSize: "1.11rem" }}>Paste Data</button>
        </div>
      </div>
    </div>
  );

  return (
    <div style={{ background: `var(--bg-primary)`, minHeight: "90vh", padding: "2rem 2.5rem", paddingBottom: "4rem" }}>

      {/* ── Header ── */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.75rem" }}>
        <div>
          <div style={{ fontFamily: "monospace", fontSize: "1.17rem", color: "#16a34a", letterSpacing: "0.15em", textTransform: "uppercase", marginBottom: "0.25rem" }}>
          ● LIVE · auto-refreshes every 5 min · last loaded {now}
          </div>
          <div style={{ fontFamily: "'Cormorant Garamond', Georgia, serif", fontSize: "3rem", color: `var(--text-warm)`, fontWeight: 700 }}>Today's Operations</div>
        </div>
        <button onClick={async () => {
            try {
              await doFetch();
              // If doFetch succeeded, raw will be updated and paste mode stays off
              // If it failed silently (caught internally), paste mode was already set
            } catch(e) {
              setPasteMode(true);
            }
          }}
          style={{ background: "transparent", border: "1px solid var(--text-faint)", borderRadius: "6px",
            color: `var(--text-muted)`, padding: "0.4rem 1rem", fontFamily: "monospace",
            fontSize: "1.11rem", cursor: "pointer" }}>
          {loading ? "Fetching..." : "\u27F3 Refresh Data"}
        </button>
      </div>

      {/* ── Pulse cards ── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: "0.75rem", marginBottom: "1.5rem" }}>
        {[
          { v: d.presentCount,           l: "On Floor",    sub: `${d.absent.length} absent · ${d.newFaces.length} new`, c: "#16a34a" },
          { v: fmt(d.totalHrs, 1),        l: "Hours Today", sub: `${fmt(d.totalHrs/Math.max(d.presentCount,1), 2)} avg/agent`,  c: "#6366f1" },
          { v: d.totalGoals,              l: "Sales Today", sub: d.totalGoals > 0 ? `${fmt(d.totalHrs > 0 ? d.totalGoals/d.totalHrs : 0, 3)} GPH pace` : "no sales yet", c: "#d97706" },
          { v: d.totalRgu || "—",         l: "RGU",         sub: "today total",  c: "#2563eb" },
          { v: d.absent.length,           l: "Absent",      sub: `of ${recentAgentNames.size} last-7-day roster`, c: d.absent.length > 0 ? "#dc2626" : "#16a34a" },
        ].map(({ v, l, sub, c }) => (
          <div key={l} style={{ background: `var(--bg-secondary)`, border: `1px solid ${c}22`, borderRadius: "10px", padding: "1rem", textAlign: "center" }}>
            <div style={{ fontFamily: "'Cormorant Garamond', Georgia, serif", fontSize: "3rem", color: c, fontWeight: 700, lineHeight: 1 }}>{v}</div>
            <div style={{ fontFamily: "monospace", fontSize: "1.14rem", color: c, marginTop: "0.2rem" }}>{l}</div>
            <div style={{ fontFamily: "monospace", fontSize: "1.17rem", color: `var(--text-faint)`, marginTop: "0.2rem" }}>{sub}</div>
          </div>
        ))}
      </div>

      {/* ── Product Code Columns — full-width slim bar ── */}
      {allAvailableCodes.length > 0 && (
        <div style={{ background: `var(--bg-secondary)`, border: "1px solid var(--border)", borderRadius: "12px", padding: "1rem 1.25rem", marginBottom: "1.25rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ fontFamily: "monospace", fontSize: "1.11rem", color: `var(--text-muted)`, letterSpacing: "0.12em", textTransform: "uppercase" }}>
              Product Code Columns
            </div>
            <div style={{ display: "flex", gap: "0.4rem", alignItems: "center" }}>
              {selectedCodes.size > 0 && (
                <button onClick={() => setSelectedCodes(new Set())}
                  style={{ background: "transparent", border: "1px solid var(--text-faint)", borderRadius: "4px", color: `var(--text-muted)`, padding: "0.15rem 0.5rem", fontFamily: "monospace", fontSize: "1.17rem", cursor: "pointer" }}>
                  Show All
                </button>
              )}
              <button onClick={() => setCodeDropOpen(v => !v)}
                style={{ background: codeDropOpen ? "#d9770620" : "transparent", border: `1px solid ${codeDropOpen ? "#d97706" : `var(--text-faint)`}`, borderRadius: "4px",
                  color: codeDropOpen ? "#d97706" : `var(--text-muted)`, padding: "0.15rem 0.6rem", fontFamily: "monospace", fontSize: "1.11rem", cursor: "pointer" }}>
                {codeDropOpen ? "▲ Close" : "▼ Select Codes"}{selectedCodes.size > 0 ? ` (${selectedCodes.size})` : ""}
              </button>
            </div>
          </div>
          {/* Selected code chips */}
          {selectedCodes.size > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.25rem", marginTop: "0.5rem" }}>
              {[...selectedCodes].sort((a,b)=>Number(a)-Number(b)).map(cod => (
                <span key={cod} onClick={() => toggleCode(cod)}
                  style={{ fontFamily: "monospace", fontSize: "1.17rem", padding: "0.15rem 0.45rem", borderRadius: "3px",
                    background: "#d9770620", border: "1px solid #d9770650", color: "#d97706", cursor: "pointer" }}
                  title="Click to remove">
                  {prodLabel(cod, codes)} ×
                </span>
              ))}
            </div>
          )}
          {/* Dropdown code picker — fills full width */}
          {codeDropOpen && (
            <div style={{ marginTop: "0.75rem", borderTop: "1px solid var(--bg-tertiary)", paddingTop: "0.75rem" }}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))", gap: "0.25rem" }}>
                {allAvailableCodes.map(cod => {
                  const active = selectedCodes.has(cod);
                  const lbl = prodLabel(cod, codes);
                  return (
                    <button key={cod} onClick={() => toggleCode(cod)}
                      style={{ background: active ? "#6366f120" : "transparent", border: `1px solid ${active ? "#6366f1" : `var(--border)`}`,
                        borderRadius: "4px", color: active ? "#6366f1" : `var(--text-dim)`, padding: "0.2rem 0.55rem",
                        fontFamily: "monospace", fontSize: "1.17rem", cursor: "pointer", textAlign: "center",
                        width: "100%", transition: "all 0.1s" }}>
                      {lbl}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Attendance + By Region side by side ── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1.25rem", marginBottom: "1.25rem", alignItems: "stretch" }}>

        {/* ── Attendance panel ── */}
        <div style={{ background: `var(--bg-secondary)`, border: "1px solid var(--border)", borderRadius: "12px", padding: "1.25rem" }}>
          <div style={{ fontFamily: "monospace", fontSize: "1.11rem", color: `var(--text-muted)`, letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: "1rem" }}>
            Attendance vs Last 7 Days
          </div>
          <div style={{ display: "flex", gap: "0.75rem", marginBottom: "1rem" }}>
            {[
              { label: "Present", count: d.presentCount,   color: "#16a34a" },
              { label: "Absent",  count: d.absent.length,  color: "#dc2626" },
              { label: "New",     count: d.newFaces.length, color: "#d97706" },
            ].map(({ label, count, color }) => (
              <div key={label} style={{ flex: 1, padding: "0.6rem", background: color+"12", border: `1px solid ${color}30`, borderRadius: "8px", textAlign: "center" }}>
                <div style={{ fontFamily: "'Cormorant Garamond', Georgia, serif", fontSize: "2.4rem", color, fontWeight: 700, lineHeight: 1 }}>{count}</div>
                <div style={{ fontFamily: "monospace", fontSize: "1.11rem", color, marginTop: "0.15rem" }}>{label}</div>
              </div>
            ))}
          </div>
          {d.absent.length > 0 && (
            <div>
              <button onClick={() => setShowAbsent(v => !v)}
                style={{ background: "transparent", border: "none", cursor: "pointer", fontFamily: "monospace", fontSize: "1.11rem", color: "#dc2626", padding: 0, display: "flex", alignItems: "center", gap: "0.3rem", marginBottom: "0.4rem" }}>
                <span>{showAbsent?"▾":"▸"}</span>
                {d.absent.length} absent today — worked in last 7 days
              </button>
              {showAbsent && (
                <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
                  {Object.entries(d.absentByRegion).sort().map(([reg, agents]) => (
                    <div key={reg}>
                      <div style={{ fontFamily: "monospace", fontSize: "1.17rem", color: getRegColor(reg), textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "0.25rem" }}>
                        {reg} <span style={{ color: `var(--text-faint)` }}>({agents.length})</span>
                      </div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.25rem" }}>
                        {agents.sort((a,b)=>a.name.localeCompare(b.name)).map(({ name, quartile }) => (
                          <div key={name} style={{ fontFamily: "monospace", fontSize: "1.11rem", padding: "0.15rem 0.5rem", borderRadius: "3px",
                            background: "#dc262612", border: "1px solid #dc262630", color: "#dc2626",
                            display: "flex", alignItems: "center", gap: "0.3rem" }}>
                            {name.split(" ")[0]}
                            {quartile && <span style={{ opacity: 0.6, fontSize: "0.81rem", color: Q[quartile]?.color || `var(--text-muted)` }}>{quartile}</span>}
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          {d.newFaces.length > 0 && (
            <div style={{ marginTop: "0.75rem" }}>
              <div style={{ fontFamily: "monospace", fontSize: "1.11rem", color: "#d97706", marginBottom: "0.4rem" }}>
                ▸ {d.newFaces.length} agents working today not in recent history
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "0.3rem" }}>
                {d.newFaces.sort().map(name => (
                  <div key={name} style={{ fontFamily: "monospace", fontSize: "1.11rem", padding: "0.15rem 0.5rem", borderRadius: "3px",
                    background: "#d9770612", border: "1px solid #d9770630", color: "#d97706" }}>
                    {name.split(" ")[0]}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* ── By Region ── */}
        <div style={{ background: `var(--bg-secondary)`, border: "1px solid var(--border)", borderRadius: "12px", padding: "1.25rem", display: "flex", flexDirection: "column" }}>
          <div style={{ fontFamily: "monospace", fontSize: "1.11rem", color: `var(--text-muted)`, letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: "1rem" }}>
            By Region — Live
          </div>
          {Object.entries(d.byReg).sort().map(([reg, s]) => {
            const gph = s.hrs > 0 ? s.goals / s.hrs : 0;
            const avgPct = s.pctCount > 0 ? s.pctSum / s.pctCount : null;
            const isBZ = reg.toUpperCase().includes("XOTM");
            const regColor = getRegColor(reg);
            const pctColor = avgPct !== null ? attainColor(avgPct) : `var(--text-dim)`;
            const hasProd = Object.keys(s.products).length > 0;
            return (
              <div key={reg} style={{ padding: "0.85rem 1rem", background: `var(--bg-primary)`, borderRadius: "8px", border: `1px solid ${regColor}22`, marginBottom: "0.6rem" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
                  <span style={{ fontFamily: "Georgia, serif", fontSize: "1.32rem", color: regColor, fontWeight: 600 }}>{reg}</span>
                  <span style={{ fontFamily: "monospace", fontSize: "1.14rem", color: `var(--text-muted)` }}>{s.count} agents</span>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr 1fr", gap: "0.5rem" }}>
                  {[
                    { l: "Hours",     v: fmt(s.hrs, 1),                                      c: "#6366f1" },
                    { l: "Sales",     v: s.goals || "—",                                      c: "#d97706" },
                    { l: "GPH",       v: s.goals > 0 ? gph.toFixed(3) : "—",                 c: "#16a34a" },
                    { l: "RGU",       v: s.rgu || "—",                                        c: "#2563eb" },
                    { l: "% to Goal", v: avgPct !== null ? `${Math.round(avgPct)}%` : "—",   c: pctColor  },
                  ].map(({ l, v, c }) => (
                    <div key={l} style={{ textAlign: "center" }}>
                      <div style={{ fontFamily: "'Cormorant Garamond', Georgia, serif", fontSize: "1.65rem", color: c, fontWeight: 600 }}>{v}</div>
                      <div style={{ fontFamily: "monospace", fontSize: "0.99rem", color: `var(--text-dim)` }}>{l}</div>
                    </div>
                  ))}
                </div>
                {hasProd && displayCodes.length > 0 && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "0.2rem", marginTop: "0.5rem" }}>
                    {Object.entries(s.products)
                      .filter(([cod]) => selectedCodes.size === 0 || selectedCodes.has(cod))
                      .sort((a,b)=>b[1]-a[1]).map(([cod, cnt]) => (
                      <span key={cod} style={{ fontFamily: "monospace", fontSize: "0.81rem", padding: "0.1rem 0.35rem", borderRadius: "3px", background: "#6366f108", border: "1px solid #6366f120", color: "#6366f1aa",
                        wordBreak: "break-word", overflowWrap: "anywhere" }}
                        title={`${prodLabel(cod, codes)}: ${cnt}`}>
                        {prodLabel(cod, codes)}: {cnt}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            );
          })}

          {/* Product mix if any sales exist */}
          {Object.keys(d.productTotals).length > 0 && (
            <div style={{ marginTop: "auto", paddingTop: "0.75rem", borderTop: "1px solid var(--bg-tertiary)" }}>
              <div style={{ fontFamily: "monospace", fontSize: "1.11rem", color: `var(--text-dim)`, marginBottom: "0.4rem" }}>PRODUCT MIX TODAY</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "0.3rem" }}>
                {Object.entries(d.productTotals).sort((a,b)=>b[1]-a[1]).map(([cod, cnt]) => (
                  <div key={cod} style={{ fontFamily: "monospace", fontSize: "1.08rem", padding: "0.15rem 0.5rem", borderRadius: "3px", background: "#6366f112", border: "1px solid #6366f130", color: "#6366f1",
                    wordBreak: "break-word", overflowWrap: "anywhere" }}>
                    {prodLabel(cod, codes)}: {cnt}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Programs breakdown ── */}
      <div style={{ background: `var(--bg-secondary)`, border: "1px solid var(--border)", borderRadius: "12px", padding: "1.25rem", marginBottom: "1.25rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem" }}>
          <div style={{ fontFamily: "monospace", fontSize: "1.11rem", color: `var(--text-muted)`, letterSpacing: "0.12em", textTransform: "uppercase" }}>Performance by Campaign · by Site</div>
          <div style={{ fontFamily: "monospace", fontSize: "1.11rem", color: `var(--text-faint)` }}>click headers to sort · site tabs to filter</div>
        </div>
        {/* Site drill-down tabs */}
        {(() => {
          const uniqueProgRegs = [...new Set((d?.programs || []).map(p => p.reg))].sort();
          const bzRegs = uniqueProgRegs.filter(r => r.toUpperCase().includes("XOTM"));
          const drRegs = uniqueProgRegs.filter(r => !r.toUpperCase().includes("XOTM"));
          const siteTabs = [];
          if (drRegs.length > 0) siteTabs.push({ label: drRegs.length === 1 ? drRegs[0] : "DR", regs: drRegs });
          if (bzRegs.length > 0) siteTabs.push({ label: "BZ", regs: bzRegs });
          // Only render site tabs when there are multiple site groups
          if (siteTabs.length < 2) return null;
          return (
            <div style={{ marginBottom: "1rem" }}>
              <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap", marginBottom: progSiteFilter === "BZ" ? "0.5rem" : 0 }}>
                <button onClick={() => { setProgSiteFilter(null); setBzSiteFilter(null); }}
                  style={{ padding: "0.3rem 0.8rem", borderRadius: "5px", border: `1px solid ${!progSiteFilter?"#d97706":`var(--border)`}`, background: !progSiteFilter?"#d9770618":"transparent", color: !progSiteFilter?"#d97706":`var(--text-muted)`, fontFamily: "monospace", fontSize: "1.11rem", cursor: "pointer" }}>
                  All Sites
                </button>
                {siteTabs.map(st => {
                  const isActive = progSiteFilter === st.label;
                  const btnColor = getRegColor(st.regs[0]);
                  return (
                    <button key={st.label} onClick={() => { setProgSiteFilter(isActive ? null : st.label); setBzSiteFilter(null); }}
                      style={{ padding: "0.3rem 0.8rem", borderRadius: "5px", border: `1px solid ${isActive?btnColor:`var(--border)`}`, background: isActive?btnColor+"18":"transparent", color: isActive?btnColor:`var(--text-muted)`, fontFamily: "monospace", fontSize: "1.11rem", cursor: "pointer" }}>
                      {st.label}
                      <span style={{ fontFamily: "monospace", fontSize: "1.08rem", color: `var(--text-dim)`, marginLeft: "0.35rem" }}>
                        ({st.regs.length > 1 ? `${st.regs.length} sites` : st.regs[0]})
                      </span>
                    </button>
                  );
                })}
              </div>
              {/* BZ sub-site tabs — shown when BZ is the active site filter */}
              {progSiteFilter === "BZ" && bzRegs.length > 1 && (
                <div style={{ display: "flex", gap: "0.35rem", flexWrap: "wrap", paddingLeft: "0.5rem", borderLeft: "2px solid #6366f130" }}>
                  <button onClick={() => setBzSiteFilter(null)}
                    style={{ padding: "0.25rem 0.7rem", borderRadius: "4px", border: `1px solid ${!bzSiteFilter ? "#6366f1" : `var(--border)`}`, background: !bzSiteFilter ? "#6366f118" : "transparent", color: !bzSiteFilter ? "#6366f1" : `var(--text-dim)`, fontFamily: "monospace", fontSize: "1.02rem", cursor: "pointer", transition: "all 0.15s" }}>
                    Combined
                  </button>
                  {bzRegs.map(reg => {
                    const isActive = bzSiteFilter === reg;
                    const regColor = getRegColor(reg);
                    // Short label: strip "-XOTM" suffix for cleaner display
                    const shortLabel = reg.replace(/-XOTM$/i, "");
                    return (
                      <button key={reg} onClick={() => setBzSiteFilter(isActive ? null : reg)}
                        style={{ padding: "0.25rem 0.7rem", borderRadius: "4px", border: `1px solid ${isActive ? regColor : `var(--border)`}`, background: isActive ? regColor + "18" : "transparent", color: isActive ? regColor : `var(--text-dim)`, fontFamily: "monospace", fontSize: "1.02rem", cursor: "pointer", transition: "all 0.15s" }}>
                        {shortLabel}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })()}
        {/* Site summary strip when filtered */}
        {progSiteFilter && sortedPrograms.length > 0 && (() => {
          const totHrs = sortedPrograms.reduce((s, p) => s + p.hrs, 0);
          const totGoals = sortedPrograms.reduce((s, p) => s + p.effectiveGoals, 0);
          const totRgu = sortedPrograms.reduce((s, p) => s + (p.rgu || 0), 0);
          const totGph = totHrs > 0 ? totGoals / totHrs : 0;
          const totAgents = sortedPrograms.reduce((s, p) => s + p.agentCount, 0);
          const filterColor = sortedPrograms.length > 0 ? getRegColor(sortedPrograms[0].reg) : "#d97706";
          return (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: "0.5rem", marginBottom: "1rem", padding: "0.75rem", background: filterColor + "08", border: `1px solid ${filterColor}25`, borderRadius: "8px" }}>
              {[
                { l: "Campaigns", v: sortedPrograms.length, c: filterColor },
                { l: "Agents", v: totAgents, c: `var(--text-secondary)` },
                { l: "Hours", v: fmt(totHrs, 1), c: "#6366f1" },
                { l: "Sales", v: totGoals || "—", c: "#d97706" },
                { l: "GPH", v: totGoals > 0 ? totGph.toFixed(3) : "—", c: "#16a34a" },
                { l: "CPS", v: totGoals > 0 ? `$${((totHrs * 19.77) / totGoals).toFixed(2)}` : `$${(totHrs * 19.77).toFixed(2)}`, c: (() => { const pv = sortedPrograms.filter(p => p.pctToGoal !== null); return pv.length > 0 ? attainColor(pv.reduce((s,p) => s + p.pctToGoal, 0) / pv.length) : `var(--text-faint)`; })() },
              ].map(({ l, v, c }) => (
                <div key={l} style={{ textAlign: "center" }}>
                  <div style={{ fontFamily: "'Cormorant Garamond', Georgia, serif", fontSize: "1.95rem", color: c, fontWeight: 700, lineHeight: 1 }}>{v}</div>
                  <div style={{ fontFamily: "monospace", fontSize: "0.9rem", color: `var(--text-dim)`, marginTop: "0.1rem" }}>{l}</div>
                </div>
              ))}
            </div>
          );
        })()}
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "monospace", fontSize: "1.08rem", whiteSpace: "nowrap" }}>
            <thead>
              <tr style={{ borderBottom: "2px solid var(--border)" }}>
                <ProgSortTh k="grp"        label="Program" />
                <ProgSortTh k="roc"        label="ROC" />
                <ProgSortTh k="reg"        label="Region" />
                <ProgSortTh k="agentCount" label="Agents"    right />
                <ProgSortTh k="hrs"        label="Hours"     right />
                <ProgSortTh k="goals"      label="Sales"     right />
                <ProgSortTh k="gph"        label="GPH"       right />
                <ProgSortTh k="cps"        label="CPS"       right />
                <ProgSortTh k="rgu"        label="RGU"       right />
                {progActiveCodes.map(cod => {
                  const lbl = prodLabel(cod, codes);
                  return (
                    <th key={cod} title={lbl} style={{ padding: "0.4rem 0.4rem", color: `var(--text-dim)`, fontWeight: 400, textAlign: "right" }}>
                      {lbl.length > 13 ? lbl.slice(0,12) + "…" : lbl}
                    </th>
                  );
                })}
                <ProgSortTh k="pctToGoal"  label="% to Goal" right />
                <th style={{ padding: "0.4rem 0.6rem", color: `var(--text-dim)`, fontWeight: 400, textAlign: "right" }}>HSD %</th>
                <th style={{ padding: "0.4rem 0.6rem", color: `var(--text-dim)`, fontWeight: 400, textAlign: "right" }}>Mobile %</th>
              </tr>
            </thead>
            <tbody>
              {(() => {
                // Build display rows: DR rows stay flat, BZ programs grouped with combined + individual sub-rows
                // BUT if a specific BZ site is selected (bzSiteFilter), show flat rows only
                const isBZReg = r => (r || "").toUpperCase().includes("XOTM");
                const drRows = sortedPrograms.filter(p => !isBZReg(p.reg));
                const bzRows = sortedPrograms.filter(p => isBZReg(p.reg));

                const renderRow = (p, key, style = {}) => {
                  const eg = p.effectiveGoals;
                  const gph = p.hrs > 0 ? eg / p.hrs : 0;
                  const regColor = p.isCombined ? "#6366f1" : getRegColor(p.reg);
                  const pctColor = p.pctToGoal !== null ? attainColor(p.pctToGoal) : `var(--text-faint)`;
                  return (
                    <tr key={key} style={{ borderBottom: "1px solid var(--bg-tertiary)", ...style }}>
                      <td style={{ padding: "0.4rem 0.75rem", color: `var(--text-primary)`, fontFamily: "Georgia, serif", ...style.tdProgram }}>{style.progLabel || p.grp}</td>
                      <td style={{ padding: "0.4rem 0.75rem", color: `var(--text-dim)`, fontFamily: "monospace", fontSize: "0.9rem" }}>{p.roc || "\u2014"}</td>
                      <td style={{ padding: "0.4rem 0.75rem" }}>
                        <span style={{ background: regColor+"18", border: `1px solid ${regColor}40`, borderRadius: "3px", color: regColor, padding: "0.1rem 0.35rem" }}>{p.isCombined ? "BZ" : p.reg}</span>
                      </td>
                      <td style={{ padding: "0.4rem 0.75rem", color: `var(--text-secondary)`, textAlign: "right" }}>{p.agentCount}</td>
                      <td style={{ padding: "0.4rem 0.75rem", color: "#6366f1", textAlign: "right" }}>{fmt(p.hrs, 2)}</td>
                      <td style={{ padding: "0.4rem 0.75rem", color: eg > 0 ? "#d97706" : `var(--text-faint)`, textAlign: "right" }}>{eg || "—"}</td>
                      <td style={{ padding: "0.4rem 0.75rem", color: eg > 0 ? "#16a34a" : `var(--text-faint)`, textAlign: "right" }}>{eg > 0 ? gph.toFixed(3) : "—"}</td>
                      <td style={{ padding: "0.4rem 0.75rem", color: p.pctToGoal !== null ? attainColor(p.pctToGoal) : `var(--text-faint)`, textAlign: "right" }}>{eg > 0 ? `$${((p.hrs * 19.77) / eg).toFixed(2)}` : `$${(p.hrs * 19.77).toFixed(2)}`}</td>
                      <td style={{ padding: "0.4rem 0.75rem", color: p.rgu > 0 ? "#2563eb" : `var(--text-faint)`, textAlign: "right" }}>{p.rgu || "—"}</td>
                      {progActiveCodes.map(cod => {
                        const v = p.products?.[cod] || 0;
                        return (
                          <td key={cod} style={{ padding: "0.4rem 0.4rem", color: v > 0 ? "#2563eb" : "#1f2937", textAlign: "right", fontWeight: v > 0 ? 700 : 400 }}>
                            {v || ""}
                          </td>
                        );
                      })}
                      <td style={{ padding: "0.4rem 0.75rem", color: pctColor, textAlign: "right", fontWeight: 700 }}>
                        {p.pctToGoal !== null ? `${Math.round(p.pctToGoal)}%` : "—"}
                      </td>
                      <td style={{ padding: "0.4rem 0.75rem", color: p.hsd > 0 && eg > 0 ? "#2563eb" : `var(--text-faint)`, textAlign: "right" }}>
                        {p.hsd > 0 && eg > 0 ? `${Math.round(p.hsd / eg * 100)}%` : "—"}
                      </td>
                      <td style={{ padding: "0.4rem 0.75rem", color: p.xml > 0 && eg > 0 ? "#8b5cf6" : `var(--text-faint)`, textAlign: "right" }}>
                        {p.xml > 0 && eg > 0 ? `${Math.round(p.xml / eg * 100)}%` : "—"}
                      </td>
                    </tr>
                  );
                };

                // If a specific BZ site is selected, show all as flat rows (no grouping)
                if (bzSiteFilter) {
                  let rowIdx = 0;
                  return sortedPrograms.map((p) => {
                    rowIdx++;
                    return renderRow(p, `${p.reg}|${p.roc}|${p.grp}`, {
                      background: rowIdx % 2 === 0 ? "transparent" : `var(--bg-row-alt)`,
                    });
                  });
                }

                // Build display rows respecting sort order, with BZ grouping
                const displayRows = [];
                const isBZReg2 = r => (r || "").toUpperCase().includes("XOTM");
                const bzProcessed = new Set();
                
                sortedPrograms.forEach(p => {
                  if (!isBZReg2(p.reg)) {
                    // DR row — render directly
                    displayRows.push({ type: "normal", data: p });
                  } else {
                    // BZ row — group by program name (grp), combining all ROCs for same program
                    const groupKey = p.grp;
                    if (bzProcessed.has(groupKey)) return; // already handled as part of a group
                    bzProcessed.add(groupKey);
                    const group = sortedPrograms.filter(r => isBZReg2(r.reg) && r.grp === p.grp);
                    if (group.length > 1) {
                      // Build combined row
                      const combined = {
                        grp: p.grp, reg: "BZ Combined", isCombined: true,
                        roc: [...new Set(group.map(r => r.roc).filter(Boolean))].sort().join(", "),
                        agentCount: group.reduce((s, r) => s + r.agentCount, 0),
                        hrs: group.reduce((s, r) => s + r.hrs, 0),
                        effectiveGoals: group.reduce((s, r) => s + r.effectiveGoals, 0),
                        rgu: group.reduce((s, r) => s + (r.rgu || 0), 0),
                        hsd: group.reduce((s, r) => s + (r.hsd || 0), 0),
                        xml: group.reduce((s, r) => s + (r.xml || 0), 0),
                        products: {},
                        pctToGoal: (() => {
                          const pcts = group.filter(r => r.pctToGoal !== null);
                          return pcts.length > 0 ? pcts.reduce((s, r) => s + r.pctToGoal, 0) / pcts.length : null;
                        })(),
                      };
                      group.forEach(r => Object.entries(r.products || {}).forEach(([k, v]) => {
                        combined.products[k] = (combined.products[k] || 0) + v;
                      }));
                      displayRows.push({ type: "bzCombined", data: combined });
                    } else {
                      displayRows.push({ type: "normal", data: group[0] });
                    }
                  }
                });

                let rowIdx = 0;
                return displayRows.map(({ type, data }) => {
                  rowIdx++;
                  if (type === "bzCombined") {
                    return renderRow(data, `bz-combined-${data.grp}-${data.roc || ""}`, {
                      background: rowIdx % 2 === 0 ? "transparent" : `var(--bg-row-alt)`,
                    });
                  } else if (type === "bzSub") {
                    const regColor = getRegColor(data.reg);
                    return renderRow(data, `${data.reg}|${data.roc || ""}|${data.grp}`, {
                      background: "#6366f106",
                      borderLeft: `3px solid ${regColor}40`,
                      tdProgram: { paddingLeft: "1.75rem", fontSize: "0.95em", color: `var(--text-muted)` },
                      progLabel: <span style={{ color: `var(--text-muted)` }}>└ {data.grp}</span>,
                    });
                  } else {
                    return renderRow(data, `${data.reg}|${data.roc || ""}|${data.grp}`, {
                      background: rowIdx % 2 === 0 ? "transparent" : `var(--bg-row-alt)`,
                    });
                  }
                });
              })()}
            </tbody>
            <tfoot>
              {(() => {
                const totAgents = sortedPrograms.reduce((s, p) => s + p.agentCount, 0);
                const totHrs    = sortedPrograms.reduce((s, p) => s + p.hrs, 0);
                const totGoals  = sortedPrograms.reduce((s, p) => s + p.effectiveGoals, 0);
                const totRgu    = sortedPrograms.reduce((s, p) => s + (p.rgu || 0), 0);
                const totHsd    = sortedPrograms.reduce((s, p) => s + (p.hsd || 0), 0);
                const totXml    = sortedPrograms.reduce((s, p) => s + (p.xml || 0), 0);
                const totGph    = totHrs > 0 ? totGoals / totHrs : 0;
                const pctVals   = sortedPrograms.filter(p => p.pctToGoal !== null);
                const avgPct    = pctVals.length > 0 ? pctVals.reduce((s, p) => s + p.pctToGoal, 0) / pctVals.length : null;
                const pctColor  = avgPct !== null ? attainColor(avgPct) : `var(--text-faint)`;
                return (
                  <tr style={{ borderTop: "2px solid var(--border)", background: `var(--bg-row-alt)` }}>
                    <td style={{ padding: "0.5rem 0.75rem", color: `var(--text-warm)`, fontWeight: 700 }}>TOTAL</td>
                    <td style={{ padding: "0.5rem 0.75rem" }}></td>
                    <td style={{ padding: "0.5rem 0.75rem" }}></td>
                    <td style={{ padding: "0.5rem 0.75rem", color: `var(--text-warm)`, textAlign: "right", fontWeight: 700 }}>{totAgents}</td>
                    <td style={{ padding: "0.5rem 0.75rem", color: "#6366f1", textAlign: "right", fontWeight: 700 }}>{fmt(totHrs, 2)}</td>
                    <td style={{ padding: "0.5rem 0.75rem", color: totGoals > 0 ? "#d97706" : `var(--text-faint)`, textAlign: "right", fontWeight: 700 }}>{totGoals || "—"}</td>
                    <td style={{ padding: "0.5rem 0.75rem", color: totGoals > 0 ? "#16a34a" : `var(--text-faint)`, textAlign: "right", fontWeight: 700 }}>{totGoals > 0 ? totGph.toFixed(3) : "—"}</td>
                    <td style={{ padding: "0.5rem 0.75rem", color: pctColor, textAlign: "right", fontWeight: 700 }}>{totGoals > 0 ? `$${((totHrs * 19.77) / totGoals).toFixed(2)}` : `$${(totHrs * 19.77).toFixed(2)}`}</td>
                    <td style={{ padding: "0.5rem 0.75rem", color: totRgu > 0 ? "#2563eb" : `var(--text-faint)`, textAlign: "right", fontWeight: 700 }}>{totRgu || "—"}</td>
                    {progActiveCodes.map(cod => {
                      const tot = sortedPrograms.reduce((s, p) => s + (p.products?.[cod] || 0), 0);
                      return (
                        <td key={cod} style={{ padding: "0.5rem 0.4rem", color: tot > 0 ? "#2563eb" : "#1f2937", textAlign: "right", fontWeight: 700 }}>
                          {tot || ""}
                        </td>
                      );
                    })}
                    <td style={{ padding: "0.5rem 0.75rem", color: pctColor, textAlign: "right", fontWeight: 700 }}>
                      {avgPct !== null ? `${Math.round(avgPct)}%` : "—"}
                    </td>
                    <td style={{ padding: "0.5rem 0.75rem", color: totHsd > 0 && totGoals > 0 ? "#2563eb" : `var(--text-faint)`, textAlign: "right", fontWeight: 700 }}>
                      {totHsd > 0 && totGoals > 0 ? `${Math.round(totHsd / totGoals * 100)}%` : "—"}
                    </td>
                    <td style={{ padding: "0.5rem 0.75rem", color: totXml > 0 && totGoals > 0 ? "#8b5cf6" : `var(--text-faint)`, textAlign: "right", fontWeight: 700 }}>
                      {totXml > 0 && totGoals > 0 ? `${Math.round(totXml / totGoals * 100)}%` : "—"}
                    </td>
                  </tr>
                );
              })()}
            </tfoot>
          </table>
        </div>
      </div>

      {/* ── Agent leaderboard ── */}
      <div style={{ background: `var(--bg-secondary)`, border: "1px solid var(--border)", borderRadius: "12px", padding: "1.25rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem" }}>
          <div style={{ fontFamily: "monospace", fontSize: "1.11rem", color: `var(--text-muted)`, letterSpacing: "0.12em", textTransform: "uppercase" }}>
            Agent Leaderboard · {sortedAgents.length} {lbRegion === "All" ? (lbJob ? `in ${lbJob}` : "active today") : `in ${lbRegion}`}{lbJob && lbRegion !== "All" ? ` · ${lbJob}` : ""}
          </div>
          <div style={{ fontFamily: "monospace", fontSize: "1.11rem", color: `var(--text-faint)` }}>click headers to sort</div>
        </div>
        {/* Region selector */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem", marginBottom: "0.5rem" }}>
          {["All", ...(d.uniqueRegs || [])].map(r => {
            const active = lbRegion === r;
            const isBZ = r !== "All" && r.toUpperCase().includes("XOTM");
            const btnColor = r === "All" ? `var(--text-muted)` : getRegColor(r);
            return (
              <button key={r} onClick={() => { setLbRegion(r); setLbJob(null); }}
                style={{ background: active ? btnColor+"20" : "transparent", border: `1px solid ${active ? btnColor : `var(--border)`}`, borderRadius: "5px",
                  color: active ? btnColor : `var(--text-dim)`, padding: "0.2rem 0.6rem", fontFamily: "monospace", fontSize: "1.11rem", cursor: "pointer", transition: "all 0.15s" }}>
                {r}
              </button>
            );
          })}
        </div>
        {/* Job/Program filter — shows unique programs for selected region */}
        {(() => {
          const regionAgents = lbRegion === "All" ? (d.agents || []) : (d.agents || []).filter(a => a.reg === lbRegion);
          const jobSet = new Set();
          regionAgents.forEach(a => { if (a.grps) a.grps.forEach(g => jobSet.add(g)); });
          const jobs = [...jobSet].sort();
          if (jobs.length < 2) return null;
          return (
            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.3rem", marginBottom: "1rem" }}>
              <button onClick={() => setLbJob(null)}
                style={{ padding: "0.2rem 0.55rem", borderRadius: "4px", border: `1px solid ${!lbJob ? "#16a34a" : `var(--border)`}`, background: !lbJob ? "#16a34a18" : "transparent", color: !lbJob ? "#16a34a" : `var(--text-dim)`, fontFamily: "monospace", fontSize: "1.02rem", cursor: "pointer" }}>
                All Programs
              </button>
              {jobs.map(j => {
                const active = lbJob === j;
                return (
                  <button key={j} onClick={() => setLbJob(active ? null : j)}
                    style={{ padding: "0.2rem 0.55rem", borderRadius: "4px", border: `1px solid ${active ? "#16a34a" : `var(--border)`}`, background: active ? "#16a34a18" : "transparent", color: active ? "#16a34a" : `var(--text-dim)`, fontFamily: "monospace", fontSize: "1.02rem", cursor: "pointer" }}>
                    {j}
                  </button>
                );
              })}
            </div>
          );
        })()}
        {(() => {
          return (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "monospace", fontSize: "1.08rem", whiteSpace: "nowrap" }}>
            <thead>
              <tr style={{ borderBottom: "2px solid var(--border)" }}>
                <SortTh k="name"  label="Agent"    />
                <th style={{ padding: "0.4rem 0.6rem", color: `var(--text-dim)`, fontWeight: 400 }}>Region</th>
                <th style={{ padding: "0.4rem 0.6rem", color: `var(--text-dim)`, fontWeight: 400 }}>Program</th>
                <SortTh k="hrs"             label="Hrs"       right />
                <SortTh k="effectiveGoals"  label="Sales"     right />
                <th style={{ padding: "0.4rem 0.6rem", color: `var(--text-dim)`, fontWeight: 400, textAlign: "right" }}>GPH</th>
                <th style={{ padding: "0.4rem 0.6rem", color: `var(--text-dim)`, fontWeight: 400, textAlign: "right" }}>RGU</th>
                {activeCodes.map(cod => {
                  const lbl = prodLabel(cod, codes);
                  return (
                    <th key={cod} title={lbl} style={{ padding: "0.4rem 0.4rem", color: `var(--text-dim)`, fontWeight: 400, textAlign: "right" }}>
                      {lbl.length > 14 ? lbl.slice(0, 13) + "…" : lbl}
                    </th>
                  );
                })}
                <SortTh k="pctToGoal"  label="% to Goal"  right />
                <th style={{ padding: "0.4rem 0.6rem", color: `var(--text-dim)`, fontWeight: 400, textAlign: "right" }}>HSD %</th>
                <th style={{ padding: "0.4rem 0.6rem", color: `var(--text-dim)`, fontWeight: 400, textAlign: "right" }}>Mobile %</th>
                <th style={{ padding: "0.4rem 0.6rem", color: `var(--text-dim)`, fontWeight: 400, textAlign: "right" }}>Hist Q</th>
              </tr>
            </thead>
            <tbody>
              {sortedAgents.map((a, i) => {
                const eg = a.effectiveGoals;
                const gph      = a.hrs > 0 && eg > 0 ? (eg / a.hrs).toFixed(3) : "—";
                const regColor = getRegColor(a.reg);
                const grpStr   = [...a.grps].join(", ");
                const pctColor = a.pctToGoal !== null ? attainColor(a.pctToGoal) : `var(--text-faint)`;
                return (
                  <tr key={`${a.name}|${a.job || i}`} style={{ borderBottom: "1px solid var(--bg-tertiary)", background: i%2===0?"transparent":`var(--bg-row-alt)` }}>
                    <td style={{ padding: "0.4rem 0.6rem", color: `var(--text-warm)`, fontFamily: "Georgia, serif" }}>{a.name}</td>
                    <td style={{ padding: "0.4rem 0.6rem" }}>
                      <span style={{ background: regColor+"18", border: `1px solid ${regColor}40`, borderRadius: "3px", color: regColor, padding: "0.1rem 0.35rem" }}>{a.reg}</span>
                    </td>
                    <td style={{ padding: "0.4rem 0.6rem", color: `var(--text-muted)`, maxWidth: "140px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={grpStr}>{grpStr}</td>
                    <td style={{ padding: "0.4rem 0.6rem", color: "#6366f1", textAlign: "right" }}>{fmt(a.hrs, 2)}</td>
                    <td style={{ padding: "0.4rem 0.6rem", color: eg > 0 ? "#d97706" : `var(--text-faint)`, textAlign: "right", fontWeight: eg > 0 ? 700 : 400 }}>{eg || "—"}</td>
                    <td style={{ padding: "0.4rem 0.6rem", color: eg > 0 ? "#16a34a" : `var(--text-faint)`, textAlign: "right" }}>{gph}</td>
                    <td style={{ padding: "0.4rem 0.6rem", color: a.rgu > 0 ? "#2563eb" : `var(--text-faint)`, textAlign: "right" }}>{a.rgu || "—"}</td>
                    {activeCodes.map(cod => {
                      const v = a.products[cod] || 0;
                      return (
                        <td key={cod} style={{ padding: "0.4rem 0.4rem", color: v > 0 ? "#2563eb" : "#1f2937", textAlign: "right", fontWeight: v > 0 ? 700 : 400 }}>
                          {v || ""}
                        </td>
                      );
                    })}
                    <td style={{ padding: "0.4rem 0.6rem", color: pctColor, textAlign: "right", fontWeight: 700 }}>
                      {a.pctToGoal !== null ? `${Math.round(a.pctToGoal)}%` : "—"}
                    </td>
                    <td style={{ padding: "0.4rem 0.6rem", color: a.hsd > 0 && eg > 0 ? "#2563eb" : `var(--text-faint)`, textAlign: "right" }}>
                      {a.hsd > 0 && eg > 0 ? `${Math.round(a.hsd / eg * 100)}%` : "—"}
                    </td>
                    <td style={{ padding: "0.4rem 0.6rem", color: a.xml > 0 && eg > 0 ? "#8b5cf6" : `var(--text-faint)`, textAlign: "right" }}>
                      {a.xml > 0 && eg > 0 ? `${Math.round(a.xml / eg * 100)}%` : "—"}
                    </td>
                    <td style={{ padding: "0.4rem 0.6rem", textAlign: "right" }}>
                      {a.quartile ? <QBadge q={a.quartile} /> : <span style={{ fontFamily: "monospace", fontSize: "1.17rem", color: `var(--text-faint)` }}>—</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              {(() => {
                const totHrs   = sortedAgents.reduce((s, a) => s + a.hrs, 0);
                const totGoals = sortedAgents.reduce((s, a) => s + a.effectiveGoals, 0);
                const totRgu   = sortedAgents.reduce((s, a) => s + (a.rgu || 0), 0);
                const totHsd   = sortedAgents.reduce((s, a) => s + (a.hsd || 0), 0);
                const totXml   = sortedAgents.reduce((s, a) => s + (a.xml || 0), 0);
                const totGph   = totHrs > 0 ? totGoals / totHrs : 0;
                const pctVals  = sortedAgents.filter(a => a.pctToGoal !== null);
                const avgPct   = pctVals.length > 0 ? pctVals.reduce((s, a) => s + a.pctToGoal, 0) / pctVals.length : null;
                const pctColor = avgPct !== null ? attainColor(avgPct) : `var(--text-faint)`;
                return (
                  <tr style={{ borderTop: "2px solid var(--border)", background: `var(--bg-row-alt)` }}>
                    <td style={{ padding: "0.5rem 0.6rem", color: `var(--text-warm)`, fontWeight: 700 }}>TOTAL ({sortedAgents.length})</td>
                    <td></td>
                    <td></td>
                    <td style={{ padding: "0.5rem 0.6rem", color: "#6366f1", textAlign: "right", fontWeight: 700 }}>{fmt(totHrs, 2)}</td>
                    <td style={{ padding: "0.5rem 0.6rem", color: totGoals > 0 ? "#d97706" : `var(--text-faint)`, textAlign: "right", fontWeight: 700 }}>{totGoals || "—"}</td>
                    <td style={{ padding: "0.5rem 0.6rem", color: totGoals > 0 ? "#16a34a" : `var(--text-faint)`, textAlign: "right", fontWeight: 700 }}>{totGoals > 0 ? totGph.toFixed(3) : "—"}</td>
                    <td style={{ padding: "0.5rem 0.6rem", color: totRgu > 0 ? "#2563eb" : `var(--text-faint)`, textAlign: "right", fontWeight: 700 }}>{totRgu || "—"}</td>
                    {activeCodes.map(cod => {
                      const tot = sortedAgents.reduce((s, a) => s + (a.products[cod] || 0), 0);
                      return (
                        <td key={cod} style={{ padding: "0.5rem 0.4rem", color: tot > 0 ? "#2563eb" : "#1f2937", textAlign: "right", fontWeight: 700 }}>
                          {tot || ""}
                        </td>
                      );
                    })}
                    <td style={{ padding: "0.5rem 0.6rem", color: pctColor, textAlign: "right", fontWeight: 700 }}>
                      {avgPct !== null ? `${Math.round(avgPct)}%` : "—"}
                    </td>
                    <td style={{ padding: "0.5rem 0.6rem", color: totHsd > 0 && totGoals > 0 ? "#2563eb" : `var(--text-faint)`, textAlign: "right", fontWeight: 700 }}>
                      {totHsd > 0 && totGoals > 0 ? `${Math.round(totHsd / totGoals * 100)}%` : "—"}
                    </td>
                    <td style={{ padding: "0.5rem 0.6rem", color: totXml > 0 && totGoals > 0 ? "#8b5cf6" : `var(--text-faint)`, textAlign: "right", fontWeight: 700 }}>
                      {totXml > 0 && totGoals > 0 ? `${Math.round(totXml / totGoals * 100)}%` : "—"}
                    </td>
                    <td></td>
                  </tr>
                );
              })()}
            </tfoot>
          </table>
          <div style={{ fontFamily: "monospace", fontSize: "1.08rem", color: `var(--text-faint)`, padding: "0.4rem 0.6rem" }}>
            Hist Q = quartile from uploaded historical file · % to Goal = today's sales vs SPH goal × hours worked · HSD % = New HSD / Sales · Mobile % = New Mobile / Sales
          </div>
        </div>
          );
        })()}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// SECTION 14 — APP SHELL  (App.jsx)
// Owns state. Calls usePerformanceEngine. Passes data to pages. No computation.
// ══════════════════════════════════════════════════════════════════════════════

const THEMES = {
  dark: {
    "--bg-primary":    "#080c10",
    "--bg-secondary":  "#0d1117",
    "--bg-row-alt":    "#0a0e14",
    "--bg-tertiary":   "#161b22",
    "--border":        "#21262d",
    "--border-muted":  "#30363d",
    "--text-faint":    "#374151",
    "--text-dim":      "#4b5563",
    "--text-muted":    "#6b7280",
    "--text-secondary":"#9ca3af",
    "--text-primary":  "#e5e7eb",
    "--text-warm":     "#f0e6d3",
  },
  light: {
    "--bg-primary":    "#f0f2f5",
    "--bg-secondary":  "#ffffff",
    "--bg-row-alt":    "#f7f8fa",
    "--bg-tertiary":   "#e4e7eb",
    "--border":        "#d1d5db",
    "--border-muted":  "#e5e7eb",
    "--text-faint":    "#9ca3af",
    "--text-dim":      "#6b7280",
    "--text-muted":    "#4b5563",
    "--text-secondary":"#374151",
    "--text-primary":  "#111827",
    "--text-warm":     "#1f2937",
  },
};

export default function App() {
  const [rawData,    setRawData]    = useState(null);
  const [lightMode,  setLightMode]  = useState(true);
  const [slideIndex, setSlideIndex] = useState(0);
  const [showToday,  setShowToday]  = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const goalsInputRef               = useRef();
  const nhInputRef                  = useRef();

  // Configurable sheet URLs (persisted to localStorage)
  const [sheetUrls, _setSheetUrls] = useState(() => {
    try { const s = localStorage.getItem(SHEET_URLS_KEY); return s ? JSON.parse(s) : {}; }
    catch(e) { return {}; }
  });
  const setSheetUrls = useCallback(urls => {
    _setSheetUrls(urls);
    try { localStorage.setItem(SHEET_URLS_KEY, JSON.stringify(urls)); } catch(e) {}
  }, []);
  const agentSheetUrl = sheetUrls.agent || DEFAULT_AGENT_SHEET_URL;
  const goalsSheetUrl = sheetUrls.goals || DEFAULT_GOALS_SHEET_URL;
  const nhSheetUrl    = sheetUrls.nh || DEFAULT_NH_SHEET_URL;

  // Goals persisted to localStorage
  const [goalsRaw, _setGoalsRaw] = useState(() => {
    try { const s = localStorage.getItem(GOALS_STORAGE_KEY); return s ? JSON.parse(s) : null; }
    catch(e) { return null; }
  });
  const setGoalsRaw = useCallback(data => {
    _setGoalsRaw(data);
    try {
      if (data) localStorage.setItem(GOALS_STORAGE_KEY, JSON.stringify(data));
      else localStorage.removeItem(GOALS_STORAGE_KEY);
    } catch(e) {}
  }, []);

  // New hires roster persisted to localStorage (same pattern as goals)
  const [newHiresRaw, _setNHRaw] = useState(() => {
    try { const s = localStorage.getItem(NH_STORAGE_KEY); return s ? JSON.parse(s) : null; }
    catch(e) { return null; }
  });
  const setNHRaw = useCallback(data => {
    _setNHRaw(data);
    try {
      if (data) localStorage.setItem(NH_STORAGE_KEY, JSON.stringify(data));
      else localStorage.removeItem(NH_STORAGE_KEY);
    } catch(e) {}
  }, []);

  const perf = usePerformanceEngine({ rawData, goalsRaw, newHiresRaw });
  const { programs, jobTypes, newHireSet, newHires, allAgentNames } = perf;
  const totalSlides = 1 + programs.length + 1; // Overview + programs + Campaign Comparison

  // Auto-load agent data from published Google Sheet
  const [sheetLoading, setSheetLoading] = useState(false);
  const [sheetError, setSheetError] = useState(null);
  useEffect(() => {
    if (rawData) return; // already have data
    let cancelled = false;
    (async () => {
      try {
        setSheetLoading(true);
        const res = await fetch(agentSheetUrl);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const text = await res.text();
        const rows = parseCSV(text);
        if (!cancelled && rows.length > 0) {
          setRawData(rows);
          setSlideIndex(0);
        }
        // Auto-load goals sheet if URL configured
        if (!cancelled && goalsSheetUrl && !goalsRaw) {
          try {
            const proxyG = url => `https://corsproxy.io/?${encodeURIComponent(url)}`;
            let gRes;
            try { gRes = await fetch(goalsSheetUrl); } catch(e) { gRes = null; }
            if (!gRes || !gRes.ok) gRes = await fetch(proxyG(goalsSheetUrl));
            if (gRes.ok) { const gRows = parseCSV(await gRes.text()); if (gRows.length > 0) setGoalsRaw(gRows); }
          } catch(e) {}
        }
        // Auto-load roster sheet if URL configured
        if (!cancelled && nhSheetUrl && !newHiresRaw) {
          try {
            const proxyN = url => `https://corsproxy.io/?${encodeURIComponent(url)}`;
            let nRes;
            try { nRes = await fetch(nhSheetUrl); } catch(e) { nRes = null; }
            if (!nRes || !nRes.ok) nRes = await fetch(proxyN(nhSheetUrl));
            if (nRes.ok) { const nRows = parseCSV(await nRes.text()); if (nRows.length > 0) setNHRaw(nRows); }
          } catch(e) {}
        }
      } catch (e) {
        if (!cancelled) setSheetError("Auto-load unavailable — use file upload or paste");
      } finally {
        if (!cancelled) setSheetLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Last-7-days unique agent names for Today attendance comparison
  const recentAgentNames = useMemo(() => {
    if (!rawData) return new Set();
    const dates = [...new Set(rawData.map(r => (r.Date || "").trim()).filter(Boolean))].sort().reverse();
    const last7 = new Set(dates.slice(0, 7));
    const names = new Set();
    rawData.forEach(r => {
      if (last7.has((r.Date || "").trim())) {
        const n = (r.AgentName || "").trim();
        if (n) names.add(n);
      }
    });
    return names;
  }, [rawData]);

  // Map of lowercase agent name → { quartile } for Today historical context
  const historicalAgentMap = useMemo(() => {
    const map = {};
    (perf.agents || []).forEach(a => {
      if (a.agentName) map[a.agentName.toLowerCase()] = {
        quartile: a.quartile,
        region:   a.region,
        sphGoal:  a.sphGoal,
        jobType:  a.jobType,
      };
    });
    return map;
  }, [perf.agents]);

  const loadFile = (f, setter) => {
    const r = new FileReader();
    r.onload = e => setter(parseCSV(e.target.result));
    r.readAsText(f);
  };

  const navTo = delta => setSlideIndex(i => Math.max(0, Math.min(totalSlides - 1, i + delta)));

  useEffect(() => {
    const vars = lightMode ? THEMES.light : THEMES.dark;
    const root = document.documentElement;
    Object.entries(vars).forEach(([k, v]) => root.style.setProperty(k, v));
    root.style.background = vars["--bg-primary"];
  }, [lightMode]);

  const wrapStyle = { minHeight: "100vh", background: "var(--bg-primary)", color: "var(--text-primary)" };

  // If no agent data and not showing Today, show the drop zone
  if (!rawData && !showToday) {
    return (
      <div style={wrapStyle}>
        {/* Minimal top bar so TODAY is always accessible */}
        <div style={{ position: "fixed", top: 0, left: 0, right: 0, zIndex: 200, background: `var(--bg-primary)`, borderBottom: `1px solid var(--border)`, padding: "0.5rem 1.5rem", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontFamily: "monospace", fontSize: "1.08rem", color: `var(--text-dim)`, letterSpacing: "0.12em" }}>
            PERFORMANCE INTELLIGENCE · no file loaded
          </span>
          <div style={{ display: "flex", gap: "0.6rem", alignItems: "center" }}>
            <button onClick={() => setLightMode(v => !v)}
              style={{ background: "transparent", border: `1px solid var(--border-muted)`, borderRadius: "5px", color: `var(--text-muted)`, padding: "0.3rem 0.7rem", fontFamily: "monospace", fontSize: "1.08rem", cursor: "pointer" }}>
              {lightMode ? "☀ LIGHT" : "☾ DARK"}
            </button>
            <button onClick={() => setShowToday(true)}
              style={{ background: "transparent", border: `1px solid var(--border-muted)`, borderRadius: "5px", color: `var(--text-muted)`, padding: "0.3rem 0.8rem", fontFamily: "monospace", fontSize: "1.11rem", cursor: "pointer", letterSpacing: "0.05em" }}>
              ○ TODAY
            </button>
          </div>
        </div>
        {/* Settings panel */}
      {showSettings && (
        <div style={{ position: "fixed", inset: 0, zIndex: 300, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem" }}
          onClick={e => { if (e.target === e.currentTarget) setShowSettings(false); }}>
          <div style={{ background: `var(--bg-primary)`, border: "1px solid var(--border)", borderRadius: "12px", padding: "1.5rem", width: "100%", maxWidth: "650px" }}>
            <div style={{ fontFamily: "monospace", fontSize: "1.14rem", color: "#6366f1", letterSpacing: "0.12em", marginBottom: "1.25rem" }}>\u2699 DATA SOURCE SETTINGS</div>
            <div style={{ fontFamily: "monospace", fontSize: "0.88rem", color: `var(--text-dim)`, marginBottom: "1rem" }}>
              Publish Google Sheets as CSV (File \u2192 Share \u2192 Publish to web \u2192 CSV format). Update URLs here when sheets change monthly.
            </div>
            {[
              { key: "agent", label: "Agent Data Sheet", color: "#d97706", current: agentSheetUrl, placeholder: "https://docs.google.com/spreadsheets/.../pub?output=csv" },
              { key: "goals", label: "Goals Sheet", color: "#16a34a", current: goalsSheetUrl, placeholder: "Optional — paste Goals CSV URL" },
              { key: "nh", label: "Roster / New Hires Sheet", color: "#6366f1", current: nhSheetUrl, placeholder: "Optional — paste Roster CSV URL" },
            ].map(({ key, label, color, current, placeholder }) => (
              <div key={key} style={{ marginBottom: "1rem" }}>
                <div style={{ fontFamily: "monospace", fontSize: "0.95rem", color, letterSpacing: "0.08em", marginBottom: "0.3rem" }}>{label}</div>
                <input
                  defaultValue={current}
                  placeholder={placeholder}
                  onBlur={e => {
                    const val = e.target.value.trim();
                    setSheetUrls(prev => ({ ...prev, [key]: val }));
                  }}
                  style={{ width: "100%", padding: "0.5rem 0.75rem", fontFamily: "monospace", fontSize: "0.9rem", background: `var(--bg-secondary)`, color: `var(--text-primary)`, border: `1px solid var(--border)`, borderRadius: "6px", boxSizing: "border-box" }}
                />
                {current && (
                  <div style={{ fontFamily: "monospace", fontSize: "0.8rem", color: `var(--text-faint)`, marginTop: "0.2rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {current.slice(0, 80)}{current.length > 80 ? "..." : ""}
                  </div>
                )}
              </div>
            ))}
            <div style={{ display: "flex", gap: "0.5rem", justifyContent: "space-between", marginTop: "1rem" }}>
              <button onClick={() => { setSheetUrls({}); }}
                style={{ padding: "0.4rem 1rem", borderRadius: "6px", border: "1px solid var(--border)", background: "transparent", color: `var(--text-muted)`, fontFamily: "monospace", fontSize: "0.95rem", cursor: "pointer" }}>
                Reset to Defaults
              </button>
              <button onClick={() => { setShowSettings(false); setRawData(null); setGoalsRaw(null); setNHRaw(null); }}
                style={{ padding: "0.4rem 1rem", borderRadius: "6px", border: "1px solid #2563eb", background: "#2563eb18", color: "#2563eb", fontFamily: "monospace", fontSize: "0.95rem", cursor: "pointer", fontWeight: 600 }}>
                Save & Reload
              </button>
            </div>
          </div>
        </div>
      )}

      <div style={{ paddingTop: "32px" }}>
          <DropZone
            onData={d => { setRawData(d); setSlideIndex(0); }}
            goalsRaw={goalsRaw}
            onGoalsLoad={setGoalsRaw}
            newHiresRaw={newHiresRaw}
            onNewHiresLoad={setNHRaw}
          />
        </div>
      </div>
    );
  }

  const isOverview = slideIndex === 0;
  const program    = isOverview ? null : programs[slideIndex - 1];

  return (
    <div style={wrapStyle}>
      {/* Top bar — compact by default, expands on hover to show file controls below */}
      <div style={{ position: "fixed", top: 0, left: 0, right: 0, zIndex: 200, background: `var(--bg-primary)`, borderBottom: `1px solid var(--border)`, padding: "0.2rem 1.5rem" }}
        onMouseEnter={e => { e.currentTarget.dataset.expanded = "true"; const tb = e.currentTarget.querySelector("[data-toolbar]"); if (tb) { tb.style.pointerEvents = "none"; setTimeout(() => { tb.style.pointerEvents = "auto"; }, 300); } }}
        onMouseLeave={e => e.currentTarget.dataset.expanded = "false"}
        ref={el => { if (el) { const update = () => { const exp = el.dataset.expanded === "true"; const tb = el.querySelector("[data-toolbar]"); if (tb) tb.style.display = exp ? "flex" : "none"; }; el.dataset.expanded = "false"; const obs = new MutationObserver(update); obs.observe(el, { attributes: true, attributeFilter: ["data-expanded"] }); update(); } }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontFamily: "monospace", fontSize: "0.85rem", color: `var(--text-dim)`, letterSpacing: "0.12em" }}>
            {rawData
              ? <>PERF INTEL · {programs.length} pgms · {perf.uniqueAgentCount} agts
                  {goalsRaw && <span style={{ color: "#16a34a", marginLeft: "0.5rem" }}>· goals</span>}
                  {newHireSet.size > 0 && <span style={{ color: "#d97706", marginLeft: "0.5rem" }}>· {newHireSet.size} NH</span>}
                </>
              : <span>PERFORMANCE INTELLIGENCE · <span style={{ color: "#d97706" }}>no file loaded</span></span>
            }
          </span>
          <div style={{ display: "flex", gap: "0.6rem", alignItems: "center" }}>
            <button onClick={() => setLightMode(v => !v)}
              style={{ background: lightMode ? "#f0f2f518" : "transparent", border: `1px solid var(--border-muted)`, borderRadius: "5px", color: `var(--text-muted)`, padding: "0.2rem 0.5rem", fontFamily: "monospace", fontSize: "0.95rem", cursor: "pointer" }}>
              {lightMode ? "\u2600" : "\u263E"}
            </button>
            <button onClick={() => setShowToday(v => !v)}
              style={{ background: showToday?"#16a34a18":"transparent", border: `1px solid ${showToday?"#16a34a":`var(--border-muted)`}`, borderRadius: "5px", color: showToday?"#16a34a":`var(--text-muted)`, padding: "0.2rem 0.5rem", fontFamily: "monospace", fontSize: "0.95rem", cursor: "pointer" }}>
              {showToday ? "\u25CF TODAY" : "\u25CB TODAY"}
            </button>
            <button onClick={() => setShowSettings(v => !v)}
              style={{ background: showSettings?"#6366f118":"transparent", border: `1px solid ${showSettings?"#6366f1":`var(--border-muted)`}`, borderRadius: "5px", color: showSettings?"#6366f1":`var(--text-muted)`, padding: "0.2rem 0.5rem", fontFamily: "monospace", fontSize: "0.95rem", cursor: "pointer" }}>
              DATA
            </button>
          </div>
        </div>
        {/* File management row — appears below on hover */}
        <div data-toolbar="" style={{ display: "none", gap: "0.6rem", alignItems: "center", paddingTop: "0.35rem", flexWrap: "wrap" }}>
          <button onClick={() => goalsInputRef.current.click()}
            style={{ background: goalsRaw?"#16a34a18":"transparent", border: `1px solid ${goalsRaw?"#16a34a":`var(--border-muted)`}`, borderRadius: "5px", color: goalsRaw?"#16a34a":`var(--text-muted)`, padding: "0.25rem 0.7rem", fontFamily: "monospace", fontSize: "1rem", cursor: "pointer" }}>
            {goalsRaw ? "\u2713 GOALS (saved)" : "\u2295 GOALS"}
          </button>
          {goalsRaw && (
            <button onClick={() => setGoalsRaw(null)} title="Clear saved goals"
              style={{ background: "transparent", border: "1px solid var(--text-faint)", borderRadius: "5px", color: `var(--text-dim)`, padding: "0.25rem 0.5rem", fontFamily: "monospace", fontSize: "1rem", cursor: "pointer" }}>{"\u2715"}</button>
          )}
          <input ref={goalsInputRef} type="file" accept=".csv" style={{ display: "none" }} onChange={e => loadFile(e.target.files[0], setGoalsRaw)} />
          <button onClick={() => nhInputRef.current.click()}
            style={{ background: newHiresRaw?"#d9770618":"transparent", border: `1px solid ${newHiresRaw?"#d97706":`var(--border-muted)`}`, borderRadius: "5px", color: newHiresRaw?"#d97706":`var(--text-muted)`, padding: "0.25rem 0.7rem", fontFamily: "monospace", fontSize: "1rem", cursor: "pointer" }}>
            {newHiresRaw ? `\uD83C\uDF31 ${newHireSet.size} NH (saved)` : "\uD83C\uDF31 NEW HIRES"}
          </button>
          {newHiresRaw && (
            <button onClick={() => setNHRaw(null)} title="Clear saved roster"
              style={{ background: "transparent", border: "1px solid var(--text-faint)", borderRadius: "5px", color: `var(--text-dim)`, padding: "0.25rem 0.5rem", fontFamily: "monospace", fontSize: "1rem", cursor: "pointer" }}>{"\u2715"}</button>
          )}
          <input ref={nhInputRef} type="file" accept=".csv" style={{ display: "none" }} onChange={e => loadFile(e.target.files[0], setNHRaw)} />
          <div style={{ flex: 1 }} />
          <button onClick={() => { setRawData(null); setSlideIndex(0); setShowToday(false); }}
            style={{ background: "transparent", border: "1px solid var(--border-muted)", borderRadius: "5px", color: `var(--text-muted)`, padding: "0.25rem 0.7rem", fontFamily: "monospace", fontSize: "1rem", cursor: "pointer" }}>
            {rawData ? "+ NEW FILE" : "+ LOAD FILE"}
          </button>
          <button onClick={() => { const t = prompt("Paste agent CSV data:"); if (t) { const rows = parseCSV(t); if (rows.length > 0) { setRawData(rows); setSlideIndex(0); } } }}
            style={{ background: "transparent", border: "1px solid var(--border-muted)", borderRadius: "5px", color: `var(--text-muted)`, padding: "0.25rem 0.7rem", fontFamily: "monospace", fontSize: "1rem", cursor: "pointer" }}>
            Paste CSV
          </button>
          <button onClick={async () => { try { setSheetLoading(true); const res = await fetch(agentSheetUrl); const text = await res.text(); const rows = parseCSV(text); if (rows.length > 0) { setRawData(rows); setSlideIndex(0); } } catch(e) { alert("Could not fetch sheet: " + e.message); } finally { setSheetLoading(false); } }}
            style={{ background: "transparent", border: "1px solid #2563eb", borderRadius: "5px", color: "#2563eb", padding: "0.25rem 0.7rem", fontFamily: "monospace", fontSize: "1rem", cursor: "pointer" }}>
            {sheetLoading ? "Loading..." : "\u2601 Refresh Sheet"}
          </button>
        </div>
      </div>

      <div style={{ paddingTop: "32px" }}>
        {showToday ? (
          <TodayView recentAgentNames={recentAgentNames} historicalAgentMap={historicalAgentMap} goalLookup={perf.goalLookup} />
        ) : sheetLoading && !rawData ? (
          <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: `var(--bg-primary)` }}>
            <div style={{ fontFamily: "monospace", fontSize: "1.2rem", color: `var(--text-muted)`, letterSpacing: "0.15em", marginBottom: "1rem" }}>LOADING FROM GOOGLE SHEETS...</div>
            <div style={{ width: "200px", height: "3px", background: `var(--border)`, borderRadius: "2px", overflow: "hidden" }}>
              <div style={{ width: "40%", height: "100%", background: "#d97706", borderRadius: "2px", animation: "pulse 1.5s ease-in-out infinite" }} />
            </div>
          </div>
        ) : !rawData ? (
          <DropZone
            onData={d => { setRawData(d); setSlideIndex(0); }}
            goalsRaw={goalsRaw}
            onGoalsLoad={setGoalsRaw}
            newHiresRaw={newHiresRaw}
            onNewHiresLoad={setNHRaw}
          />
        ) : isOverview ? (
          <BusinessOverview perf={perf} onNav={navTo} />
        ) : (slideIndex === 1 + programs.length) ? (
          <CampaignComparisonPanel
            currentAgents={perf.agents}
            onNav={navTo}
          />
        ) : program ? (
          <Slide
            key={program.jobType}
            program={program}
            newHireSet={newHireSet}
            goalLookup={perf.goalLookup}
            fiscalInfo={perf.fiscalInfo}
            slideIndex={slideIndex}
            total={totalSlides}
            onNav={navTo}
            allAgents={perf.agents}
          />
        ) : (
          <div style={{ minHeight: "90vh", display: "flex", alignItems: "center", justifyContent: "center", color: `var(--text-faint)`, fontFamily: "Georgia, serif" }}>
            No "Job Type" column found in your data.
          </div>
        )}
      </div>
    </div>
  );
}
