import React, { useState, useMemo, useRef, useCallback, useEffect, Fragment, Component } from "react";
import pptxgen from "pptxgenjs";

// ── Error Boundary — catches rendering crashes and shows a recovery UI ──────
class ErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: "2rem", fontFamily: "var(--font-ui, Inter, sans-serif)", color: "#dc2626", background: "#fef2f2", border: "1px solid #dc2626", borderRadius: "var(--radius-md, 10px)", margin: "1rem" }}>
          <div style={{ fontSize: "0.88rem", fontWeight: 700, marginBottom: "0.5rem" }}>Something went wrong</div>
          <div style={{ fontSize: "0.9rem", color: "#991b1b", marginBottom: "1rem" }}>{String(this.state.error?.message || this.state.error)}</div>
          <button onClick={() => this.setState({ error: null })} style={{ padding: "0.3rem 0.8rem", border: "1px solid #dc2626", borderRadius: "var(--radius-sm, 6px)", background: "transparent", color: "#dc2626", cursor: "pointer", fontFamily: "var(--font-ui, Inter, sans-serif)" }}>Try Again</button>
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

// ── MBR Export Constants ─────────────────────────────────────────────────────
// Category detection: GL-code prefixes, display name keywords, and exact overrides
function getMbrCategory(jobType) {
  const jt = (jobType || "").trim();
  const upper = jt.toUpperCase();
  // GL code prefixes
  if (/^GLN/i.test(jt)) return "Acquisition";
  if (/^GLU/i.test(jt)) return "Multi-Product Expansion";
  if (/^GLB/i.test(jt)) return "Up Tier & Ancillary";
  // Keyword matching on display names
  if (/\b(NONSUB|NON.?SUB|BAU|LOCALIZ|WR\s*NS)\b/i.test(upper)) return "Acquisition";
  if (/\b(XM\s*UP|ADD.?A.?LINE|ONBOARD|LIKELY)\b/i.test(upper)) return "Multi-Product Expansion";
  if (/\b(XMC|ATTACH|UP.?TIER|ANCILLARY)\b/i.test(upper)) return "Up Tier & Ancillary";
  // Bare "XM" (not "XMC") → Multi-Product Expansion
  if (/^XM$/i.test(upper) || /^XM\s/i.test(upper)) return "Multi-Product Expansion";
  return jt;
}

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
const MBR_BILLING_RATE = 19.77;

// Display-friendly site name mapping
const MBR_SITE_NAMES = {
  "Belize City-XOTM": "Belize City",
  "San Ignacio-XOTM": "San Ignacio",
  "SD-Xfinity": "Dom. Republic",
};
function mbrSiteName(name) { return MBR_SITE_NAMES[name] || name; }

function formatFiscalFilename(fiscalEnd) {
  if (!fiscalEnd) return "GCS_MBR_000000.pptx";
  const [y, m, d] = fiscalEnd.split("-");
  return `GCS_MBR_${m}${d}${y.slice(2)}.pptx`;
}

function mbrQuartileColor(pctToGoal) {
  if (pctToGoal >= 100) return MBR_COLORS.green;
  if (pctToGoal >= 80)  return MBR_COLORS.blue;
  if (pctToGoal > 0)    return MBR_COLORS.amber;
  return MBR_COLORS.red;
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
  { min: 126,    max: Infinity, mobile: 4.00, hsd: 4.00, costPer: 1.00, sph: 1.00, label: "> 126%" },
  { min: 120,    max: 125.99,   mobile: 3.00, hsd: 3.00, costPer: 0.75, sph: 0.75, label: "120–126%" },
  { min: 113,    max: 119.99,   mobile: 2.00, hsd: 2.00, costPer: 0.50, sph: 0.50, label: "113–119%" },
  { min: 106,    max: 112.99,   mobile: 1.00, hsd: 1.00, costPer: 0.25, sph: 0.25, label: "106–112%" },
  { min: 95,     max: 105.99,   mobile: 0,    hsd: 0,    costPer: 0,    sph: 0,    label: "95–105%" },
  { min: 88,     max: 94.99,    mobile:-1.00, hsd:-1.00, costPer:-0.25, sph:-0.25, label: "88–94%" },
  { min: 81,     max: 87.99,    mobile:-2.00, hsd:-2.00, costPer:-0.50, sph:-0.50, label: "81–87%" },
  { min: 74,     max: 80.99,    mobile:-3.00, hsd:-3.00, costPer:-0.75, sph:-0.75, label: "74–80%" },
  { min: 0,      max: 73.99,    mobile:-4.00, hsd:-4.00, costPer:-1.00, sph:-1.00, label: "< 74%" },
];

// SITE-LEVEL (BZ / DR breakouts) — used on the By Site drilldown
const GAINSHARE_SITE_TIERS = [
  { min: 139, max: Infinity, mobile: 4.00, hsd: 4.00, costPer: 2.50, sph: 1.00, label: "> 139%" },
  { min: 129, max: 139,      mobile: 3.00, hsd: 3.00, costPer: 2.00, sph: 0.75, label: "129–139%" },
  { min: 118, max: 128.99,   mobile: 2.00, hsd: 2.00, costPer: 1.50, sph: 0.50, label: "118–128.99%" },
  { min: 107, max: 117.99,   mobile: 1.00, hsd: 1.00, costPer: 0.50, sph: 0.25, label: "107–117.99%" },
  { min: 100, max: 106.99,   mobile: 0,    hsd: 0,    costPer: 0,    sph: 0,    label: "100–106.99%" },
  { min: 95,  max: 99.99,    mobile:-1.00, hsd:-1.00, costPer:-0.50, sph:-0.25, label: "95–99.99%" },
  { min: 90,  max: 94.99,    mobile:-2.00, hsd:-2.00, costPer:-1.00, sph:-0.50, label: "90–94.99%" },
  { min: 85,  max: 89.99,    mobile:-3.00, hsd:-3.00, costPer:-2.00, sph:-0.75, label: "85–89.99%" },
  { min: 80,  max: 84.99,    mobile:-4.00, hsd:-4.00, costPer:-2.50, sph:-1.00, label: "80–84.99%" },
  { min: 0,   max: 79.99,    mobile:-5.00, hsd:-5.00, costPer:-3.00, sph:-1.00, label: "< 79.99%" },
];

// Site-level Hour Attainment gate tiers (from the image: 0%, -2%, -4%, -6%)
const HOUR_GATE_SITE_TIERS = [
  { min: 100,   max: Infinity, penalty: 0,     label: "\u2265 100%" },
  { min: 95,    max: 99.99,    penalty: -2.00, label: "95\u201399.99%" },
  { min: 90,    max: 94.99,    penalty: -4.00, label: "90\u201394.99%" },
  { min: 0,     max: 89.99,    penalty: -6.00, label: "< 90%" },
];

function getHourGateTier(pct) {
  if (pct === null || pct === undefined) return null;
  return HOUR_GATE_SITE_TIERS.find(t => pct >= t.min && pct <= t.max) || HOUR_GATE_SITE_TIERS[HOUR_GATE_SITE_TIERS.length - 1];
}

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

// ── Ollama Local AI ──────────────────────────────────────────────────────────
const AI_COLOR = "#0ea5e9"; // teal/cyan accent for AI-generated content

// Session-level cache: survives tab switches, clears on page close
const _aiCache = new Map();
function aiCacheKey(type, jobType, totalGoals) { return `${type}::${jobType}::${totalGoals}`; }
function getAICache(type, jobType, totalGoals) { return _aiCache.get(aiCacheKey(type, jobType, totalGoals)) || null; }
function setAICache(type, jobType, totalGoals, data) { _aiCache.set(aiCacheKey(type, jobType, totalGoals), data); }
function clearAICache(type, jobType, totalGoals) { _aiCache.delete(aiCacheKey(type, jobType, totalGoals)); }

// Concurrency limiter — Ollama handles one request at a time, queue the rest
const _aiQueue = [];
let _aiRunning = 0;
const AI_CONCURRENCY = 1;

async function ollamaGenerate(prompt, model = "qwen3:8b") {
  // Queue to avoid overwhelming Ollama
  return new Promise((resolve) => {
    const run = async () => {
      _aiRunning++;
      try {
        const res = await fetch("http://localhost:11434/api/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model, prompt, stream: false, options: { temperature: 0.3, num_predict: 1500 } }),
        });
        if (!res.ok) { resolve(null); return; }
        const data = await res.json();
        let text = (data.response || "").trim();
        text = text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
        resolve(text || null);
      } catch { resolve(null); }
      finally {
        _aiRunning--;
        if (_aiQueue.length > 0) _aiQueue.shift()();
      }
    };
    if (_aiRunning < AI_CONCURRENCY) run();
    else _aiQueue.push(run);
  });
}

function buildAIPrompt(type, data) {
  const { jobType, uniqueAgentCount, totalHours, totalGoals, gph, attainment, planGoals, actGoals,
    distUnique, q1Agents, q4Agents, regions, healthScore, totalNewXI, totalXmLines,
    newHiresInProgram, fiscalInfo, totalRgu, sphActual, sphGoal } = data;
  const elapsed = fiscalInfo ? `${fiscalInfo.pctElapsed.toFixed(1)}%` : "unknown";
  const daysLeft = fiscalInfo ? fiscalInfo.remainingBDays : "unknown";
  const elapsedDays = fiscalInfo ? fiscalInfo.elapsedBDays : 0;
  const totalDays = fiscalInfo ? fiscalInfo.totalBDays : 0;

  // Pacing analysis
  let pacingStr = "unknown";
  let projectedHomes = null, requiredDaily = null, currentDaily = null;
  if (fiscalInfo && attainment !== null && fiscalInfo.pctElapsed > 0 && planGoals) {
    const pace = calcPacing(actGoals, planGoals, fiscalInfo.elapsedBDays, fiscalInfo.totalBDays);
    if (pace) {
      pacingStr = pace.projectedPct >= 100 ? "AHEAD of pace" : pace.projectedPct >= 85 ? "NEAR pace" : "BEHIND pace";
      projectedHomes = pace.projected;
      requiredDaily = pace.requiredDaily;
      currentDaily = pace.dailyRate;
    }
  }

  // Detailed agent breakdown
  const totalAgents = uniqueAgentCount || 0;
  const q1n = distUnique?.Q1 || 0, q2n = distUnique?.Q2 || 0, q3n = distUnique?.Q3 || 0, q4n = distUnique?.Q4 || 0;
  const q1pct = totalAgents > 0 ? Math.round((q1n / totalAgents) * 100) : 0;
  const q4pct = totalAgents > 0 ? Math.round((q4n / totalAgents) * 100) : 0;

  // Top performers with full detail
  const topPerf = (q1Agents || []).filter(a => a.hours >= getMinHours()).slice(0, 5)
    .map(a => `${a.agentName}: ${a.goals} sales, ${a.hours.toFixed(0)}hrs, ${(a.goals/Math.max(a.hours,1)).toFixed(3)} GPH, ${Math.round(a.pctToGoal||0)}% to goal`).join("\n  ");

  // Risk agents with full detail
  const riskAgents = (q4Agents || []).filter(a => a.hours >= getMinHours()).slice(0, 5)
    .map(a => `${a.agentName}: ${a.goals} sales, ${a.hours.toFixed(0)}hrs, ${mbrSiteName(a.region)||"unknown"} site`).join("\n  ");

  // Q3 bubble agents close to Q2
  const q3Agents = data.q3Agents || [];
  const bubbleAgents = q3Agents.filter(a => a.hours >= getMinHours() && a.pctToGoal >= 60).slice(0, 3)
    .map(a => `${a.agentName}: ${Math.round(a.pctToGoal)}% to goal, ${a.hours.toFixed(0)}hrs`).join("; ");

  // Site comparison
  const siteData = (regions || []).map(r => {
    const gap = r.avgPct !== undefined ? `${Math.round(r.avgPct)}% avg to goal` : "";
    return `${mbrSiteName(r.name)}: ${r.count || "?"} agents, ${gap}`;
  }).join("\n  ");

  // New hires detail
  const nhList = (newHiresInProgram || []).slice(0, 5).map(a =>
    `${a.agentName}: ${a.quartile}, ${a.hours?.toFixed(0)||0}hrs, ${a.goals||0} sales`).join("; ");

  // Product mix
  const productMix = [];
  if (totalNewXI) productMix.push(`HSD: ${totalNewXI}`);
  if (totalXmLines) productMix.push(`XM: ${totalXmLines}`);
  if (totalRgu) productMix.push(`RGU: ${totalRgu}`);
  const hsdPerSale = totalGoals > 0 && totalNewXI ? (totalNewXI / totalGoals).toFixed(2) : null;
  const xmPerSale = totalGoals > 0 && totalXmLines ? (totalXmLines / totalGoals).toFixed(2) : null;

  const context = `PROGRAM: ${jobType}
═══════════════════════════════
WORKFORCE: ${totalAgents} agents | ${totalHours?.toFixed(0) || 0} total hours | ${totalGoals || 0} total sales | ${gph?.toFixed(3) || "0"} GPH
GOAL: ${actGoals || 0} of ${planGoals || "no plan"} homes | Attainment: ${attainment !== null ? Math.round(attainment) + "%" : "N/A"}
${sphActual ? `SPH: ${sphActual.toFixed(3)} actual vs ${sphGoal?.toFixed(3) || "?"} goal` : ""}

PACING (day ${elapsedDays} of ${totalDays}, month ${elapsed} elapsed, ${daysLeft} biz days left):
  Status: ${pacingStr}
  Current daily rate: ${currentDaily ? currentDaily.toFixed(1) : "?"} homes/day
  Required daily rate: ${requiredDaily ? requiredDaily.toFixed(1) : "?"} homes/day
  Projected EOM: ${projectedHomes !== null ? projectedHomes + " homes" : "N/A"}

QUARTILE DISTRIBUTION:
  Q1 (≥100%): ${q1n} agents (${q1pct}% of workforce)
  Q2 (80-99%): ${q2n} agents
  Q3 (1-79%): ${q3n} agents
  Q4 (0%): ${q4n} agents (${q4pct}% of workforce)
  Health Score: ${healthScore ? Math.round(healthScore) : "N/A"}/100

TOP PERFORMERS (Q1, ${getMinHours()}+ hrs):
  ${topPerf || "None yet"}

RISK AGENTS (Q4, ${getMinHours()}+ hrs, zero sales):
  ${riskAgents || "None"}

${bubbleAgents ? `BUBBLE AGENTS (Q3, close to Q2 threshold):\n  ${bubbleAgents}` : ""}

SITES:
  ${siteData || "Single site"}

${(newHiresInProgram || []).length > 0 ? `NEW HIRES (${(newHiresInProgram||[]).length}):\n  ${nhList}` : ""}

PRODUCT MIX: ${productMix.join(" | ") || "N/A"}${hsdPerSale ? `\n  HSD/sale: ${hsdPerSale}` : ""}${xmPerSale ? ` | XM/sale: ${xmPerSale}` : ""}`;

  const sysPrompt = `/no_think\nYou are a senior telesales operations analyst at a cable/telecom company. You analyze agent performance data for door-to-door and telesales programs selling Xfinity services (internet/HSD, mobile, video, phone). Your audience is the program manager who makes daily coaching decisions.\n\nRULES:\n- Every claim must reference a specific number from the data\n- Name specific agents when relevant\n- Compare rates and ratios, not just raw counts\n- Identify the WHY behind patterns, not just the WHAT\n- Be direct — no filler phrases like "it's worth noting" or "interestingly"\n- No markdown formatting, no bullet points, no headers\n`;

  if (type === "narrative") {
    return `${sysPrompt}\nWrite a 4-6 paragraph executive summary. Start with pacing status and projected finish. Then cover workforce composition and what the quartile distribution signals. Address specific coaching priorities by agent name. End with the single most impactful action for the remaining ${daysLeft} business days.\n\nData:\n${context}`;
  }
  if (type === "wins") {
    return `${sysPrompt}\nIdentify 3-5 specific wins from this data. Each must name an agent, a number, or a rate. Focus on: conversion efficiency, pacing momentum, product mix strength, new hire ramp speed, or site-level standouts. One sentence per win. No generic praise.\n\nData:\n${context}\n\nWins (one per line):`;
  }
  if (type === "opps") {
    return `${sysPrompt}\nIdentify 3-5 specific opportunities. Each must name an agent or a gap, and prescribe a concrete next-day action (not "consider" or "review" — tell the manager exactly what to do). Focus on: Q4 agents with hours, Q3 agents near Q2 threshold, product attach gaps, site parity issues, pacing shortfalls. One sentence per opportunity.\n\nData:\n${context}\n\nOpportunities (one per line):`;
  }
  // MoM comparison — includes extra prior month context
  if (data.prevGoals !== undefined) {
    const momCtx = `\nMONTH-OVER-MONTH COMPARISON:
  Prior month agents: ${data.prevAgents || "?"}  |  Current month agents: ${data.uniqueAgentCount || "?"}
  Prior month sales: ${data.prevGoals || 0}  |  Current month sales: ${data.totalGoals || 0}  (${(data.totalGoals||0) - (data.prevGoals||0) >= 0 ? "+" : ""}${(data.totalGoals||0) - (data.prevGoals||0)})
  Prior month hours: ${data.prevHours ? data.prevHours.toFixed(0) : "?"}  |  Current month hours: ${data.totalHours ? data.totalHours.toFixed(0) : "?"}
  Prior GPH: ${data.prevGph ? data.prevGph.toFixed(3) : "?"}  |  Current GPH: ${data.gph ? data.gph.toFixed(3) : "?"}
  Avg delta % to goal: ${data.avgDelta !== undefined ? (data.avgDelta >= 0 ? "+" : "") + data.avgDelta.toFixed(1) + "%" : "?"}
  Agents improved: ${data.improvedCount || 0}  |  Agents declined: ${data.declinedCount || 0}
  Top improvers: ${(data.topMovers || []).filter(a => a.delta > 0).slice(0, 3).map(a => `${a.name} (+${a.delta.toFixed(1)}%)`).join(", ") || "none"}
  Biggest declines: ${(data.bottomMovers || []).filter(a => a.delta < 0).slice(0, 3).map(a => `${a.name} (${a.delta.toFixed(1)}%)`).join(", ") || "none"}`;
    return `${sysPrompt}\nWrite a 4-6 paragraph month-over-month executive summary. Compare prior vs current month performance. Identify what changed and why — agent count shifts, conversion rate changes, hours utilization. Name specific agents who drove improvement or decline. Assess whether the trend is sustainable. End with 1-2 specific actions for the program manager.\n\nData:\n${context}${momCtx}`;
  }

  // business overview
  return `${sysPrompt}\nWrite a 4-6 paragraph business-wide executive summary for leadership. Cover: overall pacing and projected finish across all programs, which programs are driving vs dragging performance, workforce utilization (agents with hours vs at threshold), and the top 2-3 actions that would move the needle most in the remaining ${daysLeft} business days.\n\nData:\n${context}`;
}

// ── AI Prefetch Engine ───────────────────────────────────────────────────────
// Fires all AI generations at once when localAI is toggled on.
// Results land in _aiCache; components just read from cache.
function prefetchAI(promptDataList) {
  const tasks = [];
  for (const { type, data } of promptDataList) {
    const key = aiCacheKey(type, data.jobType, data.totalGoals);
    if (_aiCache.has(key)) continue; // already cached
    const prompt = buildAIPrompt(type, data);
    const task = ollamaGenerate(prompt).then(result => {
      if (result) {
        if (type === "narrative") {
          setAICache(type, data.jobType, data.totalGoals, result.split(/\n\n+/).filter(l => l.trim()));
        } else {
          const items = result.split(/\n/).filter(l => l.trim()).map(l => l.replace(/^[\d\-\.\*\)]+\s*/, "").trim()).filter(Boolean);
          setAICache(type, data.jobType, data.totalGoals, items);
        }
      }
    });
    tasks.push(task);
  }
  return tasks;
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
const DEFAULT_PRIOR_SHEET_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vTZkBGVIxieyjBKftqL1oecSaUxRkao-gz2B9q4Z8zCY8hEtSy1M28S00RDCS8JVPgPFXJAv2LbsZru/pub?gid=667346347&single=true&output=csv";
const DEFAULT_PRIOR_GOALS_SHEET_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vTZkBGVIxieyjBKftqL1oecSaUxRkao-gz2B9q4Z8zCY8hEtSy1M28S00RDCS8JVPgPFXJAv2LbsZru/pub?gid=1685208822&single=true&output=csv";
const DEFAULT_TNPS_SHEET_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vRagC_XDSQ84y25onmWs6MUOZcEdWZNA6fVRRDFUzNWQp3ginYLtOIQsSrwmbAERkOJ-daTvbHqEtoy/pub?gid=2128252142&single=true&output=csv";
const DEFAULT_CORP_COACHING_DETAILS_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vRagC_XDSQ84y25onmWs6MUOZcEdWZNA6fVRRDFUzNWQp3ginYLtOIQsSrwmbAERkOJ-daTvbHqEtoy/pub?gid=875297648&single=true&output=csv";
const DEFAULT_CORP_COACHING_WEEKLY_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vRagC_XDSQ84y25onmWs6MUOZcEdWZNA6fVRRDFUzNWQp3ginYLtOIQsSrwmbAERkOJ-daTvbHqEtoy/pub?gid=671384384&single=true&output=csv";
const DEFAULT_CORP_LOGIN_BUCKETS_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vRagC_XDSQ84y25onmWs6MUOZcEdWZNA6fVRRDFUzNWQp3ginYLtOIQsSrwmbAERkOJ-daTvbHqEtoy/pub?gid=583266390&single=true&output=csv";
const DEFAULT_CORP_PRIOR_QUARTER_AGENT_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vTq4wsNJmMf82DO5PWH0reYQE3I_8-NW8YAuav1z5zbs753xJSATuCesxDif_ZVFTj4YjQL_k77y_Sf/pub?gid=31959038&single=true&output=csv";
const DEFAULT_CORP_PRIOR_QUARTER_GOALS_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vTq4wsNJmMf82DO5PWH0reYQE3I_8-NW8YAuav1z5zbs753xJSATuCesxDif_ZVFTj4YjQL_k77y_Sf/pub?gid=1361915394&single=true&output=csv";
const DEFAULT_CORP_PRIOR_MONTH_AGENT_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vQRwJCdrvxQZPM78VX1jKEXjnn5C1yUGQ-dMPXXZ6KYotmkU7W_IZZi1i8IZ_CHBV4MdkYqH_KCptul/pub?gid=667346347&single=true&output=csv";
const DEFAULT_CORP_PRIOR_MONTH_GOALS_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vQRwJCdrvxQZPM78VX1jKEXjnn5C1yUGQ-dMPXXZ6KYotmkU7W_IZZi1i8IZ_CHBV4MdkYqH_KCptul/pub?gid=112805420&single=true&output=csv";
const TNPS_STORAGE_KEY = "perf_intel_tnps_v1";


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

// ── BP→Agent Lookup from roster ───────────────────────────────────────────────
function buildBpLookup(rosterRows = []) {
  const map = {};
  for (const row of rosterRows) {
    const bp = (row["BP"] || "").trim().toLowerCase();
    if (!bp) continue;
    const first = (row["First Name"] || row["First"] || "").trim();
    const last  = (row["Last Name"]  || row["Last"]  || "").trim();
    const name  = [first, last].filter(Boolean).join(" ");
    if (!name) continue;
    const endDate = (row["End Date"] || row["EndDate"] || "").trim();
    if (endDate) continue; // skip inactive
    map[bp] = {
      name,
      firstName: first,
      lastName: last,
      supervisor: (row["Supervisor Name"] || row["Supervisor"] || "").trim(),
      region: (row["Region"] || "").trim(),
      hireDate: (row["Hire Date"] || row["StartDate"] || "").trim(),
      role: (row["Role"] || "").trim(),
    };
  }
  return map;
}

// ── tNPS Site Mapping ─────────────────────────────────────────────────────────
const TNPS_SITE_MAP = {
  "Global Callcenter Solutions Belize": "Belize City",
  "Global Callcenter Solutions Ignaco": "San Ignacio",
  "Global Callcenter Solutions Santo Domingo": "Dom. Republic",
};
const TNPS_PARTNER_MAP = {
  "Avantive Solutions Guadalajara": "Avantive",
  "Avantive Solutions Mexico City": "Avantive",
  "Global Telesourcing Monterrey": "Global Telesourcing",
  "iGuard Global Telesourcing Monterrey": "Global Telesourcing",
  "Results Alaskaland": "Results",
  "Results Alaskaland Trial": "Results",
  "Results Alaskaland Telesales": "Results",
  "Results Telesales Alaskaland": "Results",
};
function tnpsSiteLabel(rawSite) {
  return TNPS_SITE_MAP[rawSite] || TNPS_PARTNER_MAP[rawSite] || rawSite;
}
function tnpsIsGCS(rawSite) {
  return !!TNPS_SITE_MAP[rawSite];
}

// ── tNPS Campaign → Program mapping ──────────────────────────────────────────
const TNPS_CAMPAIGN_PROGRAM = {
  "Add XM": "XM",
  "Add XMC": "XMC",
  "Non Subs": "Nonsub",
};
function tnpsCampaignLabel(raw) {
  return (raw || "").trim() || "Untagged";
}
function tnpsCampaignProgram(raw) {
  return TNPS_CAMPAIGN_PROGRAM[(raw || "").trim()] || null;
}

// ── tNPS Survey Parser ────────────────────────────────────────────────────────
function parseTnps(rows = [], bpLookup = {}) {
  return rows.map(row => {
    const score = parseFloat(row["SMS tNPS"]);
    if (isNaN(score)) return null;

    const rawSite    = (row["Site"] || "").trim();
    const rawCampaign = (row["Telesales Outcome Category"] || row["Telesales Campaign"] || "").trim();
    const ntid       = (row["Employee NTID"] || "").trim().toLowerCase();
    const dateStr    = (row["Response Date"] || row["Transaction Date"] || "").trim();

    // Parse date — format: "3/20/2026 14:34"
    const dateParsed = dateStr ? new Date(dateStr) : null;
    // Fiscal month: 22nd starts next month's fiscal period (matches 22nd→21st cycle)
    let month = null, monthLabel = "Unknown";
    if (dateParsed && !isNaN(dateParsed)) {
      let fm = dateParsed.getMonth(), fy = dateParsed.getFullYear();
      if (dateParsed.getDate() >= 22) { fm++; if (fm > 11) { fm = 0; fy++; } }
      month = `${fy}-${String(fm + 1).padStart(2, "0")}`;
      monthLabel = new Date(fy, fm, 1).toLocaleString("en-US", { month: "short", year: "numeric" });
    }

    // Classification
    const category = score >= 9 ? "promoter" : score >= 7 ? "passive" : "detractor";
    const isGCS    = tnpsIsGCS(rawSite);
    const siteLabel = tnpsSiteLabel(rawSite);

    // Agent lookup
    const agent = bpLookup[ntid] || null;

    return {
      score,
      category,
      rawSite,
      siteLabel,
      isGCS,
      campaign: tnpsCampaignLabel(rawCampaign),
      program: tnpsCampaignProgram(rawCampaign),
      ntid,
      agentName: agent ? agent.name : ntid || "Unknown",
      supervisor: agent ? agent.supervisor : "",
      region: agent ? agent.region : "",
      date: dateParsed,
      dateStr,
      month,
      monthLabel,
      reason: (row["Reason for score"] || "").trim(),
      repSat: parseFloat(row["Rep Sat"]) || null,
      topics: (row["Topics Tagged Original"] || "").trim(),
      alertType: (row["Alert type"] || "").trim(),
      alertStatus: (row["Alert Status"] || row["Alert Closure Status"] || "").trim(),
    };
  }).filter(Boolean);
}

// ── tNPS Score Calculator ─────────────────────────────────────────────────────
function calcTnpsScore(surveys) {
  if (!surveys || surveys.length === 0) return { score: null, promoters: 0, passives: 0, detractors: 0, total: 0, promoterPct: 0, passivePct: 0, detractorPct: 0 };
  const promoters  = surveys.filter(s => s.category === "promoter").length;
  const passives   = surveys.filter(s => s.category === "passive").length;
  const detractors = surveys.filter(s => s.category === "detractor").length;
  const total = surveys.length;
  const promoterPct  = (promoters / total) * 100;
  const passivePct   = (passives / total) * 100;
  const detractorPct = (detractors / total) * 100;
  return {
    score: Math.round(promoterPct - detractorPct),
    promoters, passives, detractors, total,
    promoterPct, passivePct, detractorPct,
  };
}

function tnpsColor(score) {
  if (score === null) return "var(--text-dim)";
  if (score >= 50) return "#16a34a";
  if (score >= 20) return "#d97706";
  return "#dc2626";
}

// ── tNPS fiscal month filter ──────────────────────────────────────────────────
function tnpsFiscalFilter(surveys, fiscalInfo) {
  if (!fiscalInfo || !surveys || surveys.length === 0) return surveys;
  // Parse fiscal start/end as local dates to match tNPS Date objects
  const [sy, sm, sd] = fiscalInfo.fiscalStart.split("-").map(Number);
  const [ey, em, ed] = fiscalInfo.fiscalEnd.split("-").map(Number);
  const start = new Date(sy, sm - 1, sd, 0, 0, 0, 0);
  const end = new Date(ey, em - 1, ed, 23, 59, 59, 999);
  return surveys.filter(s => s.date && s.date >= start && s.date <= end);
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

// Global hours threshold — configurable, with auto-scaling based on fiscal elapsed days
// Default full-month threshold: 16 hours. Auto mode scales proportionally.
const HOURS_THRESHOLD_KEY = "perf_intel_hours_threshold";
const HOURS_AUTO_KEY      = "perf_intel_hours_auto";
let _hoursThreshold = 16;
let _hoursAutoScale = true;
try {
  const stored = localStorage.getItem(HOURS_THRESHOLD_KEY);
  if (stored) _hoursThreshold = parseFloat(stored);
  const auto = localStorage.getItem(HOURS_AUTO_KEY);
  if (auto !== null) _hoursAutoScale = auto === "true";
} catch(e) {}

function computeEffectiveThreshold(baseThreshold, fiscalInfo, autoScale) {
  if (!autoScale || !fiscalInfo || !fiscalInfo.totalBDays || !fiscalInfo.elapsedBDays) return baseThreshold;
  // Scale: on day 1 of 22, threshold = 16*(1/22) ≈ 0.7 hrs. By day 11, ~8 hrs. Full month = 16.
  const ratio = fiscalInfo.elapsedBDays / fiscalInfo.totalBDays;
  return Math.max(1, Math.round(baseThreshold * ratio * 10) / 10);
}

// These are the selectors used throughout — they reference the global threshold
const getMinHours = () => _hoursThreshold;
const selectQualified   = agents => agents.filter(a => a.hours >= _hoursThreshold);
const selectQ1          = agents => agents.filter(a => a.quartile === "Q1");
const selectQ2          = agents => agents.filter(a => a.quartile === "Q2");
const selectQ3          = agents => agents.filter(a => a.quartile === "Q3");
const selectQ4          = agents => agents.filter(a => a.quartile === "Q4");
const selectActive      = agents => agents.filter(a => a.hours > 0 && a.hours < _hoursThreshold);
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

// Filter goalEntries down to a single site's plan rows. Used when building a
// site-scoped program so attainment is site-actual ÷ site-plan, not vs combined.
function filterGoalEntriesBySite(goalEntries, siteKey) {
  return (goalEntries || []).map(entry => ({
    targetAudience: entry.targetAudience,
    siteMap: entry.siteMap && entry.siteMap[siteKey] ? { [siteKey]: entry.siteMap[siteKey] } : {},
  }));
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

  const qualified = uniqueAgents.filter(a => a.hours >= getMinHours());
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
  const worstAgent = q4.filter(a => a.hours >= getMinHours())[0] || q4[0] || null;

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
  const q1Qual = q1Agents.filter(a => a.hours >= getMinHours());
  const q2Qual = q2Agents.filter(a => a.hours >= getMinHours());
  const results = [];

  if (q1Qual.length === 0 && q2Qual.length === 0) {
    return [insight("win", "low", "performance",
      `No top-tier performers with ${getMinHours()}+ hours in this program yet. Focus energy on getting more agents to the ${getMinHours()}-hour threshold while moving Q3 agents toward the 80% goal mark.`)];
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
      `${q1Qual.length} agents with ${getMinHours()}+ hours are exceeding 100% of goal, including ${names}. This concentration signals a healthy program culture. Leverage these agents to lead small-group huddles — peer coaching at this level is consistently more effective than top-down training.`));
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
      `${mbrSiteName(top.name)} leads all sites at ${fmtPct(top.avgPct)} avg to goal. ${parseFloat(gap) > 15
        ? `A ${gap}% gap vs. the lowest site suggests meaningful process or coaching differences worth investigating.`
        : "Regional performance is relatively consistent, reflecting well on program-wide alignment."}`));
  }

  // Top GPH among 16+ hr agents only — excludes low-volume outliers
  const topGPH = [...qualified].filter(a => a.hours >= getMinHours() && a.goals > 0).sort((a, b) => (b.goals/b.hours) - (a.goals/a.hours))[0];
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
  const q3Qual = q3Agents.filter(a => a.hours >= getMinHours());
  const q4Qual = q4Agents.filter(a => a.hours >= getMinHours());
  const results = [];

  const highHoursLow = qualified.filter(a => a.pctToGoal < 50);
  // under16: unique agents with hours logged but not yet qualified
  const under16     = collapseToUniqueAgents(agents).filter(a => a.hours > 0 && a.hours < getMinHours());
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
      `${q4Qual.length} agent${q4Qual.length > 1 ? "s" : ""} with ${getMinHours()}+ hours recorded 0% to goal — zero conversions across ${fmt(totalHrs, 0)} invested hours: ${names}${q4Qual.length > 3 ? `, plus ${q4Qual.length - 3} more` : ""}. Pull call recordings within 24 hours and assess pitch delivery, product knowledge, and attendance consistency.`));
  }

  if (q3Qual.length > 0) {
    // True weighted average: total goals / total prorated goals
    const totGoals    = q3Qual.reduce((s, a) => s + a.goals, 0);
    const totGoalsNum = q3Qual.reduce((s, a) => s + (a.goalsNum || 0), 0);
    const avgPct  = totGoalsNum > 0 ? ((totGoals / totGoalsNum) * 100).toFixed(1) : "—";
    const totalHrs = q3Qual.reduce((s, a) => s + a.hours, 0);
    const lowestQ3 = [...q3Qual].sort((a, b) => a.pctToGoal - b.pctToGoal)[0];
    results.push(insight("opp", "high", "coaching",
      `${q3Qual.length} agents with ${getMinHours()}+ hours in Q3 averaging ${avgPct}% to goal across ${fmt(totalHrs, 0)} total hours. ${lowestQ3.agentName} is furthest from the 80% threshold at ${Math.round(lowestQ3.pctToGoal)}%. Close-rate improvement is the coaching priority.`));
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
      `${under16.length} agents are contributing hours but haven't hit the ${getMinHours()}-hour threshold (avg ${avgHrs} hrs, ${fmt(totalHrs, 0)} hrs total). Review scheduling constraints — if even half reached ${getMinHours()} hours, goal impact would be significant.`));
  }

  if (newHireOpps.length > 0) {
    const names = newHireOpps.map(a => a.agentName).join(", ");
    results.push(insight("opp", "medium", "coaching",
      `New hire${newHireOpps.length > 1 ? "s" : ""} ${names} have logged ${getMinHours()}+ hours but are in lower tiers. Don't benchmark against tenured staff — track weekly trajectory. Escalate to a formal support plan if not trending upward by week 6–8.`));
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
  const elapsed = fiscalInfo ? `${fiscalInfo.pctElapsed.toFixed(1)}%` : null;
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
      lines.push(`${mbrSiteName(top.name)} is outperforming ${mbrSiteName(bottom.name)} by ${gap} percentage points (${pct(top.avgPct)} vs ${pct(bottom.avgPct)} avg % to goal). This gap warrants a coaching alignment review between sites.`);
    } else {
      lines.push(`Performance is relatively balanced across sites — ${mbrSiteName(top.name)} leads at ${pct(top.avgPct)} avg with only a ${gap}-point gap to ${mbrSiteName(bottom.name)}.`);
    }
  }

  // ── Top performers ──
  const topQ1 = q1Agents.filter(a => a.hours >= getMinHours()).slice(0, 3);
  if (topQ1.length > 0) {
    const names = topQ1.map(a => `${a.agentName} (${f(a.hours, 0)} hrs, ${f(a.hours > 0 ? a.goals / a.hours : 0, 3)} GPH)`);
    lines.push(`Top performers: ${names.join("; ")}. ${topQ1.length > 1 ? "These agents" : topQ1[0].agentName} should be recognized and their approaches documented for coaching replication.`);
  }

  // ── Risk agents ──
  const highHoursLowPerf = q4Agents.filter(a => a.hours >= getMinHours());
  if (highHoursLowPerf.length > 0) {
    const names = highHoursLowPerf.slice(0, 3).map(a => `${a.agentName} (${f(a.hours, 0)} hrs)`);
    lines.push(`Key risk: ${highHoursLowPerf.length} agent${highHoursLowPerf.length > 1 ? "s" : ""} with ${getMinHours()}+ hours still in Q4 — ${names.join(", ")}. These represent the highest-impact coaching opportunities since they have the volume but not the conversion.`);
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

  // ── Daily rates ──
  if (fiscalInfo && fiscalInfo.elapsedBDays > 0 && program.goalEntry) {
    const dr = (actual, plan, label) => {
      const rate = Math.round(actual / fiscalInfo.elapsedBDays);
      const need = plan && fiscalInfo.totalBDays > 0 ? Math.round(plan / fiscalInfo.totalBDays) : null;
      const status = need ? (rate >= need ? "on pace" : "behind") : "";
      return need ? `${label}: ${rate}/day (need ${need}/day — ${status})` : null;
    };
    const dailyParts = [
      dr(actGoals, planGoals, "Sales"),
      dr(totalNewXI, getPlanForKey(program.goalEntry, "HSD Sell In Goal"), "XI"),
      dr(totalXmLines, getPlanForKey(program.goalEntry, "XM GOAL"), "XM"),
      dr(totalRgu, getPlanForKey(program.goalEntry, "RGU GOAL"), "RGU"),
    ].filter(Boolean);
    if (dailyParts.length > 0) {
      lines.push(`Daily rates — ${dailyParts.join(". ")}.`);
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
  const { programs, globalGoals, planTotal, totalHours, uniqueAgentCount, regions,
    globalNewXI, globalXmLines, globalRgu, globalPlanNewXI, globalPlanXmLines, globalPlanRgu } = perf;
  const lines = [];
  const pct = n => `${Math.round(n)}%`;
  const f = (n, d=1) => Number(n).toFixed(d);

  // Overall status
  const globalAtt = planTotal ? (globalGoals / planTotal) * 100 : null;
  if (globalAtt !== null && fiscalInfo) {
    const pace = globalAtt > (fiscalInfo.pctElapsed * 1.05) ? "ahead of" : globalAtt < (fiscalInfo.pctElapsed * 0.9) ? "behind" : "tracking with";
    lines.push(`Business-wide: ${globalGoals} of ${planTotal} homes sold (${pct(globalAtt)}). ${fiscalInfo.remainingBDays} business days remaining, month is ${fiscalInfo.pctElapsed.toFixed(1)}% elapsed. Operations are ${pace} pace.`);
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
    lines.push(`Dom. Republic: ${drGoals} sales, ${f(drGph, 3)} GPH across ${f(drHrs, 0)} hours. Belize: ${bzGoals} sales, ${f(bzGph, 3)} GPH across ${f(bzHrs, 0)} hours.`);
  }

  // Pacing projection
  if (fiscalInfo && globalAtt !== null && fiscalInfo.pctElapsed > 0) {
    const projected = Math.round(globalGoals / (fiscalInfo.pctElapsed / 100));
    const projPct = planTotal ? Math.round((projected / planTotal) * 100) : null;
    if (projPct !== null) {
      lines.push(`Projected EOM: ${projected} homes (${projPct}% to plan).`);
    }
  }

  // Daily rates — Sales, XI, XM, RGU
  if (fiscalInfo && fiscalInfo.elapsedBDays > 0) {
    const dailyParts = [];
    const dr = (actual, plan, label) => {
      const rate = Math.round(actual / fiscalInfo.elapsedBDays);
      const need = plan && fiscalInfo.totalBDays > 0 ? Math.round(plan / fiscalInfo.totalBDays) : null;
      const status = need ? (rate >= need ? "on pace" : "behind") : "";
      return need ? `${label}: ${rate}/day (need ${need}/day — ${status})` : `${label}: ${rate}/day`;
    };
    if (planTotal) dailyParts.push(dr(globalGoals, planTotal, "Sales"));
    if (globalPlanNewXI) dailyParts.push(dr(globalNewXI, globalPlanNewXI, "XI"));
    if (globalPlanXmLines) dailyParts.push(dr(globalXmLines, globalPlanXmLines, "XM"));
    if (globalPlanRgu) dailyParts.push(dr(globalRgu, globalPlanRgu, "RGU"));
    if (dailyParts.length > 0) {
      lines.push(`Daily rates — ${dailyParts.join(". ")}.`);
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
    .filter(a => a.hours >= getMinHours())
    .sort((a, b) => b.hours - a.hours);

  if (riskAgents.length > 0) {
    const q4Risk = riskAgents.filter(a => a.quartile === "Q4");
    const q3Risk = riskAgents.filter(a => a.quartile === "Q3");
    if (q4Risk.length > 0) {
      const named = q4Risk.slice(0, 5).map(a => `${a.agentName} (${f(a.hours, 0)} hrs, ${f(a.hours > 0 ? a.goals / a.hours : 0, 3)} GPH)`);
      lines.push(`Highest risk — Q4 agents with ${getMinHours()}+ hours: ${named.join("; ")}${q4Risk.length > 5 ? ` and ${q4Risk.length - 5} more` : ""}. These agents have volume but zero conversion — immediate coaching intervention needed.`);
    }
    if (q3Risk.length > 0) {
      const named = q3Risk.slice(0, 3).map(a => `${a.agentName} (${f(a.hours, 0)} hrs, ${a.goals} sales)`);
      lines.push(`Bubble agents — Q3 with ${getMinHours()}+ hours: ${named.join("; ")}${q3Risk.length > 3 ? ` and ${q3Risk.length - 3} more` : ""}. Close to Q2 threshold — targeted coaching could push these over.`);
    }
  }

  // Daily rates — site-level
  if (fiscalInfo && fiscalInfo.elapsedBDays > 0 && goalLookup && sitePlanKey) {
    const siteXI = agents.reduce((s, a) => s + a.newXI, 0);
    const siteXM = agents.reduce((s, a) => s + a.xmLines, 0);
    const siteRGU = agents.reduce((s, a) => s + a.rgu, 0);
    let planHomes = 0, planXI = 0, planXM = 0, planRGU = 0;
    Object.values(goalLookup.byTA || {}).forEach(siteMap => {
      (siteMap[sitePlanKey] || []).forEach(r => {
        const p = computePlanRow(r);
        planHomes += p.homesGoal; planXI += p.hsdGoal; planXM += p.xmGoal; planRGU += p.rguGoal;
      });
    });
    const dr = (actual, plan, label) => {
      const rate = Math.round(actual / fiscalInfo.elapsedBDays);
      const need = plan && fiscalInfo.totalBDays > 0 ? Math.round(plan / fiscalInfo.totalBDays) : null;
      const status = need ? (rate >= need ? "on pace" : "behind") : "";
      return need ? `${label}: ${rate}/day (need ${need}/day — ${status})` : null;
    };
    const dailyParts = [
      dr(totalG, planHomes, "Sales"),
      dr(siteXI, planXI, "XI"),
      dr(siteXM, planXM, "XM"),
      dr(siteRGU, planRGU, "RGU"),
    ].filter(Boolean);
    if (dailyParts.length > 0) {
      lines.push(`Daily rates — ${dailyParts.join(". ")}.`);
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
      return q === "Q4" && totalH >= getMinHours();
    });
    return { ...s, count, gph, trending, weeklyGph, q4heavy, weekKeys };
  }).filter(s => s.name !== "Unknown").sort((a, b) => b.gph - a.gph);

  if (sups.length === 0) return lines;

  // 1. Coaching efficiency — which sups have the most wasted hours (Q4 agents with high volume)
  const coachingDrain = [...sups].sort((a, b) => b.q4heavy.length - a.q4heavy.length).filter(s => s.q4heavy.length > 0);
  if (coachingDrain.length > 0) {
    const worst = coachingDrain[0];
    lines.push(`Coaching priority: ${worst.name}'s team has ${worst.q4heavy.length} Q4 agent${worst.q4heavy.length > 1 ? "s" : ""} with ${getMinHours()}+ hours (${worst.q4heavy.slice(0, 3).join(", ")}${worst.q4heavy.length > 3 ? "..." : ""}). These agents are producing volume without conversion — the highest-ROI coaching opportunity.`);
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
  const under16All    = collapseToUniqueAgents(allAgents).filter(a => a.hours > 0 && a.hours < getMinHours());
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
      `${mbrSiteName(topRegion.name)} is the top-performing region with ${topRegion.totalGoals.toLocaleString()} total goals and ${topRegion.uniqueQ1} Q1 agents out of ${topRegion.uniqueAgents}. Worth investigating for replicable process advantages.`));
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
  const allQ4Qualified = programs.flatMap(p => p.q4Agents.filter(a => a.hours >= getMinHours()));
  const uniqueQ4Names  = new Set(allQ4Qualified.map(a => a.agentName).filter(Boolean));
  if (uniqueQ4Names.size > 0) {
    results.push(insight("opp", "high", "coaching",
      `${uniqueQ4Names.size} unique agent${uniqueQ4Names.size > 1 ? "s" : ""} across the business recorded zero conversions with ${getMinHours()}+ hours invested. These represent the most urgent individual coaching cases.`));
  }

  if (lowProg && (lowProg.attainment ?? lowProg.healthScore) < 80) {
    const metric = lowProg.attainment !== null
      ? `${Math.round(lowProg.attainment)}% of plan`
      : `${lowProg.q4Agents.filter(a => a.hours >= getMinHours()).length} Q4 agents`;
    results.push(insight("opp", "high", "performance",
      `${lowProg.jobType} is the lowest-performing program at ${metric} with ${lowProg.uniqueAgentCount} agents. A targeted recovery plan is needed — not just routine coaching cadence.`));
  }

  if (regions.length > 1 && topRegion && lowRegion && lowRegion.avgPct < topRegion.avgPct - 15) {
    results.push(insight("opp", "medium", "regional",
      `${mbrSiteName(lowRegion.name)} is lagging all other regions — a significant gap vs. the top site. Regional coaching alignment and a process audit are warranted.`));
  }

  if (under16All.length >= 15) {
    const hrs = under16All.reduce((s, a) => s + a.hours, 0);
    results.push(insight("opp", "medium", "volume",
      `${under16All.length} agents across the business are contributing hours but remain under the ${getMinHours()}-hour threshold, representing ${fmt(hrs, 0)} hours of potential production not fully activated.`));
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

function usePerformanceEngine({ rawData, goalsRaw, newHiresRaw, tnpsRaw }) {
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

  const bpLookup = useMemo(() =>
    buildBpLookup(newHiresRaw || []),
    [newHiresRaw]);

  const tnpsData = useMemo(() =>
    parseTnps(tnpsRaw || [], bpLookup),
    [tnpsRaw, bpLookup]);

  // tNPS aggregates for GCS only
  const tnpsGCS = useMemo(() => tnpsData.filter(s => s.isGCS), [tnpsData]);
  const tnpsOverall = useMemo(() => calcTnpsScore(tnpsGCS), [tnpsGCS]);

  // tNPS by site (GCS sites + partner companies)
  const tnpsBySite = useMemo(() => {
    const groups = {};
    tnpsData.forEach(s => {
      if (!groups[s.siteLabel]) groups[s.siteLabel] = [];
      groups[s.siteLabel].push(s);
    });
    return Object.entries(groups).map(([label, surveys]) => ({
      label,
      isGCS: surveys[0].isGCS,
      ...calcTnpsScore(surveys),
    })).sort((a, b) => (b.score ?? -999) - (a.score ?? -999));
  }, [tnpsData]);

  // tNPS by month (GCS only, for trending)
  const tnpsByMonth = useMemo(() => {
    const groups = {};
    tnpsGCS.forEach(s => {
      if (!s.month) return;
      if (!groups[s.month]) groups[s.month] = { month: s.month, label: s.monthLabel, surveys: [] };
      groups[s.month].surveys.push(s);
    });
    return Object.values(groups)
      .sort((a, b) => a.month.localeCompare(b.month))
      .map(g => ({ ...g, ...calcTnpsScore(g.surveys) }));
  }, [tnpsGCS]);

  // Per-agent tNPS lookup (keyed by normalized agent name)
  const tnpsByAgent = useMemo(() => {
    const map = {};
    tnpsGCS.forEach(s => {
      const key = s.agentName.toLowerCase();
      if (!map[key]) map[key] = [];
      map[key].push(s);
    });
    const result = {};
    Object.entries(map).forEach(([key, surveys]) => {
      result[key] = { surveys, ...calcTnpsScore(surveys) };
    });
    return result;
  }, [tnpsGCS]);

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
    tnpsData,
    tnpsGCS,
    tnpsOverall,
    tnpsBySite,
    tnpsByMonth,
    tnpsByAgent,
    bpLookup,
  };
}


// ══════════════════════════════════════════════════════════════════════════════
// SECTION 9 — UI COMPONENTS  (components/)
// Pure presentation. No heavy computation. Consume pre-built data only.
// ══════════════════════════════════════════════════════════════════════════════

// ── Collapsible Narrative Panel ───────────────────────────────────────────────
function CollapsibleNarrative({ title = "Executive Summary", lines = [], defaultOpen = false, aiEnabled = false, aiPromptData = null }) {
  const [open, setOpen] = useState(defaultOpen);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState(false);
  const [, forceUpdate] = useState(0);

  // Read from session cache on every render
  const aiLines = aiPromptData ? getAICache("narrative", aiPromptData.jobType, aiPromptData.totalGoals) : null;

  // Poll cache periodically while waiting for prefetch
  useEffect(() => {
    if (!aiEnabled || aiLines || !aiPromptData) return;
    setAiLoading(true);
    const interval = setInterval(() => {
      const cached = getAICache("narrative", aiPromptData.jobType, aiPromptData.totalGoals);
      if (cached) { setAiLoading(false); forceUpdate(v => v + 1); clearInterval(interval); }
    }, 500);
    // Timeout after 90s — fallback to direct generation
    const timeout = setTimeout(() => {
      clearInterval(interval);
      if (getAICache("narrative", aiPromptData.jobType, aiPromptData.totalGoals)) { setAiLoading(false); forceUpdate(v => v + 1); return; }
      // Direct generate as fallback
      const prompt = buildAIPrompt("narrative", aiPromptData);
      ollamaGenerate(prompt).then(result => {
        if (result) {
          setAICache("narrative", aiPromptData.jobType, aiPromptData.totalGoals, result.split(/\n\n+/).filter(l => l.trim()));
        } else { setAiError(true); }
        setAiLoading(false);
        forceUpdate(v => v + 1);
      });
    }, 90000);
    return () => { clearInterval(interval); clearTimeout(timeout); };
  }, [aiEnabled, aiPromptData?.jobType, aiPromptData?.totalGoals]);

  const displayLines = aiEnabled && aiLines ? aiLines : lines;
  if ((!displayLines || displayLines.length === 0) && !aiLoading) return null;

  return (
    <div style={{ background: `var(--glass-bg)`, backdropFilter: "blur(12px) saturate(150%)", WebkitBackdropFilter: "blur(12px) saturate(150%)", border: `1px solid ${aiEnabled ? AI_COLOR + "20" : "var(--glass-border)"}`, borderRadius: "var(--radius-lg, 16px)", boxShadow: `var(--card-glow)` }}>
      <div onClick={() => setOpen(v => !v)}
        style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "1rem 1.5rem", cursor: "pointer", userSelect: "none" }}>
        <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.72rem", color: aiEnabled ? AI_COLOR : `var(--text-muted)`, letterSpacing: "0.1em", textTransform: "uppercase", fontWeight: 600 }}>
          {aiEnabled ? "AI " : ""}{title}
        </div>
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
          {aiEnabled && aiLines && (
            <button onClick={e => { e.stopPropagation(); clearAICache("narrative", aiPromptData.jobType, aiPromptData.totalGoals); forceUpdate(v => v + 1); }}
              style={{ background: AI_COLOR + "10", border: `1px solid ${AI_COLOR}30`, borderRadius: "var(--radius-sm, 6px)", color: AI_COLOR, padding: "0.2rem 0.55rem", fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.68rem", cursor: "pointer", fontWeight: 500 }}>
              Regen
            </button>
          )}
          <button onClick={e => { e.stopPropagation(); navigator.clipboard?.writeText(displayLines.join("\n\n")); }}
            style={{ background: "transparent", border: "1px solid var(--border-muted)", borderRadius: "var(--radius-sm, 6px)", color: `var(--text-faint)`, padding: "0.2rem 0.55rem", fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.68rem", cursor: "pointer", fontWeight: 500 }}>
            Copy
          </button>
          <span style={{ fontSize: "0.75rem", color: `var(--text-faint)`, transition: "transform 0.25s cubic-bezier(0.4,0,0.2,1)", transform: open ? "rotate(180deg)" : "rotate(0deg)", display: "inline-block" }}>{"\u25BC"}</span>
        </div>
      </div>
      {open && (
        <div style={{ padding: "0 1.5rem 1.25rem", animation: "fadeIn 0.25s ease" }}>
          {aiLoading ? (
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", padding: "0.75rem 0" }}>
              <div style={{ width: "12px", height: "12px", borderRadius: "50%", border: `2px solid ${AI_COLOR}`, borderTopColor: "transparent", animation: "spin 0.8s linear infinite" }} />
              <span style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.85rem", color: AI_COLOR }}>Local AI generating insights...</span>
            </div>
          ) : aiError ? (
            <p style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.85rem", color: "#dc2626" }}>AI generation failed — showing template insights instead.</p>
          ) : null}
          {(!aiLoading) && displayLines.map((para, i) => (
            <p key={i} style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.92rem", color: i === 0 ? `var(--text-warm)` : `var(--text-secondary)`, lineHeight: 1.65, margin: i < displayLines.length - 1 ? "0 0 0.6rem 0" : 0, fontWeight: i === 0 ? 600 : 400 }}>
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
    <div style={{ background: `var(--glass-bg)`, backdropFilter: "blur(12px) saturate(150%)", WebkitBackdropFilter: "blur(12px) saturate(150%)", border: `1px solid ${accent}18`, borderRadius: "var(--radius-lg, 16px)", padding: "1.35rem 1.5rem", borderTop: `3px solid ${accent}`, boxShadow: `var(--card-glow)`, transition: "all 250ms cubic-bezier(0.4,0,0.2,1)" }}>
      <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.75rem", color: `var(--text-muted)`, textTransform: "uppercase", letterSpacing: "0.1em", fontWeight: 600 }}>{label}</div>
      <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "2.5rem", color: `var(--text-warm)`, fontWeight: 800, marginTop: "0.25rem", lineHeight: 1, letterSpacing: "-0.02em" }}>{value}</div>
      {sub && <div style={{ fontFamily: "var(--font-data, monospace)", fontSize: "0.8rem", color: `var(--text-dim)`, marginTop: "0.4rem", letterSpacing: "0.02em" }}>{sub}</div>}
    </div>
  );
}

function QBadge({ q, size = "sm" }) {
  const cfg = Q[q] || Q.Q4;
  const pad = size === "sm" ? "0.2rem 0.6rem" : "0.35rem 0.85rem";
  const fs  = size === "sm" ? "0.65rem" : "0.78rem";
  return (
    <span style={{ background: cfg.color + "15", color: cfg.color, border: `1px solid ${cfg.color}30`, borderRadius: "6px", padding: pad, fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: fs, fontWeight: 600, letterSpacing: "0.04em", whiteSpace: "nowrap", display: "inline-flex", alignItems: "center", gap: "0.3rem" }}>
      <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: cfg.color, display: "inline-block", flexShrink: 0 }} />
      {q} {cfg.badge}
    </span>
  );
}

// InsightCard accepts structured insight objects { type, priority, category, text }
function InsightCard({ type, insights, aiEnabled = false, aiPromptData = null }) {
  const isWin = type === "win";
  const color = isWin ? "#16a34a" : "#dc2626";
  const icon  = isWin ? "🏆" : "⚡";
  const title = isWin ? "Wins & Key Learnings" : "Opportunities & Action Items";

  const aiType = isWin ? "wins" : "opps";
  const [aiLoading, setAiLoading] = useState(false);
  const [, forceUpdate] = useState(0);

  // Read from session cache
  const aiItems = aiPromptData ? getAICache(aiType, aiPromptData.jobType, aiPromptData.totalGoals) : null;

  // Poll cache for prefetch results
  useEffect(() => {
    if (!aiEnabled || aiItems || !aiPromptData) return;
    setAiLoading(true);
    const interval = setInterval(() => {
      const cached = getAICache(aiType, aiPromptData.jobType, aiPromptData.totalGoals);
      if (cached) { setAiLoading(false); forceUpdate(v => v + 1); clearInterval(interval); }
    }, 500);
    const timeout = setTimeout(() => {
      clearInterval(interval);
      if (getAICache(aiType, aiPromptData.jobType, aiPromptData.totalGoals)) { setAiLoading(false); forceUpdate(v => v + 1); return; }
      const prompt = buildAIPrompt(aiType, aiPromptData);
      ollamaGenerate(prompt).then(result => {
        if (result) {
          const items = result.split(/\n/).filter(l => l.trim()).map(l => l.replace(/^[\d\-\.\*\)]+\s*/, "").trim()).filter(Boolean);
          setAICache(aiType, aiPromptData.jobType, aiPromptData.totalGoals, items);
        }
        setAiLoading(false);
        forceUpdate(v => v + 1);
      });
    }, 90000);
    return () => { clearInterval(interval); clearTimeout(timeout); };
  }, [aiEnabled, aiPromptData?.jobType, aiPromptData?.totalGoals, aiType]);

  // Render sorted by priority (high → medium → low)
  const priorityRank = { high: 0, medium: 1, low: 2 };
  const sorted = [...insights].sort((a, b) =>
    (priorityRank[a.priority] ?? 1) - (priorityRank[b.priority] ?? 1));

  const displayItems = aiEnabled && aiItems ? aiItems.map(t => ({ text: t, priority: "medium" })) : sorted;

  return (
    <div style={{ background: `var(--glass-bg)`, backdropFilter: "blur(12px) saturate(150%)", WebkitBackdropFilter: "blur(12px) saturate(150%)", border: `1px solid ${aiEnabled ? AI_COLOR + "20" : color + "20"}`, borderRadius: "var(--radius-lg, 16px)", padding: "1.5rem 1.75rem", borderLeft: `4px solid ${aiEnabled ? AI_COLOR : color}`, boxShadow: `var(--card-glow)` }}>
      <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.78rem", color: aiEnabled ? AI_COLOR : color, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: "1.25rem", display: "flex", alignItems: "center", gap: "0.5rem", fontWeight: 600 }}>
        <span style={{ fontSize: "1.1rem" }}>{icon}</span> {aiEnabled ? "AI " : ""}{title}
        {aiEnabled && aiItems && (
          <button onClick={() => { clearAICache(aiType, aiPromptData.jobType, aiPromptData.totalGoals); forceUpdate(v => v + 1); }}
            style={{ marginLeft: "auto", background: AI_COLOR + "10", border: `1px solid ${AI_COLOR}30`, borderRadius: "var(--radius-sm, 6px)", color: AI_COLOR, padding: "0.15rem 0.45rem", fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.65rem", cursor: "pointer", fontWeight: 500 }}>
            Regen
          </button>
        )}
      </div>
      {aiLoading ? (
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", padding: "0.5rem 0" }}>
          <div style={{ width: "12px", height: "12px", borderRadius: "50%", border: `2px solid ${AI_COLOR}`, borderTopColor: "transparent", animation: "spin 0.8s linear infinite" }} />
          <span style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.85rem", color: AI_COLOR }}>Analyzing...</span>
        </div>
      ) : displayItems.map((ins, i) => (
        <div key={i} style={{ display: "flex", gap: "0.75rem", marginBottom: i < displayItems.length - 1 ? "0.85rem" : 0, paddingBottom: i < displayItems.length - 1 ? "0.85rem" : 0, borderBottom: i < displayItems.length - 1 ? `1px solid ${aiEnabled ? AI_COLOR : color}10` : "none" }}>
          <div style={{ color: aiEnabled ? AI_COLOR : color, marginTop: "0.1rem", flexShrink: 0, fontSize: "0.7rem", opacity: 0.8 }}>&#9654;</div>
          <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.92rem", color: `var(--text-secondary)`, lineHeight: 1.65, fontWeight: 400 }}>{ins.text}</div>
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
      style={{ padding: "0.55rem 0.75rem", textAlign: right ? "right" : "left",
        color: sort.key === k ? "#d97706" : `var(--text-dim)`, fontWeight: sort.key === k ? 600 : 500, cursor: "pointer",
        whiteSpace: "nowrap", userSelect: "none", fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.72rem", letterSpacing: "0.04em", textTransform: "uppercase", transition: "color 150ms" }}>
      {label} {sort.key === k ? (sort.dir === -1 ? "\u2193" : "\u2191") : ""}
    </th>
  );

  return (
    <div style={{ overflowX: "auto" }}>
      {/* Region filter */}
      {regionList.length > 1 && (
        <div style={{ display: "flex", gap: "0.3rem", flexWrap: "wrap", marginBottom: "0.75rem" }}>
          <button onClick={() => setRegionFilter(null)}
            style={{ padding: "0.3rem 0.7rem", borderRadius: "var(--radius-sm, 6px)", border: `1px solid ${!regionFilter ? "#d9770650" : "transparent"}`, background: !regionFilter ? "#d9770612" : "transparent", color: !regionFilter ? "#d97706" : `var(--text-dim)`, fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.78rem", cursor: "pointer", fontWeight: !regionFilter ? 600 : 400 }}>
            All ({agentRollups.length})
          </button>
          {regionList.map(r => {
            const active = regionFilter === r.name;
            const regGph = r.hours > 0 ? r.goals / r.hours : 0;
            return (
              <button key={r.name} onClick={() => setRegionFilter(active ? null : r.name)}
                style={{ padding: "0.3rem 0.7rem", borderRadius: "var(--radius-sm, 6px)", border: `1px solid ${active ? "#6366f150" : "transparent"}`, background: active ? "#6366f112" : "transparent", color: active ? "#6366f1" : `var(--text-dim)`, fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.78rem", cursor: "pointer", fontWeight: active ? 600 : 400 }}>
                {mbrSiteName(r.name)} <span style={{ opacity: 0.5, fontSize: "0.7rem", fontFamily: "var(--font-data, monospace)" }}>{r.count} <span style={{ display: "inline-block", width: "0.5em" }} /> {regGph.toFixed(3)}</span>
              </button>
            );
          })}
        </div>
      )}
      <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "var(--font-data, monospace)", fontSize: "0.82rem" }}>
        <thead>
          <tr style={{ borderBottom: "2px solid var(--border)" }}>
            <th style={{ padding: "0.55rem 0.75rem", color: `var(--text-dim)`, fontWeight: 500, fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.72rem", textTransform: "uppercase", letterSpacing: "0.04em" }}>Q</th>
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
                <td style={{ padding: "0.5rem 0.75rem", color: `var(--text-warm)`, fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.88rem" }}>{a.agentName}</td>
                <td style={{ padding: "0.5rem 0.75rem", color: `var(--text-secondary)` }}>{mbrSiteName(a.region)}</td>
                <td style={{ padding: "0.5rem 0.75rem", color: `var(--text-muted)`, fontSize: "0.82rem" }}>{a.supervisor || "—"}</td>
                <td style={{ padding: "0.5rem 0.75rem", color: a.hours >= getMinHours() ? "#6366f1" : `var(--text-secondary)`, textAlign: "right" }}>{fmt(a.hours, 1)}</td>
                <td style={{ padding: "0.5rem 0.75rem", color: `var(--text-secondary)`, textAlign: "right" }}>{a.goals}</td>
                <td style={{ padding: "0.5rem 0.75rem", color, fontWeight: 600, textAlign: "right" }}>{a.gph.toFixed(3)}</td>
                <td style={{ padding: "0.5rem 0.75rem", color, fontWeight: 700, textAlign: "right" }}>{a.pctToGoal > 0 ? `${Math.round(a.pctToGoal)}%` : "—"}</td>
                <td style={{ padding: "0.5rem 0.75rem", color: a.newXI > 0 ? `var(--text-secondary)` : `var(--text-faint)`, textAlign: "right" }}>{a.newXI || "—"}</td>
                <td style={{ padding: "0.5rem 0.75rem", color: a.xmLines > 0 ? `var(--text-secondary)` : `var(--text-faint)`, textAlign: "right" }}>{a.xmLines || "—"}</td>
                <td style={{ padding: "0.5rem 0.75rem", color: a.rgu > 0 ? `var(--text-secondary)` : `var(--text-faint)`, textAlign: "right" }}>{a.rgu || "—"}</td>
                <td style={{ padding: "0.5rem 0.75rem", whiteSpace: "nowrap" }}>
                  {isNew && <span style={{ background: "var(--nh-bg, #92400e18)", color: "var(--nh-color, #92400e)", border: "1px solid var(--nh-border, #92400e40)", borderRadius: "3px", padding: "0.1rem 0.4rem", fontSize: "0.82rem" }}>NEW HIRE</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.8rem", color: `var(--text-faint)`, padding: "0.5rem 0.75rem" }}>
        {sorted.length} agents{regionFilter ? ` · ${regionFilter}` : ""} · hours and goals summed across all working days
      </div>
    </div>
  );
}

// RegionComparePanel — receives pre-built RegionStat[] from engine
function RegionComparePanel({ regionStats, agents = [] }) {
  if (regionStats.length < 2) {
    return (
      <div style={{ background: `var(--bg-secondary)`, border: "1px solid var(--border)", borderRadius: "var(--radius-lg, 16px)", padding: "1.5rem" }}>
        <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.82rem", color: `var(--text-muted)`, letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: "0.75rem" }}>Region Breakdown</div>
        {regionStats.length === 1 && (
          <div style={{ display: "flex", gap: "1.5rem", fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.85rem", color: `var(--text-muted)` }}>
            <span>{mbrSiteName(regionStats[0].name)}</span>
            <span>{regionStats[0].count} agents</span>
            <span>{fmt(regionStats[0].totalHours, 0)} hrs total</span>
            <span>{fmtPct(regionStats[0].avgPct)} avg to goal</span>
          </div>
        )}
        {regionStats.length === 0 && <div style={{ color: `var(--text-dim)`, fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "1.27rem" }}>No region data found.</div>}
      </div>
    );
  }

  const best     = regionStats[0];
  const worst    = regionStats[regionStats.length - 1];
  const variance = (best.avgPct - worst.avgPct).toFixed(1);
  const maxPct   = Math.max(...regionStats.map(r => r.avgPct));
  const maxHours = Math.max(...regionStats.map(r => r.totalHours));

  return (
    <div style={{ background: `var(--bg-secondary)`, border: "1px solid var(--border)", borderRadius: "var(--radius-lg, 16px)", padding: "1.5rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "1.25rem" }}>
        <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.82rem", color: "#d97706", letterSpacing: "0.12em", textTransform: "uppercase" }}>Regional Variance Analysis</div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.8rem", color: parseFloat(variance) > 20 ? "#dc2626" : parseFloat(variance) > 10 ? "#d97706" : "#16a34a" }}>
            {variance}% spread
          </div>
          <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.82rem", color: `var(--text-dim)` }}>{regionStats.length} regions</div>
        </div>
      </div>

      {parseFloat(variance) > 15 && (
        <div style={{ background: "#d9770610", border: "1px solid #d9770630", borderRadius: "var(--radius-md, 10px)", padding: "0.75rem 1rem", marginBottom: "1.25rem", fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.82rem", color: "#fde68a", lineHeight: 1.5 }}>
          {variance}% variance between {mbrSiteName(best.name)} ({fmtPct(best.avgPct)}) and {mbrSiteName(worst.name)} ({fmtPct(worst.avgPct)}). Regional coaching alignment is recommended.
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
          <div key={r.name} style={{ marginBottom: "1rem", padding: "0.9rem 1rem", background: isTop ? "#ffffff05" : "transparent", border: isTop ? "1px solid #ffffff0a" : "1px solid transparent", borderRadius: "var(--radius-md, 10px)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
                {isTop && <span style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.8rem", color: "#d97706", background: "#d9770620", padding: "0.1rem 0.4rem", borderRadius: "3px" }}>BEST</span>}
                <span style={{ color: `var(--text-primary)`, fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "1.32rem" }}>{mbrSiteName(r.name)}</span>
                <span style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.8rem", color: `var(--text-muted)` }}>{r.count} agents</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                {i > 0 && <span style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.8rem", color: "#dc2626" }}>{delta}%</span>}
                <span style={{ fontFamily: "var(--font-display, Inter, sans-serif)", fontSize: "1.95rem", color: qColor, fontWeight: 700 }}>{fmtPct(r.avgPct)}</span>
              </div>
            </div>
            <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", marginBottom: "0.4rem" }}>
              <div style={{ width: "5rem", fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.82rem", color: `var(--text-dim)`, textAlign: "right", flexShrink: 0 }}>% to goal</div>
              <div style={{ flex: 1, background: `var(--bg-tertiary)`, borderRadius: "var(--radius-sm, 6px)", height: "5px", overflow: "hidden" }}>
                <div style={{ width: `${barW}%`, height: "100%", background: qColor, borderRadius: "var(--radius-sm, 6px)", transition: "width 0.7s ease" }} />
              </div>
            </div>
            <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", marginBottom: "0.5rem" }}>
              <div style={{ width: "5rem", fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.82rem", color: `var(--text-dim)`, textAlign: "right", flexShrink: 0 }}>hours</div>
              <div style={{ flex: 1, background: `var(--bg-tertiary)`, borderRadius: "var(--radius-sm, 6px)", height: "5px", overflow: "hidden" }}>
                <div style={{ width: `${hoursBarW}%`, height: "100%", background: "#6366f1", borderRadius: "var(--radius-sm, 6px)", transition: "width 0.7s ease" }} />
              </div>
            </div>
            <div style={{ display: "flex", gap: "1.25rem", paddingLeft: "5.5rem" }}>
              <span style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.82rem", color: `var(--text-muted)` }}>GPH {fmt(r.avgGPH, 2)}</span>
              <span style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.82rem", color: `var(--text-muted)` }}>{fmt(r.totalHours, 0)} hrs</span>
              <span style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.82rem", color: Q.Q1.color }}>Q1: {r.q1Count}</span>
              <span style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.82rem", color: Q.Q2.color }}>Q2: {r.q2Count}</span>
              <span style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.82rem", color: Q.Q3.color }}>Q3: {r.q3Count}</span>
              <span style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.82rem", color: Q.Q4.color }}>Q4: {r.q4Count}</span>
              {over16 > 0 && <span style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.82rem", color: "#6366f1" }}>{over16} over 16hr</span>}
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
  sphAttain, sphActual, sphPlan,
  hourAttain, hourActual, hourPlan,
  projMobileCapped, projHsdCapped, projCostPerCapped, projHourCapped,
  homesActual, homesPlan,
}) {

  const mobileTier    = getGainshareTier(mobileAttain, siteMode);
  const hsdTier       = getGainshareTier(hsdAttain, siteMode);
  const costPerTier   = getGainshareTier(costPerAttain, siteMode);
  const sphTier       = getGainshareTier(sphAttain, siteMode);
  const TIERS         = siteMode ? GAINSHARE_SITE_TIERS : GAINSHARE_TIERS;

  // Hour Attainment gate: site mode uses tiered penalties, overall uses flat -2%
  const hourGateTier = siteMode ? getHourGateTier(hourAttain) : null;
  const hourGatePenalty = siteMode
    ? (hourGateTier?.penalty ?? 0)
    : (hourAttain !== null && hourAttain !== undefined && hourAttain < 100 ? -2.00 : 0);

  const totalBonus = (mobileTier?.mobile ?? 0) + (hsdTier?.hsd ?? 0) + (costPerTier?.costPer ?? 0) + (sphTier?.sph ?? 0) + hourGatePenalty;
  const bonusAvailable = mobileAttain !== null || hsdAttain !== null || costPerAttain !== null;
  if (!bonusAvailable) return null;

  // Compute pacing projections when fiscalInfo + raw numbers are available

  // Projected attainment via pacing (used for persistent pacing indicator on tiers)
  const projAttainFn = (actual, plan, isSph, actualHours) => {
    if (!fiscalInfo || !fiscalInfo.elapsedBDays || !fiscalInfo.totalBDays || !plan) return null;
    if (isSph) {
      // SPH is a ratio: Actual Homes / Actual Hours vs Planned Homes / Planned Hours
      // Project homes and hours independently, then compute projected SPH attainment
      const hAct = homesActual || (mobileActual ?? 0);
      const hPlan = homesPlan || (mobilePlan ?? 0);
      const hrAct = actualHours || 0;
      const hrPlan = hourPlan || 0;
      if (!hPlan || !hrPlan || !hrAct) return null;
      const homesPace = calcPacing(hAct, hPlan, fiscalInfo.elapsedBDays, fiscalInfo.totalBDays);
      const hoursPace = calcPacing(hrAct, hrPlan, fiscalInfo.elapsedBDays, fiscalInfo.totalBDays);
      if (!homesPace || !hoursPace || hoursPace.projected <= 0) return null;
      const projSph = homesPace.projected / hoursPace.projected;
      const goalSph = plan; // plan = SPH goal
      return goalSph > 0 ? (projSph / goalSph) * 100 : null;
    }
    const pace = calcPacing(actual, plan, fiscalInfo.elapsedBDays, fiscalInfo.totalBDays);
    return pace ? pace.projectedPct : null;
  };

  // Find which tier a projected attainment would land in
  const getProjTierIdx = (projPct) => {
    if (projPct === null) return -1;
    for (let i = 0; i < TIERS.length; i++) {
      if (projPct >= TIERS[i].min) return i;
    }
    return TIERS.length - 1;
  };

  const PACE_COLOR = "#8b5cf6"; // purple — distinct from current tier colors

  // Compute projected net bonus from projected tier landings
  // Use per-funding-source capped projections when available (prevents over-projection beyond budget)
  const projMobilePct  = projMobileCapped != null ? projMobileCapped : (mobileAttain !== null  ? projAttainFn(mobileActual, mobilePlan, false, null) : null);
  const projHsdPct     = projHsdCapped != null    ? projHsdCapped    : (hsdAttain !== null      ? projAttainFn(hsdActual, hsdPlan, false, null) : null);
  const projCostPerPct = projCostPerCapped != null ? projCostPerCapped : (costPerAttain !== null  ? projAttainFn(costPerActual, costPerPlan, false, null) : null);
  const projSphPct     = sphAttain !== null      ? projAttainFn(sphActual, sphPlan, true, hourActual) : null;
  const projHourPct    = projHourCapped != null ? projHourCapped : (hourAttain !== null ? projAttainFn(hourActual, hourPlan, false, null) : null);

  const projMobileTier  = projMobilePct !== null  ? getGainshareTier(projMobilePct, siteMode) : null;
  const projHsdTier     = projHsdPct !== null      ? getGainshareTier(projHsdPct, siteMode) : null;
  const projCostPerTier = projCostPerPct !== null  ? getGainshareTier(projCostPerPct, siteMode) : null;
  const projSphTier     = projSphPct !== null      ? getGainshareTier(projSphPct, siteMode) : null;
  const projHourGatePenalty = siteMode
    ? (projHourPct !== null ? (getHourGateTier(projHourPct)?.penalty ?? 0) : 0)
    : (projHourPct !== null && projHourPct < 100 ? -2.00 : 0);

  const effectiveProjHourPenalty = projHourPct !== null ? projHourGatePenalty : hourGatePenalty;
  const projTotalBonus = (projMobileTier?.mobile ?? mobileTier?.mobile ?? 0)
    + (projHsdTier?.hsd ?? hsdTier?.hsd ?? 0)
    + (projCostPerTier?.costPer ?? costPerTier?.costPer ?? 0)
    + (projSphTier?.sph ?? sphTier?.sph ?? 0)
    + effectiveProjHourPenalty;
  const hasProjBonus = fiscalInfo && fiscalInfo.elapsedBDays > 0;

  const ColDef = ({ label, attain, tierKey, tier, actual, plan, isSph, actualHours, projOverride }) => {
    // For each tier, compute the target number needed
    // Cumulative metrics: target = (threshold% / 100) * plan
    // SPH: target expressed as sales needed = targetSPH * actualHours (so the user sees homes, not SPH)
    const computeTarget = (thresholdMin) => {
      if (!plan || plan <= 0) return null;
      if (isSph) {
        const targetSph = (thresholdMin / 100) * plan;
        const salesNeeded = actualHours > 0 ? Math.ceil(targetSph * actualHours) : null;
        return salesNeeded;
      }
      return Math.ceil((thresholdMin / 100) * plan);
    };

    const currentIdx = tier ? TIERS.indexOf(tier) : -1;
    const nextTierUp = currentIdx > 0 ? TIERS[currentIdx - 1] : null;
    const nextTarget = nextTierUp ? computeTarget(nextTierUp.min) : null;
    const nextDelta = nextTarget !== null && actual !== null ? Math.max(Math.ceil(nextTarget - (isSph && actualHours > 0 ? actual * actualHours : actual)), 0) : null;

    // Projected EOM tier — use per-funding-source capped projection when available
    const projPct = projOverride != null ? projOverride : projAttainFn(actual, plan, isSph, actualHours);
    const projTierIdx = getProjTierIdx(projPct);
    const showProj = projPct !== null && projTierIdx !== currentIdx;

    return (
      <div style={{ flex: "1 1 140px", minWidth: "140px" }}>
        <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.82rem", color: `var(--text-muted)`, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "0.4rem", textAlign: "center" }}>{label}</div>

        {attain !== null && (
          <div style={{ textAlign: "center", marginBottom: "0.35rem" }}>
            <span style={{ fontFamily: "var(--font-display, Inter, sans-serif)", fontSize: "2rem", color: attainColor(attain), fontWeight: 700 }}>{Math.round(attain)}%</span>
            {projPct !== null && (
              <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.72rem", color: PACE_COLOR, marginTop: "0.1rem" }}>
                proj. {Math.round(projPct)}%
              </div>
            )}
          </div>
        )}

        {nextDelta !== null && nextDelta > 0 && (
          <div style={{ textAlign: "center", marginBottom: "0.5rem", padding: "0.25rem 0.4rem", background: "#d9770612", borderRadius: "var(--radius-sm, 6px)", border: "1px solid #d9770630" }}>
            <span style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.82rem", color: "#d97706" }}>
              {nextDelta} {isSph ? "sales" : label.includes("Hour") ? "hrs" : label.includes("HSD") ? "HSD" : label.includes("Cost") ? "RGU" : "homes"} to next tier ({nextTierUp[tierKey] > 0 ? "+" : ""}{nextTierUp[tierKey].toFixed(2)}%)
            </span>
          </div>
        )}

        {TIERS.map((t, i) => {
          const isActive = tier === t;
          const isProj = showProj && i === projTierIdx;
          const val = t[tierKey];
          const sign = val > 0 ? "+" : "";
          const target = computeTarget(t.min);
          const isAbove = target !== null && actual !== null && (isSph ? (actualHours > 0 ? actual * actualHours >= target : false) : actual >= target);

          let bg, border;
          if (isActive) {
            bg = val > 0 ? "#16a34a22" : val < 0 ? "#dc262622" : "var(--text-faint)22";
            border = `2px solid ${val > 0 ? "#16a34a70" : val < 0 ? "#dc262670" : "var(--text-faint)70"}`;
          } else if (isProj) {
            bg = PACE_COLOR + "14";
            border = `2px dashed ${PACE_COLOR}60`;
          } else {
            bg = "transparent"; border = "1px solid transparent";
          }

          return (
            <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", alignItems: "center",
              padding: "0.2rem 0.25rem", borderRadius: "var(--radius-sm, 6px)", marginBottom: "1px", background: bg, border, gap: "0.2rem", position: "relative" }}>
              {isProj && (
                <span style={{ position: "absolute", left: "-0.1rem", top: "50%", transform: "translateY(-50%)", fontSize: "0.6rem", color: PACE_COLOR, fontWeight: 700, lineHeight: 1 }}>▸</span>
              )}
              <span style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: isActive ? "0.95rem" : isProj ? "0.9rem" : "0.85rem",
                color: isActive ? `var(--text-primary)` : isProj ? PACE_COLOR : `var(--text-faint)`, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{t.label}</span>

              <span style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.78rem", textAlign: "center", minWidth: "3rem",
                color: isAbove ? "#16a34a" : i === currentIdx - 1 ? "#d97706" : isProj ? PACE_COLOR : `var(--text-faint)`,
                fontWeight: isActive || i === currentIdx - 1 || isProj ? 700 : 400 }}>
                {target === null ? "" : isAbove ? "\u2713" : target.toLocaleString()}
              </span>

              <span style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: isActive ? "1.05rem" : isProj ? "0.95rem" : "0.88rem", textAlign: "right",
                color: isActive ? bonusColor(val) : isProj ? PACE_COLOR : `var(--text-faint)`,
                fontWeight: isActive || isProj ? 700 : 400, whiteSpace: "nowrap" }}>
                {sign}{val.toFixed(2)}%
                {isProj && <span style={{ fontSize: "0.55rem", display: "block", color: PACE_COLOR, fontWeight: 500 }}>PROJ.</span>}
              </span>
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div style={{ background: `var(--bg-secondary)`, border: "1px solid var(--border)", borderRadius: "var(--radius-lg, 16px)", padding: "clamp(0.75rem, 3vw, 1.5rem)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.25rem", flexWrap: "wrap", gap: "0.5rem" }}>
        <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.82rem", color: `var(--text-muted)`, letterSpacing: "0.12em", textTransform: "uppercase" }}>
          Gainshare — Telesales
          <span style={{ marginLeft: "0.6rem", color: `var(--text-faint)`, fontSize: "0.82rem" }}>
            {siteMode ? "Site Table" : "Overall Table"}
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap", justifyContent: "flex-end" }}>
          <div style={{ textAlign: "right" }}>
            <span style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.72rem", color: `var(--text-dim)`, textTransform: "uppercase", letterSpacing: "0.05em" }}>Net Bonus</span>
            <div style={{ fontFamily: "var(--font-display, Inter, sans-serif)", fontSize: "clamp(1.5rem, 5vw, 2.25rem)", color: bonusColor(totalBonus), fontWeight: 700, lineHeight: 1 }}>
              {totalBonus > 0 ? "+" : ""}{totalBonus.toFixed(2)}%
            </div>
          </div>
          {hasProjBonus && projTotalBonus !== totalBonus && (
            <div style={{ textAlign: "right", paddingLeft: "0.75rem", borderLeft: `2px solid ${PACE_COLOR}30` }}>
              <span style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.72rem", color: PACE_COLOR, textTransform: "uppercase", letterSpacing: "0.05em" }}>Proj. Bonus</span>
              <div style={{ fontFamily: "var(--font-display, Inter, sans-serif)", fontSize: "clamp(1.5rem, 5vw, 2.25rem)", color: PACE_COLOR, fontWeight: 700, lineHeight: 1 }}>
                {projTotalBonus > 0 ? "+" : ""}{projTotalBonus.toFixed(2)}%
              </div>
              {projTotalBonus !== totalBonus && (
                <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.72rem", color: projTotalBonus > totalBonus ? "#16a34a" : "#dc2626", marginTop: "0.15rem" }}>
                  {projTotalBonus > totalBonus ? "▲" : "▼"} {Math.abs(projTotalBonus - totalBonus).toFixed(2)}% {projTotalBonus > totalBonus ? "gain" : "loss"} at pace
                </div>
              )}
            </div>
          )}
        </div>
      </div>
      <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
        {mobileAttain !== null  && <ColDef label="Mobile Attainment"   attain={mobileAttain}  tierKey="mobile"  tier={mobileTier}  actual={mobileActual}  plan={mobilePlan}  projOverride={projMobileCapped} />}
        {hsdAttain !== null     && <ColDef label="HSD Attainment"      attain={hsdAttain}     tierKey="hsd"     tier={hsdTier}     actual={hsdActual}     plan={hsdPlan}     projOverride={projHsdCapped} />}
        {costPerAttain !== null && <ColDef label="Cost Per Attainment" attain={costPerAttain} tierKey="costPer" tier={costPerTier} actual={costPerActual} plan={costPerPlan} projOverride={projCostPerCapped} />}
        {sphAttain !== null     && <ColDef label="SPH Attainment"      attain={sphAttain}     tierKey="sph"     tier={sphTier}     actual={sphActual}     plan={sphPlan}     isSph actualHours={hourActual} />}
        {/* Hour Attainment Gate Metric */}
        {hourAttain !== null && hourAttain !== undefined && (() => {
          const hoursNeeded = hourPlan ? Math.max(Math.ceil(hourPlan - (hourActual || 0)), 0) : 0;
          const hoursOver = hourPlan ? Math.max(Math.ceil((hourActual || 0) - hourPlan), 0) : 0;

          // Site mode: show tiered display
          if (siteMode) {
            return (
              <div style={{ flex: "1 1 140px", minWidth: "140px" }}>
                <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.82rem", color: `var(--text-muted)`, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "0.4rem", textAlign: "center" }}>Hour Gate</div>
                <div style={{ textAlign: "center", marginBottom: "0.35rem" }}>
                  <span style={{ fontFamily: "var(--font-display, Inter, sans-serif)", fontSize: "2rem", color: hourAttain >= 100 ? "#16a34a" : "#dc2626", fontWeight: 700 }}>{Math.round(hourAttain)}%</span>
                  {projHourPct !== null && (
                    <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.72rem", color: PACE_COLOR, marginTop: "0.1rem" }}>
                      proj. {Math.round(projHourPct)}%
                    </div>
                  )}
                </div>
                {hoursNeeded > 0 && (
                  <div style={{ textAlign: "center", marginBottom: "0.5rem", padding: "0.25rem 0.4rem", background: "#d9770612", borderRadius: "var(--radius-sm, 6px)", border: "1px solid #d9770630" }}>
                    <span style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.82rem", color: "#d97706" }}>
                      {hoursNeeded.toLocaleString()} hrs to clear gate
                    </span>
                  </div>
                )}
                {hoursOver > 0 && (
                  <div style={{ textAlign: "center", marginBottom: "0.5rem", padding: "0.25rem 0.4rem", background: "#16a34a12", borderRadius: "var(--radius-sm, 6px)", border: "1px solid #16a34a30" }}>
                    <span style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.82rem", color: "#16a34a" }}>
                      +{hoursOver.toLocaleString()} hrs over
                    </span>
                  </div>
                )}
                {(() => {
                  const projHourTier = projHourPct !== null ? getHourGateTier(projHourPct) : null;
                  const showHourProj = projHourTier && projHourTier !== hourGateTier;
                  return HOUR_GATE_SITE_TIERS.map((t, ti) => {
                    const isActive = hourGateTier === t;
                    const isProj = showHourProj && projHourTier === t;
                    const target = hourPlan ? Math.ceil((t.min / 100) * hourPlan) : null;
                    const isAbove = target !== null && (hourActual || 0) >= target;
                    let bg, border;
                    if (isActive) {
                      bg = t.penalty < 0 ? "#dc262622" : "#16a34a22";
                      border = `2px solid ${t.penalty < 0 ? "#dc262670" : "#16a34a70"}`;
                    } else if (isProj) {
                      bg = PACE_COLOR + "14";
                      border = `2px dashed ${PACE_COLOR}60`;
                    } else {
                      bg = "transparent"; border = "1px solid transparent";
                    }
                    return (
                      <div key={ti} style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", alignItems: "center", padding: "0.2rem 0.4rem", borderRadius: "var(--radius-sm, 6px)", marginBottom: "1px", background: bg, border, gap: "0.3rem", position: "relative" }}>
                        {isProj && <span style={{ position: "absolute", left: "-0.1rem", top: "50%", transform: "translateY(-50%)", fontSize: "0.6rem", color: PACE_COLOR, fontWeight: 700, lineHeight: 1 }}>▸</span>}
                        <span style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: isActive ? "1.05rem" : "0.95rem", color: isActive ? `var(--text-primary)` : isProj ? PACE_COLOR : `var(--text-faint)` }}>{t.label}</span>
                        <span style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.85rem", textAlign: "center", minWidth: "4.5rem", color: isAbove ? "#16a34a" : ti === (HOUR_GATE_SITE_TIERS.indexOf(hourGateTier) - 1) ? "#d97706" : isProj ? PACE_COLOR : `var(--text-faint)`, fontWeight: isActive || isProj || (target && !isAbove && ti === HOUR_GATE_SITE_TIERS.indexOf(hourGateTier) - 1) ? 700 : 400 }}>
                          {target === null ? "" : isAbove ? "\u2713" : target.toLocaleString()}
                        </span>
                        <span style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: isActive ? "1.25rem" : isProj ? "1.1rem" : "1rem", textAlign: "right", color: isActive ? (t.penalty < 0 ? "#dc2626" : "#16a34a") : isProj ? PACE_COLOR : `var(--text-faint)`, fontWeight: isActive || isProj ? 700 : 400 }}>
                          {t.penalty === 0 ? "0%" : `${t.penalty.toFixed(2)}%`}
                          {isProj && <span style={{ fontSize: "0.55rem", display: "block", color: PACE_COLOR, fontWeight: 500 }}>PROJ.</span>}
                        </span>
                      </div>
                    );
                  });
                })()}
              </div>
            );
          }

          // Overall mode: 2-tier display (pass/fail with projected tier)
          {
            const overallHourTiers = [
              { min: 100, max: Infinity, penalty: 0,     label: "\u2265 100%" },
              { min: 0,   max: 99.99,    penalty: -2.00, label: "< 99.9%" },
            ];
            const currentOverallTier = hourAttain >= 100 ? overallHourTiers[0] : overallHourTiers[1];
            const projOverallTier = projHourPct !== null ? (projHourPct >= 100 ? overallHourTiers[0] : overallHourTiers[1]) : null;
            const showOverallProj = projOverallTier && projOverallTier !== currentOverallTier;
            return (
              <div style={{ flex: "1 1 140px", minWidth: "140px" }}>
                <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.82rem", color: `var(--text-muted)`, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "0.4rem", textAlign: "center" }}>Hour Gate</div>
                <div style={{ textAlign: "center", marginBottom: "0.35rem" }}>
                  <span style={{ fontFamily: "var(--font-display, Inter, sans-serif)", fontSize: "2rem", color: hourAttain >= 100 ? "#16a34a" : "#dc2626", fontWeight: 700 }}>{Math.round(hourAttain)}%</span>
                  {projHourPct !== null && (
                    <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.72rem", color: PACE_COLOR, marginTop: "0.1rem" }}>
                      proj. {Math.round(projHourPct)}%
                    </div>
                  )}
                </div>
                {hoursNeeded > 0 && (
                  <div style={{ textAlign: "center", marginBottom: "0.5rem", padding: "0.25rem 0.4rem", background: "#d9770612", borderRadius: "var(--radius-sm, 6px)", border: "1px solid #d9770630" }}>
                    <span style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.82rem", color: "#d97706" }}>
                      {hoursNeeded.toLocaleString()} hrs to clear gate
                    </span>
                  </div>
                )}
                {overallHourTiers.map((t, ti) => {
                  const isActive = currentOverallTier === t;
                  const isProj = showOverallProj && projOverallTier === t;
                  const target = hourPlan ? Math.ceil((t.min / 100) * hourPlan) : null;
                  const isAbove = target !== null && (hourActual || 0) >= target;
                  let bg, border;
                  if (isActive) {
                    bg = t.penalty < 0 ? "#dc262622" : "#16a34a22";
                    border = `2px solid ${t.penalty < 0 ? "#dc262670" : "#16a34a70"}`;
                  } else if (isProj) {
                    bg = PACE_COLOR + "14";
                    border = `2px dashed ${PACE_COLOR}60`;
                  } else {
                    bg = "transparent"; border = "1px solid transparent";
                  }
                  return (
                    <div key={ti} style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", alignItems: "center", padding: "0.2rem 0.4rem", borderRadius: "var(--radius-sm, 6px)", marginBottom: "1px", background: bg, border, gap: "0.3rem", position: "relative" }}>
                      {isProj && <span style={{ position: "absolute", left: "-0.1rem", top: "50%", transform: "translateY(-50%)", fontSize: "0.6rem", color: PACE_COLOR, fontWeight: 700, lineHeight: 1 }}>▸</span>}
                      <span style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: isActive ? "1.05rem" : "0.95rem", color: isActive ? `var(--text-primary)` : isProj ? PACE_COLOR : `var(--text-faint)` }}>{t.label}</span>
                      <span style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.85rem", textAlign: "center", minWidth: "4.5rem", color: isAbove ? "#16a34a" : isProj ? PACE_COLOR : `var(--text-faint)`, fontWeight: isActive || isProj ? 700 : 400 }}>
                        {target === null ? "" : isAbove ? "\u2713" : target.toLocaleString()}
                      </span>
                      <span style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: isActive ? "1.25rem" : isProj ? "1.1rem" : "1rem", textAlign: "right", color: isActive ? (t.penalty < 0 ? "#dc2626" : "#16a34a") : isProj ? PACE_COLOR : `var(--text-faint)`, fontWeight: isActive || isProj ? 700 : 400 }}>
                        {t.penalty === 0 ? "0%" : `${t.penalty.toFixed(2)}%`}
                        {isProj && <span style={{ fontSize: "0.55rem", display: "block", color: PACE_COLOR, fontWeight: 500 }}>PROJ.</span>}
                      </span>
                    </div>
                  );
                })}
              </div>
            );
          }
        })()}
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
    <div style={{ background: `var(--bg-secondary)`, border: "1px solid var(--border)", borderRadius: "var(--radius-md, 10px)", padding: "0.85rem 1.25rem" }}>
      {/* Top row: title + date range + day counters */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "0.65rem" }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <span style={{ fontSize: "1.13rem" }}>📅</span>
            <span style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.8rem", color: "#d97706", letterSpacing: "0.15em", textTransform: "uppercase", fontWeight: 700 }}>
              {title}
            </span>
          </div>
          <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.96rem", color: `var(--text-faint)`, marginTop: "0.2rem" }}>
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
              <div style={{ fontFamily: "var(--font-display, Inter, sans-serif)", fontSize: "1.75rem", color, fontWeight: 700, lineHeight: 1 }}>{value}</div>
              <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.9rem", color: `var(--text-faint)`, marginTop: "0.1rem" }}>{label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Progress bar row */}
      <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
        <span style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.96rem", color: `var(--text-faint)`, flexShrink: 0 }}>Month elapsed</span>
        <div style={{ flex: 1, position: "relative", height: "6px", background: `var(--bg-tertiary)`, borderRadius: "var(--radius-sm, 6px)", overflow: "hidden" }}>
          <div style={{ position: "absolute", left: 0, top: 0, height: "100%", width: `${pct}%`, background: "#d97706", borderRadius: "var(--radius-sm, 6px)", transition: "width 0.8s ease" }} />
        </div>
        <span style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.96rem", color: "#d97706", flexShrink: 0, minWidth: "7rem", textAlign: "right" }}>
          {pct.toFixed(1)}% of fiscal month
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
    <div style={{ background: `var(--bg-secondary)`, border: "1px solid var(--border)", borderRadius: "var(--radius-lg, 16px)", padding: "1.5rem" }}>
      {/* Header row */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.25rem" }}>
        <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.82rem", color: `var(--text-muted)`, letterSpacing: "0.12em", textTransform: "uppercase" }}>{title}</div>
        {canPace && (
          <button onClick={() => setShowPacing(v => !v)}
            style={{ padding: "0.25rem 0.65rem", borderRadius: "var(--radius-sm, 6px)", border: `1px solid ${showPacing ? "#d97706" : "var(--border)"}`, background: showPacing ? "#d9770618" : "transparent", color: showPacing ? "#d97706" : "var(--text-muted)", fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "1.02rem", cursor: "pointer", letterSpacing: "0.05em" }}>
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
            <div key={i} style={{ background: `var(--bg-primary)`, border: `1px solid ${color}25`, borderRadius: "var(--radius-md, 10px)", padding: "1rem", borderTop: `3px solid ${color}` }}>
              {/* Label */}
              <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.82rem", color: `var(--text-muted)`, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "0.6rem" }}>{m.label}</div>

              {/* Actual big number */}
              <div style={{ fontFamily: "var(--font-display, Inter, sans-serif)", fontSize: "2rem", color: `var(--text-warm)`, fontWeight: 700, lineHeight: 1 }}>
                {Math.round(m.actual).toLocaleString()}
              </div>
              <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.78rem", color: `var(--text-dim)`, marginTop: "0.2rem" }}>
                of {Math.round(m.plan).toLocaleString()} plan
              </div>

              {/* Current attainment bar */}
              <div style={{ position: "relative", height: "6px", background: `var(--bg-tertiary)`, borderRadius: "var(--radius-sm, 6px)", overflow: "hidden", marginTop: "0.5rem", marginBottom: "0.35rem" }}>
                <div style={{ position: "absolute", left: 0, top: 0, height: "100%", width: `${barW}%`, background: color, borderRadius: "var(--radius-sm, 6px)", transition: "width 0.6s ease" }} />
                <div style={{ position: "absolute", left: "calc(100% - 1px)", top: 0, width: "1px", height: "100%", background: `var(--text-faint)` }} />
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: pace ? "0.75rem" : 0 }}>
                <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.82rem", color, fontWeight: 700 }}>
                  {attain !== null ? `${Math.round(attain)}%` : "—"}
                </div>
                {overBy > 0 && !pace && (
                  <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.82rem", color: Q.Q1.color }}>+{Math.round(overBy)}% over</div>
                )}
                {pace && (
                  <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.9rem", color: `var(--text-faint)` }}>to date</div>
                )}
              </div>

              {/* Remaining / Per Day stats row — color graded by pacing */}
              {(() => {
                const remaining = Math.ceil(m.plan - m.actual);
                if (remaining <= 0) {
                  return (
                    <div style={{ display: "flex", justifyContent: "center", padding: "0.45rem 0", marginTop: "0.35rem", borderTop: "1px solid var(--bg-tertiary)" }}>
                      <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.85rem", color: "#16a34a", fontWeight: 700 }}>
                        +{Math.abs(remaining).toLocaleString()} over plan
                      </div>
                    </div>
                  );
                }
                const daysLeft = fiscalInfo ? fiscalInfo.remainingBDays : 0;
                const perDayVal = daysLeft > 0 ? remaining / daysLeft : 0;
                const perDay = daysLeft > 0 ? perDayVal.toFixed(1) : null;

                // Color grade: compare current daily avg vs required daily rate
                // pctOfRequired: how much of the required daily rate you're actually hitting
                // 100%+ = on/ahead of pace (green), 80-99% = near (blue), 1-79% = behind (amber), 0% = no activity (red)
                const pacing = fiscalInfo && fiscalInfo.elapsedBDays > 0
                  ? calcPacing(m.actual, m.plan, fiscalInfo.elapsedBDays, fiscalInfo.totalBDays) : null;
                let pctOfRequired = 100; // default: assume on pace
                if (pacing && pacing.requiredDaily > 0) {
                  pctOfRequired = (pacing.dailyRate / pacing.requiredDaily) * 100;
                }
                const remainColor = pctOfRequired >= 100 ? "#16a34a" : pctOfRequired >= 80 ? "#2563eb" : pctOfRequired > 0 ? "#d97706" : "#dc2626";
                const remainBg    = remainColor + "08";
                const remainBdr   = remainColor + "15";

                // Per day color: green if daily rate covers it, grades to red as gap widens
                const perDayColor = pctOfRequired >= 100 ? "#16a34a" : pctOfRequired >= 80 ? "#2563eb" : pctOfRequired > 0 ? "#d97706" : "#dc2626";
                const perDayBg    = perDayColor + "08";
                const perDayBdr   = perDayColor + "15";

                return (
                  <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.35rem", borderTop: "1px solid var(--bg-tertiary)", paddingTop: "0.5rem" }}>
                    <div style={{ flex: 1, textAlign: "center", padding: "0.3rem 0", background: remainBg, borderRadius: "var(--radius-sm, 6px)", border: `1px solid ${remainBdr}` }}>
                      <div style={{ fontFamily: "var(--font-display, Inter, sans-serif)", fontSize: "1.1rem", fontWeight: 700, color: remainColor, lineHeight: 1.2 }}>{remaining.toLocaleString()}</div>
                      <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.68rem", color: `var(--text-dim)`, textTransform: "uppercase", letterSpacing: "0.05em", marginTop: "0.1rem" }}>remaining</div>
                    </div>
                    {perDay && (
                      <div style={{ flex: 1, textAlign: "center", padding: "0.3rem 0", background: perDayBg, borderRadius: "var(--radius-sm, 6px)", border: `1px solid ${perDayBdr}` }}>
                        <div style={{ fontFamily: "var(--font-display, Inter, sans-serif)", fontSize: "1.1rem", fontWeight: 700, color: perDayColor, lineHeight: 1.2 }}>{perDay}</div>
                        <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.68rem", color: `var(--text-dim)`, textTransform: "uppercase", letterSpacing: "0.05em", marginTop: "0.1rem" }}>per day</div>
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* Projected EOM section — only when pacing on */}
              {pace && (
                <div style={{ borderTop: "1px solid var(--bg-tertiary)", paddingTop: "0.6rem" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "0.3rem" }}>
                    <span style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.78rem", color: "var(--text-dim)" }}>PROJ. EOM</span>
                    <span style={{ fontFamily: "var(--font-display, Inter, sans-serif)", fontSize: "1.5rem", color: projColor, fontWeight: 700, lineHeight: 1 }}>
                      {pace.projected.toLocaleString()}
                    </span>
                  </div>
                  {/* Projected bar */}
                  <div style={{ position: "relative", height: "8px", background: `var(--bg-tertiary)`, borderRadius: "var(--radius-sm, 6px)", overflow: "hidden", marginBottom: "0.35rem" }}>
                    <div style={{ position: "absolute", left: 0, top: 0, height: "100%", width: `${projBarW}%`, background: projColor, borderRadius: "var(--radius-sm, 6px)", transition: "width 0.6s ease" }} />
                    <div style={{ position: "absolute", left: "calc(100% - 1px)", top: 0, width: "1px", height: "100%", background: `var(--text-faint)` }} />
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
                    <div>
                      <span style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.85rem", color: projColor, fontWeight: 700 }}>
                        {Math.round(pace.projectedPct)}% of plan
                      </span>
                      {!isAhead && (
                        <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.98rem", color: "#dc2626", fontWeight: 700, marginTop: "0.2rem" }}>
                          ▼ -{Math.abs(pace.delta).toLocaleString()}
                        </div>
                      )}
                      {isAhead && (
                        <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.98rem", color: "#16a34a", fontWeight: 700, marginTop: "0.2rem" }}>
                          ▲ +{Math.abs(pace.delta).toLocaleString()}
                        </div>
                      )}
                    </div>
                    {!isAhead && pace.requiredDaily !== null && (
                      <div style={{ textAlign: "right" }}>
                        <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.78rem", color: `var(--text-dim)`, marginBottom: "0.1rem" }}>NEED/DAY TO CLOSE</div>
                        <div style={{ fontFamily: "var(--font-display, Inter, sans-serif)", fontSize: "1.15rem", color: "#dc2626", fontWeight: 700, lineHeight: 1 }}>
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
    <div style={{ background: "var(--bg-secondary)", border: "1px solid #d9770640", borderRadius: "var(--radius-lg, 16px)", padding: "1.5rem", borderLeft: "4px solid #d97706" }}>
      {/* Header row */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "1.25rem", flexWrap: "wrap", gap: "0.75rem" }}>
        <div>
          <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.98rem", color: "#d97706", letterSpacing: "0.15em", textTransform: "uppercase", marginBottom: "0.25rem" }}>
            📈 {title}
          </div>
          <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.81rem", color: "var(--text-dim)" }}>
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
              <div style={{ fontFamily: "var(--font-display, Inter, sans-serif)", fontSize: "1.75rem", color: c, fontWeight: 700, lineHeight: 1 }}>{v}</div>
              <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.72rem", color: "var(--text-dim)", marginTop: "0.1rem" }}>{l}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Month progress bar */}
      <div style={{ marginBottom: "1.5rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.3rem" }}>
          <span style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.83rem", color: "var(--text-muted)" }}>Month elapsed</span>
          <span style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.83rem", color: "#d97706", fontWeight: 700 }}>{pctElapsed.toFixed(1)}% of fiscal month</span>
        </div>
        <div style={{ height: "8px", background: "var(--bg-tertiary)", borderRadius: "var(--radius-sm, 6px)", overflow: "hidden" }}>
          <div style={{ width: `${monthBarW}%`, height: "100%", background: "#d97706", borderRadius: "var(--radius-sm, 6px)", transition: "width 0.6s" }} />
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
            <div key={i} style={{ background: "var(--bg-primary)", border: `1px solid ${color}25`, borderRadius: "var(--radius-md, 10px)", padding: "1rem", borderTop: `3px solid ${color}` }}>
              {/* Metric label */}
              <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.84rem", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "0.75rem" }}>{m.label}</div>

              {/* Actual so far */}
              <div style={{ marginBottom: "0.6rem" }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.2rem" }}>
                  <span style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.75rem", color: "var(--text-dim)" }}>Actual · {pctElapsed.toFixed(1)}% thru</span>
                  <span style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.87rem", color: "var(--text-primary)", fontWeight: 600 }}>{Math.round(m.actual).toLocaleString()}</span>
                </div>
                <div style={{ height: "4px", background: "var(--bg-tertiary)", borderRadius: "2px", overflow: "hidden" }}>
                  <div style={{ width: `${actualBarW}%`, height: "100%", background: "var(--text-dim)", borderRadius: "2px" }} />
                </div>
              </div>

              {/* Projected EOM */}
              <div style={{ marginBottom: "0.75rem" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: "0.2rem" }}>
                  <span style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.75rem", color: "var(--text-dim)" }}>Proj. end-of-month</span>
                  <span style={{ fontFamily: "var(--font-display, Inter, sans-serif)", fontSize: "1.95rem", color, fontWeight: 700, lineHeight: 1 }}>{p.projected.toLocaleString()}</span>
                </div>
                <div style={{ height: "6px", background: "var(--bg-tertiary)", borderRadius: "3px", overflow: "hidden" }}>
                  <div style={{ width: `${projBarW}%`, height: "100%", background: color, borderRadius: "3px", transition: "width 0.6s" }} />
                </div>
              </div>

              {/* Bottom stats: % of plan + gap/pace */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", borderTop: `1px solid ${color}22`, paddingTop: "0.5rem" }}>
                <div>
                  <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.98rem", color, fontWeight: 700 }}>
                    {Math.round(p.projectedPct)}% of plan
                  </div>
                  <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.78rem", color: isAhead ? "#16a34a" : "#dc2626", marginTop: "0.1rem" }}>
                    {isAhead ? "▲ +" : "▼ "}{Math.abs(p.delta).toLocaleString()} vs plan
                  </div>
                </div>
                <div style={{ textAlign: "right" }}>
                  {!isAhead && p.requiredDaily !== null ? (
                    <>
                      <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.72rem", color: "var(--text-dim)" }}>need/day to close</div>
                      <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.85rem", color: "#dc2626", fontWeight: 700 }}>{Math.ceil(p.requiredDaily).toLocaleString()}</div>
                    </>
                  ) : (
                    <>
                      <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.72rem", color: "var(--text-dim)" }}>pace / day</div>
                      <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.85rem", color: "#16a34a", fontWeight: 700 }}>{Math.round(p.dailyRate).toLocaleString()}</div>
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
      <div style={{ background: `var(--bg-secondary)`, border: "1px solid var(--border)", borderRadius: "var(--radius-lg, 16px)", padding: "2rem", textAlign: "center" }}>
        <div style={{ color: `var(--text-faint)`, fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.92rem" }}>No goal data loaded.</div>
        <div style={{ color: `var(--text-faint)`, fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.8rem", marginTop: "0.4rem" }}>Upload a goals CSV using the ⊕ GOALS button above.</div>
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
        <div key={h} style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.82rem", color: `var(--text-faint)`, textTransform: "uppercase", letterSpacing: "0.08em", textAlign: h === "Metric" || h === "" ? "left" : "right" }}>{h}</div>
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
        <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.8rem", color: `var(--text-muted)` }}>{metric.label}</div>
        <div style={{ background: `var(--bg-tertiary)`, borderRadius: "3px", height: "5px", overflow: "hidden" }}>
          <div style={{ width: `${Math.min(attain || 0, 100)}%`, height: "100%", background: isNoData ? `var(--border)` : color, borderRadius: "3px", transition: "width 0.5s ease" }} />
        </div>
        <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.78rem", color: `var(--text-dim)`, textAlign: "right" }}>{goalNum > 0 ? fmtGoal(goalNum, metric.fmt) : "—"}</div>
        <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.78rem", color: isNoData ? `var(--text-faint)` : `var(--text-primary)`, textAlign: "right", fontStyle: isNoData ? "italic" : "normal" }}>
          {isNoData ? "no data" : fmtGoal(actualNum, metric.fmt)}
        </div>
        <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.82rem", color, textAlign: "right", fontWeight: 700 }}>
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
    const allRegions = [...new Set(agents.map(a => (a.region || "Unknown")))];
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
      <div style={{ background: `var(--bg-secondary)`, border: "1px solid var(--border)", borderRadius: "var(--radius-lg, 16px)", padding: "1.5rem", display: "flex", flexDirection: "column", gap: "1.25rem" }}>
        {/* TA header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.82rem", color: `var(--text-muted)`, letterSpacing: "0.12em", textTransform: "uppercase" }}>
              Target{funding ? ` \u2014 ${funding}` : ""}
            </div>
            <div style={{ fontFamily: "var(--font-display, Inter, sans-serif)", fontSize: "1.5rem", color: `var(--text-warm)`, fontWeight: 700, lineHeight: 1.1 }}>
              {targetAudience}
              {roc && <span style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.8rem", color: `var(--text-dim)`, marginLeft: "0.75rem", fontWeight: 400 }}>{roc}</span>}
            </div>
          </div>
          <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.78rem", color: `var(--text-dim)` }}>
            {agents.length} agents · {fmt(agents.reduce((s,a)=>s+a.hours,0),0)} total hrs
          </div>
        </div>

        {/* Global rollup for this TA */}
        <div>
          <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.8rem", color: `var(--text-muted)`, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: "0.75rem" }}>All Sites Combined</div>
          <ColHeaders />
          {filteredMetrics.map(m => (
            <MetricRow key={m.goalKey} metric={m} planVal={globalPlan[m.goalKey]} actual={getActual(agents, m.actualKey)} />
          ))}
        </div>

        {/* Per-site breakdown */}
        {SITE_DEFS.length > 1 && (
          <div>
            <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.8rem", color: `var(--text-muted)`, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: "0.75rem" }}>By Site</div>
            {SITE_DEFS.map(s => {
              const sAgents  = agents.filter(a => s.regions.includes((a.region || "Unknown")));
              const hasPlan  = s.rows && s.rows.length > 0;
              const sitePlan = {};
              if (hasPlan) filteredMetrics.forEach(m => { sitePlan[m.goalKey] = planFromRows(s.rows, m); });
              const isBzSub = !hasPlan && bzRegions.includes(s.label);
              return (
                <div key={s.label} style={{ marginBottom: "1.5rem" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "0.6rem" }}>
                    <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.8rem", color: s.label.includes("Combined") ? "#16a34a" : "#d97706", background: s.label.includes("Combined") ? "#16a34a15" : "#d9770615", border: `1px solid ${s.label.includes("Combined") ? "#16a34a30" : "#d9770630"}`, borderRadius: "var(--radius-sm, 6px)", padding: "0.15rem 0.5rem" }}>{mbrSiteName(s.label)}</div>
                    <span style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.78rem", color: `var(--text-dim)` }}>
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
        <div style={{ background: `var(--bg-secondary)`, border: "1px solid var(--border)", borderRadius: "var(--radius-lg, 16px)", padding: "1.5rem" }}>
          <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.82rem", color: `var(--text-muted)`, letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: "1rem" }}>
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
                    <span style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.92rem", color: `var(--text-warm)`, fontWeight: 700 }}>{p.name}</span>
                    {p.roc && <span style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.9rem", color: `var(--text-dim)`, marginLeft: "0.5rem" }}>{p.roc}</span>}
                    {p.funding && <span style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.85rem", color: `var(--text-faint)`, marginLeft: "0.5rem" }}>({p.funding})</span>}
                  </div>
                  <span style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.78rem", color: statusColor, fontWeight: 700, background: statusColor + "15", border: `1px solid ${statusColor}30`, borderRadius: "var(--radius-sm, 6px)", padding: "0.2rem 0.6rem" }}>{statusLabel}</span>
                </div>

                {/* Progress bar */}
                <div style={{ position: "relative", height: "28px", background: `var(--bg-tertiary)`, borderRadius: "6px", overflow: "hidden", marginBottom: "0.5rem" }}>
                  <div style={{ position: "absolute", left: 0, top: 0, height: "100%", width: `${Math.min(attain, 100)}%`, background: statusColor + "40", borderRadius: "6px", transition: "width 0.5s" }} />
                  <div style={{ position: "absolute", left: `${Math.min(p.pctElapsed, 100)}%`, top: 0, height: "100%", width: "2px", background: `var(--text-faint)` }} />
                  <div style={{ position: "absolute", left: 0, top: 0, height: "100%", display: "flex", alignItems: "center", padding: "0 0.75rem", fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.9rem", color: `var(--text-warm)`, fontWeight: 700 }}>
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
                    <div key={m.label} style={{ padding: "0.6rem", borderRadius: "var(--radius-md, 10px)", background: m.color + "08", border: `1px solid ${m.color}20` }}>
                      <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.8rem", color: `var(--text-faint)`, letterSpacing: "0.05em", textTransform: "uppercase" }}>{m.label}</div>
                      <div style={{ fontFamily: "var(--font-display, Inter, sans-serif)", fontSize: "1.5rem", color: m.color, fontWeight: 700, lineHeight: 1 }}>{m.value}</div>
                      <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.8rem", color: `var(--text-dim)`, marginTop: "0.15rem" }}>{m.sub}</div>
                    </div>
                  ))}
                </div>

                {/* Per-site pacing */}
                {p.sites.length > 1 && (
                  <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.9rem" }}>
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
                            <td style={{ padding: "0.3rem 0.5rem", color: s.label === "BZ" ? "#16a34a" : "#6366f1", fontWeight: 700 }}>{s.label === "BZ" ? "Belize" : mbrSiteName(s.label)}</td>
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

function DropZone({ onData, onAgentText, goalsRaw, onGoalsLoad, onGoalsText, newHiresRaw, onNewHiresLoad, onNHText }) {
  const [draggingAgent, setDraggingAgent] = useState(false);
  const [draggingGoals, setDraggingGoals] = useState(false);
  const [draggingNH,    setDraggingNH]    = useState(false);
  const [pasteMode, setPasteMode] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [pasteTarget, setPasteTarget] = useState(null); // "agent" | "goals" | "nh"
  const agentRef = useRef();
  const goalsRef = useRef();
  const nhRef    = useRef();

  const readFile = (f, cb, textCb) => { const r = new FileReader(); r.onload = e => { const t = e.target.result; if (textCb) textCb(t); cb(parseCSV(t)); }; r.readAsText(f); };
  const handlePasteSubmit = () => {
    if (!pasteText.trim()) return;
    const rows = parseCSV(pasteText);
    if (rows.length === 0) return;
    if (pasteTarget === "agent") { if (onAgentText) onAgentText(pasteText); onData(rows); }
    else if (pasteTarget === "goals") { if (onGoalsText) onGoalsText(pasteText); onGoalsLoad(rows); }
    else if (pasteTarget === "nh") { if (onNHText) onNHText(pasteText); onNewHiresLoad(rows); }
    setPasteMode(false); setPasteText(""); setPasteTarget(null);
  };

  const MiniDrop = ({ label, num, icon, color, dragging, onDragOver, onDragLeave, onDrop, onClick, inputRef, onChange, loaded, loadedLabel, hint }) => (
    <div>
      <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.72rem", color: loaded ? color : `var(--text-muted)`, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: "0.5rem", fontWeight: 600 }}>
        {label} {!loaded && <span style={{ color: `var(--text-faint)`, fontWeight: 400 }}>optional</span>}
        {loaded && <span style={{ marginLeft: "0.35rem" }}>{"\u2713"}</span>}
      </div>
      <div onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop} onClick={onClick}
        style={{ border: `1.5px dashed ${loaded ? color+"40" : dragging ? color : `var(--border-muted)`}`, borderRadius: "var(--radius-lg, 16px)", padding: "1.75rem 1rem", textAlign: "center", cursor: "pointer", background: loaded ? color+"08" : dragging ? color+"06" : `var(--glass-bg)`, backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)", transition: "all 250ms cubic-bezier(0.4,0,0.2,1)", minHeight: "120px", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", boxShadow: loaded ? `0 0 16px ${color}10` : "var(--card-glow)" }}>
        <div style={{ width: "36px", height: "36px", borderRadius: "var(--radius-md, 10px)", background: loaded ? color+"15" : `var(--bg-tertiary)`, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: "0.65rem", border: `1px solid ${loaded ? color+"25" : "var(--border-muted)"}` }}>
          <span style={{ fontSize: "1.1rem" }}>{loaded ? "\u2713" : icon}</span>
        </div>
        {loaded
          ? <div style={{ color, fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.85rem", fontWeight: 500 }}>{loadedLabel}</div>
          : <div style={{ color: `var(--text-secondary)`, fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.9rem" }}>Drop CSV or <span style={{ color, fontWeight: 600 }}>browse</span></div>}
        <div style={{ fontFamily: "var(--font-data, monospace)", fontSize: "0.7rem", color: `var(--text-faint)`, marginTop: "0.3rem" }}>{loaded ? "click to replace" : hint}</div>
        <input ref={inputRef} type="file" accept=".csv" style={{ display: "none" }} onChange={onChange} />
      </div>
    </div>
  );

  return (
    <div style={{ minHeight: "100vh", background: `var(--bg-primary)`, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-start", padding: "3.5rem 2rem 4rem", overflowY: "auto" }}>
      <div style={{ textAlign: "center", marginBottom: "3rem", animation: "fadeInUp 0.6s cubic-bezier(0.4,0,0.2,1)" }}>
        <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.72rem", color: "#d97706", letterSpacing: "0.25em", textTransform: "uppercase", marginBottom: "1.25rem", fontWeight: 600 }}>Campaign Intelligence Suite</div>
        <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "4.5rem", fontWeight: 800, color: `var(--text-warm)`, letterSpacing: "-0.03em", lineHeight: 0.95 }}>
          Performance<br /><span style={{ background: "linear-gradient(135deg, #d97706, #f59e0b)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text" }}>Insights</span>
        </div>
        <div style={{ color: `var(--text-dim)`, fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.85rem", marginTop: "1.25rem", fontWeight: 400 }}>
          Load your files below, then generate your program analysis.
        </div>
      </div>

      <div style={{ width: "100%", maxWidth: "720px", marginBottom: "1.25rem", animation: "fadeInUp 0.6s cubic-bezier(0.4,0,0.2,1) 0.1s both" }}>
        <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.72rem", color: "#d97706", letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: "0.6rem", fontWeight: 600 }}>
          Agent Data <span style={{ color: "#dc2626", fontWeight: 500 }}>required</span>
        </div>
        <div
          onDragOver={e => { e.preventDefault(); setDraggingAgent(true); }}
          onDragLeave={() => setDraggingAgent(false)}
          onDrop={e => { e.preventDefault(); setDraggingAgent(false); readFile(e.dataTransfer.files[0], onData, onAgentText); }}
          onClick={() => agentRef.current.click()}
          style={{ border: `2px dashed ${draggingAgent ? "#d97706" : `var(--border-muted)`}`, borderRadius: "var(--radius-lg, 16px)", padding: "2.5rem 2rem", textAlign: "center", cursor: "pointer", background: draggingAgent ? "#d9770608" : `var(--glass-bg)`, backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)", transition: "all 250ms cubic-bezier(0.4,0,0.2,1)", boxShadow: draggingAgent ? "0 0 24px rgba(217,119,6,0.15)" : "var(--card-glow)" }}>
          <div style={{ width: "48px", height: "48px", borderRadius: "var(--radius-lg, 16px)", background: "#d9770612", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 1rem", border: "1px solid #d9770620" }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#d97706" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
          </div>
          <div style={{ color: `var(--text-secondary)`, fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.85rem", fontWeight: 400 }}>Drop your agent CSV here, or <span style={{ color: "#d97706", fontWeight: 600 }}>click to browse</span></div>
          <div style={{ fontFamily: "var(--font-data, monospace)", fontSize: "0.75rem", color: `var(--text-faint)`, marginTop: "0.5rem", letterSpacing: "0.02em" }}>Job Type · Region · AgentName · Hours · Goals · GPH · % to Goal</div>
          <input ref={agentRef} type="file" accept=".csv" style={{ display: "none" }} onChange={e => readFile(e.target.files[0], onData, onAgentText)} />
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1.25rem", width: "100%", maxWidth: "720px", marginBottom: "2rem" }}>
        <MiniDrop
          label="Goals File" num="②" icon="🎯" color="#16a34a"
          dragging={draggingGoals}
          onDragOver={e => { e.preventDefault(); setDraggingGoals(true); }}
          onDragLeave={() => setDraggingGoals(false)}
          onDrop={e => { e.preventDefault(); setDraggingGoals(false); readFile(e.dataTransfer.files[0], onGoalsLoad, onGoalsText); }}
          onClick={() => goalsRef.current.click()}
          inputRef={goalsRef}
          onChange={e => readFile(e.target.files[0], onGoalsLoad, onGoalsText)}
          loaded={!!goalsRaw}
          loadedLabel={`${goalsRaw?.length || 0} rows · saved locally · click to replace`}
          hint="Unlocks Goals tab per program"
        />
        <MiniDrop
          label="Roster CSV" num="③" icon="🌱" color="#d97706"
          dragging={draggingNH}
          onDragOver={e => { e.preventDefault(); setDraggingNH(true); }}
          onDragLeave={() => setDraggingNH(false)}
          onDrop={e => { e.preventDefault(); setDraggingNH(false); readFile(e.dataTransfer.files[0], onNewHiresLoad, onNHText); }}
          onClick={() => nhRef.current.click()}
          inputRef={nhRef}
          onChange={e => readFile(e.target.files[0], onNewHiresLoad, onNHText)}
          loaded={!!newHiresRaw}
          loadedLabel={`${newHiresRaw?.length || 0} rows · roster saved`}
          hint="Columns: First Name, Last Name, Hire Date, End Date"
        />
      </div>

      {!newHiresRaw && (
        <div style={{ width: "100%", maxWidth: "720px", background: `var(--bg-secondary)`, border: "1px solid var(--border)", borderRadius: "var(--radius-md, 10px)", padding: "0.85rem 1.25rem", marginBottom: "2rem", display: "flex", gap: "1rem", alignItems: "center" }}>
          <span style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.82rem", color: `var(--text-dim)` }}>ROSTER FORMAT →</span>
          <code style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.82rem", color: `var(--text-muted)` }}>First Name, Last Name, Hire Date, End Date</code>
          <code style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.82rem", color: `var(--text-faint)` }}>Agents hired within 180 days auto-flagged as new hires</code>
        </div>
      )}

      {/* Mobile paste modal */}
      {pasteMode && (
        <div style={{ position: "fixed", inset: 0, zIndex: 999, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem" }}
          onClick={e => { if (e.target === e.currentTarget) { setPasteMode(false); setPasteTarget(null); } }}>
          <div style={{ background: `var(--bg-primary)`, border: "1px solid var(--border)", borderRadius: "var(--radius-lg, 16px)", padding: "1.5rem", width: "100%", maxWidth: "600px", maxHeight: "80vh", display: "flex", flexDirection: "column" }}>
            <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.8rem", color: "#d97706", letterSpacing: "0.1em", marginBottom: "0.75rem" }}>
              PASTE {pasteTarget === "agent" ? "AGENT DATA" : pasteTarget === "goals" ? "GOALS" : "ROSTER"} CSV
            </div>
            <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.9rem", color: `var(--text-dim)`, marginBottom: "0.5rem" }}>
              Open the CSV file, Select All, Copy, then paste below
            </div>
            <textarea value={pasteText} onChange={e => setPasteText(e.target.value)}
              placeholder="Paste CSV content here..."
              style={{ flex: 1, minHeight: "200px", fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.9rem", background: `var(--bg-secondary)`, color: `var(--text-primary)`, border: "1px solid var(--border)", borderRadius: "var(--radius-md, 10px)", padding: "0.75rem", resize: "vertical" }} />
            <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.75rem", justifyContent: "flex-end" }}>
              <button onClick={() => { setPasteMode(false); setPasteTarget(null); setPasteText(""); }}
                style={{ padding: "0.4rem 1rem", borderRadius: "6px", border: "1px solid var(--border)", background: "transparent", color: `var(--text-muted)`, fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.8rem", cursor: "pointer" }}>Cancel</button>
              <button onClick={handlePasteSubmit}
                style={{ padding: "0.4rem 1rem", borderRadius: "6px", border: "1px solid #d97706", background: "#d9770618", color: "#d97706", fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.8rem", cursor: "pointer", fontWeight: 600 }}>Load Data</button>
            </div>
          </div>
        </div>
      )}

      {/* Mobile helper: paste buttons below the main drop zones */}
      <div style={{ width: "100%", maxWidth: "720px", display: "flex", gap: "0.5rem", flexWrap: "wrap", marginBottom: "1.25rem", justifyContent: "center" }}>
        <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.88rem", color: `var(--text-faint)`, width: "100%", textAlign: "center", marginBottom: "0.25rem" }}>On mobile? Paste CSV text instead</div>
        <button onClick={() => { setPasteTarget("agent"); setPasteMode(true); }}
          style={{ padding: "0.35rem 0.8rem", borderRadius: "var(--radius-sm, 6px)", border: "1px solid #d97706", background: "transparent", color: "#d97706", fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.78rem", cursor: "pointer" }}>
          Paste Agent Data
        </button>
        <button onClick={() => { setPasteTarget("goals"); setPasteMode(true); }}
          style={{ padding: "0.35rem 0.8rem", borderRadius: "var(--radius-sm, 6px)", border: "1px solid #16a34a", background: "transparent", color: "#16a34a", fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.78rem", cursor: "pointer" }}>
          Paste Goals
        </button>
        <button onClick={() => { setPasteTarget("nh"); setPasteMode(true); }}
          style={{ padding: "0.35rem 0.8rem", borderRadius: "var(--radius-sm, 6px)", border: "1px solid #6366f1", background: "transparent", color: "#6366f1", fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.78rem", cursor: "pointer" }}>
          Paste Roster
        </button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "0.6rem", maxWidth: "720px", width: "100%", animation: "fadeInUp 0.6s cubic-bezier(0.4,0,0.2,1) 0.3s both" }}>
        {[
          ["Job Type", "One slide per program"],
          ["Region",   "Dom. Republic / BZ sites"],
          ["% to Goal","Quartile ranking engine"],
          ["AgentName / Hours","Agent-level detail & flags"],
          ["Goals / GPH","Conversion metrics"],
          ["New XI / XM Lines","Optional sub-metrics"],
        ].map(([title, desc]) => (
          <div key={title} style={{ background: `var(--glass-bg-subtle)`, backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)", border: "1px solid var(--glass-border)", borderRadius: "var(--radius-md, 10px)", padding: "0.75rem 1rem" }}>
            <div style={{ fontFamily: "var(--font-data, monospace)", fontSize: "0.72rem", color: "#d97706", letterSpacing: "0.06em", marginBottom: "0.2rem", fontWeight: 500 }}>{title}</div>
            <div style={{ color: `var(--text-muted)`, fontSize: "0.85rem", fontFamily: "var(--font-ui, Inter, sans-serif)" }}>{desc}</div>
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

function RankingAgentTray({ sup, colCount, allAgents }) {
  const [expandedAgent, setExpandedAgent] = useState(null);

  const agentList = Object.entries(sup.agents).map(([name, ag]) => {
    const gph = ag.hours > 0 ? ag.goals / ag.hours : 0;
    const cps = ag.goals > 0 ? (ag.hours * 19.77) / ag.goals : ag.hours * 19.77;
    const pct = ag.goalsNum > 0 ? (ag.goals / ag.goalsNum) * 100 : null;
    // Check if agent works multiple campaigns
    const campaigns = allAgents ? (() => {
      const rows = allAgents.filter(r => r.agentName === name);
      const byJob = {};
      rows.forEach(r => {
        const jt = r.jobType || "Unknown";
        if (!byJob[jt]) byJob[jt] = { jobType: jt, hours: 0, goals: 0, goalsNum: 0, newXI: 0, xmLines: 0 };
        byJob[jt].hours += r.hours; byJob[jt].goals += r.goals; byJob[jt].goalsNum += r.goalsNum || 0;
        byJob[jt].newXI += r.newXI || 0; byJob[jt].xmLines += r.xmLines || 0;
      });
      return Object.values(byJob).map(j => ({
        ...j,
        gph: j.hours > 0 ? j.goals / j.hours : 0,
        cps: j.goals > 0 ? (j.hours * 19.77) / j.goals : j.hours * 19.77,
        pct: j.goalsNum > 0 ? (j.goals / j.goalsNum) * 100 : null,
      })).sort((a, b) => b.hours - a.hours);
    })() : [];
    const multiCampaign = campaigns.length > 1;
    return { name, ...ag, gph, cps, pct, campaigns, multiCampaign };
  }).sort((a, b) => b.hours - a.hours);

  return (
    <tr><td colSpan={colCount} style={{ padding: 0 }}>
      <div style={{ padding: "0.4rem 0.75rem 0.6rem 2rem", background: "var(--bg-secondary)", borderBottom: "2px solid var(--border)", borderLeft: "3px solid #6366f140" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.85rem" }}>
          <thead><tr style={{ borderBottom: "1px solid var(--border)" }}>
            {["Agent", "Program", "Hours", "Sales", "GPH", "% Goal", "CPS"].map(h => (
              <th key={h} style={{ padding: "0.2rem 0.4rem", textAlign: h === "Agent" ? "left" : "right", color: `var(--text-faint)`, fontWeight: 400 }}>{h}</th>
            ))}
          </tr></thead>
          <tbody>
            {agentList.map((a, ai) => {
              const pColor = a.pct !== null ? attainColor(a.pct) : (a.gph > 0 ? `var(--text-dim)` : `var(--text-faint)`);
              const isExpanded = expandedAgent === a.name;
              return (
                <Fragment key={a.name}>
                  <tr onClick={a.multiCampaign ? () => setExpandedAgent(isExpanded ? null : a.name) : undefined}
                    style={{ borderBottom: "1px solid var(--border)", background: isExpanded ? "#6366f115" : ai % 2 === 0 ? "transparent" : `var(--bg-row-alt)`, cursor: a.multiCampaign ? "pointer" : "default" }}>
                    <td style={{ padding: "0.2rem 0.4rem", color: `var(--text-warm)`, fontFamily: "var(--font-ui, Inter, sans-serif)" }}>
                      {a.multiCampaign && <span style={{ color: `var(--text-faint)`, marginRight: "0.3rem", fontSize: "0.75rem" }}>{isExpanded ? "\u25BE" : "\u25B8"}</span>}
                      {a.name}
                      {a.multiCampaign && <span style={{ marginLeft: "0.3rem", fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.72rem", color: "#6366f1", background: "#6366f112", border: "1px solid #6366f130", borderRadius: "2px", padding: "0.02rem 0.2rem" }}>{a.campaigns.length} pgms</span>}
                    </td>
                    <td style={{ padding: "0.2rem 0.4rem", color: `var(--text-dim)`, fontSize: "0.82rem" }}></td>
                    <td style={{ padding: "0.2rem 0.4rem", textAlign: "right", color: "#6366f1" }}>{fmt(a.hours, 1)}</td>
                    <td style={{ padding: "0.2rem 0.4rem", textAlign: "right", color: a.goals > 0 ? "#d97706" : `var(--text-faint)`, fontWeight: a.goals > 0 ? 700 : 400 }}>{a.goals || "\u2014"}</td>
                    <td style={{ padding: "0.2rem 0.4rem", textAlign: "right", color: pColor, fontWeight: 600 }}>{a.gph > 0 ? a.gph.toFixed(3) : "\u2014"}</td>
                    <td style={{ padding: "0.2rem 0.4rem", textAlign: "right" }}>
                      {a.pct !== null ? <span style={{ color: pColor, fontWeight: 700, fontSize: "0.82rem" }}>{Math.round(a.pct)}%</span> : "\u2014"}
                    </td>
                    <td style={{ padding: "0.2rem 0.4rem", textAlign: "right", color: pColor }}>${a.cps.toFixed(2)}</td>
                  </tr>
                  {isExpanded && a.campaigns.map(c => {
                    const cColor = c.pct !== null ? attainColor(c.pct) : (c.gph > 0 ? `var(--text-dim)` : `var(--text-faint)`);
                    return (
                      <tr key={c.jobType} style={{ background: "#6366f10a", borderBottom: "1px solid var(--border)" }}>
                        <td></td>
                        <td style={{ padding: "0.25rem 0.4rem", color: `var(--text-muted)`, fontSize: "0.92rem" }}>
                          {"\u2514"} {c.jobType}
                        </td>
                        <td style={{ padding: "0.25rem 0.4rem", textAlign: "right", color: "#6366f1", fontSize: "0.92rem" }}>{fmt(c.hours, 1)}</td>
                        <td style={{ padding: "0.25rem 0.4rem", textAlign: "right", color: c.goals > 0 ? "#d97706" : `var(--text-faint)`, fontSize: "0.92rem" }}>{c.goals || "\u2014"}</td>
                        <td style={{ padding: "0.25rem 0.4rem", textAlign: "right", color: cColor, fontSize: "0.92rem" }}>{c.gph > 0 ? c.gph.toFixed(3) : "\u2014"}</td>
                        <td style={{ padding: "0.25rem 0.4rem", textAlign: "right", fontSize: "0.92rem" }}>
                          {c.pct !== null ? <span style={{ color: cColor, fontSize: "0.88rem" }}>{Math.round(c.pct)}%</span> : "\u2014"}
                        </td>
                        <td style={{ padding: "0.25rem 0.4rem", textAlign: "right", color: cColor, fontSize: "0.92rem" }}>${c.cps.toFixed(2)}</td>
                      </tr>
                    );
                  })}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </td></tr>
  );
}

function SiteDrilldown({ siteLabel, regions, allAgents, programs, goalLookup, newHireSet, fiscalInfo }) {
  const [subRegion, setSubRegion] = useState(null);
  const [siteRankSort, setSiteRankSort] = useState({ key: "pctToGoal", dir: -1 });
  const [expandedSup, setExpandedSup] = useState(null);
  const [dtFundingFilter, setDtFundingFilter] = useState(null);
  const [rankView, setRankView] = useState("supervisors"); // "supervisors" | "agents"
  const [siteAgentSort, setSiteAgentSort] = useState({ key: "hours", dir: -1 });
  const [siteExpandedAgent, setSiteExpandedAgent] = useState(null);
  const hasMultipleRegions = regions.length > 1;

  const activeRegions = (subRegion && hasMultipleRegions) ? [subRegion] : regions;
  const agents   = allAgents.filter(a => !a.isSpanishCallback && activeRegions.includes((a.region || "Unknown")));
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

  // Per-funding-source capped actuals for gainshare
  // Each funding source's unit contribution is capped at 100% of its plan
  const siteCapped = (() => {
    if (!goalLookup || !sitePlanMetrics) return null;
    const fg = {};
    Object.values(goalLookup.byTA || {}).forEach(siteMap => {
      (siteMap[sitePlanKey] || []).forEach(r => {
        const f = r._funding || "Unknown";
        const roc = (r._roc || "").toUpperCase();
        if (!fg[f]) fg[f] = { homes: 0, hsd: 0, xm: 0, rgu: 0, hours: 0, rocs: new Set() };
        const p = computePlanRow(r);
        fg[f].homes += p.homesGoal; fg[f].hsd += p.hsdGoal;
        fg[f].xm += p.xmGoal; fg[f].rgu += p.rguGoal;
        fg[f].hours += p.hoursGoal;
        if (roc) fg[f].rocs.add(roc);
      });
    });
    const matched = new Set();
    let cHomes = 0, cHsd = 0, cXm = 0, cRgu = 0;
    const proj = { homes: [], hsd: [], xm: [], rgu: [], hours: [] };
    Object.values(fg).forEach(g => {
      g.rocs.forEach(r => matched.add(r));
      const fa = agents.filter(a => g.rocs.has((a.rocCode || "").toUpperCase()));
      const aH = fa.reduce((s, a) => s + a.goals, 0);
      const aD = fa.reduce((s, a) => s + a.newXI, 0);
      const aX = fa.reduce((s, a) => s + a.xmLines, 0);
      const aR = fa.reduce((s, a) => s + a.rgu, 0);
      const aHrs = fa.reduce((s, a) => s + a.hours, 0);
      cHomes += g.homes > 0 ? Math.min(aH, g.homes) : aH;
      cHsd   += g.hsd   > 0 ? Math.min(aD, g.hsd)   : aD;
      cXm    += g.xm    > 0 ? Math.min(aX, g.xm)    : aX;
      cRgu   += g.rgu   > 0 ? Math.min(aR, g.rgu)    : aR;
      proj.homes.push({ actual: aH, plan: g.homes });
      proj.hsd.push({ actual: aD, plan: g.hsd });
      proj.xm.push({ actual: aX, plan: g.xm });
      proj.rgu.push({ actual: aR, plan: g.rgu });
      proj.hours.push({ actual: aHrs, plan: g.hours });
    });
    const um = agents.filter(a => !matched.has((a.rocCode || "").toUpperCase()));
    if (um.length) {
      const uH = um.reduce((s, a) => s + a.goals, 0);
      const uD = um.reduce((s, a) => s + a.newXI, 0);
      const uX = um.reduce((s, a) => s + a.xmLines, 0);
      const uR = um.reduce((s, a) => s + a.rgu, 0);
      const uHrs = um.reduce((s, a) => s + a.hours, 0);
      cHomes += uH; cHsd += uD; cXm += uX; cRgu += uR;
      proj.homes.push({ actual: uH, plan: 0 });
      proj.hsd.push({ actual: uD, plan: 0 });
      proj.xm.push({ actual: uX, plan: 0 });
      proj.rgu.push({ actual: uR, plan: 0 });
      proj.hours.push({ actual: uHrs, plan: 0 });
    }
    return { homes: cHomes, hsd: cHsd, xm: cXm, rgu: cRgu, proj };
  })();

  // Capped projected attainment per funding source
  const cappedProjAttain = (groups, totalPlan) => {
    if (!fiscalInfo?.elapsedBDays || !fiscalInfo?.totalBDays || !totalPlan) return null;
    let cp = 0;
    groups.forEach(g => {
      const projected = (g.actual / fiscalInfo.elapsedBDays) * fiscalInfo.totalBDays;
      cp += g.plan > 0 ? Math.min(projected, g.plan) : projected;
    });
    return (cp / totalPlan) * 100;
  };

  // Gainshare attainments for the site (site-tier table) — uses raw actuals
  const siteMobileAttain  = sitePlanMetrics && sitePlanMetrics.goals > 0 ? (totalG       / sitePlanMetrics.goals) * 100 : null;
  const siteHsdAttain     = sitePlanMetrics && sitePlanMetrics.hsd   > 0 ? (siteActHsd   / sitePlanMetrics.hsd)   * 100 : null;
  const siteCostPerAttain = sitePlanMetrics && sitePlanMetrics.rgu   > 0 ? (siteActRgu   / sitePlanMetrics.rgu)   * 100 : null;

  // Capped projections: each funding source's projected EOM is capped at 100% of its plan
  const siteProjMobileCapped = siteCapped ? cappedProjAttain(siteCapped.proj.homes, sitePlanMetrics?.goals) : null;
  const siteProjHsdCapped    = siteCapped ? cappedProjAttain(siteCapped.proj.hsd,   sitePlanMetrics?.hsd)   : null;
  const siteProjCostPerCapped = siteCapped ? cappedProjAttain(siteCapped.proj.rgu,  sitePlanMetrics?.rgu)   : null;
  const siteProjHourCapped   = siteCapped ? cappedProjAttain(siteCapped.proj.hours, sitePlanMetrics?.hours) : null;

  // SPH Attainment for this site
  const siteActualSph = totalHrs > 0 ? totalG / totalHrs : 0;
  const sitePlanSph = sitePlanMetrics && sitePlanMetrics.hours > 0 && sitePlanMetrics.goals > 0 ? sitePlanMetrics.goals / sitePlanMetrics.hours : null;
  const siteSphAttain = sitePlanSph ? (siteActualSph / sitePlanSph) * 100 : null;

  // Hour Attainment gate for this site
  const siteHourAttain = sitePlanMetrics && sitePlanMetrics.hours > 0 ? (totalHrs / sitePlanMetrics.hours) * 100 : null;

  const regionStats = regions.map(r => {
    const ra = allAgents.filter(a => (a.region || "Unknown") === r);
    const rg = ra.reduce((s, a) => s + a.goals, 0);
    const rh = ra.reduce((s, a) => s + a.hours, 0);
    const rd = uniqueQuartileDist(ra);
    const ru = uniqueNames(ra).size;
    return { name: r, agents: ra, goals: rg, hours: rh, dist: rd, unique: ru, gph: rh > 0 ? rg / rh : 0 };
  });

  const sitePrograms = programs.map(p => {
    const pa = p.agents.filter(a => activeRegions.includes((a.region || "Unknown")));
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

    // Breakout by ROC within this site (preserves NAT vs HQ even when target names match)
    const goalBreakout = [];
    const rocGroups = {};
    siteRows.forEach(r => {
      const key = r._roc || r._target || "Unknown";
      if (!rocGroups[key]) rocGroups[key] = { target: r._target || "Unknown", roc: r._roc || "", funding: r._funding || "", rows: [] };
      rocGroups[key].rows.push(r);
    });
    Object.values(rocGroups).forEach(g => {
      const pr = g.rows.map(r => computePlanRow(r));
      goalBreakout.push({
        target: g.target, roc: g.roc, funding: g.funding,
        homes: pr.reduce((s, p2) => s + p2.homesGoal, 0),
        hours: pr.reduce((s, p2) => s + p2.hoursGoal, 0),
        hsd: pr.reduce((s, p2) => s + p2.hsdGoal, 0),
        xm: pr.reduce((s, p2) => s + p2.xmGoal, 0),
        rgu: pr.reduce((s, p2) => s + p2.rguGoal, 0),
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

  const displayLabel = mbrSiteName(subRegion || siteLabel);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>

      {/* Sub-region tabs — only shown when group has multiple regions */}
      {hasMultipleRegions && (
        <div style={{ background: `var(--bg-secondary)`, border: "1px solid var(--border)", borderRadius: "var(--radius-lg, 16px)", padding: "1.25rem" }}>
          <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.82rem", color: `var(--text-muted)`, letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: "0.9rem" }}>Site Breakdown</div>
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginBottom: "1rem" }}>
            <button onClick={() => setSubRegion(null)}
              style={{ padding: "0.35rem 0.9rem", borderRadius: "6px", border: `1px solid ${!subRegion?"#d97706":`var(--border)`}`, background: !subRegion?"#d9770618":"transparent", color: !subRegion?"#d97706":`var(--text-muted)`, fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.8rem", cursor: "pointer" }}>
              All Combined
            </button>
            {regions.map(r => (
              <button key={r} onClick={() => setSubRegion(r)}
                style={{ padding: "0.35rem 0.9rem", borderRadius: "6px", border: `1px solid ${subRegion===r?"#6366f1":`var(--border)`}`, background: subRegion===r?"#6366f118":"transparent", color: subRegion===r?"#818cf8":`var(--text-muted)`, fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.8rem", cursor: "pointer" }}>
                {mbrSiteName(r)}
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
                  style={{ cursor: "pointer", padding: "0.6rem 0.75rem", borderRadius: "var(--radius-md, 10px)", background: subRegion===r.name?"#6366f115":"transparent", border: `1px solid ${subRegion===r.name?"#6366f140":`var(--bg-tertiary)`}`, opacity: isActive ? 1 : 0.45, transition: "all 0.2s" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.3rem" }}>
                    <span style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.88rem", color: `var(--text-primary)` }}>{mbrSiteName(r.name)}</span>
                    <div style={{ display: "flex", gap: "1rem" }}>
                      <span style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.82rem", color: "#16a34a" }}>{r.goals.toLocaleString()} goals</span>
                      <span style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.82rem", color: `var(--text-muted)` }}>GPH {fmt(r.gph, 2)}</span>
                      <span style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.82rem", color: `var(--text-muted)` }}>{r.unique} agents</span>
                      <span style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.82rem", color: Q.Q1.color }}>Q1: {r.dist.Q1}</span>
                      <span style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.82rem", color: Q.Q4.color }}>Q4: {r.dist.Q4}</span>
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
        <StatCard label="Unique Agents" value={uCount}                   sub={`${agents.filter(a=>a.hours>=getMinHours()).length} at ${getMinHours()}+ hrs`} accent="#6366f1" />
      </div>


      {/* ── AGENTS TAB ── */}

      {/* ── OVERVIEW TAB ── */}
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
          sphAttain={siteSphAttain}
          hourAttain={siteHourAttain}
          siteMode={true}
          fiscalInfo={fiscalInfo}
          mobileActual={totalG}      mobilePlan={sitePlanMetrics?.goals || 0}
          hsdActual={siteActHsd}     hsdPlan={sitePlanMetrics?.hsd || 0}
          costPerActual={siteActRgu} costPerPlan={sitePlanMetrics?.rgu || 0}
          sphActual={siteActualSph}  sphPlan={sitePlanSph}
          hourActual={totalHrs}      hourPlan={sitePlanMetrics?.hours || 0}
          homesActual={totalG}       homesPlan={sitePlanMetrics?.goals || 0}
          projMobileCapped={siteProjMobileCapped}
          projHsdCapped={siteProjHsdCapped}
          projCostPerCapped={siteProjCostPerCapped}
          projHourCapped={siteProjHourCapped}
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
          <div style={{ background: `var(--bg-secondary)`, border: "1px solid var(--border)", borderRadius: "var(--radius-lg, 16px)", padding: "1.25rem" }}>
            <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.82rem", color: `var(--text-muted)`, letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: "0.75rem" }}>
              Supervisor Ranking {"\u2014"} {displayLabel} {siteAvgSph ? ` | Site SPH Goal: ${siteAvgSph.toFixed(3)}` : ""}
            </div>

            {/* Supervisor / Agent toggle */}
            <div style={{ display: "flex", gap: "0.35rem", marginBottom: "0.75rem" }}>
              {["supervisors", "agents"].map(v => {
                const active = rankView === v;
                return (
                  <button key={v} onClick={() => { setRankView(v); setSiteExpandedAgent(null); setExpandedSup(null); }}
                    style={{ padding: "0.2rem 0.65rem", borderRadius: "var(--radius-sm, 6px)", border: `1px solid ${active ? "#6366f1" : "var(--border)"}`, background: active ? "#6366f118" : "transparent", color: active ? "#6366f1" : `var(--text-dim)`, fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.78rem", cursor: "pointer", fontWeight: active ? 700 : 400 }}>
                    {v === "supervisors" ? "By Supervisor" : "By Agent"}
                  </button>
                );
              })}
            </div>
            {rankView === "supervisors" && (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.92rem" }}>
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
                      <Fragment key={s.name}><tr onClick={() => setExpandedSup(expandedSup === s.name ? null : s.name)} style={{ cursor: "pointer", borderBottom: "1px solid var(--bg-tertiary)", background: isTop ? "#16a34a08" : i % 2 === 0 ? "transparent" : `var(--bg-row-alt)` }}>
                        <td style={{ padding: "0.35rem 0.5rem", color: isTop ? "#16a34a" : `var(--text-dim)`, fontWeight: 700 }}>{i + 1}</td>
                        <td style={{ padding: "0.35rem 0.5rem", color: `var(--text-warm)`, fontFamily: "var(--font-ui, Inter, sans-serif)" }}>
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
                      {expandedSup === s.name && <RankingAgentTray sup={s} colCount={15} allAgents={allAgents} />}
                      </Fragment>
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
            )}

            {rankView === "agents" && (() => {
              const toggleAgentSort = k => setSiteAgentSort(s => ({ key: k, dir: s.key === k ? -s.dir : -1 }));
              const AgTh = ({ k, label, left }) => (
                <th onClick={() => toggleAgentSort(k)}
                  style={{ padding: "0.4rem 0.5rem", textAlign: left ? "left" : "right", color: siteAgentSort.key === k ? "#d97706" : `var(--text-faint)`, fontWeight: 600, fontSize: "0.85rem", whiteSpace: "nowrap", cursor: "pointer", userSelect: "none" }}>
                  {label} {siteAgentSort.key === k ? (siteAgentSort.dir === -1 ? "\u2193" : "\u2191") : ""}
                </th>
              );
              const agentMap = {};
              agents.forEach(a => {
                const name = a.agentName;
                if (!name) return;
                if (!agentMap[name]) agentMap[name] = { name, supervisor: a.supervisor || "Unknown", hours: 0, goals: 0, goalsNum: 0, newXI: 0, xmLines: 0, programs: new Set() };
                agentMap[name].hours += a.hours; agentMap[name].goals += a.goals; agentMap[name].goalsNum += a.goalsNum || 0;
                agentMap[name].newXI += a.newXI || 0; agentMap[name].xmLines += a.xmLines || 0;
                if (a.jobType) agentMap[name].programs.add(a.jobType);
              });
              const agentList = Object.values(agentMap).map(a => {
                const gph = a.hours > 0 ? a.goals / a.hours : 0;
                const cps = a.goals > 0 ? (a.hours * 19.77) / a.goals : a.hours * 19.77;
                const pctToGoal = a.goalsNum > 0 ? (a.goals / a.goalsNum) * 100 : null;
                const programList = [...a.programs].join(", ");
                const multiCampaign = a.programs.size > 1;
                const campaigns = (() => {
                  const rows = agents.filter(r => r.agentName === a.name);
                  const byJob = {};
                  rows.forEach(r => { const jt = r.jobType || "Unknown"; if (!byJob[jt]) byJob[jt] = { jobType: jt, hours: 0, goals: 0, goalsNum: 0 }; byJob[jt].hours += r.hours; byJob[jt].goals += r.goals; byJob[jt].goalsNum += r.goalsNum || 0; });
                  return Object.values(byJob).map(j => ({ ...j, gph: j.hours > 0 ? j.goals / j.hours : 0, cps: j.goals > 0 ? (j.hours * 19.77) / j.goals : j.hours * 19.77, pct: j.goalsNum > 0 ? (j.goals / j.goalsNum) * 100 : null })).sort((b2, c2) => c2.hours - b2.hours);
                })();
                return { ...a, gph, cps, pctToGoal, programList, multiCampaign, campaigns, count: a.programs.size };
              }).sort((a, b) => { const va = a[siteAgentSort.key] ?? -9999; const vb = b[siteAgentSort.key] ?? -9999; if (typeof va === "string") return va.localeCompare(vb) * siteAgentSort.dir; return (va - vb) * siteAgentSort.dir; });
              const totHrs = agentList.reduce((s2, a) => s2 + a.hours, 0);
              const totGoals = agentList.reduce((s2, a) => s2 + a.goals, 0);
              const totGph = totHrs > 0 ? totGoals / totHrs : 0;
              return (
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.92rem" }}>
                    <thead><tr style={{ borderBottom: "2px solid var(--border)" }}>
                      <AgTh k="name" label="Agent" left />
                      <AgTh k="supervisor" label="Supervisor" left />
                      <th style={{ padding: "0.4rem 0.5rem", textAlign: "left", color: `var(--text-faint)`, fontWeight: 600, fontSize: "0.85rem" }}>Programs</th>
                      <AgTh k="hours" label="Hours" />
                      <AgTh k="goals" label="Sales" />
                      <AgTh k="gph" label="GPH" />
                      <AgTh k="pctToGoal" label="% Goal" />
                      <AgTh k="cps" label="CPS" />
                    </tr></thead>
                    <tbody>
                      {agentList.map((a, i) => {
                        const pColor = a.pctToGoal !== null ? attainColor(a.pctToGoal) : `var(--text-dim)`;
                        const isExp = siteExpandedAgent === a.name;
                        return (
                          <Fragment key={a.name}>
                            <tr onClick={a.multiCampaign ? () => setSiteExpandedAgent(isExp ? null : a.name) : undefined}
                              style={{ borderBottom: "1px solid var(--bg-tertiary)", cursor: a.multiCampaign ? "pointer" : "default", background: isExp ? "#6366f115" : i % 2 === 0 ? "transparent" : `var(--bg-row-alt)` }}>
                              <td style={{ padding: "0.35rem 0.5rem", color: `var(--text-warm)`, fontFamily: "var(--font-ui, Inter, sans-serif)" }}>
                                {a.multiCampaign && <span style={{ color: `var(--text-faint)`, marginRight: "0.3rem", fontSize: "0.75rem" }}>{isExp ? "\u25BE" : "\u25B8"}</span>}
                                {a.name}
                                {a.multiCampaign && <span style={{ marginLeft: "0.3rem", fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.72rem", color: "#6366f1", background: "#6366f112", border: "1px solid #6366f130", borderRadius: "2px", padding: "0.02rem 0.2rem" }}>{a.count} pgms</span>}
                              </td>
                              <td style={{ padding: "0.35rem 0.5rem", color: `var(--text-dim)` }}>{a.supervisor}</td>
                              <td style={{ padding: "0.35rem 0.5rem", color: `var(--text-dim)`, fontSize: "0.82rem", maxWidth: "130px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={a.programList}>{a.programList}</td>
                              <td style={{ padding: "0.35rem 0.5rem", textAlign: "right", color: "#6366f1" }}>{fmt(a.hours, 1)}</td>
                              <td style={{ padding: "0.35rem 0.5rem", textAlign: "right", color: a.goals > 0 ? "#d97706" : `var(--text-faint)`, fontWeight: 700 }}>{a.goals || "\u2014"}</td>
                              <td style={{ padding: "0.35rem 0.5rem", textAlign: "right", color: pColor, fontWeight: 600 }}>{a.gph > 0 ? a.gph.toFixed(3) : "\u2014"}</td>
                              <td style={{ padding: "0.35rem 0.5rem", textAlign: "right" }}>
                                {a.pctToGoal !== null ? <span style={{ color: pColor, fontWeight: 700, background: pColor + "12", border: `1px solid ${pColor}30`, borderRadius: "3px", padding: "0.1rem 0.3rem" }}>{Math.round(a.pctToGoal)}%</span> : "\u2014"}
                              </td>
                              <td style={{ padding: "0.35rem 0.5rem", textAlign: "right", color: pColor }}>${a.cps.toFixed(2)}</td>
                            </tr>
                            {isExp && a.campaigns.map(c2 => {
                              const cColor = c2.pct !== null ? attainColor(c2.pct) : (c2.gph > 0 ? `var(--text-dim)` : `var(--text-faint)`);
                              return (
                                <tr key={c2.jobType} style={{ background: "#6366f10a", borderBottom: "1px solid var(--border)" }}>
                                  <td></td><td></td>
                                  <td style={{ padding: "0.25rem 0.5rem", color: `var(--text-muted)`, fontSize: "0.92rem" }}>{"\u2514"} {c2.jobType}</td>
                                  <td style={{ padding: "0.25rem 0.5rem", textAlign: "right", color: "#6366f1", fontSize: "0.92rem" }}>{fmt(c2.hours, 1)}</td>
                                  <td style={{ padding: "0.25rem 0.5rem", textAlign: "right", color: c2.goals > 0 ? "#d97706" : `var(--text-faint)`, fontSize: "0.92rem" }}>{c2.goals || "\u2014"}</td>
                                  <td style={{ padding: "0.25rem 0.5rem", textAlign: "right", color: cColor, fontSize: "0.92rem" }}>{c2.gph > 0 ? c2.gph.toFixed(3) : "\u2014"}</td>
                                  <td style={{ padding: "0.25rem 0.5rem", textAlign: "right", fontSize: "0.92rem" }}>
                                    {c2.pct !== null ? <span style={{ color: cColor, fontSize: "0.88rem" }}>{Math.round(c2.pct)}%</span> : "\u2014"}
                                  </td>
                                  <td style={{ padding: "0.25rem 0.5rem", textAlign: "right", color: cColor, fontSize: "0.92rem" }}>${c2.cps.toFixed(2)}</td>
                                </tr>
                              );
                            })}
                          </Fragment>
                        );
                      })}
                    </tbody>
                    <tfoot><tr style={{ borderTop: "2px solid var(--border)", background: `var(--bg-row-alt)` }}>
                      <td style={{ padding: "0.4rem 0.5rem", fontWeight: 700, color: `var(--text-warm)` }}>TOTAL ({agentList.length})</td>
                      <td></td><td></td>
                      <td style={{ padding: "0.4rem 0.5rem", textAlign: "right", fontWeight: 700, color: "#6366f1" }}>{fmt(totHrs, 1)}</td>
                      <td style={{ padding: "0.4rem 0.5rem", textAlign: "right", fontWeight: 700, color: "#d97706" }}>{totGoals}</td>
                      <td style={{ padding: "0.4rem 0.5rem", textAlign: "right", fontWeight: 700 }}>{totGph.toFixed(3)}</td>
                      <td></td>
                      <td style={{ padding: "0.4rem 0.5rem", textAlign: "right", fontWeight: 700 }}>${totGoals > 0 ? ((totHrs * 19.77) / totGoals).toFixed(2) : (totHrs * 19.77).toFixed(2)}</td>
                    </tr></tfoot>
                  </table>
                </div>
              );
            })()}
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
          if (!dtFundingFilter) {
            // Split programs with multiple ROC breakouts into separate rows
            const rows = [];
            dtPrograms.forEach(p => {
              const breakouts = p.goalBreakout || [];
              if (breakouts.length <= 1) {
                rows.push(p);
              } else {
                breakouts.forEach(fb => {
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
                    sitePlanHsd: fb.hsd || null,
                    sitePlanXm: fb.xm || null,
                    totalHours: rocHours,
                    totalGoals: rocGoals,
                    hsdAct: rocHsd,
                    xmAct: rocXm,
                    siteAgents: rocAgents,
                    uNames: new Set(rocAgents.map(a => a.agentName).filter(Boolean)).size,
                  });
                });
              }
            });
            return rows;
          }
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
                <span style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: rowBg ? "1.11rem" : "1.08rem", color: `var(--text-dim)`, fontWeight: rowBg ? 700 : 400 }}>
                  {m.plan ? m.fmtFn(m.plan) : "\u2014"}
                </span>
              </DtCell>
            );
            cells.push(
              <DtCell key={`a${gi}`} style={{ background: g.bg }}>
                <span style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: rowBg ? "1.11rem" : "1.08rem", color: `var(--text-primary)`, fontWeight: rowBg ? 700 : 400 }}>
                  {m.actual ? m.fmtFn(m.actual) : "0"}
                </span>
              </DtCell>
            );
            cells.push(
              <DtCell key={`r${gi}`} style={{ background: g.bg }}>
                {m.plan ? (
                  isOver
                    ? <span style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: rowBg ? "1.08rem" : "0.92rem", color: gi === 0 ? "#dc2626" : "#16a34a", fontWeight: 700 }}>
                        +{m.fmtFn(Math.abs(diff))}
                      </span>
                    : remain === 0
                      ? <span style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.85rem", color: "#16a34a", fontWeight: 700 }}>0</span>
                      : noDaysLeft
                        ? <span style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: rowBg ? "1.08rem" : "0.92rem", color: "#dc2626", fontWeight: 700 }}>
                            -{m.fmtFn(remain)}
                          </span>
                      : <span style={{ fontFamily: "var(--font-display, Inter, sans-serif)", fontSize: rowBg ? "1.95rem" : "1.65rem", color: rowBg ? "#d97706" : (onTrack ? "#16a34a" : "#dc2626"), fontWeight: 700, lineHeight: 1 }}>
                          {perDay < 1 ? perDay.toFixed(1) : Math.ceil(perDay)}
                        </span>
                ) : <span style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.8rem", color: `var(--text-faint)` }}>{"\u2014"}</span>}
              </DtCell>
            );
          });
          return cells;
        };

        return (
        <div style={{ background: `var(--bg-secondary)`, border: "1px solid var(--border)", borderRadius: "var(--radius-lg, 16px)", padding: "1.5rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <span style={{ fontSize: "1.5rem" }}>🎯</span>
                <span style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.82rem", color: "#d97706", letterSpacing: "0.12em", textTransform: "uppercase", fontWeight: 700 }}>
                  Daily Targets — {displayLabel}
                </span>
              </div>
              <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "1.02rem", color: `var(--text-faint)`, marginTop: "0.2rem" }}>
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
                  style={{ padding: "0.2rem 0.6rem", borderRadius: "var(--radius-sm, 6px)", border: `1px solid ${!dtFundingFilter ? "#d97706" : "var(--border)"}`, background: !dtFundingFilter ? "#d9770618" : "transparent", color: !dtFundingFilter ? "#d97706" : `var(--text-dim)`, fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.9rem", cursor: "pointer", fontWeight: !dtFundingFilter ? 700 : 400 }}>
                  All Funding
                </button>
                {fundingSources.map(f => {
                  const active = dtFundingFilter === f;
                  return (
                    <button key={f} onClick={() => setDtFundingFilter(active ? null : f)}
                      style={{ padding: "0.2rem 0.6rem", borderRadius: "var(--radius-sm, 6px)", border: `1px solid ${active ? "#2563eb" : "var(--border)"}`, background: active ? "#2563eb18" : "transparent", color: active ? "#2563eb" : `var(--text-dim)`, fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.9rem", cursor: "pointer", fontWeight: active ? 700 : 400 }}>
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
                  <span style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.85rem", color: g.color, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700 }}>{g.label}</span>
                </div>
              </React.Fragment>
            ))}
          </div>

          {/* Sub-header row */}
          <div style={{ display: "grid", gridTemplateColumns: gridCols, borderBottom: "2px solid var(--border)" }}>
            <div style={{ padding: "0.35rem 0.75rem", fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.96rem", color: `var(--text-muted)`, textTransform: "uppercase", letterSpacing: "0.06em" }}>Program</div>
            {dtColors.map((g, gi) => (
              <React.Fragment key={gi}>
                <div style={{ background: `${g.color}25` }} />
                <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.96rem", color: `var(--text-faint)`, textAlign: "center", padding: "0.35rem 0", background: g.bg }}>Plan</div>
                <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.96rem", color: `var(--text-faint)`, textAlign: "center", padding: "0.35rem 0", background: g.bg }}>Actual</div>
                <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.96rem", color: "#d97706", textAlign: "center", padding: "0.35rem 0", fontWeight: 700, background: g.bg }}>/ Day</div>
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
            const rocLabel = p._fundingRoc
              ? `${p._fundingRoc}${p._fundingLabel ? ` \u00b7 ${p._fundingLabel}` : ""}`
              : (p.goalBreakout ? p.goalBreakout.map(g => g.roc).filter(Boolean).join(", ") : "");
            return (
              <div key={p.jobType + (p._fundingRoc || String(pi))} style={{ display: "grid", gridTemplateColumns: gridCols, borderBottom: "1px solid var(--bg-tertiary)", alignItems: "center" }}>
                <div style={{ padding: "0.5rem 0.75rem" }}>
                  <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.88rem", color: `var(--text-warm)` }}>{p.jobType}</div>
                  {rocLabel && <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.8rem", color: `var(--text-faint)` }}>{rocLabel}</div>}
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
                <div style={{ padding: "0.65rem 0.75rem", fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.82rem", color: `var(--text-muted)`, textTransform: "uppercase", fontWeight: 700 }}>TOTAL</div>
                {renderMetricCells(tots, true)}
              </div>
            );
          })()}
        </div>
        );
      })()}

      {/* Quartile bar */}
      <div style={{ background: `var(--bg-secondary)`, border: "1px solid var(--border)", borderRadius: "var(--radius-lg, 16px)", padding: "1.25rem" }}>
        <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.8rem", color: `var(--text-muted)`, letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: "0.75rem" }}>Quartile Mix — {displayLabel}</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "0.5rem", marginBottom: "0.75rem" }}>
          {["Q1","Q2","Q3","Q4"].map(q => (
            <div key={q} style={{ padding: "0.75rem", borderRadius: "var(--radius-md, 10px)", background: Q[q].color+"12", border: `1px solid ${Q[q].color}30`, textAlign: "center" }}>
              <div style={{ fontFamily: "var(--font-display, Inter, sans-serif)", fontSize: "3rem", color: Q[q].color, fontWeight: 700 }}>{distU[q]}</div>
              <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.82rem", color: Q[q].color }}>{q} · unique</div>
            </div>
          ))}
        </div>
        <div style={{ display: "flex", height: "8px", borderRadius: "var(--radius-sm, 6px)", overflow: "hidden" }}>
          {["Q1","Q2","Q3","Q4"].map(q => (
            <div key={q} style={{ flex: distU[q] || 0, background: Q[q].color, transition: "flex 0.5s" }} />
          ))}
        </div>
      </div>

      {/* Per-program breakdown */}
      <div style={{ background: `var(--bg-secondary)`, border: "1px solid var(--border)", borderRadius: "var(--radius-lg, 16px)", padding: "1.5rem" }}>
        <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.82rem", color: `var(--text-muted)`, letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: "1.25rem" }}>Programs — {displayLabel}</div>
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          {sitePrograms.map(p => {
            const maxGoals   = Math.max(...sitePrograms.map(x => x.totalGoals), 1);
            const barW       = (p.totalGoals / maxGoals) * 100;
            const color      = p.attain !== null ? attainColor(p.attain) : attainColor((p.distUn.Q1 / (p.uNames||1)) * 100);
            return (
              <div key={p.jobType} style={{ padding: "1rem", background: `var(--bg-primary)`, borderRadius: "var(--radius-md, 10px)", border: `1px solid ${color}20` }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "0.6rem" }}>
                  <div>
                    <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "1.42rem", color: `var(--text-warm)` }}>{p.jobType}</div>
                    <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.78rem", color: `var(--text-dim)`, marginTop: "0.1rem" }}>
                      {p.uNames} agents · {fmt(p.totalHours, 0)} hrs · GPH {fmt(p.siteGph, 2)}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: "0.75rem", alignItems: "center" }}>
                    {p.attain !== null && (
                      <div style={{ textAlign: "right" }}>
                        <div style={{ fontFamily: "var(--font-display, Inter, sans-serif)", fontSize: "1.95rem", color, fontWeight: 700 }}>{Math.round(p.attain)}%</div>
                        <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.8rem", color: `var(--text-dim)` }}>attainment</div>
                      </div>
                    )}
                  </div>
                </div>
                <div style={{ display: "flex", height: "5px", background: `var(--bg-tertiary)`, borderRadius: "3px", overflow: "hidden", marginBottom: "0.5rem" }}>
                  <div style={{ width: `${barW}%`, background: color, borderRadius: "3px", transition: "width 0.5s" }} />
                </div>
                <div style={{ display: "flex", gap: "0.75rem" }}>
                  {["Q1","Q2","Q3","Q4"].map(q => (
                    <span key={q} style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.82rem", color: Q[q].color }}>
                      {q}: {p.distUn[q]}
                    </span>
                  ))}
                  <span style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.82rem", color: "#16a34a" }}>
                    {p.totalGoals.toLocaleString()} goals
                  </span>
                  {p.attain !== null && p.sitePlanGoals && (
                    <span style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.82rem", color: `var(--text-dim)` }}>
                      of {p.sitePlanGoals.toLocaleString()} plan
                    </span>
                  )}
                </div>
                {/* ROC/Target breakout when multiple funding sources */}
                {p.goalBreakout && p.goalBreakout.length > 1 && (
                  <div style={{ marginTop: "0.6rem", borderTop: `1px solid var(--border)`, paddingTop: "0.5rem" }}>
                    <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.85rem", color: `var(--text-faint)`, letterSpacing: "0.1em", marginBottom: "0.3rem" }}>GOAL BREAKOUT</div>
                    {p.goalBreakout.map(g => (
                      <div key={g.roc || g.target} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0.25rem 0", borderBottom: "1px solid var(--bg-tertiary)" }}>
                        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                          <span style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.9rem", color: `var(--text-muted)` }}>{g.roc}</span>
                          <span style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.8rem", color: `var(--text-secondary)` }}>{g.target}</span>
                          {g.funding && <span style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.85rem", color: "#6366f1", background: "#6366f108", border: "1px solid #6366f130", borderRadius: "3px", padding: "0 0.3rem" }}>{g.funding}</span>}
                        </div>
                        <div style={{ display: "flex", gap: "1rem", fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.78rem" }}>
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

// ── SiteDropdown — categorized program list for DR/BZ menus ─────────────────
// currentProgram tri-state:
//   string    → that specific program is the active page (highlight it)
//   null      → Site Overview is the active page (highlight Site Overview)
//   undefined → user is not on this site at all (no row is "current")
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
        onMouseEnter={e => { if (currentProgram !== null) e.currentTarget.style.background = "var(--bg-secondary)"; }}
        onMouseLeave={e => { if (currentProgram !== null) e.currentTarget.style.background = "transparent"; }}
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
                onMouseEnter={e => { if (!isCurrent) e.currentTarget.style.background = "var(--bg-secondary)"; }}
                onMouseLeave={e => { if (!isCurrent) e.currentTarget.style.background = "transparent"; }}
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

// ── SettingsMenu — overflow menu with actions, data, settings ───────────────
// MenuSection / MenuRow hoisted to module scope so they aren't recreated on
// every SettingsMenu render (would cause unmount/remount of the subtree).
function MenuSection({ label }) {
  return (
    <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.65rem", color: "var(--text-dim)", letterSpacing: "0.1em", textTransform: "uppercase", padding: "8px 14px 4px", fontWeight: 600 }}>
      {label}
    </div>
  );
}
function MenuRow({ icon, label, hint, onClick }) {
  return (
    <button onClick={onClick} role="menuitem"
      onMouseEnter={e => { e.currentTarget.style.background = "var(--bg-secondary)"; }}
      onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}
      style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%", padding: "7px 14px", border: "none", background: "transparent", color: "var(--text-primary)", fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.85rem", cursor: "pointer", textAlign: "left" }}>
      <span>{icon} {label}</span>
      {hint && <span style={{ fontFamily: "var(--font-data, monospace)", fontSize: "0.7rem", color: "var(--text-dim)" }}>{hint}</span>}
    </button>
  );
}
function SettingsMenu({ onExportMbr, onExportVirgilMbr, onOpenCorpDataSources, onRefresh, onUploadGoals, onUploadRoster, onUploadPriorGoals, onUploadCoachingDetails, onUploadCoachingWeekly, onUploadLoginBuckets, onOpenSettings, ollamaAvailable, localAI, onToggleLocalAI }) {
  return (
    <div role="menu" aria-label="Settings and actions"
      style={{ position: "absolute", top: "calc(100% + 4px)", right: 0, minWidth: 240, background: "var(--bg-tertiary)", border: "1px solid var(--border)", borderRadius: "var(--radius-md, 10px)", boxShadow: "0 12px 32px rgba(0,0,0,0.35)", padding: "6px 0", zIndex: 250 }}>
      <MenuSection label="Actions" />
      <MenuRow icon="📊" label="Export MBR" hint="monthly" onClick={onExportMbr} />
      <MenuRow icon="🎯" label="Export Corp MBR" hint="monthly" onClick={onExportVirgilMbr} />
      <MenuRow icon="🔄" label="Refresh from sheet" onClick={onRefresh} />
      <div style={{ borderTop: "1px solid var(--border-muted)", margin: "4px 0" }} />
      <MenuSection label="Data" />
      <MenuRow icon="📁" label="Upload Goals CSV" onClick={onUploadGoals} />
      <MenuRow icon="📁" label="Upload Roster CSV" onClick={onUploadRoster} />
      <MenuRow icon="📁" label="Upload Prior Goals" onClick={onUploadPriorGoals} />
      <MenuRow icon="📘" label="Upload Coaching Details" hint="CSV" onClick={() => document.getElementById("virgil-coaching-details-input").click()} />
      <MenuRow icon="📗" label="Upload Weekly Breakdown" hint="CSV" onClick={() => document.getElementById("virgil-coaching-weekly-input").click()} />
      <MenuRow icon="📕" label="Upload Login Buckets" hint="CSV" onClick={() => document.getElementById("virgil-login-buckets-input").click()} />
      <MenuRow icon="🔌" label="Corp MBR Data Sources" hint="URLs" onClick={onOpenCorpDataSources} />
      <div style={{ borderTop: "1px solid var(--border-muted)", margin: "4px 0" }} />
      <MenuSection label="Settings" />
      <MenuRow icon="⚙" label="Data sources" onClick={onOpenSettings} />
      {ollamaAvailable && (
        <MenuRow icon="🤖" label="Local AI" hint={localAI ? "on" : "off"} onClick={onToggleLocalAI} />
      )}
      <input id="virgil-coaching-details-input" type="file" accept=".csv" style={{ display: "none" }}
        onChange={e => { if (e.target.files[0]) onUploadCoachingDetails(e.target.files[0]); e.target.value = ""; }} />
      <input id="virgil-coaching-weekly-input" type="file" accept=".csv" style={{ display: "none" }}
        onChange={e => { if (e.target.files[0]) onUploadCoachingWeekly(e.target.files[0]); e.target.value = ""; }} />
      <input id="virgil-login-buckets-input" type="file" accept=".csv" style={{ display: "none" }}
        onChange={e => { if (e.target.files[0]) onUploadLoginBuckets(e.target.files[0]); e.target.value = ""; }} />
    </div>
  );
}

// ── Breadcrumb — secondary nav bar showing site › category › program ────────
// Crumb / CRUMB_SEP hoisted to module scope, matching MenuSection/MenuRow pattern.
function Crumb({ label, current, accent }) {
  return (
    <span style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.78rem", color: current ? accent : "var(--text-muted)", fontWeight: current ? 600 : 400 }}>
      {label}
    </span>
  );
}
const CRUMB_SEP = (
  <span style={{ color: "var(--text-dim)", opacity: 0.5, fontSize: "0.78rem" }}>›</span>
);
function Breadcrumb({ section, program, attainment }) {
  // Only render for site-scoped pages
  if (section !== "dr" && section !== "bz") return null;
  const siteCode = section.toUpperCase();
  const siteName = section === "dr" ? "Dom. Republic" : "Belize";
  const accent = section === "dr" ? "#ed8936" : "#48bb78";

  return (
    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", padding: "0.4rem 1.5rem", background: "var(--glass-bg-subtle)", borderBottom: "1px solid var(--glass-border)", backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)" }}>
      <Crumb label={`${siteCode} · ${siteName}`} current={false} accent={accent} />
      {!program && (<>{CRUMB_SEP}<Crumb label="Site Overview" current accent={accent} /></>)}
      {program && (
        <>
          {CRUMB_SEP}
          <Crumb label={getMbrCategory(program)} current={false} accent={accent} />
          {CRUMB_SEP}
          <Crumb label={program} current accent={accent} />
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

// ── TopNav — permanent top navigation bar ───────────────────────────────────
// topNavLinkStyle hoisted to module scope (matches MenuSection/MenuRow/Crumb pattern)
// and parameterized by accent color so DR (#ed8936) and BZ (#48bb78) share it.
function topNavLinkStyle(active, accent = "#ed8936") {
  return {
    padding: "0.4rem 0.75rem", borderRadius: "var(--radius-sm, 6px)",
    border: active ? `1px solid ${accent}50` : "1px solid transparent",
    background: active ? `${accent}18` : "transparent",
    color: active ? accent : "var(--text-primary)",
    fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.85rem",
    cursor: "pointer", fontWeight: active ? 600 : 400, position: "relative",
    transition: "all 200ms cubic-bezier(0.4,0,0.2,1)",
  };
}
function TopNav({
  rawData, currentPage, setCurrentPage, openMenu, setOpenMenu,
  programsBySite, siteAttainments, fiscalInfo, hasTnps,
  lightMode, setLightMode, showToday, setShowToday,
  ollamaAvailable, localAI, setLocalAI,
  onExportMbr, onExportVirgilMbr, onOpenCorpDataSources, onRefresh, onUploadGoals, onUploadRoster, onUploadPriorGoals, onUploadCoachingDetails, onUploadCoachingWeekly, onUploadLoginBuckets, onOpenSettings,
}) {
  const navRef = useRef(null);
  const drRef = useRef(null);
  const bzRef = useRef(null);
  const settingsRef = useRef(null);

  // Close menus on outside click — explicit map prevents silent fall-through
  // if a future contributor adds a new openMenu key.
  useEffect(() => {
    if (!openMenu) return;
    const refMap = { dr: drRef, bz: bzRef, settings: settingsRef };
    const handler = e => {
      const ref = refMap[openMenu];
      if (ref?.current && !ref.current.contains(e.target)) setOpenMenu(null);
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
    if (showToday) setShowToday(false); // navigating from Today exits Today
  };

  const isActive = section => currentPage.section === section;

  const drCount = programsBySite.DR ? programsBySite.DR.length : 0;
  const bzCount = programsBySite.BZ ? programsBySite.BZ.length : 0;

  return (
    <div ref={navRef} style={{ display: "flex", alignItems: "center", gap: "0.35rem", padding: "0.5rem 1.5rem", background: "var(--nav-bg)", backdropFilter: "blur(16px) saturate(180%)", WebkitBackdropFilter: "blur(16px) saturate(180%)", borderBottom: "1px solid var(--glass-border)", position: "fixed", top: 0, left: 0, right: 0, zIndex: 200 }}>
      <span style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.72rem", color: "var(--text-muted)", letterSpacing: "0.08em", fontWeight: 600, marginRight: "0.5rem" }}>PERF INTEL</span>

      {rawData && (
        <>
          <button onClick={() => navigate("overview")} style={topNavLinkStyle(isActive("overview"))}>Overview</button>

          {drCount > 0 && (
            <div ref={drRef} style={{ position: "relative" }}>
              <button onClick={() => setOpenMenu(openMenu === "dr" ? null : "dr")}
                style={topNavLinkStyle(isActive("dr"))}>
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
                style={topNavLinkStyle(isActive("bz"), "#48bb78")}>
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

          <button onClick={() => navigate("mom")} style={topNavLinkStyle(isActive("mom"))}>MoM</button>
          {hasTnps && <button onClick={() => navigate("tnps")} style={topNavLinkStyle(isActive("tnps"))}>tNPS</button>}
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
              onExportVirgilMbr={() => { onExportVirgilMbr(); setOpenMenu(null); }}
              onOpenCorpDataSources={() => { onOpenCorpDataSources(); setOpenMenu(null); }}
              onRefresh={() => { onRefresh(); setOpenMenu(null); }}
              onUploadGoals={() => { onUploadGoals(); setOpenMenu(null); }}
              onUploadRoster={() => { onUploadRoster(); setOpenMenu(null); }}
              onUploadPriorGoals={() => { onUploadPriorGoals(); setOpenMenu(null); }}
              onUploadCoachingDetails={onUploadCoachingDetails}
              onUploadCoachingWeekly={onUploadCoachingWeekly}
              onUploadLoginBuckets={onUploadLoginBuckets}
              onOpenSettings={() => { onOpenSettings(); setOpenMenu(null); }}
              ollamaAvailable={ollamaAvailable}
              localAI={localAI}
              onToggleLocalAI={() => { setLocalAI(v => !v); setOpenMenu(null); }}
            />
          )}
        </div>
      )}

      <button onClick={() => setShowToday(v => !v)} title={showToday ? "Exit live view" : "Open live view"}
        style={{ padding: "0.4rem 0.85rem", borderRadius: "var(--radius-sm, 6px)", border: showToday ? "1px solid #16a34a" : "1px solid #16a34a", background: showToday ? "transparent" : "#16a34a", color: showToday ? "#16a34a" : "white", fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.78rem", cursor: "pointer", fontWeight: 600, letterSpacing: "0.04em", transition: "all 200ms cubic-bezier(0.4,0,0.2,1)" }}>
        {showToday ? "\u2715 EXIT TODAY" : "\u26A1 TODAY"}
      </button>
    </div>
  );
}


// ══════════════════════════════════════════════════════════════════════════════
// SECTION 11.5 — MBR PPTX EXPORT
// Generates a Monthly Business Review PowerPoint deck from perf data.
// ══════════════════════════════════════════════════════════════════════════════

// LAYOUT_WIDE = 13.33" x 7.5"
const MBR_W = 13.33;

function buildMbrTitleSlide(pres, fiscalInfo) {
  const slide = pres.addSlide();
  slide.bkgd = MBR_COLORS.purple;
  // Subtle decorative circle (top right)
  slide.addShape(pres.shapes.OVAL, {
    x: 9.5, y: -1.5, w: 5, h: 5, fill: { color: "5228D4" },
  });
  // Subtle decorative circle (bottom left)
  slide.addShape(pres.shapes.OVAL, {
    x: -2, y: 4.5, w: 5, h: 5, fill: { color: "5228D4" },
  });
  slide.addText("MONTHLY BUSINESS REVIEW", {
    x: 0.8, y: 2.0, w: 11.5, h: 1.2,
    fontSize: 42, fontFace: MBR_FONT, color: MBR_COLORS.white, bold: true,
  });
  slide.addText("GLOBAL CALLCENTER SOLUTIONS (GCS)", {
    x: 0.8, y: 3.2, w: 11.5, h: 0.7,
    fontSize: 20, fontFace: MBR_FONT, color: MBR_COLORS.amber,
  });
  const fiscalEnd = fiscalInfo?.fiscalEnd || "";
  let dateLabel = "";
  if (fiscalEnd) {
    const [y, m] = fiscalEnd.split("-");
    const months = ["","January","February","March","April","May","June","July","August","September","October","November","December"];
    dateLabel = `${months[parseInt(m, 10)] || ""} ${y}`;
  }
  slide.addText(dateLabel, {
    x: 0.8, y: 3.9, w: 11.5, h: 0.5,
    fontSize: 16, fontFace: MBR_FONT, color: MBR_COLORS.white, italic: true,
  });
  slide.addShape(pres.shapes.RECTANGLE, {
    x: 0, y: 5.5, w: MBR_W, h: 0.05,
    fill: { color: MBR_COLORS.amber },
  });
}

function addMbrSlideHeader(slide, pres, title, subtitle) {
  // Header with gradient effect (two overlapping rects)
  slide.addShape(pres.shapes.RECTANGLE, {
    x: 0, y: 0, w: MBR_W, h: 1.15,
    fill: { color: MBR_COLORS.purple },
  });
  slide.addShape(pres.shapes.RECTANGLE, {
    x: 0, y: 0.7, w: MBR_W, h: 0.45,
    fill: { color: "5228D4" },
  });
  slide.addShape(pres.shapes.RECTANGLE, {
    x: 0, y: 1.15, w: MBR_W, h: 0.05,
    fill: { color: MBR_COLORS.amber },
  });
  slide.addText("GLOBAL CALLCENTER SOLUTIONS", {
    x: 0.5, y: 0.15, w: 6, h: 0.3,
    fontSize: 9, fontFace: MBR_FONT, color: "C0C0E0",
  });
  slide.addText(title, {
    x: 0.5, y: 0.4, w: 10, h: 0.45,
    fontSize: 22, fontFace: MBR_FONT, color: MBR_COLORS.white, bold: true,
  });
  if (subtitle) {
    slide.addText(subtitle, {
      x: 0.5, y: 0.8, w: 10, h: 0.3,
      fontSize: 12, fontFace: MBR_FONT, color: MBR_COLORS.amber,
    });
  }
  // Footer bar
  slide.addShape(pres.shapes.RECTANGLE, {
    x: 0, y: 7.2, w: MBR_W, h: 0.3,
    fill: { color: "F5F5FA" },
  });
  slide.addShape(pres.shapes.RECTANGLE, {
    x: 0, y: 7.2, w: MBR_W, h: 0.01,
    fill: { color: MBR_COLORS.cardBorder },
  });
  slide.addText("GCS  |  Performance Intel", {
    x: 0.5, y: 7.22, w: 4, h: 0.2,
    fontSize: 7, fontFace: MBR_FONT, color: MBR_COLORS.textSecondary, italic: true,
  });
}

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
  addMbrSlideHeader(slide, pres, `SUMMARY \u2013 ${periodLabel}`, "Sales Performance");

  // ── TOP ROW: 5 KPI cards + Headcount with pie chart ──
  const kpis = [
    { label: "HOURS",    actual: perf.totalHours,    plan: perf.globalPlanHours, color: MBR_COLORS.blue },
    { label: "SALES",    actual: perf.globalGoals,    plan: perf.planTotal, color: MBR_COLORS.blue },
    { label: "XI RGUs",  actual: perf.globalNewXI,    plan: perf.globalPlanNewXI, color: MBR_COLORS.green },
    { label: "XM RGUs",  actual: perf.globalXmLines,  plan: perf.globalPlanXmLines, color: MBR_COLORS.blue },
    { label: "RGUs",     actual: perf.globalRgu,      plan: perf.globalPlanRgu, color: MBR_COLORS.orange },
  ];
  const cardW = 1.75, cardH = 1.15, gapX = 0.12, startX = 0.5, startY = 1.4;
  kpis.forEach((kpi, i) => {
    const x = startX + i * (cardW + gapX);
    const hasPlan = kpi.plan != null && kpi.plan > 0;
    const pctGoal = hasPlan ? (kpi.actual / kpi.plan) * 100 : null;
    const pacing = hasPlan && fi ? calcPacing(kpi.actual, kpi.plan, fi.elapsedBDays, fi.totalBDays) : null;
    // Card shadow (offset slightly)
    slide.addShape(pres.shapes.ROUNDED_RECTANGLE, {
      x: x + 0.02, y: startY + 0.03, w: cardW, h: cardH,
      fill: { color: "E0E0E0" }, rectRadius: 0.05,
    });
    // Card face
    slide.addShape(pres.shapes.ROUNDED_RECTANGLE, {
      x, y: startY, w: cardW, h: cardH,
      fill: { color: "FFF8E1" }, rectRadius: 0.05,
      line: { color: MBR_COLORS.cardBorder, width: 0.5 },
    });
    // Left accent bar
    slide.addShape(pres.shapes.RECTANGLE, {
      x, y: startY + 0.08, w: 0.05, h: cardH - 0.16,
      fill: { color: kpi.color },
    });
    // Colored label
    slide.addText(kpi.label, {
      x, y: startY + 0.05, w: cardW, h: 0.28,
      fontSize: 13, fontFace: MBR_FONT, color: kpi.color, bold: true, align: "center",
    });
    // % to Goal
    if (hasPlan) {
      slide.addText(`${Math.round(pctGoal)}% to Goal`, {
        x, y: startY + 0.33, w: cardW, h: 0.32,
        fontSize: 11, fontFace: MBR_FONT, color: MBR_COLORS.textPrimary, align: "center",
      });
    }
    // Pacing
    if (pacing) {
      slide.addText(`${Math.round(pacing.projectedPct)}% Pacing`, {
        x, y: startY + 0.68, w: cardW, h: 0.32,
        fontSize: 11, fontFace: MBR_FONT, color: MBR_COLORS.textPrimary, bold: true, align: "center",
      });
    }
  });

  // Headcount + Pie chart (top right, aligned with KPI cards)
  const hcX = 10.0;
  slide.addText("HEADCOUNT", {
    x: hcX, y: startY, w: 3, h: 0.28,
    fontSize: 14, fontFace: MBR_FONT, color: MBR_COLORS.orange, bold: true, align: "center",
  });
  slide.addText(String(perf.uniqueAgentCount || 0), {
    x: hcX, y: startY + 0.28, w: 3, h: 0.35,
    fontSize: 22, fontFace: MBR_FONT, color: MBR_COLORS.textPrimary, bold: true, align: "center",
  });

  // Site distribution pie chart
  const regions = perf.regions || [];
  if (regions.length > 0) {
    const pieColors = ["008557", "1F69FF", "6137F4", "FFAA00", "E54F00", "E5004C"];
    const chartData = [{
      name: "Sites",
      labels: regions.map(r => `${mbrSiteName(r.name)}, ${r.uniqueAgents || r.count}`),
      values: regions.map(r => r.uniqueAgents || r.count),
    }];
    slide.addChart(pres.charts.PIE, chartData, {
      x: hcX + 0.15, y: startY + 0.7, w: 2.6, h: 1.53,
      showTitle: false,
      showValue: false,
      showPercent: true,
      showLegend: false,
      showLabel: true,
      dataLabelPosition: "bestFit",
      dataLabelFontSize: 8,
      dataLabelColor: MBR_COLORS.textPrimary,
      chartColors: pieColors.slice(0, regions.length),
    });
  }

  // ── BOTTOM: Per-category aggregate tables ──
  const { programs } = perf;
  const categories = {};
  programs.forEach(p => {
    const cat = getMbrCategory(p.jobType);
    if (!categories[cat]) categories[cat] = [];
    categories[cat].push(p);
  });

  const catList = Object.entries(categories);
  const catColors = { "Acquisition": MBR_COLORS.green, "Multi-Product Expansion": MBR_COLORS.blue, "Up Tier & Ancillary": MBR_COLORS.amber, "Other": MBR_COLORS.purple };
  const tableW = catList.length > 0 ? Math.min(4.0, (MBR_W - 0.8) / catList.length - 0.15) : 4.0;
  // Section divider
  slide.addShape(pres.shapes.RECTANGLE, {
    x: 0.3, y: 3.55, w: MBR_W - 0.6, h: 0.015,
    fill: { color: MBR_COLORS.cardBorder },
  });
  const tableStartY = 3.8; // pushed down for breathing room
  const rowH = 0.2;
  const colW5 = [tableW * 0.24, tableW * 0.19, tableW * 0.19, tableW * 0.19, tableW * 0.19];

  // ── PASS 1: Build data for all categories, find max volume rows ──
  const catData = catList.map(([cat, progs]) => {
    const catColor = catColors[cat] || MBR_COLORS.purple;
    const totHours = progs.reduce((s, p) => s + p.totalHours, 0);
    const totSales = progs.reduce((s, p) => s + p.actGoals, 0);
    const totRgu   = progs.reduce((s, p) => s + p.totalRgu, 0);
    const totXI    = progs.reduce((s, p) => s + p.totalNewXI, 0);
    const totXM    = progs.reduce((s, p) => s + p.totalXmLines, 0);
    const totVideo = progs.reduce((s, p) => s + p.agents.reduce((s2, a) => s2 + a.newVideo, 0), 0);
    const totXH    = progs.reduce((s, p) => s + p.agents.reduce((s2, a) => s2 + a.newXH, 0), 0);
    const planHours = progs.reduce((s, p) => s + (p.goalEntry ? (getPlanForKey(p.goalEntry, "Hours Goal") || 0) : 0), 0);
    const planSales = progs.reduce((s, p) => s + (p.planGoals || 0), 0);
    const planRgu   = progs.reduce((s, p) => s + (p.goalEntry ? (getPlanForKey(p.goalEntry, "RGU GOAL") || 0) : 0), 0);
    const planXI    = progs.reduce((s, p) => s + (p.goalEntry ? (getPlanForKey(p.goalEntry, "HSD Sell In Goal") || 0) : 0), 0);
    const planXM    = progs.reduce((s, p) => s + (p.goalEntry ? (getPlanForKey(p.goalEntry, "XM GOAL") || 0) : 0), 0);
    const volRows = [];
    const addCatRow = (label, actual, plan, isDollar) => {
      if (!plan && !actual) return;
      const pfx = isDollar ? "$  " : "";
      const variance = plan ? actual - plan : 0;
      const pctGoal = plan ? Math.round((actual / plan) * 100) + "%" : "\u2014";
      const fmtVal = isDollar ? (v => pfx + Math.round(v).toLocaleString()) : (v => Math.round(v).toLocaleString());
      volRows.push([label, plan ? fmtVal(plan) : "\u2014", fmtVal(actual),
        plan ? ((variance >= 0 ? pfx : (isDollar ? "$ (" : "(")) + Math.abs(Math.round(variance)).toLocaleString() + (variance < 0 ? ")" : "")) : "\u2014", pctGoal]);
    };
    const catBudgetPlan = planHours ? planHours * MBR_BILLING_RATE : null;
    addCatRow("BUDGET", totHours * MBR_BILLING_RATE, catBudgetPlan, true);
    addCatRow("HOURS", totHours, planHours || null);
    addCatRow("HOMES SOLD", totSales, planSales || null);
    addCatRow("TOTAL RGUs", totRgu, planRgu || null);
    addCatRow("XI RGUs", totXI, planXI || null);
    addCatRow("XM RGUs", totXM, planXM || null);
    if (totVideo > 0) addCatRow("VIDEO RGUs", totVideo, null);
    if (totXH > 0) addCatRow("XH RGUs", totXH, null);
    const costRows = [];
    if (totSales > 0) {
      const cpsPlan = planSales && planHours ? (planHours * MBR_BILLING_RATE) / planSales : null;
      const cpsAct = (totHours * MBR_BILLING_RATE) / totSales;
      costRows.push(["CPS", cpsPlan ? "$  " + cpsPlan.toFixed(2) : "\u2014", "$  " + cpsAct.toFixed(2),
        cpsPlan ? ((cpsAct - cpsPlan >= 0 ? "$  " : "$ (") + Math.abs(cpsAct - cpsPlan).toFixed(2) + (cpsAct - cpsPlan < 0 ? ")" : "")) : "",
        cpsPlan ? Math.round((cpsAct / cpsPlan) * 100) + "%" : ""]);
    }
    if (totRgu > 0) {
      const cprguPlan = planRgu && planHours ? (planHours * MBR_BILLING_RATE) / planRgu : null;
      const cprguAct = (totHours * MBR_BILLING_RATE) / totRgu;
      costRows.push(["CPRGU", cprguPlan ? "$  " + cprguPlan.toFixed(2) : "\u2014", "$  " + cprguAct.toFixed(2),
        cprguPlan ? ((cprguAct - cprguPlan >= 0 ? "$  " : "$ (") + Math.abs(cprguAct - cprguPlan).toFixed(2) + (cprguAct - cprguPlan < 0 ? ")" : "")) : "",
        cprguPlan ? Math.round((cprguAct / cprguPlan) * 100) + "%" : ""]);
    }
    if (totHours > 0 && totSales > 0) costRows.push(["SPH", "\u2014", (totSales / totHours).toFixed(2), "", ""]);
    return { cat, catColor, volRows, costRows };
  });

  // Max volume row count → consistent cost table Y
  const maxVolRows = Math.max(...catData.map(d => d.volRows.length));
  const volTableEndY = tableStartY + 0.32 + rowH * (maxVolRows + 1) + 0.1; // header + rows + gap

  // ── PASS 2: Render all tables at aligned positions ──
  catData.forEach((d, ci) => {
    const tx = 0.5 + ci * (tableW + 0.15);
    const catHdrStyle = { fontSize: 8, fontFace: MBR_FONT, color: MBR_COLORS.white, fill: { color: d.catColor }, bold: true };
    const catCellStyle = { fontSize: 8, fontFace: MBR_FONT, color: MBR_COLORS.textPrimary, fill: { color: MBR_COLORS.white } };
    const mkHdr = () => ["", "Budget", "Actual", "Variance", "% Goal"].map((t, i) => ({
      text: t, options: { ...catHdrStyle, align: i === 0 ? "left" : "right" },
    }));
    const mkRows = (src) => src.map(r => r.map((c, i) => ({
      text: c, options: { ...catCellStyle, bold: i === 0, align: i === 0 ? "left" : "right" },
    })));

    // Category header bar
    slide.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: tx, y: tableStartY, w: tableW, h: 0.32, fill: { color: d.catColor }, rectRadius: 0.04 });
    slide.addText(d.cat.toUpperCase(), {
      x: tx, y: tableStartY, w: tableW, h: 0.32,
      fontSize: 10, fontFace: MBR_FONT, color: MBR_COLORS.white, bold: true, align: "center", valign: "middle",
    });

    // Volume table
    const vRows = mkRows(d.volRows);
    if (vRows.length > 0) {
      slide.addTable([mkHdr(), ...vRows], {
        x: tx, y: tableStartY + 0.32, w: tableW, fontSize: 8,
        border: { pt: 0.3, color: MBR_COLORS.cardBorder },
        colW: colW5, rowH, margin: [1, 3, 1, 3],
      });
    }

    // Cost table — aligned across all categories
    const cRows = mkRows(d.costRows);
    if (cRows.length > 0) {
      slide.addTable([mkHdr(), ...cRows], {
        x: tx, y: volTableEndY, w: tableW, fontSize: 8,
        border: { pt: 0.3, color: MBR_COLORS.cardBorder },
        colW: colW5, rowH, margin: [1, 3, 1, 3],
      });
    }
  });

  // Data source
  const lastDate = fi?.lastDataDate || "";
  slide.addText(`Data Source: BI data through ${lastDate}`, {
    x: 0.5, y: 7.05, w: 8, h: 0.2,
    fontSize: 7, fontFace: MBR_FONT, color: MBR_COLORS.textSecondary, italic: true,
  });
}

function buildMbrProgramSlide(pres, program, fiscalInfo, narrativeText, oppsText) {
  const slide = pres.addSlide();
  slide.bkgd = MBR_COLORS.white;
  const category = getMbrCategory(program.jobType);
  const fiscalEnd = fiscalInfo?.fiscalEnd || "";
  let periodLabel = "";
  if (fiscalEnd) {
    const [y, m] = fiscalEnd.split("-");
    const months = ["","JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];
    periodLabel = `${months[parseInt(m, 10)] || ""} ${y} MTD`;
  }
  addMbrSlideHeader(slide, pres, program.jobType, `${category}  |  ${periodLabel}`);
  const fi = fiscalInfo;

  // Category badge (top right)
  const catColors = { "Acquisition": MBR_COLORS.green, "Multi-Product Expansion": MBR_COLORS.blue, "Up Tier & Ancillary": MBR_COLORS.amber };
  const badgeColor = catColors[category] || MBR_COLORS.purple;
  // Badge shadow
  slide.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x: 10.82, y: 0.28, w: 2.1, h: 0.45,
    fill: { color: "CCCCCC" }, rectRadius: 0.08,
  });
  // Badge face
  slide.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x: 10.8, y: 0.25, w: 2.1, h: 0.45,
    fill: { color: badgeColor }, rectRadius: 0.08,
  });
  slide.addText(category, {
    x: 10.8, y: 0.25, w: 2.1, h: 0.45,
    fontSize: 9, fontFace: MBR_FONT, color: MBR_COLORS.white, bold: true, align: "center", valign: "middle",
  });

  // Truncate AI text to fit slide
  const truncate = (text, max) => {
    if (!text) return null;
    if (text.length <= max) return text;
    const cut = text.slice(0, max);
    const last = cut.lastIndexOf(".");
    return last > max * 0.5 ? cut.slice(0, last + 1) : cut + "...";
  };
  const narrative = truncate(narrativeText, 300) || "Add project insights here";
  const opps = truncate(oppsText, 400) || "Add team insights here";

  const tOpts = { fontSize: 8, fontFace: MBR_FONT };
  const hdrOpts = { ...tOpts, color: MBR_COLORS.white, fill: { color: MBR_COLORS.purple }, bold: true };
  const cellOpts = { ...tOpts, color: MBR_COLORS.textPrimary, fill: { color: MBR_COLORS.white } };

  // ══ LEFT COLUMN (x=0.5, w=6.8): PROJECT ══
  const lx = 0.5;
  let cy = 1.35;

  slide.addText("PROJECT", {
    x: lx, y: cy, w: 6.8, h: 0.28,
    fontSize: 12, fontFace: MBR_FONT, color: MBR_COLORS.textPrimary, bold: true, align: "center",
  });
  cy += 0.32;

  // ── TABLE 1: Volume Metrics ──
  const volRows = [];
  const addVolRow = (label, actual, plan) => {
    if (plan == null || plan <= 0) return;
    const variance = actual - plan;
    const pctGoal = (actual / plan) * 100;
    const pacing = fi ? calcPacing(actual, plan, fi.elapsedBDays, fi.totalBDays) : null;
    volRows.push([label, Math.round(plan).toLocaleString(), Math.round(actual).toLocaleString(),
      (variance >= 0 ? "" : "(") + Math.abs(Math.round(variance)).toLocaleString() + (variance < 0 ? ")" : ""),
      Math.round(pctGoal) + "%", pacing ? Math.round(pacing.projectedPct) + "%" : "\u2014"]);
  };
  const ge = program.goalEntry;
  const planHrs = ge ? getPlanForKey(ge, "Hours Goal") : null;
  const actHrs = program.totalHours;
  const budgetPlan = planHrs ? planHrs * MBR_BILLING_RATE : null;
  const budgetActual = actHrs * MBR_BILLING_RATE;
  if (budgetPlan) {
    const bVar = budgetActual - budgetPlan;
    const bPacing = fi ? calcPacing(budgetActual, budgetPlan, fi.elapsedBDays, fi.totalBDays) : null;
    volRows.push(["BUDGET", "$  " + Math.round(budgetPlan).toLocaleString(), "$  " + Math.round(budgetActual).toLocaleString(),
      (bVar >= 0 ? "$  " : "$ (") + Math.abs(Math.round(bVar)).toLocaleString() + (bVar < 0 ? ")" : ""),
      Math.round((budgetActual / budgetPlan) * 100) + "%", bPacing ? Math.round(bPacing.projectedPct) + "%" : "\u2014"]);
  }
  addVolRow("HOURS", actHrs, planHrs);
  addVolRow("SALES", program.actGoals, program.planGoals);
  addVolRow("RGUs", program.totalRgu, ge ? getPlanForKey(ge, "RGU GOAL") : null);
  addVolRow("HSD RGUs", program.totalNewXI, ge ? getPlanForKey(ge, "HSD Sell In Goal") : null);
  addVolRow("XM RGUs", program.totalXmLines, ge ? getPlanForKey(ge, "XM GOAL") : null);
  if (program.hasNewVideo) addVolRow("VIDEO RGUs", program.agents.reduce((s,a) => s+a.newVideo,0), ge ? getPlanForKey(ge, "VIDEO GOAL") : null);
  if (program.hasNewXH) addVolRow("XH RGUs", program.agents.reduce((s,a) => s+a.newXH,0), ge ? getPlanForKey(ge, "XH GOAL") : null);

  // ── TABLE 2: Cost & Efficiency Metrics ──
  const costRows = [];
  if (program.actGoals > 0) {
    const cpsPlan = program.planGoals && planHrs ? (planHrs * MBR_BILLING_RATE) / program.planGoals : null;
    const cpsActual = (actHrs * MBR_BILLING_RATE) / program.actGoals;
    costRows.push(["CPS", cpsPlan ? "$  " + cpsPlan.toFixed(2) : "\u2014", "$  " + cpsActual.toFixed(2),
      cpsPlan ? ((cpsActual - cpsPlan >= 0 ? "$  " : "$ (") + Math.abs(cpsActual - cpsPlan).toFixed(2) + (cpsActual - cpsPlan < 0 ? ")" : "")) : "",
      cpsPlan ? Math.round((cpsActual / cpsPlan) * 100) + "%" : ""]);
  }
  if (program.totalRgu > 0) {
    const rg = ge ? getPlanForKey(ge, "RGU GOAL") : null;
    const cprguPlan = rg && planHrs ? (planHrs * MBR_BILLING_RATE) / rg : null;
    const cprguActual = (actHrs * MBR_BILLING_RATE) / program.totalRgu;
    costRows.push(["CPRGU", cprguPlan ? "$  " + cprguPlan.toFixed(2) : "\u2014", "$  " + cprguActual.toFixed(2),
      cprguPlan ? ((cprguActual - cprguPlan >= 0 ? "$  " : "$ (") + Math.abs(cprguActual - cprguPlan).toFixed(2) + (cprguActual - cprguPlan < 0 ? ")" : "")) : "",
      cprguPlan ? Math.round((cprguActual / cprguPlan) * 100) + "%" : ""]);
  }
  if (program.totalNewXI > 0) {
    const xi = ge ? getPlanForKey(ge, "HSD Sell In Goal") : null;
    const cpxiPlan = xi && planHrs ? (planHrs * MBR_BILLING_RATE) / xi : null;
    const cpxiActual = (actHrs * MBR_BILLING_RATE) / program.totalNewXI;
    costRows.push(["CPXI", cpxiPlan ? "$  " + cpxiPlan.toFixed(2) : "\u2014", "$  " + cpxiActual.toFixed(2),
      cpxiPlan ? ((cpxiActual - cpxiPlan >= 0 ? "$  " : "$ (") + Math.abs(cpxiActual - cpxiPlan).toFixed(2) + (cpxiActual - cpxiPlan < 0 ? ")" : "")) : "",
      cpxiPlan ? Math.round((cpxiActual / cpxiPlan) * 100) + "%" : ""]);
  }
  const sphPlanVal = ge ? getPlanForKey(ge, "SPH GOAL") : null;
  if (sphPlanVal && actHrs > 0) {
    const sphAct = program.actGoals / actHrs;
    costRows.push(["SPH", sphPlanVal.toFixed(2), sphAct.toFixed(2),
      ((sphAct - sphPlanVal >= 0 ? "" : "(") + Math.abs(sphAct - sphPlanVal).toFixed(2) + (sphAct - sphPlanVal < 0 ? ")" : "")),
      Math.round((sphAct / sphPlanVal) * 100) + "%"]);
  } else if (actHrs > 0 && program.actGoals > 0) {
    costRows.push(["SPH", "\u2014", (program.actGoals / actHrs).toFixed(2), "", ""]);
  }
  if (actHrs > 0 && program.totalNewXI > 0) costRows.push(["SPH (XI)", "\u2014", (program.totalNewXI / actHrs).toFixed(2), "", ""]);
  if (actHrs > 0 && program.totalXmLines > 0) costRows.push(["SPH (XM)", "\u2014", (program.totalXmLines / actHrs).toFixed(2), "", ""]);

  // Render Volume table
  const volHdr = ["", "Budget", "Actual", "Variance", "% Goal", "% Pacing"].map((t, i) => ({
    text: t, options: { ...hdrOpts, align: i === 0 ? "left" : "right" },
  }));
  const volDataRows = volRows.map((r, ri) => r.map((c, i) => ({ text: c, options: { ...cellOpts, bold: i === 0, align: i === 0 ? "left" : "right", fill: { color: ri % 2 === 1 ? "F5F5FA" : MBR_COLORS.white } } })));
  if (volDataRows.length > 0) {
    slide.addTable([volHdr, ...volDataRows], {
      x: lx, y: cy, w: 6.8, fontSize: 8,
      border: { pt: 0.5, color: MBR_COLORS.cardBorder },
      colW: [1.0, 1.1, 1.1, 1.1, 0.8, 0.8],
      rowH: 0.2, margin: [2, 4, 2, 4],
    });
    cy += 0.2 * (volDataRows.length + 1) + 0.12;
  }

  // Render Cost/Efficiency table (no Pacing column — only 5 cols)
  const costHdr = ["", "Budget", "Actual", "Variance", "% Goal"].map((t, i) => ({
    text: t, options: { ...hdrOpts, align: i === 0 ? "left" : "right" },
  }));
  const costDataRows = costRows.map((r, ri) => r.map((c, i) => ({ text: c, options: { ...cellOpts, bold: i === 0, align: i === 0 ? "left" : "right", fill: { color: ri % 2 === 1 ? "F5F5FA" : MBR_COLORS.white } } })));
  if (costDataRows.length > 0) {
    slide.addTable([costHdr, ...costDataRows], {
      x: lx, y: cy, w: 5.5, fontSize: 8,
      border: { pt: 0.5, color: MBR_COLORS.cardBorder },
      colW: [0.9, 1.1, 1.1, 1.1, 0.8],
      rowH: 0.2, margin: [2, 4, 2, 4],
    });
    cy += 0.2 * (costDataRows.length + 1) + 0.12;
  }

  // Project KPI Insights (below table)
  slide.addText("Project KPI Insights", {
    x: lx, y: cy, w: 6.8, h: 0.25,
    fontSize: 10, fontFace: MBR_FONT, color: MBR_COLORS.textPrimary, bold: true,
  });
  cy += 0.25;
  slide.addText(narrative, {
    x: lx, y: cy, w: 6.8, h: 0.75,
    fontSize: 8, fontFace: MBR_FONT, color: MBR_COLORS.textPrimary, valign: "top", wrap: true,
  });

  // Subtle background wash for TEAM column
  slide.addShape(pres.shapes.RECTANGLE, {
    x: 7.4, y: 1.25, w: 5.93, h: 5.75,
    fill: { color: "F8F9FC" },
  });
  // Vertical divider between columns
  slide.addShape(pres.shapes.RECTANGLE, {
    x: 7.4, y: 1.35, w: 0.015, h: 5.5,
    fill: { color: MBR_COLORS.purple },
  });
  // ══ RIGHT COLUMN (x=7.6, w=5.3): TEAM ══
  const rx = 7.6;
  let ry = 1.35;

  slide.addText("TEAM", {
    x: rx, y: ry, w: 5.3, h: 0.28,
    fontSize: 12, fontFace: MBR_FONT, color: MBR_COLORS.textPrimary, bold: true, align: "center",
  });
  ry += 0.32;

  // Per-site quartile breakdown tables (matching reference PPTX)
  const regions = program.regions || [];
  const qGroups = [
    { key: "Q1", label: "1st", agents: program.q1Agents || [], color: MBR_COLORS.green, bgTint: "E8F5E9" },
    { key: "Q2", label: "2nd", agents: program.q2Agents || [], color: MBR_COLORS.blue, bgTint: "E3F2FD" },
    { key: "Q3", label: "3rd", agents: program.q3Agents || [], color: MBR_COLORS.amber, bgTint: "FFF8E1" },
    { key: "Q4", label: "4th", agents: program.q4Agents || [], color: MBR_COLORS.red, bgTint: "FFEBEE" },
  ];

  const nhSet = new Set((program.newHiresInProgram || []).map(a => a.agentName));
  const thOpts = { fontSize: 7, fontFace: MBR_FONT, color: MBR_COLORS.white, fill: { color: MBR_COLORS.purple }, bold: true };
  const teamHdr = [
    { text: "Quartile", options: thOpts },
    { text: "Agents", options: { ...thOpts, align: "center" } },
    { text: "<60", options: { ...thOpts, align: "center" } },
    { text: "Hours", options: { ...thOpts, align: "right" } },
    { text: "Sales", options: { ...thOpts, align: "right" } },
    { text: "XI RGU", options: { ...thOpts, align: "right" } },
    { text: "XM RGU", options: { ...thOpts, align: "right" } },
    { text: "SPH", options: { ...thOpts, align: "right" } },
  ];

  regions.filter(region => region.totalHours >= 10).forEach(region => {
    slide.addText(mbrSiteName(region.name), {
      x: rx, y: ry, w: 5.3, h: 0.2,
      fontSize: 8, fontFace: MBR_FONT, color: MBR_COLORS.purple, bold: true,
    });
    ry += 0.2;

    const siteRows = qGroups.map(qg => {
      const siteAgents = qg.agents.filter(a => a.region === region.name);
      const count = siteAgents.length;
      const nhCount = siteAgents.filter(a => nhSet.has(a.agentName)).length;
      const hours = siteAgents.reduce((s, a) => s + a.hours, 0);
      const sales = siteAgents.reduce((s, a) => s + a.goals, 0);
      const xiRgu = siteAgents.reduce((s, a) => s + (a.newXI || 0), 0);
      const xmRgu = siteAgents.reduce((s, a) => s + (a.xmLines || 0), 0);
      const sph = hours > 0 ? (sales / hours).toFixed(2) : "0.00";
      const rowFill = { color: qg.bgTint };
      const rc = { fontSize: 7, fontFace: MBR_FONT, color: MBR_COLORS.textPrimary, fill: rowFill };
      return [
        { text: qg.label, options: { ...rc, color: qg.color, bold: true } },
        { text: String(count), options: { ...rc, align: "center" } },
        { text: String(nhCount), options: { ...rc, align: "center" } },
        { text: hours ? hours.toFixed(1) : "0", options: { ...rc, align: "right" } },
        { text: String(sales), options: { ...rc, align: "right" } },
        { text: String(xiRgu), options: { ...rc, align: "right" } },
        { text: String(xmRgu), options: { ...rc, align: "right" } },
        { text: sph, options: { ...rc, align: "right" } },
      ];
    });

    slide.addTable([teamHdr, ...siteRows], {
      x: rx, y: ry, w: 5.3,
      fontSize: 7,
      border: { pt: 0.3, color: MBR_COLORS.cardBorder },
      colW: [0.6, 0.5, 0.4, 0.75, 0.65, 0.6, 0.6, 0.5],
      rowH: 0.18,
      margin: [1, 3, 1, 3],
    });
    ry += 0.18 * 5 + 0.1;
  });

  // Tier legend
  slide.addText(
    "T1: 100%+ to goal | T2: 80%-99.9% to goal | T3: 1%-79.9% to goal | T4: 0% | Hours > " + getMinHours(),
    { x: rx, y: ry, w: 5.3, h: 0.2, fontSize: 6, fontFace: MBR_FONT, color: MBR_COLORS.textSecondary }
  );
  ry += 0.25;

  // Team Insights (bottom right)
  slide.addText("Team Insights", {
    x: rx, y: ry, w: 5.3, h: 0.25,
    fontSize: 10, fontFace: MBR_FONT, color: MBR_COLORS.textPrimary, bold: true,
  });
  ry += 0.25;
  slide.addText(opps, {
    x: rx, y: ry, w: 5.3, h: 1.2,
    fontSize: 8, fontFace: MBR_FONT, color: MBR_COLORS.textPrimary, valign: "top", wrap: true,
  });

  // Data source
  const lastDate = fi?.lastDataDate || "";
  slide.addText("Data Source: BI data through " + lastDate, {
    x: 0.5, y: 7.05, w: 8, h: 0.2,
    fontSize: 7, fontFace: MBR_FONT, color: MBR_COLORS.textSecondary, italic: true,
  });
}

function buildMbrSiteRankingSlide(pres, perf) {
  const slide = pres.addSlide();
  slide.bkgd = MBR_COLORS.white;
  addMbrSlideHeader(slide, pres, "SITE PERFORMANCE RANKING", "Sales Performance by Site");

  const { programs, fiscalInfo } = perf;
  const fi = fiscalInfo;

  // Collect all unique sites across all programs (with >= 10 hrs threshold)
  const allSites = new Set();
  programs.forEach(p => {
    (p.regions || []).forEach(r => {
      if (r.totalHours >= 10) allSites.add(r.name);
    });
  });
  const sites = [...allSites].sort();
  if (sites.length === 0 || programs.length === 0) return;

  // Metrics per site per program
  const metrics = ["SPH", "Hours", "Sales", "XI RGU", "XM RGU"];

  // Build header row — each site gets a colored group of columns
  const siteColors = {};
  const colorPool = [MBR_COLORS.green, MBR_COLORS.blue, MBR_COLORS.purple, MBR_COLORS.amber, MBR_COLORS.orange];
  sites.forEach((s, i) => { siteColors[s] = colorPool[i % colorPool.length]; });

  const fontSize = 7;
  const hdrBase = { fontSize, fontFace: MBR_FONT, bold: true, align: "center", valign: "middle" };

  // Top header row: Program | Site1 (spanning 5 cols) | Site2 (spanning 5 cols) | ... | Best
  // Since pptxgenjs doesn't support colspan, we'll use a flat structure with site name in the first metric col

  // Build two header rows
  const hdr1 = [{ text: "", options: { ...hdrBase, color: MBR_COLORS.white, fill: { color: MBR_COLORS.purple } } }];
  const hdr2 = [{ text: "PROGRAM", options: { ...hdrBase, color: MBR_COLORS.white, fill: { color: MBR_COLORS.purple }, align: "left" } }];

  sites.forEach(s => {
    const sColor = siteColors[s];
    // Site name header spans conceptually — put name in first col of group
    hdr1.push({ text: mbrSiteName(s), options: { ...hdrBase, color: MBR_COLORS.white, fill: { color: sColor } } });
    for (let i = 1; i < metrics.length; i++) {
      hdr1.push({ text: "", options: { ...hdrBase, color: MBR_COLORS.white, fill: { color: sColor } } });
    }
    metrics.forEach(m => {
      hdr2.push({ text: m, options: { ...hdrBase, color: MBR_COLORS.white, fill: { color: sColor } } });
    });
  });
  hdr1.push({ text: "", options: { ...hdrBase, color: MBR_COLORS.white, fill: { color: MBR_COLORS.purple } } });
  hdr2.push({ text: "BEST SITE", options: { ...hdrBase, color: MBR_COLORS.white, fill: { color: MBR_COLORS.purple } } });

  // Build data rows — one per program
  const dataRows = programs.map((prog, ri) => {
    const rowBg = ri % 2 === 1 ? "F5F5FA" : MBR_COLORS.white;
    const cellBase = { fontSize, fontFace: MBR_FONT, fill: { color: rowBg }, valign: "middle" };
    const row = [{ text: prog.jobType, options: { ...cellBase, bold: true, align: "left", color: MBR_COLORS.textPrimary } }];

    let bestSite = null;
    let bestSph = -1;
    const siteSph = {};

    sites.forEach(s => {
      const region = (prog.regions || []).find(r => r.name === s);
      const hasData = region && region.totalHours >= 10;
      const hours = hasData ? region.totalHours : 0;
      const sales = hasData ? region.totalGoals : 0;
      // Get XI and XM from individual agents in this region
      const regionAgents = hasData ? (prog.agents || []).filter(a => a.region === s) : [];
      const xiRgu = regionAgents.reduce((sum, a) => sum + (a.newXI || 0), 0);
      const xmRgu = regionAgents.reduce((sum, a) => sum + (a.xmLines || 0), 0);
      const sph = hours > 0 ? sales / hours : 0;

      if (hasData && sph > bestSph) { bestSph = sph; bestSite = s; }
      siteSph[s] = sph;

      const vals = [
        sph > 0 ? sph.toFixed(2) : "\u2014",
        hours > 0 ? Math.round(hours).toLocaleString() : "\u2014",
        sales > 0 ? String(sales) : "\u2014",
        xiRgu > 0 ? String(xiRgu) : "\u2014",
        xmRgu > 0 ? String(xmRgu) : "\u2014",
      ];
      vals.forEach(v => {
        row.push({ text: v, options: { ...cellBase, align: "right", color: MBR_COLORS.textPrimary } });
      });
    });

    // Best Site column — highlight green
    row.push({
      text: bestSite ? mbrSiteName(bestSite) : "\u2014",
      options: { ...cellBase, bold: true, align: "center", color: bestSite ? MBR_COLORS.green : MBR_COLORS.textSecondary },
    });

    return row;
  });

  // Color-code the winning SPH cells green
  dataRows.forEach((row, ri) => {
    let bestSph = -1;
    let bestColIdx = -1;
    // SPH is the first metric in each site group (col index: 1, 1+5, 1+10, ...)
    sites.forEach((s, si) => {
      const colIdx = 1 + si * metrics.length; // SPH column for this site
      const cellText = row[colIdx].text;
      const val = parseFloat(cellText);
      if (!isNaN(val) && val > bestSph) { bestSph = val; bestColIdx = colIdx; }
    });
    if (bestColIdx >= 0) {
      row[bestColIdx].options = { ...row[bestColIdx].options, color: MBR_COLORS.green, bold: true };
    }
  });

  // Calculate column widths
  const progColW = 1.6;
  const bestColW = 1.1;
  const metricColW = sites.length > 0 ? (MBR_W - 0.8 - progColW - bestColW) / (sites.length * metrics.length) : 0.5;
  const colW = [progColW];
  sites.forEach(() => { metrics.forEach(() => colW.push(metricColW)); });
  colW.push(bestColW);

  const tableY = 1.4;
  slide.addTable([hdr1, hdr2, ...dataRows], {
    x: 0.4, y: tableY, w: MBR_W - 0.8,
    fontSize,
    border: { pt: 0.3, color: MBR_COLORS.cardBorder },
    colW,
    rowH: 0.28,
    margin: [2, 3, 2, 3],
  });

  // Legend
  const legendY = tableY + 0.28 * (dataRows.length + 2) + 0.1;
  slide.addText(
    "Ranked by SPH (Sales Per Hour)  |  Sites with < 10 hours excluded  |  Green = best performing site",
    { x: 0.5, y: legendY, w: MBR_W - 1, h: 0.18, fontSize: 7, fontFace: MBR_FONT, color: MBR_COLORS.textSecondary, italic: true }
  );

  // ── SPH % to Goal Bar Chart ──
  const chartY = legendY + 0.25;
  const chartH = Math.max(1.8, 7.0 - chartY - 0.5); // fill remaining space

  // Build chart data: one series per site, values = SPH % to goal per program
  const chartSeries = sites.map(s => {
    const sColor = siteColors[s];
    return {
      name: mbrSiteName(s),
      labels: programs.map(p => p.jobType),
      values: programs.map(p => {
        const region = (p.regions || []).find(r => r.name === s);
        if (!region || region.totalHours < 10) return 0;
        const sph = region.totalGoals / region.totalHours;
        const sphGoal = (() => {
          if (!p.goalEntry) return null;
          const rows = uniqueRowsFromEntry(p.goalEntry);
          const vals = rows.map(r => computePlanRow(r).sphGoal).filter(v => v > 0);
          return vals.length ? vals.reduce((a, v) => a + v, 0) / vals.length : null;
        })();
        return sphGoal ? Math.round((sph / sphGoal) * 100) : 0;
      }),
    };
  });

  // Only show chart if we have meaningful data
  const hasChartData = chartSeries.some(s => s.values.some(v => v > 0));
  if (hasChartData) {
    slide.addText("SPH % to Goal by Site", {
      x: 0.5, y: chartY, w: MBR_W - 1, h: 0.25,
      fontSize: 10, fontFace: MBR_FONT, color: MBR_COLORS.textPrimary, bold: true, align: "center",
    });

    slide.addChart(pres.charts.BAR, chartSeries, {
      x: 0.5, y: chartY + 0.25, w: MBR_W - 1, h: chartH - 0.25,
      showTitle: false,
      showValue: true,
      valueFontSize: 7,
      valueFontFace: MBR_FONT,
      catAxisLabelFontSize: 7,
      catAxisLabelFontFace: MBR_FONT,
      valAxisLabelFontSize: 7,
      valAxisLabelFontFace: MBR_FONT,
      valAxisTitle: "% to Goal",
      valAxisTitleFontSize: 7,
      catAxisOrientation: "minMax",
      barGrouping: "clustered",
      chartColors: sites.map(s => siteColors[s]),
      showLegend: true,
      legendPos: "b",
      legendFontSize: 8,
      legendFontFace: MBR_FONT,
      valGridLine: { color: MBR_COLORS.cardBorder, size: 0.5 },
      plotArea: { fill: { color: "FCFCFE" } },
      dataLabelPosition: "outEnd",
      dataLabelFormatCode: "#\\%",
    });

    // 100% goal reference line note
    slide.addText("\u25C6 100% = at goal", {
      x: MBR_W - 2.5, y: chartY, w: 2, h: 0.25,
      fontSize: 7, fontFace: MBR_FONT, color: MBR_COLORS.textSecondary, align: "right",
    });
  }

  // Data source
  const lastDate = fi?.lastDataDate || "";
  slide.addText("Data Source: BI data through " + lastDate, {
    x: 0.5, y: 7.05, w: 8, h: 0.2,
    fontSize: 7, fontFace: MBR_FONT, color: MBR_COLORS.textSecondary, italic: true,
  });
}

function buildMbrTnpsSlide(pres, perf) {
  const { tnpsData, tnpsGCS, tnpsBySite, tnpsByMonth, fiscalInfo } = perf;
  if (!tnpsData || tnpsData.length === 0) return;

  // Filter to current fiscal month for KPIs, partner ranking, and campaign tables
  const fiscalGCS = tnpsFiscalFilter(tnpsGCS, fiscalInfo);
  const fiscalAll = tnpsFiscalFilter(tnpsData, fiscalInfo);
  const fiscalOverall = calcTnpsScore(fiscalGCS);

  // Fiscal-month site breakdown
  const fiscalSiteGroups = {};
  fiscalAll.forEach(s => {
    if (!fiscalSiteGroups[s.siteLabel]) fiscalSiteGroups[s.siteLabel] = [];
    fiscalSiteGroups[s.siteLabel].push(s);
  });
  const fiscalBySite = Object.entries(fiscalSiteGroups).map(([label, surveys]) => ({
    label, isGCS: surveys[0].isGCS, ...calcTnpsScore(surveys),
  })).sort((a, b) => (b.score ?? -999) - (a.score ?? -999));

  // Fiscal period label
  let periodLabel = "Current Month";
  if (fiscalInfo) {
    const [sy, sm, sd] = fiscalInfo.fiscalStart.split("-").map(Number);
    const [ey, em, ed] = fiscalInfo.fiscalEnd.split("-").map(Number);
    const fmt = d => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    periodLabel = `${fmt(new Date(sy, sm-1, sd))} \u2013 ${fmt(new Date(ey, em-1, ed))}`;
  }

  const slide = pres.addSlide();
  slide.bkgd = MBR_COLORS.white;
  addMbrSlideHeader(slide, pres, "CUSTOMER EXPERIENCE \u2014 tNPS", `Current Fiscal Month: ${periodLabel}`);

  const cw = MBR_W - 1;
  const fontSize = 7;
  const cellBase = { fontSize, fontFace: MBR_FONT, valign: "middle" };
  const hdrBase = { fontSize, fontFace: MBR_FONT, bold: true, align: "center", valign: "middle", color: MBR_COLORS.white, fill: { color: MBR_COLORS.purple } };

  // ── KPI Strip ──
  const kpiY = 1.35;
  const kpiCards = [
    { label: `GCS tNPS (${fiscalOverall.total} surveys)`, value: `${fiscalOverall.score > 0 ? "+" : ""}${fiscalOverall.score}`, color: fiscalOverall.score >= 50 ? MBR_COLORS.green : fiscalOverall.score >= 20 ? MBR_COLORS.amber : MBR_COLORS.red },
    { label: "PROMOTER", value: `${Math.round(fiscalOverall.promoterPct)}%`, color: MBR_COLORS.green },
    { label: "PASSIVE", value: `${Math.round(fiscalOverall.passivePct)}%`, color: MBR_COLORS.amber },
    { label: "DETRACTOR", value: `${Math.round(fiscalOverall.detractorPct)}%`, color: MBR_COLORS.red },
  ];
  const kpiW = (cw - 0.3) / kpiCards.length;
  kpiCards.forEach((k, i) => {
    const kx = 0.5 + i * (kpiW + 0.1);
    slide.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: kx, y: kpiY, w: kpiW, h: 0.7, rectRadius: 0.05, fill: { color: MBR_COLORS.lightGray }, line: { color: MBR_COLORS.cardBorder, width: 0.5 } });
    slide.addShape(pres.shapes.RECTANGLE, { x: kx, y: kpiY, w: kpiW, h: 0.04, fill: { color: k.color } });
    slide.addText(k.label, { x: kx, y: kpiY + 0.08, w: kpiW, h: 0.2, fontSize: 7, fontFace: MBR_FONT, color: MBR_COLORS.textSecondary, align: "center" });
    slide.addText(k.value, { x: kx, y: kpiY + 0.25, w: kpiW, h: 0.4, fontSize: 24, fontFace: MBR_FONT, color: k.color, bold: true, align: "center" });
  });

  // ── Partner Ranking Table (left 60%) ──
  const tableY = 2.55;
  const tableW = cw * 0.6;
  slide.addText("PARTNER RANKING", { x: 0.5, y: tableY - 0.25, w: tableW, h: 0.2, fontSize: 8, fontFace: MBR_FONT, color: MBR_COLORS.purple, bold: true });

  // Build GCS aggregate + known partners only, sorted by score
  const knownVendors = ["GCS", "Avantive", "Global Telesourcing", "Results"];
  const gcsAgg = { label: "GCS (All Sites)", isGCS: true, isAgg: true, ...fiscalOverall };
  const partnerSites = fiscalBySite.filter(s => !s.isGCS && knownVendors.includes(s.label));
  const gcsSites = fiscalBySite.filter(s => s.isGCS);
  const ranked = [gcsAgg, ...partnerSites].sort((a, b) => (b.score ?? -999) - (a.score ?? -999));
  const aggIdx = ranked.findIndex(s => s.isAgg);
  const allRanked = [...ranked.slice(0, aggIdx + 1), ...gcsSites, ...ranked.slice(aggIdx + 1)];

  const rankHdr = ["#", "Site / Partner", "tNPS", "Surveys", "Prom%", "Det%"].map(h => ({ text: h, options: { ...hdrBase, align: h === "Site / Partner" ? "left" : "center" } }));
  let rank = 0;
  const rankRows = allRanked.map((s, i) => {
    const isSub = s.isGCS && !s.isAgg;
    if (!isSub) rank++;
    const rowBg = s.isGCS ? "FFFBEB" : (i % 2 === 0 ? MBR_COLORS.white : "F5F5FA");
    const base = { ...cellBase, fill: { color: rowBg } };
    const scoreColor = (s.score ?? 0) >= 50 ? MBR_COLORS.green : (s.score ?? 0) >= 20 ? MBR_COLORS.amber : MBR_COLORS.red;
    return [
      { text: isSub ? "" : String(rank), options: { ...base, align: "center", color: MBR_COLORS.textSecondary } },
      { text: isSub ? `  ${s.label}` : s.label, options: { ...base, align: "left", bold: s.isAgg, color: isSub ? MBR_COLORS.textSecondary : MBR_COLORS.textPrimary, fontSize: isSub ? 6.5 : 7.5 } },
      { text: `${(s.score ?? 0) > 0 ? "+" : ""}${s.score ?? 0}`, options: { ...base, align: "center", bold: true, color: scoreColor, fontSize: 8 } },
      { text: String(s.total || 0), options: { ...base, align: "center", color: MBR_COLORS.textSecondary } },
      { text: `${Math.round(s.promoterPct || 0)}%`, options: { ...base, align: "center", color: MBR_COLORS.green } },
      { text: `${Math.round(s.detractorPct || 0)}%`, options: { ...base, align: "center", color: MBR_COLORS.red } },
    ];
  });

  const colW1 = [0.35, 2.6, 0.7, 0.75, 0.6, 0.6];
  slide.addTable([rankHdr, ...rankRows], {
    x: 0.5, y: tableY, w: tableW,
    colW: colW1,
    rowH: 0.3,
    border: { type: "solid", pt: 0.5, color: MBR_COLORS.cardBorder },
  });

  // ── Campaign Table (right side) ──
  const campX = 0.5 + cw * 0.55;
  const campW = cw * 0.45;
  slide.addText("tNPS BY CAMPAIGN \u2014 GCS", { x: campX, y: tableY - 0.25, w: campW, h: 0.2, fontSize: 8, fontFace: MBR_FONT, color: MBR_COLORS.purple, bold: true });

  // Compute campaign stats from fiscal-filtered GCS surveys
  const campGroups = {};
  fiscalGCS.forEach(s => {
    const key = s.campaign;
    if (!campGroups[key]) campGroups[key] = { campaign: key, program: s.program, surveys: [] };
    campGroups[key].surveys.push(s);
  });
  const camps = Object.values(campGroups).map(g => ({ ...g, ...calcTnpsScore(g.surveys) })).sort((a, b) => (b.score ?? -999) - (a.score ?? -999));

  const campHdr = ["Campaign", "Program", "tNPS", "Surveys", "Prom%", "Det%"].map(h => ({ text: h, options: { ...hdrBase, align: h === "Campaign" || h === "Program" ? "left" : "center" } }));
  const campRows = camps.map((c, i) => {
    const rowBg = i % 2 === 0 ? MBR_COLORS.white : "F5F5FA";
    const base = { ...cellBase, fill: { color: rowBg } };
    const scoreColor = (c.score ?? 0) >= 50 ? MBR_COLORS.green : (c.score ?? 0) >= 20 ? MBR_COLORS.amber : MBR_COLORS.red;
    return [
      { text: c.campaign, options: { ...base, align: "left", color: MBR_COLORS.textPrimary } },
      { text: c.program || "", options: { ...base, align: "left", color: MBR_COLORS.amber, bold: !!c.program } },
      { text: `${(c.score ?? 0) > 0 ? "+" : ""}${c.score ?? 0}`, options: { ...base, align: "center", bold: true, color: scoreColor } },
      { text: String(c.total || 0), options: { ...base, align: "center", color: MBR_COLORS.textSecondary } },
      { text: `${Math.round(c.promoterPct || 0)}%`, options: { ...base, align: "center", color: MBR_COLORS.green } },
      { text: `${Math.round(c.detractorPct || 0)}%`, options: { ...base, align: "center", color: MBR_COLORS.red } },
    ];
  });

  const colW2 = [1.5, 0.75, 0.6, 0.7, 0.65, 0.6];
  slide.addTable([campHdr, ...campRows], {
    x: campX, y: tableY, w: campW,
    colW: colW2,
    rowH: 0.26,
    border: { type: "solid", pt: 0.5, color: MBR_COLORS.cardBorder },
  });

  // ── Monthly Vendor Trend (bottom strip) ──
  const trendY = 5.45;
  slide.addText("MONTHLY VENDOR RANKING", { x: 0.5, y: trendY - 0.25, w: cw, h: 0.2, fontSize: 8, fontFace: MBR_FONT, color: MBR_COLORS.purple, bold: true });

  const vendorColors = { "GCS": MBR_COLORS.amber, "Avantive": "6366f1", "Global Telesourcing": "0ea5e9", "Results": "8b5cf6" };
  const vendorNames = ["GCS", "Avantive", "Global Telesourcing", "Results"];
  const months = [...new Set(tnpsData.filter(s => s.month).map(s => s.month))].sort();
  const vendorMap = {};
  tnpsData.forEach(s => {
    if (!s.month) return;
    const vendor = s.isGCS ? "GCS" : s.siteLabel;
    if (!vendorNames.includes(vendor)) return;
    if (!vendorMap[s.month]) vendorMap[s.month] = {};
    if (!vendorMap[s.month][vendor]) vendorMap[s.month][vendor] = [];
    vendorMap[s.month][vendor].push(s);
  });

  // Legend
  const legX = 0.5;
  vendorNames.forEach((v, i) => {
    slide.addShape(pres.shapes.RECTANGLE, { x: legX + i * 1.8, y: trendY + 0.0, w: 0.15, h: 0.12, fill: { color: vendorColors[v] } });
    slide.addText(v, { x: legX + 0.2 + i * 1.8, y: trendY - 0.02, w: 1.5, h: 0.18, fontSize: 6, fontFace: MBR_FONT, color: MBR_COLORS.textSecondary });
  });

  // Monthly grouped bars as a table (score per vendor per month)
  const trendHdr = [{ text: "", options: hdrBase }, ...months.map(m => {
    const [y, mo] = m.split("-").map(Number);
    return { text: new Date(y, mo - 1, 1).toLocaleString("en-US", { month: "short", year: "numeric" }), options: hdrBase };
  })];
  const trendRows = vendorNames.map(v => {
    const base = { ...cellBase, align: "center" };
    return [
      { text: v, options: { ...base, align: "left", bold: v === "GCS", color: vendorColors[v] } },
      ...months.map(m => {
        const surveys = (vendorMap[m] || {})[v] || [];
        const stats = calcTnpsScore(surveys);
        const scoreColor = (stats.score ?? 0) >= 50 ? MBR_COLORS.green : (stats.score ?? 0) >= 20 ? MBR_COLORS.amber : MBR_COLORS.red;
        return { text: stats.total > 0 ? `${stats.score > 0 ? "+" : ""}${stats.score}  (${stats.total})` : "\u2014", options: { ...base, color: stats.total > 0 ? scoreColor : MBR_COLORS.textSecondary, bold: v === "GCS" } };
      }),
    ];
  });

  const trendColW = [1.5, ...months.map(() => (cw - 1.5) / months.length)];
  slide.addTable([trendHdr, ...trendRows], {
    x: 0.5, y: trendY + 0.2, w: cw,
    colW: trendColW,
    rowH: 0.28,
    border: { type: "solid", pt: 0.5, color: MBR_COLORS.cardBorder },
  });
}

function buildMbrPlaceholderSlides(pres, programs) {
  const cw = MBR_W - 1; // content width (0.5" margins each side)
  const s1 = pres.addSlide();
  s1.bkgd = MBR_COLORS.white;
  addMbrSlideHeader(s1, pres, "MEMBER & TEAM INSIGHTS", "Insights");
  let insightY = 1.5;
  (programs || []).forEach(prog => {
    s1.addText(prog.jobType, {
      x: 0.5, y: insightY, w: cw, h: 0.35,
      fontSize: 13, fontFace: MBR_FONT, color: MBR_COLORS.purple, bold: true,
    });
    s1.addText("Add member insights here", {
      x: 0.5, y: insightY + 0.35, w: cw, h: 0.6,
      fontSize: 10, fontFace: MBR_FONT, color: MBR_COLORS.textSecondary, italic: true,
    });
    insightY += 1.05;
  });
  const s2 = pres.addSlide();
  s2.bkgd = MBR_COLORS.white;
  addMbrSlideHeader(s2, pres, "OPERATIONS", "Looking Ahead");
  const opsSections = ["Attrition", "tNPS", "My Performance Stats"];
  opsSections.forEach((sec, i) => {
    const oy = 1.5 + i * 1.6;
    s2.addText(sec, {
      x: 0.5, y: oy, w: cw, h: 0.35,
      fontSize: 14, fontFace: MBR_FONT, color: MBR_COLORS.purple, bold: true,
    });
    s2.addText("Add content here", {
      x: 0.5, y: oy + 0.4, w: cw, h: 0.8,
      fontSize: 10, fontFace: MBR_FONT, color: MBR_COLORS.textSecondary, italic: true,
    });
  });
  const s3 = pres.addSlide();
  s3.bkgd = MBR_COLORS.white;
  addMbrSlideHeader(s3, pres, "ACTION ITEMS", "Looking Ahead");
  const colHeaders = ["COMCAST TEAM", "PARTNER TEAM"];
  colHeaders.forEach((hdr, i) => {
    const cx = i === 0 ? 0.5 : 6.9;
    s3.addText(hdr, {
      x: cx, y: 1.5, w: 5.8, h: 0.35,
      fontSize: 13, fontFace: MBR_FONT, color: MBR_COLORS.purple, bold: true,
    });
    s3.addText("Add action items here", {
      x: cx, y: 1.9, w: 5.8, h: 4,
      fontSize: 10, fontFace: MBR_FONT, color: MBR_COLORS.textSecondary, italic: true, valign: "top",
    });
  });
}

async function generateMBR(perf, onProgress, { includeAI = true } = {}) {
  const { programs, fiscalInfo } = perf;
  const pres = new pptxgen();
  pres.layout = "LAYOUT_WIDE";
  pres.author = "Performance Intel";
  pres.subject = "Monthly Business Review";
  const insights = {};
  for (let i = 0; i < programs.length; i++) {
    const prog = programs[i];
    if (!includeAI) { insights[prog.jobType] = { narrative: null, opps: null }; continue; }
    if (onProgress) onProgress(`Generating insights for ${prog.jobType}...`, i, programs.length);
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
    const cachedNarrative = getAICache("narrative", prog.jobType, prog.totalGoals);
    const cachedOpps = getAICache("opps", prog.jobType, prog.totalGoals);
    let narrative = cachedNarrative ? (Array.isArray(cachedNarrative) ? cachedNarrative.join("\n\n") : cachedNarrative) : null;
    let opps = cachedOpps ? (Array.isArray(cachedOpps) ? cachedOpps.join("\n") : cachedOpps) : null;
    if (!narrative) {
      try {
        const prompt = buildAIPrompt("narrative", aiData);
        const raw = await ollamaGenerate(prompt);
        if (raw) {
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
  if (onProgress) onProgress("Building slides...", programs.length, programs.length);
  buildMbrTitleSlide(pres, fiscalInfo);
  buildMbrSummarySlide(pres, perf);
  programs.forEach(prog => {
    const ins = insights[prog.jobType] || {};
    buildMbrProgramSlide(pres, prog, fiscalInfo, ins.narrative, ins.opps);
  });
  buildMbrSiteRankingSlide(pres, perf);
  buildMbrTnpsSlide(pres, perf);
  buildMbrPlaceholderSlides(pres, programs);
  const filename = formatFiscalFilename(fiscalInfo?.fiscalEnd);
  await pres.writeFile({ fileName: filename });
  return filename;
}

// ═══════════════════════════════════════════════════════════════════
// CORP MBR — Parsers
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
      sessions: Number(r["Coaching Sessions  (copy)"] ?? r["Coaching Sessions (copy)"] ?? r["Coaching Sessions"]) || 0,
      colorWb: (r["Color WB"] || "").trim(),
      manager: (r["Manager"] || "").trim(),
      supervisor: (r["Supervisor."] || "").trim(),
    };
  });
}

// Sheets can mis-coerce "4-7" → "7-Apr" and "8-15" → "15-Aug". Map them back.
// "0-3" and "16-20+" are safe because they aren't valid dates.
function normalizeLoginBucket(raw) {
  if (!raw) return "";
  const s = String(raw).trim();
  if (/^\d+-\d+\+?$/.test(s)) return s; // already canonical
  // Match patterns like "7-Apr" (DD-MMM), "4/7/2026", or ISO dates
  // Reconstruct D-M (swapped) as "M-D" string
  const mmm = s.match(/^(\d+)-([A-Za-z]{3,})$/);
  if (mmm) {
    const day = Number(mmm[1]);
    const mon = mmm[2].slice(0, 3).toLowerCase();
    const monthIndex = { jan:1, feb:2, mar:3, apr:4, may:5, jun:6, jul:7, aug:8, sep:9, oct:10, nov:11, dec:12 }[mon];
    if (monthIndex) return `${monthIndex}-${day}`;
  }
  const slash = s.match(/^(\d+)\/(\d+)(?:\/\d+)?$/);
  if (slash) return `${Number(slash[1])}-${Number(slash[2])}`;
  // Try parsing as a Date
  const d = new Date(s);
  if (!isNaN(d.getTime())) return `${d.getMonth() + 1}-${d.getDate()}`;
  return s;
}

// "25-Oct" (from Sheets date-coercion) → "Oct 25"; "Oct 25" passes through.
function normalizeLoginMonth(raw) {
  if (!raw) return "";
  const s = String(raw).trim();
  // Canonical "Oct 25" / "Oct '25" — always strip apostrophe for consistent keys
  if (/^[A-Za-z]{3,} ?'?\d{2}$/.test(s)) return s.replace(/'/g, "");
  // "25-Oct" / "25-October"
  const m = s.match(/^(\d{1,4})-([A-Za-z]{3,})$/);
  if (m) {
    const yr = m[1].length === 4 ? m[1].slice(2) : m[1];
    const mon = m[2].slice(0, 3);
    const cap = mon.charAt(0).toUpperCase() + mon.slice(1).toLowerCase();
    return `${cap} ${yr}`;
  }
  return s;
}

function parseLoginBuckets(rawCsv) {
  if (!rawCsv || !rawCsv.trim()) return {};
  const rows = parseCSV(rawCsv);
  const byMonth = {};
  for (const r of rows) {
    const bucket = normalizeLoginBucket((r["User Login Bucket (Alternative)"] || "").trim());
    const month = normalizeLoginMonth((r["Month vs Week View Label"] || "").trim());
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

// ═══════════════════════════════════════════════════════════════════
// CORP MBR — Aggregators
// ═══════════════════════════════════════════════════════════════════

// Converts a "Mar '26" / "Mar 26" style fiscal-month label to a canonical form.
function normalizeVirgilMonthKey(s) {
  if (!s) return "";
  return s.replace(/['"`]/g, "").replace(/\s+/g, " ").trim();
}

function getPriorMonthLabel(label) {
  if (!label) return "";
  const m = String(label).trim().match(/^([A-Za-z]{3,})\s*'?(\d{2,4})$/);
  if (!m) return "";
  const mon = m[1].slice(0, 3).toLowerCase();
  const monIdx = { jan:1, feb:2, mar:3, apr:4, may:5, jun:6, jul:7, aug:8, sep:9, oct:10, nov:11, dec:12 }[mon];
  if (!monIdx) return "";
  const year = Number(m[2].length === 4 ? m[2].slice(2) : m[2]);
  let pMon = monIdx - 1, pYear = year;
  if (pMon === 0) { pMon = 12; pYear = year - 1; }
  const monNames = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${monNames[pMon - 1]} '${String(pYear).padStart(2, "0")}`;
}

function getNextMonthLabel(label) {
  if (!label) return "";
  const m = String(label).trim().match(/^([A-Za-z]{3,})\s*'?(\d{2,4})$/);
  if (!m) return "";
  const mon = m[1].slice(0, 3).toLowerCase();
  const monIdx = { jan:1, feb:2, mar:3, apr:4, may:5, jun:6, jul:7, aug:8, sep:9, oct:10, nov:11, dec:12 }[mon];
  if (!monIdx) return "";
  const year = Number(m[2].length === 4 ? m[2].slice(2) : m[2]);
  let nMon = monIdx + 1, nYear = year;
  if (nMon === 13) { nMon = 1; nYear = year + 1; }
  const monNames = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${monNames[nMon - 1]} '${String(nYear).padStart(2, "0")}`;
}

function endOfMonthDate(label) {
  if (!label) return new Date();
  const m = String(label).trim().match(/^([A-Za-z]{3,})\s*'?(\d{2,4})$/);
  if (!m) return new Date();
  const mon = m[1].slice(0, 3).toLowerCase();
  const monIdx = { jan:1, feb:2, mar:3, apr:4, may:5, jun:6, jul:7, aug:8, sep:9, oct:10, nov:11, dec:12 }[mon];
  const yr = Number(m[2].length === 4 ? m[2] : `20${m[2]}`);
  return new Date(yr, monIdx, 0);
}

// Returns { org: {coachingPct, acknowledgePct, totalSessions}, dr: {...}, bz: {...} }
// Org values come from coachingDetails (authoritative monthly totals).
// DR/BZ splits come from weekly rows joined to bpLookup.
function buildCoachingStats(coachingDetails, coachingWeekly, bpLookup, reportingMonthLabel) {
  const key = normalizeVirgilMonthKey(reportingMonthLabel);
  const monthBucket = coachingDetails[reportingMonthLabel] || coachingDetails[key] || {};
  const org = {
    coachingPct: Number(monthBucket["Completed %"]) || (Number(monthBucket["Coaching Sessions"]) && Number(monthBucket["Coachings Due"]) ? Number(monthBucket["Coaching Sessions"]) / Number(monthBucket["Coachings Due"]) : 0),
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
  const priorKey = getPriorMonthLabel(reportingMonthLabel);
  const priorBucket = (coachingDetails[priorKey] || coachingDetails[normalizeVirgilMonthKey(priorKey)]) || {};
  const orgPrior = {
    coachingPct: Number(priorBucket["Completed %"]) || (Number(priorBucket["Coaching Sessions"]) && Number(priorBucket["Coachings Due"]) ? Number(priorBucket["Coaching Sessions"]) / Number(priorBucket["Coachings Due"]) : 0),
    acknowledgePct: Number(priorBucket["Acknowledged %"] || priorBucket["Acknowledged % "]) || 0,
    totalSessions: Number(priorBucket["Total Sessions"]) || 0,
  };
  const priorPriorKey = getPriorMonthLabel(priorKey);
  const priorPriorBucket = (coachingDetails[priorPriorKey] || coachingDetails[normalizeVirgilMonthKey(priorPriorKey)]) || {};
  const orgPriorPrior = {
    coachingPct: Number(priorPriorBucket["Completed %"]) || (Number(priorPriorBucket["Coaching Sessions"]) && Number(priorPriorBucket["Coachings Due"]) ? Number(priorPriorBucket["Coaching Sessions"]) / Number(priorPriorBucket["Coachings Due"]) : 0),
    acknowledgePct: Number(priorPriorBucket["Acknowledged %"] || priorPriorBucket["Acknowledged % "]) || 0,
    totalSessions: Number(priorPriorBucket["Total Sessions"]) || 0,
  };
  return { org, orgPrior, orgPriorPrior, dr: siteSummary(dr), bz: siteSummary(bz) };
}

// Returns an array of { bucket, pct, users } for the reporting month, in canonical bucket order.
function buildLoginDistribution(loginBuckets, reportingMonthLabel) {
  const order = ["0-3", "4-7", "8-15", "16-20+"];
  const monthBucket = loginBuckets[normalizeVirgilMonthKey(reportingMonthLabel)] || loginBuckets[reportingMonthLabel] || {};
  return order.map(b => ({
    bucket: b,
    pct: (monthBucket[b] && monthBucket[b].pct) || 0,
    users: (monthBucket[b] && monthBucket[b].users) || 0,
  }));
}

// Approximates "% of users with 1+ login" by treating the "0-3" bucket as mostly zero-loggers.
// Caveat: true 1+ login rate would be finer — this is the closest we can get from the 4-bucket CSV.
function buildLoginActivitySingle(loginBuckets, monthLabel) {
  const bucket = loginBuckets[normalizeVirgilMonthKey(monthLabel)] || loginBuckets[monthLabel] || {};
  const total = (bucket["0-3"]?.users || 0) + (bucket["4-7"]?.users || 0) + (bucket["8-15"]?.users || 0) + (bucket["16-20+"]?.users || 0);
  if (!total) return 0;
  const nonZero = (bucket["4-7"]?.users || 0) + (bucket["8-15"]?.users || 0) + (bucket["16-20+"]?.users || 0);
  return nonZero / total;
}

// Returns a predicate accepting a YYYY-MM-DD (or M/D/Y, etc.) date string.
// monthLabel like "Mar '26" / "Mar 26" / "March 2026" → matches year 2026, month 3.
function makeMonthFilter(monthLabel) {
  const m = String(monthLabel || "").trim().match(/^([A-Za-z]{3,})\s*'?(\d{2,4})$/);
  if (!m) return () => true;
  const mon = m[1].slice(0, 3).toLowerCase();
  const monIdx = { jan:1, feb:2, mar:3, apr:4, may:5, jun:6, jul:7, aug:8, sep:9, oct:10, nov:11, dec:12 }[mon];
  if (!monIdx) return () => false;
  const yr = Number(m[2].length === 4 ? m[2] : `20${m[2]}`);
  return (dateStr) => {
    if (!dateStr) return false;
    const parts = String(dateStr).trim().split(/[-\/]/);
    if (parts.length < 3) return false;
    let y, mo;
    if (parts[0].length === 4) { y = Number(parts[0]); mo = Number(parts[1]); }
    else { y = Number(parts[2].length === 4 ? parts[2] : `20${parts[2]}`); mo = Number(parts[0]); }
    return y === yr && mo === monIdx;
  };
}

// Predicate for a fiscal-year quarter. year = 2025, qNum = 4 → Oct–Dec 2025.
function makeQuarterFilter(year, qNum) {
  const startMon = (qNum - 1) * 3 + 1;
  return (dateStr) => {
    if (!dateStr) return false;
    const parts = String(dateStr).trim().split(/[-\/]/);
    if (parts.length < 3) return false;
    let y, mo;
    if (parts[0].length === 4) { y = Number(parts[0]); mo = Number(parts[1]); }
    else { y = Number(parts[2].length === 4 ? parts[2] : `20${parts[2]}`); mo = Number(parts[0]); }
    return y === year && mo >= startMon && mo <= startMon + 2;
  };
}

// Returns a predicate for filtering goals-CSV rows by their "Month" column.
// monthLabel like "Mar '26" / "March 2026" → matches rows where Month starts with "Mar".
function makeGoalsMonthFilter(monthLabel) {
  const m = String(monthLabel || "").trim().match(/^([A-Za-z]{3,})/);
  if (!m) return () => true;
  const mon3 = m[1].slice(0, 3).toLowerCase();
  return (row) => {
    const rowMon = String(row["Month"] || "").trim().slice(0, 3).toLowerCase();
    if (!rowMon) return true; // no Month column — include row (file is already month-scoped)
    return rowMon === mon3;
  };
}

// Returns a predicate for filtering goals-CSV rows by Quarter column (Q1-Q4).
function makeGoalsQuarterFilter(qStr) {
  // Q4 goals file may label rows as "Q3" (fiscal offset) or have no Quarter column.
  // We assume the file itself is already quarter-scoped, so include all rows.
  return () => true;
}

// Compute org-wide XI attainment %, XM attainment %, SPH, CPS for a filtered agent dataset.
// agentRaw / goalsRaw are the full CSVs; dateFilter(dateStr) → boolean tells which rows to include.
// goalsMonthFilter(row) → boolean filters goals rows by month (prevents multi-month over-counting).
// Returns numeric metrics (fractions for % fields, e.g. 0.943 = 94.3%).
function computeCorpAttainment(agentRaw, goalsRaw, dateFilter, goalsMonthFilter) {
  if (!agentRaw || !agentRaw.trim()) {
    return { xiPct: 0, xmPct: 0, sph: 0, cps: 0, sales: 0, hours: 0, xiPlan: 0, xmPlan: 0, hoursPlan: 0 };
  }
  const agentRows = parseCSV(agentRaw);
  const goalsRows = goalsRaw && goalsRaw.trim() ? parseCSV(goalsRaw) : [];
  let hours = 0, sales = 0, xi = 0, xm = 0;
  for (const r of agentRows) {
    const d = (r["Date"] || "").trim();
    if (dateFilter && !dateFilter(d)) continue;
    hours += Number(r["Hours"]) || 0;
    sales += Number(r["Goals"]) || 0;
    xi += Number(r["New XI"] || r["NewData"] || r["HSD RGUs"]) || 0;
    xm += Number(r["XM Lines"] || r["XMLines"] || r["NewXM"]) || 0;
  }
  let xiPlan = 0, xmPlan = 0, hoursPlan = 0;
  for (const r of goalsRows) {
    // Apply goals month filter if provided — goals CSV has a "Month" column like "March"/"April"
    if (goalsMonthFilter && !goalsMonthFilter(r)) continue;
    const parseNum = (v) => {
      const s = String(v == null ? "" : v).replace(/,/g, "").replace(/%/g, "");
      const n = Number(s);
      return Number.isFinite(n) ? n : 0;
    };
    hoursPlan += parseNum(r["Hours Goal"] || r["Hours per ROC"]);
    xiPlan += parseNum(r["HSD GOAL"] || r["HSD Unit Goal"]);
    xmPlan += parseNum(r["XM GOAL"] || r["XM Unit Goal"]);
  }
  const sph = hours ? sales / hours : 0;
  const cps = sales ? (hours * 19.77) / sales : (hours * 19.77);
  return {
    xiPct: xiPlan ? xi / xiPlan : 0,
    xmPct: xmPlan ? xm / xmPlan : 0,
    sph,
    cps,
    sales, hours, xi, xm, xiPlan, xmPlan, hoursPlan,
  };
}

// Groups qualified agents by campaign type (ROC prefix GLU = XM, GLN = XI),
// sorts each group by % to Goal and splits into 4 equal-sized quartiles,
// then cross-tabs by tenure bucket. Participation % = agents with ≥1 unit sold / total in bucket.
// Returns { xm: { quartileSummary, tenureMatrix } | null, xi: { quartileSummary, tenureMatrix } | null }.
function buildQuartileReport(agentRaw, goalsRaw, newHiresRaw, dateFilter, referenceDate) {
  if (!agentRaw || !agentRaw.trim()) return { xm: null, xi: null };
  const agentRows = parseCSV(agentRaw);
  const goalsRows = goalsRaw && goalsRaw.trim() ? parseCSV(goalsRaw) : [];
  const newHireRows = newHiresRaw && newHiresRaw.trim() ? parseCSV(newHiresRaw) : [];

  // Hire-date lookup by agent name (case-insensitive)
  const hireByName = {};
  for (const r of newHireRows) {
    const first = (r["First Name"] || "").trim();
    const last = (r["Last Name"] || "").trim();
    const name = `${first} ${last}`.toLowerCase();
    const hd = (r["Hire Date"] || "").trim();
    if (name && hd) hireByName[name] = hd;
  }

  // Per-campaign goals lookup by ROC
  const goalByRoc = {};
  for (const r of goalsRows) {
    const rocList = (r["ROC Numbers"] || "").split(",").map(s => s.trim()).filter(Boolean);
    for (const roc of rocList) {
      goalByRoc[roc] = r;
    }
  }

  // Aggregate per-agent for the filtered period, split by XM/XI group
  const byAgent = {};
  for (const r of agentRows) {
    if (dateFilter && !dateFilter((r["Date"] || "").trim())) continue;
    const name = (r["AgentName"] || "").trim();
    if (!name) continue;
    const roc = (r["Job"] || "").trim();
    const isGLU = roc.startsWith("GLU");
    const isGLN = roc.startsWith("GLN");
    if (!isGLU && !isGLN) continue;
    const key = `${name}|${isGLU ? "XM" : "XI"}`;
    if (!byAgent[key]) {
      byAgent[key] = { name, group: isGLU ? "XM" : "XI", hours: 0, sales: 0, xi: 0, xm: 0, roc };
    }
    const a = byAgent[key];
    a.hours += Number(r["Hours"]) || 0;
    a.sales += Number(r["Goals"]) || 0;
    a.xi += Number(r["New XI"] || r["NewData"] || r["HSD RGUs"]) || 0;
    a.xm += Number(r["XM Lines"] || r["XMLines"] || r["NewXM"]) || 0;
  }

  const refDate = referenceDate ? new Date(referenceDate) : new Date();
  const tenureBuckets = [
    [0, 30], [31, 60], [61, 90], [91, 120], [121, 150], [151, 180], [181, 360], [361, Infinity]
  ];
  const bucketLabel = (lo, hi) => hi === Infinity ? "361+" : `${lo}-${hi}`;

  const buildSection = (group) => {
    const agents = Object.values(byAgent).filter(a => a.group === group);
    const withMetrics = agents.map(a => {
      const goal = goalByRoc[a.roc];
      let unitGoal = 0;
      if (goal) {
        if (group === "XM") unitGoal = Number(goal["XM GOAL"] || goal["XM Sell In Goal"]) || 0;
        else unitGoal = Number(goal["HSD GOAL"] || goal["HSD Sell In Goal"]) || 0;
      }
      const unitsMade = group === "XM" ? a.xm : a.xi;
      const pctToGoal = unitGoal > 0 ? unitsMade / unitGoal : 0;
      const hireStr = hireByName[a.name.toLowerCase()] || "";
      let tenureDays = 0;
      if (hireStr) {
        try {
          const hd = new Date(hireStr);
          tenureDays = Math.floor((refDate - hd) / (1000 * 60 * 60 * 24));
        } catch(e) {}
      }
      return { ...a, unitsMade, unitGoal, pctToGoal, tenureDays };
    });

    withMetrics.sort((x, y) => y.pctToGoal - x.pctToGoal);
    const n = withMetrics.length;
    if (n === 0) return { quartileSummary: [], tenureMatrix: [] };
    const qSize = Math.ceil(n / 4);
    const quartiles = [[], [], [], []];
    for (let i = 0; i < n; i++) {
      const q = Math.min(3, Math.floor(i / qSize));
      quartiles[q].push(withMetrics[i]);
    }

    const quartileSummary = quartiles.map((qAgents, i) => {
      const unitsTotal = qAgents.reduce((s, a) => s + a.unitsMade, 0);
      const goalTotal = qAgents.reduce((s, a) => s + a.unitGoal, 0);
      const qPct = goalTotal > 0 ? unitsTotal / goalTotal : 0;
      return { quartile: i + 1, units: unitsTotal, pctToGoal: qPct, agentCount: qAgents.length };
    });

    const tenureMatrix = tenureBuckets.map(([lo, hi]) => {
      const inBucket = withMetrics.filter(a => a.tenureDays >= lo && a.tenureDays <= hi);
      const counts = [0, 0, 0, 0];
      inBucket.forEach(a => {
        const q = quartiles.findIndex(qa => qa.includes(a));
        if (q >= 0) counts[q] += 1;
      });
      const anySale = inBucket.filter(a => a.unitsMade >= 1).length;
      const total = inBucket.length;
      const participation = total ? anySale / total : 0;
      return { label: bucketLabel(lo, hi), A: counts[0], B: counts[1], C: counts[2], D: counts[3], participation, total };
    });

    return { quartileSummary, tenureMatrix };
  };

  return { xm: buildSection("XM"), xi: buildSection("XI") };
}

// Roll hours up per funding type for a given month-filtered agent dataset.
// Returns { byFunding: {Growth,National,Marketing,HQ}: {plan, actual}, totalPlan, totalActual, campaigns: [{name, funding, hoursGoal, hoursActual, par, roc}] }
function buildCampaignHoursByFunding(agentRaw, goalsRaw, monthFilter) {
  const goalsRows = goalsRaw && goalsRaw.trim() ? parseCSV(goalsRaw) : [];
  const agentRows = agentRaw && agentRaw.trim() ? parseCSV(agentRaw) : [];

  const rocMeta = {};
  for (const r of goalsRows) {
    const funding = (r["Funding"] || "").trim();
    const name = (r["Target Audience"] || r["Target"] || "").trim();
    const rocList = (r["ROC Numbers"] || "").split(",").map(s => s.trim()).filter(Boolean);
    const par = (r["PAR?"] || "").trim().toUpperCase() === "Y";
    const hoursGoal = Number(r["Hours Goal"]) || 0;
    for (const roc of rocList) {
      rocMeta[roc] = { funding, name, hoursGoal, par };
    }
  }

  const actualByRoc = {};
  for (const r of agentRows) {
    if (monthFilter && !monthFilter((r["Date"] || "").trim())) continue;
    const roc = (r["Job"] || "").trim();
    if (!roc) continue;
    actualByRoc[roc] = (actualByRoc[roc] || 0) + (Number(r["Hours"]) || 0);
  }

  const byFunding = {
    Growth: { plan: 0, actual: 0 },
    National: { plan: 0, actual: 0 },
    Marketing: { plan: 0, actual: 0 },
    HQ: { plan: 0, actual: 0 },
  };
  const campaigns = [];
  let totalPlan = 0, totalActual = 0;
  for (const roc in rocMeta) {
    const meta = rocMeta[roc];
    const act = actualByRoc[roc] || 0;
    if (byFunding[meta.funding]) {
      byFunding[meta.funding].plan += meta.hoursGoal;
      byFunding[meta.funding].actual += act;
    }
    totalPlan += meta.hoursGoal;
    totalActual += act;
    if (meta.name) {
      campaigns.push({ name: meta.name, funding: meta.funding, hoursGoal: meta.hoursGoal, hoursActual: act, par: meta.par, roc });
    }
  }
  return { byFunding, totalPlan, totalActual, campaigns };
}

// ═══════════════════════════════════════════════════════════════════
// CORP MBR — Brand Helpers
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

// Adds the top and bottom teal→purple brand bars + footer text to a slide.
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
  slide.addText("GLOBAL CALLCENTER SOLUTIONS", {
    x: 0.3, y: 7.05, w: 5, h: 0.2, fontSize: 8, color: virgilTheme.footerText, bold: true,
  });
  slide.addText("xfinity", {
    x: w - 1.0, y: 7.05, w: 0.9, h: 0.2, fontSize: 10, color: virgilTheme.footerText, align: "right",
  });
}

// ═══════════════════════════════════════════════════════════════════
// CORP MBR — Slide Builders
// ═══════════════════════════════════════════════════════════════════

// "Mar '26" / "Mar 26" / "March 2026" → "March 2026".
function expandMonthLabel(label) {
  if (!label) return "";
  const s = String(label).trim();
  const full = { jan:"January", feb:"February", mar:"March", apr:"April", may:"May", jun:"June", jul:"July", aug:"August", sep:"September", oct:"October", nov:"November", dec:"December" };
  const m = s.match(/^([A-Za-z]{3,})\s*'?(\d{2,4})$/);
  if (!m) return s;
  const monKey = m[1].slice(0, 3).toLowerCase();
  const monName = full[monKey] || m[1];
  const yr = m[2];
  const year = yr.length === 4 ? yr : (Number(yr) >= 50 ? `19${yr}` : `20${yr}`);
  return `${monName} ${year}`;
}

function buildVirgilTitleSlide(pres, reportingMonthLabel, fiscalInfo, virgilLastName) {
  const slide = pres.addSlide();
  const w = 13.333;
  const h = 7.5;

  // --- Pre-rendered title background (gradient + X + title + xfinity all baked in) ---
  slide.addImage({
    path: `${import.meta.env.BASE_URL}corp-mbr-title-bg.png`,
    x: 0, y: 0, w, h,
  });

  // --- Dynamic date (below the baked-in title) ---
  const ord = (d) => {
    const s = ["th", "st", "nd", "rd"];
    const v = d % 100;
    return s[(v - 20) % 10] || s[v] || s[0];
  };
  const today = new Date();
  const monthFull = today.toLocaleDateString("en-US", { month: "long" }).toUpperCase();
  const day = today.getDate();
  const year = today.getFullYear();
  const dateText = `${monthFull} ${day}${ord(day).toUpperCase()}, ${year}`;
  slide.addText(dateText, {
    x: 0.5, y: 3.55, w: 12.33, h: 0.35,
    fontSize: 11, color: "FFFFFF", bold: true,
    charSpacing: 5, align: "center",
  });

  // --- Business partner line ---
  slide.addText("GLOBAL CALLCENTER SOLUTIONS", {
    x: 0.5, y: 3.95, w: 12.33, h: 0.35,
    fontSize: 11, color: "FFFFFF", bold: true,
    charSpacing: 4, align: "center",
  });

  // --- Presenters ---
  slide.addText("Presented by Joshua Edgecomb, Frank Daley, Jasmine Mendoza", {
    x: 0.5, y: 4.35, w: 12.33, h: 0.3,
    fontSize: 10, color: "FFFFFF", italic: true,
    align: "center",
  });
}

function buildVirgilMyPerformanceSlide(pres, stats, loginBuckets, priorPriorMonthLabel, priorMonthLabel, reportingMonthLabel, insightsText) {
  const slide = pres.addSlide();
  slide.background = { color: virgilTheme.slideBg };
  virgilBrandBars(pres, slide);

  // Month abbreviation helpers
  const monAbbrev = (label) => {
    if (!label) return "";
    const m = String(label).trim().match(/^([A-Za-z]{3,})/);
    return m ? m[1].slice(0, 3) : label;
  };
  const priorPriorAbbrev = monAbbrev(priorPriorMonthLabel) || "";
  const priorAbbrev = monAbbrev(priorMonthLabel) || "Prior";
  const currAbbrev = monAbbrev(reportingMonthLabel) || "Current";

  // Eyebrow + title
  slide.addText("OPERATIONAL PERFORMANCE", {
    x: 0.5, y: 0.35, w: 6, h: 0.25,
    fontSize: 10, color: virgilTheme.eyebrow, bold: true, charSpacing: 2,
  });
  slide.addText(`Global Callcenter Solutions | Quality and Coaching`, {
    x: 0.5, y: 0.65, w: 12, h: 0.55,
    fontSize: 26, color: virgilTheme.bodyText, bold: true,
  });

  // Legend (top right) — 3 months + goal line
  const legendY = 0.7;
  slide.addShape("rect", { x: 9.5, y: legendY, w: 0.22, h: 0.18, fill: { color: "A78BFA" }, line: { type: "none" } });
  slide.addText(priorPriorAbbrev, { x: 9.78, y: legendY - 0.03, w: 0.7, h: 0.25, fontSize: 10, color: virgilTheme.bodyText });
  slide.addShape("rect", { x: 10.65, y: legendY, w: 0.22, h: 0.18, fill: { color: "7C3AED" }, line: { type: "none" } });
  slide.addText(priorAbbrev, { x: 10.93, y: legendY - 0.03, w: 0.7, h: 0.25, fontSize: 10, color: virgilTheme.bodyText });
  slide.addShape("rect", { x: 11.8, y: legendY, w: 0.22, h: 0.18, fill: { color: "1E3A8A" }, line: { type: "none" } });
  slide.addText(currAbbrev, { x: 12.08, y: legendY - 0.03, w: 0.75, h: 0.25, fontSize: 10, color: virgilTheme.bodyText });
  slide.addText("---  Goal (75%)", { x: 9.5, y: legendY + 0.22, w: 3.3, h: 0.2, fontSize: 9, color: virgilTheme.subtle, italic: true });

  // Full-month-name helper
  const monFull = (label) => {
    if (!label) return "";
    const m = String(label).trim().match(/^([A-Za-z]{3,})/);
    const full = { jan:"January", feb:"February", mar:"March", apr:"April", may:"May", jun:"June", jul:"July", aug:"August", sep:"September", oct:"October", nov:"November", dec:"December" };
    return m ? (full[m[1].slice(0, 3).toLowerCase()] || m[1]) : label;
  };
  const priorPriorFull = monFull(priorPriorMonthLabel);
  const priorFull = monFull(priorMonthLabel);
  const currFull = monFull(reportingMonthLabel);

  // 2-column layout constants
  const leftColX = 0.5;
  const leftColW = 5.3;
  const chartTopY = 1.3;
  const chartTopH = 2.7;
  const chartBotY = 4.15;
  const chartBotH = 2.7;
  const rightColX = 6.2;
  const rightColW = 6.6;

  // Bar chart helper — parameterized x, y, width, height
  const drawBarChart = (x, y, width, height, title, priorPriorPct, priorPct, currPct) => {
    // Title
    slide.addText(title, {
      x, y, w: width, h: 0.3,
      fontSize: 13, color: virgilTheme.bodyText, bold: true, align: "center",
    });
    // Axis area
    const axisX = x + 0.4;
    const axisY = y + 0.4;
    const axisW = width - 0.6;
    const axisH = height - 0.8;
    // Plot background
    slide.addShape("rect", {
      x: axisX, y: axisY, w: axisW, h: axisH,
      fill: { color: "FAFAFA" },
      line: { color: "E5E7EB", width: 0.5 },
    });
    // Y-axis gridlines with % labels
    const ticks = [0, 0.25, 0.5, 0.75, 1.0];
    ticks.forEach(t => {
      const ty = axisY + axisH * (1 - t);
      slide.addShape("line", {
        x: axisX, y: ty, w: axisW, h: 0,
        line: { color: "E5E7EB", width: 0.5 },
      });
      slide.addText(`${(t * 100).toFixed(0)}%`, {
        x: x + 0.02, y: ty - 0.1, w: 0.38, h: 0.2,
        fontSize: 7, color: virgilTheme.subtle, align: "right",
      });
    });
    // 75% goal line (dashed)
    const goalY = axisY + axisH * (1 - 0.75);
    slide.addShape("line", {
      x: axisX, y: goalY, w: axisW, h: 0,
      line: { color: "9CA3AF", width: 1.2, dashType: "dash" },
    });
    // Three bars (priorPrior, prior, current) at 20/50/80% of axisW
    const barW = axisW * 0.18;
    const barPositions = [0.20, 0.50, 0.80];
    const barColors = ["A78BFA", "7C3AED", "1E3A8A"];
    const barValues = [priorPriorPct, priorPct, currPct];
    const barLabels = [priorPriorAbbrev, priorAbbrev, currAbbrev];
    barValues.forEach((v, i) => {
      const barX = axisX + axisW * barPositions[i] - barW / 2;
      const barHpx = axisH * Math.max(0, Math.min(1, v));
      slide.addShape("rect", {
        x: barX, y: axisY + axisH - barHpx, w: barW, h: barHpx,
        fill: { color: barColors[i] }, line: { type: "none" },
      });
      slide.addText(`${(v * 100).toFixed(1)}%`, {
        x: barX - 0.2, y: axisY + axisH - barHpx + 0.05, w: barW + 0.4, h: 0.25,
        fontSize: 10, color: "FFFFFF", bold: true, align: "center",
      });
      slide.addText(barLabels[i], {
        x: barX - 0.3, y: axisY + axisH + 0.05, w: barW + 0.6, h: 0.22,
        fontSize: 9, color: virgilTheme.subtle, align: "center",
      });
    });
  };

  // Left column — two stacked bar charts
  drawBarChart(leftColX, chartTopY, leftColW, chartTopH, "Coaching Standard Attainment",
    stats.orgPriorPrior.coachingPct || 0, stats.orgPrior.coachingPct || 0, stats.org.coachingPct || 0);
  drawBarChart(leftColX, chartBotY, leftColW, chartBotH, "Acknowledge %",
    stats.orgPriorPrior.acknowledgePct || 0, stats.orgPrior.acknowledgePct || 0, stats.org.acknowledgePct || 0);

  // Right column — Login Activity table
  const bucketOrder = ["16-20+", "8-15", "4-7", "0-3"];
  const loginTable = bucketOrder.map(b => {
    const pickMonth = (label) => loginBuckets[normalizeVirgilMonthKey(label)] || loginBuckets[label] || {};
    const priorPriorMonth = pickMonth(priorPriorMonthLabel);
    const priorMonth = pickMonth(priorMonthLabel);
    const currMonth = pickMonth(reportingMonthLabel);
    const priorPriorCell = priorPriorMonth[b] || { users: 0, pct: 0 };
    const priorCell = priorMonth[b] || { users: 0, pct: 0 };
    const currCell = currMonth[b] || { users: 0, pct: 0 };
    return {
      bucket: b,
      ppUsers: priorPriorCell.users, ppPct: priorPriorCell.pct,
      pUsers: priorCell.users, pPct: priorCell.pct,
      cUsers: currCell.users, cPct: currCell.pct,
    };
  });
  slide.addText("myPerformance Login Activity", {
    x: rightColX, y: chartTopY, w: rightColW, h: 0.3,
    fontSize: 13, color: virgilTheme.bodyText, bold: true, align: "center",
  });
  const tableRows = [
    [
      { text: "", options: { fill: { color: "F3F4F6" } } },
      { text: priorPriorFull, options: { fill: { color: "EDE9FE" }, color: "1F2937", bold: true, colspan: 2, align: "center" } },
      { text: priorFull, options: { fill: { color: "E9D5FF" }, color: "1F2937", bold: true, colspan: 2, align: "center" } },
      { text: currFull, options: { fill: { color: "DBEAFE" }, color: "1F2937", bold: true, colspan: 2, align: "center" } },
    ],
    [
      { text: "Bucket", options: { fill: { color: "F3F4F6" }, bold: true, align: "center" } },
      { text: "Users", options: { fill: { color: "F5F3FF" }, bold: true, align: "center" } },
      { text: "% Users", options: { fill: { color: "F5F3FF" }, bold: true, align: "center" } },
      { text: "Users", options: { fill: { color: "F3E8FF" }, bold: true, align: "center" } },
      { text: "% Users", options: { fill: { color: "F3E8FF" }, bold: true, align: "center" } },
      { text: "Users", options: { fill: { color: "EFF6FF" }, bold: true, align: "center" } },
      { text: "% Users", options: { fill: { color: "EFF6FF" }, bold: true, align: "center" } },
    ],
    ...loginTable.map(row => ([
      { text: row.bucket, options: { bold: true, align: "center" } },
      { text: String(row.ppUsers), options: { align: "center" } },
      { text: `${(row.ppPct * 100).toFixed(1)}%`, options: { align: "center" } },
      { text: String(row.pUsers), options: { align: "center" } },
      { text: `${(row.pPct * 100).toFixed(1)}%`, options: { align: "center" } },
      { text: String(row.cUsers), options: { align: "center" } },
      { text: `${(row.cPct * 100).toFixed(1)}%`, options: { align: "center" } },
    ])),
  ];
  slide.addTable(tableRows, {
    x: rightColX, y: chartTopY + 0.35, w: rightColW,
    colW: [0.85, 0.78, 0.90, 0.78, 0.90, 0.78, 0.90],
    rowH: 0.38,
    fontSize: 10,
    color: virgilTheme.bodyText,
    border: { type: "solid", pt: 0.5, color: "D1D5DB" },
    autoPage: false,
  });

  // Insights — right column, below the table
  const insY = 4.25;
  const insH = 2.6;
  slide.addShape("rect", {
    x: rightColX, y: insY, w: rightColW, h: 0.4,
    fill: { color: "1E3A8A" }, line: { type: "none" },
  });
  slide.addText("Insights", {
    x: rightColX, y: insY + 0.03, w: rightColW, h: 0.35,
    fontSize: 14, color: "FFFFFF", bold: true, align: "center",
  });
  const bullets = (insightsText || "").split(/\n+/).map(s => s.trim()).filter(Boolean);
  if (bullets.length === 0) {
    slide.addText("Provide insights in the export modal", {
      x: rightColX + 0.2, y: insY + 0.55, w: rightColW - 0.4, h: insH - 0.6,
      fontSize: 11, color: virgilTheme.subtle, italic: true, valign: "top",
    });
  } else {
    slide.addText(
      bullets.map(t => ({ text: t, options: { bullet: { code: "2022" } } })),
      {
        x: rightColX + 0.2, y: insY + 0.55, w: rightColW - 0.4, h: insH - 0.6,
        fontSize: 11, color: virgilTheme.bodyText, valign: "top", paraSpaceAfter: 4,
      }
    );
  }
}

function buildCorpOpPerformanceSlide(pres, agentRaw, goalsRaw, priorAgentRaw, priorGoalsRaw, priorQuarterAgentRaw, priorQuarterGoalsRaw, reportingMonthLabel, scorecardDataUrl, vendorScores, corpPriorMonthAgentRaw, corpPriorMonthGoalsRaw) {
  const slide = pres.addSlide();
  slide.background = { color: virgilTheme.slideBg };
  virgilBrandBars(pres, slide);

  slide.addText("OPERATIONAL PERFORMANCE", {
    x: 0.5, y: 0.35, w: 6, h: 0.25,
    fontSize: 10, color: virgilTheme.eyebrow, bold: true, charSpacing: 2,
  });
  slide.addText(`Global Callcenter Solutions | All-in Attainment — ${reportingMonthLabel}`, {
    x: 0.5, y: 0.65, w: 12, h: 0.5,
    fontSize: 22, color: virgilTheme.bodyText, bold: true,
  });

  // Time periods: Q4 / (R-2) / (R-1) / R as MTD
  const prior1 = getPriorMonthLabel(reportingMonthLabel);   // R-1
  const prior2 = getPriorMonthLabel(prior1);                 // R-2
  const yrMatch = String(reportingMonthLabel || "").trim().match(/^([A-Za-z]{3,})\s*'?(\d{2,4})$/);
  const reportYear = yrMatch ? Number(yrMatch[2].length === 4 ? yrMatch[2] : `20${yrMatch[2]}`) : new Date().getFullYear();
  const q4Label = `Q4 ${reportYear - 1}`;

  // Compute all 4 periods
  // Q4 file is already quarter-scoped (fiscal months, Sep 22 - Dec 21).
  // Pass null filters to include every row without date restriction.
  const q4 = computeCorpAttainment(priorQuarterAgentRaw, priorQuarterGoalsRaw, null, null);
  const colP2 = computeCorpAttainment(corpPriorMonthAgentRaw, corpPriorMonthGoalsRaw,
    makeMonthFilter(prior2), makeGoalsMonthFilter(prior2));
  const colP1 = computeCorpAttainment(priorAgentRaw, priorGoalsRaw,
    makeMonthFilter(prior1), makeGoalsMonthFilter(prior1));
  const colMtd = computeCorpAttainment(agentRaw, goalsRaw,
    makeMonthFilter(reportingMonthLabel), makeGoalsMonthFilter(reportingMonthLabel));

  // Colors
  const barCol = "1E3A8A";       // navy for first 3
  const barColMtd = "7C3AED";    // purple for MTD
  const goalCol = "16A34A";      // green goal line
  const plotBg = "FAFAFA";
  const plotBorder = "E5E7EB";
  const labels = [q4Label, prior2, prior1, `${reportingMonthLabel} MTD`];

  // Chart-drawing helper
  const drawChart = (x, y, w, h, title, values, format, goalVal) => {
    // Title
    slide.addText(title, {
      x, y, w, h: 0.3,
      fontSize: 12, color: virgilTheme.bodyText, bold: true, align: "center",
    });
    // Plot area
    const axisX = x + 0.35;
    const axisY = y + 0.35;
    const axisW = w - 0.5;
    const axisH = h - 0.8;
    slide.addShape("rect", {
      x: axisX, y: axisY, w: axisW, h: axisH,
      fill: { color: plotBg }, line: { color: plotBorder, width: 0.5 },
    });
    // Scale: find the max value across present values + goal for y-axis fit
    const present = values.filter(v => v !== null && v !== undefined && !isNaN(v));
    const effMax = Math.max(...present, goalVal != null ? goalVal : 0, 0.001);
    const scaleMax = effMax * 1.15; // headroom
    const valToY = (v) => axisY + axisH - (Math.max(0, v) / scaleMax) * axisH;
    // Goal line (green dashed) if provided
    if (goalVal != null) {
      const gy = valToY(goalVal);
      slide.addShape("line", {
        x: axisX, y: gy, w: axisW, h: 0,
        line: { color: goalCol, width: 1.5, dashType: "dash" },
      });
    }
    // Bars
    const barW = axisW * 0.16;
    const slotW = axisW / values.length;
    values.forEach((v, i) => {
      if (v === null || v === undefined || isNaN(v)) return;
      const barX = axisX + slotW * i + (slotW - barW) / 2;
      const barY = valToY(v);
      const barH = axisY + axisH - barY;
      const color = i === values.length - 1 ? barColMtd : barCol;
      slide.addShape("rect", {
        x: barX, y: barY, w: barW, h: barH,
        fill: { color }, line: { type: "none" },
      });
      slide.addText(format(v), {
        x: barX - 0.1, y: barY + 0.05, w: barW + 0.2, h: 0.25,
        fontSize: 9, color: "FFFFFF", bold: true, align: "center",
      });
    });
    // X-axis labels
    labels.forEach((lbl, i) => {
      const lblX = axisX + slotW * i;
      slide.addText(lbl, {
        x: lblX, y: axisY + axisH + 0.05, w: slotW, h: 0.22,
        fontSize: 8, color: virgilTheme.subtle, align: "center",
      });
    });
  };

  // Top row — 3 charts
  const topY = 1.35;
  const chartH = 2.4;
  const chartW = 4.1;
  const col1X = 0.5;
  const col2X = 4.7;
  const col3X = 8.9;

  drawChart(col1X, topY, chartW, chartH, "XI Attainment",
    [q4.xiPct, colP2.xiPct, colP1.xiPct, colMtd.xiPct].map(v => v || 0),
    v => `${(v * 100).toFixed(0)}%`, 1.0);
  drawChart(col2X, topY, chartW, chartH, "XM Attainment",
    [q4.xmPct, colP2.xmPct, colP1.xmPct, colMtd.xmPct].map(v => v || 0),
    v => `${(v * 100).toFixed(0)}%`, 1.0);
  drawChart(col3X, topY, chartW, chartH, "SPH Attainment",
    [q4.sph, colP2.sph, colP1.sph, colMtd.sph],
    v => v.toFixed(2), null);

  // Bottom row — 3 panels (CPS, Scorecard, Insights)
  const botY = 4.0;
  const botH = 2.4;

  drawChart(col1X, botY, chartW, botH, "CPS Attainment",
    [q4.cps, colP2.cps, colP1.cps, colMtd.cps],
    v => `$${v.toFixed(0)}`, null);

  // Scorecard by BP (4-bar chart from manual vendor scores)
  const vendors = ["Results", "GTCX", "GCS", "Avantive"];
  const vendorVals = vendors.map(v => {
    const n = Number((vendorScores || {})[v]);
    return Number.isFinite(n) && n > 0 ? n : 0;
  });
  {
    const x = col2X, y = botY, w = chartW, h = botH;
    const title = "Scorecard by BP";
    slide.addText(title, {
      x, y, w, h: 0.3,
      fontSize: 12, color: virgilTheme.bodyText, bold: true, align: "center",
    });
    const axisX = x + 0.35;
    const axisY = y + 0.35;
    const axisW = w - 0.5;
    const axisH = h - 0.8;
    slide.addShape("rect", {
      x: axisX, y: axisY, w: axisW, h: axisH,
      fill: { color: plotBg }, line: { color: plotBorder, width: 0.5 },
    });
    const present = vendorVals.filter(v => v > 0);
    const effMax = Math.max(...present, 0.001);
    const scaleMax = effMax * 1.15;
    const barW = axisW * 0.16;
    const slotW = axisW / vendorVals.length;
    vendorVals.forEach((v, i) => {
      if (!v) return;
      const barX = axisX + slotW * i + (slotW - barW) / 2;
      const barY = axisY + axisH - (v / scaleMax) * axisH;
      const h2 = axisY + axisH - barY;
      const color = vendors[i] === "GCS" ? barColMtd : barCol;
      slide.addShape("rect", {
        x: barX, y: barY, w: barW, h: h2,
        fill: { color }, line: { type: "none" },
      });
      slide.addText(v.toFixed(3), {
        x: barX - 0.1, y: barY + 0.05, w: barW + 0.2, h: 0.25,
        fontSize: 9, color: "FFFFFF", bold: true, align: "center",
      });
    });
    vendors.forEach((lbl, i) => {
      const lblX = axisX + slotW * i;
      slide.addText(lbl, {
        x: lblX, y: axisY + axisH + 0.05, w: slotW, h: 0.22,
        fontSize: 8, color: virgilTheme.subtle, align: "center",
      });
    });
  }

  // Insights panel (right)
  const insX = col3X;
  slide.addShape("rect", {
    x: insX, y: botY, w: chartW, h: 0.4,
    fill: { color: "1E3A8A" }, line: { type: "none" },
  });
  slide.addText("Insights", {
    x: insX, y: botY + 0.03, w: chartW, h: 0.35,
    fontSize: 14, color: "FFFFFF", bold: true, align: "center",
  });
  slide.addText("Provide insights in the export modal", {
    x: insX + 0.2, y: botY + 0.5, w: chartW - 0.4, h: botH - 0.55,
    fontSize: 11, color: virgilTheme.subtle, italic: true, valign: "top",
  });

  // Footer legend
  const legY = 6.55;
  slide.addShape("rect", { x: 4.2, y: legY + 0.05, w: 0.25, h: 0.15, fill: { color: barCol }, line: { type: "none" } });
  slide.addText("Company", { x: 4.5, y: legY, w: 1.0, h: 0.25, fontSize: 10, color: virgilTheme.bodyText });
  slide.addText("---  Goal", { x: 5.6, y: legY, w: 1.0, h: 0.25, fontSize: 10, color: goalCol, italic: true });
  slide.addShape("rect", { x: 6.7, y: legY + 0.05, w: 0.25, h: 0.15, fill: { color: barColMtd }, line: { type: "none" } });
  slide.addText("MTD", { x: 7.0, y: legY, w: 1.0, h: 0.25, fontSize: 10, color: virgilTheme.bodyText });
}

function buildCorpQuartileSlide(pres, agentRaw, goalsRaw, newHiresRaw, reportingMonthLabel) {
  const slide = pres.addSlide();
  slide.background = { color: virgilTheme.slideBg };
  virgilBrandBars(pres, slide);

  slide.addText("OPERATIONAL PERFORMANCE", {
    x: 0.5, y: 0.35, w: 6, h: 0.25,
    fontSize: 10, color: virgilTheme.eyebrow, bold: true, charSpacing: 2,
  });
  slide.addText("Global Callcenter Solutions | Quartile Reporting", {
    x: 0.5, y: 0.65, w: 12, h: 0.5,
    fontSize: 24, color: virgilTheme.bodyText, bold: true,
  });

  const reportingPeriodLabel = getPriorMonthLabel(reportingMonthLabel);
  const mtdLabel = reportingMonthLabel;
  const reporting = buildQuartileReport(agentRaw, goalsRaw, newHiresRaw,
    makeMonthFilter(reportingPeriodLabel), endOfMonthDate(reportingPeriodLabel));
  const mtd = buildQuartileReport(agentRaw, goalsRaw, newHiresRaw,
    makeMonthFilter(mtdLabel), new Date());

  const colW = 6.25;
  const col1X = 0.5;
  const col2X = 6.9;

  const drawQuartileColumn = (xBase, header, report) => {
    slide.addText(header, {
      x: xBase, y: 1.25, w: colW, h: 0.3,
      fontSize: 13, color: virgilTheme.eyebrow, bold: true,
    });
    if (!report || !report.xm) {
      slide.addText("No data", {
        x: xBase, y: 1.6, w: colW, h: 0.3,
        fontSize: 11, color: virgilTheme.subtle, italic: true,
      });
      return;
    }
    const drawSection = (y, label, section) => {
      slide.addText(label, {
        x: xBase, y, w: colW, h: 0.25,
        fontSize: 11, color: virgilTheme.bodyText, bold: true,
      });
      if (!section || !section.quartileSummary || section.quartileSummary.length === 0) {
        slide.addText("(no data)", {
          x: xBase, y: y + 0.25, w: colW, h: 0.25,
          fontSize: 9, color: virgilTheme.subtle, italic: true,
        });
        return;
      }
      const qColors = ["16A34A", "F59E0B", "F97316", "DC2626"];
      const summaryRows = [
        [{ text: "Q", options: { bold: true, align: "center", fill: { color: "F3F4F6" } } },
         { text: "Units", options: { bold: true, align: "center", fill: { color: "F3F4F6" } } },
         { text: "% to Goal", options: { bold: true, align: "center", fill: { color: "F3F4F6" } } }],
        ...section.quartileSummary.map((q, i) => ([
          { text: String(q.quartile), options: { align: "center", fill: { color: qColors[i] }, color: "FFFFFF", bold: true } },
          { text: String(q.units), options: { align: "center" } },
          { text: `${(q.pctToGoal * 100).toFixed(1)}%`, options: { align: "center" } },
        ])),
      ];
      slide.addTable(summaryRows, {
        x: xBase, y: y + 0.25, w: 2.6,
        colW: [0.5, 1.0, 1.1],
        rowH: 0.28,
        fontSize: 9,
        border: { type: "solid", pt: 0.5, color: "D1D5DB" },
        autoPage: false,
      });

      const matrixRows = [
        [
          { text: "Tenure", options: { bold: true, align: "center", fill: { color: "F3F4F6" } } },
          { text: "A", options: { bold: true, align: "center", fill: { color: "16A34A" }, color: "FFFFFF" } },
          { text: "B", options: { bold: true, align: "center", fill: { color: "F59E0B" }, color: "FFFFFF" } },
          { text: "C", options: { bold: true, align: "center", fill: { color: "F97316" }, color: "FFFFFF" } },
          { text: "D", options: { bold: true, align: "center", fill: { color: "DC2626" }, color: "FFFFFF" } },
          { text: "Part %", options: { bold: true, align: "center", fill: { color: "F3F4F6" } } },
        ],
        ...section.tenureMatrix.map(row => ([
          { text: row.label, options: { bold: true, align: "center" } },
          { text: String(row.A), options: { align: "center" } },
          { text: String(row.B), options: { align: "center" } },
          { text: String(row.C), options: { align: "center" } },
          { text: String(row.D), options: { align: "center" } },
          { text: `${(row.participation * 100).toFixed(1)}%`, options: { align: "center" } },
        ])),
      ];
      slide.addTable(matrixRows, {
        x: xBase + 2.7, y: y + 0.25, w: 3.5,
        colW: [0.75, 0.45, 0.45, 0.45, 0.45, 0.95],
        rowH: 0.24,
        fontSize: 8,
        border: { type: "solid", pt: 0.5, color: "D1D5DB" },
        autoPage: false,
      });
    };

    drawSection(1.65, "XM Participation (GLU)", report.xm);
    drawSection(4.55, "XI Participation (GLN)", report.xi);
  };

  drawQuartileColumn(col1X, `Month Reporting On — ${reportingPeriodLabel}`, reporting);
  drawQuartileColumn(col2X, `MTD — ${mtdLabel}`, mtd);
}

function buildCorpCampaignHoursSlide(pres, agentRaw, goalsRaw, priorAgentRaw, priorGoalsRaw, reportingMonthLabel, corpPriorMonthAgentRaw, corpPriorMonthGoalsRaw) {
  const slide = pres.addSlide();
  slide.background = { color: virgilTheme.slideBg };
  virgilBrandBars(pres, slide);

  slide.addText("OPERATIONAL PERFORMANCE", {
    x: 0.5, y: 0.35, w: 6, h: 0.25,
    fontSize: 10, color: virgilTheme.eyebrow, bold: true, charSpacing: 2,
  });
  slide.addText("Global Callcenter Solutions | Campaign Info", {
    x: 0.5, y: 0.65, w: 12, h: 0.5,
    fontSize: 24, color: virgilTheme.bodyText, bold: true,
  });

  const reportingPeriodLabel = getPriorMonthLabel(reportingMonthLabel);  // input-1
  const previousMonthLabel = getPriorMonthLabel(reportingPeriodLabel);   // input-2
  const mtdLabel = reportingMonthLabel;                                   // input
  const prior = buildCampaignHoursByFunding(corpPriorMonthAgentRaw, corpPriorMonthGoalsRaw, makeMonthFilter(previousMonthLabel));
  const reporting = buildCampaignHoursByFunding(priorAgentRaw, priorGoalsRaw, makeMonthFilter(reportingPeriodLabel));
  const mtd = buildCampaignHoursByFunding(agentRaw, goalsRaw, makeMonthFilter(mtdLabel));

  const fundingOrder = ["Growth", "National", "Marketing", "HQ"];
  const fundingColors = { Growth: "0E7490", National: "1E293B", Marketing: "8B5CF6", HQ: "374151" };

  const drawBarGroup = (y, label, data) => {
    slide.addText(`Total ${label} Monthly Budgeted Hours = ${Math.round(data.totalPlan).toLocaleString()}`, {
      x: 0.5, y, w: 12.3, h: 0.25,
      fontSize: 11, color: virgilTheme.bodyText, bold: true, align: "center",
    });
    const rowY1 = y + 0.35;
    const rowY2 = y + 0.95;
    slide.addText("% to Hours Goal", {
      x: 0.3, y: rowY1, w: 1.3, h: 0.3,
      fontSize: 8, color: virgilTheme.subtle, align: "right",
    });
    slide.addText("Hours Actual", {
      x: 0.3, y: rowY2, w: 1.3, h: 0.3,
      fontSize: 8, color: virgilTheme.subtle, align: "right",
    });
    const totalPlan = data.totalPlan || 1;
    const totalActual = data.totalActual || 1;
    const barW = 10.8;
    let xStart = 1.7;
    fundingOrder.forEach(f => {
      const seg = data.byFunding[f];
      const pctW = seg.plan > 0 ? (seg.plan / totalPlan) * barW : 0;
      const actW = totalActual > 0 ? (seg.actual / totalActual) * barW : 0;
      const segW = Math.max(pctW, actW);
      if (pctW > 0) {
        slide.addShape("rect", {
          x: xStart, y: rowY1, w: pctW, h: 0.4,
          fill: { color: fundingColors[f] }, line: { type: "none" },
        });
        const pctVal = seg.plan > 0 ? (seg.actual / seg.plan) * 100 : 0;
        slide.addText(`${pctVal.toFixed(0)}%`, {
          x: xStart, y: rowY1 + 0.05, w: pctW, h: 0.3,
          fontSize: 9, color: "FFFFFF", bold: true, align: "center",
        });
      }
      if (actW > 0) {
        slide.addShape("rect", {
          x: xStart, y: rowY2, w: actW, h: 0.4,
          fill: { color: fundingColors[f] }, line: { type: "none" },
        });
        slide.addText(Math.round(seg.actual).toLocaleString(), {
          x: xStart, y: rowY2 + 0.05, w: actW, h: 0.3,
          fontSize: 9, color: "FFFFFF", bold: true, align: "center",
        });
      }
      xStart += segW;
    });
  };

  drawBarGroup(1.25, previousMonthLabel, prior);
  drawBarGroup(2.65, reportingPeriodLabel, reporting);
  drawBarGroup(4.05, `${mtdLabel} MTD`, mtd);

  // Bottom half: Campaign Outlook (Growth) | Base Management (HQ, Marketing, National)
  const breakoutY = 5.5;
  slide.addText("Campaign Outlook", {
    x: 0.5, y: breakoutY, w: 3.0, h: 0.25,
    fontSize: 11, color: virgilTheme.eyebrow, bold: true,
  });
  slide.addText("Base Management", {
    x: 4.0, y: breakoutY, w: 9.0, h: 0.25,
    fontSize: 11, color: virgilTheme.eyebrow, bold: true,
  });

  const drawFundingCol = (x, w, funding, allCampaigns) => {
    const rows = allCampaigns
      .filter(c => c.funding === funding)
      .sort((a, b) => b.hoursActual - a.hoursActual);
    slide.addShape("rect", {
      x, y: breakoutY + 0.3, w, h: 0.35,
      fill: { color: fundingColors[funding] }, line: { type: "none" },
    });
    slide.addText(`${funding} Funded`, {
      x, y: breakoutY + 0.3, w, h: 0.35,
      fontSize: 11, color: "FFFFFF", bold: true, align: "center",
    });
    const items = rows.slice(0, 5).map(r => `${r.name} — ${Math.round(r.hoursActual).toLocaleString()} hours`);
    slide.addText(items.length ? items.join("\n") : "(none)", {
      x, y: breakoutY + 0.7, w, h: 1.2,
      fontSize: 9, color: virgilTheme.bodyText, valign: "top",
    });
  };
  drawFundingCol(0.5, 3.0, "Growth", reporting.campaigns);
  drawFundingCol(4.0, 2.9, "HQ", reporting.campaigns);
  drawFundingCol(7.0, 2.9, "Marketing", reporting.campaigns);
  drawFundingCol(10.0, 2.8, "National", reporting.campaigns);
}

// ═══════════════════════════════════════════════════════════════════
// CORP MBR — Orchestrator
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
  const priorMonthKey = getPriorMonthLabel(options.reportingMonthLabel);
  const priorPriorMonthKey = getPriorMonthLabel(priorMonthKey);

  buildVirgilTitleSlide(pres, options.reportingMonthLabel, perf && perf.fiscalInfo, options.virgilLastName);
  buildVirgilMyPerformanceSlide(
    pres,
    stats,
    options.loginBuckets || {},
    priorPriorMonthKey,
    priorMonthKey,
    options.reportingMonthLabel,
    (options.insights && options.insights.slide2) || ""
  );

  // Slide 3 — All-in Attainment + Scorecard
  buildCorpOpPerformanceSlide(pres,
    options.agentRaw || "", options.goalsRaw || "",
    options.priorAgentRaw || "", options.priorGoalsRaw || "",
    options.priorQuarterAgentRaw || "", options.priorQuarterGoalsRaw || "",
    options.reportingMonthLabel, options.scorecardDataUrl || "",
    options.vendorScores || {},
    options.corpPriorMonthAgentRaw || "", options.corpPriorMonthGoalsRaw || "");

  // Slide 4 — Quartile Reporting
  buildCorpQuartileSlide(pres,
    options.agentRaw || "", options.goalsRaw || "",
    options.newHiresRaw || "", options.reportingMonthLabel);

  // Slide 5 — Campaign Hours Info
  buildCorpCampaignHoursSlide(pres,
    options.agentRaw || "", options.goalsRaw || "",
    options.priorAgentRaw || "", options.priorGoalsRaw || "",
    options.reportingMonthLabel,
    options.corpPriorMonthAgentRaw || "", options.corpPriorMonthGoalsRaw || "");

  return pres;
}

// ═══════════════════════════════════════════════════════════════════
// CORP MBR — Export Modal
// ═══════════════════════════════════════════════════════════════════

// CORP MBR — Data Sources Modal
function CorpMbrDataSourcesModal({
  coachingDetailsSheetUrl, setCoachingDetailsSheetUrl,
  coachingWeeklySheetUrl, setCoachingWeeklySheetUrl,
  loginBucketsSheetUrl, setLoginBucketsSheetUrl,
  corpPriorMonthAgentUrl, setCorpPriorMonthAgentUrl,
  corpPriorMonthGoalsUrl, setCorpPriorMonthGoalsUrl,
  priorQuarterAgentUrl, setPriorQuarterAgentUrl,
  priorQuarterGoalsUrl, setPriorQuarterGoalsUrl,
  onClose
}) {
  const UrlRow = ({ label, value, setValue, hint }) => (
    <label style={{ display: "block", marginTop: 14, fontSize: 13, fontWeight: 600 }}>
      {label}
      <input type="text" value={value || ""} onChange={e => setValue(e.target.value)}
        placeholder="https://docs.google.com/spreadsheets/d/e/.../pub?gid=...&output=csv"
        style={{ display: "block", marginTop: 4, width: "100%", padding: 8, border: "1px solid #d1d5db", borderRadius: 6, fontFamily: "monospace", fontSize: 12 }} />
      {hint && <small style={{ color: "#6b7280" }}>{hint}</small>}
    </label>
  );
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 400, display: "flex", alignItems: "center", justifyContent: "center" }}
         onClick={onClose}>
      <div style={{ width: 640, maxHeight: "85vh", overflow: "auto", background: "#fff", borderRadius: 10, padding: 24 }}
           onClick={e => e.stopPropagation()}>
        <h2 style={{ margin: 0, fontSize: 20 }}>Corp MBR Data Sources</h2>
        <p style={{ color: "#6b7280", fontSize: 13, marginTop: 4 }}>
          Google Sheet URLs auto-fetched into localStorage and consumed by the Corp MBR export. Leave blank to fall back to the bundled defaults.
        </p>
        <UrlRow label="Coaching Details (org totals)" value={coachingDetailsSheetUrl} setValue={setCoachingDetailsSheetUrl}
          hint="Monthly Acknowledged %, % Coached, Total Sessions, etc." />
        <UrlRow label="Weekly Breakdown (per-agent coaching)" value={coachingWeeklySheetUrl} setValue={setCoachingWeeklySheetUrl}
          hint="Enables DR/BZ split via NTID → bpLookup." />
        <UrlRow label="Login Buckets (myPerformance login frequency)" value={loginBucketsSheetUrl} setValue={setLoginBucketsSheetUrl}
          hint="Monthly distribution across 0-3 / 4-7 / 8-15 / 16-20+ login buckets." />
        <UrlRow label="Prior Month — Agent Stats" value={corpPriorMonthAgentUrl} setValue={setCorpPriorMonthAgentUrl}
          hint="Current fiscal month − 2 agent stats. For Slide 3 col 2 + Slide 5 first bar group." />
        <UrlRow label="Prior Month — Goals" value={corpPriorMonthGoalsUrl} setValue={setCorpPriorMonthGoalsUrl}
          hint="Current fiscal month − 2 goals. Paired with Prior Month agent stats." />
        <UrlRow label="Prior Quarter — Agent Data" value={priorQuarterAgentUrl} setValue={setPriorQuarterAgentUrl}
          hint="Q4 2025 agent-level stats. Used by Slide 3 comparison table." />
        <UrlRow label="Prior Quarter — Goals" value={priorQuarterGoalsUrl} setValue={setPriorQuarterGoalsUrl}
          hint="Q4 2025 goals CSV. Needed to compute Q4 attainment." />
        <div style={{ display: "flex", gap: 8, marginTop: 20, justifyContent: "flex-end" }}>
          <button onClick={onClose} style={{ padding: "8px 14px", border: "none", background: "#7C3AED", color: "#fff", borderRadius: 6, cursor: "pointer", fontWeight: 600 }}>Close</button>
        </div>
      </div>
    </div>
  );
}

function VirgilMbrExportModal({
  perf,
  coachingDetailsRaw, coachingWeeklyRaw, loginBucketsRaw,
  rawAgentCsv, goalsRaw, priorMonthRaw, priorMonthGoalsRaw, newHiresRaw,
  priorQuarterAgentRaw, priorQuarterGoalsRaw,
  corpPriorMonthAgentRaw, corpPriorMonthGoalsRaw,
  insights, setInsights, ollamaAvailable, onClose
}) {
  const [reportingMonth, setReportingMonth] = useState(() => {
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

  const [useAiInsights, setUseAiInsights] = useState(() => {
    try { return localStorage.getItem("perf_intel_corp_ai_insights_v1") === "true"; } catch(e) { return false; }
  });
  useEffect(() => {
    try { localStorage.setItem("perf_intel_corp_ai_insights_v1", useAiInsights ? "true" : "false"); } catch(e) {}
  }, [useAiInsights]);

  const [scorecardDataUrl, setScorecardDataUrl] = useState("");
  const [vendorScores, setVendorScores] = useState({ Results: "", GTCX: "", GCS: "", Avantive: "" });
  const scorecardInputRef = useRef(null);
  const handleScorecardUpload = useCallback((file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => setScorecardDataUrl(String(e.target?.result || ""));
    reader.readAsDataURL(file);
  }, []);

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
    let slide2Insights = "";
    if (useAiInsights && ollamaAvailable) {
      try {
        const stats = buildCoachingStats(coachingDetails, coachingWeekly, perf && perf.bpLookup, reportingMonth);
        const priorKey = getPriorMonthLabel(reportingMonth);
        const priorPriorKey = getPriorMonthLabel(priorKey);
        const loginPrior = buildLoginActivitySingle(loginBuckets, priorKey);
        const loginCurr = buildLoginActivitySingle(loginBuckets, reportingMonth);
        const prompt = `Write 2–3 short bullet points for a monthly performance slide.

Reporting Month: ${reportingMonth}   (Prior Month: ${priorKey || "unknown"})

Coaching Standard Attainment: ${priorPriorKey} ${(stats.orgPriorPrior.coachingPct * 100).toFixed(1)}% → ${priorKey} ${(stats.orgPrior.coachingPct * 100).toFixed(1)}% → ${reportingMonth} ${(stats.org.coachingPct * 100).toFixed(1)}%
Acknowledgement %: ${priorPriorKey} ${(stats.orgPriorPrior.acknowledgePct * 100).toFixed(1)}% → ${priorKey} ${(stats.orgPrior.acknowledgePct * 100).toFixed(1)}% → ${reportingMonth} ${(stats.org.acknowledgePct * 100).toFixed(1)}%
myPerformance Login Activity (% of users w/ 1+ login): Prior ${(loginPrior * 100).toFixed(1)}% → Reporting ${(loginCurr * 100).toFixed(1)}%
Total Coaching Sessions (reporting month): ${stats.org.totalSessions}
Goal line across all three metrics: 75%

Write bullet-point style insights focused on movement vs prior, gaps vs 75% goal, and whether momentum is positive or concerning. One sentence per bullet. No intro, just bullets separated by newlines.`;
        slide2Insights = await ollamaGenerate(prompt) || "";
      } catch(e) {
        console.error("AI insights generation failed:", e);
      }
    }
    const pres = buildVirgilMbrPresentation(perf, {
      reportingMonthLabel: reportingMonth,
      coachingDetails,
      coachingWeekly,
      loginBuckets,
      agentRaw: rawAgentCsv || "",
      goalsRaw: goalsRaw || "",
      priorAgentRaw: priorMonthRaw || "",
      priorGoalsRaw: priorMonthGoalsRaw || "",
      newHiresRaw: newHiresRaw || "",
      priorQuarterAgentRaw: priorQuarterAgentRaw || "",
      priorQuarterGoalsRaw: priorQuarterGoalsRaw || "",
      corpPriorMonthAgentRaw: corpPriorMonthAgentRaw || "",
      corpPriorMonthGoalsRaw: corpPriorMonthGoalsRaw || "",
      scorecardDataUrl,
      vendorScores,
      insights: { ...(insights || {}), slide2: slide2Insights },
    });
    const safeMonth = (reportingMonth || "Virgil").replace(/[^A-Za-z0-9 _-]+/g, "");
    await pres.writeFile({ fileName: `Corp MBR - ${safeMonth}.pptx` });
  }, [perf, reportingMonth, coachingDetails, coachingWeekly, loginBuckets, rawAgentCsv, goalsRaw, priorMonthRaw, priorMonthGoalsRaw, newHiresRaw, priorQuarterAgentRaw, priorQuarterGoalsRaw, corpPriorMonthAgentRaw, corpPriorMonthGoalsRaw, scorecardDataUrl, vendorScores, insights, useAiInsights, ollamaAvailable]);

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
        <h2 style={{ margin: 0, fontSize: 20 }}>Export Corp MBR</h2>
        <p style={{ color: "#6b7280", fontSize: 13, marginTop: 4 }}>
          Comcast-facing monthly deck. Phase 1: Title + My Performance / Quality.
        </p>

        <label style={{ display: "block", marginTop: 16, fontSize: 13, fontWeight: 600 }}>
          Current Fiscal Month Label
          <input type="text" value={reportingMonth} onChange={e => setReportingMonth(e.target.value)}
            placeholder="Mar '26"
            style={{ display: "block", marginTop: 4, width: "100%", padding: 8, border: "1px solid #d1d5db", borderRadius: 6 }} />
          <small style={{ color: "#6b7280" }}>The current in-progress fiscal month (MTD). Must match format like "Apr '26". Reporting month auto-derives as (this − 1).</small>
        </label>

        <div style={{ marginTop: 16, padding: 12, background: "#f9fafb", borderRadius: 6 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#374151", marginBottom: 6 }}>Data Readiness</div>
          <StatusRow label="Coaching Details CSV" ok={hasCoachingDetails} />
          <StatusRow label="Weekly Breakdown CSV" ok={hasCoachingWeekly} />
          <StatusRow label="Login Buckets CSV" ok={hasLoginBuckets} />
          <StatusRow label="Prior Month Agent (Current − 2)" ok={!!(corpPriorMonthAgentRaw && corpPriorMonthAgentRaw.trim())} />
          <StatusRow label="Prior Month Goals (Current − 2)" ok={!!(corpPriorMonthGoalsRaw && corpPriorMonthGoalsRaw.trim())} />
          <StatusRow label="Prior Quarter Agent (Q4 2025)" ok={!!(priorQuarterAgentRaw && priorQuarterAgentRaw.trim())} />
          <StatusRow label="Prior Quarter Goals (Q4 2025)" ok={!!(priorQuarterGoalsRaw && priorQuarterGoalsRaw.trim())} />
          <StatusRow label="Scorecard PNG (Slide 3)" ok={!!scorecardDataUrl} />
        </div>

        <div style={{ marginTop: 16, padding: 12, background: "#fafafa", borderRadius: 6, border: "1px solid #d1d5db" }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>Scorecard PNG (Slide 3)</div>
          <div style={{ fontSize: 12, color: "#6b7280", marginTop: 2 }}>
            {scorecardDataUrl ? "Loaded — will embed into Slide 3." : "Optional. Upload the Comcast scorecard screenshot for the reporting month."}
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <button onClick={() => scorecardInputRef.current?.click()}
              style={{ padding: "6px 12px", border: "1px solid #d1d5db", background: "#fff", borderRadius: 6, cursor: "pointer", fontSize: 12 }}>
              {scorecardDataUrl ? "Replace" : "Upload PNG"}
            </button>
            {scorecardDataUrl && (
              <button onClick={() => setScorecardDataUrl("")}
                style={{ padding: "6px 12px", border: "1px solid #d1d5db", background: "#fff", borderRadius: 6, cursor: "pointer", fontSize: 12 }}>
                Remove
              </button>
            )}
          </div>
          <input ref={scorecardInputRef} type="file" accept=".png,.jpg,.jpeg" style={{ display: "none" }}
            onChange={e => { if (e.target.files[0]) handleScorecardUpload(e.target.files[0]); e.target.value = ""; }} />
        </div>

        <div style={{ marginTop: 12, padding: 12, background: "#fafafa", borderRadius: 6, border: "1px solid #d1d5db" }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>BP Scorecard Totals (Slide 3 chart)</div>
          <div style={{ fontSize: 12, color: "#6b7280", marginTop: 2 }}>
            Type each vendor's TTL SCR from the Comcast scorecard. Empty = no bar rendered.
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 8, marginTop: 8 }}>
            {["Results", "GTCX", "GCS", "Avantive"].map(v => (
              <label key={v} style={{ fontSize: 11, color: "#374151" }}>
                {v}
                <input type="number" step="0.001"
                  value={vendorScores[v]}
                  onChange={e => setVendorScores({ ...vendorScores, [v]: e.target.value })}
                  style={{ display: "block", width: "100%", padding: 6, border: "1px solid #d1d5db", borderRadius: 4, marginTop: 2, fontSize: 12 }} />
              </label>
            ))}
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 16, padding: "10px 12px", border: "1px solid #d1d5db", borderRadius: 6, background: "#fafafa" }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600 }}>AI Insights (Slide 2)</div>
            <div style={{ fontSize: 12, color: "#6b7280" }}>
              {ollamaAvailable
                ? "On — AI will generate a 2–3 sentence summary at download time."
                : "AI is unavailable (Ollama not detected). Slide will render with an empty insights section."}
            </div>
          </div>
          <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: ollamaAvailable ? "pointer" : "not-allowed", opacity: ollamaAvailable ? 1 : 0.5 }}>
            <input type="checkbox"
              checked={useAiInsights}
              disabled={!ollamaAvailable}
              onChange={e => setUseAiInsights(e.target.checked)} />
            <span style={{ fontSize: 13 }}>{useAiInsights ? "On" : "Off"}</span>
          </label>
        </div>

        <div style={{ display: "flex", gap: 8, marginTop: 20, justifyContent: "flex-end" }}>
          <button onClick={onClose} style={{ padding: "8px 14px", border: "1px solid #d1d5db", background: "#fff", borderRadius: 6, cursor: "pointer" }}>Cancel</button>
          <button onClick={handleDownload} style={{ padding: "8px 14px", border: "none", background: "#7C3AED", color: "#fff", borderRadius: 6, cursor: "pointer", fontWeight: 600 }}>Download .pptx</button>
        </div>
      </div>
    </div>
  );
}

function MbrExportModal({ perf, onClose }) {
  const [state, setState] = useState("confirm");
  const [progress, setProgress] = useState("");
  const [error, setError] = useState(null);
  const [includeAI, setIncludeAI] = useState(true);
  const { programs, fiscalInfo } = perf;

  const handleGenerate = useCallback(async () => {
    setState("generating");
    try {
      await generateMBR(perf, (msg) => setProgress(msg), { includeAI });
      onClose();
    } catch (e) {
      console.error("MBR generation failed:", e);
      setState("error");
      setError(String(e.message || e));
    }
  }, [perf, onClose, includeAI]);

  const fiscalStart = fiscalInfo?.fiscalStart || "unknown";
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
            {programs.length} program{programs.length !== 1 ? "s" : ""} &middot; Fiscal period {fiscalStart} &ndash; {fiscalEnd} &middot; Data through {lastData}
          </div>
          <div style={{ fontSize: "0.78rem", color: `var(--text-dim)`, marginBottom: "1rem", maxHeight: "8rem", overflowY: "auto" }}>
            {programs.map(p => (
              <div key={p.jobType} style={{ padding: "0.2rem 0", borderBottom: "1px solid var(--border-muted)" }}>
                {p.jobType}
              </div>
            ))}
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.75rem" }}>
            <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer", fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.82rem", color: "var(--text-secondary)" }}
              onClick={() => setIncludeAI(v => !v)}>
              <div style={{ width: 36, height: 20, borderRadius: 10, background: includeAI ? "#6137F4" : "var(--border)", position: "relative", transition: "background 200ms" }}>
                <div style={{ width: 16, height: 16, borderRadius: 8, background: "#fff", position: "absolute", top: 2, left: includeAI ? 18 : 2, transition: "left 200ms", boxShadow: "0 1px 3px rgba(0,0,0,0.2)" }} />
              </div>
              AI-generated feedback
            </label>
            <span style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.7rem", color: "var(--text-dim)" }}>
              {includeAI ? "Narratives & opportunities included" : "Data only — no AI text"}
            </span>
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

// ══════════════════════════════════════════════════════════════════════════════
// SECTION 11b — tNPS DEEP-DIVE SLIDE  (pages/TNPSSlide.jsx)
// Full tNPS analysis with 4 sub-tabs: Summary, By Campaign, By Supervisor, Customer Voices
// ══════════════════════════════════════════════════════════════════════════════

function TNPSSlide({ perf, onNav, lightMode }) {
  const [tab, setTab] = useState("summary");
  const [expandedSup, setExpandedSup] = useState(null);
  const [voiceFilter, setVoiceFilter] = useState({ type: "all", site: "all", campaign: "all", month: "all" });
  const [timeMode, setTimeMode] = useState("fiscal"); // "fiscal" | "select" | "all"
  const [selectedMonths, setSelectedMonths] = useState(new Set());
  const { tnpsData, tnpsGCS, tnpsOverall: tnpsOverallAll, tnpsBySite: tnpsBySiteAll, tnpsByMonth, bpLookup, fiscalInfo } = perf;

  // Available months for the selector
  const availableMonths = useMemo(() => {
    const months = [...new Set(tnpsGCS.filter(s => s.month).map(s => s.month))].sort();
    return months.map(m => {
      const [y, mo] = m.split("-").map(Number);
      return { key: m, label: new Date(y, mo - 1, 1).toLocaleString("en-US", { month: "short", year: "numeric" }) };
    });
  }, [tnpsGCS]);

  const toggleMonth = (m) => setSelectedMonths(prev => {
    const next = new Set(prev);
    if (next.has(m)) next.delete(m); else next.add(m);
    return next;
  });

  // Filter GCS surveys based on time mode
  const activeGCS = useMemo(() => {
    if (timeMode === "all") return tnpsGCS;
    if (timeMode === "select" && selectedMonths.size > 0) return tnpsGCS.filter(s => selectedMonths.has(s.month));
    if (timeMode === "select") return tnpsGCS; // none selected = show all
    return tnpsFiscalFilter(tnpsGCS, fiscalInfo); // fiscal
  }, [timeMode, selectedMonths, tnpsGCS, fiscalInfo]);

  const tnpsOverall = useMemo(() => (timeMode === "all" && selectedMonths.size === 0) ? tnpsOverallAll : calcTnpsScore(activeGCS), [timeMode, selectedMonths, tnpsOverallAll, activeGCS]);
  const tnpsBySite = useMemo(() => {
    if (timeMode === "all") return tnpsBySiteAll;
    // Filter all data (incl partners) by same time window
    let filtered;
    if (timeMode === "select" && selectedMonths.size > 0) filtered = tnpsData.filter(s => selectedMonths.has(s.month));
    else if (timeMode === "select") filtered = tnpsData;
    else filtered = tnpsFiscalFilter(tnpsData, fiscalInfo);
    if (!filtered || filtered.length === 0) return tnpsBySiteAll;
    const groups = {};
    filtered.forEach(s => {
      if (!groups[s.siteLabel]) groups[s.siteLabel] = [];
      groups[s.siteLabel].push(s);
    });
    return Object.entries(groups).map(([label, surveys]) => ({
      label, isGCS: surveys[0].isGCS, ...calcTnpsScore(surveys),
    })).sort((a, b) => (b.score ?? -999) - (a.score ?? -999));
  }, [timeMode, selectedMonths, tnpsBySiteAll, tnpsData, fiscalInfo]);

  // Fiscal month label for display
  const fiscalLabel = useMemo(() => {
    if (!fiscalInfo) return "Current Month";
    const [sy, sm, sd] = fiscalInfo.fiscalStart.split("-").map(Number);
    const [ey, em, ed] = fiscalInfo.fiscalEnd.split("-").map(Number);
    const s = new Date(sy, sm - 1, sd);
    const e = new Date(ey, em - 1, ed);
    const fmt = d => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    return `${fmt(s)} – ${fmt(e)}`;
  }, [fiscalInfo]);

  // Campaign breakdown (GCS only)
  const tnpsByCampaign = useMemo(() => {
    const groups = {};
    activeGCS.forEach(s => {
      const key = s.campaign;
      if (!groups[key]) groups[key] = { campaign: key, program: s.program, surveys: [] };
      groups[key].surveys.push(s);
    });
    return Object.values(groups)
      .map(g => ({ ...g, ...calcTnpsScore(g.surveys) }))
      .sort((a, b) => (b.score ?? -999) - (a.score ?? -999));
  }, [activeGCS]);

  // Supervisor breakdown (GCS only, from roster join)
  const tnpsBySupervisor = useMemo(() => {
    const groups = {};
    activeGCS.forEach(s => {
      const sup = s.supervisor || "Unknown";
      if (!groups[sup]) groups[sup] = { supervisor: sup, site: s.siteLabel, surveys: [] };
      groups[sup].surveys.push(s);
    });

    // Calculate site averages for delta
    const siteAvgs = {};
    tnpsBySite.filter(s => s.isGCS).forEach(s => { siteAvgs[s.label] = s.score; });

    return Object.values(groups)
      .map(g => {
        const stats = calcTnpsScore(g.surveys);
        const siteAvg = siteAvgs[g.site] ?? null;
        return {
          ...g,
          ...stats,
          siteAvg,
          delta: siteAvg !== null && stats.score !== null ? stats.score - siteAvg : null,
          agents: (() => {
            const agentGroups = {};
            g.surveys.forEach(s => {
              if (!agentGroups[s.ntid]) agentGroups[s.ntid] = { ntid: s.ntid, name: s.agentName, surveys: [] };
              agentGroups[s.ntid].surveys.push(s);
            });
            return Object.values(agentGroups)
              .map(a => ({ ...a, ...calcTnpsScore(a.surveys) }))
              .sort((a, b) => (a.score ?? 999) - (b.score ?? 999));
          })(),
        };
      })
      .sort((a, b) => (a.score ?? 999) - (b.score ?? 999)); // worst first
  }, [activeGCS, tnpsBySite]);

  // Customer Voices — filtered GCS surveys with reason text
  const voicesSorted = useMemo(() => {
    let filtered = activeGCS.filter(s => s.reason);
    if (voiceFilter.type !== "all") filtered = filtered.filter(s => s.category === voiceFilter.type);
    if (voiceFilter.site !== "all") filtered = filtered.filter(s => s.siteLabel === voiceFilter.site);
    if (voiceFilter.campaign !== "all") filtered = filtered.filter(s => s.campaign === voiceFilter.campaign);
    if (voiceFilter.month !== "all") filtered = filtered.filter(s => s.month === voiceFilter.month);
    return filtered.sort((a, b) => (b.date || 0) - (a.date || 0));
  }, [activeGCS, voiceFilter]);

  const voiceCampaigns = useMemo(() => [...new Set(activeGCS.map(s => s.campaign))].sort(), [activeGCS]);
  const voiceMonths = useMemo(() => [...new Set(activeGCS.filter(s => s.month).map(s => s.month))].sort(), [activeGCS]);

  if (!tnpsData || tnpsData.length === 0) {
    return (
      <div style={{ minHeight: "90vh", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-faint)", fontFamily: "var(--font-ui, Inter, sans-serif)" }}>
        No tNPS data loaded.
      </div>
    );
  }

  const tabs = [
    { key: "summary", label: "Summary" },
    { key: "campaign", label: "By Campaign" },
    { key: "supervisor", label: "By Supervisor" },
    { key: "voices", label: "Customer Voices" },
  ];

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: "0 2.5rem 2rem" }}>
      {/* Header */}
      <div style={{ marginBottom: "0.75rem" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div style={{ fontFamily: "var(--font-display, Inter, sans-serif)", fontSize: "1.5rem", fontWeight: 700, color: "var(--text-warm)" }}>Customer Experience — tNPS</div>
            <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.78rem", color: "var(--text-dim)" }}>
              {timeMode === "all" ? `${tnpsGCS.length} GCS surveys (all time)` : timeMode === "select" ? `${activeGCS.length} GCS surveys (${selectedMonths.size === 0 ? "all months" : `${selectedMonths.size} month${selectedMonths.size > 1 ? "s" : ""} selected`})` : `${activeGCS.length} GCS surveys · ${fiscalLabel}`}
            </div>
          </div>
          <div style={{ display: "flex", gap: "0.25rem" }}>
            {[{ key: "fiscal", label: "Current Month" }, { key: "select", label: "Select Months" }, { key: "all", label: "All Time" }].map(opt => (
              <button key={opt.key} onClick={() => setTimeMode(opt.key)}
                style={{ padding: "0.35rem 0.75rem", borderRadius: "var(--radius-sm, 6px)", border: `1px solid ${timeMode === opt.key ? "#d9770650" : "var(--border-muted)"}`, background: timeMode === opt.key ? "#d9770612" : "transparent", color: timeMode === opt.key ? "#d97706" : "var(--text-dim)", fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.78rem", cursor: "pointer", fontWeight: timeMode === opt.key ? 600 : 400 }}>
                {opt.label}
              </button>
            ))}
          </div>
        </div>
        {timeMode === "select" && (
          <div style={{ display: "flex", gap: "0.3rem", marginTop: "0.5rem", flexWrap: "wrap" }}>
            {availableMonths.map(m => {
              const isSelected = selectedMonths.has(m.key);
              return (
                <button key={m.key} onClick={() => toggleMonth(m.key)}
                  style={{ padding: "0.3rem 0.65rem", borderRadius: "var(--radius-sm, 6px)", border: `1px solid ${isSelected ? "#6366f150" : "var(--border-muted)"}`, background: isSelected ? "#6366f118" : "transparent", color: isSelected ? "#6366f1" : "var(--text-dim)", fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.75rem", cursor: "pointer", fontWeight: isSelected ? 600 : 400, transition: "all 150ms" }}>
                  {m.label}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Sub-tab navigation */}
      <div style={{ display: "flex", gap: "0.35rem", marginBottom: "1.25rem", borderBottom: "1px solid var(--border)" }}>
        {tabs.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            style={{ padding: "0.55rem 1rem", border: "none", borderBottom: tab === t.key ? "2px solid #d97706" : "2px solid transparent", background: "transparent", color: tab === t.key ? "var(--text-warm)" : "var(--text-dim)", fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.82rem", fontWeight: tab === t.key ? 600 : 400, cursor: "pointer", transition: "all 150ms" }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* SUMMARY TAB */}
      {tab === "summary" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>

          {/* KPI Cards */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "0.75rem" }}>
            {[
              { label: "GCS tNPS Score", value: `${tnpsOverall.score > 0 ? "+" : ""}${tnpsOverall.score}`, accent: tnpsColor(tnpsOverall.score), sub: `${tnpsOverall.total} surveys` },
              { label: "Promoters", value: `${Math.round(tnpsOverall.promoterPct)}%`, accent: "#16a34a", sub: `${tnpsOverall.promoters} surveys` },
              { label: "Passives", value: `${Math.round(tnpsOverall.passivePct)}%`, accent: "#d97706", sub: `${tnpsOverall.passives} surveys` },
              { label: "Detractors", value: `${Math.round(tnpsOverall.detractorPct)}%`, accent: "#dc2626", sub: `${tnpsOverall.detractors} surveys` },
            ].map((c, i) => (
              <div key={i} style={{ background: "var(--glass-bg)", border: `1px solid ${c.accent}18`, borderTop: `3px solid ${c.accent}`, borderRadius: "var(--radius-md, 10px)", padding: "1rem" }}>
                <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.7rem", color: "var(--text-muted)", letterSpacing: "0.06em", textTransform: "uppercase" }}>{c.label}</div>
                <div style={{ fontFamily: "var(--font-display, Inter, sans-serif)", fontSize: "2.25rem", color: c.accent, fontWeight: 800 }}>{c.value}</div>
                <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.72rem", color: "var(--text-dim)" }}>{c.sub}</div>
              </div>
            ))}
          </div>

          {/* GCS Site Comparison — bar chart */}
          <div style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg, 16px)", padding: "1.25rem 1.5rem" }}>
            <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.8rem", letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: "1rem" }}>GCS Site Comparison</div>
            <div style={{ display: "flex", gap: "1rem", alignItems: "flex-end", height: 220, paddingTop: 24 }}>
              {tnpsBySite.filter(s => s.isGCS).map((site, i) => {
                const maxScore = Math.max(...tnpsBySite.filter(s => s.isGCS).map(s => Math.abs(s.score || 0)), 1);
                const barH = Math.max(20, (Math.abs(site.score || 0) / maxScore) * 160);
                return (
                  <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center" }}>
                    <div style={{ fontFamily: "var(--font-data, monospace)", fontSize: "1.1rem", fontWeight: 700, color: tnpsColor(site.score), marginBottom: 4 }}>
                      {site.score > 0 ? "+" : ""}{site.score}
                    </div>
                    <div style={{ width: "60%", height: barH, borderRadius: "6px 6px 0 0", background: tnpsColor(site.score) + "cc" }} />
                    <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.78rem", color: "var(--text-warm)", marginTop: 6, fontWeight: 600 }}>{site.label}</div>
                    <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.68rem", color: "var(--text-dim)" }}>{site.total} surveys</div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Partner Ranking Leaderboard */}
          <div style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg, 16px)", padding: "1.25rem 1.5rem" }}>
            <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.8rem", letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: "0.75rem" }}>Partner Ranking</div>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  {["#", "Site / Partner", "tNPS", "Surveys", "Promoter %", "Detractor %"].map((h, i) => (
                    <th key={i} style={{ padding: "0.5rem", textAlign: i > 1 ? "right" : "left", fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.7rem", color: "var(--text-muted)", borderBottom: "1px solid var(--border)", fontWeight: 500, letterSpacing: "0.05em", textTransform: "uppercase" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(() => {
                  // Build ranking: GCS aggregate + individual GCS sites + partner companies
                  const gcsAggregate = { label: "GCS (All Sites)", isGCS: true, isAggregate: true, ...tnpsOverall };
                  const withAggregate = [gcsAggregate, ...tnpsBySite.filter(s => !s.isGCS)].sort((a, b) => (b.score ?? -999) - (a.score ?? -999));
                  // Insert individual GCS sites right after the aggregate (not ranked)
                  const gcsSites = tnpsBySite.filter(s => s.isGCS);
                  const aggIdx = withAggregate.findIndex(s => s.isAggregate);
                  const ranked = [...withAggregate.slice(0, aggIdx + 1), ...gcsSites, ...withAggregate.slice(aggIdx + 1)];
                  let rank = 0;
                  return ranked.map((site, i) => {
                    const isSub = site.isGCS && !site.isAggregate;
                    if (!isSub) rank++;
                    return (
                      <tr key={i} style={{ background: site.isGCS ? (lightMode ? "#fffbeb" : "#d9770608") : "transparent", borderBottom: site.isAggregate && gcsSites.length > 0 ? "none" : undefined }}>
                        <td style={{ padding: "0.6rem 0.5rem", fontFamily: "var(--font-data, monospace)", fontSize: isSub ? "0.75rem" : "0.82rem", color: "var(--text-dim)" }}>{isSub ? "" : rank}</td>
                        <td style={{ padding: isSub ? "0.35rem 0.5rem 0.35rem 1.5rem" : "0.6rem 0.5rem", fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: isSub ? "0.78rem" : "0.85rem", color: isSub ? "var(--text-secondary)" : "var(--text-warm)", fontWeight: site.isAggregate ? 700 : site.isGCS ? 500 : 400 }}>
                          {site.label}
                          {site.isAggregate && <span style={{ marginLeft: 6, fontSize: "0.65rem", padding: "1px 5px", borderRadius: 3, background: "#d9770618", color: "#d97706", fontWeight: 600 }}>GCS</span>}
                        </td>
                        <td style={{ padding: isSub ? "0.35rem 0.5rem" : "0.6rem 0.5rem", textAlign: "right", fontFamily: "var(--font-data, monospace)", fontSize: site.isAggregate ? "0.95rem" : isSub ? "0.82rem" : "0.95rem", fontWeight: 700, color: tnpsColor(site.score) }}>
                          {site.score > 0 ? "+" : ""}{site.score}
                        </td>
                        <td style={{ padding: isSub ? "0.35rem 0.5rem" : "0.6rem 0.5rem", textAlign: "right", fontFamily: "var(--font-data, monospace)", fontSize: isSub ? "0.75rem" : "0.82rem", color: "var(--text-secondary)" }}>{site.total}</td>
                        <td style={{ padding: isSub ? "0.35rem 0.5rem" : "0.6rem 0.5rem", textAlign: "right", fontFamily: "var(--font-data, monospace)", fontSize: isSub ? "0.75rem" : "0.82rem", color: "#16a34a" }}>{Math.round(site.promoterPct)}%</td>
                        <td style={{ padding: isSub ? "0.35rem 0.5rem" : "0.6rem 0.5rem", textAlign: "right", fontFamily: "var(--font-data, monospace)", fontSize: isSub ? "0.75rem" : "0.82rem", color: "#dc2626" }}>{Math.round(site.detractorPct)}%</td>
                      </tr>
                    );
                  });
                })()}
              </tbody>
            </table>
          </div>

          {/* Monthly Vendor Ranking */}
          {tnpsByMonth.length > 0 && (() => {
            const { tnpsData: allSurveys } = perf;
            const months = [...new Set((allSurveys || []).filter(s => s.month).map(s => s.month))].sort();
            const vendorMap = {};
            (allSurveys || []).forEach(s => {
              if (!s.month) return;
              const vendor = s.isGCS ? "GCS" : s.siteLabel;
              if (!vendorMap[s.month]) vendorMap[s.month] = {};
              if (!vendorMap[s.month][vendor]) vendorMap[s.month][vendor] = [];
              vendorMap[s.month][vendor].push(s);
            });
            const vendorColors = { "GCS": "#d97706", "Avantive": "#6366f1", "Global Telesourcing": "#0ea5e9", "Results": "#8b5cf6" };
            // Only show known vendors (filter out unmapped grey bars)
            const uniqueVendors = ["GCS", "Avantive", "Global Telesourcing", "Results"];

            return (
              <div style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg, 16px)", padding: "1.25rem 1.5rem" }}>
                <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.8rem", letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: "0.5rem" }}>Monthly Vendor Ranking</div>
                {/* Legend */}
                <div style={{ display: "flex", gap: "1rem", marginBottom: "1rem", flexWrap: "wrap" }}>
                  {uniqueVendors.map(v => (
                    <div key={v} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                      <div style={{ width: 10, height: 10, borderRadius: 2, background: vendorColors[v] || "#94a3b8" }} />
                      <span style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.72rem", color: "var(--text-secondary)" }}>{v}</span>
                    </div>
                  ))}
                </div>
                {/* Diverging grouped bars — 0 baseline centered */}
                <div style={{ display: "flex", alignItems: "stretch" }}>
                  {months.map((month, mi) => {
                    const [y, mo] = month.split("-").map(Number);
                    const mLabel = new Date(y, mo - 1, 1).toLocaleString("en-US", { month: "short", year: "numeric" });
                    const vendorScores = uniqueVendors.map(v => {
                      const surveys = (vendorMap[month] || {})[v] || [];
                      return { vendor: v, ...calcTnpsScore(surveys) };
                    }).filter(v => v.total > 0).sort((a, b) => (b.score ?? -999) - (a.score ?? -999));

                    return (
                      <React.Fragment key={mi}>
                        {mi > 0 && <div style={{ width: 1, background: "var(--border)", margin: "0 0.5rem", flexShrink: 0 }} />}
                        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center" }}>
                          {/* Positive zone (above baseline) */}
                          <div style={{ display: "flex", gap: 6, alignItems: "flex-end", height: 130, width: "100%", justifyContent: "center" }}>
                            {vendorScores.map((vs, vi) => {
                              const isGCS = vs.vendor === "GCS";
                              if ((vs.score || 0) < 0) return <div key={vi} style={{ width: 44 }} />;
                              const barH = Math.max(6, ((vs.score || 0) / 100) * 110);
                              return (
                                <div key={vi} style={{ display: "flex", flexDirection: "column", alignItems: "center", width: 44 }}>
                                  <div style={{ fontFamily: "var(--font-data, monospace)", fontSize: isGCS ? "0.78rem" : "0.65rem", fontWeight: isGCS ? 700 : 500, color: vendorColors[vs.vendor], marginBottom: 2, whiteSpace: "nowrap" }}>
                                    +{vs.score}
                                  </div>
                                  <div style={{ width: isGCS ? 40 : 32, height: barH, borderRadius: "4px 4px 0 0", background: vendorColors[vs.vendor] + (isGCS ? "dd" : "99"), border: isGCS ? `2px solid ${vendorColors[vs.vendor]}` : "none" }}
                                    title={`${vs.vendor}: +${vs.score} (${vs.total} surveys)`} />
                                  <div style={{ fontFamily: "var(--font-data, monospace)", fontSize: "0.58rem", color: vendorColors[vs.vendor], opacity: 0.7, marginTop: 1 }}>{vs.total}</div>
                                </div>
                              );
                            })}
                          </div>
                          {/* Baseline — 0 line */}
                          <div style={{ width: "100%", position: "relative", height: 0 }}>
                            <div style={{ width: "100%", height: 2, background: "var(--text-secondary)", opacity: 0.6 }} />
                            {mi === 0 && <span style={{ position: "absolute", left: -16, top: -7, fontFamily: "var(--font-data, monospace)", fontSize: "0.65rem", color: "var(--text-muted)", fontWeight: 600 }}>0</span>}
                          </div>
                          {/* Negative zone (below baseline) */}
                          <div style={{ display: "flex", gap: 6, alignItems: "flex-start", height: 70, width: "100%", justifyContent: "center" }}>
                            {vendorScores.map((vs, vi) => {
                              const isGCS = vs.vendor === "GCS";
                              if ((vs.score || 0) >= 0) return <div key={vi} style={{ width: 44 }} />;
                              const barH = Math.max(6, (Math.abs(vs.score || 0) / 100) * 55);
                              return (
                                <div key={vi} style={{ display: "flex", flexDirection: "column", alignItems: "center", width: 44 }}>
                                  <div style={{ fontFamily: "var(--font-data, monospace)", fontSize: "0.58rem", color: vendorColors[vs.vendor], opacity: 0.7, marginBottom: 1 }}>{vs.total}</div>
                                  <div style={{ width: isGCS ? 40 : 32, height: barH, borderRadius: "0 0 4px 4px", background: vendorColors[vs.vendor] + (isGCS ? "dd" : "99"), border: isGCS ? `2px solid ${vendorColors[vs.vendor]}` : "none" }}
                                    title={`${vs.vendor}: ${vs.score} (${vs.total} surveys)`} />
                                  <div style={{ fontFamily: "var(--font-data, monospace)", fontSize: isGCS ? "0.78rem" : "0.65rem", fontWeight: isGCS ? 700 : 500, color: vendorColors[vs.vendor], marginTop: 2, whiteSpace: "nowrap" }}>
                                    {vs.score}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                          {/* Month label */}
                          <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.78rem", color: "var(--text-warm)", fontWeight: 600, marginTop: 6 }}>{mLabel}</div>
                        </div>
                      </React.Fragment>
                    );
                  })}
                </div>
              </div>
            );
          })()}
        </div>
      )}

      {/* CAMPAIGN TAB */}
      {tab === "campaign" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
          {/* Campaign Table */}
          <div style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg, 16px)", padding: "1.25rem 1.5rem" }}>
            <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.8rem", letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: "0.75rem" }}>tNPS by Campaign — GCS</div>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  {["Campaign", "Program", "tNPS", "Surveys", "Promoter %", "Detractor %"].map((h, i) => (
                    <th key={i} style={{ padding: "0.5rem", textAlign: i > 1 ? "right" : "left", fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.7rem", color: "var(--text-muted)", borderBottom: "1px solid var(--border)", fontWeight: 500, letterSpacing: "0.05em", textTransform: "uppercase" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tnpsByCampaign.map((c, i) => (
                  <tr key={i} style={{ borderBottom: "1px solid var(--bg-tertiary)" }}>
                    <td style={{ padding: "0.6rem 0.5rem", fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.85rem", color: "var(--text-warm)" }}>{c.campaign}</td>
                    <td style={{ padding: "0.6rem 0.5rem" }}>
                      {c.program && <span style={{ fontSize: "0.68rem", padding: "2px 6px", borderRadius: 3, background: "#d9770618", color: "#d97706", fontWeight: 600, fontFamily: "var(--font-ui, Inter, sans-serif)" }}>{c.program}</span>}
                    </td>
                    <td style={{ padding: "0.6rem 0.5rem", textAlign: "right", fontFamily: "var(--font-data, monospace)", fontSize: "0.95rem", fontWeight: 700, color: tnpsColor(c.score) }}>
                      {c.score > 0 ? "+" : ""}{c.score}
                    </td>
                    <td style={{ padding: "0.6rem 0.5rem", textAlign: "right", fontFamily: "var(--font-data, monospace)", fontSize: "0.82rem", color: "var(--text-secondary)" }}>{c.total}</td>
                    <td style={{ padding: "0.6rem 0.5rem", textAlign: "right", fontFamily: "var(--font-data, monospace)", fontSize: "0.82rem", color: "#16a34a" }}>{Math.round(c.promoterPct)}%</td>
                    <td style={{ padding: "0.6rem 0.5rem", textAlign: "right", fontFamily: "var(--font-data, monospace)", fontSize: "0.82rem", color: "#dc2626" }}>{Math.round(c.detractorPct)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Campaign Bar Chart — diverging from center (0) */}
          <div style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg, 16px)", padding: "1.25rem 1.5rem" }}>
            <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.8rem", letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: "1rem" }}>tNPS Score by Campaign</div>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
              {tnpsByCampaign.map((c, i) => {
                const barPct = Math.max(2, (Math.abs(c.score || 0) / 100) * 50); // 50% = full scale (±100)
                const isPos = (c.score || 0) >= 0;
                return (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                    <div style={{ width: 110, fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.78rem", color: "var(--text-secondary)", textAlign: "right", flexShrink: 0 }}>{c.campaign}</div>
                    <div style={{ flex: 1, display: "flex", alignItems: "center", height: 20, position: "relative" }}>
                      {/* Center line at 50% */}
                      <div style={{ position: "absolute", left: "50%", top: 0, bottom: 0, width: 1, background: "var(--border)" }} />
                      {isPos ? (
                        /* Positive: bar grows right from center */
                        <div style={{ position: "absolute", left: "50%", height: 18, width: `${barPct}%`, borderRadius: "0 4px 4px 0", background: tnpsColor(c.score) + "cc" }} />
                      ) : (
                        /* Negative: bar grows left from center */
                        <div style={{ position: "absolute", right: "50%", height: 18, width: `${barPct}%`, borderRadius: "4px 0 0 4px", background: tnpsColor(c.score) + "cc" }} />
                      )}
                    </div>
                    <span style={{ width: 45, fontFamily: "var(--font-data, monospace)", fontSize: "0.78rem", fontWeight: 600, color: tnpsColor(c.score), textAlign: "right", flexShrink: 0 }}>
                      {c.score > 0 ? "+" : ""}{c.score}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
      {tab === "supervisor" && (
        <div style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg, 16px)", padding: "1.25rem 1.5rem" }}>
          <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.8rem", letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: "0.75rem" }}>tNPS by Supervisor — GCS (sorted by coaching opportunity)</div>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                {["Supervisor", "Site", "Team tNPS", "Surveys", "Promoter %", "Detractor %", "vs Site Avg"].map((h, i) => (
                  <th key={i} style={{ padding: "0.5rem", textAlign: i > 1 ? "right" : "left", fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.7rem", color: "var(--text-muted)", borderBottom: "1px solid var(--border)", fontWeight: 500, letterSpacing: "0.05em", textTransform: "uppercase" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tnpsBySupervisor.map((sup, i) => {
                const isExpanded = expandedSup === sup.supervisor;
                const belowAvg = sup.delta !== null && sup.delta < -10;
                return (
                  <React.Fragment key={i}>
                    <tr
                      onClick={() => setExpandedSup(isExpanded ? null : sup.supervisor)}
                      style={{ cursor: "pointer", borderBottom: "1px solid var(--bg-tertiary)", background: belowAvg ? (lightMode ? "#fef2f2" : "#dc262606") : "transparent" }}
                    >
                      <td style={{ padding: "0.6rem 0.5rem", fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.85rem", color: "var(--text-warm)" }}>
                        <span style={{ marginRight: 6, fontSize: "0.7rem", color: "var(--text-faint)" }}>{isExpanded ? "▼" : "▶"}</span>
                        {sup.supervisor}
                      </td>
                      <td style={{ padding: "0.6rem 0.5rem", fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.82rem", color: "var(--text-secondary)" }}>{sup.site}</td>
                      <td style={{ padding: "0.6rem 0.5rem", textAlign: "right", fontFamily: "var(--font-data, monospace)", fontSize: "0.95rem", fontWeight: 700, color: tnpsColor(sup.score) }}>
                        {sup.score > 0 ? "+" : ""}{sup.score}
                      </td>
                      <td style={{ padding: "0.6rem 0.5rem", textAlign: "right", fontFamily: "var(--font-data, monospace)", fontSize: "0.82rem", color: "var(--text-secondary)" }}>{sup.total}</td>
                      <td style={{ padding: "0.6rem 0.5rem", textAlign: "right", fontFamily: "var(--font-data, monospace)", fontSize: "0.82rem", color: "#16a34a" }}>{Math.round(sup.promoterPct)}%</td>
                      <td style={{ padding: "0.6rem 0.5rem", textAlign: "right", fontFamily: "var(--font-data, monospace)", fontSize: "0.82rem", color: "#dc2626" }}>{Math.round(sup.detractorPct)}%</td>
                      <td style={{ padding: "0.6rem 0.5rem", textAlign: "right", fontFamily: "var(--font-data, monospace)", fontSize: "0.82rem", fontWeight: 600, color: sup.delta !== null ? (sup.delta >= 0 ? "#16a34a" : "#dc2626") : "var(--text-dim)" }}>
                        {sup.delta !== null ? `${sup.delta >= 0 ? "+" : ""}${sup.delta}` : "—"}
                      </td>
                    </tr>
                    {isExpanded && sup.agents.map((agent, ai) => (
                      <tr key={`${i}-${ai}`} style={{ background: lightMode ? "#f8f9fa" : "var(--bg-tertiary)" }}>
                        <td colSpan={2} style={{ padding: "0.4rem 0.5rem 0.4rem 2rem", fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.8rem", color: "var(--text-secondary)" }}>{agent.name}</td>
                        <td style={{ padding: "0.4rem 0.5rem", textAlign: "right", fontFamily: "var(--font-data, monospace)", fontSize: "0.85rem", fontWeight: 600, color: tnpsColor(agent.score) }}>
                          {agent.score !== null ? `${agent.score > 0 ? "+" : ""}${agent.score}` : "—"}
                        </td>
                        <td style={{ padding: "0.4rem 0.5rem", textAlign: "right", fontFamily: "var(--font-data, monospace)", fontSize: "0.78rem", color: "var(--text-dim)" }}>{agent.total}</td>
                        <td style={{ padding: "0.4rem 0.5rem", textAlign: "right", fontFamily: "var(--font-data, monospace)", fontSize: "0.78rem", color: "#16a34a" }}>{Math.round(agent.promoterPct)}%</td>
                        <td style={{ padding: "0.4rem 0.5rem", textAlign: "right", fontFamily: "var(--font-data, monospace)", fontSize: "0.78rem", color: "#dc2626" }}>{Math.round(agent.detractorPct)}%</td>
                        <td />
                      </tr>
                    ))}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {tab === "voices" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          {/* Filters */}
          <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
            {/* Score type filter */}
            <div style={{ display: "flex", gap: "0.25rem" }}>
              {[{ key: "all", label: "All" }, { key: "promoter", label: "Promoter", color: "#16a34a" }, { key: "passive", label: "Passive", color: "#d97706" }, { key: "detractor", label: "Detractor", color: "#dc2626" }].map(f => (
                <button key={f.key} onClick={() => setVoiceFilter(v => ({ ...v, type: f.key }))}
                  style={{ padding: "0.35rem 0.65rem", borderRadius: "var(--radius-sm, 6px)", border: `1px solid ${voiceFilter.type === f.key ? (f.color || "#d97706") + "50" : "var(--border-muted)"}`, background: voiceFilter.type === f.key ? (f.color || "#d97706") + "12" : "transparent", color: voiceFilter.type === f.key ? (f.color || "var(--text-warm)") : "var(--text-dim)", fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.78rem", cursor: "pointer", fontWeight: voiceFilter.type === f.key ? 600 : 400 }}>
                  {f.label}
                </button>
              ))}
            </div>
            {/* Site filter */}
            <select value={voiceFilter.site} onChange={e => setVoiceFilter(v => ({ ...v, site: e.target.value }))}
              style={{ padding: "0.35rem 0.5rem", borderRadius: "var(--radius-sm, 6px)", border: "1px solid var(--border-muted)", background: "var(--bg-secondary)", color: "var(--text-secondary)", fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.78rem" }}>
              <option value="all">All GCS Sites</option>
              {tnpsBySite.filter(s => s.isGCS).map(s => <option key={s.label} value={s.label}>{s.label}</option>)}
            </select>
            {/* Campaign filter */}
            <select value={voiceFilter.campaign} onChange={e => setVoiceFilter(v => ({ ...v, campaign: e.target.value }))}
              style={{ padding: "0.35rem 0.5rem", borderRadius: "var(--radius-sm, 6px)", border: "1px solid var(--border-muted)", background: "var(--bg-secondary)", color: "var(--text-secondary)", fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.78rem" }}>
              <option value="all">All Campaigns</option>
              {voiceCampaigns.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            {/* Month filter */}
            <select value={voiceFilter.month} onChange={e => setVoiceFilter(v => ({ ...v, month: e.target.value }))}
              style={{ padding: "0.35rem 0.5rem", borderRadius: "var(--radius-sm, 6px)", border: "1px solid var(--border-muted)", background: "var(--bg-secondary)", color: "var(--text-secondary)", fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.78rem" }}>
              <option value="all">All Months</option>
              {voiceMonths.map(m => {
                const [y, mo] = m.split("-").map(Number);
                return <option key={m} value={m}>{new Date(y, mo - 1, 1).toLocaleString("en-US", { month: "short", year: "numeric" })}</option>;
              })}
            </select>
            <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.75rem", color: "var(--text-dim)", alignSelf: "center" }}>{voicesSorted.length} results</div>
          </div>

          {/* Scrollable list */}
          <div style={{ maxHeight: 600, overflowY: "auto", display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            {voicesSorted.slice(0, 100).map((s, i) => (
              <div key={i} style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)", borderLeft: `4px solid ${s.category === "promoter" ? "#16a34a" : s.category === "detractor" ? "#dc2626" : "#d97706"}`, borderRadius: "var(--radius-md, 10px)", padding: "0.75rem 1rem" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.4rem" }}>
                  <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: 4, fontFamily: "var(--font-data, monospace)", fontSize: "0.78rem", fontWeight: 700, color: "#fff", background: s.category === "promoter" ? "#16a34a" : s.category === "detractor" ? "#dc2626" : "#d97706" }}>{s.score}</span>
                  <span style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.82rem", color: "var(--text-warm)", fontWeight: 600 }}>{s.agentName}</span>
                  <span style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.72rem", color: "var(--text-dim)" }}>{s.campaign} · {s.siteLabel}</span>
                  <span style={{ marginLeft: "auto", fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.7rem", color: "var(--text-faint)" }}>{s.date ? s.date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : ""}</span>
                </div>
                <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.82rem", color: "var(--text-primary)", lineHeight: 1.5 }}>{s.reason}</div>
              </div>
            ))}
            {voicesSorted.length > 100 && (
              <div style={{ textAlign: "center", padding: "1rem", color: "var(--text-dim)", fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.78rem" }}>
                Showing first 100 of {voicesSorted.length} results. Use filters to narrow down.
              </div>
            )}
            {voicesSorted.length === 0 && (
              <div style={{ textAlign: "center", padding: "3rem", color: "var(--text-dim)", fontFamily: "var(--font-ui, Inter, sans-serif)" }}>No customer feedback matches the current filters.</div>
            )}
          </div>
        </div>
      )}

    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// SECTION 12 — BUSINESS OVERVIEW  (pages/BusinessOverview.jsx)
// Consumes engine output directly. No computation inside.
// ══════════════════════════════════════════════════════════════════════════════

function BusinessOverview({ perf, onNav, goToSlide, tnpsSlideIdx, localAI, priorAgents, priorGoalLookup, lightMode }) {
  const [tab, setTab] = useState("overview");

  const {
    programs, regions, insights, agents, goalLookup,
    planTotal, globalGoals, uniqueAgentCount, totalHours, newHireSet,
    globalRgu, globalNewXI, globalXmLines,
    globalPlanRgu, globalPlanNewXI, globalPlanXmLines,
    globalPlanHours, fiscalInfo,
    spanishCallback,
    tnpsOverall: tnpsOverallAll, tnpsBySite: tnpsBySiteAll, tnpsByMonth, tnpsGCS, tnpsData,
  } = perf;

  // tNPS: filter to current fiscal month for Overview
  const tnpsFiscalGCS = useMemo(() => tnpsFiscalFilter(tnpsGCS, fiscalInfo), [tnpsGCS, fiscalInfo]);
  const tnpsOverall = useMemo(() => calcTnpsScore(tnpsFiscalGCS), [tnpsFiscalGCS]);
  const tnpsBySite = useMemo(() => {
    const filtered = tnpsFiscalFilter(tnpsData || [], fiscalInfo);
    if (!filtered || filtered.length === 0) return tnpsBySiteAll;
    const groups = {};
    filtered.forEach(s => {
      if (!groups[s.siteLabel]) groups[s.siteLabel] = [];
      groups[s.siteLabel].push(s);
    });
    return Object.entries(groups).map(([label, surveys]) => ({
      label, isGCS: surveys[0].isGCS, ...calcTnpsScore(surveys),
    })).sort((a, b) => (b.score ?? -999) - (a.score ?? -999));
  }, [tnpsData, tnpsBySiteAll, fiscalInfo]);

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

  // Per-funding-source capped projections (global / all sites)
  const globalCapped = useMemo(() => {
    if (!goalLookup || !planTotal) return null;
    const fg = {};
    Object.values(goalLookup.byTA || {}).forEach(siteMap => {
      Object.values(siteMap).flat().forEach(r => {
        const f = r._funding || "Unknown";
        const roc = (r._roc || "").toUpperCase();
        if (!fg[f]) fg[f] = { homes: 0, hsd: 0, xm: 0, rgu: 0, hours: 0, rocs: new Set() };
        const p = computePlanRow(r);
        fg[f].homes += p.homesGoal; fg[f].hsd += p.hsdGoal;
        fg[f].xm += p.xmGoal; fg[f].rgu += p.rguGoal;
        fg[f].hours += p.hoursGoal;
        if (roc) fg[f].rocs.add(roc);
      });
    });
    const matched = new Set();
    const proj = { homes: [], hsd: [], xm: [], rgu: [], hours: [] };
    Object.values(fg).forEach(g => {
      g.rocs.forEach(r => matched.add(r));
      const fa = agents.filter(a => g.rocs.has((a.rocCode || "").toUpperCase()));
      const aH = fa.reduce((s, a) => s + a.goals, 0);
      const aD = fa.reduce((s, a) => s + a.newXI, 0);
      const aX = fa.reduce((s, a) => s + a.xmLines, 0);
      const aR = fa.reduce((s, a) => s + a.rgu, 0);
      const aHrs = fa.reduce((s, a) => s + a.hours, 0);
      proj.homes.push({ actual: aH, plan: g.homes });
      proj.hsd.push({ actual: aD, plan: g.hsd });
      proj.xm.push({ actual: aX, plan: g.xm });
      proj.rgu.push({ actual: aR, plan: g.rgu });
      proj.hours.push({ actual: aHrs, plan: g.hours });
    });
    const um = agents.filter(a => !matched.has((a.rocCode || "").toUpperCase()));
    if (um.length) {
      proj.homes.push({ actual: um.reduce((s, a) => s + a.goals, 0), plan: 0 });
      proj.hsd.push({ actual: um.reduce((s, a) => s + a.newXI, 0), plan: 0 });
      proj.xm.push({ actual: um.reduce((s, a) => s + a.xmLines, 0), plan: 0 });
      proj.rgu.push({ actual: um.reduce((s, a) => s + a.rgu, 0), plan: 0 });
      proj.hours.push({ actual: um.reduce((s, a) => s + a.hours, 0), plan: 0 });
    }
    return proj;
  }, [goalLookup, planTotal, agents]);

  const cappedProjGlobal = (groups, totalPlan) => {
    if (!fiscalInfo?.elapsedBDays || !fiscalInfo?.totalBDays || !totalPlan) return null;
    let cp = 0;
    groups.forEach(g => {
      const projected = (g.actual / fiscalInfo.elapsedBDays) * fiscalInfo.totalBDays;
      cp += g.plan > 0 ? Math.min(projected, g.plan) : projected;
    });
    return (cp / totalPlan) * 100;
  };
  const globalProjMobileCapped  = globalCapped ? cappedProjGlobal(globalCapped.homes, planTotal) : null;
  const globalProjHsdCapped     = globalCapped ? cappedProjGlobal(globalCapped.hsd, globalPlanNewXI) : null;
  const globalProjCostPerCapped = globalCapped ? cappedProjGlobal(globalCapped.rgu, globalPlanRgu) : null;
  const globalProjHourCapped    = globalCapped ? cappedProjGlobal(globalCapped.hours, globalPlanHours) : null;

  // SPH Attainment: (actual SPH / plan SPH) * 100
  const actualGlobalSph = totalHours > 0 ? globalGoals / totalHours : 0;
  const planGlobalSph = globalPlanHours > 0 && planTotal > 0 ? planTotal / globalPlanHours : null;
  const globalSphAttain = planGlobalSph ? (actualGlobalSph / planGlobalSph) * 100 : null;

  // Hour Attainment gate: (actual hours / planned hours) * 100
  const globalHourAttain = globalPlanHours ? (totalHours / globalPlanHours) * 100 : null;

  const kpi1 = goalLookup && planTotal
    ? { label: "Goals vs Plan", value: `${Math.round(goalsAttain)}%`, sub: `${globalGoals.toLocaleString()} of ${planTotal.toLocaleString()}`, accent: attainColor(goalsAttain) }
    : { label: "Q1 Rate",       value: `${Math.round(atGoalRate)}%`,  sub: `${distUnique.Q1 + distUnique.Q2} at/above goal`, accent: attainColor(atGoalRate) };

  const globalQ4Priority = programs.flatMap(p => p.q4Agents.filter(a => a.hours >= getMinHours()))
    .sort((a, b) => b.hours - a.hours).slice(0, 8);

  const qColor = pct => pct >= 100 ? Q.Q1.color : pct >= 80 ? Q.Q2.color : pct > 0 ? Q.Q3.color : Q.Q4.color;

  return (
    <div style={{ minHeight: "100vh", background: `var(--bg-primary)`, display: "flex", flexDirection: "column" }}>
      <div style={{ background: `var(--glass-bg)`, backdropFilter: "blur(12px) saturate(150%)", WebkitBackdropFilter: "blur(12px) saturate(150%)", borderBottom: "1px solid var(--glass-border)", padding: "1.25rem 2.5rem", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.7rem", color: `var(--text-muted)`, letterSpacing: "0.1em", textTransform: "uppercase", fontWeight: 600, marginBottom: "0.2rem" }}>Business Overview</div>
          <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "2rem", color: `var(--text-warm)`, fontWeight: 800, letterSpacing: "-0.02em", lineHeight: 1.15 }}>
            {tab === "daily" ? "Daily Performance" : tab === "trends" ? "Week-over-Week Trends" : "Highlights & Lowlights"}
          </div>
        </div>
        <div style={{ display: "flex", gap: "0.35rem", alignItems: "center", flexWrap: "wrap" }}>
          {[["overview","Overview"],["daily","Daily"],["trends","Trends"]].map(([t, label]) => (
            <button key={t} onClick={() => setTab(t)}
              style={{ padding: "0.4rem 0.85rem", borderRadius: "var(--radius-sm, 6px)", border: `1px solid ${tab===t?"#d9770650":"var(--text-faint)"}`, background: tab===t?"#d9770612":"transparent", color: tab===t?"#d97706":`var(--text-muted)`, fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.78rem", cursor: "pointer", fontWeight: tab===t ? 600 : 400, transition: "all 200ms cubic-bezier(0.4,0,0.2,1)" }}>
              {label}
            </button>
          ))}
          <div style={{ width: "1px", height: "20px", background: "var(--border-muted)", margin: "0 0.2rem" }} />
          <button onClick={() => onNav(1)}
            style={{ padding: "0.45rem 1rem", background: "linear-gradient(135deg, #d9770620, #f59e0b15)", border: "1px solid #d9770640", borderRadius: "var(--radius-sm, 6px)", color: "#d97706", fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.78rem", cursor: "pointer", fontWeight: 600, letterSpacing: "0.02em" }}>
            Programs {"\u2192"}
          </button>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "2rem 2.5rem", display: "flex", flexDirection: "column", gap: "1.5rem" }}>

        {!goalLookup && tab === "overview" && (
          <div style={{ background: "#d9770610", border: "1px solid #d9770640", borderLeft: "4px solid #d97706", borderRadius: "var(--radius-md, 10px)", padding: "0.9rem 1.25rem", display: "flex", alignItems: "center", gap: "0.9rem" }}>
            <span style={{ fontSize: "1.15rem" }}>🎯</span>
            <div>
              <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.8rem", color: "#d97706", letterSpacing: "0.1em", textTransform: "uppercase" }}>Goals file not loaded</div>
              <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.82rem", color: `var(--text-secondary)`, marginTop: "0.2rem" }}>
                Upload your goals CSV to unlock Goals vs Plan comparisons and a Goals tab on every program slide. Until then, metrics reflect performance distribution only.
              </div>
            </div>
          </div>
        )}

        {tab === "overview" && (
          <>
            {/* KPI strip */}
        <div className="animate-in" style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: "0.75rem" }}>
          {[
            kpi1,
            { label: "Unique Agents",  value: uniqueAgentCount,             sub: `${programs.length} programs`,                              accent: "#6366f1" },
            { label: "Total Hours",    value: fmt(totalHours, 0),            sub: goalLookup && globalPlanHours ? `of ${Math.round(globalPlanHours).toLocaleString()} planned` : `${new Set(agents.filter(a=>a.hours>=16).map(a=>a.agentName).filter(Boolean)).size} at 16+`, accent: "#6366f1" },
            { label: "Total Goals",    value: globalGoals.toLocaleString(),  sub: "conversions",                                              accent: "#16a34a" },
            { label: "Q1 Agents",      value: uniqueQ1,                      sub: `${Math.round(uniqueQ1/uniqueAgentCount*100)}% of workforce`, accent: Q.Q1.color },
          ].map(c => (
            <div key={c.label} style={{ background: `var(--glass-bg)`, backdropFilter: "blur(12px) saturate(150%)", WebkitBackdropFilter: "blur(12px) saturate(150%)", border: `1px solid ${c.accent}18`, borderRadius: "var(--radius-lg, 16px)", padding: "1.25rem 1.35rem", borderTop: `3px solid ${c.accent}`, boxShadow: `var(--card-glow)`, transition: "all 250ms cubic-bezier(0.4,0,0.2,1)" }}>
              <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.7rem", color: `var(--text-muted)`, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 600 }}>{c.label}</div>
              <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "2.25rem", color: `var(--text-warm)`, fontWeight: 800, marginTop: "0.2rem", lineHeight: 1, letterSpacing: "-0.02em" }}>{c.value}</div>
              <div style={{ fontFamily: "var(--font-data, monospace)", fontSize: "0.72rem", color: `var(--text-dim)`, marginTop: "0.35rem" }}>{c.sub}</div>
            </div>
          ))}
        </div>

        {/* Goals vs Plan metrics row */}
        {(() => {
          const bizNarrative = generateBusinessNarrative(perf, fiscalInfo);
          const bizAIData = localAI ? { jobType: "Business Wide", uniqueAgentCount, totalHours, totalGoals: globalGoals, gph: totalHours > 0 ? globalGoals / totalHours : 0, attainment: planTotal ? (globalGoals / planTotal) * 100 : null, planGoals: planTotal, actGoals: globalGoals, distUnique: {}, q1Agents: [], q4Agents: [], regions, healthScore: null, totalNewXI: globalNewXI, totalXmLines: globalXmLines, newHiresInProgram: [], fiscalInfo } : null;
          return <CollapsibleNarrative title="Executive Summary" lines={bizNarrative} defaultOpen={true} aiEnabled={localAI} aiPromptData={bizAIData} />;
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
            sphAttain={globalSphAttain}
            hourAttain={globalHourAttain}
            fiscalInfo={fiscalInfo}
            mobileActual={globalGoals}   mobilePlan={planTotal}
            hsdActual={globalNewXI}      hsdPlan={globalPlanNewXI}
            costPerActual={globalRgu}    costPerPlan={globalPlanRgu}
            sphActual={actualGlobalSph}  sphPlan={planGlobalSph}
            hourActual={totalHours}      hourPlan={globalPlanHours}
            homesActual={globalGoals}    homesPlan={planTotal}
            projMobileCapped={globalProjMobileCapped}
            projHsdCapped={globalProjHsdCapped}
            projCostPerCapped={globalProjCostPerCapped}
            projHourCapped={globalProjHourCapped}
          />
        )}

        {/* Quartile distribution */}
        <div style={{ background: `var(--bg-secondary)`, border: "1px solid var(--border)", borderRadius: "var(--radius-lg, 16px)", padding: "1.25rem 1.5rem" }}>
          <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.8rem", color: `var(--text-muted)`, letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: "0.9rem" }}>Workforce Distribution — Unique Agents</div>
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
                    const active  = names.filter(n => (agentHours[n] || 0) >= getMinHours()).length;
                    const pctTeam = totalUnique ? Math.round(count / totalUnique * 100) : 0;
                    return (
                      <div key={q} style={{ padding: "0.75rem", borderRadius: "var(--radius-md, 10px)", background: Q[q].color+"12", border: `1px solid ${Q[q].color}30`, textAlign: "center" }}>
                        <div style={{ fontFamily: "var(--font-display, Inter, sans-serif)", fontSize: "3rem", color: Q[q].color, fontWeight: 700, lineHeight: 1 }}>{active}</div>
                        <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.82rem", color: Q[q].color, marginTop: "0.15rem" }}>{q} {getMinHours()}+ hrs</div>
                        <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.82rem", color: `var(--text-dim)`, marginTop: "0.2rem" }}>{count} total · {pctTeam}%</div>
                      </div>
                    );
                  })}
                </div>
                <div style={{ display: "flex", height: "7px", borderRadius: "var(--radius-sm, 6px)", overflow: "hidden" }}>
                  {["Q1","Q2","Q3","Q4"].map(q => {
                    const c = Object.keys(agentQ).filter(n => agentQ[n] === q).length;
                    return <div key={q} style={{ flex: c||0, background: Q[q].color, transition: "flex 0.6s" }} />;
                  })}
                </div>
              </>
            );
          })()}
        </div>

        {/* Program Gainshare Scorecard */}
        {(() => {
          const projColor = pct => pct >= 100 ? "#16a34a" : pct >= 85 ? "#2563eb" : "#dc2626";
          // Pre-compute totals for the header strip
          const tHours = programs.reduce((s, p) => s + p.totalHours, 0);
          const tGoals = programs.reduce((s, p) => s + p.actGoals, 0);
          const tPlan  = programs.reduce((s, p) => s + (p.planGoals || 0), 0);
          const tAtt   = tPlan > 0 ? (tGoals / tPlan) * 100 : null;
          const tPace  = fiscalInfo && tGoals && tPlan ? calcPacing(tGoals, tPlan, fiscalInfo.elapsedBDays, fiscalInfo.totalBDays) : null;
          const behindCount = programs.filter(p => { const pc = fiscalInfo && p.actGoals && p.planGoals ? calcPacing(p.actGoals, p.planGoals, fiscalInfo.elapsedBDays, fiscalInfo.totalBDays) : null; return pc && pc.projectedPct < 85; }).length;
          const aheadCount = programs.filter(p => { const pc = fiscalInfo && p.actGoals && p.planGoals ? calcPacing(p.actGoals, p.planGoals, fiscalInfo.elapsedBDays, fiscalInfo.totalBDays) : null; return pc && pc.projectedPct >= 100; }).length;

          // Pre-compute per-program scorecard data
          const progData = programs.map((p, i) => {
            // Avg agents per day
            const agentsPerDay = {};
            p.agents.forEach(a => {
              if (!a.date || !a.agentName) return;
              if (!agentsPerDay[a.date]) agentsPerDay[a.date] = new Set();
              agentsPerDay[a.date].add(a.agentName);
            });
            const dayCount = Object.keys(agentsPerDay).length;
            const avgDay = dayCount > 0
              ? Math.round(Object.values(agentsPerDay).reduce((sum, set) => sum + set.size, 0) / dayCount)
              : 0;

            // Sales pacing
            const pace = fiscalInfo && p.actGoals && p.planGoals
              ? calcPacing(p.actGoals, p.planGoals, fiscalInfo.elapsedBDays, fiscalInfo.totalBDays)
              : null;

            // GPH goal (SPH GOAL is a rate — average across plan rows, not sum)
            const sphGoal = (() => {
              if (!p.goalEntry) return null;
              const rows = uniqueRowsFromEntry(p.goalEntry);
              const vals = rows.map(r => parseNum(findCol(r, "SPH GOAL", "SPH Goal", "Sph Goal"))).filter(v => v > 0);
              return vals.length > 0 ? vals.reduce((s, v) => s + v, 0) / vals.length : null;
            })();

            // Sub-metric plans
            const planHrs = p.goalEntry ? getPlanForKey(p.goalEntry, "Hours Goal") : null;
            const planHsd = p.goalEntry ? getPlanForKey(p.goalEntry, "HSD Sell In Goal") : null;
            const planXm  = p.goalEntry ? getPlanForKey(p.goalEntry, "XM GOAL") : null;
            const planRgu = p.goalEntry ? getPlanForKey(p.goalEntry, "RGU GOAL") : null;

            // Sub-metric pacing (projected %)
            const hrsPace = fiscalInfo && planHrs ? calcPacing(p.totalHours, planHrs, fiscalInfo.elapsedBDays, fiscalInfo.totalBDays) : null;
            const hsdPace = fiscalInfo && planHsd ? calcPacing(p.totalNewXI, planHsd, fiscalInfo.elapsedBDays, fiscalInfo.totalBDays) : null;
            const xmPace  = fiscalInfo && planXm  ? calcPacing(p.totalXmLines, planXm, fiscalInfo.elapsedBDays, fiscalInfo.totalBDays) : null;
            const rguPace = fiscalInfo && planRgu ? calcPacing(p.totalRgu, planRgu, fiscalInfo.elapsedBDays, fiscalInfo.totalBDays) : null;

            // Belize-only detection
            const isBelizeOnly = p.agents.length > 0 && p.agents.every(a =>
              a.region && a.region.includes("XOTM")
            );

            return { ...p, _origIdx: i, avgDay, pace, sphGoal, planHrs, planHsd, planXm, planRgu, hrsPace, hsdPace, xmPace, rguPace, isBelizeOnly };
          });

          return (
          <div style={{ background: `var(--bg-secondary)`, border: "1px solid var(--border)", borderRadius: "var(--radius-lg, 16px)", padding: "clamp(1rem, 3vw, 1.75rem)" }}>
            {/* Header with key business metrics */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "1.25rem", flexWrap: "wrap", gap: "1rem" }}>
              <div>
                <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.82rem", color: `var(--text-muted)`, letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: "0.3rem" }}>
                  Program Scorecard {goalLookup ? "— Gainshare Metrics" : ""}
                </div>
                <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.85rem", color: `var(--text-dim)`, lineHeight: 1.5 }}>
                  {programs.length} programs {aheadCount > 0 && <span style={{ color: "#16a34a", fontWeight: 600 }}>{aheadCount} ahead</span>}
                  {aheadCount > 0 && behindCount > 0 && <span style={{ margin: "0 0.3rem", color: "var(--text-faint)" }}>/</span>}
                  {behindCount > 0 && <span style={{ color: "#dc2626", fontWeight: 600 }}>{behindCount} behind pace</span>}
                </div>
              </div>
              {tPace && (
                <div style={{ display: "flex", gap: "1.25rem", alignItems: "center" }}>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.7rem", color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Sales to Plan</div>
                    <div style={{ fontFamily: "var(--font-display, Inter, sans-serif)", fontSize: "1.75rem", color: tAtt !== null ? attainColor(tAtt) : "var(--text-faint)", fontWeight: 700, lineHeight: 1 }}>{tAtt !== null ? `${Math.round(tAtt)}%` : "—"}</div>
                    <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.72rem", color: "var(--text-dim)" }}>{tGoals.toLocaleString()} of {tPlan.toLocaleString()} goal</div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.7rem", color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Projected Month-End Sales</div>
                    <div style={{ fontFamily: "var(--font-display, Inter, sans-serif)", fontSize: "1.75rem", color: attainColor(tPace.projectedPct), fontWeight: 700, lineHeight: 1 }}>{tPace.projected.toLocaleString()}</div>
                    <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.72rem", color: attainColor(tPace.projectedPct) }}>{Math.round(tPace.projectedPct)}% of plan</div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.7rem", color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Avg Daily Sales</div>
                    <div style={{ fontFamily: "var(--font-display, Inter, sans-serif)", fontSize: "1.75rem", color: tPace.requiredDaily && tPace.dailyRate >= tPace.requiredDaily ? "#16a34a" : "#dc2626", fontWeight: 700, lineHeight: 1 }}>{Math.round(tPace.dailyRate)}</div>
                    <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.72rem", color: "var(--text-dim)" }}>need {tPace.requiredDaily ? Math.round(tPace.requiredDaily) : "?"}/day</div>
                  </div>
                  <div style={{ width: 1, height: 36, background: "var(--border-muted, var(--border))", margin: "0 0.25rem" }} />
                  {[
                    { label: "Avg Daily XI", actual: globalNewXI, plan: globalPlanNewXI },
                    { label: "Avg Daily XM", actual: globalXmLines, plan: globalPlanXmLines },
                    { label: "Avg Daily RGU", actual: globalRgu, plan: globalPlanRgu },
                  ].map(m => {
                    const mp = fiscalInfo && m.plan ? calcPacing(m.actual, m.plan, fiscalInfo.elapsedBDays, fiscalInfo.totalBDays) : null;
                    const dailyRate = fiscalInfo && fiscalInfo.elapsedBDays > 0 ? m.actual / fiscalInfo.elapsedBDays : 0;
                    const requiredDaily = fiscalInfo && m.plan && fiscalInfo.totalBDays > 0 ? m.plan / fiscalInfo.totalBDays : null;
                    const rateColor = requiredDaily && dailyRate >= requiredDaily ? "#16a34a" : "#dc2626";
                    return (
                      <div key={m.label} style={{ textAlign: "right" }}>
                        <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.7rem", color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: "0.05em" }}>{m.label}</div>
                        <div style={{ fontFamily: "var(--font-display, Inter, sans-serif)", fontSize: "1.75rem", color: m.plan ? rateColor : "var(--text-faint)", fontWeight: 700, lineHeight: 1 }}>{Math.round(dailyRate)}</div>
                        <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.72rem", color: "var(--text-dim)" }}>{requiredDaily ? `need ${Math.round(requiredDaily)}/day` : ""}</div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Scorecard table */}
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.92rem" }}>
                <thead>
                  <tr style={{ borderBottom: "2px solid var(--border)" }}>
                    <th style={{ padding: "0.6rem 0.6rem", textAlign: "left", color: "var(--text-muted)", fontWeight: 600, fontSize: "0.75rem", letterSpacing: "0.04em", textTransform: "uppercase" }}>Program</th>
                    <th style={{ padding: "0.6rem 0.5rem", textAlign: "center", color: "var(--text-muted)", fontWeight: 600, fontSize: "0.75rem" }}>Avg/Day</th>
                    <th style={{ padding: "0.6rem 0.5rem", textAlign: "left", color: "var(--text-muted)", fontWeight: 600, fontSize: "0.75rem", minWidth: 200 }}>Sales vs Plan</th>
                    <th style={{ padding: "0.6rem 0.5rem", textAlign: "center", color: "var(--text-muted)", fontWeight: 600, fontSize: "0.75rem" }}>Hours</th>
                    <th style={{ padding: "0.6rem 0.5rem", textAlign: "left", color: "var(--text-muted)", fontWeight: 600, fontSize: "0.75rem", minWidth: 130 }}>GPH vs Goal</th>
                    <th style={{ padding: "0.6rem 0.5rem", textAlign: "center", color: "var(--text-muted)", fontWeight: 600, fontSize: "0.75rem" }}>HSD</th>
                    <th style={{ padding: "0.6rem 0.5rem", textAlign: "center", color: "var(--text-muted)", fontWeight: 600, fontSize: "0.75rem" }}>XM</th>
                    <th style={{ padding: "0.6rem 0.5rem", textAlign: "center", color: "var(--text-muted)", fontWeight: 600, fontSize: "0.75rem" }}>RGU</th>
                    <th style={{ padding: "0.6rem 0.5rem", textAlign: "center", color: "var(--text-muted)", fontWeight: 600, fontSize: "0.75rem", minWidth: 140 }}>Quartile Distribution</th>
                  </tr>
                </thead>
                <tbody>
                  {[...progData].sort((a, b) => (b.attainment ?? b.healthScore ?? 0) - (a.attainment ?? a.healthScore ?? 0)).map((p, i) => {
                    const paceColor = p.pace ? projColor(p.pace.projectedPct) : "var(--text-faint)";
                    const rowBg = p.pace && p.pace.projectedPct < 85 ? (lightMode ? "#fef2f2" : "#dc262606") : i % 2 === 1 ? "var(--bg-row-alt)" : "transparent";
                    const pidx = p._origIdx;
                    const gphPct = p.sphGoal ? (p.gph / p.sphGoal) * 100 : null;
                    const gphBarColor = gphPct !== null ? projColor(gphPct) : "var(--text-faint)";
                    const gphBarW = gphPct !== null ? Math.min(gphPct, 100) : 0;
                    const attPct = p.planGoals ? (p.actGoals / p.planGoals) * 100 : null;

                    return (
                      <tr key={p.jobType} onClick={() => onNav(pidx + 1)} style={{ borderBottom: "1px solid var(--bg-tertiary)", cursor: "pointer", background: rowBg }}>
                        {/* Program name + badge */}
                        <td style={{ padding: "0.7rem 0.6rem" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                            <span style={{ display: "inline-block", width: 6, height: 6, borderRadius: "50%", background: p.pace ? paceColor : "var(--text-faint)", flexShrink: 0 }} />
                            <span style={{ color: "var(--text-warm)", fontWeight: 600, fontSize: "0.95rem" }}>{p.jobType}</span>
                          </div>
                          {p.isBelizeOnly && (
                            <div style={{ fontSize: "0.65rem", color: "#7c3aed", marginLeft: 12, marginTop: 2, fontWeight: 600, letterSpacing: "0.04em" }}>BELIZE ONLY</div>
                          )}
                        </td>

                        {/* Avg/Day */}
                        <td style={{ padding: "0.7rem 0.5rem", textAlign: "center", color: "var(--text-secondary)", fontSize: "0.95rem" }}>{p.avgDay}</td>

                        {/* Sales vs Plan with projection */}
                        <td style={{ padding: "0.7rem 0.5rem" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <div style={{ flex: 1, height: 6, background: "var(--bg-tertiary)", borderRadius: 3, overflow: "hidden" }}>
                              <div style={{ width: `${Math.min(attPct || 0, 100)}%`, height: "100%", background: p.pace ? paceColor : "var(--text-faint)", borderRadius: 3 }} />
                            </div>
                            <span style={{ fontSize: "0.82rem", color: "var(--text-warm)", whiteSpace: "nowrap", fontWeight: 600 }}>
                              {p.actGoals.toLocaleString()}{p.planGoals ? <span style={{ color: "var(--text-faint)", fontWeight: 400 }}> / {p.planGoals.toLocaleString()}</span> : null}
                            </span>
                          </div>
                          {p.pace && (
                            <>
                              <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
                                <div style={{ flex: 1, height: 3, background: "var(--bg-tertiary)", borderRadius: 2, overflow: "hidden" }}>
                                  <div style={{ width: `${Math.min(p.pace.projectedPct, 100)}%`, height: "100%", background: paceColor + "40", borderRadius: 2, borderRight: `2px solid ${paceColor}` }} />
                                </div>
                                <span style={{ fontSize: "0.75rem", color: paceColor, whiteSpace: "nowrap", fontWeight: 600 }}>{Math.round(p.pace.projectedPct)}%</span>
                              </div>
                              <div style={{ textAlign: "right", fontSize: "0.68rem", color: paceColor + "90", marginTop: 1 }}>proj {p.pace.projected.toLocaleString()}</div>
                            </>
                          )}
                        </td>

                        {/* Hours */}
                        <td style={{ padding: "0.7rem 0.5rem", textAlign: "center" }}>
                          <div style={{ color: "var(--text-secondary)", fontWeight: 600, fontSize: "0.95rem" }}>
                            {fmt(p.totalHours, 0)}{p.planHrs ? <span style={{ color: "var(--text-faint)", fontWeight: 400, fontSize: "0.82rem" }}> / {fmt(p.planHrs, 0)}</span> : null}
                          </div>
                          {p.hrsPace && (
                            <div style={{ fontSize: "0.68rem", color: projColor(p.hrsPace.projectedPct), fontWeight: 600 }}>
                              {Math.round(p.hrsPace.projectedPct)}% proj
                            </div>
                          )}
                        </td>

                        {/* GPH vs Goal */}
                        <td style={{ padding: "0.7rem 0.5rem" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            <div style={{ flex: 1, height: 6, background: "var(--bg-tertiary)", borderRadius: 3, overflow: "hidden" }}>
                              {gphPct !== null && <div style={{ width: `${gphBarW}%`, height: "100%", background: gphBarColor, borderRadius: 3 }} />}
                            </div>
                            <span style={{ fontSize: "0.82rem", color: "var(--text-warm)", whiteSpace: "nowrap" }}>
                              <span style={{ fontWeight: 600 }}>{p.gph.toFixed(3)}</span>
                              {p.sphGoal ? <span style={{ color: "var(--text-faint)" }}> / {p.sphGoal.toFixed(2)}</span> : null}
                            </span>
                          </div>
                        </td>

                        {/* HSD */}
                        <td style={{ padding: "0.7rem 0.5rem", textAlign: "center" }}>
                          <div style={{ color: "var(--text-secondary)", fontWeight: 600, fontSize: "0.95rem" }}>
                            {p.totalNewXI}{p.planHsd ? <span style={{ color: "var(--text-faint)", fontWeight: 400, fontSize: "0.82rem" }}> / {p.planHsd.toLocaleString()}</span> : null}
                          </div>
                          {p.hsdPace && (
                            <div style={{ fontSize: "0.68rem", color: projColor(p.hsdPace.projectedPct), fontWeight: 600 }}>
                              {Math.round(p.hsdPace.projectedPct)}% proj
                            </div>
                          )}
                        </td>

                        {/* XM */}
                        <td style={{ padding: "0.7rem 0.5rem", textAlign: "center" }}>
                          <div style={{ color: "var(--text-secondary)", fontWeight: 600, fontSize: "0.95rem" }}>
                            {p.totalXmLines}{p.planXm ? <span style={{ color: "var(--text-faint)", fontWeight: 400, fontSize: "0.82rem" }}> / {p.planXm.toLocaleString()}</span> : null}
                          </div>
                          {p.xmPace && (
                            <div style={{ fontSize: "0.68rem", color: projColor(p.xmPace.projectedPct), fontWeight: 600 }}>
                              {Math.round(p.xmPace.projectedPct)}% proj
                            </div>
                          )}
                        </td>

                        {/* RGU */}
                        <td style={{ padding: "0.7rem 0.5rem", textAlign: "center" }}>
                          <div style={{ color: "var(--text-secondary)", fontWeight: 600, fontSize: "0.95rem" }}>
                            {p.totalRgu}{p.planRgu ? <span style={{ color: "var(--text-faint)", fontWeight: 400, fontSize: "0.82rem" }}> / {p.planRgu.toLocaleString()}</span> : null}
                          </div>
                          {p.rguPace && (
                            <div style={{ fontSize: "0.68rem", color: projColor(p.rguPace.projectedPct), fontWeight: 600 }}>
                              {Math.round(p.rguPace.projectedPct)}% proj
                            </div>
                          )}
                        </td>

                        {/* Quartile Distribution */}
                        <td style={{ padding: "0.7rem 0.5rem" }}>
                          {(() => {
                            const counts = { Q1: p.distUnique.Q1 || 0, Q2: p.distUnique.Q2 || 0, Q3: p.distUnique.Q3 || 0, Q4: p.distUnique.Q4 || 0 };
                            const total = counts.Q1 + counts.Q2 + counts.Q3 + counts.Q4;
                            if (total === 0) return <div style={{ color: "var(--text-faint)", fontSize: "0.68rem", textAlign: "center" }}>No qualified agents</div>;
                            return (
                              <>
                                <div style={{ display: "flex", height: 10, borderRadius: 5, overflow: "hidden", gap: 1 }}>
                                  {["Q1","Q2","Q3","Q4"].map(q => (
                                    <div key={q} style={{ flex: counts[q], background: Q[q].color }} />
                                  ))}
                                </div>
                                <div style={{ display: "flex", marginTop: 3, fontSize: "0.68rem", gap: 1 }}>
                                  {["Q1","Q2","Q3","Q4"].map(q => (
                                    <div key={q} style={{ flex: Math.max(counts[q], 1), textAlign: "center", color: Q[q].color }}>
                                      {counts[q]}
                                    </div>
                                  ))}
                                </div>
                              </>
                            );
                          })()}
                        </td>
                      </tr>
                    );
                  })}
                  {/* Totals row */}
                  {goalLookup && (() => {
                    const tHsd = programs.reduce((s, p) => s + p.totalNewXI, 0);
                    const tXm  = programs.reduce((s, p) => s + p.totalXmLines, 0);
                    const tRgu = programs.reduce((s, p) => s + p.totalRgu, 0);
                    const tQ1  = programs.reduce((s, p) => s + (p.distUnique.Q1 || 0), 0);
                    const tQ2  = programs.reduce((s, p) => s + (p.distUnique.Q2 || 0), 0);
                    const tQ3  = programs.reduce((s, p) => s + (p.distUnique.Q3 || 0), 0);
                    const tQ4  = programs.reduce((s, p) => s + (p.distUnique.Q4 || 0), 0);
                    const tAvgDay = progData.reduce((s, p) => s + p.avgDay, 0);
                    const tGph = tHours > 0 ? tGoals / tHours : 0;
                    const tSphGoal = null; // No meaningful aggregate SPH goal
                    const tCounts = { Q1: tQ1, Q2: tQ2, Q3: tQ3, Q4: tQ4 };
                    const tQTotal = tQ1 + tQ2 + tQ3 + tQ4;

                    return (
                      <tr style={{ borderTop: "2px solid var(--border)" }}>
                        <td style={{ padding: "0.75rem 0.6rem", color: "var(--text-warm)", fontWeight: 700, fontSize: "0.95rem" }}>TOTAL</td>
                        <td style={{ padding: "0.75rem 0.5rem", textAlign: "center", color: "var(--text-warm)", fontWeight: 700, fontSize: "0.95rem" }}>{tAvgDay}</td>
                        <td style={{ padding: "0.75rem 0.5rem" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <div style={{ flex: 1, height: 6, background: "var(--bg-tertiary)", borderRadius: 3, overflow: "hidden" }}>
                              <div style={{ width: `${Math.min(tAtt || 0, 100)}%`, height: "100%", background: tPace ? projColor(tPace.projectedPct) : "var(--text-faint)", borderRadius: 3 }} />
                            </div>
                            <span style={{ fontSize: "0.82rem", color: "var(--text-warm)", whiteSpace: "nowrap", fontWeight: 700 }}>
                              {tGoals.toLocaleString()}<span style={{ color: "var(--text-faint)", fontWeight: 400 }}> / {tPlan.toLocaleString()}</span>
                            </span>
                          </div>
                          {tPace && (
                            <>
                              <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
                                <div style={{ flex: 1, height: 3, background: "var(--bg-tertiary)", borderRadius: 2, overflow: "hidden" }}>
                                  <div style={{ width: `${Math.min(tPace.projectedPct, 100)}%`, height: "100%", background: projColor(tPace.projectedPct) + "40", borderRadius: 2, borderRight: `2px solid ${projColor(tPace.projectedPct)}` }} />
                                </div>
                                <span style={{ fontSize: "0.75rem", color: projColor(tPace.projectedPct), whiteSpace: "nowrap", fontWeight: 600 }}>{Math.round(tPace.projectedPct)}%</span>
                              </div>
                              <div style={{ textAlign: "right", fontSize: "0.68rem", color: projColor(tPace.projectedPct) + "90", marginTop: 1 }}>proj {tPace.projected.toLocaleString()}</div>
                            </>
                          )}
                        </td>
                        <td style={{ padding: "0.75rem 0.5rem", textAlign: "center" }}>
                          <div style={{ color: "var(--text-warm)", fontWeight: 700, fontSize: "0.95rem" }}>
                            {fmt(tHours, 0)}{globalPlanHours ? <span style={{ color: "var(--text-faint)", fontWeight: 400, fontSize: "0.82rem" }}> / {fmt(globalPlanHours, 0)}</span> : null}
                          </div>
                          {(() => { const hp = fiscalInfo && globalPlanHours ? calcPacing(tHours, globalPlanHours, fiscalInfo.elapsedBDays, fiscalInfo.totalBDays) : null; return hp ? <div style={{ fontSize: "0.68rem", color: projColor(hp.projectedPct), fontWeight: 600 }}>{Math.round(hp.projectedPct)}% proj</div> : null; })()}
                        </td>
                        <td style={{ padding: "0.75rem 0.5rem", textAlign: "center" }}>
                          <span style={{ fontSize: "0.95rem", color: "var(--text-warm)", fontWeight: 700 }}>{tGph > 0 ? tGph.toFixed(3) : "—"}</span>
                        </td>
                        <td style={{ padding: "0.75rem 0.5rem", textAlign: "center" }}>
                          <div style={{ color: "var(--text-warm)", fontWeight: 700, fontSize: "0.95rem" }}>
                            {tHsd}{globalPlanNewXI ? <span style={{ color: "var(--text-faint)", fontWeight: 400, fontSize: "0.82rem" }}> / {globalPlanNewXI.toLocaleString()}</span> : null}
                          </div>
                          {(() => { const hp = fiscalInfo && globalPlanNewXI ? calcPacing(tHsd, globalPlanNewXI, fiscalInfo.elapsedBDays, fiscalInfo.totalBDays) : null; return hp ? <div style={{ fontSize: "0.68rem", color: projColor(hp.projectedPct), fontWeight: 600 }}>{Math.round(hp.projectedPct)}% proj</div> : null; })()}
                        </td>
                        <td style={{ padding: "0.75rem 0.5rem", textAlign: "center" }}>
                          <div style={{ color: "var(--text-warm)", fontWeight: 700, fontSize: "0.95rem" }}>
                            {tXm}{globalPlanXmLines ? <span style={{ color: "var(--text-faint)", fontWeight: 400, fontSize: "0.82rem" }}> / {globalPlanXmLines.toLocaleString()}</span> : null}
                          </div>
                          {(() => { const xp = fiscalInfo && globalPlanXmLines ? calcPacing(tXm, globalPlanXmLines, fiscalInfo.elapsedBDays, fiscalInfo.totalBDays) : null; return xp ? <div style={{ fontSize: "0.68rem", color: projColor(xp.projectedPct), fontWeight: 600 }}>{Math.round(xp.projectedPct)}% proj</div> : null; })()}
                        </td>
                        <td style={{ padding: "0.75rem 0.5rem", textAlign: "center" }}>
                          <div style={{ color: "var(--text-warm)", fontWeight: 700, fontSize: "0.95rem" }}>
                            {tRgu}{globalPlanRgu ? <span style={{ color: "var(--text-faint)", fontWeight: 400, fontSize: "0.82rem" }}> / {globalPlanRgu.toLocaleString()}</span> : null}
                          </div>
                          {(() => { const rp = fiscalInfo && globalPlanRgu ? calcPacing(tRgu, globalPlanRgu, fiscalInfo.elapsedBDays, fiscalInfo.totalBDays) : null; return rp ? <div style={{ fontSize: "0.68rem", color: projColor(rp.projectedPct), fontWeight: 600 }}>{Math.round(rp.projectedPct)}% proj</div> : null; })()}
                        </td>
                        <td style={{ padding: "0.75rem 0.5rem" }}>
                          {tQTotal > 0 ? (
                            <>
                              <div style={{ display: "flex", height: 10, borderRadius: 5, overflow: "hidden", gap: 1 }}>
                                {["Q1","Q2","Q3","Q4"].map(q => (
                                  <div key={q} style={{ flex: tCounts[q], background: Q[q].color }} />
                                ))}
                              </div>
                              <div style={{ display: "flex", marginTop: 3, fontSize: "0.68rem", gap: 1 }}>
                                {["Q1","Q2","Q3","Q4"].map(q => (
                                  <div key={q} style={{ flex: Math.max(tCounts[q], 1), textAlign: "center", color: Q[q].color }}>
                                    {tCounts[q]}
                                  </div>
                                ))}
                              </div>
                            </>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })()}
                </tbody>
              </table>
            </div>
          </div>
          );
        })()}

        {/* tNPS Summary Row — only renders when tNPS data is loaded */}
        {tnpsOverall && tnpsOverall.total > 0 && (() => {
          const gcsScore = tnpsOverall;
          const partnerSurveys = tnpsBySite.filter(s => !s.isGCS);
          const partnerAvg = partnerSurveys.length > 0
            ? Math.round(partnerSurveys.reduce((s, p) => s + (p.score || 0), 0) / partnerSurveys.length)
            : null;
          // MoM delta: compare last two months
          const momDelta = tnpsByMonth.length >= 2
            ? tnpsByMonth[tnpsByMonth.length - 1].score - tnpsByMonth[tnpsByMonth.length - 2].score
            : null;

          return (
            <div
              onClick={() => goToSlide(tnpsSlideIdx)}
              style={{ background: `var(--bg-secondary)`, border: "1px solid var(--border)", borderRadius: "var(--radius-lg, 16px)", padding: "1rem 1.5rem", cursor: "pointer", transition: "all 200ms", marginTop: "0.75rem" }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = "#d97706"; e.currentTarget.style.boxShadow = "0 0 12px #d9770620"; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = "var(--border)"; e.currentTarget.style.boxShadow = "none"; }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.5rem" }}>
                <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.72rem", letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--text-muted)" }}>
                  Customer Experience — tNPS
                </div>
                <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.72rem", color: "var(--text-faint)" }}>
                  Click to view details →
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "auto 1fr auto auto auto", gap: "1.5rem", alignItems: "center" }}>
                {/* Overall tNPS */}
                <div style={{ textAlign: "center" }}>
                  <div style={{ fontFamily: "var(--font-display, Inter, sans-serif)", fontSize: "2.5rem", fontWeight: 800, color: tnpsColor(gcsScore.score) }}>
                    {gcsScore.score > 0 ? "+" : ""}{gcsScore.score}
                  </div>
                  <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.7rem", color: "var(--text-dim)" }}>
                    GCS tNPS · {gcsScore.total} surveys
                  </div>
                </div>

                {/* Promoter / Passive / Detractor bar */}
                <div>
                  <div style={{ display: "flex", height: 14, borderRadius: 7, overflow: "hidden", gap: 1 }}>
                    <div style={{ flex: gcsScore.promoterPct, background: "#16a34a", minWidth: gcsScore.promoterPct > 0 ? 4 : 0 }} />
                    <div style={{ flex: gcsScore.passivePct, background: "#d97706", minWidth: gcsScore.passivePct > 0 ? 4 : 0 }} />
                    <div style={{ flex: gcsScore.detractorPct, background: "#dc2626", minWidth: gcsScore.detractorPct > 0 ? 4 : 0 }} />
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
                    <span style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.7rem", color: "#16a34a" }}>{Math.round(gcsScore.promoterPct)}% Promoter</span>
                    <span style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.7rem", color: "#d97706" }}>{Math.round(gcsScore.passivePct)}% Passive</span>
                    <span style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.7rem", color: "#dc2626" }}>{Math.round(gcsScore.detractorPct)}% Detractor</span>
                  </div>
                </div>

                {/* vs Partners */}
                {partnerAvg !== null && (
                  <div style={{ textAlign: "center" }}>
                    <div style={{ fontFamily: "var(--font-data, monospace)", fontSize: "1.1rem", fontWeight: 700, color: gcsScore.score >= partnerAvg ? "#16a34a" : "#dc2626" }}>
                      {gcsScore.score >= partnerAvg ? "+" : ""}{gcsScore.score - partnerAvg}
                    </div>
                    <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.65rem", color: "var(--text-dim)" }}>vs Partners</div>
                  </div>
                )}

                {/* MoM Delta */}
                {momDelta !== null && (
                  <div style={{ textAlign: "center" }}>
                    <div style={{ fontFamily: "var(--font-data, monospace)", fontSize: "1.1rem", fontWeight: 700, color: momDelta >= 0 ? "#16a34a" : "#dc2626" }}>
                      {momDelta >= 0 ? "▲" : "▼"} {Math.abs(momDelta)}
                    </div>
                    <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.65rem", color: "var(--text-dim)" }}>MoM</div>
                  </div>
                )}

                {/* Monthly sparkline */}
                {tnpsByMonth.length > 1 && (
                  <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height: 36 }}>
                    {tnpsByMonth.map((m, i) => {
                      const maxScore = Math.max(...tnpsByMonth.map(x => Math.abs(x.score || 0)), 1);
                      const h = Math.max(4, (Math.abs(m.score || 0) / maxScore) * 32);
                      return (
                        <div key={i} style={{ width: 12, height: h, borderRadius: 3, background: tnpsColor(m.score) + "cc" }} title={`${m.label}: ${m.score > 0 ? "+" : ""}${m.score} (${m.total} surveys)`} />
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          );
        })()}

        {/* tNPS Campaign Overview — table below KPI strip */}
        {tnpsOverall && tnpsOverall.total > 0 && (() => {
          const campGroups = {};
          tnpsFiscalGCS.forEach(s => {
            const key = s.campaign;
            if (!campGroups[key]) campGroups[key] = { campaign: key, program: s.program, surveys: [] };
            campGroups[key].surveys.push(s);
          });
          const camps = Object.values(campGroups)
            .map(g => ({ ...g, ...calcTnpsScore(g.surveys) }))
            .sort((a, b) => (b.score ?? -999) - (a.score ?? -999));
          if (camps.length === 0) return null;
          return (
            <div onClick={() => goToSlide(tnpsSlideIdx)}
              style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg, 16px)", padding: "1rem 1.5rem", marginTop: "0.75rem", cursor: "pointer" }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = "#d97706"; e.currentTarget.style.boxShadow = "0 0 12px #d9770620"; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = "var(--border)"; e.currentTarget.style.boxShadow = "none"; }}>
              <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.72rem", letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: "0.5rem" }}>tNPS by Campaign — GCS</div>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    {["Campaign", "Program", "tNPS", "Surveys", "Promoter %", "Detractor %"].map((h, i) => (
                      <th key={i} style={{ padding: "0.4rem 0.5rem", textAlign: i > 1 ? "right" : "left", fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.65rem", color: "var(--text-muted)", borderBottom: "1px solid var(--border)", fontWeight: 500, letterSpacing: "0.05em", textTransform: "uppercase" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {camps.map((c, i) => (
                    <tr key={i} style={{ borderBottom: "1px solid var(--bg-tertiary)" }}>
                      <td style={{ padding: "0.5rem", fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.82rem", color: "var(--text-warm)" }}>{c.campaign}</td>
                      <td style={{ padding: "0.5rem" }}>
                        {c.program && <span style={{ fontSize: "0.65rem", padding: "2px 5px", borderRadius: 3, background: "#d9770618", color: "#d97706", fontWeight: 600, fontFamily: "var(--font-ui, Inter, sans-serif)" }}>{c.program}</span>}
                      </td>
                      <td style={{ padding: "0.5rem", textAlign: "right", fontFamily: "var(--font-data, monospace)", fontSize: "0.9rem", fontWeight: 700, color: tnpsColor(c.score) }}>{c.score > 0 ? "+" : ""}{c.score}</td>
                      <td style={{ padding: "0.5rem", textAlign: "right", fontFamily: "var(--font-data, monospace)", fontSize: "0.8rem", color: "var(--text-secondary)" }}>{c.total}</td>
                      <td style={{ padding: "0.5rem", textAlign: "right", fontFamily: "var(--font-data, monospace)", fontSize: "0.8rem", color: "#16a34a" }}>{Math.round(c.promoterPct)}%</td>
                      <td style={{ padding: "0.5rem", textAlign: "right", fontFamily: "var(--font-data, monospace)", fontSize: "0.8rem", color: "#dc2626" }}>{Math.round(c.detractorPct)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        })()}

        {/* Wins + Opportunities from engine insights */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1.25rem" }}>
          <InsightCard type="win" insights={wins} aiEnabled={localAI} aiPromptData={localAI ? { jobType: "Business Wide", uniqueAgentCount, totalHours, totalGoals: globalGoals, gph: totalHours > 0 ? globalGoals / totalHours : 0, attainment: planTotal ? (globalGoals / planTotal) * 100 : null, planGoals: planTotal, actGoals: globalGoals, distUnique: {}, q1Agents: [], q4Agents: [], regions, healthScore: null, totalNewXI: globalNewXI, totalXmLines: globalXmLines, newHiresInProgram: [], fiscalInfo } : null} />
          <InsightCard type="opp" insights={opps} aiEnabled={localAI} aiPromptData={localAI ? { jobType: "Business Wide", uniqueAgentCount, totalHours, totalGoals: globalGoals, gph: totalHours > 0 ? globalGoals / totalHours : 0, attainment: planTotal ? (globalGoals / planTotal) * 100 : null, planGoals: planTotal, actGoals: globalGoals, distUnique: {}, q1Agents: [], q4Agents: [], regions, healthScore: null, totalNewXI: globalNewXI, totalXmLines: globalXmLines, newHiresInProgram: [], fiscalInfo } : null} />
        </div>

        {/* Priority Coaching — business-wide */}
        {globalQ4Priority.length > 0 && (
          <div style={{ background: `var(--bg-secondary)`, border: "1px solid var(--border)", borderRadius: "var(--radius-lg, 16px)", padding: "1.25rem" }}>
            <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.8rem", color: "#dc2626", letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: "0.35rem" }}>Priority Coaching — Business Wide</div>
            <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.82rem", color: `var(--text-dim)`, marginBottom: "0.9rem" }}>Zero sales {getMinHours()}+ hours all programs ranked by hours</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "0.5rem 1.5rem" }}>
              {globalQ4Priority.map((a, i) => (
                <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0.5rem 0", borderBottom: "1px solid var(--bg-tertiary)" }}>
                  <div>
                    <div style={{ color: `var(--text-warm)`, fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.88rem" }}>
                      {a.agentName}
                      {newHireSet.has(a.agentName) && <span style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.82rem", color: "var(--nh-color)", background: "var(--nh-bg)", padding: "0.05rem 0.25rem", borderRadius: "2px", marginLeft: "0.35rem" }}>NEW</span>}
                    </div>
                    <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.78rem", color: `var(--text-dim)` }}>{a.jobType} · {mbrSiteName(a.region)}</div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontFamily: "var(--font-display, Inter, sans-serif)", fontSize: "1.5rem", color: "#6366f1", fontWeight: 700 }}>{fmt(a.hours, 1)} hrs</div>
                    <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.8rem", color: "#dc2626" }}>0 sales</div>
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
          <DailyBreakdownPanel agents={agents.filter(a => !a.isSpanishCallback)} regions={regions} jobType="All Programs" sphGoal={null} programs={programs} goalLookup={goalLookup} priorAgents={priorAgents} />
        )}

        {/* ── TRENDS TAB ── */}
        {tab === "trends" && (
          <WeeklyTrendsPanel currentAgents={agents.filter(a => !a.isSpanishCallback)} priorAgents={priorAgents} fiscalInfo={fiscalInfo} goalLookup={goalLookup} programs={programs} />
        )}
      </div>

      <div style={{ borderTop: "1px solid var(--border)", padding: "0.9rem 2.5rem", display: "flex", justifyContent: "flex-end", background: `var(--bg-row-alt)` }}>
        <button onClick={() => onNav(1)}
          style={{ padding: "0.5rem 1.1rem", background: "transparent", border: "1px solid var(--text-faint)", borderRadius: "6px", color: `var(--text-secondary)`, fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.82rem", cursor: "pointer" }}>
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
  if (Math.abs(pct) < 2) return <span style={{ color: `var(--text-dim)`, fontSize: "0.82rem" }}>→</span>;
  return (
    <span style={{ color: delta > 0 ? "#16a34a" : "#dc2626", fontSize: "0.82rem", fontWeight: 700 }}>
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
    <div style={{ padding: "1rem", background: `var(--bg-primary)`, borderRadius: "var(--radius-md, 10px)", border: `1px solid ${color}22` }}>
      {/* Header row */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "0.6rem" }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            {isTop && <span style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.82rem", color: "#d97706", background: "#d9770618", border: "1px solid #d9770640", borderRadius: "3px", padding: "0.05rem 0.3rem" }}>TOP</span>}
            {isBot && <span style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.82rem", color: "#dc2626", background: "#dc262618", border: "1px solid #dc262640", borderRadius: "3px", padding: "0.05rem 0.3rem" }}>LAGGING</span>}
            <span style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "1.38rem", color: `var(--text-warm)` }}>{s.supervisor}</span>
          </div>
          <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.78rem", color: `var(--text-dim)`, marginTop: "0.15rem" }}>
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
            <div style={{ fontFamily: "var(--font-display, Inter, sans-serif)", fontSize: "2.25rem", color, fontWeight: 700, lineHeight: 1 }}>{s.gph.toFixed(3)}</div>
            <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.8rem", color: `var(--text-dim)` }}>GPH</div>
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
          <span key={q} style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.82rem", color: Q[q].color }}>
            {q}: {s.distU[q]}
          </span>
        ))}
        <span style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.82rem", color: "#d97706" }}>Q1 rate: {s.q1Rate.toFixed(0)}%</span>
      </div>

      {/* Weekly breakdown */}
      {hasDates && supWeeks.length > 0 && (
        <div style={{ display: "flex", gap: "0.75rem", overflowX: "auto", marginBottom: "0.6rem", paddingBottom: "0.25rem" }}>
          {[...supWeeks].reverse().map(w => (
              <div key={w.week} style={{ textAlign: "center" }}>
                <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.8rem", color: w.gph ? attainColor(sphGoal ? (w.gph/sphGoal)*100 : w.q1Rate) : `var(--text-faint)`, fontWeight: 600 }}>
                  {w.gph ? w.gph.toFixed(3) : "—"}
                </div>
                <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.78rem", color: `var(--text-muted)` }}>{weekLabel(w.week)}</div>
                <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.81rem", color: `var(--text-faint)` }}>{fmt(w.hours||0, 0)} hours</div>
              </div>
            ))}
          </div>
        )}

      {/* Attendance & consistency insights dropdown */}
      <div style={{ borderTop: "1px solid var(--bg-tertiary)", paddingTop: "0.5rem", marginBottom: "0.5rem" }}>
        <button onClick={() => setShowInsights(v => !v)}
          style={{ background: "transparent", border: "none", cursor: "pointer", display: "flex", alignItems: "center", gap: "0.4rem",
            fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.8rem", color: `var(--text-dim)`, padding: 0 }}>
          <span>{showInsights ? "▾" : "▸"}</span>
          Attendance &amp; Consistency Insights
        </button>
        {showInsights && (
          <div style={{ marginTop: "0.5rem", display: "flex", flexDirection: "column", gap: "0.3rem" }}>
            {insights.map((txt, i) => (
              <div key={i} style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.8rem", color: `var(--text-secondary)`,
                background: `var(--bg-secondary)`, borderRadius: "var(--radius-sm, 6px)", padding: "0.3rem 0.6rem",
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
            style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.8rem", padding: "0.2rem 0.5rem", borderRadius: "3px", cursor: "pointer",
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
      <div style={{ background: `var(--bg-secondary)`, border: "1px solid var(--border)", borderRadius: "var(--radius-lg, 16px)", padding: "2rem", textAlign: "center", color: `var(--text-faint)`, fontFamily: "var(--font-ui, Inter, sans-serif)" }}>
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
      <div style={{ background: `var(--bg-secondary)`, border: "1px solid var(--border)", borderRadius: "var(--radius-lg, 16px)", padding: "1.5rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "1.25rem" }}>
          <div>
            <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.82rem", color: `var(--text-muted)`, letterSpacing: "0.12em", textTransform: "uppercase" }}>Agent Daily Profile</div>
            <div style={{ fontFamily: "var(--font-display, Inter, sans-serif)", fontSize: "2.25rem", color: `var(--text-warm)`, fontWeight: 700 }}>{profile.agentName}</div>
            <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.82rem", color: `var(--text-dim)`, marginTop: "0.2rem" }}>{profile.supervisor} · {profile.jobType} · {profile.quartile}</div>
          </div>
          <button onClick={() => setSelectedAgent(null)}
            style={{ background: "transparent", border: "1px solid var(--text-faint)", borderRadius: "var(--radius-sm, 6px)", color: `var(--text-muted)`, fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.8rem", padding: "0.25rem 0.6rem", cursor: "pointer" }}>✕ close</button>
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
            <div key={c.label} style={{ background: `var(--bg-primary)`, borderRadius: "var(--radius-md, 10px)", padding: "0.5rem", textAlign: "center", border: `1px solid ${c.color}22` }}>
              <div style={{ fontFamily: "var(--font-display, Inter, sans-serif)", fontSize: "1.15rem", color: c.color, fontWeight: 700 }}>{c.value}</div>
              <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.9rem", color: `var(--text-dim)`, marginTop: "0.1rem" }}>{c.label}</div>
            </div>
          ))}
        </div>

        {/* Daily performance table — grouped by week */}
        <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.8rem", color: `var(--text-muted)`, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: "0.5rem" }}>
          Daily Performance Breakdown
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.85rem" }}>
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
                          <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.85rem", color: `var(--text-faint)`, letterSpacing: "0.08em", marginBottom: "0.5rem" }}>
                            WEEK DETAIL \u2014 Wk {wg.wk.slice(5)} ({wWorked.length} days worked)
                          </div>
                          {jobs.map(([jt, data]) => {
                            const agentList = Object.values(data.agents).sort((x, y) => y.hrs - x.hrs);
                            return (
                              <div key={jt} style={{ marginBottom: "0.6rem" }}>
                                <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.85rem", color: `var(--text-warm)`, marginBottom: "0.25rem" }}>
                                  <span style={{ fontWeight: 700 }}>{jt}</span>
                                  <span style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.9rem", color: `var(--text-dim)`, marginLeft: "0.75rem" }}>{agentList.length} agents <span style={{ display: "inline-block", width: "0.6em" }} /> {data.goals} sales <span style={{ display: "inline-block", width: "0.6em" }} /> {data.hrs.toFixed(1)} hrs <span style={{ display: "inline-block", width: "0.6em" }} /> {data.hrs > 0 ? (data.goals / data.hrs).toFixed(3) : "0"} GPH</span>
                                </div>
                                <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.88rem" }}>
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
                <div key={i} style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.8rem", color: "#d97706", background: "#d9770612", border: "1px solid #d9770630", borderRadius: "var(--radius-sm, 6px)", padding: "0.2rem 0.5rem" }}>
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
        <div style={{ background: `var(--bg-secondary)`, border: "1px solid var(--border)", borderRadius: "var(--radius-lg, 16px)", padding: "1.5rem" }}>
          <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.82rem", color: `var(--text-muted)`, letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: "1.1rem" }}>
            Weekly Trend — {jobType}
          </div>
          <div style={{ display: "flex", gap: "0.5rem", alignItems: "flex-end", minHeight: "96px" }}>
            {[...programWeekly].reverse().map(w => {
              const maxGph = Math.max(...programWeekly.map(x => x.gph || 0), 0.001);
              const barH   = w.gph ? Math.max(4, (w.gph / maxGph) * 80) : 2;
              const color  = sphGoal ? attainColor((w.gph || 0) / sphGoal * 100) : "#d97706";
              return (
                <div key={w.week} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: "0.25rem", justifyContent: "flex-end" }}>
                  <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.8rem", color }}>{w.gph ? w.gph.toFixed(3) : "—"}</div>
                  <div style={{ width: "100%", height: `${barH}px`, background: color, borderRadius: "3px 3px 0 0", opacity: 0.85 }} />
                  <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.82rem", color: `var(--text-dim)`, textAlign: "center" }}>{weekLabel(w.week)}</div>
                  <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.78rem", color: `var(--text-faint)`, textAlign: "center" }}>{fmt(w.hours||0,0)} hours</div>
                  <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.81rem", color: `var(--text-faint)` }}>{w.goals}G · {w.agentCount}A</div>
                </div>
              );
            })}
          </div>
          {sphGoal && <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.8rem", color: `var(--text-dim)`, marginTop: "0.5rem" }}>Goal: {sphGoal.toFixed(3)} GPH</div>}
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
                    border: `1px solid ${active ? (r === "All" ? `var(--text-muted)` : btnColor) : `var(--border)`}`, borderRadius: "var(--radius-sm, 6px)",
                    color: active ? (r === "All" ? `var(--text-muted)` : btnColor) : `var(--text-dim)`,
                    padding: "0.25rem 0.65rem", fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.85rem", cursor: "pointer", transition: "all 0.15s" }}>
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
                  style={{ padding: "0.9rem", borderRadius: "var(--radius-md, 10px)", background: regClr + "08", border: `1px solid ${regClr}30`, cursor: "pointer", transition: "all 0.15s" }}>
                  <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "1.25rem", color: regClr, fontWeight: 700, marginBottom: "0.3rem" }}>{reg}</div>
                  <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.9rem", color: `var(--text-dim)` }}>{rCount} agents</div>
                  <div style={{ fontFamily: "var(--font-display, Inter, sans-serif)", fontSize: "2rem", color: `var(--text-warm)`, fontWeight: 700, lineHeight: 1, margin: "0.3rem 0" }}>{rGph.toFixed(3)}</div>
                  <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.85rem", color: `var(--text-dim)` }}>GPH · {rGoals} sales · {fmt(rHrs, 0)} hrs</div>
                  <div style={{ display: "flex", gap: "0.4rem", marginTop: "0.3rem" }}>
                    {["Q1","Q2","Q3","Q4"].map(q => (
                      <span key={q} style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.85rem", color: Q[q].color }}>{q}:{rDistU[q]}</span>
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
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0.6rem 0.75rem", background: regClr + "10", border: `1px solid ${regClr}30`, borderRadius: "var(--radius-md, 10px)", marginBottom: "0.75rem" }}>
                    <div style={{ display: "flex", gap: "0.75rem", alignItems: "center" }}>
                      <span style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.92rem", color: regClr, fontWeight: 700 }}>{reg}</span>
                      <span style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.78rem", color: `var(--text-dim)` }}>{regAgentNames.size} agents · {regSups.length} sup{regSups.length !== 1 ? "s" : ""}</span>
                    </div>
                    <div style={{ display: "flex", gap: "1rem", fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.78rem" }}>
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

// ── Day-of-Week Analysis ──────────────────────────────────────────────────────
// Aggregates daily agent rows by weekday (Mon–Sat). Returns an array of
// { dow, dayNum, totalGoals, totalHours, gph, dayCount, avgGoals, avgHours }
// sorted Mon→Sat.  Pass two datasets to buildDOWComparison for MoM overlay.
function buildDOWAnalysis(agentRows) {
  const DOW_NAMES = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
  const buckets = {};
  DOW_NAMES.forEach((name, i) => { buckets[i] = { dow: name, dayNum: i, dates: new Set(), totalGoals: 0, totalHours: 0, totalHsd: 0, totalXm: 0 }; });
  agentRows.forEach(r => {
    if (!r.date) return;
    const dt = new Date(r.date + "T00:00:00");
    const dayNum = dt.getDay();
    if (dayNum === 0) return; // skip Sunday
    buckets[dayNum].dates.add(r.date);
    buckets[dayNum].totalGoals += r.goals || 0;
    buckets[dayNum].totalHours += r.hours || 0;
    buckets[dayNum].totalHsd   += r.newXI || 0;
    buckets[dayNum].totalXm    += r.xmLines || 0;
  });
  // Return Mon–Sat (dayNum 1–6), skip Sunday
  return [1,2,3,4,5,6].map(d => {
    const b = buckets[d];
    const dayCount = b.dates.size;
    return {
      dow: b.dow, dayNum: d, dayCount,
      totalGoals: b.totalGoals, totalHours: b.totalHours,
      totalHsd: b.totalHsd, totalXm: b.totalXm,
      gph: b.totalHours > 0 ? b.totalGoals / b.totalHours : 0,
      avgGoals: dayCount > 0 ? b.totalGoals / dayCount : 0,
      avgHours: dayCount > 0 ? b.totalHours / dayCount : 0,
      avgHsd: dayCount > 0 ? b.totalHsd / dayCount : 0,
    };
  });
}

function buildDOWComparison(currentAgents, priorAgents) {
  const cur = buildDOWAnalysis(currentAgents);
  const prev = buildDOWAnalysis(priorAgents);
  return cur.map((c, i) => ({
    ...c,
    prev: prev[i] || null,
    deltaGph: prev[i] ? c.gph - prev[i].gph : null,
    deltaAvgGoals: prev[i] ? c.avgGoals - prev[i].avgGoals : null,
    deltaAvgHours: prev[i] ? c.avgHours - prev[i].avgHours : null,
  }));
}

// ── Weekly Comparison Builder ─────────────────────────────────────────────────
// Aligns weeks by fiscal position (week 1 vs week 1) between current and prior
// month datasets. Each agent row has a weekNum field.
function buildWeeklyComparison(currentAgents, priorAgents) {
  const DOW = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
  const rollupByWeek = (rows) => {
    const map = {};
    rows.forEach(r => {
      if (!r.weekNum || r.isSpanishCallback) return;
      if (!map[r.weekNum]) map[r.weekNum] = { goals: 0, hours: 0, hsd: 0, xm: 0, agents: new Set(), dates: new Set(), daily: {} };
      map[r.weekNum].goals += r.goals || 0;
      map[r.weekNum].hours += r.hours || 0;
      map[r.weekNum].hsd   += r.newXI || 0;
      map[r.weekNum].xm    += r.xmLines || 0;
      if (r.agentName) map[r.weekNum].agents.add(r.agentName);
      if (r.date) {
        map[r.weekNum].dates.add(r.date);
        if (!map[r.weekNum].daily[r.date]) map[r.weekNum].daily[r.date] = { goals: 0, hours: 0, hsd: 0, xm: 0, agents: new Set() };
        const dd = map[r.weekNum].daily[r.date];
        dd.goals += r.goals || 0; dd.hours += r.hours || 0;
        dd.hsd += r.newXI || 0; dd.xm += r.xmLines || 0;
        if (r.agentName) dd.agents.add(r.agentName);
      }
    });
    const sorted = Object.entries(map).sort((a, b) => {
      const aMin = [...a[1].dates].sort()[0] || "";
      const bMin = [...b[1].dates].sort()[0] || "";
      return aMin.localeCompare(bMin);
    });
    return sorted.map(([wk, d]) => ({
      weekNum: wk,
      goals: d.goals, hours: d.hours, hsd: d.hsd, xm: d.xm,
      agentCount: d.agents.size,
      gph: d.hours > 0 ? d.goals / d.hours : 0,
      dayCount: d.dates.size,
      dateRange: [...d.dates].sort(),
      daily: Object.entries(d.daily).sort(([a],[b]) => a.localeCompare(b)).map(([date, dd]) => {
        const dt = new Date(date + "T00:00:00");
        return { date, dow: DOW[dt.getDay()], goals: dd.goals, hours: dd.hours, hsd: dd.hsd, xm: dd.xm, agentCount: dd.agents.size, gph: dd.hours > 0 ? dd.goals / dd.hours : 0 };
      }),
    }));
  };

  const curWeeks = rollupByWeek(currentAgents);
  const prevWeeks = rollupByWeek(priorAgents);
  const maxLen = Math.max(curWeeks.length, prevWeeks.length);
  const result = [];
  for (let i = 0; i < maxLen; i++) {
    const c = curWeeks[i] || null;
    const p = prevWeeks[i] || null;

    // Build DOW-matched prior totals: only sum prior days whose DOW exists in current week
    let prevMatched = null;
    if (c && p && p.daily && p.daily.length > 0) {
      const curDows = new Set((c.daily || []).map(d => d.dow));
      const matched = p.daily.filter(d => curDows.has(d.dow));
      if (matched.length > 0 && matched.length < p.daily.length) {
        const mGoals = matched.reduce((s, d) => s + d.goals, 0);
        const mHours = matched.reduce((s, d) => s + d.hours, 0);
        prevMatched = {
          goals: mGoals, hours: mHours,
          hsd: matched.reduce((s, d) => s + d.hsd, 0),
          xm: matched.reduce((s, d) => s + d.xm, 0),
          gph: mHours > 0 ? mGoals / mHours : 0,
          dayCount: matched.length,
          agentCount: Math.max(...matched.map(d => d.agentCount)),
        };
      }
      // If all prior DOWs match (same day count), prevMatched stays null — use full prev
    }

    result.push({
      position: i + 1,
      cur: c,
      prev: p,
      prevMatched, // null when full prior is already comparable, or subset totals
      deltaGoals: c && p ? c.goals - p.goals : null,
      deltaHours: c && p ? c.hours - p.hours : null,
      deltaGph: c && p ? c.gph - p.gph : null,
      deltaAgents: c && p ? c.agentCount - p.agentCount : null,
    });
  }
  return result;
}

// ── DOWCards Component ────────────────────────────────────────────────────────
// Compact weekday performance cards with optional prior month overlay.
function DOWCards({ agents, priorAgents, label }) {
  const [showPrior, setShowPrior] = useState(false);
  const hasPrior = priorAgents && priorAgents.length > 0;
  const data = useMemo(() => hasPrior ? buildDOWComparison(agents, priorAgents) : buildDOWAnalysis(agents), [agents, priorAgents]);
  if (!data || data.length === 0) return null;

  // Find best/worst by avgGoals (only days with data)
  const withData = (Array.isArray(data) ? data : []).filter(d => d.dayCount > 0);
  if (withData.length === 0) return null;
  const bestDay = withData.reduce((a, b) => a.avgGoals > b.avgGoals ? a : b);
  const worstDay = withData.reduce((a, b) => a.avgGoals < b.avgGoals ? a : b);

  const maxAvgGoals = Math.max(...withData.map(d => d.avgGoals));

  const fmtDelta = (val) => {
    if (val === null || val === undefined) return null;
    const sign = val > 0 ? "+" : "";
    return `${sign}${val.toFixed(1)}`;
  };

  return (
    <div style={{ background: `var(--bg-secondary)`, border: "1px solid var(--border)", borderRadius: "var(--radius-lg, 16px)", padding: "1.25rem 1.5rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem" }}>
        <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.82rem", color: `var(--text-muted)`, letterSpacing: "0.12em", textTransform: "uppercase" }}>
          Day-of-Week Performance {label ? `— ${label}` : ""}
        </div>
        {hasPrior && (
          <button onClick={() => setShowPrior(!showPrior)}
            style={{ padding: "0.25rem 0.6rem", borderRadius: "var(--radius-sm, 6px)", border: `1px solid ${showPrior ? "#8b5cf6" : "var(--border-muted)"}`, background: showPrior ? "#8b5cf612" : "transparent", color: showPrior ? "#8b5cf6" : `var(--text-dim)`, fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.75rem", cursor: "pointer", transition: "all 0.15s" }}>
            {showPrior ? "Hide Prior Month" : "Compare Prior Month"}
          </button>
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: "0.5rem" }}>
        {data.map(d => {
          const strength = maxAvgGoals > 0 ? d.avgGoals / maxAvgGoals : 0;
          const isBest = d === bestDay;
          const isWorst = d === worstDay;
          const barColor = isBest ? "#16a34a" : isWorst ? "#dc2626" : "#d97706";
          const borderClr = isBest ? "#16a34a40" : isWorst ? "#dc262640" : "var(--border)";

          return (
            <div key={d.dow} style={{ background: `var(--bg-tertiary)`, border: `1px solid ${borderClr}`, borderRadius: "var(--radius-md, 10px)", padding: "0.75rem 0.5rem", textAlign: "center", position: "relative", overflow: "hidden" }}>
              {/* Strength bar at bottom */}
              <div style={{ position: "absolute", bottom: 0, left: 0, width: "100%", height: "3px", background: "var(--border)" }}>
                <div style={{ width: `${Math.round(strength * 100)}%`, height: "100%", background: barColor, transition: "width 0.4s ease" }} />
              </div>

              <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.88rem", color: isBest ? "#16a34a" : isWorst ? "#dc2626" : `var(--text-primary)`, fontWeight: 700, marginBottom: "0.35rem" }}>{d.dow}</div>
              <div style={{ fontFamily: "var(--font-display, Inter, sans-serif)", fontSize: "1.35rem", color: `var(--text-warm)`, fontWeight: 700, lineHeight: 1 }}>{Math.round(d.avgGoals)}</div>
              <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.68rem", color: `var(--text-faint)`, marginTop: "0.15rem" }}>avg goals/day</div>

              <div style={{ display: "flex", justifyContent: "center", gap: "0.5rem", marginTop: "0.35rem" }}>
                <div>
                  <div style={{ fontFamily: "var(--font-data, monospace)", fontSize: "0.82rem", color: `var(--text-secondary)`, fontWeight: 600 }}>{d.gph.toFixed(3)}</div>
                  <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.6rem", color: `var(--text-faint)` }}>GPH</div>
                </div>
                <div>
                  <div style={{ fontFamily: "var(--font-data, monospace)", fontSize: "0.82rem", color: `var(--text-secondary)`, fontWeight: 600 }}>{Math.round(d.avgHours)}</div>
                  <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.6rem", color: `var(--text-faint)` }}>avg hrs</div>
                </div>
              </div>

              {d.dayCount > 0 && (
                <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.62rem", color: `var(--text-faint)`, marginTop: "0.25rem" }}>{d.dayCount} day{d.dayCount > 1 ? "s" : ""}</div>
              )}

              {/* Prior month overlay */}
              {showPrior && d.prev && d.prev.dayCount > 0 && (
                <div style={{ marginTop: "0.4rem", paddingTop: "0.35rem", borderTop: "1px dashed #8b5cf630" }}>
                  <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.62rem", color: "#8b5cf6", letterSpacing: "0.05em", textTransform: "uppercase", marginBottom: "0.15rem" }}>Prior</div>
                  <div style={{ fontFamily: "var(--font-data, monospace)", fontSize: "0.78rem", color: "#8b5cf6" }}>{Math.round(d.prev.avgGoals)} goals</div>
                  <div style={{ fontFamily: "var(--font-data, monospace)", fontSize: "0.72rem", color: "#8b5cf6" }}>{d.prev.gph.toFixed(3)} GPH</div>
                  {d.deltaAvgGoals !== null && (
                    <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.68rem", color: d.deltaAvgGoals >= 0 ? "#16a34a" : "#dc2626", marginTop: "0.1rem" }}>
                      {fmtDelta(d.deltaAvgGoals)} goals/day
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Insight line */}
      <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.78rem", color: `var(--text-dim)`, marginTop: "0.65rem", lineHeight: 1.4 }}>
        <span style={{ color: "#16a34a", fontWeight: 600 }}>{bestDay.dow}s</span> are the strongest day (avg {Math.round(bestDay.avgGoals)} goals, {bestDay.gph.toFixed(3)} GPH)
        {worstDay !== bestDay && (
          <span> while <span style={{ color: "#dc2626", fontWeight: 600 }}>{worstDay.dow}s</span> lag (avg {Math.round(worstDay.avgGoals)} goals, {worstDay.gph.toFixed(3)} GPH)</span>
        )}
      </div>
    </div>
  );
}

// ── WeeklyTrendsPanel ─────────────────────────────────────────────────────────
// Week-by-week comparison with expandable daily detail, site/campaign breakouts.
function WeeklyTrendsPanel({ currentAgents, priorAgents, fiscalInfo, goalLookup, programs }) {
  const [siteFilter, setSiteFilter] = useState("ALL");
  const [programFilter, setProgramFilter] = useState("All");
  const [expandedWeek, setExpandedWeek] = useState(null); // week position number

  const hasPrior = priorAgents && priorAgents.length > 0;

  const siteList = useMemo(() => {
    const regs = [...new Set(currentAgents.map(a => a.region).filter(Boolean))].sort();
    const bz = regs.filter(r => r.toUpperCase().includes("XOTM"));
    const dr = regs.filter(r => !r.toUpperCase().includes("XOTM"));
    const sites = ["ALL"];
    if (dr.length > 0) sites.push("DR");
    if (bz.length > 0) sites.push("BZ");
    regs.forEach(r => sites.push(r));
    return sites;
  }, [currentAgents]);

  const programList = useMemo(() => {
    const jts = [...new Set(currentAgents.filter(a => !a.isSpanishCallback).map(a => a.jobType).filter(Boolean))].sort();
    return ["All", ...jts];
  }, [currentAgents]);

  const filterAgents = useCallback((agents) => {
    let filtered = agents;
    if (programFilter !== "All") filtered = filtered.filter(a => a.jobType === programFilter);
    else filtered = filtered.filter(a => !a.isSpanishCallback);
    if (siteFilter !== "ALL") {
      if (siteFilter === "DR") filtered = filtered.filter(a => !(a.region || "").toUpperCase().includes("XOTM"));
      else if (siteFilter === "BZ") filtered = filtered.filter(a => (a.region || "").toUpperCase().includes("XOTM"));
      else filtered = filtered.filter(a => a.region === siteFilter);
    }
    return filtered;
  }, [siteFilter, programFilter]);

  const filteredCur = useMemo(() => filterAgents(currentAgents), [currentAgents, filterAgents]);
  const filteredPrev = useMemo(() => filterAgents(priorAgents || []), [priorAgents, filterAgents]);
  const weeks = useMemo(() => buildWeeklyComparison(filteredCur, filteredPrev), [filteredCur, filteredPrev]);

  if (!weeks || weeks.length === 0) return (
    <div style={{ background: `var(--bg-secondary)`, border: "1px solid var(--border)", borderRadius: "var(--radius-lg, 16px)", padding: "2rem", textAlign: "center", color: `var(--text-faint)`, fontFamily: "var(--font-ui, Inter, sans-serif)" }}>
      No weekly data available. Ensure agent rows have a Week Number field.
    </div>
  );

  const fmtDelta = (val, dec = 0) => {
    if (val === null || val === undefined) return "";
    const sign = val > 0 ? "+" : "";
    return `${sign}${dec > 0 ? val.toFixed(dec) : Math.round(val).toLocaleString()}`;
  };
  const deltaColor = (val) => !val ? `var(--text-faint)` : val > 0 ? "#16a34a" : val < 0 ? "#dc2626" : `var(--text-dim)`;

  const curTotals = weeks.reduce((acc, w) => {
    if (w.cur) { acc.goals += w.cur.goals; acc.hours += w.cur.hours; acc.hsd += w.cur.hsd; acc.xm += w.cur.xm; acc.days += w.cur.dayCount; }
    return acc;
  }, { goals: 0, hours: 0, hsd: 0, xm: 0, days: 0 });
  const prevTotals = weeks.reduce((acc, w) => {
    if (w.prev) { acc.goals += w.prev.goals; acc.hours += w.prev.hours; acc.hsd += w.prev.hsd; acc.xm += w.prev.xm; acc.days += w.prev.dayCount; }
    return acc;
  }, { goals: 0, hours: 0, hsd: 0, xm: 0, days: 0 });

  const cellBase = { fontFamily: "var(--font-data, monospace)", fontSize: "0.82rem", padding: "0.5rem 0.6rem", borderBottom: "1px solid var(--border)", textAlign: "right" };
  const headerBase = { fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.7rem", color: `var(--text-muted)`, letterSpacing: "0.06em", textTransform: "uppercase", padding: "0.45rem 0.6rem", borderBottom: "2px solid var(--border)", textAlign: "right", whiteSpace: "nowrap" };
  const filterBtnStyle = (active, color) => ({ padding: "0.25rem 0.65rem", borderRadius: "var(--radius-sm, 6px)", border: `1px solid ${active ? color : "var(--border-muted)"}`, background: active ? color + "14" : "transparent", color: active ? color : `var(--text-dim)`, fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.78rem", cursor: "pointer", transition: "all 0.15s" });
  const groupBorder = "2px solid var(--border)";

  // Metric column definitions
  const metrics = [
    { key: "goals", label: "Goals", color: "#d97706",
      val: (d) => d.goals.toLocaleString(),
      delta: (c, p) => c.goals - p.goals,
      totCur: curTotals.goals.toLocaleString(), totPrev: prevTotals.goals.toLocaleString(),
      totDelta: curTotals.goals - prevTotals.goals },
    { key: "hours", label: "Hours", color: "#6366f1",
      val: (d) => Math.round(d.hours).toLocaleString(),
      delta: (c, p) => Math.round(c.hours - p.hours),
      totCur: Math.round(curTotals.hours).toLocaleString(), totPrev: Math.round(prevTotals.hours).toLocaleString(),
      totDelta: Math.round(curTotals.hours - prevTotals.hours) },
    { key: "gph", label: "GPH", color: "#16a34a",
      val: (d) => d.gph.toFixed(3),
      delta: (c, p) => c.gph - p.gph,
      fmtD: (v) => v !== null ? (v > 0 ? "+" : "") + v.toFixed(3) : "",
      totCur: curTotals.hours > 0 ? (curTotals.goals / curTotals.hours).toFixed(3) : "–",
      totPrev: prevTotals.hours > 0 ? (prevTotals.goals / prevTotals.hours).toFixed(3) : "–",
      totDelta: (curTotals.hours > 0 && prevTotals.hours > 0) ? (curTotals.goals / curTotals.hours) - (prevTotals.goals / prevTotals.hours) : null },
    { key: "hsd", label: "HSD", color: "#f59e0b",
      val: (d) => d.hsd.toLocaleString(),
      delta: (c, p) => c.hsd - p.hsd,
      totCur: curTotals.hsd.toLocaleString(), totPrev: prevTotals.hsd.toLocaleString(),
      totDelta: curTotals.hsd - prevTotals.hsd },
    { key: "xm", label: "XM", color: "#ec4899",
      val: (d) => d.xm.toLocaleString(),
      delta: (c, p) => c.xm - p.xm,
      totCur: curTotals.xm.toLocaleString(), totPrev: prevTotals.xm.toLocaleString(),
      totDelta: curTotals.xm - prevTotals.xm },
  ];
  const colsPerMetric = hasPrior ? 3 : 1;
  const totalCols = 3 + metrics.length * colsPerMetric;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
      {!hasPrior && (
        <div style={{ background: "#6366f110", border: "1px solid #6366f140", borderLeft: "4px solid #6366f1", borderRadius: "var(--radius-md, 10px)", padding: "0.75rem 1rem", display: "flex", alignItems: "center", gap: "0.75rem" }}>
          <span style={{ fontSize: "1rem" }}>📊</span>
          <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.82rem", color: `var(--text-secondary)` }}>
            Load prior month data to unlock week-over-week comparisons. Navigate to the Campaign Comparison slide to upload.
          </div>
        </div>
      )}

      {/* Filters */}
      <div style={{ background: `var(--bg-secondary)`, border: "1px solid var(--border)", borderRadius: "var(--radius-lg, 16px)", padding: "1rem 1.5rem" }}>
        <div style={{ display: "flex", gap: "1.5rem", flexWrap: "wrap", alignItems: "flex-start" }}>
          <div>
            <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.7rem", color: `var(--text-faint)`, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: "0.3rem" }}>Site</div>
            <div style={{ display: "flex", gap: "0.3rem", flexWrap: "wrap" }}>
              {siteList.map(s => {
                return <button key={s} onClick={() => setSiteFilter(s)} style={filterBtnStyle(siteFilter === s, "#6366f1")}>{mbrSiteName(s)}</button>;
              })}
            </div>
          </div>
          <div>
            <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.7rem", color: `var(--text-faint)`, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: "0.3rem" }}>Campaign</div>
            <div style={{ display: "flex", gap: "0.3rem", flexWrap: "wrap" }}>
              {programList.map(p => (
                <button key={p} onClick={() => setProgramFilter(p)} style={filterBtnStyle(programFilter === p, "#d97706")}>{p}</button>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div style={{ background: `var(--bg-secondary)`, border: "1px solid var(--border)", borderRadius: "var(--radius-lg, 16px)", padding: "1.25rem 1.5rem" }}>
        <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.82rem", color: `var(--text-muted)`, letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: "0.75rem" }}>
          Week-by-Week Performance {hasPrior ? "— Current vs Prior Month" : "— Current Month"}
          {siteFilter !== "ALL" && <span style={{ color: "#6366f1", marginLeft: "0.5rem" }}>({siteFilter})</span>}
          {programFilter !== "All" && <span style={{ color: "#d97706", marginLeft: "0.5rem" }}>({programFilter})</span>}
        </div>

        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th colSpan={3} style={{ ...headerBase, textAlign: "left", borderBottom: "1px solid var(--border)" }}></th>
                {metrics.map(m => (
                  <th key={m.key} colSpan={colsPerMetric}
                    style={{ ...headerBase, textAlign: "center", color: m.color, fontWeight: 700, fontSize: "0.78rem",
                      borderLeft: groupBorder, borderBottom: "1px solid var(--border)", background: m.color + "08" }}>
                    {m.label}
                  </th>
                ))}
              </tr>
              <tr style={{ background: `var(--bg-tertiary)` }}>
                <th style={{ ...headerBase, textAlign: "left" }}>Week</th>
                <th style={headerBase}>Days</th>
                <th style={headerBase}>Agents</th>
                {metrics.map(m => (
                  <React.Fragment key={m.key}>
                    <th style={{ ...headerBase, borderLeft: groupBorder, color: `var(--text-secondary)` }}>Cur</th>
                    {hasPrior && <th style={{ ...headerBase, color: "#8b5cf6", background: "#8b5cf608" }}>Prior</th>}
                    {hasPrior && <th style={{ ...headerBase, color: `var(--text-muted)` }}>{"\u0394"}</th>}
                  </React.Fragment>
                ))}
              </tr>
            </thead>
            <tbody>
              {weeks.flatMap((w, i) => {
                const curLabel = w.cur && w.cur.dateRange.length > 0
                  ? `${w.cur.dateRange[0].slice(5)} – ${w.cur.dateRange[w.cur.dateRange.length - 1].slice(5)}` : "";
                const prevLabel = w.prev && w.prev.dateRange.length > 0
                  ? `${w.prev.dateRange[0].slice(5)} – ${w.prev.dateRange[w.prev.dateRange.length - 1].slice(5)}` : "";
                const isExpanded = expandedWeek === w.position;
                const rows = [];

                // Use DOW-matched prior when current week is partial (fewer days than prior)
                // This makes the summary row compare same days: if cur has Mon+Tue, prior only shows Mon+Tue
                const pDisp = w.prevMatched || w.prev; // matched subset or full prior
                const isMatched = !!w.prevMatched;
                const pDayLabel = pDisp ? pDisp.dayCount : (w.prev?.dayCount || 0);

                // Week summary row (clickable)
                rows.push(
                  <tr key={`wk-${i}`} onClick={() => setExpandedWeek(isExpanded ? null : w.position)}
                    style={{ background: i % 2 === 0 ? "transparent" : `var(--bg-row-alt)`, cursor: "pointer", transition: "background 0.15s" }}>
                    <td style={{ ...cellBase, textAlign: "left", color: `var(--text-primary)`, fontWeight: 600 }}>
                      <div>
                        <span style={{ color: isExpanded ? "#d97706" : `var(--text-dim)`, marginRight: "0.35rem", fontSize: "0.72rem" }}>{isExpanded ? "\u25BC" : "\u25B6"}</span>
                        Wk {w.position} {w.cur ? `(${w.cur.weekNum})` : ""}
                      </div>
                      <div style={{ fontSize: "0.68rem", color: `var(--text-faint)`, fontWeight: 400, marginLeft: "1rem" }}>
                        {curLabel}{hasPrior && prevLabel ? ` / ${prevLabel}` : ""}
                        {isMatched && <span style={{ color: "#8b5cf6", marginLeft: "0.35rem" }}>(prior matched to {pDayLabel}d)</span>}
                      </div>
                    </td>
                    <td style={{ ...cellBase, color: `var(--text-dim)` }}>
                      {w.cur?.dayCount || "–"}{hasPrior && w.prev ? `/${w.prev.dayCount}` : ""}
                    </td>
                    <td style={{ ...cellBase, color: `var(--text-dim)` }}>
                      {w.cur?.agentCount || "–"}
                      {hasPrior && pDisp && (
                        <span style={{ fontSize: "0.7rem", color: `var(--text-faint)`, marginLeft: "0.25rem" }}>/{pDisp.agentCount || "–"}</span>
                      )}
                    </td>
                    {metrics.map(m => {
                      const d = (w.cur && pDisp) ? m.delta(w.cur, pDisp) : null;
                      const fmtDV = m.fmtD ? m.fmtD(d) : (d !== null ? fmtDelta(d) : "");
                      return (
                        <React.Fragment key={m.key}>
                          <td style={{ ...cellBase, borderLeft: groupBorder, color: `var(--text-warm)`, fontWeight: 600 }}>{w.cur ? m.val(w.cur) : "–"}</td>
                          {hasPrior && <td style={{ ...cellBase, color: "#8b5cf6", background: "#8b5cf605" }}>{pDisp ? m.val(pDisp) : "–"}</td>}
                          {hasPrior && <td style={{ ...cellBase, color: deltaColor(d), fontWeight: 600, fontSize: "0.78rem" }}>{fmtDV}</td>}
                        </React.Fragment>
                      );
                    })}
                  </tr>
                );

                // Expanded daily detail rows
                if (isExpanded && w.cur) {
                  const curDaily = w.cur.daily || [];
                  const prevDaily = w.prev ? (w.prev.daily || []) : [];
                  // Build prior lookup by DOW for side-by-side
                  const prevByDow = {};
                  prevDaily.forEach(d => { prevByDow[d.dow] = d; });

                  curDaily.forEach((day, di) => {
                    const pd = prevByDow[day.dow] || null;
                    rows.push(
                      <tr key={`day-${i}-${di}`} style={{ background: "#d9770606" }}>
                        <td style={{ ...cellBase, textAlign: "left", paddingLeft: "2rem", color: `var(--text-secondary)`, fontSize: "0.78rem" }}>
                          <span style={{ fontWeight: 600, color: `var(--text-muted)`, display: "inline-block", width: "2.5rem" }}>{day.dow}</span>
                          <span style={{ color: `var(--text-faint)` }}>{day.date.slice(5)}</span>
                          {pd && <span style={{ color: "#8b5cf6", marginLeft: "0.5rem", fontSize: "0.7rem" }}>/ {pd.date.slice(5)}</span>}
                        </td>
                        <td style={{ ...cellBase, color: `var(--text-faint)`, fontSize: "0.78rem" }}>1{pd ? "/1" : ""}</td>
                        <td style={{ ...cellBase, color: `var(--text-faint)`, fontSize: "0.78rem" }}>
                          {day.agentCount}
                          {pd && <span style={{ color: "#8b5cf6", marginLeft: "0.2rem", fontSize: "0.68rem" }}>/{pd.agentCount}</span>}
                        </td>
                        {metrics.map(m => {
                          const d = pd ? m.delta(day, pd) : null;
                          const fmtDV = m.fmtD ? m.fmtD(d) : (d !== null ? fmtDelta(d) : "");
                          return (
                            <React.Fragment key={m.key}>
                              <td style={{ ...cellBase, borderLeft: groupBorder, color: `var(--text-secondary)`, fontSize: "0.78rem" }}>{m.val(day)}</td>
                              {hasPrior && <td style={{ ...cellBase, color: "#8b5cf6", background: "#8b5cf605", fontSize: "0.78rem" }}>{pd ? m.val(pd) : "–"}</td>}
                              {hasPrior && <td style={{ ...cellBase, color: deltaColor(d), fontSize: "0.72rem" }}>{fmtDV}</td>}
                            </React.Fragment>
                          );
                        })}
                      </tr>
                    );
                  });
                  // Show prior-only days not matched to current DOW
                  if (hasPrior) {
                    const curDows = new Set(curDaily.map(d => d.dow));
                    prevDaily.filter(d => !curDows.has(d.dow)).forEach((pd, pi) => {
                      rows.push(
                        <tr key={`pday-${i}-${pi}`} style={{ background: "#8b5cf606" }}>
                          <td style={{ ...cellBase, textAlign: "left", paddingLeft: "2rem", color: "#8b5cf6", fontSize: "0.78rem" }}>
                            <span style={{ fontWeight: 600, display: "inline-block", width: "2.5rem" }}>{pd.dow}</span>
                            <span style={{ color: `var(--text-faint)` }}>–</span>
                            <span style={{ color: "#8b5cf6", marginLeft: "0.5rem", fontSize: "0.7rem" }}>/ {pd.date.slice(5)}</span>
                          </td>
                          <td style={{ ...cellBase, color: `var(--text-faint)`, fontSize: "0.78rem" }}>0/1</td>
                          <td style={{ ...cellBase, color: "#8b5cf6", fontSize: "0.78rem" }}>–/{pd.agentCount}</td>
                          {metrics.map(m => (
                            <React.Fragment key={m.key}>
                              <td style={{ ...cellBase, borderLeft: groupBorder, color: `var(--text-faint)`, fontSize: "0.78rem" }}>–</td>
                              <td style={{ ...cellBase, color: "#8b5cf6", background: "#8b5cf605", fontSize: "0.78rem" }}>{m.val(pd)}</td>
                              <td style={{ ...cellBase, color: `var(--text-faint)`, fontSize: "0.72rem" }}></td>
                            </React.Fragment>
                          ))}
                        </tr>
                      );
                    });
                  }
                }

                return rows;
              })}
              {/* Totals row */}
              <tr style={{ borderTop: "2px solid var(--border)", background: `var(--bg-tertiary)` }}>
                <td style={{ ...cellBase, textAlign: "left", fontWeight: 700, color: `var(--text-primary)` }}>Total</td>
                <td style={{ ...cellBase, fontWeight: 600 }}>{curTotals.days}{hasPrior ? `/${prevTotals.days}` : ""}</td>
                <td style={cellBase}></td>
                {metrics.map(m => {
                  const fmtDV = m.fmtD ? m.fmtD(m.totDelta) : (m.totDelta !== null ? fmtDelta(m.totDelta) : "");
                  return (
                    <React.Fragment key={m.key}>
                      <td style={{ ...cellBase, borderLeft: groupBorder, color: `var(--text-warm)`, fontWeight: 700 }}>{m.totCur}</td>
                      {hasPrior && <td style={{ ...cellBase, color: "#8b5cf6", fontWeight: 700, background: "#8b5cf605" }}>{m.totPrev}</td>}
                      {hasPrior && <td style={{ ...cellBase, color: deltaColor(m.totDelta), fontWeight: 700 }}>{fmtDV}</td>}
                    </React.Fragment>
                  );
                })}
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* SPH % to Goal — Weekly Trend by Program */}
      {goalLookup && programs ? (() => {
        // Week colors for bars
        const weekColors = ["#d97706", "#2563eb", "#16a34a", "#7c3aed", "#ec4899", "#f59e0b", "#06b6d4", "#ef4444"];

        // Filter programs by site availability and campaign filter
        const filteredProgs = programs.filter(p => {
          if (programFilter !== "All" && p.jobType !== programFilter) return false;
          if (!p.goalEntry) return false;
          // Check if program has agents matching site filter
          const hasMatchingSite = p.agents.some(a => {
            if (siteFilter === "ALL") return true;
            if (siteFilter === "BZ") return (a.region || "").toUpperCase().includes("XOTM");
            if (siteFilter === "DR") return !(a.region || "").toUpperCase().includes("XOTM");
            return a.region === siteFilter;
          });
          return hasMatchingSite;
        });

        // Determine which sites to show as separate bars
        const siteColors = { "Belize City-XOTM": "#16a34a", "SD-Xfinity": "#2563eb", "San Ignacio-XOTM": "#7c3aed" };
        const siteLabels = { "Belize City-XOTM": "Belize City", "SD-Xfinity": "Dom. Republic", "San Ignacio-XOTM": "San Ignacio" };
        const showSiteBars = siteFilter === "ALL" || siteFilter === "BZ";

        // Build chart data: per-program, per-week, optionally per-site
        const chartData = filteredProgs.map(p => {
          const planRows = uniqueRowsFromEntry(p.goalEntry);
          const sphVals = planRows.map(r => parseNum(findCol(r, "SPH GOAL", "SPH Goal", "Sph Goal"))).filter(v => v > 0);
          const sphGoal = sphVals.length > 0 ? sphVals.reduce((s, v) => s + v, 0) / sphVals.length : null;
          if (!sphGoal) return null;

          // Filter agents by site filter
          const siteAgents = p.agents.filter(a => {
            if (siteFilter === "ALL") return true;
            if (siteFilter === "BZ") return (a.region || "").toUpperCase().includes("XOTM");
            if (siteFilter === "DR") return !(a.region || "").toUpperCase().includes("XOTM");
            return a.region === siteFilter;
          });

          if (showSiteBars) {
            // Group by weekNum → region
            const weekSiteMap = {};
            siteAgents.forEach(a => {
              const wk = a.weekNum || "";
              const reg = a.region || "";
              if (!wk || !reg) return;
              const key = `${wk}|${reg}`;
              if (!weekSiteMap[key]) weekSiteMap[key] = { hours: 0, goals: 0, weekNum: wk, region: reg, dates: new Set() };
              weekSiteMap[key].hours += a.hours;
              weekSiteMap[key].goals += a.goals;
              if (a.date) weekSiteMap[key].dates.add(a.date);
            });

            // Get sorted weeks
            const weekNums = [...new Set(Object.values(weekSiteMap).map(e => e.weekNum))].sort((a, b) => parseInt(a) - parseInt(b));
            // Get sorted regions
            const regions = [...new Set(Object.values(weekSiteMap).map(e => e.region))].sort();

            // Build week groups: each week has bars per region
            const weekGroups = weekNums.map(wk => {
              const bars = regions.map(reg => {
                const entry = weekSiteMap[`${wk}|${reg}`];
                if (!entry || entry.hours < 10) return null;
                const sph = entry.goals / entry.hours;
                const pctToGoal = (sph / sphGoal) * 100;
                return { region: reg, sph, pctToGoal, hours: entry.hours, goals: entry.goals };
              }).filter(Boolean);
              if (bars.length === 0) return null;
              const sortedDates = [...new Set(Object.values(weekSiteMap).filter(e => e.weekNum === wk).flatMap(e => [...e.dates]))].sort();
              const dateLabel = sortedDates.length > 0 ? `${sortedDates[0].slice(5)} – ${sortedDates[sortedDates.length - 1].slice(5)}` : "";
              return { weekNum: wk, bars, dateLabel, dates: new Set(sortedDates) };
            }).filter(Boolean);

            if (weekGroups.length === 0) return null;
            const bestPct = Math.max(...weekGroups.flatMap(w => w.bars.map(b => b.pctToGoal)));
            return { jobType: p.jobType, sphGoal, weekGroups, bestPct, multiSite: true };
          } else {
            // Single site — group by weekNum only
            const weekMap = {};
            siteAgents.forEach(a => {
              const wk = a.weekNum || "";
              if (!wk) return;
              if (!weekMap[wk]) weekMap[wk] = { hours: 0, goals: 0, weekNum: wk, dates: new Set() };
              weekMap[wk].hours += a.hours;
              weekMap[wk].goals += a.goals;
              if (a.date) weekMap[wk].dates.add(a.date);
            });

            const weekGroups = Object.values(weekMap)
              .sort((a, b) => parseInt(a.weekNum) - parseInt(b.weekNum))
              .map(w => {
                if (w.hours < 10) return null;
                const sph = w.goals / w.hours;
                const pctToGoal = (sph / sphGoal) * 100;
                const sortedDates = [...w.dates].sort();
                const dateLabel = sortedDates.length > 0 ? `${sortedDates[0].slice(5)} – ${sortedDates[sortedDates.length - 1].slice(5)}` : "";
                return { weekNum: w.weekNum, bars: [{ region: siteFilter, sph, pctToGoal, hours: w.hours, goals: w.goals }], dateLabel, dates: w.dates };
              }).filter(Boolean);

            if (weekGroups.length === 0) return null;
            const bestPct = Math.max(...weekGroups.flatMap(w => w.bars.map(b => b.pctToGoal)));
            return { jobType: p.jobType, sphGoal, weekGroups, bestPct, multiSite: false };
          }
        }).filter(Boolean).sort((a, b) => b.bestPct - a.bestPct);

        if (chartData.length === 0) return null;

        // Collect week date ranges for legend
        const weekDateMap = {};
        chartData.forEach(p => p.weekGroups.forEach(w => {
          if (!weekDateMap[w.weekNum]) weekDateMap[w.weekNum] = new Set();
          (w.dates || []).forEach(d => weekDateMap[w.weekNum].add(d));
        }));
        const allWeekNums = Object.keys(weekDateMap).sort((a, b) => parseInt(a) - parseInt(b));
        const allPcts = chartData.flatMap(p => p.weekGroups.flatMap(w => w.bars.map(b => b.pctToGoal)));
        const maxPct = Math.max(100, ...allPcts);
        const chartMax = Math.min(maxPct + 10, 120);
        const barH = 160;

        // Collect visible regions for site legend (only when showing multi-site)
        const visibleRegions = showSiteBars ? [...new Set(chartData.flatMap(p => p.weekGroups.flatMap(w => w.bars.map(b => b.region))))].sort() : [];

        const siteLabel = siteFilter === "ALL" ? "All Sites" : siteFilter === "BZ" ? "Belize" : siteFilter === "DR" ? "Dom. Republic" : mbrSiteName(siteFilter);

        return (
          <div style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg, 16px)", padding: "1.25rem 1.5rem" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem" }}>
              <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.82rem", color: "var(--text-muted)", letterSpacing: "0.12em", textTransform: "uppercase" }}>
                SPH % to Goal — Week over Week
                <span style={{ color: "#6366f1", marginLeft: "0.5rem", fontSize: "0.78rem", textTransform: "none" }}>({siteLabel})</span>
              </div>
              <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.7rem", color: "var(--text-faint)" }}>
                ◆ 100% = at goal
              </div>
            </div>

            {/* Chart area */}
            <div style={{ position: "relative", paddingLeft: "2.5rem" }}>
              {/* Y-axis labels and gridlines */}
              {[0, 20, 40, 60, 80, 100, 120].filter(v => v <= chartMax).map(v => {
                const bottom = (v / chartMax) * barH;
                return (
                  <div key={v} style={{ position: "absolute", left: 0, bottom: bottom + 30, width: "100%", display: "flex", alignItems: "center" }}>
                    <span style={{ fontFamily: "var(--font-data, monospace)", fontSize: "0.65rem", color: "var(--text-dim)", width: "2rem", textAlign: "right", marginRight: "0.5rem" }}>{v}</span>
                    <div style={{ flex: 1, borderTop: v === 100 ? "2px dashed var(--text-faint)" : "1px solid var(--bg-tertiary)" }} />
                  </div>
                );
              })}

              {/* Bars — grouped by program → week → site */}
              <div style={{ display: "flex", gap: "1.5rem", alignItems: "flex-end", height: barH + 30, paddingTop: 20, position: "relative", zIndex: 1 }}>
                {chartData.map(prog => (
                  <div key={prog.jobType} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                    <div style={{ display: "flex", gap: showSiteBars ? 6 : 2, alignItems: "flex-end", height: barH }}>
                      {prog.weekGroups.map((wg, wi) => (
                        <React.Fragment key={wg.weekNum}>
                        {wi > 0 && <div style={{ width: 1, height: barH * 0.6, background: "var(--border)", alignSelf: "flex-end", margin: "0 2px" }} />}
                        <div style={{ display: "flex", gap: 1, alignItems: "flex-end" }}>
                          {wg.bars.map(bar => {
                            const h = Math.min(bar.pctToGoal, chartMax) / chartMax * barH;
                            const color = showSiteBars ? (siteColors[bar.region] || "#6b7280") : weekColors[wi % weekColors.length];
                            return (
                              <div key={bar.region} style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                                <div style={{ fontFamily: "var(--font-data, monospace)", fontSize: "0.6rem", color: "var(--text-dim)", marginBottom: 2, fontWeight: 600 }}>
                                  {Math.round(bar.pctToGoal)}%
                                </div>
                                <div
                                  style={{ width: showSiteBars ? 28 : 36, height: Math.max(h, 2), background: color, borderRadius: "3px 3px 0 0", transition: "height 0.4s ease" }}
                                  title={`${showSiteBars ? mbrSiteName(bar.region) + " " : ""}Wk ${wg.weekNum}: SPH ${bar.sph.toFixed(3)} / Goal ${prog.sphGoal.toFixed(2)} = ${Math.round(bar.pctToGoal)}% (${bar.goals} goals, ${Math.round(bar.hours)} hrs)`}
                                />
                              </div>
                            );
                          })}
                        </div>
                        </React.Fragment>
                      ))}
                    </div>
                    <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.72rem", color: "var(--text-dim)", textAlign: "center", whiteSpace: "nowrap" }}>
                      {prog.jobType}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Legend */}
            <div style={{ display: "flex", gap: "1rem", marginTop: "0.75rem", justifyContent: "center", flexWrap: "wrap" }}>
              {showSiteBars ? (
                <>
                  {visibleRegions.map(r => (
                    <div key={r} style={{ display: "flex", alignItems: "center", gap: "0.3rem" }}>
                      <div style={{ width: 12, height: 8, background: siteColors[r] || "#6b7280", borderRadius: 2 }} />
                      <span style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.7rem", color: "var(--text-dim)" }}>{mbrSiteName(r)}</span>
                    </div>
                  ))}
                  <div style={{ width: 1, height: 14, background: "var(--border)", margin: "0 0.25rem" }} />
                  {allWeekNums.map(wk => {
                    const dates = [...(weekDateMap[wk] || [])].sort();
                    const range = dates.length > 0 ? `${dates[0].slice(5)} – ${dates[dates.length - 1].slice(5)}` : `Wk ${wk}`;
                    return <span key={wk} style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.68rem", color: "var(--text-faint)" }}>{range}</span>;
                  })}
                </>
              ) : (
                allWeekNums.map((wk, i) => {
                  const dates = [...(weekDateMap[wk] || [])].sort();
                  const range = dates.length > 0 ? `${dates[0].slice(5)} – ${dates[dates.length - 1].slice(5)}` : "";
                  return (
                    <div key={wk} style={{ display: "flex", alignItems: "center", gap: "0.3rem" }}>
                      <div style={{ width: 12, height: 8, background: weekColors[i % weekColors.length], borderRadius: 2 }} />
                      <span style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.7rem", color: "var(--text-dim)" }}>{range || `Wk ${wk}`}</span>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        );
      })() : (
        <div style={{ background: "#6366f110", border: "1px solid #6366f140", borderLeft: "4px solid #6366f1", borderRadius: "var(--radius-md, 10px)", padding: "0.75rem 1rem", display: "flex", alignItems: "center", gap: "0.75rem" }}>
          <span style={{ fontSize: "1rem" }}>📊</span>
          <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.82rem", color: "var(--text-secondary)" }}>
            Load goals CSV to unlock SPH % to Goal chart
          </div>
        </div>
      )}
    </div>
  );
}

// Replaces Spanish Callback. Shows all job types with MoM agent
// job type with MoM agent % to goal comparisons.

function buildMoMAgentStats(currentAgents, priorAgents) {
  const rollup = (rows) => {
    const map = {};
    rows.forEach(a => {
      const n = a.agentName;
      if (!n) return;
      if (!map[n]) map[n] = { hours: 0, goals: 0, goalsNum: 0, newXI: 0, xmLines: 0, newXH: 0, newVideo: 0, newVoice: 0, region: a.region, supervisor: a.supervisor, jobTypes: new Set(), dates: new Set() };
      map[n].hours += a.hours; map[n].goals += a.goals; map[n].goalsNum += a.goalsNum;
      map[n].newXI += a.newXI; map[n].xmLines += a.xmLines; map[n].newXH += a.newXH;
      map[n].newVideo += a.newVideo; map[n].newVoice += (a.newVoice || 0);
      if (a.jobType && !a.isSpanishCallback) map[n].jobTypes.add(a.jobType);
      if (a.date) map[n].dates.add(a.date);
    });
    return map;
  };
  const cur = rollup(currentAgents), prev = rollup(priorAgents);
  const allNames = [...new Set([...Object.keys(cur), ...Object.keys(prev)])].sort();

  // Build initial results
  const results = allNames.map(name => {
    const c = cur[name] || { hours:0, goals:0, goalsNum:0, newXI:0, xmLines:0, newXH:0, newVideo:0, newVoice:0, jobTypes: new Set(), dates: new Set() };
    const p = prev[name] || { hours:0, goals:0, goalsNum:0, newXI:0, xmLines:0, newXH:0, newVideo:0, newVoice:0, jobTypes: new Set(), dates: new Set() };
    const curPct = c.goalsNum > 0 ? (c.goals / c.goalsNum) * 100 : 0;
    const prevPct = p.goalsNum > 0 ? (p.goals / p.goalsNum) * 100 : 0;
    const curGph = c.hours > 0 ? c.goals / c.hours : 0;
    const prevGph = p.hours > 0 ? p.goals / p.hours : 0;

    // Campaign movement detection
    const curPrograms = [...(c.jobTypes || [])].sort();
    const prevPrograms = [...(p.jobTypes || [])].sort();
    const added = curPrograms.filter(j => !prevPrograms.includes(j));
    const removed = prevPrograms.filter(j => !curPrograms.includes(j));
    const unchanged = curPrograms.filter(j => prevPrograms.includes(j));
    const moved = added.length > 0 || removed.length > 0;

    // Hours per day
    const curDays = c.dates ? c.dates.size : 0;
    const prevDays = p.dates ? p.dates.size : 0;
    const curHpd = curDays > 0 ? c.hours / curDays : 0;
    const prevHpd = prevDays > 0 ? p.hours / prevDays : 0;

    return { name, inCurrent: !!cur[name], inPrior: !!prev[name],
      region: (cur[name]||prev[name]).region||"", supervisor: (cur[name]||prev[name]).supervisor||"",
      cur: { ...c, pct: curPct, gph: curGph, hpd: curHpd, daysWorked: curDays, jobTypes: curPrograms },
      prev: { ...p, pct: prevPct, gph: prevGph, hpd: prevHpd, daysWorked: prevDays, jobTypes: prevPrograms },
      delta: curPct - prevPct,
      campaign: { moved, added, removed, unchanged, curPrograms, prevPrograms },
    };
  });

  // Peer ranking by % to goal (among agents in current month)
  const ranked = results.filter(a => a.inCurrent && a.cur.goalsNum > 0).sort((a, b) => b.cur.pct - a.cur.pct);
  ranked.forEach((a, i) => { a.curRank = i + 1; });
  const curPeerCount = ranked.length;

  // Prior peer ranking
  const rankedPrev = results.filter(a => a.inPrior && a.prev.goalsNum > 0).sort((a, b) => b.prev.pct - a.prev.pct);
  rankedPrev.forEach((a, i) => { a.prevRank = i + 1; });
  const prevPeerCount = rankedPrev.length;

  results.forEach(a => {
    a.curPeerCount = curPeerCount;
    a.prevPeerCount = prevPeerCount;
    if (!a.curRank) a.curRank = null;
    if (!a.prevRank) a.prevRank = null;
    a.rankDelta = (a.curRank && a.prevRank) ? a.prevRank - a.curRank : null; // positive = improved
  });

  return results;
}

function CampaignComparisonPanel({ currentAgents, onNav, localAI, priorAgents, priorGoalLookup, priorSheetLoading, setPriorRaw, setPriorGoalsRaw }) {
  const [activeJobType, setActiveJobType] = useState(null);
  const [sortCol, setSortCol] = useState("delta");
  const [sortDir, setSortDir] = useState(-1);
  const [siteFilter, setSiteFilter] = useState("ALL"); // ALL | DR | BZ
  const [hideLeft, setHideLeft] = useState(true);
  const [expandedAgent, setExpandedAgent] = useState(null);

  // File upload refs (manual override still supported)
  const priorDataRef = useRef();
  const priorGoalsRef = useRef();
  const loadFileCamp = (f, setter) => { const r = new FileReader(); r.onload = e => setter(parseCSV(e.target.result)); r.readAsText(f); };

  // Fiscal pacing from current month data
  const fiscalInfo = useMemo(() => {
    const dates = [...new Set(currentAgents.filter(a => a.date).map(a => a.date))];
    return getFiscalMonthInfo(dates);
  }, [currentAgents]);
  const pctElapsed = fiscalInfo ? fiscalInfo.pctElapsed / 100 : 0; // 0-1

  // Site filter helper: map region to DR/BZ, also supports individual BZ region drilldown
  const agentSite = (a) => REGION_TO_SITE[a.region] || "DR";
  const filterBySite = (agents) => {
    if (siteFilter === "ALL") return agents;
    if (siteFilter === "DR" || siteFilter === "BZ") return agents.filter(a => agentSite(a) === siteFilter);
    // Individual region drilldown (e.g. "Belize City-XOTM")
    return agents.filter(a => a.region === siteFilter);
  };

  // Build BZ sub-site list from the data
  const bzSubSites = useMemo(() => {
    const allAgents = [...currentAgents, ...priorAgents];
    const bzRegions = [...new Set(allAgents.map(a => a.region).filter(r => REGION_TO_SITE[r] === "BZ"))].sort();
    return bzRegions;
  }, [currentAgents, priorAgents]);

  const allJobTypes = useMemo(() => {
    const jts = new Set([
      ...currentAgents.filter(a => !a.isSpanishCallback).map(a => a.jobType),
      ...priorAgents.filter(a => !a.isSpanishCallback).map(a => a.jobType),
    ]);
    return [...jts].filter(Boolean).sort();
  }, [currentAgents, priorAgents]);

  useEffect(() => { if (allJobTypes.length > 0 && !activeJobType) setActiveJobType("ALL"); }, [allJobTypes, activeJobType]);

  const agentStats = useMemo(() => {
    if (!activeJobType) return [];
    const curFiltered = filterBySite(activeJobType === "ALL" ? currentAgents.filter(a => !a.isSpanishCallback) : currentAgents.filter(a => a.jobType === activeJobType));
    const prevFiltered = filterBySite(activeJobType === "ALL" ? priorAgents.filter(a => !a.isSpanishCallback) : priorAgents.filter(a => a.jobType === activeJobType));
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
        curXh: a.cur.newXH, curXv: a.cur.newVideo, curPhone: a.cur.newVoice, prevGoals: a.prev.goals, prevGph: a.prev.gph, curGphCol: a.cur.gph,
        rank: a.curRank || 999, hpd: a.cur.hpd || 0 };
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
          style={{ background:priorAgents.length>0?"#6366f118":"transparent", border:`1px solid ${priorAgents.length>0?"#6366f1":"var(--border-muted)"}`, borderRadius:"5px", color:priorAgents.length>0?"#6366f1":"var(--text-muted)", padding:"0.35rem 0.9rem", fontFamily:"monospace", fontSize:"1.08rem", cursor:"pointer" }}>
          {priorAgents.length > 0 ? `Prior Month Data (${priorAgents.length} rows)` : "Upload Prior Month Data"}
        </button>
        {priorAgents.length > 0 && <button onClick={() => setPriorRaw(null)} title="Clear" style={{ background:"transparent", border:"1px solid var(--text-faint)", borderRadius:"5px", color:"var(--text-dim)", padding:"0.2rem 0.5rem", fontFamily:"monospace", fontSize:"1.08rem", cursor:"pointer" }}>{"✕"}</button>}
        <input ref={priorDataRef} type="file" accept=".csv" style={{ display:"none" }} onChange={e => { if (e.target.files[0]) loadFileCamp(e.target.files[0], setPriorRaw); e.target.value=""; }} />
        <div style={{ width:"1px", height:"24px", background:"var(--border)", margin:"0 0.25rem" }} />
        <button onClick={() => priorGoalsRef.current.click()}
          style={{ background:priorGoalLookup?"#16a34a18":"transparent", border:`1px solid ${priorGoalLookup?"#16a34a":"var(--border-muted)"}`, borderRadius:"5px", color:priorGoalLookup?"#16a34a":"var(--text-muted)", padding:"0.35rem 0.9rem", fontFamily:"monospace", fontSize:"1.08rem", cursor:"pointer" }}>
          {priorGoalLookup ? "Prior Month Goals" : "Upload Prior Month Goals"}
        </button>
        {priorGoalLookup && <button onClick={() => setPriorGoalsRaw(null)} title="Clear" style={{ background:"transparent", border:"1px solid var(--text-faint)", borderRadius:"5px", color:"var(--text-dim)", padding:"0.2rem 0.5rem", fontFamily:"monospace", fontSize:"1.08rem", cursor:"pointer" }}>{"✕"}</button>}
        <input ref={priorGoalsRef} type="file" accept=".csv" style={{ display:"none" }} onChange={e => { if (e.target.files[0]) loadFileCamp(e.target.files[0], setPriorGoalsRaw); e.target.value=""; }} />
        {(priorAgents.length > 0 || priorGoalLookup) && <div style={{ marginLeft:"auto", fontFamily:"monospace", fontSize:"0.9rem", color:"var(--text-faint)" }}>saved to browser</div>}
      </div>

      {priorAgents.length === 0 ? (
        <div style={{ background:"var(--bg-secondary)", border:"1px solid #6366f130", borderRadius:"12px", padding:"3rem", textAlign:"center" }}>
          <div style={{ fontFamily:"Georgia, serif", fontSize:"1.5rem", color:"var(--text-warm)", marginBottom:"0.75rem" }}>
            {priorSheetLoading ? "Loading Prior Month from Sheet..." : "Upload Prior Month Data to Begin"}
          </div>
          {priorSheetLoading ? (
            <div style={{ display:"flex", justifyContent:"center", alignItems:"center", gap:"0.5rem" }}>
              <div style={{ width:"14px", height:"14px", borderRadius:"50%", border:"2px solid #6366f1", borderTopColor:"transparent", animation:"spin 0.8s linear infinite" }} />
              <span style={{ fontFamily:"monospace", fontSize:"1.11rem", color:"#6366f1" }}>Fetching from Google Sheets...</span>
            </div>
          ) : (
            <div style={{ fontFamily:"monospace", fontSize:"1.11rem", color:"var(--text-dim)", maxWidth:"500px", margin:"0 auto" }}>Use the buttons above to load your prior month performance data CSV and optionally the prior month goals CSV.</div>
          )}
        </div>
      ) : allJobTypes.length === 0 ? (
        <div style={{ background:"var(--bg-secondary)", border:"1px solid var(--border)", borderRadius:"12px", padding:"3rem", textAlign:"center" }}>
          <div style={{ fontFamily:"Georgia, serif", fontSize:"1.5rem", color:"var(--text-warm)", marginBottom:"0.75rem" }}>No Job Types Found</div>
          <div style={{ fontFamily:"monospace", fontSize:"1.11rem", color:"var(--text-dim)" }}>No job types were found across either dataset.</div>
        </div>
      ) : (<>
        <div style={{ display:"flex", gap:"0.5rem", alignItems:"center", marginBottom:"1rem", flexWrap:"wrap" }}>
          <div style={{ fontFamily:"monospace", fontSize:"0.95rem", color:"var(--text-faint)", marginRight:"0.25rem" }}>SITE</div>
          {["ALL","DR","BZ"].map(s => (<button key={s} onClick={() => setSiteFilter(s)}
            style={{ padding:"0.3rem 0.9rem", borderRadius:"5px", border:`1px solid ${siteFilter===s?"#6366f1":"var(--border)"}`, background:siteFilter===s?"#6366f118":"transparent", color:siteFilter===s?"#818cf8":"var(--text-muted)", fontFamily:"monospace", fontSize:"1.05rem", cursor:"pointer", fontWeight:siteFilter===s?600:400 }}>{s}</button>))}
          {bzSubSites.length > 1 && (<>
            <div style={{ width:"1px", height:"20px", background:"var(--border)", margin:"0 0.15rem" }} />
            {bzSubSites.map(r => (<button key={r} onClick={() => setSiteFilter(siteFilter === r ? "BZ" : r)}
              style={{ padding:"0.3rem 0.7rem", borderRadius:"5px", border:`1px solid ${siteFilter===r?"#d97706":"var(--border)"}`, background:siteFilter===r?"#d9770618":"transparent", color:siteFilter===r?"#d97706":"var(--text-dim)", fontFamily:"monospace", fontSize:"0.9rem", cursor:"pointer", fontWeight:siteFilter===r?600:400 }}>{r.replace("-XOTM","")}</button>))}
          </>)}
          {fiscalInfo && <div style={{ marginLeft:"auto", fontFamily:"monospace", fontSize:"0.95rem", color:"var(--text-faint)" }}>
            Pacing: {fiscalInfo.elapsedBDays}/{fiscalInfo.totalBDays} biz days ({fiscalInfo.pctElapsed.toFixed(1)}%) through {fiscalInfo.lastDataDate}
          </div>}
        </div>
        <div style={{ display:"flex", gap:"0.4rem", flexWrap:"wrap", marginBottom:"1.5rem" }}>
          <button onClick={() => setActiveJobType("ALL")}
            style={{ padding:"0.45rem 1.1rem", borderRadius:"6px", border:`1px solid ${activeJobType==="ALL"?"#d97706":"var(--border)"}`, background:activeJobType==="ALL"?"#d9770618":"transparent", color:activeJobType==="ALL"?"#d97706":"var(--text-muted)", fontFamily:"monospace", fontSize:"1.11rem", cursor:"pointer", fontWeight:activeJobType==="ALL"?600:400 }}>All Jobs</button>
          {allJobTypes.map(jt => (<button key={jt} onClick={() => setActiveJobType(jt)}
            style={{ padding:"0.45rem 1.1rem", borderRadius:"6px", border:`1px solid ${activeJobType===jt?"#d97706":"var(--border)"}`, background:activeJobType===jt?"#d9770618":"transparent", color:activeJobType===jt?"#d97706":"var(--text-muted)", fontFamily:"monospace", fontSize:"1.11rem", cursor:"pointer", fontWeight:activeJobType===jt?600:400 }}>{jt}</button>))}
        </div>
        {activeJobType && summary && (<>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(4, 1fr)", gap:"0.75rem", marginBottom:"1.5rem" }}>
            <StatCard label="Current Agents" value={summary.curAgents} sub={`vs ${summary.prevAgents} prior`} accent="#6366f1" />
            <StatCard label={`Avg \u0394 % to Goal`} value={`${summary.avgDelta >= 0 ? "+" : ""}${summary.avgDelta.toFixed(1)}%`} sub={`${summary.improvedCount} improved \u00B7 ${summary.declinedCount} declined`} accent={summary.avgDelta >= 0 ? "#16a34a" : "#dc2626"} />
            <StatCard label="Current Sales" value={summary.curGoals.toLocaleString()} sub={`vs ${summary.prevGoals.toLocaleString()} prior`} accent="#16a34a" />
            <StatCard label="Current Hours" value={fmt(summary.curHours, 0)} sub={`vs ${fmt(summary.prevHours, 0)} prior`} accent="#2563eb" />
          </div>

          {/* Executive Summary — MoM */}
          {(() => {
            const momLines = [];
            const salesDelta = summary.curGoals - summary.prevGoals;
            const hoursDelta = summary.curHours - summary.prevHours;
            const gphDelta = summary.curGph - summary.prevGph;
            momLines.push(`${activeJobType} month-over-month: ${summary.curAgents} active agents this month vs ${summary.prevAgents} prior. Sales ${salesDelta >= 0 ? "up" : "down"} ${Math.abs(salesDelta)} (${summary.prevGoals} to ${summary.curGoals}), hours ${hoursDelta >= 0 ? "up" : "down"} ${Math.abs(Math.round(hoursDelta))} (${fmt(summary.prevHours, 0)} to ${fmt(summary.curHours, 0)}).`);
            momLines.push(`GPH moved from ${summary.prevGph.toFixed(3)} to ${summary.curGph.toFixed(3)} (${gphDelta >= 0 ? "+" : ""}${gphDelta.toFixed(3)}). ${summary.improvedCount} agents improved their % to goal while ${summary.declinedCount} declined, with an average delta of ${summary.avgDelta >= 0 ? "+" : ""}${summary.avgDelta.toFixed(1)}%.`);
            if (summary.topMovers.filter(a => a.delta > 0).length > 0) {
              const top = summary.topMovers.filter(a => a.delta > 0).slice(0, 3).map(a => `${a.name} (+${fmtPct(a.delta)})`).join(", ");
              momLines.push(`Top improvers: ${top}.`);
            }
            if (summary.bottomMovers.filter(a => a.delta < 0).length > 0) {
              const bot = summary.bottomMovers.filter(a => a.delta < 0).slice(0, 3).map(a => `${a.name} (${fmtPct(a.delta)})`).join(", ");
              momLines.push(`Biggest declines: ${bot}.`);
            }

            const momAIData = localAI ? {
              jobType: `${activeJobType} MoM Comparison`,
              uniqueAgentCount: summary.curAgents,
              totalHours: summary.curHours, totalGoals: summary.curGoals,
              gph: summary.curGph,
              attainment: null, planGoals: null, actGoals: summary.curGoals,
              distUnique: {}, q1Agents: [], q4Agents: [], q3Agents: [],
              regions: [], healthScore: null,
              totalNewXI: summary.curHsd, totalXmLines: summary.curXm,
              newHiresInProgram: [], fiscalInfo,
              // Extra MoM context for the prompt
              prevAgents: summary.prevAgents, prevGoals: summary.prevGoals, prevHours: summary.prevHours,
              prevGph: summary.prevGph, avgDelta: summary.avgDelta,
              improvedCount: summary.improvedCount, declinedCount: summary.declinedCount,
              topMovers: summary.topMovers, bottomMovers: summary.bottomMovers,
            } : null;

            return (
              <div style={{ marginBottom: "1.5rem" }}>
                <CollapsibleNarrative
                  title={`Executive Summary — ${activeJobType} MoM`}
                  lines={momLines}
                  defaultOpen={true}
                  aiEnabled={localAI}
                  aiPromptData={momAIData}
                />
              </div>
            );
          })()}

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
            <div style={{ fontFamily:"monospace", fontSize:"1.08rem", color:"var(--text-muted)", letterSpacing:"0.12em", textTransform:"uppercase", marginBottom:"0.5rem", display:"flex", alignItems:"center", flexWrap:"wrap", gap:"0.4rem" }}>
              Agent Detail {sorted.filter(a => !hideLeft || a.inCurrent).length} agents
                <div style={{ marginLeft:"auto", textAlign:"right" }}>
                  <button onClick={() => setHideLeft(v => !v)}
                    style={{ padding:"0.2rem 0.7rem", borderRadius:"4px", border:`1px solid ${hideLeft?"var(--border)":"#6366f1"}`, background:hideLeft?"transparent":"#6366f118", color:hideLeft?"var(--text-muted)":"#818cf8", fontFamily:"monospace", fontSize:"0.88rem", cursor:"pointer" }}>
                    {hideLeft ? "Show Removed" : "Hide Removed"}
                  </button>
                  {!hideLeft && (() => {
                    const removedCount = sorted.filter(a => !a.inCurrent).length;
                    return removedCount > 0 ? <div style={{ fontFamily:"var(--font-ui, Inter, sans-serif)", fontSize:"0.72rem", color:"#6366f1", marginTop:"0.2rem" }}>{removedCount} removed</div> : null;
                  })()}
                </div>
            </div>
            <div style={{ display:"flex", gap:"0.35rem", flexWrap:"wrap", marginBottom:"0.4rem" }}>
              {["ALL","DR","BZ"].map(s => (<button key={s} onClick={() => setSiteFilter(s)}
                style={{ padding:"0.3rem 0.6rem", borderRadius:"var(--radius-sm, 6px)", border:`1px solid ${siteFilter===s?"#6366f150":"var(--text-faint)"}`, background:siteFilter===s?"#6366f112":"transparent", color:siteFilter===s?"#818cf8":"var(--text-muted)", fontFamily:"var(--font-ui, Inter, sans-serif)", fontSize:"0.78rem", cursor:"pointer", fontWeight:siteFilter===s?600:400 }}>{s}</button>))}
              {bzSubSites.length > 1 && (<>
                <div style={{ width:"1px", height:"20px", background:"var(--border)", margin:"0 0.1rem" }} />
                {bzSubSites.map(r => (<button key={r} onClick={() => setSiteFilter(siteFilter === r ? "BZ" : r)}
                  style={{ padding:"0.3rem 0.6rem", borderRadius:"var(--radius-sm, 6px)", border:`1px solid ${siteFilter===r?"#d9770650":"var(--text-faint)"}`, background:siteFilter===r?"#d9770612":"transparent", color:siteFilter===r?"#d97706":"var(--text-muted)", fontFamily:"var(--font-ui, Inter, sans-serif)", fontSize:"0.75rem", cursor:"pointer", fontWeight:siteFilter===r?600:400 }}>{r.replace("-XOTM","")}</button>))}
              </>)}
            </div>
            <div style={{ display:"flex", gap:"0.35rem", flexWrap:"wrap", marginBottom:"0.75rem" }}>
              <button onClick={() => setActiveJobType("ALL")}
                style={{ padding:"0.3rem 0.75rem", borderRadius:"var(--radius-sm, 6px)", border:`1px solid ${activeJobType==="ALL"?"#d9770650":"var(--text-faint)"}`, background:activeJobType==="ALL"?"#d9770612":"transparent", color:activeJobType==="ALL"?"#d97706":"var(--text-muted)", fontFamily:"var(--font-ui, Inter, sans-serif)", fontSize:"0.78rem", cursor:"pointer", fontWeight:activeJobType==="ALL"?600:400 }}>All Jobs</button>
              {allJobTypes.map(jt => (<button key={jt} onClick={() => setActiveJobType(jt)}
                style={{ padding:"0.3rem 0.75rem", borderRadius:"var(--radius-sm, 6px)", border:`1px solid ${activeJobType===jt?"#d9770650":"var(--text-faint)"}`, background:activeJobType===jt?"#d9770612":"transparent", color:activeJobType===jt?"#d97706":"var(--text-muted)", fontFamily:"var(--font-ui, Inter, sans-serif)", fontSize:"0.78rem", cursor:"pointer", fontWeight:activeJobType===jt?600:400 }}>{jt}</button>))}
            </div>
            <div style={{ overflowX:"auto" }}>
              <table style={{ width:"100%", borderCollapse:"collapse", fontFamily:"monospace", fontSize:"0.9rem" }}>
                <thead><tr style={{ borderBottom:"2px solid var(--border)" }}>
                  {[{key:"name",label:"Agent",align:"left"},{key:"prevHours",label:"Prev Hrs",align:"right"},{key:"curHours",label:"Hours",align:"right"},{key:"curGoals",label:"Sales",align:"right"},{key:"curGph",label:"GPH",align:"right"},
                    {key:"curHsd",label:"New HSD",align:"right"},{key:"curXm",label:"New XM",align:"right"},{key:"curXh",label:"New XH",align:"right"},
                    {key:"curXv",label:"New XV",align:"right"},{key:"curPhone",label:"New Phone",align:"right"},
                    {key:"prevGoals",label:"Prev Sales",align:"right"},{key:"prevGph",label:"Prev GPH",align:"right"},{key:"curGphCol",label:"Cur GPH",align:"right"},
                    {key:"prevPct",label:"Prior %",align:"right"},{key:"curPct",label:"Current %",align:"right"},{key:"delta",label:"\u0394",align:"right"}
                  ].map(col => (<th key={col.key} onClick={() => handleSort(col.key)}
                    style={{ padding:"0.5rem 0.6rem", textAlign:col.align, color:"var(--text-muted)", cursor:"pointer", userSelect:"none", whiteSpace:"nowrap", fontWeight:sortCol===col.key?700:400, letterSpacing:"0.04em", fontSize:"0.85rem", borderLeft:["prevGoals","curHsd"].includes(col.key)?"2px solid var(--border)":"none" }}>{col.label}{sortArrow(col.key)}</th>))}
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
                      {a.campaign && a.campaign.moved && a.inCurrent && a.inPrior && (
                        <span style={{ fontSize:"0.72rem", color:"#8b5cf6", background:"#8b5cf618", padding:"0.05rem 0.35rem", borderRadius:"2px", marginLeft:"0.3rem", border:"1px solid #8b5cf630" }}
                          title={`Added: ${a.campaign.added.join(", ") || "none"} | Removed: ${a.campaign.removed.join(", ") || "none"}`}>
                          MOVED
                        </span>
                      )}
                      {a.curRank && <span style={{ fontSize:"0.68rem", color:"var(--text-faint)", marginLeft:"0.35rem" }}>#{a.curRank}{a.rankDelta !== null ? ` (${a.rankDelta > 0 ? "\u25B2" : a.rankDelta < 0 ? "\u25BC" : "="}${Math.abs(a.rankDelta)})` : ""}</span>}
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
                    <td style={{ padding:"0.5rem 0.6rem", textAlign:"right", color:"var(--text-dim)", borderLeft:"2px solid var(--border)" }}>{a.inPrior ? a.prev.goals : "\u2014"}</td>
                    <td style={{ padding:"0.5rem 0.6rem", textAlign:"right", color:"var(--text-dim)" }}>{a.inPrior && a.prev.gph > 0 ? a.prev.gph.toFixed(3) : "\u2014"}</td>
                    <td style={{ padding:"0.5rem 0.6rem", textAlign:"right", color:"var(--text-secondary)" }}>{a.inCurrent && a.cur.gph > 0 ? a.cur.gph.toFixed(3) : "\u2014"}</td>
                    <td style={{ padding:"0.5rem 0.6rem", textAlign:"right", color:"var(--text-dim)" }}>{a.inPrior ? fmtPct(a.prev.pct) : "\u2014"}</td>
                    <td style={{ padding:"0.5rem 0.6rem", textAlign:"right", color:attainColor(a.cur.pct), fontWeight:600 }}>{a.inCurrent ? fmtPct(a.cur.pct) : "\u2014"}</td>
                    <td style={{ padding:"0.5rem 0.6rem", textAlign:"right", color:dColor, fontWeight:700, fontSize:"1.02rem" }}>
                      {(a.inCurrent && a.inPrior) ? `${a.delta >= 0 ? "+" : ""}${fmtPct(a.delta)}` : "\u2014"}</td>
                  </tr>];
                  if (expandedAgent === a.name && a.inCurrent) {
                    // Build weekly rollup (grouped by Mon of week) with date ranges
                    const curRows = filterBySite(currentAgents.filter(r => r.agentName === a.name && (activeJobType === "ALL" || r.jobType === activeJobType) && r.date));
                    const prevRows = filterBySite(priorAgents.filter(r => r.agentName === a.name && (activeJobType === "ALL" || r.jobType === activeJobType) && r.date));
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
                    // Compute program-level peer averages for hours/day context
                    const curPeerAvgHpd = (() => {
                      const peers = agentStats.filter(p => p.inCurrent && p.name !== a.name && p.cur.daysWorked > 0);
                      return peers.length > 0 ? peers.reduce((s, p) => s + p.cur.hpd, 0) / peers.length : 0;
                    })();
                    rows.push(
                      <tr key={a.name+"_detail"}>
                        <td colSpan={colSpan} style={{ padding:"0.5rem 1rem 1rem 2rem", background:"var(--bg-tertiary)", borderBottom:"2px solid var(--border)" }}>
                          {/* Agent insight strip */}
                          <div style={{ display:"flex", gap:"1rem", flexWrap:"wrap", marginBottom:"0.75rem" }}>
                            {/* Campaign movement */}
                            {a.campaign && a.campaign.moved && (
                              <div style={{ background:"#8b5cf610", border:"1px solid #8b5cf630", borderRadius:"8px", padding:"0.5rem 0.75rem", flex:"1 1 200px" }}>
                                <div style={{ fontFamily:"var(--font-ui, Inter, sans-serif)", fontSize:"0.72rem", color:"#8b5cf6", letterSpacing:"0.08em", textTransform:"uppercase", marginBottom:"0.25rem" }}>Campaign Movement</div>
                                {a.campaign.added.length > 0 && <div style={{ fontFamily:"var(--font-ui, Inter, sans-serif)", fontSize:"0.82rem", color:"#16a34a" }}>+ {a.campaign.added.join(", ")}</div>}
                                {a.campaign.removed.length > 0 && <div style={{ fontFamily:"var(--font-ui, Inter, sans-serif)", fontSize:"0.82rem", color:"#dc2626" }}>- {a.campaign.removed.join(", ")}</div>}
                                {a.campaign.unchanged.length > 0 && <div style={{ fontFamily:"var(--font-ui, Inter, sans-serif)", fontSize:"0.78rem", color:"var(--text-dim)" }}>Stayed: {a.campaign.unchanged.join(", ")}</div>}
                              </div>
                            )}
                            {/* Hours utilization */}
                            {a.inCurrent && a.cur.daysWorked > 0 && (
                              <div style={{ background:"var(--bg-secondary)", border:"1px solid var(--border)", borderRadius:"8px", padding:"0.5rem 0.75rem", flex:"1 1 200px" }}>
                                <div style={{ fontFamily:"var(--font-ui, Inter, sans-serif)", fontSize:"0.72rem", color:"var(--text-muted)", letterSpacing:"0.08em", textTransform:"uppercase", marginBottom:"0.25rem" }}>Hours Utilization</div>
                                <div style={{ display:"flex", gap:"1rem" }}>
                                  <div>
                                    <div style={{ fontFamily:"var(--font-data, monospace)", fontSize:"1.1rem", color:"var(--text-warm)", fontWeight:700 }}>{a.cur.hpd.toFixed(1)}</div>
                                    <div style={{ fontFamily:"var(--font-ui, Inter, sans-serif)", fontSize:"0.68rem", color:"var(--text-faint)" }}>hrs/day ({a.cur.daysWorked}d)</div>
                                  </div>
                                  {a.inPrior && a.prev.daysWorked > 0 && (
                                    <div>
                                      <div style={{ fontFamily:"var(--font-data, monospace)", fontSize:"1.1rem", color:"#8b5cf6", fontWeight:600 }}>{a.prev.hpd.toFixed(1)}</div>
                                      <div style={{ fontFamily:"var(--font-ui, Inter, sans-serif)", fontSize:"0.68rem", color:"var(--text-faint)" }}>prior ({a.prev.daysWorked}d)</div>
                                    </div>
                                  )}
                                  {curPeerAvgHpd > 0 && (
                                    <div>
                                      <div style={{ fontFamily:"var(--font-data, monospace)", fontSize:"1.1rem", color:"var(--text-dim)", fontWeight:600 }}>{curPeerAvgHpd.toFixed(1)}</div>
                                      <div style={{ fontFamily:"var(--font-ui, Inter, sans-serif)", fontSize:"0.68rem", color:"var(--text-faint)" }}>peer avg</div>
                                    </div>
                                  )}
                                </div>
                                {curPeerAvgHpd > 0 && a.cur.hpd < curPeerAvgHpd * 0.8 && (
                                  <div style={{ fontFamily:"var(--font-ui, Inter, sans-serif)", fontSize:"0.72rem", color:"#dc2626", marginTop:"0.2rem" }}>Below peer average by {((1 - a.cur.hpd / curPeerAvgHpd) * 100).toFixed(0)}%</div>
                                )}
                              </div>
                            )}
                            {/* Peer ranking */}
                            {a.curRank && (
                              <div style={{ background:"var(--bg-secondary)", border:"1px solid var(--border)", borderRadius:"8px", padding:"0.5rem 0.75rem", flex:"0 1 150px", textAlign:"center" }}>
                                <div style={{ fontFamily:"var(--font-ui, Inter, sans-serif)", fontSize:"0.72rem", color:"var(--text-muted)", letterSpacing:"0.08em", textTransform:"uppercase", marginBottom:"0.25rem" }}>Peer Rank</div>
                                <div style={{ fontFamily:"var(--font-display, Inter, sans-serif)", fontSize:"1.5rem", color:"var(--text-warm)", fontWeight:700 }}>#{a.curRank}<span style={{ fontSize:"0.82rem", color:"var(--text-faint)", fontWeight:400 }}> / {a.curPeerCount}</span></div>
                                {a.rankDelta !== null && (
                                  <div style={{ fontFamily:"var(--font-ui, Inter, sans-serif)", fontSize:"0.78rem", color: a.rankDelta > 0 ? "#16a34a" : a.rankDelta < 0 ? "#dc2626" : "var(--text-dim)", marginTop:"0.1rem" }}>
                                    {a.rankDelta > 0 ? `\u25B2 ${a.rankDelta} spots` : a.rankDelta < 0 ? `\u25BC ${Math.abs(a.rankDelta)} spots` : "No change"}
                                    {a.prevRank && <span style={{ color:"var(--text-faint)", marginLeft:"0.3rem" }}>(was #{a.prevRank}/{a.prevPeerCount})</span>}
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
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


// (Section 12d — ProgramBySiteTab removed: site content is now top-level via TopNav)

// ══════════════════════════════════════════════════════════════════════════════
// SECTION 13 — SLIDE  (pages/Slide.jsx)
// Receives a pre-built Program object. No heavy computation inside.
// ══════════════════════════════════════════════════════════════════════════════

// ── Daily Breakdown Panel ─────────────────────────────────────────────────────
// Shows performance by day, by region/site, with combined view and region tabs.
// When programs[] is passed (from BusinessOverview), shows program drill-down tabs.
function DailyBreakdownPanel({ agents: allAgentsProp, regions, jobType, sphGoal, programs, goalLookup, singleProgram, priorAgents }) {
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
      <div style={{ background: `var(--bg-secondary)`, border: "1px solid var(--border)", borderRadius: "var(--radius-lg, 16px)", padding: "2rem", textAlign: "center", color: `var(--text-faint)`, fontFamily: "var(--font-ui, Inter, sans-serif)" }}>
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

  // Prior agents filtered to match current program selection
  const priorAgentsFiltered = useMemo(() => {
    if (!priorAgents || priorAgents.length === 0) return [];
    if (dailyProgram !== "All") return priorAgents.filter(a => a.jobType === dailyProgram);
    return priorAgents.filter(a => !a.isSpanishCallback);
  }, [priorAgents, dailyProgram]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
      {/* Day-of-Week Analysis */}
      <DOWCards agents={activeAgents} priorAgents={priorAgentsFiltered} label={displayLabel} />

      <div style={{ background: `var(--bg-secondary)`, border: "1px solid var(--border)", borderRadius: "var(--radius-lg, 16px)", padding: "1.5rem" }}>
        <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.82rem", color: `var(--text-muted)`, letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: "0.75rem" }}>
          Daily Performance Breakdown — {displayLabel}
          {dailyRocFilter && rocPlanInfo && (
            <span style={{ marginLeft: "0.75rem", fontSize: "0.78rem", color: "#6366f1", letterSpacing: "0.05em", textTransform: "none" }}>
              {dailyRocFilter} {rocPlanInfo.funding ? `(${rocPlanInfo.funding})` : ""} — {rocPlanInfo.homes.toLocaleString()} homes / {Math.round(rocPlanInfo.hours).toLocaleString()} hrs / SPH {rocPlanInfo.sph.toFixed(3)}
            </span>
          )}
        </div>

        {/* Region/site tabs */}
        {regionInfo.tabs.length > 2 && (
          <div style={{ marginBottom: "0.75rem" }}>
            <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.9rem", color: `var(--text-faint)`, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: "0.35rem" }}>Region</div>
            <div style={{ display: "flex", gap: "0.35rem", flexWrap: "wrap", alignItems: "center" }}>
              {regionInfo.tabs.map(r => {
                const active = dailyRegion === r;
                const isBzCombo = r === "Combined (BZ)";
                const isCombined = r === "Combined";
                const isBzSite = !isCombined && !isBzCombo && regionInfo.bz.includes(r);
                const btnColor = isCombined ? "#d97706" : isBzCombo ? "#16a34a" : isBzSite ? "#16a34a" : "#6366f1";
                return (
                  <button key={r} onClick={() => setDailyRegion(r)}
                    style={{ padding: "0.25rem 0.7rem", borderRadius: "var(--radius-sm, 6px)",
                      border: `1px solid ${active ? btnColor : `var(--border)`}`,
                      background: active ? btnColor + "18" : "transparent",
                      color: active ? btnColor : `var(--text-dim)`,
                      fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.85rem", cursor: "pointer", transition: "all 0.15s",
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
            <div style={{ background: `var(--bg-tertiary)`, borderRadius: "var(--radius-md, 10px)", padding: "0.75rem 1rem", marginBottom: "0.75rem" }}>
              <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.85rem", color: `var(--text-faint)`, letterSpacing: "0.08em", marginBottom: "0.4rem" }}>GOAL TARGETS BY FUNDING</div>
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
                      {funding && <span style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.8rem", color: "#6366f1", background: "#6366f108", border: "1px solid #6366f130", borderRadius: "3px", padding: "0 0.25rem" }}>{funding}</span>}
                      <span style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.85rem", color: `var(--text-dim)` }}>{roc}</span>
                      <span style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.9rem", color: `var(--text-secondary)` }}>{homes.toLocaleString()} homes</span>
                      <span style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.9rem", color: `var(--text-dim)` }}>{Math.round(hours).toLocaleString()} hrs</span>
                      <span style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.9rem", color: `var(--text-dim)` }}>SPH {sphG.toFixed(3)}</span>
                    </div>
                  );
                }).filter(Boolean)}
              </div>
            </div>
          );
        })()}
        {programList.length > 0 && (
          <div style={{ marginBottom: "0.75rem" }}>
            <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.9rem", color: `var(--text-faint)`, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: "0.35rem" }}>Program</div>
            <div style={{ display: "flex", gap: "0.35rem", flexWrap: "wrap" }}>
              <button onClick={() => { setDailyProgram("All"); setDailyRocFilter(null); }}
                style={{ padding: "0.3rem 0.75rem", borderRadius: "var(--radius-sm, 6px)",
                  border: `1px solid ${dailyProgram === "All" ? "#d97706" : `var(--border)`}`,
                  background: dailyProgram === "All" ? "#d9770618" : "transparent",
                  color: dailyProgram === "All" ? "#d97706" : `var(--text-dim)`,
                  fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.85rem", cursor: "pointer", fontWeight: dailyProgram === "All" ? 700 : 400 }}>
                All Programs
              </button>
              {programList.map(p => {
                const active = dailyProgram === p.jobType;
                return (
                  <button key={p.jobType} onClick={() => { setDailyProgram(p.jobType); setDailyRegion("Combined"); setDailyRocFilter(null); }}
                    style={{ padding: "0.3rem 0.75rem", borderRadius: "var(--radius-sm, 6px)",
                      border: `1px solid ${active ? "#2563eb" : `var(--border)`}`,
                      background: active ? "#2563eb18" : "transparent",
                      color: active ? "#2563eb" : `var(--text-dim)`,
                      fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.85rem", cursor: "pointer", fontWeight: active ? 700 : 400 }}>
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
                    style={{ padding: "0.2rem 0.6rem", borderRadius: "var(--radius-sm, 6px)", border: `1px solid ${!dailyRocFilter ? "#6366f1" : "var(--border)"}`, background: !dailyRocFilter ? "#6366f118" : "transparent", color: !dailyRocFilter ? "#6366f1" : `var(--text-dim)`, fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.9rem", cursor: "pointer" }}>
                    All ROCs
                  </button>
                  {opts.map(opt => (
                    <button key={opt.roc} onClick={() => setDailyRocFilter(dailyRocFilter === opt.roc ? null : opt.roc)}
                      style={{ padding: "0.2rem 0.6rem", borderRadius: "var(--radius-sm, 6px)", border: `1px solid ${dailyRocFilter === opt.roc ? "#6366f1" : "var(--border)"}`, background: dailyRocFilter === opt.roc ? "#6366f118" : "transparent", color: dailyRocFilter === opt.roc ? "#6366f1" : `var(--text-dim)`, fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.9rem", cursor: "pointer", display: "flex", gap: "0.3rem", alignItems: "center" }}>
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
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: "0.5rem", marginBottom: "1rem", padding: "0.75rem", background: `var(--bg-primary)`, borderRadius: "var(--radius-md, 10px)", border: "1px solid var(--border)" }}>
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
              <div style={{ fontFamily: "var(--font-display, Inter, sans-serif)", fontSize: "1.15rem", color: c, fontWeight: 700, lineHeight: 1 }}>{v}</div>
              <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.85rem", color: `var(--text-dim)`, marginTop: "0.15rem" }}>{l}</div>
            </div>
          ))}
        </div>

        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.85rem" }}>
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
                              <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.85rem", color: `var(--text-faint)`, letterSpacing: "0.08em", marginBottom: "0.5rem" }}>
                                {singleProgram ? "AGENT DETAIL" : (selectedDrillJob ? "AGENT DETAIL" : "PROGRAM BREAKDOWN")} {"\u2014"} {d.date} ({dayLabel(d.date)})
                                {!singleProgram && selectedDrillJob && (
                                  <button onClick={e => { e.stopPropagation(); setSelectedDrillJob(null); }}
                                    style={{ marginLeft: "0.75rem", padding: "0.15rem 0.5rem", borderRadius: "var(--radius-sm, 6px)", border: "1px solid #d97706", background: "#d9770618", color: "#d97706", fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.85rem", cursor: "pointer" }}>
                                    {"\u2190"} Back to Programs
                                  </button>
                                )}
                              </div>
                              {!singleProgram && !selectedDrillJob && (
                                <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.9rem" }}>
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
                                          <td style={{ padding: "0.3rem 0.5rem", color: `var(--text-warm)`, fontFamily: "var(--font-ui, Inter, sans-serif)" }}>{jt}</td>
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
                                    <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.85rem", color: `var(--text-warm)`, marginBottom: "0.3rem" }}>
                                      <span style={{ fontWeight: 700 }}>{drillJob}</span>
                                      <span style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.9rem", color: `var(--text-dim)`, marginLeft: "0.75rem" }}>{data.agents.length} agents <span style={{ display: "inline-block", width: "0.6em" }} /> {data.goals} sales <span style={{ display: "inline-block", width: "0.6em" }} /> {data.hrs.toFixed(1)} hrs</span>
                                    </div>
                                    <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.88rem" }}>
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

// ── ProgramSiteCompareCard — DR vs BZ scorecard for shared programs ─────────
// Renders only when both DR and BZ have agents in this program.
function ProgramSiteCompareCard({ program, allAgents, newHireSet, goalLookup }) {
  const data = useMemo(() => {
    const allRegions = [...new Set(allAgents.map(a => a.region).filter(Boolean))];
    const drRegions = allRegions.filter(r => !r.toUpperCase().includes("XOTM"));
    const bzRegions = allRegions.filter(r => r.toUpperCase().includes("XOTM"));
    const programAgents = allAgents.filter(a => a.jobType === program.jobType);

    // Re-derive the FULL cross-site goalEntries from goalLookup (program.goalEntries
    // received here may already be site-filtered by the parent App's filteredProgram).
    let fullEntries = [];
    if (goalLookup) {
      const agentRocs = [...new Set(programAgents.map(a => a.rocCode).filter(Boolean))];
      if (agentRocs.length > 0) {
        agentRocs.forEach(roc => {
          const rocEntries = getGoalEntries(goalLookup, program.jobType, roc);
          rocEntries.forEach(e => {
            if (!fullEntries.some(x => x.targetAudience === e.targetAudience)) fullEntries.push(e);
          });
        });
      }
      if (fullEntries.length === 0) fullEntries = getGoalEntries(goalLookup, program.jobType);
    }

    const buildSide = (regions, siteKey) => {
      const siteAgents = programAgents.filter(a => regions.includes(a.region));
      if (siteAgents.length === 0) return null;
      const sub = buildProgram(siteAgents, program.jobType, filterGoalEntriesBySite(fullEntries, siteKey), newHireSet);
      const cps = sub.totalGoals > 0 ? (sub.totalHours * MBR_BILLING_RATE) / sub.totalGoals : sub.totalHours * MBR_BILLING_RATE;
      return {
        attainment: sub.attainment,
        goals: sub.totalGoals,
        plan: sub.planGoals,
        hours: sub.totalHours,
        gph: sub.gph,
        agents: sub.uniqueAgentCount,
        q1Rate: sub.q1Rate,
        q1Count: sub.distUnique.Q1,
        cps,
      };
    };
    return { dr: buildSide(drRegions, "DR"), bz: buildSide(bzRegions, "BZ") };
  }, [program, allAgents, newHireSet, goalLookup]);

  if (!data.dr || !data.bz) return null;

  // Build winner-per-metric line
  const fmtPts = v => `${v >= 0 ? "+" : ""}${v.toFixed(1)}pts`;
  const fmtNum = v => `${v >= 0 ? "+" : ""}${Math.round(v)}`;
  const fmtGph = v => `${v >= 0 ? "+" : ""}${v.toFixed(2)}`;
  const fmtCps = v => `${v >= 0 ? "+" : "−"}$${Math.abs(Math.round(v))}`;
  const drWins = [], bzWins = [];
  if (data.dr.attainment != null && data.bz.attainment != null) {
    const d = data.dr.attainment - data.bz.attainment;
    if (Math.abs(d) >= 0.5) (d > 0 ? drWins : bzWins).push(`attainment ${fmtPts(Math.abs(d))}`);
  }
  if (data.dr.gph != null && data.bz.gph != null) {
    const d = data.dr.gph - data.bz.gph;
    if (Math.abs(d) >= 0.005) (d > 0 ? drWins : bzWins).push(`GPH ${fmtGph(Math.abs(d))}`);
  }
  const dHours = data.dr.hours - data.bz.hours;
  if (Math.abs(dHours) >= 1) (dHours > 0 ? drWins : bzWins).push(`hours ${fmtNum(Math.abs(dHours))}`);
  const dAboveGoal = data.dr.q1Count - data.bz.q1Count;
  if (Math.abs(dAboveGoal) >= 1) (dAboveGoal > 0 ? drWins : bzWins).push(`above-goal agents ${fmtNum(Math.abs(dAboveGoal))}`);
  const dCps = data.dr.cps - data.bz.cps;
  if (Math.abs(dCps) >= 1) (dCps < 0 ? drWins : bzWins).push(`CPS ${fmtCps(-Math.abs(dCps))}`);

  const Metric = ({ label, value, sub, valueColor }) => (
    <div>
      <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.7rem", color: "var(--text-muted)", letterSpacing: "0.1em", textTransform: "uppercase", fontWeight: 600 }}>{label}</div>
      <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "1.65rem", color: valueColor || "var(--text-warm)", fontWeight: 800, marginTop: "0.2rem", lineHeight: 1, letterSpacing: "-0.02em" }}>{value}</div>
      {sub && <div style={{ fontFamily: "var(--font-data, monospace)", fontSize: "0.72rem", color: "var(--text-dim)", marginTop: "0.35rem", letterSpacing: "0.02em" }}>{sub}</div>}
    </div>
  );
  const Site = ({ side, accent, label }) => {
    const d = data[side];
    return (
      <div style={{ flex: 1, padding: "1.1rem 1.35rem", minWidth: 0, position: "relative" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.85rem" }}>
          <span style={{ width: 8, height: 8, borderRadius: 4, background: accent, boxShadow: `0 0 8px ${accent}80` }} />
          <span style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.78rem", color: accent, letterSpacing: "0.1em", textTransform: "uppercase", fontWeight: 700 }}>{label}</span>
          <span style={{ fontFamily: "var(--font-data, monospace)", fontSize: "0.7rem", color: "var(--text-dim)" }}>· {d.agents} agents</span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: "0.85rem" }}>
          <Metric label="Goal"   value={d.attainment != null ? `${Math.round(d.attainment)}%` : "—"} sub={`${d.goals}${d.plan ? ` / ${d.plan}` : ""}`} valueColor={d.attainment != null ? attainColor(d.attainment) : null} />
          <Metric label="GPH"    value={fmt(d.gph, 2)} />
          <Metric label="Hours"  value={Math.round(d.hours).toLocaleString()} />
          <Metric label="Above Goal" value={`${d.q1Count}`} sub={`of ${d.agents} (${Math.round(d.q1Rate)}%)`} />
          <Metric label="CPS"    value={`$${Math.round(d.cps).toLocaleString()}`} />
        </div>
      </div>
    );
  };

  // Top accent: half DR orange, half BZ green
  const accentBorder = "linear-gradient(to right, #ed8936 0%, #ed8936 50%, #48bb78 50%, #48bb78 100%)";

  return (
    <div style={{ background: "var(--glass-bg)", backdropFilter: "blur(12px) saturate(150%)", WebkitBackdropFilter: "blur(12px) saturate(150%)", border: "1px solid var(--glass-border)", borderRadius: "var(--radius-lg, 16px)", overflow: "hidden", boxShadow: "var(--card-glow)", position: "relative" }}>
      {/* Top accent stripe — half DR orange, half BZ green */}
      <div style={{ height: 3, background: accentBorder }} />
      <div style={{ padding: "0.85rem 1.5rem 0.6rem", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.72rem", color: "var(--text-muted)", letterSpacing: "0.1em", textTransform: "uppercase", fontWeight: 600 }}>
          Site Comparison · {program.jobType}
        </div>
        <div style={{ fontFamily: "var(--font-data, monospace)", fontSize: "0.7rem", color: "var(--text-dim)" }}>both sites dialing</div>
      </div>
      <div style={{ display: "flex", borderTop: "1px solid var(--glass-border)" }}>
        <Site side="dr" accent="#ed8936" label="DR" />
        <div style={{ width: 1, background: "var(--glass-border)" }} />
        <Site side="bz" accent="#48bb78" label="BZ" />
      </div>
      {(drWins.length > 0 || bzWins.length > 0) && (
        <div style={{ padding: "0.75rem 1.5rem", background: "var(--accent-surface)", borderTop: "1px solid var(--glass-border)", fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.82rem", color: "var(--text-secondary)", lineHeight: 1.6 }}>
          {drWins.length > 0 && (
            <span><span style={{ color: "#ed8936", fontWeight: 700 }}>DR</span> leads {drWins.join(", ")}.</span>
          )}
          {drWins.length > 0 && bzWins.length > 0 && <span>{" "}</span>}
          {bzWins.length > 0 && (
            <span><span style={{ color: "#48bb78", fontWeight: 700 }}>BZ</span> leads {bzWins.join(", ")}.</span>
          )}
        </div>
      )}
    </div>
  );
}

function Slide({ program, newHireSet, goalLookup, fiscalInfo, allAgents, localAI, priorAgents, tnpsByAgent, siteFilter = null }) {
  const [tab, setTab] = useState("overview");
  const [rocFilter, setRocFilter] = useState(null); // null = all, or a specific ROC code
  const [rankSort, setRankSort] = useState({ key: "pctToGoal", dir: -1 });
  const [expandedRankSup, setExpandedRankSup] = useState(null);
  const [expandedAgent, setExpandedAgent] = useState(null);

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

  const agentTnpsBadge = (agentName) => {
    if (!tnpsByAgent) return null;
    const data = tnpsByAgent[agentName.toLowerCase()];
    if (!data || data.total < 3) return null;
    const color = data.promoters > data.detractors ? "#16a34a" : data.detractors > data.promoters ? "#dc2626" : "#6b7280";
    return (
      <span title={`tNPS: ${data.score > 0 ? "+" : ""}${data.score} (${data.total} surveys)`}
        style={{ display: "inline-block", marginLeft: 5, padding: "1px 5px", borderRadius: 3, fontSize: "0.65rem", fontWeight: 600, fontFamily: "var(--font-data, monospace)", background: color + "18", color, verticalAlign: "middle" }}>
        {data.score > 0 ? "+" : ""}{data.score}
      </span>
    );
  };

  const hasSupervisors = agents.some(a => a.supervisor);
  const hasWeeklyData  = agents.some(a => a.weekNum);

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
      <div style={{ background: `var(--glass-bg)`, backdropFilter: "blur(12px) saturate(150%)", WebkitBackdropFilter: "blur(12px) saturate(150%)", borderBottom: "1px solid var(--glass-border)", padding: "1rem 2.5rem", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "1rem", flexShrink: 0 }}>
        <div>
          <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.68rem", color: `var(--text-muted)`, letterSpacing: "0.08em", textTransform: "uppercase", fontWeight: 500 }}>
            {siteFilter ? `${siteFilter} · ${getMbrCategory(jobType)}` : `${totalRowCount} records`}
          </div>
          <div style={{ fontFamily: "var(--font-display, Inter, sans-serif)", fontSize: "1.75rem", color: `var(--text-warm)`, fontWeight: 800, letterSpacing: "-0.02em", lineHeight: 1.15, marginTop: "0.15rem" }}>
            {jobType}
          </div>
          {rocOptions.length > 0 && (
            <div style={{ display: "flex", gap: "0.35rem", marginTop: "0.4rem", flexWrap: "wrap" }}>
              <button onClick={() => setRocFilter(null)}
                style={{ padding: "0.2rem 0.6rem", borderRadius: "var(--radius-sm, 6px)", border: `1px solid ${!rocFilter ? "#d97706" : "var(--border)"}`, background: !rocFilter ? "#d9770618" : "transparent", color: !rocFilter ? "#d97706" : `var(--text-dim)`, fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.9rem", cursor: "pointer" }}>
                All
              </button>
              {rocOptions.map(opt => (
                <button key={opt.roc} onClick={() => setRocFilter(rocFilter === opt.roc ? null : opt.roc)}
                  style={{ padding: "0.2rem 0.6rem", borderRadius: "var(--radius-sm, 6px)", border: `1px solid ${rocFilter === opt.roc ? "#6366f1" : "var(--border)"}`, background: rocFilter === opt.roc ? "#6366f118" : "transparent", color: rocFilter === opt.roc ? "#6366f1" : `var(--text-dim)`, fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.9rem", cursor: "pointer", display: "flex", gap: "0.3rem", alignItems: "center" }}>
                  <span>{opt.roc}</span>
                  {opt.funding && <span style={{ fontSize: "0.8rem", color: rocFilter === opt.roc ? "#818cf8" : `var(--text-faint)` }}>{opt.funding}</span>}
                </button>
              ))}
            </div>
          )}
        </div>
        <div style={{ display: "flex", gap: "0.3rem", flexWrap: "wrap" }}>
          {tabs.map(t => (
            <button key={t} onClick={() => setTab(t)}
              style={{ padding: "0.4rem 0.8rem", borderRadius: "var(--radius-sm, 6px)", border: `1px solid ${tab===t?"#d9770650":"var(--text-faint)"}`, background: tab===t?"#d9770612":"transparent", color: tab===t?"#d97706":`var(--text-muted)`, fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.75rem", cursor: "pointer", textTransform: "capitalize", fontWeight: tab===t ? 600 : 400, transition: "all 200ms cubic-bezier(0.4,0,0.2,1)" }}>
              {t === "overview" ? "Overview" : t === "agents" ? "All Agents" : t === "teams" ? "Teams" : t === "goals" ? "Ranking" : t === "daily" ? "Daily" : t}
            </button>
          ))}
        </div>
      </div>

      {/* Scrollable content */}
      <div style={{ flex: 1, overflowY: "auto", padding: "2rem 2.5rem" }}>

        {/* ── OVERVIEW TAB ── */}
        {tab === "overview" && (
          <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
            {/* Site comparison card — only renders when both DR and BZ dial this program */}
            {siteFilter && (
              <ProgramSiteCompareCard program={program} allAgents={allAgents} newHireSet={newHireSet} goalLookup={goalLookup} />
            )}
            {/* Stat cards */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: "0.75rem" }}>
              <StatCard label="Agents"       value={fUniqueCount}            sub={rocFilter ? `filtered by ${rocFilter}` : `${distUnique.Q1} Q1 of ${uniqueAgentCount}`} accent="#d97706" />
              <StatCard label="GPH"          value={fmt(fGph, 2)}            sub="sum goals / sum hours"                                   accent="#2563eb" />
              <StatCard label="Total Goals"  value={fTotalGoals}             sub={planGoals ? `of ${planGoals} plan (${Math.round(attainment)}%)` : "conversions"} accent="#16a34a" />
              <StatCard label="Total Hours"  value={fmt(fTotalHours, 0)}     sub={rocFilter ? `${rocFilter} agents` : `${highHoursCount} over 16 hrs`} accent="#6366f1" />
              <StatCard label="Health Score" value={Math.round(healthScore)} sub="0\u2013100 composite"                                         accent={attainColor(healthScore)} />
            </div>

            {/* Narrative Summary */}
            <CollapsibleNarrative title="Executive Summary" lines={narrative} defaultOpen={false} aiEnabled={localAI} aiPromptData={localAI ? { ...program, fiscalInfo } : null} />

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
                <div style={{ background: `var(--bg-secondary)`, border: "1px solid var(--border)", borderRadius: "var(--radius-lg, 16px)", padding: "1.25rem 1.5rem" }}>
                  <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.78rem", color: `var(--text-faint)`, letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: "0.75rem" }}>
                    GOAL BREAKOUT BY FUNDING
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: `2.5fr ${sites.map(() => "1fr 1fr 1fr").join(" ")}`, gap: "0.4rem 0.75rem", alignItems: "center" }}>
                    {/* Header */}
                    <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.85rem", color: `var(--text-faint)` }}>Target</div>
                    {sites.map(s => (
                      <Fragment key={s}>
                        <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.85rem", color: `var(--text-faint)`, textAlign: "right" }}>{s} Homes</div>
                        <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.85rem", color: `var(--text-faint)`, textAlign: "right" }}>{s} Hours</div>
                        <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.85rem", color: `var(--text-faint)`, textAlign: "right" }}>{s} SPH</div>
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
                            <span style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.88rem", color: `var(--text-dim)` }}>{roc}</span>
                            <span style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.8rem", color: `var(--text-secondary)` }}>{t}</span>
                            {funding && <span style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.8rem", color: "#6366f1", background: "#6366f108", border: "1px solid #6366f130", borderRadius: "3px", padding: "0 0.25rem" }}>{funding}</span>}
                          </div>
                          {sites.map(s => {
                            const sRows = tRows.filter(r => {
                              const rSite = (findCol(r, "Site") || "").trim().toUpperCase();
                              return rSite === s;
                            });
                            if (sRows.length === 0) return (
                              <Fragment key={s}>
                                <div style={{ textAlign: "right", fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.78rem", color: `var(--text-faint)`, borderTop: "1px solid var(--bg-tertiary)", padding: "0.3rem 0" }}>{"\u2014"}</div>
                                <div style={{ textAlign: "right", fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.78rem", color: `var(--text-faint)`, borderTop: "1px solid var(--bg-tertiary)", padding: "0.3rem 0" }}>{"\u2014"}</div>
                                <div style={{ textAlign: "right", fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.78rem", color: `var(--text-faint)`, borderTop: "1px solid var(--bg-tertiary)", padding: "0.3rem 0" }}>{"\u2014"}</div>
                              </Fragment>
                            );
                            const pr = sRows.map(r => computePlanRow(r));
                            const homes = pr.reduce((a, p) => a + p.homesGoal, 0);
                            const hours = pr.reduce((a, p) => a + p.hoursGoal, 0);
                            const sph = pr.length > 0 ? pr.reduce((a, p) => a + p.sphGoal, 0) / pr.length : 0;
                            return (
                              <Fragment key={s}>
                                <div style={{ textAlign: "right", fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.78rem", color: `var(--text-primary)`, borderTop: "1px solid var(--bg-tertiary)", padding: "0.3rem 0" }}>{homes.toLocaleString()}</div>
                                <div style={{ textAlign: "right", fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.78rem", color: `var(--text-primary)`, borderTop: "1px solid var(--bg-tertiary)", padding: "0.3rem 0" }}>{Math.round(hours).toLocaleString()}</div>
                                <div style={{ textAlign: "right", fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.78rem", color: `var(--text-primary)`, borderTop: "1px solid var(--bg-tertiary)", padding: "0.3rem 0" }}>{sph.toFixed(3)}</div>
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
            <div style={{ background: `var(--bg-secondary)`, border: "1px solid var(--border)", borderRadius: "var(--radius-lg, 16px)", padding: "1.5rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.1rem" }}>
                <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.82rem", color: `var(--text-muted)`, letterSpacing: "0.12em", textTransform: "uppercase" }}>Quartile Distribution</div>
                <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.82rem", color: `var(--text-faint)` }}>ranked on total period GPH</div>
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
                        const active = inQ.filter(a => a.hours >= getMinHours()).length;
                        const pct    = agentList.length ? Math.round(total / agentList.length * 100) : 0;
                        const qHours = inQ.reduce((s, a) => s + a.hours, 0);
                        return (
                          <div key={q} style={{ padding: "1rem", borderRadius: "var(--radius-md, 10px)", background: Q[q].color+"12", border: `1px solid ${Q[q].color}30`, textAlign: "center" }}>
                            <div style={{ fontFamily: "var(--font-display, Inter, sans-serif)", fontSize: "2.5rem", color: Q[q].color, fontWeight: 700, lineHeight: 1 }}>{active}</div>
                            <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.8rem", color: Q[q].color, marginTop: "0.2rem" }}>{q} {getMinHours()}+ hrs</div>
                            <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.8rem", color: `var(--text-muted)`, marginTop: "0.15rem" }}>{Q[q].label}</div>
                            <div style={{ marginTop: "0.5rem", paddingTop: "0.5rem", borderTop: `1px solid ${Q[q].color}20` }}>
                              <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.8rem", color: `var(--text-dim)` }}>{total} total · {pct}%</div>
                              <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.8rem", color: "#6366f1", marginTop: "0.2rem" }}>{fmt(qHours, 0)} hrs</div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    <div style={{ marginBottom: "0.4rem" }}>
                      <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.82rem", color: `var(--text-dim)`, marginBottom: "0.25rem" }}>UNIQUE AGENTS BY QUARTILE</div>
                      <div style={{ display: "flex", height: "8px", borderRadius: "6px", overflow: "hidden" }}>
                        {["Q1","Q2","Q3","Q4"].map(q => (
                          <div key={q} style={{ flex: agentList.filter(a=>a.quartile===q).length||0, background: Q[q].color, transition: "flex 0.6s" }} />
                        ))}
                      </div>
                    </div>
                    <div>
                      <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.82rem", color: `var(--text-dim)`, marginBottom: "0.25rem" }}>HOURS BY QUARTILE</div>
                      <div style={{ display: "flex", height: "6px", borderRadius: "var(--radius-sm, 6px)", overflow: "hidden" }}>
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
              <div style={{ background: `var(--bg-secondary)`, border: "1px solid var(--border)", borderRadius: "var(--radius-lg, 16px)", padding: "1.5rem" }}>
                <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.82rem", color: `var(--text-muted)`, letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: "1.1rem" }}>Quartile Breakdown by Site</div>
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
                    const over16    = regionAgents.filter(a => a.hours >= getMinHours()).length;
                    const rTotal    = regionAgents.length;
                    return (
                      <div key={r.name} style={{ padding: "0.9rem 1rem", background: `var(--bg-primary)`, borderRadius: "var(--radius-md, 10px)", border: "1px solid var(--bg-tertiary)" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.6rem" }}>
                          <span style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "1.27rem", color: `var(--text-primary)`, fontWeight: 600 }}>{mbrSiteName(r.name)}</span>
                          <div style={{ display: "flex", gap: "1rem", alignItems: "center" }}>
                            <span style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.82rem", color: "#6366f1" }}>{fmt(totalRHrs, 0)} hrs{over16 > 0 ? ` · ${over16} at 16+` : ""}</span>
                            <span style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.82rem", color: `var(--text-muted)` }}>{rTotal} agents</span>
                          </div>
                        </div>
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "0.4rem", marginBottom: "0.5rem" }}>
                          {["Q1","Q2","Q3","Q4"].map(q => {
                            const inQ    = regionAgents.filter(a => a.quartile === q);
                            const active = inQ.filter(a => a.hours >= getMinHours()).length;
                            return (
                            <div key={q} style={{ padding: "0.4rem 0.5rem", borderRadius: "var(--radius-sm, 6px)", background: Q[q].color+"15", border: `1px solid ${Q[q].color}30`, textAlign: "center" }}>
                              <div style={{ fontFamily: "var(--font-display, Inter, sans-serif)", fontSize: "1.5rem", color: Q[q].color, fontWeight: 700, lineHeight: 1 }}>{active}</div>
                              <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.82rem", color: Q[q].color+"cc", marginTop: "0.1rem" }}>{q} · 16+</div>
                              <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.81rem", color: `var(--text-faint)`, marginTop: "0.1rem" }}>{rd[q]} total</div>
                            </div>
                            );
                          })}
                        </div>
                        <div style={{ display: "flex", height: "8px", borderRadius: "var(--radius-sm, 6px)", overflow: "hidden", gap: "1px" }}>
                          {["Q1","Q2","Q3","Q4"].map(q => rd[q] > 0 && (
                            <div key={q} style={{ flex: rd[q], background: Q[q].color }} />
                          ))}
                        </div>
                        <div style={{ display: "flex", gap: "0.75rem", marginTop: "0.35rem" }}>
                          {["Q1","Q2","Q3","Q4"].map(q => rHoursByQ[q] > 0 && (
                            <span key={q} style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.8rem", color: Q[q].color+"99" }}>{q}: {fmt(rHoursByQ[q], 0)}h</span>
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
              <div style={{ background: "var(--nh-bg)", border: `1px solid var(--nh-border)`, borderRadius: "var(--radius-md, 10px)", padding: "0.85rem 1.25rem", display: "flex", alignItems: "center", gap: "0.75rem" }}>
                <span style={{ fontSize: "1.5rem" }}>🌱</span>
                <span style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.88rem", color: "var(--text-secondary)" }}>
                  <strong style={{ color: "var(--nh-color)" }}>{newHiresInProgram.length} new hire{newHiresInProgram.length > 1 ? "s" : ""}</strong> active in this program ({newHiresInProgram.map(a => a.agentName).join(", ")}). Enhanced contextual insights included below.
                </span>
              </div>
            )}

            {/* Insights */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1.25rem" }}>
              <InsightCard type="win" insights={winInsights} aiEnabled={localAI} aiPromptData={localAI ? { ...program, fiscalInfo } : null} />
              <InsightCard type="opp" insights={oppInsights} aiEnabled={localAI} aiPromptData={localAI ? { ...program, fiscalInfo } : null} />
            </div>

            {/* Top performers + Priority Coaching */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1.25rem" }}>
              <div style={{ background: `var(--bg-secondary)`, border: "1px solid var(--border)", borderRadius: "var(--radius-lg, 16px)", padding: "1.25rem" }}>
                <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.8rem", color: "#16a34a", letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: "0.35rem" }}>Top Performers</div>
                <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.82rem", color: `var(--text-dim)`, marginBottom: "0.9rem" }}>Q1 & Q2 {getMinHours()}+ hours only</div>
                {(() => {
                  const topList = [...q1Agents, ...q2Agents].filter(a => a.hours >= getMinHours()).sort((a, b) => b.hours - a.hours).slice(0, 5);
                  if (topList.length === 0) return <div style={{ color: `var(--text-faint)`, fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.88rem" }}>No Q1/Q2 agents with {getMinHours()}+ hours yet</div>;
                  return topList.map((a, i) => {
                    const gph = a.hours > 0 ? (a.goals / a.hours).toFixed(3) : "0.000";
                    const pct = `${Math.round(a.pctToGoal)}%`;
                    return (
                    <Fragment key={i}>
                    <div onClick={() => setExpandedAgent(expandedAgent === a.agentName ? null : a.agentName)} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0.5rem 0", borderBottom: i < topList.length-1 ? "1px solid var(--bg-tertiary)" : "none", cursor: "pointer" }}>
                      <div>
                        <div style={{ color: `var(--text-warm)`, fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.88rem", display: "flex", alignItems: "center", gap: "0.4rem" }}>
                          {a.agentName}
                          {newHireSet.has(a.agentName) && <span style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.8rem", color: "var(--nh-color)", background: "var(--nh-bg)", padding: "0.05rem 0.3rem", borderRadius: "2px" }}>NEW</span>}
                          {agentTnpsBadge(a.agentName)}
                        </div>
                        <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.82rem", color: `var(--text-dim)` }}>{mbrSiteName(a.region)} · {fmt(a.hours, 1)} hrs · {gph} GPH</div>
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "0.25rem" }}>
                        <div style={{ fontFamily: "var(--font-display, Inter, sans-serif)", fontSize: "1.15rem", color: Q[a.quartile].color, fontWeight: 700 }}>{pct}</div>
                        <QBadge q={a.quartile} />
                      </div>
                    </div>
                    {expandedAgent === a.agentName && tnpsByAgent && tnpsByAgent[a.agentName.toLowerCase()] && tnpsByAgent[a.agentName.toLowerCase()].total >= 1 && (() => {
                      const agentTnps = tnpsByAgent[a.agentName.toLowerCase()];
                      return (
                        <div style={{ marginTop: "0.75rem", borderTop: "1px solid var(--border)", paddingTop: "0.5rem" }}>
                          <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.72rem", color: "var(--text-muted)", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: "0.35rem" }}>
                            tNPS Surveys ({agentTnps.total}) · Score: {agentTnps.score > 0 ? "+" : ""}{agentTnps.score}
                          </div>
                          {[...agentTnps.surveys].sort((a, b) => (b.date || 0) - (a.date || 0)).slice(0, 10).map((s, si) => (
                            <div key={si} style={{ display: "flex", alignItems: "flex-start", gap: "0.5rem", padding: "0.3rem 0", borderBottom: "1px solid var(--bg-tertiary)" }}>
                              <span style={{ display: "inline-block", padding: "1px 6px", borderRadius: 3, fontSize: "0.72rem", fontWeight: 700, fontFamily: "var(--font-data, monospace)", color: "#fff", background: s.category === "promoter" ? "#16a34a" : s.category === "detractor" ? "#dc2626" : "#d97706", flexShrink: 0 }}>{s.score}</span>
                              <span style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.72rem", color: "var(--text-dim)", flexShrink: 0, width: 70 }}>{s.date ? s.date.toLocaleDateString("en-US", { month: "short", day: "numeric" }) : ""}</span>
                              <span style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.72rem", color: "var(--text-dim)", flexShrink: 0, width: 80 }}>{s.campaign}</span>
                              <span style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.78rem", color: "var(--text-secondary)", flex: 1 }}>{s.reason || "\u2014"}</span>
                            </div>
                          ))}
                        </div>
                      );
                    })()}
                    </Fragment>
                    );
                  });
                })()}
              </div>

              <div style={{ background: `var(--bg-secondary)`, border: "1px solid var(--border)", borderRadius: "var(--radius-lg, 16px)", padding: "1.25rem" }}>
                <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.8rem", color: "#dc2626", letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: "0.35rem" }}>Priority Coaching</div>
                <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.82rem", color: `var(--text-dim)`, marginBottom: "0.9rem" }}>Zero sales · ranked by hours invested</div>
                {q4Agents.length === 0 ? (
                  <div style={{ color: `var(--text-faint)`, fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.88rem" }}>No Q4 agents — excellent!</div>
                ) : q4Agents.slice(0, 5).map((a, i) => (
                  <Fragment key={i}>
                  <div onClick={() => setExpandedAgent(expandedAgent === a.agentName ? null : a.agentName)} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0.5rem 0", borderBottom: i < Math.min(q4Agents.length,5)-1 ? "1px solid var(--bg-tertiary)" : "none", cursor: "pointer" }}>
                    <div>
                      <div style={{ color: `var(--text-warm)`, fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.88rem", display: "flex", alignItems: "center", gap: "0.4rem" }}>
                        {a.agentName}
                        {newHireSet.has(a.agentName) && <span style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.8rem", color: "var(--nh-color)", background: "var(--nh-bg)", padding: "0.05rem 0.3rem", borderRadius: "2px" }}>NEW</span>}
                        {a.hours > 16 && <span style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.8rem", color: "#6366f1", background: "#6366f120", padding: "0.05rem 0.3rem", borderRadius: "2px" }}>16+ HRS</span>}
                        {agentTnpsBadge(a.agentName)}
                      </div>
                      <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.82rem", color: `var(--text-dim)` }}>{mbrSiteName(a.region)} · 0 sales</div>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "0.25rem" }}>
                      <div style={{ fontFamily: "var(--font-display, Inter, sans-serif)", fontSize: "1.15rem", color: "#6366f1", fontWeight: 700 }}>{fmt(a.hours, 1)} hrs</div>
                      <QBadge q={a._q} />
                    </div>
                  </div>
                  {expandedAgent === a.agentName && tnpsByAgent && tnpsByAgent[a.agentName.toLowerCase()] && tnpsByAgent[a.agentName.toLowerCase()].total >= 1 && (() => {
                    const agentTnps = tnpsByAgent[a.agentName.toLowerCase()];
                    return (
                      <div style={{ marginTop: "0.75rem", borderTop: "1px solid var(--border)", paddingTop: "0.5rem" }}>
                        <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.72rem", color: "var(--text-muted)", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: "0.35rem" }}>
                          tNPS Surveys ({agentTnps.total}) · Score: {agentTnps.score > 0 ? "+" : ""}{agentTnps.score}
                        </div>
                        {[...agentTnps.surveys].sort((a, b) => (b.date || 0) - (a.date || 0)).slice(0, 10).map((s, si) => (
                          <div key={si} style={{ display: "flex", alignItems: "flex-start", gap: "0.5rem", padding: "0.3rem 0", borderBottom: "1px solid var(--bg-tertiary)" }}>
                            <span style={{ display: "inline-block", padding: "1px 6px", borderRadius: 3, fontSize: "0.72rem", fontWeight: 700, fontFamily: "var(--font-data, monospace)", color: "#fff", background: s.category === "promoter" ? "#16a34a" : s.category === "detractor" ? "#dc2626" : "#d97706", flexShrink: 0 }}>{s.score}</span>
                            <span style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.72rem", color: "var(--text-dim)", flexShrink: 0, width: 70 }}>{s.date ? s.date.toLocaleDateString("en-US", { month: "short", day: "numeric" }) : ""}</span>
                            <span style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.72rem", color: "var(--text-dim)", flexShrink: 0, width: 80 }}>{s.campaign}</span>
                            <span style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.78rem", color: "var(--text-secondary)", flex: 1 }}>{s.reason || "\u2014"}</span>
                          </div>
                        ))}
                      </div>
                    );
                  })()}
                  </Fragment>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ── REGIONS TAB ── */}
        {/* ── AGENTS TAB ── */}
        {tab === "agents" && (
          <div style={{ background: `var(--bg-secondary)`, border: "1px solid var(--border)", borderRadius: "var(--radius-lg, 16px)", padding: "1.5rem" }}>
            <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.82rem", color: `var(--text-muted)`, letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: "1.1rem" }}>
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
              <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.82rem", color: `var(--text-muted)`, letterSpacing: "0.12em", textTransform: "uppercase" }}>
                Supervisor Ranking {progSphGoal ? ` | SPH Goal: ${progSphGoal.toFixed(3)}` : ""}
              </div>

              {/* Ranking table */}
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.78rem" }}>
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
                        <Fragment key={s.name}><tr onClick={() => setExpandedRankSup(expandedRankSup === s.name ? null : s.name)} style={{ cursor: "pointer", borderBottom: "1px solid var(--bg-tertiary)", background: isTop ? "#16a34a08" : isBot ? "#dc262608" : i % 2 === 0 ? "transparent" : `var(--bg-row-alt)` }}>
                          <td style={{ padding: "0.4rem 0.5rem", color: isTop ? "#16a34a" : isBot ? "#dc2626" : `var(--text-dim)`, fontWeight: 700 }}>{i + 1}</td>
                          <td style={{ padding: "0.4rem 0.5rem", color: `var(--text-warm)`, fontFamily: "var(--font-ui, Inter, sans-serif)" }}>
                            {s.name}
                            {isTop && <span style={{ marginLeft: "0.4rem", fontSize: "0.8rem", color: "#16a34a", background: "#16a34a15", border: "1px solid #16a34a30", borderRadius: "3px", padding: "0.05rem 0.3rem" }}>TOP</span>}
                          </td>
                          <td style={{ padding: "0.4rem 0.5rem", color: `var(--text-dim)`, fontSize: "0.85rem", maxWidth: "120px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={s.regions.split(", ").map(r => mbrSiteName(r)).join(", ")}>{s.regions.split(", ").map(r => mbrSiteName(r)).join(", ")}</td>
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
                      {expandedRankSup === s.name && <RankingAgentTray sup={s} colCount={15} allAgents={allAgents} />}
                      </Fragment>
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
          <DailyBreakdownPanel agents={filteredAgents} regions={regions} jobType={jobType} singleProgram={true} priorAgents={priorAgents ? priorAgents.filter(a => a.jobType === jobType) : []} sphGoal={
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

// ── TVMode — Screensaver for TV displays ─────────────────────────────────────
// Full-screen auto-rotating view using current theme, site filter, campaign comparison.
function TVMode({ d, codes, doFetch, lastRefresh, onExit, activeOnly, setActiveOnly, prevAgentHours }) {
  const [slideIdx, setSlideIdx] = useState(0);
  const [tvSite, setTvSite] = useState("ALL");
  const autoScrollRef = useRef(null);
  const agentScrollRef = useRef(null);

  // Auto-scroll any overflow container when slide changes
  useEffect(() => {
    const el = autoScrollRef.current;
    if (!el) return;
    el.scrollTop = 0;
    const scrollMax = el.scrollHeight - el.clientHeight;
    if (scrollMax <= 0) return; // no overflow
    const pauseMs = 2000; // pause at top and bottom
    const scrollDuration = CYCLE_MS - pauseMs * 2;
    let startTime = null;
    let phase = "pause-top"; // pause-top → scrolling → pause-bottom
    let frame;
    const phaseStart = performance.now();
    const step = (now) => {
      if (phase === "pause-top") {
        if (now - phaseStart >= pauseMs) { phase = "scrolling"; startTime = now; }
      } else if (phase === "scrolling") {
        const elapsed = now - startTime;
        const pct = Math.min(elapsed / scrollDuration, 1);
        // ease-in-out
        const ease = pct < 0.5 ? 2 * pct * pct : 1 - Math.pow(-2 * pct + 2, 2) / 2;
        el.scrollTop = ease * scrollMax;
        if (pct >= 1) phase = "done";
      } else { return; }
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [slideIdx]);

  // Auto-scroll agent leaderboard
  useEffect(() => {
    const el = agentScrollRef.current;
    if (!el) return;
    el.scrollTop = 0;
    const scrollMax = el.scrollHeight - el.clientHeight;
    if (scrollMax <= 0) return;
    const pauseMs = 2000;
    const scrollDuration = CYCLE_MS - pauseMs * 2;
    let startTime = null;
    let phase = "pause-top";
    let frame;
    const phaseStart = performance.now();
    const step = (now) => {
      if (phase === "pause-top") {
        if (now - phaseStart >= pauseMs) { phase = "scrolling"; startTime = now; }
      } else if (phase === "scrolling") {
        const elapsed = now - startTime;
        const pct = Math.min(elapsed / scrollDuration, 1);
        const ease = pct < 0.5 ? 2 * pct * pct : 1 - Math.pow(-2 * pct + 2, 2) / 2;
        el.scrollTop = ease * scrollMax;
        if (pct >= 1) phase = "done";
      } else { return; }
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [slideIdx]);
  const CYCLE_MS = 12000;
  const COST_PER_HOUR = 19.77;

  const getSite = (reg) => (reg || "").toUpperCase().includes("XOTM") ? "BZ" : "DR";

  // Group programs by campaign name, with per-site breakdowns
  const campaignMap = useMemo(() => {
    if (!d) return {};
    const map = {};
    d.programs.forEach(p => {
      const key = p.grp;
      if (!map[key]) map[key] = { grp: key, sites: {} };
      const site = getSite(p.reg);
      if (!map[key].sites[site]) map[key].sites[site] = { hrs: 0, goals: 0, rgu: 0, hsd: 0, xm: 0, agents: new Set(), pctSum: 0, pctCount: 0 };
      const s = map[key].sites[site];
      s.hrs += p.hrs; s.goals += p.effectiveGoals; s.rgu += p.rgu;
      s.hsd += p.hsd || 0; s.xm += p.xml || 0;
      if (p.pctToGoal !== null && p.pctToGoal !== undefined) { s.pctSum += p.pctToGoal * p.agentCount; s.pctCount += p.agentCount; }
      p.agts.forEach(n => s.agents.add(n));
    });
    return map;
  }, [d]);

  // Build slides based on site filter
  const slides = useMemo(() => {
    if (!d) return [];
    const s = [];
    const siteAgents = tvSite === "ALL" ? d.agents : d.agents.filter(a => getSite(a.reg) === tvSite);
    const sitePrograms = tvSite === "ALL" ? d.programs : d.programs.filter(p => getSite(p.reg) === tvSite);

    // Overview slide
    const totHrs = siteAgents.reduce((a, x) => a + x.hrs, 0);
    const totGoals = siteAgents.reduce((a, x) => a + x.effectiveGoals, 0);
    const totRgu = siteAgents.reduce((a, x) => a + x.rgu, 0);
    const totHsd = sitePrograms.reduce((a, p) => a + (p.hsd || 0), 0);
    const totXm = sitePrograms.reduce((a, p) => a + (p.xml || 0), 0);
    s.push({ type: "overview", label: tvSite === "ALL" ? "Company Overview" : tvSite === "DR" ? "Dominican Republic" : "Belize",
      agentCount: siteAgents.length, hrs: totHrs, goals: totGoals, rgu: totRgu, hsd: totHsd, xm: totXm, programs: sitePrograms });

    // Per-campaign slides (exclude Spanish Callback)
    const grpTotals = {};
    sitePrograms.filter(p => !/(spanish callback|\bfeb\b|\bmar\b|^unknown$)/i.test(p.grp || "")).forEach(p => {
      if (!grpTotals[p.grp]) grpTotals[p.grp] = { grp: p.grp, hrs: 0, goals: 0, rgu: 0, hsd: 0, xm: 0, agents: new Set(), pctSum: 0, pctCount: 0 };
      const g = grpTotals[p.grp];
      g.hrs += p.hrs; g.goals += p.effectiveGoals; g.rgu += p.rgu;
      g.hsd += p.hsd || 0; g.xm += p.xml || 0;
      p.agts.forEach(n => g.agents.add(n));
      if (p.pctToGoal !== null && p.pctToGoal !== undefined) { g.pctSum += p.pctToGoal * p.agentCount; g.pctCount += p.agentCount; }
    });
    Object.values(grpTotals).sort((a, b) => b.hrs - a.hrs).forEach(g => {
      const bothSites = campaignMap[g.grp] && Object.keys(campaignMap[g.grp].sites).length > 1;
      const campAgents = siteAgents.filter(a => g.agents.has(a.name))
        .sort((a, b) => b.effectiveGoals - a.effectiveGoals || b.hrs - a.hrs);
      // Determine site for single-site campaigns
      const campSites = [...new Set(sitePrograms.filter(p => p.grp === g.grp).map(p => getSite(p.reg)))];
      const siteName = campSites.length === 1 ? (campSites[0] === "DR" ? "Dominican Republic" : "Belize") : null;
      // Slide 1: comparison (shared) or stats+leaderboard (single)
      s.push({ type: "campaign", label: g.grp, ...g, agentCount: g.agents.size,
        pctToGoal: g.pctCount > 0 ? g.pctSum / g.pctCount : null,
        bothSites, comparison: bothSites ? campaignMap[g.grp].sites : null,
        topAgents: campAgents.slice(0, 5), siteName });
      // Slide 2 for shared campaigns: stats grid + leaderboard
      if (bothSites) {
        s.push({ type: "campaign-detail", label: g.grp, ...g, agentCount: g.agents.size,
          pctToGoal: g.pctCount > 0 ? g.pctSum / g.pctCount : null,
          topAgents: campAgents.slice(0, 6), siteName: null });
      }
    });

    return s;
  }, [d, tvSite, campaignMap]);

  const slidesLenRef = useRef(slides.length);
  slidesLenRef.current = slides.length;
  useEffect(() => { setSlideIdx(0); }, [tvSite]);
  useEffect(() => {
    if (slides.length <= 1) return;
    const timer = setInterval(() => setSlideIdx(i => (i + 1) % slidesLenRef.current), CYCLE_MS);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    const interval = setInterval(doFetch, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [doFetch]);
  useEffect(() => {
    const handler = e => { if (e.key === "Escape") onExit(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onExit]);

  if (slides.length === 0) return null;
  const slide = slides[slideIdx % slides.length];
  const fmt = (v, dec = 0) => dec > 0 ? Number(v).toFixed(dec) : Math.round(v).toLocaleString();
  const now = lastRefresh ? new Date(lastRefresh).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";
  const cps = (hrs, goals) => {
    const val = goals > 0 ? (hrs * COST_PER_HOUR) / goals : hrs * COST_PER_HOUR;
    return `$${Math.round(val).toLocaleString()}`;
  };
  const pctFmt = (v) => v !== null && v !== undefined ? `${Math.round(v)}%` : "–";
  const goalColor = (pct) => pct !== null && pct !== undefined ? (pct >= 100 ? "#16a34a" : pct >= 90 ? "#22c55e" : pct >= 70 ? "#d97706" : pct >= 50 ? "#ea580c" : "#dc2626") : `var(--text-faint)`;

  // Stat card — big number with label
  const Stat = ({ value, label, color }) => (
    <div style={{ flex: "1 1 0", textAlign: "center", padding: "0.75rem 0.25rem", overflow: "hidden" }}>
      <div style={{ fontFamily: "var(--font-display, Inter, sans-serif)", fontSize: "clamp(2rem, 4vw, 3.5rem)", color, fontWeight: 800, lineHeight: 1, letterSpacing: "-0.03em", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{value}</div>
      <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "clamp(1.2rem, 2vw, 1.8rem)", color: `var(--text-muted)`, marginTop: "0.3rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em" }}>{label}</div>
    </div>
  );

  // Site comparison column — label above value for each metric
  const SiteCol = ({ data, label, color }) => {
    if (!data) return null;
    const sGph = data.hrs > 0 ? data.goals / data.hrs : 0;
    const sPct = data.pctCount > 0 ? data.pctSum / data.pctCount : null;
    const metrics = [
      { l: "Agents", v: data.agents.size, c: "#16a34a" },
      { l: "Hours", v: Math.round(data.hrs), c: "#6366f1" },
      { l: "Sales", v: data.goals, c: "#d97706" },
      { l: "GPH", v: sGph.toFixed(2), c: goalColor(sPct) },
      { l: "RGU", v: data.rgu || "–", c: "#2563eb" },
      { l: "HSD", v: data.hsd || "–", c: "#f59e0b" },
      { l: "XM", v: data.xm || "–", c: "#ec4899" },
      { l: "CPS", v: cps(data.hrs, data.goals), c: goalColor(sPct) },
      { l: "Goal", v: sPct !== null ? `${Math.round(sPct)}%` : "–", c: goalColor(sPct) },
    ];
    return (
      <div style={{ flex: "1 1 0", background: `var(--bg-tertiary)`, borderRadius: "var(--radius-lg, 16px)", padding: "1.5rem", border: `2px solid ${color}30`, overflow: "hidden", display: "flex", flexDirection: "column" }}>
        <div style={{ fontFamily: "var(--font-display, Inter, sans-serif)", fontSize: "clamp(1.6rem, 3vw, 2.4rem)", color, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: "0.75rem", textAlign: "center", flexShrink: 0 }}>{label}</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1.4fr 1fr", gap: "0", flex: 1, alignContent: "stretch" }}>
          {metrics.map(({ l, v, c }) => {
            const vStr = String(v);
            const vFont = vStr.length >= 7 ? "clamp(1.8rem, 3.5vw, 3rem)" : vStr.length >= 5 ? "clamp(2.4rem, 4.5vw, 4rem)" : "clamp(2.8rem, 5.5vw, 5rem)";
            return (
              <div key={l} style={{ textAlign: "center", overflow: "hidden", display: "flex", flexDirection: "column", justifyContent: "center" }}>
                <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "clamp(1.8rem, 3.5vw, 2.8rem)", color: `var(--text-muted)`, textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 700 }}>{l}</div>
                <div style={{ fontFamily: "var(--font-data, monospace)", fontSize: vFont, color: c, fontWeight: 800, lineHeight: 1, whiteSpace: "nowrap" }}>{v}</div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const renderSlide = () => {
    const gph = slide.hrs > 0 ? slide.goals / slide.hrs : 0;
    const pct = slide.pctToGoal;

    if (slide.type === "overview") {
      // Aggregate programs by name
      const progRows = slide.programs.filter(p => !/(spanish callback|\bfeb\b|\bmar\b|^unknown$)/i.test(p.grp || "")).sort((a, b) => b.hrs - a.hrs).reduce((acc, p) => {
        const existing = acc.find(x => x.grp === p.grp);
        if (existing) { existing.hrs += p.hrs; existing.goals += p.effectiveGoals; existing.rgu += p.rgu; existing.hsd += p.hsd || 0; existing.xm += p.xml || 0; p.agts.forEach(n => existing._agents.add(n)); if (p.pctToGoal !== null) { existing._pctSum += p.pctToGoal * p.agentCount; existing._pctN += p.agentCount; } }
        else acc.push({ grp: p.grp, hrs: p.hrs, goals: p.effectiveGoals, rgu: p.rgu, hsd: p.hsd || 0, xm: p.xml || 0, _agents: new Set(p.agts), _pctSum: p.pctToGoal !== null ? p.pctToGoal * p.agentCount : 0, _pctN: p.pctToGoal !== null ? p.agentCount : 0 });
        return acc;
      }, []).sort((a, b) => b.hrs - a.hrs);

      const fewCampaigns = progRows.length <= 5;
      return (
        <div style={{ display: "flex", flexDirection: fewCampaigns ? "column" : "row", gap: "1.5rem", height: "100%", justifyContent: "center" }}>
          {/* Stats — top row when few campaigns, left column when many */}
          <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", flex: fewCampaigns ? "0 0 auto" : "1 1 0" }}>
            <div style={{ display: "grid", gridTemplateColumns: fewCampaigns ? "repeat(auto-fit, minmax(120px, 1fr))" : "1fr 1fr 1fr", gap: fewCampaigns ? "1rem" : "1.5rem" }}>
              {[
                { v: slide.agentCount, l: "On Floor", c: "#16a34a" },
                { v: Math.round(slide.hrs), l: "Hours", c: "#6366f1" },
                { v: slide.goals, l: "Sales", c: "#d97706" },
                { v: gph.toFixed(2), l: "GPH", c: goalColor(pct) },
                { v: slide.rgu || "–", l: "RGU", c: "#2563eb" },
                { v: cps(slide.hrs, slide.goals), l: "Cost/Sale", c: goalColor(pct) },
                { v: slide.hsd || "–", l: "HSD", c: "#f59e0b" },
                { v: slide.xm || "–", l: "XM Lines", c: "#ec4899" },
                ...(fewCampaigns ? [] : [{ v: progRows.length, l: "Campaigns", c: `var(--text-muted)` }]),
              ].map(({ v, l, c }) => (
                <div key={l} style={{ background: `var(--bg-tertiary)`, borderRadius: "var(--radius-lg, 16px)", padding: fewCampaigns ? "0.75rem 0.5rem" : "1rem", textAlign: "center", border: `1px solid ${c}20`, overflow: "hidden" }}>
                  <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: fewCampaigns ? "clamp(0.9rem, 1.5vw, 1.2rem)" : "clamp(1rem, 1.6vw, 1.3rem)", color: `var(--text-muted)`, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700, marginBottom: "0.1rem" }}>{l}</div>
                  <div style={{ fontFamily: "var(--font-display, Inter, sans-serif)", fontSize: fewCampaigns ? "clamp(1.5rem, 3vw, 2.5rem)" : "clamp(1.8rem, 3.5vw, 3rem)", color: c, fontWeight: 800, lineHeight: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{v}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Campaign table — header row + value rows, no repeated labels */}
          {(() => {
            const cols = ["Hrs","Sales","GPH","RGU","HSD","XM","CPS","Goal"];
            const fs = fewCampaigns;
            const gridCols = `minmax(${fs ? "10rem" : "8rem"}, ${fs ? "1.5fr" : "2fr"}) repeat(${cols.length}, 1fr)`;
            const valSize = fs ? "clamp(2rem, 3vw, 3rem)" : "clamp(0.9rem, 1.2vw, 1.15rem)";
            const headSize = fs ? "clamp(1.4rem, 2.2vw, 2rem)" : "clamp(0.75rem, 1vw, 0.95rem)";
            const nameSize = fs ? "clamp(1.1rem, 1.8vw, 1.5rem)" : "clamp(0.85rem, 1.2vw, 1.1rem)";
            const subSize = fs ? "clamp(0.9rem, 1.3vw, 1.15rem)" : "clamp(0.65rem, 0.9vw, 0.8rem)";
            return (
              <div style={{ display: "flex", flexDirection: "column", flex: fewCampaigns ? "1 1 auto" : "1 1 0", minHeight: 0 }}>
                {/* Header — always visible */}
                <div style={{ display: "grid", gridTemplateColumns: gridCols, alignItems: "end", gap: fs ? "1rem" : "0.5rem", padding: fs ? "0 2.5rem 0.5rem" : "0 1rem 0.3rem", borderBottom: `2px solid var(--border)`, flexShrink: 0 }}>
                  <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: headSize, color: `var(--text-muted)`, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em" }}>Campaign</div>
                  {cols.map(h => (
                    <div key={h} style={{ textAlign: "center", fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: headSize, color: `var(--text-muted)`, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em" }}>{h}</div>
                  ))}
                </div>
                {/* Scrolling data rows */}
                <div ref={autoScrollRef} style={{ overflow: "hidden", flex: 1, minHeight: 0, paddingTop: fs ? "0.5rem" : "0.35rem" }}>
                <div style={{ display: "flex", flexDirection: "column", gap: fs ? "0.5rem" : "0.35rem" }}>
                  {progRows.map((p, i) => {
                    const pGph = p.hrs > 0 ? p.goals / p.hrs : 0;
                    const pPct = p._pctN > 0 ? p._pctSum / p._pctN : null;
                    const pctColor = goalColor(pPct);
                    const vals = [
                      { v: Math.round(p.hrs), c: "#6366f1" },
                      { v: p.goals, c: "#d97706" },
                      { v: pGph.toFixed(2), c: pctColor },
                      { v: p.rgu || "–", c: "#2563eb" },
                      { v: p.hsd || "–", c: "#f59e0b" },
                      { v: p.xm || "–", c: "#ec4899" },
                      { v: cps(p.hrs, p.goals), c: pctColor },
                      { v: pPct !== null ? `${Math.round(pPct)}%` : "–", c: pctColor },
                    ];
                    return (
                      <div key={i} style={{ background: `var(--bg-tertiary)`, borderRadius: "var(--radius-md, 10px)", padding: fs ? "1.25rem 2.5rem" : "0.6rem 1rem", border: `1px solid var(--border)`,
                        display: "grid", gridTemplateColumns: gridCols, alignItems: "center", gap: fs ? "1rem" : "0.5rem" }}>
                        <div>
                          <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: nameSize, color: `var(--text-warm)`, fontWeight: 700, lineHeight: 1.2 }}>{p.grp}</div>
                          <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: subSize, color: `var(--text-faint)`, marginTop: "0.15rem" }}>{p._agents.size} agents</div>
                        </div>
                        {vals.map(({ v, c }, vi) => (
                          <div key={vi} style={{ textAlign: "center" }}>
                            <div style={{ fontFamily: "var(--font-data, monospace)", fontSize: valSize, color: c, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{v}</div>
                          </div>
                        ))}
                      </div>
                    );
                  })}
                </div>
                </div>
              </div>
            );
          })()}
        </div>
      );
    }

    if (slide.type === "campaign") {
      // Shared campaign: headline stats + site comparison
      if (slide.bothSites && slide.comparison) {
        return (
          <div style={{ display: "flex", gap: "1.5rem", height: "100%" }}>
            <SiteCol data={slide.comparison["DR"]} label="Dominican Republic" color="#6366f1" />
            <SiteCol data={slide.comparison["BZ"]} label="Belize" color="#16a34a" />
          </div>
        );
      }

      // Single-site campaign: two-column layout — big stats left, leaderboard right
      const topAgents = slide.topAgents || [];
      const hasSales = slide.goals > 0;
      return (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "2rem", height: "100%" }}>
          {/* Left: site label + big stat cards */}
          <div style={{ display: "flex", flexDirection: "column", justifyContent: "center" }}>
            {slide.siteName && (
              <div style={{ fontFamily: "var(--font-display, Inter, sans-serif)", fontSize: "clamp(1.2rem, 2.5vw, 1.8rem)", color: `var(--text-muted)`, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: "1.25rem", textAlign: "center" }}>{slide.siteName}</div>
            )}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "1.5rem" }}>
              {[
                { v: slide.agentCount, l: "Agents", c: "#16a34a" },
                { v: Math.round(slide.hrs), l: "Hours", c: "#6366f1" },
                { v: slide.goals, l: "Sales", c: "#d97706" },
                { v: gph.toFixed(2), l: "GPH", c: goalColor(pct) },
                { v: slide.rgu || "–", l: "RGU", c: "#2563eb" },
                { v: cps(slide.hrs, slide.goals), l: "Cost/Sale", c: goalColor(pct) },
                { v: slide.hsd || "–", l: "HSD", c: "#f59e0b" },
                { v: slide.xm || "–", l: "XM Lines", c: "#ec4899" },
                { v: pctFmt(pct), l: "% to Goal", c: goalColor(pct) },
              ].map(({ v, l, c }) => (
                <div key={l} style={{ background: `var(--bg-tertiary)`, borderRadius: "var(--radius-lg, 16px)", padding: "1rem", textAlign: "center", border: `1px solid ${c}20` }}>
                  <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "clamp(1.1rem, 1.8vw, 1.5rem)", color: `var(--text-muted)`, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700, marginBottom: "0.2rem" }}>{l}</div>
                  <div style={{ fontFamily: "var(--font-display, Inter, sans-serif)", fontSize: "clamp(2rem, 4vw, 3.5rem)", color: c, fontWeight: 800, lineHeight: 1 }}>{v}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Right: agent leaderboard — card style */}
          <div style={{ background: `var(--bg-tertiary)`, borderRadius: "var(--radius-lg, 16px)", padding: "1.25rem", border: `1px solid var(--border)`, overflow: "hidden", display: "flex", flexDirection: "column" }}>
            <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "clamp(1.1rem, 2vw, 1.6rem)", color: `var(--text-muted)`, letterSpacing: "0.1em", textTransform: "uppercase", fontWeight: 700, marginBottom: "0.5rem" }}>
              {hasSales ? "Top Agents" : "Agents on Floor"}
            </div>
            {topAgents.length === 0 ? (
              <div style={{ color: `var(--text-faint)`, fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "1.2rem" }}>No agent data yet</div>
            ) : (
              <div ref={agentScrollRef} style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column", gap: "0.35rem" }}>
                {topAgents.map((a, i) => {
                  const aGph = a.hrs > 0 ? a.effectiveGoals / a.hrs : 0;
                  const rank = hasSales ? (i === 0 ? "\uD83E\uDD47" : i === 1 ? "\uD83E\uDD48" : i === 2 ? "\uD83E\uDD49" : `${i + 1}`) : `${i + 1}`;
                  const nameSize = "clamp(1.8rem, 3vw, 2.5rem)";
                  const statSize = "clamp(1.8rem, 3vw, 2.5rem)";
                  const lblSize = "clamp(1.2rem, 2vw, 1.7rem)";
                  return (
                    <div key={a.name} style={{ background: hasSales && i < 3 ? `var(--bg-secondary)` : "transparent", borderRadius: "var(--radius-sm, 6px)", padding: "0.5rem 0.75rem", borderBottom: `1px solid var(--border)` }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.25rem" }}>
                        <span style={{ fontSize: nameSize, minWidth: "1.8rem", textAlign: "center" }}>{rank}</span>
                        <span style={{ color: `var(--text-warm)`, fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: nameSize, fontWeight: 700 }}>{a.name}</span>
                      </div>
                      <div style={{ display: "flex", gap: "1rem", paddingLeft: "2.3rem" }}>
                        <div style={{ textAlign: "center" }}>
                          <span style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: lblSize, color: `var(--text-faint)`, textTransform: "uppercase", letterSpacing: "0.05em", fontWeight: 600 }}>Hrs </span>
                          <span style={{ fontFamily: "var(--font-data, monospace)", fontSize: statSize, color: "#6366f1", fontWeight: 700 }}>{Math.round(a.hrs)}</span>
                        </div>
                        {hasSales && <div style={{ textAlign: "center" }}>
                          <span style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: lblSize, color: `var(--text-faint)`, textTransform: "uppercase", letterSpacing: "0.05em", fontWeight: 600 }}>Sales </span>
                          <span style={{ fontFamily: "var(--font-data, monospace)", fontSize: statSize, color: "#d97706", fontWeight: 700 }}>{a.effectiveGoals}</span>
                        </div>}
                        {hasSales && <div style={{ textAlign: "center" }}>
                          <span style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: lblSize, color: `var(--text-faint)`, textTransform: "uppercase", letterSpacing: "0.05em", fontWeight: 600 }}>GPH </span>
                          <span style={{ fontFamily: "var(--font-data, monospace)", fontSize: statSize, color: "#16a34a", fontWeight: 600 }}>{aGph.toFixed(2)}</span>
                        </div>}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      );
    }

    if (slide.type === "campaign-detail") {
      const topAgents = slide.topAgents || [];
      const hasSales = slide.goals > 0;
      // Determine combined site label
      const detailSiteLabel = tvSite === "DR" ? "Dominican Republic" : tvSite === "BZ" ? "Belize" : "All Sites";
      return (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "2.5rem", height: "100%" }}>
          {/* Left: site label + big stat cards */}
          <div style={{ display: "flex", flexDirection: "column", justifyContent: "center" }}>
            <div style={{ fontFamily: "var(--font-display, Inter, sans-serif)", fontSize: "clamp(1.3rem, 2.5vw, 2rem)", color: `var(--text-muted)`, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: "1.5rem", textAlign: "center" }}>{detailSiteLabel}</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "1.75rem" }}>
              {[
                { v: slide.agentCount, l: "Agents", c: "#16a34a" },
                { v: Math.round(slide.hrs), l: "Hours", c: "#6366f1" },
                { v: slide.goals, l: "Sales", c: "#d97706" },
                { v: gph.toFixed(2), l: "GPH", c: goalColor(pct) },
                { v: slide.rgu || "–", l: "RGU", c: "#2563eb" },
                { v: cps(slide.hrs, slide.goals), l: "Cost/Sale", c: goalColor(pct) },
                { v: slide.hsd || "–", l: "HSD", c: "#f59e0b" },
                { v: slide.xm || "–", l: "XM Lines", c: "#ec4899" },
                { v: pctFmt(pct), l: "% to Goal", c: goalColor(pct) },
              ].map(({ v, l, c }) => (
                <div key={l} style={{ background: `var(--bg-tertiary)`, borderRadius: "var(--radius-lg, 16px)", padding: "1rem", textAlign: "center", border: `1px solid ${c}20`, display: "flex", flexDirection: "column", justifyContent: "center" }}>
                  <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "clamp(1.5rem, 2.8vw, 2.2rem)", color: `var(--text-muted)`, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700 }}>{l}</div>
                  <div style={{ fontFamily: "var(--font-display, Inter, sans-serif)", fontSize: "clamp(3.5rem, 7vw, 6rem)", color: c, fontWeight: 800, lineHeight: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{v}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Right: agent leaderboard — card style */}
          <div style={{ background: `var(--bg-tertiary)`, borderRadius: "var(--radius-lg, 16px)", padding: "1.25rem", border: `1px solid var(--border)`, overflow: "hidden", display: "flex", flexDirection: "column" }}>
            <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "clamp(1.1rem, 2vw, 1.6rem)", color: `var(--text-muted)`, letterSpacing: "0.1em", textTransform: "uppercase", fontWeight: 700, marginBottom: "0.5rem" }}>
              {hasSales ? "Top Agents" : "Agents on Floor"}
            </div>
            {topAgents.length === 0 ? (
              <div style={{ color: `var(--text-faint)`, fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "1.2rem" }}>No agent data yet</div>
            ) : (
              <div ref={agentScrollRef} style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column", gap: "0.35rem" }}>
                {topAgents.map((a, i) => {
                  const aGph = a.hrs > 0 ? a.effectiveGoals / a.hrs : 0;
                  const rank = hasSales ? (i === 0 ? "\uD83E\uDD47" : i === 1 ? "\uD83E\uDD48" : i === 2 ? "\uD83E\uDD49" : `${i + 1}`) : `${i + 1}`;
                  const nameSize = "clamp(1.8rem, 3vw, 2.5rem)";
                  const statSize = "clamp(1.8rem, 3vw, 2.5rem)";
                  const lblSize = "clamp(1.2rem, 2vw, 1.7rem)";
                  return (
                    <div key={a.name} style={{ background: hasSales && i < 3 ? `var(--bg-secondary)` : "transparent", borderRadius: "var(--radius-sm, 6px)", padding: "0.5rem 0.75rem", borderBottom: `1px solid var(--border)` }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.25rem" }}>
                        <span style={{ fontSize: nameSize, minWidth: "1.8rem", textAlign: "center" }}>{rank}</span>
                        <span style={{ color: `var(--text-warm)`, fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: nameSize, fontWeight: 700 }}>{a.name}</span>
                      </div>
                      <div style={{ display: "flex", gap: "1rem", paddingLeft: "2.3rem" }}>
                        <div style={{ textAlign: "center" }}>
                          <span style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: lblSize, color: `var(--text-faint)`, textTransform: "uppercase", letterSpacing: "0.05em", fontWeight: 600 }}>Hrs </span>
                          <span style={{ fontFamily: "var(--font-data, monospace)", fontSize: statSize, color: "#6366f1", fontWeight: 700 }}>{Math.round(a.hrs)}</span>
                        </div>
                        {hasSales && <div style={{ textAlign: "center" }}>
                          <span style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: lblSize, color: `var(--text-faint)`, textTransform: "uppercase", letterSpacing: "0.05em", fontWeight: 600 }}>Sales </span>
                          <span style={{ fontFamily: "var(--font-data, monospace)", fontSize: statSize, color: "#d97706", fontWeight: 700 }}>{a.effectiveGoals}</span>
                        </div>}
                        {hasSales && <div style={{ textAlign: "center" }}>
                          <span style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: lblSize, color: `var(--text-faint)`, textTransform: "uppercase", letterSpacing: "0.05em", fontWeight: 600 }}>GPH </span>
                          <span style={{ fontFamily: "var(--font-data, monospace)", fontSize: statSize, color: "#16a34a", fontWeight: 600 }}>{aGph.toFixed(2)}</span>
                        </div>}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      );
    }

    return null;
  };

  const siteBtnStyle = (active) => ({
    padding: "0.3rem 0.85rem", border: "none", borderRadius: 0,
    fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.78rem", cursor: "pointer",
    fontWeight: active ? 700 : 400, letterSpacing: "0.04em",
    background: active ? "#d9770620" : "transparent",
    color: active ? "#d97706" : `var(--text-dim)`,
  });

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 9999, background: `var(--bg-primary)`, color: `var(--text-primary)`, fontFamily: "var(--font-ui, Inter, sans-serif)", display: "flex", flexDirection: "column", overflow: "hidden" }}
      onClick={e => { if (e.detail === 2) onExit(); }}>

      {/* Top bar — hidden by default, visible on hover */}
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, zIndex: 10, display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0.75rem 2.5rem", background: `var(--bg-primary)`, borderBottom: `1px solid var(--border)`, opacity: 0, transition: "opacity 0.3s ease" }}
        onMouseEnter={e => e.currentTarget.style.opacity = 1} onMouseLeave={e => e.currentTarget.style.opacity = 0}>
        <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
          <div style={{ width: "8px", height: "8px", borderRadius: "50%", background: "#16a34a", animation: "pulse 2s infinite" }} />
          <span style={{ fontSize: "0.82rem", color: "#16a34a", letterSpacing: "0.15em", textTransform: "uppercase", fontWeight: 600 }}>LIVE</span>
          <span style={{ fontSize: "0.78rem", color: `var(--text-faint)` }}>updated {now}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
          {/* Active/All toggle */}
          <div style={{ display: "inline-flex", borderRadius: "var(--radius-sm, 6px)", border: `1px solid var(--border)`, overflow: "hidden" }}>
            <button onClick={e => { e.stopPropagation(); setActiveOnly(false); }}
              style={{ padding: "0.3rem 0.7rem", border: "none", fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.78rem", cursor: "pointer", fontWeight: !activeOnly ? 700 : 400, background: !activeOnly ? "#16a34a18" : "transparent", color: !activeOnly ? "#16a34a" : `var(--text-dim)` }}>
              All ({d.allCount})
            </button>
            <button onClick={e => { e.stopPropagation(); setActiveOnly(true); }}
              style={{ padding: "0.3rem 0.7rem", border: "none", borderLeft: "1px solid var(--border)", fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.78rem", cursor: "pointer", fontWeight: activeOnly ? 700 : 400, background: activeOnly ? "#d9770618" : "transparent", color: activeOnly ? "#d97706" : `var(--text-dim)` }}>
              Active{Object.keys(prevAgentHours).length > 0 ? ` (${d.activeCount})` : ""}
            </button>
          </div>
          {/* Site filter */}
          <div style={{ display: "inline-flex", borderRadius: "var(--radius-sm, 6px)", border: `1px solid var(--border)`, overflow: "hidden" }}>
            {[["ALL","All"],["DR","DR"],["BZ","BZ"]].map(([k, label]) => (
              <button key={k} onClick={e => { e.stopPropagation(); setTvSite(k); }} style={siteBtnStyle(tvSite === k)}>{label}</button>
            ))}
          </div>
          <div style={{ display: "flex", gap: "0.3rem" }}>
            {slides.map((_, i) => (
              <div key={i} onClick={e => { e.stopPropagation(); setSlideIdx(i); }}
                style={{ width: i === slideIdx % slides.length ? "18px" : "6px", height: "6px", borderRadius: "3px",
                  background: i === slideIdx % slides.length ? "#d97706" : `var(--border)`, transition: "all 0.3s ease", cursor: "pointer" }} />
            ))}
          </div>
          <button onClick={e => { e.stopPropagation(); onExit(); }}
            style={{ background: "transparent", border: `1px solid var(--border)`, borderRadius: "6px", color: `var(--text-dim)`, padding: "0.3rem 0.65rem", fontSize: "0.72rem", cursor: "pointer" }}>
            ESC
          </button>
        </div>
      </div>

      {/* Progress bar */}
      <div style={{ height: "3px", background: `var(--border)`, flexShrink: 0 }}>
        <div key={slideIdx} style={{ height: "100%", background: "#d97706", animation: `tvProgress ${CYCLE_MS}ms linear forwards`, width: "0%" }} />
      </div>

      {/* Slide title */}
      <div style={{ padding: "0.75rem 2.5rem 0", flexShrink: 0, textAlign: "center", position: "relative" }}>
        <div style={{ fontFamily: "var(--font-display, Inter, sans-serif)", fontSize: "clamp(2rem, 4vw, 3.5rem)", color: `var(--text-warm)`, fontWeight: 800, letterSpacing: "-0.02em" }}>{slide.label}</div>
        <div style={{ position: "absolute", right: "2.5rem", top: "50%", transform: "translateY(-50%)", display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <div style={{ width: "8px", height: "8px", borderRadius: "50%", background: "#16a34a", animation: "pulse 2s infinite" }} />
          <span style={{ fontSize: "clamp(0.75rem, 1.1vw, 0.95rem)", color: "#16a34a", letterSpacing: "0.1em", textTransform: "uppercase", fontWeight: 600 }}>LIVE</span>
          <span style={{ fontSize: "clamp(0.7rem, 1vw, 0.85rem)", color: `var(--text-faint)` }}>{now}</span>
        </div>
      </div>

      {/* Slide content — fit to remaining viewport height */}
      <div style={{ flex: 1, overflow: "hidden", padding: "0.75rem 2.5rem 1rem", display: "flex", flexDirection: "column" }}>
        <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", justifyContent: "center" }}>
          {renderSlide()}
        </div>
      </div>

      <style>{`
        @keyframes tvProgress { from { width: 0%; } to { width: 100%; } }
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
      `}</style>
    </div>
  );
}

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

  // Active agents tracking: store agent→hours from previous load.
  // An agent is "active" if their hours increased between refreshes (still dialing).
  const [prevAgentHours, _setPrevAgentHours] = useState(() => {
    try { const s = localStorage.getItem("today_prev_agent_hours"); return s ? JSON.parse(s) : {}; } catch(e) { return {}; }
  });
  const setPrevAgentHours = useCallback(map => {
    _setPrevAgentHours(map);
    try { localStorage.setItem("today_prev_agent_hours", JSON.stringify(map)); } catch(e) {}
  }, []);
  const [activeOnly, setActiveOnly] = useState(false);
  const [screensaverMode, setScreensaverMode] = useState(false);

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
      // Snapshot current agent→hours before replacing data (for active detection)
      if (raw && Array.isArray(raw)) {
        const hoursMap = {};
        raw.forEach(r => {
          const name = (r.agt || "").trim();
          if (name) hoursMap[name] = (hoursMap[name] || 0) + (Number(r.hrs) || 0);
        });
        if (Object.keys(hoursMap).length > 0) setPrevAgentHours(hoursMap);
      }
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
      if (raw && Array.isArray(raw)) {
        const hoursMap = {};
        raw.forEach(r => {
          const name = (r.agt || "").trim();
          if (name) hoursMap[name] = (hoursMap[name] || 0) + (Number(r.hrs) || 0);
        });
        if (Object.keys(hoursMap).length > 0) setPrevAgentHours(hoursMap);
      }
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
    // ── Active agent detection: hours increased since last refresh ─────────
    const hasPrevHours = Object.keys(prevAgentHours).length > 0;
    const activeAgentNames = new Set();
    if (hasPrevHours) {
      agents.forEach(a => {
        const prevHrs = prevAgentHours[a.name] || 0;
        if (a.hrs > prevHrs) activeAgentNames.add(a.name);
      });
    }
    const allAgentCount = agents.length;
    const activeAgentCount = hasPrevHours ? activeAgentNames.size : agents.length;

    // Filter to active-only when toggled (applied to agents, agentsByJob, and raw rows for programs)
    const displayAgents = activeOnly && hasPrevHours ? agents.filter(a => activeAgentNames.has(a.name)) : agents;
    const displayAgentsByJob = activeOnly && hasPrevHours ? agentsByJob.filter(a => activeAgentNames.has(a.name)) : agentsByJob;
    const displayNames = new Set(displayAgents.map(a => a.name));
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
    const displayFiltered = activeOnly && hasPrevHours
      ? filtered.filter(row => displayNames.has((row.agt || "").trim()))
      : filtered;
    const byReg = {};
    const byRegAgentSets = {}; // reg → Set<agentName> for unique head count
    displayFiltered.forEach(row => {
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
    displayAgents.forEach(a => {
      const l = a.loc;
      if (!byLoc[l]) byLoc[l] = { count: 0, hrs: 0, goals: 0 };
      byLoc[l].count++;
      byLoc[l].hrs   += a.hrs;
      byLoc[l].goals += a.effectiveGoals;
    });

    // ── By program/group — with % to goal via goalLookup ────────────────────
    const grpMap = {};
    displayFiltered.forEach(row => {
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
    const uniqueRegs = [...new Set(displayAgents.map(a => a.reg))].sort();

    // ── Product mix ─────────────────────────────────────────────────────────
    const productTotals = {};
    displayAgents.forEach(a => {
      Object.entries(a.products).forEach(([k, v]) => {
        productTotals[k] = (productTotals[k] || 0) + v;
      });
    });

    // ── Collect all unique product codes for dynamic columns ─────────────
    const allProductCodes = [...new Set(displayAgents.flatMap(a => Object.keys(a.products)))].sort();

    return {
      agents: displayAgents, agentsByJob: displayAgentsByJob,
      totalHrs:   displayAgents.reduce((s,a) => s + a.hrs,   0),
      totalGoals: displayAgents.reduce((s,a) => s + a.effectiveGoals,  0),
      totalSal:   displayAgents.reduce((s,a) => s + a.sal,    0),
      totalRgu:   displayAgents.reduce((s,a) => s + a.rgu,    0),
      presentCount: displayAgents.length,
      activeCount: activeAgentCount, allCount: allAgentCount,
      absent: validAbsent, newFaces, absentByRegion,
      byLoc, byReg, programs, productTotals, uniqueRegs, allProductCodes,
    };
  }, [raw, recentAgentNames, historicalAgentMap, goalLookup, activeOnly, prevAgentHours]);

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

  // All codes: from OTM data, omit unnamed unless sold, omit Cox
  const allAvailableCodes = useMemo(() => {
    if (!raw || !Array.isArray(raw) || raw.length === 0) return [];
    const codeSet = new Set();
    Object.keys(raw[0]).forEach(k => { if (/^\d+$/.test(k)) codeSet.add(k); });
    // Codes with actual sales today
    const soldCodes = new Set();
    if (d) {
      d.agents.forEach(a => Object.entries(a.products).forEach(([k, v]) => { if (v > 0) soldCodes.add(k); }));
      d.programs.forEach(p => Object.entries(p.products || {}).forEach(([k, v]) => { if (v > 0) soldCodes.add(k); }));
    }
    return [...codeSet].filter(c => {
      // Check both PRODUCT_LABELS (hardcoded) and codes (from Code.php API)
      const name = PRODUCT_LABELS[String(c)] || codes[String(c)] || "";
      if (name.toUpperCase().includes("COX")) return false;
      if (!name) return soldCodes.has(c);
      return true;
    }).sort((a, b) => Number(a) - Number(b));
  }, [raw, codes, d]);

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
        fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.8rem", userSelect: "none" }}>
      {label}{sortBy===k?(sortDir===-1?" ↓":" ↑"):""}
    </th>
  );

  const ProgSortTh = ({ k, label, right }) => (
    <th onClick={() => toggleProgSort(k)}
      style={{ padding: "0.4rem 0.75rem", textAlign: right?"right":"left", fontWeight: 400,
        color: progSortBy===k ? "#d97706" : `var(--text-dim)`, cursor: "pointer", whiteSpace: "nowrap",
        fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.8rem", userSelect: "none" }}>
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
      <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.85rem", color: `var(--text-dim)` }}>Checking connection…</div>
    </div>
  );

  if (pasteMode) return (
    <div style={{ minHeight: "90vh", background: `var(--bg-primary)`, padding: "3rem 2.5rem" }}>
      <div style={{ maxWidth: "640px", margin: "0 auto" }}>
        <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.82rem", color: "#16a34a", letterSpacing: "0.15em", textTransform: "uppercase", marginBottom: "0.5rem" }}>Today's Operations — Manual Data Load</div>
        <div style={{ fontFamily: "var(--font-display, Inter, sans-serif)", fontSize: "3rem", color: `var(--text-warm)`, fontWeight: 700, marginBottom: "1.5rem" }}>Paste Live Data</div>

        <div style={{ background: `var(--bg-secondary)`, border: "1px solid var(--border)", borderRadius: "var(--radius-lg, 16px)", padding: "1.5rem", marginBottom: "1.25rem" }}>
          <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.8rem", color: `var(--text-muted)`, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: "1rem" }}>Step 1 — Open the live data URL</div>
          <a href={OTM_URL} target="_blank" rel="noreferrer"
            style={{ display: "inline-block", background: "#16a34a18", border: "1px solid #16a34a55", borderRadius: "6px", color: "#16a34a", padding: "0.5rem 1rem", fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.82rem", textDecoration: "none", marginBottom: "0.5rem" }}>
            ↗ Open OTM Data Feed
          </a>
          <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.82rem", color: `var(--text-faint)`, marginTop: "0.5rem" }}>
            This opens the live data in a new tab. You'll see raw JSON text.
          </div>
        </div>

        <div style={{ background: `var(--bg-secondary)`, border: "1px solid var(--border)", borderRadius: "var(--radius-lg, 16px)", padding: "1.5rem", marginBottom: "1.25rem" }}>
          <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.8rem", color: `var(--text-muted)`, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: "1rem" }}>Step 2 — Copy & paste the data here</div>
          <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.82rem", color: `var(--text-muted)`, marginBottom: "0.75rem" }}>
            In that tab, press <kbd style={{ background: `var(--bg-tertiary)`, border: "1px solid var(--text-faint)", borderRadius: "3px", padding: "0.1rem 0.35rem", fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.85rem" }}>Ctrl+A</kbd> then <kbd style={{ background: `var(--bg-tertiary)`, border: "1px solid var(--text-faint)", borderRadius: "3px", padding: "0.1rem 0.35rem", fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.85rem" }}>Ctrl+C</kbd> to copy everything, then paste it below.
          </div>
          <textarea
            value={pasteText}
            onChange={e => { setPasteText(e.target.value); setPasteError(null); }}
            placeholder='Paste JSON here… (starts with [{"agt":…)'
            style={{ width: "100%", height: "120px", background: `var(--bg-primary)`, border: `1px solid ${pasteError ? "#dc2626" : `var(--border)`}`, borderRadius: "6px", color: `var(--text-secondary)`, fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.8rem", padding: "0.75rem", resize: "vertical", boxSizing: "border-box" }}
          />
          {pasteError && (
            <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.82rem", color: "#dc2626", marginTop: "0.4rem" }}>⚠ {pasteError}</div>
          )}
          <button onClick={handlePaste} disabled={!pasteText.trim()}
            style={{ marginTop: "0.75rem", padding: "0.5rem 1.25rem", background: pasteText.trim() ? "#16a34a18" : "transparent", border: `1px solid ${pasteText.trim() ? "#16a34a" : `var(--border)`}`, borderRadius: "6px", color: pasteText.trim() ? "#16a34a" : `var(--text-faint)`, fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.82rem", cursor: pasteText.trim() ? "pointer" : "not-allowed" }}>
            Load Data →
          </button>
        </div>

        <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.8rem", color: `var(--text-faint)`, textAlign: "center" }}>
          Direct fetch is blocked in this environment. Pasting the data works identically — you'll see all the same live stats.
        </div>
      </div>
    </div>
  );

  if (!d) return (
    <div style={{ minHeight: "90vh", display: "flex", alignItems: "center", justifyContent: "center", background: `var(--bg-primary)` }}>
      <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.85rem", color: `var(--text-dim)`, textAlign: "center" }}>
        <div style={{ fontSize: "1.8rem", marginBottom: "0.5rem" }}>{loading ? "\u23F3" : "\uD83D\uDCE1"}</div>
        {loading ? "Fetching live data..." : "No data available."}
        <div style={{ marginTop: "0.75rem", display: "flex", gap: "0.5rem", justifyContent: "center" }}>
          <button onClick={doFetch} style={{ background: "transparent", border: "1px solid #16a34a", borderRadius: "var(--radius-sm, 6px)", color: "#16a34a", padding: "0.3rem 0.8rem", cursor: "pointer", fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.8rem" }}>
            {loading ? "Fetching..." : "Try Auto-Fetch"}
          </button>
          <button onClick={() => setPasteMode(true)} style={{ background: "transparent", border: "1px solid var(--text-faint)", borderRadius: "var(--radius-sm, 6px)", color: `var(--text-muted)`, padding: "0.3rem 0.8rem", cursor: "pointer", fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.8rem" }}>Paste Data</button>
        </div>
      </div>
    </div>
  );

  // ── Screensaver / TV Mode ────────────────────────────────────────────────
  if (screensaverMode && d) {
    return (<TVMode d={d} codes={codes} doFetch={doFetch} lastRefresh={lastRefresh} onExit={() => setScreensaverMode(false)} activeOnly={activeOnly} setActiveOnly={setActiveOnly} prevAgentHours={prevAgentHours} />);
  }

  return (
    <div style={{ background: `var(--bg-primary)`, minHeight: "90vh", padding: "2rem 2.5rem", paddingBottom: "4rem" }}>

      {/* ── Header ── */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.75rem" }}>
        <div>
          <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.82rem", color: "#16a34a", letterSpacing: "0.15em", textTransform: "uppercase", marginBottom: "0.25rem" }}>
          ● LIVE · auto-refreshes every 5 min · last loaded {now}
          </div>
          <div style={{ fontFamily: "var(--font-display, Inter, sans-serif)", fontSize: "3rem", color: `var(--text-warm)`, fontWeight: 700 }}>Today's Operations</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem", alignItems: "flex-end" }}>
          <button onClick={() => { setActiveOnly(false); setScreensaverMode(true); }}
            style={{ background: "#6366f110", border: "1px solid #6366f140", borderRadius: "6px",
              color: "#6366f1", padding: "0.5rem 1.25rem", fontFamily: "var(--font-ui, Inter, sans-serif)",
              fontSize: "1.1rem", cursor: "pointer", fontWeight: 700, width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: "0.5rem" }}>
            <span style={{ fontSize: "2.4rem", lineHeight: 1 }}>📺</span> TV Mode
          </button>
          <button onClick={async () => {
              try {
                await doFetch();
              } catch(e) {
                setPasteMode(true);
              }
            }}
            style={{ background: "transparent", border: "1px solid var(--text-faint)", borderRadius: "6px",
              color: `var(--text-muted)`, padding: "0.4rem 1rem", fontFamily: "var(--font-ui, Inter, sans-serif)",
              fontSize: "0.8rem", cursor: "pointer", width: "100%" }}>
            {loading ? "Fetching..." : "\u27F3 Refresh Data"}
          </button>
        </div>
      </div>

      {/* ── Active/All toggle + Pulse cards ── */}
      {(() => {
        const tBtnBase = { padding: "0.3rem 0.7rem", border: "none", fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.75rem", cursor: "pointer", letterSpacing: "0.03em" };
        const activeToggle = (
          <div style={{ display: "inline-flex", borderRadius: "var(--radius-sm, 6px)", border: "1px solid var(--border)", overflow: "hidden" }}>
            <button onClick={() => setActiveOnly(false)}
              style={{ ...tBtnBase, fontWeight: activeOnly ? 400 : 700, background: !activeOnly ? "#16a34a18" : "transparent", color: !activeOnly ? "#16a34a" : `var(--text-dim)` }}>
              All Agents{d.allCount != null ? ` (${d.allCount})` : ""}
            </button>
            <button onClick={() => setActiveOnly(true)}
              style={{ ...tBtnBase, borderLeft: "1px solid var(--border)", fontWeight: activeOnly ? 700 : 400, background: activeOnly ? "#d9770618" : "transparent", color: activeOnly ? "#d97706" : `var(--text-dim)` }}>
              Active{d.activeCount != null && Object.keys(prevAgentHours).length > 0 ? ` (${d.activeCount})` : ""}
            </button>
          </div>
        );
        return (
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
            <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.72rem", color: activeOnly ? "#d97706" : `var(--text-faint)`, letterSpacing: "0.08em" }}>
              {activeOnly ? "Showing agents whose hours increased since last refresh (currently dialing)" : "Showing all agents with data today"}
              {Object.keys(prevAgentHours).length === 0 && <span style={{ color: `var(--text-faint)` }}> — needs one refresh cycle to detect active</span>}
            </div>
            {activeToggle}
          </div>
        );
      })()}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: "0.75rem", marginBottom: "1.5rem" }}>
        {[
          { v: d.presentCount,           l: activeOnly ? "Active" : "On Floor", sub: `${d.absent.length} absent · ${d.newFaces.length} new`, c: "#16a34a" },
          { v: fmt(d.totalHrs, 1),        l: "Hours Today", sub: `${fmt(d.totalHrs/Math.max(d.presentCount,1), 2)} avg/agent`,  c: "#6366f1" },
          { v: d.totalGoals,              l: "Sales Today", sub: d.totalGoals > 0 ? `${fmt(d.totalHrs > 0 ? d.totalGoals/d.totalHrs : 0, 3)} GPH pace` : "no sales yet", c: "#d97706" },
          { v: d.totalRgu || "—",         l: "RGU",         sub: "today total",  c: "#2563eb" },
          { v: d.absent.length,           l: "Absent",      sub: `of ${recentAgentNames.size} last-7-day roster`, c: d.absent.length > 0 ? "#dc2626" : "#16a34a" },
        ].map(({ v, l, sub, c }) => (
          <div key={l} style={{ background: `var(--bg-secondary)`, border: `1px solid ${c}22`, borderRadius: "var(--radius-md, 10px)", padding: "1rem", textAlign: "center" }}>
            <div style={{ fontFamily: "var(--font-display, Inter, sans-serif)", fontSize: "3rem", color: c, fontWeight: 700, lineHeight: 1 }}>{v}</div>
            <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.82rem", color: c, marginTop: "0.2rem" }}>{l}</div>
            <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.82rem", color: `var(--text-faint)`, marginTop: "0.2rem" }}>{sub}</div>
          </div>
        ))}
      </div>

      {/* ── Product Code Columns — full-width slim bar ── */}
      {allAvailableCodes.length > 0 && (
        <div style={{ background: `var(--bg-secondary)`, border: "1px solid var(--border)", borderRadius: "var(--radius-lg, 16px)", padding: "1rem 1.25rem", marginBottom: "1.25rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.8rem", color: `var(--text-muted)`, letterSpacing: "0.12em", textTransform: "uppercase" }}>
              Product Code Columns
            </div>
            <div style={{ display: "flex", gap: "0.4rem", alignItems: "center" }}>
              {selectedCodes.size > 0 && (
                <button onClick={() => setSelectedCodes(new Set())}
                  style={{ background: "transparent", border: "1px solid var(--text-faint)", borderRadius: "var(--radius-sm, 6px)", color: `var(--text-muted)`, padding: "0.15rem 0.5rem", fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.82rem", cursor: "pointer" }}>
                  Show All
                </button>
              )}
              <button onClick={() => setCodeDropOpen(v => !v)}
                style={{ background: codeDropOpen ? "#d9770620" : "transparent", border: `1px solid ${codeDropOpen ? "#d97706" : `var(--text-faint)`}`, borderRadius: "var(--radius-sm, 6px)",
                  color: codeDropOpen ? "#d97706" : `var(--text-muted)`, padding: "0.15rem 0.6rem", fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.8rem", cursor: "pointer" }}>
                {codeDropOpen ? "▲ Close" : "▼ Select Codes"}{selectedCodes.size > 0 ? ` (${selectedCodes.size})` : ""}
              </button>
            </div>
          </div>
          {/* Selected code chips */}
          {selectedCodes.size > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.25rem", marginTop: "0.5rem" }}>
              {[...selectedCodes].sort((a,b)=>Number(a)-Number(b)).map(cod => (
                <span key={cod} onClick={() => toggleCode(cod)}
                  style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.82rem", padding: "0.15rem 0.45rem", borderRadius: "3px",
                    background: "#d9770620", border: "1px solid #d9770650", color: "#d97706", cursor: "pointer" }}
                  title="Click to remove">
                  {prodLabel(cod, codes)} ×
                </span>
              ))}
            </div>
          )}
          {/* Dropdown code picker — categorized sub-trays */}
          {codeDropOpen && (() => {
            const CODE_CATEGORIES = [
              { label: "RGU / New Sales", color: "#16a34a", codes: ["701","702","703","704","717","706","740","742","744"] },
              { label: "Tier Upgrades", color: "#6366f1", codes: ["713","714","715","716","725"] },
              { label: "Internet (HSD)", color: "#2563eb", codes: ["600","601","602","603","604","605","484","513","552","553","554","555","482","468","488"] },
              { label: "TV Plans", color: "#d97706", codes: ["500","501","502","503","504","551","475","465","493","495"] },
              { label: "Premium Channels", color: "#8b5cf6", codes: ["401","402","403","404","405","417","489"] },
              { label: "TV Add-Ons & Packs", color: "#f59e0b", codes: ["459","460","461","462","409","463"] },
              { label: "Mobile Plans (XM)", color: "#ec4899", codes: ["518","519","522","523","492","817"] },
              { label: "Mobile Devices", color: "#14b8a6", codes: ["432","433","434","435","436","437","438","439"] },
              { label: "Accessories", color: "#64748b", codes: ["440","441","442","443","444","445","446"] },
              { label: "Home Security (XH)", color: "#f97316", codes: ["469","470","467","515","516","517","483","486","487"] },
              { label: "Voice", color: "#06b6d4", codes: ["514","610"] },
              { label: "NOW Internet", color: "#a855f7", codes: ["524","525"] },
              { label: "International", color: "#84cc16", codes: ["490","491"] },
              { label: "Operations / Other", color: "#94a3b8", codes: ["420","466","415","418","419","464","481","550","556"] },
            ];
            const categorized = new Set(CODE_CATEGORIES.flatMap(c => c.codes));
            const uncategorized = allAvailableCodes.filter(c => !categorized.has(c));
            const selectCat = (catCodes) => {
              setSelectedCodes(prev => {
                const next = new Set(prev);
                const allSelected = catCodes.every(c => next.has(c));
                catCodes.forEach(c => { if (allSelected) next.delete(c); else next.add(c); });
                return next;
              });
            };
            const catBtnStyle = (active) => ({
              background: active ? "#6366f120" : "transparent", border: `1px solid ${active ? "#6366f1" : "var(--border)"}`,
              borderRadius: "var(--radius-sm, 6px)", color: active ? "#6366f1" : `var(--text-dim)`, padding: "0.2rem 0.55rem",
              fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.82rem", cursor: "pointer", textAlign: "center",
              width: "100%", transition: "all 0.1s"
            });
            return (
              <div style={{ marginTop: "0.75rem", borderTop: "1px solid var(--bg-tertiary)", paddingTop: "0.75rem", display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                {CODE_CATEGORIES.map(cat => {
                  const visible = cat.codes.filter(c => allAvailableCodes.includes(c));
                  if (visible.length === 0) return null;
                  const allSelected = visible.every(c => selectedCodes.has(c));
                  const someSelected = visible.some(c => selectedCodes.has(c));
                  return (
                    <div key={cat.label}>
                      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.35rem" }}>
                        <button onClick={() => selectCat(visible)}
                          style={{ background: "transparent", border: "none", cursor: "pointer", padding: "0.1rem 0.3rem",
                            fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.72rem",
                            color: allSelected ? cat.color : someSelected ? cat.color + "90" : `var(--text-faint)`,
                            fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase" }}>
                          {allSelected ? "\u2713" : "\u25CB"}
                        </button>
                        <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.75rem", color: cat.color,
                          fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" }}>
                          {cat.label}
                        </div>
                        <div style={{ flex: 1, height: "1px", background: cat.color + "30" }} />
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))", gap: "0.25rem", paddingLeft: "0.25rem" }}>
                        {visible.map(cod => {
                          const active = selectedCodes.has(cod);
                          return (
                            <button key={cod} onClick={() => toggleCode(cod)} style={catBtnStyle(active)}>
                              {prodLabel(cod, codes)}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
                {uncategorized.length > 0 && (
                  <div>
                    <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.75rem", color: `var(--text-faint)`,
                      fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: "0.35rem" }}>
                      Other
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))", gap: "0.25rem" }}>
                      {uncategorized.map(cod => {
                        const active = selectedCodes.has(cod);
                        return (
                          <button key={cod} onClick={() => toggleCode(cod)} style={catBtnStyle(active)}>
                            {prodLabel(cod, codes)}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            );
          })()}
        </div>
      )}

      {/* ── Attendance + By Region side by side ── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1.25rem", marginBottom: "1.25rem", alignItems: "stretch" }}>

        {/* ── Attendance panel ── */}
        <div style={{ background: `var(--bg-secondary)`, border: "1px solid var(--border)", borderRadius: "var(--radius-lg, 16px)", padding: "1.25rem" }}>
          <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.8rem", color: `var(--text-muted)`, letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: "1rem" }}>
            Attendance vs Last 7 Days
          </div>
          <div style={{ display: "flex", gap: "0.75rem", marginBottom: "1rem" }}>
            {[
              { label: "Present", count: d.presentCount,   color: "#16a34a" },
              { label: "Absent",  count: d.absent.length,  color: "#dc2626" },
              { label: "New",     count: d.newFaces.length, color: "#d97706" },
            ].map(({ label, count, color }) => (
              <div key={label} style={{ flex: 1, padding: "0.6rem", background: color+"12", border: `1px solid ${color}30`, borderRadius: "var(--radius-md, 10px)", textAlign: "center" }}>
                <div style={{ fontFamily: "var(--font-display, Inter, sans-serif)", fontSize: "1.75rem", color, fontWeight: 700, lineHeight: 1 }}>{count}</div>
                <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.8rem", color, marginTop: "0.15rem" }}>{label}</div>
              </div>
            ))}
          </div>
          {d.absent.length > 0 && (
            <div>
              <button onClick={() => setShowAbsent(v => !v)}
                style={{ background: "transparent", border: "none", cursor: "pointer", fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.8rem", color: "#dc2626", padding: 0, display: "flex", alignItems: "center", gap: "0.3rem", marginBottom: "0.4rem" }}>
                <span>{showAbsent?"▾":"▸"}</span>
                {d.absent.length} absent today — worked in last 7 days
              </button>
              {showAbsent && (
                <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
                  {Object.entries(d.absentByRegion).sort().map(([reg, agents]) => (
                    <div key={reg}>
                      <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.82rem", color: getRegColor(reg), textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "0.25rem" }}>
                        {reg} <span style={{ color: `var(--text-faint)` }}>({agents.length})</span>
                      </div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.25rem" }}>
                        {agents.sort((a,b)=>a.name.localeCompare(b.name)).map(({ name, quartile }) => (
                          <div key={name} style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.8rem", padding: "0.15rem 0.5rem", borderRadius: "3px",
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
              <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.8rem", color: "#d97706", marginBottom: "0.4rem" }}>
                ▸ {d.newFaces.length} agents working today not in recent history
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "0.3rem" }}>
                {d.newFaces.sort().map(name => (
                  <div key={name} style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.8rem", padding: "0.15rem 0.5rem", borderRadius: "3px",
                    background: "#d9770612", border: "1px solid #d9770630", color: "#d97706" }}>
                    {name.split(" ")[0]}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* ── By Region ── */}
        <div style={{ background: `var(--bg-secondary)`, border: "1px solid var(--border)", borderRadius: "var(--radius-lg, 16px)", padding: "1.25rem", display: "flex", flexDirection: "column" }}>
          <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.8rem", color: `var(--text-muted)`, letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: "1rem" }}>
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
              <div key={reg} style={{ padding: "0.85rem 1rem", background: `var(--bg-primary)`, borderRadius: "var(--radius-md, 10px)", border: `1px solid ${regColor}22`, marginBottom: "0.6rem" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
                  <span style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "1.32rem", color: regColor, fontWeight: 600 }}>{reg}</span>
                  <span style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.82rem", color: `var(--text-muted)` }}>{s.count} agents</span>
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
                      <div style={{ fontFamily: "var(--font-display, Inter, sans-serif)", fontSize: "1.15rem", color: c, fontWeight: 600 }}>{v}</div>
                      <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.78rem", color: `var(--text-dim)` }}>{l}</div>
                    </div>
                  ))}
                </div>
                {hasProd && displayCodes.length > 0 && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "0.2rem", marginTop: "0.5rem" }}>
                    {Object.entries(s.products)
                      .filter(([cod]) => selectedCodes.size === 0 || selectedCodes.has(cod))
                      .sort((a,b)=>b[1]-a[1]).map(([cod, cnt]) => (
                      <span key={cod} style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.81rem", padding: "0.1rem 0.35rem", borderRadius: "3px", background: "#6366f108", border: "1px solid #6366f120", color: "#6366f1aa",
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
              <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.8rem", color: `var(--text-dim)`, marginBottom: "0.4rem" }}>PRODUCT MIX TODAY</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "0.3rem" }}>
                {Object.entries(d.productTotals).sort((a,b)=>b[1]-a[1]).map(([cod, cnt]) => (
                  <div key={cod} style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.8rem", padding: "0.15rem 0.5rem", borderRadius: "3px", background: "#6366f112", border: "1px solid #6366f130", color: "#6366f1",
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
      <div style={{ background: `var(--bg-secondary)`, border: "1px solid var(--border)", borderRadius: "var(--radius-lg, 16px)", padding: "1.25rem", marginBottom: "1.25rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem", flexWrap: "wrap", gap: "0.5rem" }}>
          <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.8rem", color: `var(--text-muted)`, letterSpacing: "0.12em", textTransform: "uppercase" }}>Performance by Campaign · by Site</div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
            <div style={{ display: "inline-flex", borderRadius: "var(--radius-sm, 6px)", border: "1px solid var(--border)", overflow: "hidden" }}>
              <button onClick={() => setActiveOnly(false)}
                style={{ padding: "0.25rem 0.6rem", border: "none", fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.72rem", cursor: "pointer", fontWeight: activeOnly ? 400 : 700, background: !activeOnly ? "#16a34a18" : "transparent", color: !activeOnly ? "#16a34a" : `var(--text-dim)` }}>
                All ({d.allCount})
              </button>
              <button onClick={() => setActiveOnly(true)}
                style={{ padding: "0.25rem 0.6rem", border: "none", borderLeft: "1px solid var(--border)", fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.72rem", cursor: "pointer", fontWeight: activeOnly ? 700 : 400, background: activeOnly ? "#d9770618" : "transparent", color: activeOnly ? "#d97706" : `var(--text-dim)` }}>
                Active{Object.keys(prevAgentHours).length > 0 ? ` (${d.activeCount})` : ""}
              </button>
            </div>
            <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.72rem", color: `var(--text-faint)` }}>sort · filter by site</div>
          </div>
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
                  style={{ padding: "0.3rem 0.8rem", borderRadius: "var(--radius-sm, 6px)", border: `1px solid ${!progSiteFilter?"#d97706":`var(--border)`}`, background: !progSiteFilter?"#d9770618":"transparent", color: !progSiteFilter?"#d97706":`var(--text-muted)`, fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.8rem", cursor: "pointer" }}>
                  All Sites
                </button>
                {siteTabs.map(st => {
                  const isActive = progSiteFilter === st.label;
                  const btnColor = getRegColor(st.regs[0]);
                  return (
                    <button key={st.label} onClick={() => { setProgSiteFilter(isActive ? null : st.label); setBzSiteFilter(null); }}
                      style={{ padding: "0.3rem 0.8rem", borderRadius: "var(--radius-sm, 6px)", border: `1px solid ${isActive?btnColor:`var(--border)`}`, background: isActive?btnColor+"18":"transparent", color: isActive?btnColor:`var(--text-muted)`, fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.8rem", cursor: "pointer" }}>
                      {mbrSiteName(st.label)}
                      <span style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.8rem", color: `var(--text-dim)`, marginLeft: "0.35rem" }}>
                        ({st.regs.length > 1 ? `${st.regs.length} sites` : mbrSiteName(st.regs[0])})
                      </span>
                    </button>
                  );
                })}
              </div>
              {/* BZ sub-site tabs — shown when BZ is the active site filter */}
              {progSiteFilter === "BZ" && bzRegs.length > 1 && (
                <div style={{ display: "flex", gap: "0.35rem", flexWrap: "wrap", paddingLeft: "0.5rem", borderLeft: "2px solid #6366f130" }}>
                  <button onClick={() => setBzSiteFilter(null)}
                    style={{ padding: "0.25rem 0.7rem", borderRadius: "var(--radius-sm, 6px)", border: `1px solid ${!bzSiteFilter ? "#6366f1" : `var(--border)`}`, background: !bzSiteFilter ? "#6366f118" : "transparent", color: !bzSiteFilter ? "#6366f1" : `var(--text-dim)`, fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "1.02rem", cursor: "pointer", transition: "all 0.15s" }}>
                    Combined
                  </button>
                  {bzRegs.map(reg => {
                    const isActive = bzSiteFilter === reg;
                    const regColor = getRegColor(reg);
                    return (
                      <button key={reg} onClick={() => setBzSiteFilter(isActive ? null : reg)}
                        style={{ padding: "0.25rem 0.7rem", borderRadius: "var(--radius-sm, 6px)", border: `1px solid ${isActive ? regColor : `var(--border)`}`, background: isActive ? regColor + "18" : "transparent", color: isActive ? regColor : `var(--text-dim)`, fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "1.02rem", cursor: "pointer", transition: "all 0.15s" }}>
                        {mbrSiteName(reg)}
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
            <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: "0.5rem", marginBottom: "1rem", padding: "0.75rem", background: filterColor + "08", border: `1px solid ${filterColor}25`, borderRadius: "var(--radius-md, 10px)" }}>
              {[
                { l: "Campaigns", v: sortedPrograms.length, c: filterColor },
                { l: "Agents", v: totAgents, c: `var(--text-secondary)` },
                { l: "Hours", v: fmt(totHrs, 1), c: "#6366f1" },
                { l: "Sales", v: totGoals || "—", c: "#d97706" },
                { l: "GPH", v: totGoals > 0 ? totGph.toFixed(3) : "—", c: "#16a34a" },
                { l: "CPS", v: totGoals > 0 ? `$${((totHrs * 19.77) / totGoals).toFixed(2)}` : `$${(totHrs * 19.77).toFixed(2)}`, c: (() => { const pv = sortedPrograms.filter(p => p.pctToGoal !== null); return pv.length > 0 ? attainColor(pv.reduce((s,p) => s + p.pctToGoal, 0) / pv.length) : `var(--text-faint)`; })() },
              ].map(({ l, v, c }) => (
                <div key={l} style={{ textAlign: "center" }}>
                  <div style={{ fontFamily: "var(--font-display, Inter, sans-serif)", fontSize: "1.95rem", color: c, fontWeight: 700, lineHeight: 1 }}>{v}</div>
                  <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.9rem", color: `var(--text-dim)`, marginTop: "0.1rem" }}>{l}</div>
                </div>
              ))}
            </div>
          );
        })()}
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.8rem", whiteSpace: "nowrap" }}>
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
                      <td style={{ padding: "0.4rem 0.75rem", color: `var(--text-primary)`, fontFamily: "var(--font-ui, Inter, sans-serif)", ...style.tdProgram }}>{style.progLabel || p.grp}</td>
                      <td style={{ padding: "0.4rem 0.75rem", color: `var(--text-dim)`, fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.9rem" }}>{p.roc || "\u2014"}</td>
                      <td style={{ padding: "0.4rem 0.75rem" }}>
                        <span style={{ background: regColor+"18", border: `1px solid ${regColor}40`, borderRadius: "3px", color: regColor, padding: "0.1rem 0.35rem" }}>{p.isCombined ? "BZ" : mbrSiteName(p.reg)}</span>
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
      <div style={{ background: `var(--bg-secondary)`, border: "1px solid var(--border)", borderRadius: "var(--radius-lg, 16px)", padding: "1.25rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem", flexWrap: "wrap", gap: "0.5rem" }}>
          <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.8rem", color: `var(--text-muted)`, letterSpacing: "0.12em", textTransform: "uppercase" }}>
            Agent Leaderboard · {sortedAgents.length} {lbRegion === "All" ? (lbJob ? `in ${lbJob}` : (activeOnly ? "active now" : "today")) : `in ${lbRegion}`}{lbJob && lbRegion !== "All" ? ` · ${lbJob}` : ""}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
            <div style={{ display: "inline-flex", borderRadius: "var(--radius-sm, 6px)", border: "1px solid var(--border)", overflow: "hidden" }}>
              <button onClick={() => setActiveOnly(false)}
                style={{ padding: "0.25rem 0.6rem", border: "none", fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.72rem", cursor: "pointer", fontWeight: activeOnly ? 400 : 700, background: !activeOnly ? "#16a34a18" : "transparent", color: !activeOnly ? "#16a34a" : `var(--text-dim)` }}>
                All ({d.allCount})
              </button>
              <button onClick={() => setActiveOnly(true)}
                style={{ padding: "0.25rem 0.6rem", border: "none", borderLeft: "1px solid var(--border)", fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.72rem", cursor: "pointer", fontWeight: activeOnly ? 700 : 400, background: activeOnly ? "#d9770618" : "transparent", color: activeOnly ? "#d97706" : `var(--text-dim)` }}>
                Active{Object.keys(prevAgentHours).length > 0 ? ` (${d.activeCount})` : ""}
              </button>
            </div>
            <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.72rem", color: `var(--text-faint)` }}>sort by headers</div>
          </div>
        </div>
        {/* Region selector */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem", marginBottom: "0.5rem" }}>
          {["All", ...(d.uniqueRegs || [])].map(r => {
            const active = lbRegion === r;
            const isBZ = r !== "All" && r.toUpperCase().includes("XOTM");
            const btnColor = r === "All" ? `var(--text-muted)` : getRegColor(r);
            return (
              <button key={r} onClick={() => { setLbRegion(r); setLbJob(null); }}
                style={{ background: active ? btnColor+"20" : "transparent", border: `1px solid ${active ? btnColor : `var(--border)`}`, borderRadius: "var(--radius-sm, 6px)",
                  color: active ? btnColor : `var(--text-dim)`, padding: "0.2rem 0.6rem", fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.8rem", cursor: "pointer", transition: "all 0.15s" }}>
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
                style={{ padding: "0.2rem 0.55rem", borderRadius: "var(--radius-sm, 6px)", border: `1px solid ${!lbJob ? "#16a34a" : `var(--border)`}`, background: !lbJob ? "#16a34a18" : "transparent", color: !lbJob ? "#16a34a" : `var(--text-dim)`, fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "1.02rem", cursor: "pointer" }}>
                All Programs
              </button>
              {jobs.map(j => {
                const active = lbJob === j;
                return (
                  <button key={j} onClick={() => setLbJob(active ? null : j)}
                    style={{ padding: "0.2rem 0.55rem", borderRadius: "var(--radius-sm, 6px)", border: `1px solid ${active ? "#16a34a" : `var(--border)`}`, background: active ? "#16a34a18" : "transparent", color: active ? "#16a34a" : `var(--text-dim)`, fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "1.02rem", cursor: "pointer" }}>
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
          <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.8rem", whiteSpace: "nowrap" }}>
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
                    <td style={{ padding: "0.4rem 0.6rem", color: `var(--text-warm)`, fontFamily: "var(--font-ui, Inter, sans-serif)" }}>{a.name}</td>
                    <td style={{ padding: "0.4rem 0.6rem" }}>
                      <span style={{ background: regColor+"18", border: `1px solid ${regColor}40`, borderRadius: "3px", color: regColor, padding: "0.1rem 0.35rem" }}>{mbrSiteName(a.reg)}</span>
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
                      {a.quartile ? <QBadge q={a.quartile} /> : <span style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.82rem", color: `var(--text-faint)` }}>—</span>}
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
          <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.8rem", color: `var(--text-faint)`, padding: "0.4rem 0.6rem" }}>
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

const CURRENT_PAGE_KEY = "perf-intel-current-page";

const THEMES = {
  dark: {
    "--bg-primary":      "#06090d",
    "--bg-secondary":    "#0c1017",
    "--bg-row-alt":      "#090d13",
    "--bg-tertiary":     "#141a23",
    "--border":          "#1e2530",
    "--border-muted":    "#2a3240",
    "--text-faint":      "#334155",
    "--text-dim":        "#475569",
    "--text-muted":      "#64748b",
    "--text-secondary":  "#94a3b8",
    "--text-primary":    "#e2e8f0",
    "--text-warm":       "#f1f5f9",
    "--glass-bg":        "rgba(12, 16, 23, 0.75)",
    "--glass-bg-subtle": "rgba(12, 16, 23, 0.5)",
    "--glass-border":    "rgba(255, 255, 255, 0.06)",
    "--card-glow":       "0 0 0 1px rgba(255,255,255,0.04), 0 4px 24px rgba(0,0,0,0.3)",
    "--card-hover-glow": "0 0 0 1px rgba(217,119,6,0.12), 0 8px 32px rgba(0,0,0,0.4)",
    "--accent-surface":  "rgba(217, 119, 6, 0.06)",
    "--nav-bg":          "rgba(6, 9, 13, 0.85)",
    "--nh-color":        "#d97706",
    "--nh-bg":           "#d9770618",
    "--nh-border":       "#d9770640",
  },
  light: {
    "--bg-primary":      "#f1f5f9",
    "--bg-secondary":    "#ffffff",
    "--bg-row-alt":      "#f8fafc",
    "--bg-tertiary":     "#e2e8f0",
    "--border":          "#cbd5e1",
    "--border-muted":    "#e2e8f0",
    "--text-faint":      "#94a3b8",
    "--text-dim":        "#64748b",
    "--text-muted":      "#475569",
    "--text-secondary":  "#334155",
    "--text-primary":    "#0f172a",
    "--text-warm":       "#1e293b",
    "--glass-bg":        "rgba(255, 255, 255, 0.7)",
    "--glass-bg-subtle": "rgba(255, 255, 255, 0.5)",
    "--glass-border":    "rgba(0, 0, 0, 0.06)",
    "--card-glow":       "0 1px 3px rgba(0,0,0,0.06), 0 4px 16px rgba(0,0,0,0.04)",
    "--card-hover-glow": "0 2px 8px rgba(0,0,0,0.08), 0 8px 24px rgba(0,0,0,0.06)",
    "--accent-surface":  "rgba(217, 119, 6, 0.04)",
    "--nav-bg":          "rgba(241, 245, 249, 0.85)",
    "--nh-color":        "#92400e",
    "--nh-bg":           "#92400e14",
    "--nh-border":       "#92400e35",
  },
};

export default function App() {
  const [rawData,    setRawData]    = useState(null);
  const [lightMode,  setLightMode]  = useState(true);
  const [currentPage, _setCurrentPage] = useState(() => {
    try { const s = localStorage.getItem(CURRENT_PAGE_KEY); return s ? JSON.parse(s) : { section: "overview" }; }
    catch(e) { return { section: "overview" }; }
  });
  const setCurrentPage = useCallback(page => {
    _setCurrentPage(page);
    try { localStorage.setItem(CURRENT_PAGE_KEY, JSON.stringify(page)); } catch(e) {}
  }, []);
  const [openMenu, setOpenMenu] = useState(null); // null | "dr" | "bz" | "settings"
  const [showToday,  setShowToday]  = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showMbrModal, setShowMbrModal] = useState(false);

  const [showVirgilMbrModal, setShowVirgilMbrModal] = useState(false);
  const [showCorpDataSourcesModal, setShowCorpDataSourcesModal] = useState(false);

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

  const [virgilInsights, _setVirgilInsights] = useState(() => {
    try { return JSON.parse(localStorage.getItem("perf_intel_virgil_insights_v1") || "{}"); } catch(e) { return {}; }
  });
  const setVirgilInsights = useCallback(v => {
    _setVirgilInsights(v);
    try { localStorage.setItem("perf_intel_virgil_insights_v1", JSON.stringify(v || {})); } catch(e) {}
  }, []);

  const [coachingDetailsSheetUrl, _setCoachingDetailsSheetUrl] = useState(() => {
    try { return localStorage.getItem("perf_intel_coaching_details_url_v1") || DEFAULT_CORP_COACHING_DETAILS_URL; } catch(e) { return DEFAULT_CORP_COACHING_DETAILS_URL; }
  });
  const setCoachingDetailsSheetUrl = useCallback(v => {
    _setCoachingDetailsSheetUrl(v);
    try { localStorage.setItem("perf_intel_coaching_details_url_v1", v || ""); } catch(e) {}
  }, []);

  const [coachingWeeklySheetUrl, _setCoachingWeeklySheetUrl] = useState(() => {
    try { return localStorage.getItem("perf_intel_coaching_weekly_url_v1") || DEFAULT_CORP_COACHING_WEEKLY_URL; } catch(e) { return DEFAULT_CORP_COACHING_WEEKLY_URL; }
  });
  const setCoachingWeeklySheetUrl = useCallback(v => {
    _setCoachingWeeklySheetUrl(v);
    try { localStorage.setItem("perf_intel_coaching_weekly_url_v1", v || ""); } catch(e) {}
  }, []);

  const [loginBucketsSheetUrl, _setLoginBucketsSheetUrl] = useState(() => {
    try { return localStorage.getItem("perf_intel_login_buckets_url_v1") || DEFAULT_CORP_LOGIN_BUCKETS_URL; } catch(e) { return DEFAULT_CORP_LOGIN_BUCKETS_URL; }
  });
  const setLoginBucketsSheetUrl = useCallback(v => {
    _setLoginBucketsSheetUrl(v);
    try { localStorage.setItem("perf_intel_login_buckets_url_v1", v || ""); } catch(e) {}
  }, []);

  const [priorQuarterAgentUrl, _setPriorQuarterAgentUrl] = useState(() => {
    try { return localStorage.getItem("perf_intel_prior_quarter_agent_url_v1") || DEFAULT_CORP_PRIOR_QUARTER_AGENT_URL; } catch(e) { return DEFAULT_CORP_PRIOR_QUARTER_AGENT_URL; }
  });
  const setPriorQuarterAgentUrl = useCallback(v => {
    _setPriorQuarterAgentUrl(v);
    try { localStorage.setItem("perf_intel_prior_quarter_agent_url_v1", v || ""); } catch(e) {}
  }, []);

  const [priorQuarterGoalsUrl, _setPriorQuarterGoalsUrl] = useState(() => {
    try { return localStorage.getItem("perf_intel_prior_quarter_goals_url_v1") || DEFAULT_CORP_PRIOR_QUARTER_GOALS_URL; } catch(e) { return DEFAULT_CORP_PRIOR_QUARTER_GOALS_URL; }
  });
  const setPriorQuarterGoalsUrl = useCallback(v => {
    _setPriorQuarterGoalsUrl(v);
    try { localStorage.setItem("perf_intel_prior_quarter_goals_url_v1", v || ""); } catch(e) {}
  }, []);

  const [priorQuarterAgentRaw, _setPriorQuarterAgentRaw] = useState(() => {
    try { return localStorage.getItem("perf_intel_prior_quarter_agent_v1") || ""; } catch(e) { return ""; }
  });
  const setPriorQuarterAgentRaw = useCallback(v => {
    _setPriorQuarterAgentRaw(v);
    try { localStorage.setItem("perf_intel_prior_quarter_agent_v1", v || ""); } catch(e) {}
  }, []);

  const [priorQuarterGoalsRaw, _setPriorQuarterGoalsRaw] = useState(() => {
    try { return localStorage.getItem("perf_intel_prior_quarter_goals_v1") || ""; } catch(e) { return ""; }
  });
  const setPriorQuarterGoalsRaw = useCallback(v => {
    _setPriorQuarterGoalsRaw(v);
    try { localStorage.setItem("perf_intel_prior_quarter_goals_v1", v || ""); } catch(e) {}
  }, []);

  const [corpPriorMonthAgentUrl, _setCorpPriorMonthAgentUrl] = useState(() => {
    try { return localStorage.getItem("perf_intel_corp_prior_month_agent_url_v1") || DEFAULT_CORP_PRIOR_MONTH_AGENT_URL; } catch(e) { return DEFAULT_CORP_PRIOR_MONTH_AGENT_URL; }
  });
  const setCorpPriorMonthAgentUrl = useCallback(v => {
    _setCorpPriorMonthAgentUrl(v);
    try { localStorage.setItem("perf_intel_corp_prior_month_agent_url_v1", v || ""); } catch(e) {}
  }, []);

  const [corpPriorMonthGoalsUrl, _setCorpPriorMonthGoalsUrl] = useState(() => {
    try { return localStorage.getItem("perf_intel_corp_prior_month_goals_url_v1") || DEFAULT_CORP_PRIOR_MONTH_GOALS_URL; } catch(e) { return DEFAULT_CORP_PRIOR_MONTH_GOALS_URL; }
  });
  const setCorpPriorMonthGoalsUrl = useCallback(v => {
    _setCorpPriorMonthGoalsUrl(v);
    try { localStorage.setItem("perf_intel_corp_prior_month_goals_url_v1", v || ""); } catch(e) {}
  }, []);

  const [corpPriorMonthAgentRaw, _setCorpPriorMonthAgentRaw] = useState(() => {
    try { return localStorage.getItem("perf_intel_corp_prior_month_agent_v1") || ""; } catch(e) { return ""; }
  });
  const setCorpPriorMonthAgentRaw = useCallback(v => {
    _setCorpPriorMonthAgentRaw(v);
    try { localStorage.setItem("perf_intel_corp_prior_month_agent_v1", v || ""); } catch(e) {}
  }, []);

  const [corpPriorMonthGoalsRaw, _setCorpPriorMonthGoalsRaw] = useState(() => {
    try { return localStorage.getItem("perf_intel_corp_prior_month_goals_v1") || ""; } catch(e) { return ""; }
  });
  const setCorpPriorMonthGoalsRaw = useCallback(v => {
    _setCorpPriorMonthGoalsRaw(v);
    try { localStorage.setItem("perf_intel_corp_prior_month_goals_v1", v || ""); } catch(e) {}
  }, []);

  const [localAI, setLocalAI]      = useState(false);
  const [ollamaAvailable, setOllamaAvailable] = useState(null); // null=checking, true/false
  const [hoursThreshold, _setHoursThreshold] = useState(_hoursThreshold);
  const [hoursAutoScale, _setHoursAutoScale] = useState(_hoursAutoScale);
  const setHoursThreshold = useCallback(v => {
    const val = Math.max(0.5, Math.min(40, parseFloat(v) || 16));
    _setHoursThreshold(val);
    _hoursThreshold = val;
    try { localStorage.setItem(HOURS_THRESHOLD_KEY, String(val)); } catch(e) {}
  }, []);
  const setHoursAutoScale = useCallback(v => {
    _setHoursAutoScale(v);
    _hoursAutoScale = v;
    try { localStorage.setItem(HOURS_AUTO_KEY, String(v)); } catch(e) {}
  }, []);
  const goalsInputRef               = useRef();
  const nhInputRef                  = useRef();
  const priorGoalsInputRef          = useRef();

  // Check Ollama availability on mount
  useEffect(() => {
    fetch("http://localhost:11434/api/tags", { signal: AbortSignal.timeout(2000) })
      .then(r => r.json())
      .then(d => setOllamaAvailable(d.models && d.models.length > 0))
      .catch(() => setOllamaAvailable(false));
  }, []);

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
  const priorSheetUrl = sheetUrls.prior || DEFAULT_PRIOR_SHEET_URL;
  const priorGoalsSheetUrl = sheetUrls.priorGoals || DEFAULT_PRIOR_GOALS_SHEET_URL;
  const tnpsSheetUrl = sheetUrls.tnps || DEFAULT_TNPS_SHEET_URL;

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

  // Prior month raw data — persisted to localStorage (hoisted from CampaignComparisonPanel)
  const [priorMonthRaw, _setPriorMonthRaw] = useState(() => {
    try { const s = localStorage.getItem(PRIOR_MONTH_STORAGE_KEY); return s ? JSON.parse(s) : null; } catch(e) { return null; }
  });
  const setPriorMonthRaw = useCallback(data => {
    _setPriorMonthRaw(data);
    try { if (data) localStorage.setItem(PRIOR_MONTH_STORAGE_KEY, JSON.stringify(data)); else localStorage.removeItem(PRIOR_MONTH_STORAGE_KEY); } catch(e) {}
  }, []);

  // Prior month goals — persisted to localStorage
  const [priorMonthGoalsRaw, _setPriorMonthGoalsRaw] = useState(() => {
    try { const s = localStorage.getItem(PRIOR_MONTH_STORAGE_KEY + "_goals"); return s ? JSON.parse(s) : null; } catch(e) { return null; }
  });
  const setPriorMonthGoalsRaw = useCallback(data => {
    _setPriorMonthGoalsRaw(data);
    try { if (data) localStorage.setItem(PRIOR_MONTH_STORAGE_KEY + "_goals", JSON.stringify(data)); else localStorage.removeItem(PRIOR_MONTH_STORAGE_KEY + "_goals"); } catch(e) {}
  }, []);

  // Raw CSV text slots — parallel to the parsed-row slots above; used by Corp MBR slide builders
  const [rawAgentCsv, _setRawAgentCsv] = useState(() => {
    try { return localStorage.getItem("perf_intel_raw_agent_csv_v1") || ""; } catch(e) { return ""; }
  });
  const setRawAgentCsv = useCallback(v => {
    _setRawAgentCsv(v);
    try { localStorage.setItem("perf_intel_raw_agent_csv_v1", v || ""); } catch(e) {}
  }, []);

  const [goalsRawCsv, _setGoalsRawCsv] = useState(() => {
    try { return localStorage.getItem("perf_intel_goals_raw_csv_v1") || ""; } catch(e) { return ""; }
  });
  const setGoalsRawCsv = useCallback(v => {
    _setGoalsRawCsv(v);
    try { localStorage.setItem("perf_intel_goals_raw_csv_v1", v || ""); } catch(e) {}
  }, []);

  const [newHiresRawCsv, _setNewHiresRawCsv] = useState(() => {
    try { return localStorage.getItem("perf_intel_nh_raw_csv_v1") || ""; } catch(e) { return ""; }
  });
  const setNewHiresRawCsv = useCallback(v => {
    _setNewHiresRawCsv(v);
    try { localStorage.setItem("perf_intel_nh_raw_csv_v1", v || ""); } catch(e) {}
  }, []);

  const [priorMonthRawCsv, _setPriorMonthRawCsv] = useState(() => {
    try { return localStorage.getItem("perf_intel_prior_month_raw_csv_v1") || ""; } catch(e) { return ""; }
  });
  const setPriorMonthRawCsv = useCallback(v => {
    _setPriorMonthRawCsv(v);
    try { localStorage.setItem("perf_intel_prior_month_raw_csv_v1", v || ""); } catch(e) {}
  }, []);

  const [priorMonthGoalsRawCsv, _setPriorMonthGoalsRawCsv] = useState(() => {
    try { return localStorage.getItem("perf_intel_prior_month_goals_raw_csv_v1") || ""; } catch(e) { return ""; }
  });
  const setPriorMonthGoalsRawCsv = useCallback(v => {
    _setPriorMonthGoalsRawCsv(v);
    try { localStorage.setItem("perf_intel_prior_month_goals_raw_csv_v1", v || ""); } catch(e) {}
  }, []);

  // tNPS survey data — persisted to localStorage
  const [tnpsRaw, _setTnpsRaw] = useState(() => {
    try { const s = localStorage.getItem(TNPS_STORAGE_KEY); return s ? JSON.parse(s) : null; }
    catch(e) { return null; }
  });
  const setTnpsRaw = useCallback(data => {
    _setTnpsRaw(data);
    try {
      if (data) localStorage.setItem(TNPS_STORAGE_KEY, JSON.stringify(data));
      else localStorage.removeItem(TNPS_STORAGE_KEY);
    } catch(e) {}
  }, []);

  // Compute fiscal info early for threshold auto-scaling
  const earlyFiscalInfo = useMemo(() => {
    if (!rawData) return null;
    const dates = rawData.map(r => (r.Date || r.date || "")).filter(Boolean);
    return getFiscalMonthInfo(dates);
  }, [rawData]);

  // Update global threshold before engine runs
  const effectiveThreshold = useMemo(() => {
    const eff = computeEffectiveThreshold(hoursThreshold, earlyFiscalInfo, hoursAutoScale);
    _hoursThreshold = eff;
    return eff;
  }, [hoursThreshold, hoursAutoScale, earlyFiscalInfo]);

  const perf = usePerformanceEngine({ rawData, goalsRaw, newHiresRaw, tnpsRaw });
  const { programs, jobTypes, newHireSet, newHires, allAgentNames } = perf;
  const hasTnps = perf.tnpsData && perf.tnpsData.length > 0;

  // Prior month derived data (hoisted for app-wide access)
  const priorAgents = useMemo(() => normalizeAgents(priorMonthRaw || []), [priorMonthRaw]);
  const priorGoalLookup = useMemo(() => buildGoalLookup(priorMonthGoalsRaw), [priorMonthGoalsRaw]);

  const siteRegionGroups = useMemo(() => {
    if (!perf.agents || perf.agents.length === 0) return { dr: [], bz: [] };
    const allRegions = [...new Set(perf.agents.map(a => a.region).filter(Boolean))];
    return {
      dr: allRegions.filter(r => !r.toUpperCase().includes("XOTM")),
      bz: allRegions.filter(r => r.toUpperCase().includes("XOTM")),
    };
  }, [perf.agents]);

  const programsBySite = useMemo(() => {
    const result = { DR: [], BZ: [] };
    if (!perf.programs || !perf.fiscalInfo) return result;
    const { elapsedBDays, totalBDays } = perf.fiscalInfo;
    [["DR", siteRegionGroups.dr], ["BZ", siteRegionGroups.bz]].forEach(([siteKey, regs]) => {
      if (regs.length === 0) return;
      perf.programs.forEach(prog => {
        const siteAgents = prog.agents.filter(a => regs.includes(a.region));
        if (siteAgents.length === 0) return;
        const sub = buildProgram(siteAgents, prog.jobType, filterGoalEntriesBySite(prog.goalEntries, siteKey), newHireSet);
        const pacing = sub.attainment != null && sub.planGoals
          ? calcPacing(sub.actGoals, sub.planGoals, elapsedBDays, totalBDays) : null;
        result[siteKey].push({
          jobType: prog.jobType,
          attainment: sub.attainment,
          projAttainment: pacing ? pacing.projectedPct : null,
          category: getMbrCategory(prog.jobType),
          actGoals: sub.actGoals,
          planGoals: sub.planGoals,
        });
      });
      result[siteKey].sort((a, b) => (b.attainment ?? -1) - (a.attainment ?? -1));
    });
    return result;
  }, [perf.programs, perf.fiscalInfo, siteRegionGroups, newHireSet]);

  const siteAttainments = useMemo(() => {
    const result = { DR: { attainment: null, projAttainment: null }, BZ: { attainment: null, projAttainment: null } };
    if (!perf.fiscalInfo) return result;
    const { elapsedBDays, totalBDays } = perf.fiscalInfo;
    ["DR", "BZ"].forEach(siteKey => {
      const list = programsBySite[siteKey];
      if (!list || list.length === 0) return;
      const actGoals = list.reduce((s, p) => s + (p.actGoals || 0), 0);
      const planGoals = list.reduce((s, p) => s + (p.planGoals || 0), 0);
      if (planGoals > 0) {
        const attainment = (actGoals / planGoals) * 100;
        const pacing = calcPacing(actGoals, planGoals, elapsedBDays, totalBDays);
        result[siteKey] = { attainment, projAttainment: pacing ? pacing.projectedPct : null };
      }
    });
    return result;
  }, [programsBySite, perf.fiscalInfo]);

  const filteredProgram = useMemo(() => {
    if (!currentPage.program) return null;
    if (currentPage.section !== "dr" && currentPage.section !== "bz") return null;
    const baseProgram = perf.programMap[currentPage.program];
    if (!baseProgram) return null;
    const siteKey = currentPage.section === "dr" ? "DR" : "BZ";
    const regs = currentPage.section === "dr" ? siteRegionGroups.dr : siteRegionGroups.bz;
    const siteAgents = baseProgram.agents.filter(a => regs.includes(a.region));
    if (siteAgents.length === 0) return null;
    return buildProgram(siteAgents, baseProgram.jobType, filterGoalEntriesBySite(baseProgram.goalEntries, siteKey), newHireSet);
  }, [currentPage, perf.programMap, siteRegionGroups, newHireSet]);

  // AI prefetch counter — triggers re-renders as cache fills
  const [aiPrefetchDone, setAiPrefetchDone] = useState(0);

  // Prefetch all AI summaries when localAI is on and data is loaded
  useEffect(() => {
    if (!localAI || !rawData || programs.length === 0) return;
    const fiscalInfo = perf.fiscalInfo;
    const promptDataList = [];

    // Business overview
    const bizData = {
      jobType: "Business Wide", uniqueAgentCount: perf.uniqueAgentCount,
      totalHours: perf.totalHours, totalGoals: perf.globalGoals, gph: perf.totalHours > 0 ? perf.globalGoals / perf.totalHours : 0,
      attainment: perf.planTotal ? (perf.globalGoals / perf.planTotal) * 100 : null,
      planGoals: perf.planTotal, actGoals: perf.globalGoals,
      distUnique: {}, q1Agents: [], q4Agents: [], q3Agents: [],
      regions: perf.regions, healthScore: null,
      totalNewXI: programs.reduce((s, p) => s + (p.totalNewXI || 0), 0),
      totalXmLines: programs.reduce((s, p) => s + (p.totalXmLines || 0), 0),
      totalRgu: programs.reduce((s, p) => s + (p.totalRgu || 0), 0),
      newHiresInProgram: [], fiscalInfo,
    };
    promptDataList.push({ type: "narrative", data: bizData });
    promptDataList.push({ type: "wins", data: bizData });
    promptDataList.push({ type: "opps", data: bizData });

    // Each program
    for (const prog of programs) {
      const pData = { ...prog, fiscalInfo };
      promptDataList.push({ type: "narrative", data: pData });
      promptDataList.push({ type: "wins", data: pData });
      promptDataList.push({ type: "opps", data: pData });
    }

    const tasks = prefetchAI(promptDataList);
    if (tasks.length > 0) {
      let completed = 0;
      tasks.forEach(t => t.then(() => { completed++; if (completed === tasks.length) setAiPrefetchDone(v => v + 1); }));
    }
  }, [localAI, rawData, programs.length]);

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
          setRawAgentCsv(text);
          setRawData(rows);
          setCurrentPage({ section: "overview" });
        }
        // Auto-load goals sheet if URL configured
        if (!cancelled && goalsSheetUrl && !goalsRaw) {
          try {
            const proxyG = url => `https://corsproxy.io/?${encodeURIComponent(url)}`;
            let gRes;
            try { gRes = await fetch(goalsSheetUrl); } catch(e) { gRes = null; }
            if (!gRes || !gRes.ok) gRes = await fetch(proxyG(goalsSheetUrl));
            if (gRes.ok) { const gText = await gRes.text(); const gRows = parseCSV(gText); if (gRows.length > 0) { setGoalsRawCsv(gText); setGoalsRaw(gRows); } }
          } catch(e) {}
        }
        // Auto-load roster sheet if URL configured
        if (!cancelled && nhSheetUrl && !newHiresRaw) {
          try {
            const proxyN = url => `https://corsproxy.io/?${encodeURIComponent(url)}`;
            let nRes;
            try { nRes = await fetch(nhSheetUrl); } catch(e) { nRes = null; }
            if (!nRes || !nRes.ok) nRes = await fetch(proxyN(nhSheetUrl));
            if (nRes.ok) { const nText = await nRes.text(); const nRows = parseCSV(nText); if (nRows.length > 0) { setNewHiresRawCsv(nText); setNHRaw(nRows); } }
          } catch(e) {}
        }
        // tNPS loads separately after main data (see deferred useEffect below)
      } catch (e) {
        if (!cancelled) setSheetError("Auto-load unavailable — use file upload or paste");
      } finally {
        if (!cancelled) setSheetLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Auto-load tNPS data from Google Sheet (after main data loads, non-blocking, priority over prior month)
  useEffect(() => {
    if (!rawData || tnpsRaw || !tnpsSheetUrl) return;
    let cancelled = false;
    (async () => {
      try {
        const proxyT = url => `https://corsproxy.io/?${encodeURIComponent(url)}`;
        let res;
        try { res = await fetch(tnpsSheetUrl); } catch(e) { res = null; }
        if (!res || !res.ok) res = await fetch(proxyT(tnpsSheetUrl));
        if (res.ok) { const rows = parseCSV(await res.text()); if (!cancelled && rows.length > 0) setTnpsRaw(rows); }
      } catch(e) { /* silent */ }
    })();
    return () => { cancelled = true; };
  }, [rawData, tnpsSheetUrl, tnpsRaw]);

  // Auto-load Virgil Coaching Details from Google Sheet URL
  useEffect(() => {
    if (!coachingDetailsSheetUrl) return;
    (async () => {
      try {
        const res = await fetch(coachingDetailsSheetUrl);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const text = await res.text();
        setCoachingDetailsRaw(text);
      } catch(e) {
        try {
          const res = await fetch(`https://corsproxy.io/?${encodeURIComponent(coachingDetailsSheetUrl)}`);
          if (!res.ok) throw new Error(`Proxy HTTP ${res.status}`);
          setCoachingDetailsRaw(await res.text());
        } catch(e2) {
          console.error("Coaching Details sheet fetch failed:", e2);
        }
      }
    })();
  }, [coachingDetailsSheetUrl]);

  // Auto-load Virgil Weekly Breakdown from Google Sheet URL
  useEffect(() => {
    if (!coachingWeeklySheetUrl) return;
    (async () => {
      try {
        const res = await fetch(coachingWeeklySheetUrl);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const text = await res.text();
        setCoachingWeeklyRaw(text);
      } catch(e) {
        try {
          const res = await fetch(`https://corsproxy.io/?${encodeURIComponent(coachingWeeklySheetUrl)}`);
          if (!res.ok) throw new Error(`Proxy HTTP ${res.status}`);
          setCoachingWeeklyRaw(await res.text());
        } catch(e2) {
          console.error("Weekly Breakdown sheet fetch failed:", e2);
        }
      }
    })();
  }, [coachingWeeklySheetUrl]);

  // Auto-load Virgil Login Buckets from Google Sheet URL
  useEffect(() => {
    if (!loginBucketsSheetUrl) return;
    (async () => {
      try {
        const res = await fetch(loginBucketsSheetUrl);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const text = await res.text();
        setLoginBucketsRaw(text);
      } catch(e) {
        try {
          const res = await fetch(`https://corsproxy.io/?${encodeURIComponent(loginBucketsSheetUrl)}`);
          if (!res.ok) throw new Error(`Proxy HTTP ${res.status}`);
          setLoginBucketsRaw(await res.text());
        } catch(e2) {
          console.error("Login Buckets sheet fetch failed:", e2);
        }
      }
    })();
  }, [loginBucketsSheetUrl]);

  useEffect(() => {
    if (!priorQuarterAgentUrl) return;
    (async () => {
      try {
        const res = await fetch(priorQuarterAgentUrl);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const text = await res.text();
        setPriorQuarterAgentRaw(text);
      } catch(e) {
        try {
          const res = await fetch(`https://corsproxy.io/?${encodeURIComponent(priorQuarterAgentUrl)}`);
          if (!res.ok) throw new Error(`Proxy HTTP ${res.status}`);
          setPriorQuarterAgentRaw(await res.text());
        } catch(e2) {
          console.error("Prior Quarter Agent sheet fetch failed:", e2);
        }
      }
    })();
  }, [priorQuarterAgentUrl]);

  useEffect(() => {
    if (!priorQuarterGoalsUrl) return;
    (async () => {
      try {
        const res = await fetch(priorQuarterGoalsUrl);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const text = await res.text();
        setPriorQuarterGoalsRaw(text);
      } catch(e) {
        try {
          const res = await fetch(`https://corsproxy.io/?${encodeURIComponent(priorQuarterGoalsUrl)}`);
          if (!res.ok) throw new Error(`Proxy HTTP ${res.status}`);
          setPriorQuarterGoalsRaw(await res.text());
        } catch(e2) {
          console.error("Prior Quarter Goals sheet fetch failed:", e2);
        }
      }
    })();
  }, [priorQuarterGoalsUrl]);

  useEffect(() => {
    if (!corpPriorMonthAgentUrl) return;
    (async () => {
      try {
        const res = await fetch(corpPriorMonthAgentUrl);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const text = await res.text();
        setCorpPriorMonthAgentRaw(text);
      } catch(e) {
        try {
          const res = await fetch(`https://corsproxy.io/?${encodeURIComponent(corpPriorMonthAgentUrl)}`);
          if (!res.ok) throw new Error(`Proxy HTTP ${res.status}`);
          setCorpPriorMonthAgentRaw(await res.text());
        } catch(e2) {
          console.error("Corp Prior Month Agent sheet fetch failed:", e2);
        }
      }
    })();
  }, [corpPriorMonthAgentUrl]);

  useEffect(() => {
    if (!corpPriorMonthGoalsUrl) return;
    (async () => {
      try {
        const res = await fetch(corpPriorMonthGoalsUrl);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const text = await res.text();
        setCorpPriorMonthGoalsRaw(text);
      } catch(e) {
        try {
          const res = await fetch(`https://corsproxy.io/?${encodeURIComponent(corpPriorMonthGoalsUrl)}`);
          if (!res.ok) throw new Error(`Proxy HTTP ${res.status}`);
          setCorpPriorMonthGoalsRaw(await res.text());
        } catch(e2) {
          console.error("Corp Prior Month Goals sheet fetch failed:", e2);
        }
      }
    })();
  }, [corpPriorMonthGoalsUrl]);

  // Auto-load prior month data from Google Sheet (after main data loads, non-blocking)
  const [priorSheetLoading, setPriorSheetLoading] = useState(false);
  useEffect(() => {
    if (!rawData || (priorMonthRaw && priorMonthRawCsv) || !priorSheetUrl || priorSheetLoading) return;
    let cancelled = false;
    (async () => {
      try {
        setPriorSheetLoading(true);
        const proxyP = url => `https://corsproxy.io/?${encodeURIComponent(url)}`;
        let res;
        try { res = await fetch(priorSheetUrl); } catch(e) { res = null; }
        if (!res || !res.ok) res = await fetch(proxyP(priorSheetUrl));
        const text = await res.text();
        const rows = parseCSV(text);
        if (!cancelled && rows.length > 0) { setPriorMonthRawCsv(text); setPriorMonthRaw(rows); }
      } catch(e) { /* silent */ }
      finally { if (!cancelled) setPriorSheetLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [rawData, priorSheetUrl, priorMonthRaw, priorMonthRawCsv]);

  // Auto-load prior month goals from Google Sheet (after prior data loads)
  useEffect(() => {
    if (!rawData || (priorMonthGoalsRaw && priorMonthGoalsRawCsv) || !priorGoalsSheetUrl) return;
    let cancelled = false;
    (async () => {
      try {
        const proxyP = url => `https://corsproxy.io/?${encodeURIComponent(url)}`;
        let res;
        try { res = await fetch(priorGoalsSheetUrl); } catch(e) { res = null; }
        if (!res || !res.ok) res = await fetch(proxyP(priorGoalsSheetUrl));
        const text = await res.text();
        const rows = parseCSV(text);
        if (!cancelled && rows.length > 0) { setPriorMonthGoalsRawCsv(text); setPriorMonthGoalsRaw(rows); }
      } catch(e) { /* silent */ }
    })();
    return () => { cancelled = true; };
  }, [rawData, tnpsSheetUrl, tnpsRaw]);

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

  const loadFile = (f, setter, textSetter) => {
    const r = new FileReader();
    r.onload = e => {
      const text = e.target.result;
      if (textSetter) textSetter(text);
      setter(parseCSV(text));
    };
    r.readAsText(f);
  };

  const handleRefresh = useCallback(async () => {
    const proxy = url => `https://corsproxy.io/?${encodeURIComponent(url)}`;
    // Returns { rows, text } — text preserved so Corp MBR slide builders can consume raw CSV
    const fetchSheetWithText = async url => {
      try {
        let res;
        try { res = await fetch(url); } catch(e) { res = null; }
        if (!res || !res.ok) res = await fetch(proxy(url));
        if (!res.ok) return null;
        const text = await res.text();
        const rows = parseCSV(text);
        return rows.length > 0 ? { rows, text } : null;
      } catch(e) { return null; }
    };
    // Legacy helper that returns only rows (for callers that don't need text)
    const fetchSheet = async url => {
      const r = await fetchSheetWithText(url);
      return r ? r.rows : null;
    };
    try {
      setSheetLoading(true);
      const agentResult = await fetchSheetWithText(agentSheetUrl);
      if (agentResult) { setRawAgentCsv(agentResult.text); setRawData(agentResult.rows); }
      // Refresh secondary sheets in parallel
      await Promise.all([
        goalsSheetUrl ? fetchSheetWithText(goalsSheetUrl).then(r => { if (r) { setGoalsRawCsv(r.text); setGoalsRaw(r.rows); } }) : null,
        nhSheetUrl ? fetchSheetWithText(nhSheetUrl).then(r => { if (r) { setNewHiresRawCsv(r.text); setNHRaw(r.rows); } }) : null,
        priorSheetUrl ? fetchSheetWithText(priorSheetUrl).then(r => { if (r) { setPriorMonthRawCsv(r.text); setPriorMonthRaw(r.rows); } }) : null,
        priorGoalsSheetUrl ? fetchSheetWithText(priorGoalsSheetUrl).then(r => { if (r) { setPriorMonthGoalsRawCsv(r.text); setPriorMonthGoalsRaw(r.rows); } }) : null,
        tnpsSheetUrl ? fetchSheet(tnpsSheetUrl).then(r => { if (r) setTnpsRaw(r); }) : null,
        coachingDetailsSheetUrl ? (async () => {
          try {
            let res; try { res = await fetch(coachingDetailsSheetUrl); } catch(e) { res = null; }
            if (!res || !res.ok) res = await fetch(proxy(coachingDetailsSheetUrl));
            if (res.ok) { const t = await res.text(); if (t.trim()) setCoachingDetailsRaw(t); }
          } catch(e) {}
        })() : null,
        coachingWeeklySheetUrl ? (async () => {
          try {
            let res; try { res = await fetch(coachingWeeklySheetUrl); } catch(e) { res = null; }
            if (!res || !res.ok) res = await fetch(proxy(coachingWeeklySheetUrl));
            if (res.ok) { const t = await res.text(); if (t.trim()) setCoachingWeeklyRaw(t); }
          } catch(e) {}
        })() : null,
        loginBucketsSheetUrl ? (async () => {
          try {
            let res; try { res = await fetch(loginBucketsSheetUrl); } catch(e) { res = null; }
            if (!res || !res.ok) res = await fetch(proxy(loginBucketsSheetUrl));
            if (res.ok) { const t = await res.text(); if (t.trim()) setLoginBucketsRaw(t); }
          } catch(e) {}
        })() : null,
        priorQuarterAgentUrl ? (async () => {
          try {
            let res; try { res = await fetch(priorQuarterAgentUrl); } catch(e) { res = null; }
            if (!res || !res.ok) res = await fetch(proxy(priorQuarterAgentUrl));
            if (res.ok) { const t = await res.text(); if (t.trim()) setPriorQuarterAgentRaw(t); }
          } catch(e) {}
        })() : null,
        priorQuarterGoalsUrl ? (async () => {
          try {
            let res; try { res = await fetch(priorQuarterGoalsUrl); } catch(e) { res = null; }
            if (!res || !res.ok) res = await fetch(proxy(priorQuarterGoalsUrl));
            if (res.ok) { const t = await res.text(); if (t.trim()) setPriorQuarterGoalsRaw(t); }
          } catch(e) {}
        })() : null,
        corpPriorMonthAgentUrl ? (async () => {
          try {
            let res; try { res = await fetch(corpPriorMonthAgentUrl); } catch(e) { res = null; }
            if (!res || !res.ok) res = await fetch(proxy(corpPriorMonthAgentUrl));
            if (res.ok) { const t = await res.text(); if (t.trim()) setCorpPriorMonthAgentRaw(t); }
          } catch(e) {}
        })() : null,
        corpPriorMonthGoalsUrl ? (async () => {
          try {
            let res; try { res = await fetch(corpPriorMonthGoalsUrl); } catch(e) { res = null; }
            if (!res || !res.ok) res = await fetch(proxy(corpPriorMonthGoalsUrl));
            if (res.ok) { const t = await res.text(); if (t.trim()) setCorpPriorMonthGoalsRaw(t); }
          } catch(e) {}
        })() : null,
      ].filter(Boolean));
    } catch(e) { alert("Could not refresh: " + e.message); }
    finally { setSheetLoading(false); }
  }, [agentSheetUrl, goalsSheetUrl, nhSheetUrl, priorSheetUrl, priorGoalsSheetUrl, tnpsSheetUrl, coachingDetailsSheetUrl, coachingWeeklySheetUrl, loginBucketsSheetUrl, priorQuarterAgentUrl, priorQuarterGoalsUrl, corpPriorMonthAgentUrl, corpPriorMonthGoalsUrl]);

  // Legacy navigation adapter — translates old slideIndex semantics from
  // BusinessOverview/CampaignComparisonPanel into currentPage navigation.
  // BusinessOverview always called these from the "overview" page (slideIndex 0),
  // so navTo(N) and goToSlide(N) both equal "go to slide N" in absolute terms.
  const legacyGoToSlide = useCallback(idx => {
    if (idx === 0) { setCurrentPage({ section: "overview" }); return; }
    if (hasTnps && idx === programs.length + 2) { setCurrentPage({ section: "tnps" }); return; }
    if (idx === programs.length + 1) { setCurrentPage({ section: "mom" }); return; }
    if (idx > 0 && idx <= programs.length) {
      const program = programs[idx - 1];
      const drHas = program.agents.some(a => siteRegionGroups.dr.includes(a.region));
      setCurrentPage({ section: drHas ? "dr" : "bz", program: program.jobType });
    }
  }, [hasTnps, programs, siteRegionGroups]);

  useEffect(() => {
    const vars = lightMode ? THEMES.light : THEMES.dark;
    const root = document.documentElement;
    Object.entries(vars).forEach(([k, v]) => root.style.setProperty(k, v));
    root.style.background = vars["--bg-primary"];
  }, [lightMode]);

  const wrapStyle = { minHeight: "100vh", background: "var(--bg-primary)", color: "var(--text-primary)" };

  // If no agent data and not showing Today, show the drop zone

  return (
    <div style={wrapStyle}>
      {showMbrModal && rawData && <MbrExportModal perf={perf} onClose={() => setShowMbrModal(false)} />}
      {showVirgilMbrModal && (
        <VirgilMbrExportModal
          perf={perf}
          coachingDetailsRaw={coachingDetailsRaw}
          coachingWeeklyRaw={coachingWeeklyRaw}
          loginBucketsRaw={loginBucketsRaw}
          rawAgentCsv={rawAgentCsv}
          goalsRaw={goalsRawCsv}
          priorMonthRaw={priorMonthRawCsv}
          priorMonthGoalsRaw={priorMonthGoalsRawCsv}
          newHiresRaw={newHiresRawCsv}
          priorQuarterAgentRaw={priorQuarterAgentRaw}
          priorQuarterGoalsRaw={priorQuarterGoalsRaw}
          corpPriorMonthAgentRaw={corpPriorMonthAgentRaw}
          corpPriorMonthGoalsRaw={corpPriorMonthGoalsRaw}
          insights={virgilInsights}
          setInsights={setVirgilInsights}
          ollamaAvailable={ollamaAvailable}
          onClose={() => setShowVirgilMbrModal(false)}
        />
      )}
      {showCorpDataSourcesModal && (
        <CorpMbrDataSourcesModal
          coachingDetailsSheetUrl={coachingDetailsSheetUrl}
          setCoachingDetailsSheetUrl={setCoachingDetailsSheetUrl}
          coachingWeeklySheetUrl={coachingWeeklySheetUrl}
          setCoachingWeeklySheetUrl={setCoachingWeeklySheetUrl}
          loginBucketsSheetUrl={loginBucketsSheetUrl}
          setLoginBucketsSheetUrl={setLoginBucketsSheetUrl}
          corpPriorMonthAgentUrl={corpPriorMonthAgentUrl}
          setCorpPriorMonthAgentUrl={setCorpPriorMonthAgentUrl}
          corpPriorMonthGoalsUrl={corpPriorMonthGoalsUrl}
          setCorpPriorMonthGoalsUrl={setCorpPriorMonthGoalsUrl}
          priorQuarterAgentUrl={priorQuarterAgentUrl}
          setPriorQuarterAgentUrl={setPriorQuarterAgentUrl}
          priorQuarterGoalsUrl={priorQuarterGoalsUrl}
          setPriorQuarterGoalsUrl={setPriorQuarterGoalsUrl}
          onClose={() => setShowCorpDataSourcesModal(false)}
        />
      )}

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
            {/* Hours Threshold */}
            <div style={{ marginTop: "0.5rem", marginBottom: "1rem", padding: "1rem", background: "var(--bg-secondary)", border: "1px solid var(--border)", borderRadius: "var(--radius-md, 10px)" }}>
              <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.78rem", color: "#d97706", letterSpacing: "0.08em", marginBottom: "0.5rem" }}>Qualified Hours Threshold</div>
              <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "0.5rem" }}>
                <span style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.82rem", color: "var(--text-muted)" }}>Base:</span>
                <input
                  type="number" min="0.5" max="40" step="0.5"
                  value={hoursThreshold}
                  onChange={e => setHoursThreshold(e.target.value)}
                  style={{ width: "70px", padding: "0.35rem 0.5rem", fontFamily: "var(--font-data, monospace)", fontSize: "0.95rem", background: "var(--bg-primary)", color: "var(--text-primary)", border: "1px solid var(--border)", borderRadius: "4px", textAlign: "center" }}
                />
                <span style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.82rem", color: "var(--text-dim)" }}>hours</span>
                <div style={{ flex: 1 }} />
                <button onClick={() => setHoursAutoScale(v => !v)}
                  style={{ padding: "0.3rem 0.7rem", borderRadius: "var(--radius-sm, 6px)", border: `1px solid ${hoursAutoScale ? "#16a34a50" : "var(--border-muted)"}`, background: hoursAutoScale ? "#16a34a12" : "transparent", color: hoursAutoScale ? "#16a34a" : "var(--text-muted)", fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.75rem", cursor: "pointer", fontWeight: 500 }}>
                  {hoursAutoScale ? "\u25CF" : "\u25CB"} Auto-Scale
                </button>
              </div>
              {hoursAutoScale && earlyFiscalInfo && (
                <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.78rem", color: "var(--text-dim)", lineHeight: 1.5 }}>
                  Effective threshold: <strong style={{ color: "var(--text-warm)" }}>{effectiveThreshold} hrs</strong> (day {earlyFiscalInfo.elapsedBDays} of {earlyFiscalInfo.totalBDays} — scales {hoursThreshold} hrs proportionally through the month)
                </div>
              )}
              {!hoursAutoScale && (
                <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.78rem", color: "var(--text-dim)" }}>
                  Fixed at {hoursThreshold} hours. Enable Auto-Scale to adjust for early-month data.
                </div>
              )}
            </div>
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
      <input ref={goalsInputRef} type="file" accept=".csv" style={{ display: "none" }} onChange={e => loadFile(e.target.files[0], setGoalsRaw, setGoalsRawCsv)} />
      <input ref={nhInputRef} type="file" accept=".csv" style={{ display: "none" }} onChange={e => loadFile(e.target.files[0], setNHRaw, setNewHiresRawCsv)} />
      <input ref={priorGoalsInputRef} type="file" accept=".csv" style={{ display: "none" }} onChange={e => loadFile(e.target.files[0], setPriorMonthGoalsRaw, setPriorMonthGoalsRawCsv)} />

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
        onExportVirgilMbr={() => setShowVirgilMbrModal(true)}
        onOpenCorpDataSources={() => setShowCorpDataSourcesModal(true)}
        onRefresh={handleRefresh}
        onUploadGoals={() => goalsInputRef.current.click()}
        onUploadRoster={() => nhInputRef.current.click()}
        onUploadPriorGoals={() => priorGoalsInputRef.current.click()}
        onUploadCoachingDetails={handleCoachingDetailsUpload}
        onUploadCoachingWeekly={handleCoachingWeeklyUpload}
        onUploadLoginBuckets={handleLoginBucketsUpload}
        onOpenSettings={() => setShowSettings(true)}
      />

      <div style={{ paddingTop: "48px" }}>
        <Breadcrumb
          section={currentPage.section}
          program={currentPage.program}
          attainment={filteredProgram ? filteredProgram.attainment : null}
        />
        {showToday ? (
          <TodayView recentAgentNames={recentAgentNames} historicalAgentMap={historicalAgentMap} goalLookup={perf.goalLookup} />
        ) : sheetLoading && !rawData ? (
          <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: "var(--bg-primary)", animation: "fadeIn 0.4s ease" }}>
            <div style={{ fontFamily: "var(--font-ui, Inter, sans-serif)", fontSize: "0.82rem", color: "var(--text-muted)", letterSpacing: "0.1em", marginBottom: "1.25rem", fontWeight: 500 }}>LOADING</div>
            <div style={{ width: "180px", height: "2px", background: "var(--border)", borderRadius: "2px", overflow: "hidden" }}>
              <div style={{ width: "40%", height: "100%", background: "linear-gradient(90deg, #d97706, #f59e0b)", borderRadius: "2px", animation: "shimmer 1.5s ease-in-out infinite" }} />
            </div>
          </div>
        ) : !rawData ? (
          <DropZone
            onData={d => { setRawData(d); setCurrentPage({ section: "overview" }); }}
            onAgentText={setRawAgentCsv}
            goalsRaw={goalsRaw}
            onGoalsLoad={setGoalsRaw}
            onGoalsText={setGoalsRawCsv}
            newHiresRaw={newHiresRaw}
            onNewHiresLoad={setNHRaw}
            onNHText={setNewHiresRawCsv}
          />
        ) : programs.length === 0 ? (
          <div style={{ minHeight: "90vh", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-faint)", fontFamily: "var(--font-ui, Inter, sans-serif)" }}>
            No "Job Type" column found in your data.
          </div>
        ) : currentPage.section === "overview" ? (
          <BusinessOverview perf={perf} onNav={legacyGoToSlide} goToSlide={legacyGoToSlide} tnpsSlideIdx={hasTnps ? programs.length + 2 : -1} localAI={localAI} priorAgents={priorAgents} priorGoalLookup={priorGoalLookup} lightMode={lightMode} />
        ) : currentPage.section === "tnps" && hasTnps ? (
          <TNPSSlide perf={perf} onNav={() => {}} lightMode={lightMode} />
        ) : currentPage.section === "mom" ? (
          <CampaignComparisonPanel
            currentAgents={perf.agents}
            onNav={() => setCurrentPage({ section: "overview" })}
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
