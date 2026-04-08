/**
 * constants.js — Shared constants and formatting utilities
 * Ported from app.jsx lines 64-240, 434-461
 */

// ── Quartile Definitions ────────────────────────────────────────────────────
const Q_DEFS = {
    Q1: { color: '#16a34a', glow: '#16a34a33', label: '100%+ to Goal',    badge: 'EXCEEDING',   icon: '▲' },
    Q2: { color: '#2563eb', glow: '#2563eb33', label: '80–99.9% to Goal',  badge: 'NEAR GOAL',   icon: '◆' },
    Q3: { color: '#d97706', glow: '#d9770633', label: '1–79.9% to Goal',   badge: 'BELOW GOAL',  icon: '●' },
    Q4: { color: '#dc2626', glow: '#dc262633', label: '0% to Goal',        badge: 'NO ACTIVITY', icon: '■' },
};

function getQuartile(pctToGoal) {
    if (pctToGoal >= 100) return 'Q1';
    if (pctToGoal >= 80)  return 'Q2';
    if (pctToGoal > 0)    return 'Q3';
    return 'Q4';
}

function attainColor(pct) {
    if (pct >= 100) return Q_DEFS.Q1.color;
    if (pct >= 80)  return Q_DEFS.Q2.color;
    if (pct > 0)    return Q_DEFS.Q3.color;
    return Q_DEFS.Q4.color;
}

function bonusColor(pct) {
    if (pct > 0)  return '#16a34a';
    if (pct < 0)  return '#dc2626';
    return 'var(--text-dim)';
}

// ── Gainshare Tiers ─────────────────────────────────────────────────────────
const GAINSHARE_TIERS = [
    { min: 126,  max: Infinity, mobile: 4.00, hsd: 4.00, costPer: 1.00, sph: 1.00, label: '> 126%' },
    { min: 120,  max: 125.99,   mobile: 3.00, hsd: 3.00, costPer: 0.75, sph: 0.75, label: '120–126%' },
    { min: 113,  max: 119.99,   mobile: 2.00, hsd: 2.00, costPer: 0.50, sph: 0.50, label: '113–119%' },
    { min: 106,  max: 112.99,   mobile: 1.00, hsd: 1.00, costPer: 0.25, sph: 0.25, label: '106–112%' },
    { min: 95,   max: 105.99,   mobile: 0,    hsd: 0,    costPer: 0,    sph: 0,    label: '95–105%' },
    { min: 88,   max: 94.99,    mobile:-1.00, hsd:-1.00, costPer:-0.25, sph:-0.25, label: '88–94%' },
    { min: 81,   max: 87.99,    mobile:-2.00, hsd:-2.00, costPer:-0.50, sph:-0.50, label: '81–87%' },
    { min: 74,   max: 80.99,    mobile:-3.00, hsd:-3.00, costPer:-0.75, sph:-0.75, label: '74–80%' },
    { min: 0,    max: 73.99,    mobile:-4.00, hsd:-4.00, costPer:-1.00, sph:-1.00, label: '< 74%' },
];

const GAINSHARE_SITE_TIERS = [
    { min: 139, max: Infinity, mobile: 4.00, hsd: 4.00, costPer: 2.50, sph: 1.00, label: '> 139%' },
    { min: 129, max: 139,      mobile: 3.00, hsd: 3.00, costPer: 2.00, sph: 0.75, label: '129–139%' },
    { min: 118, max: 128.99,   mobile: 2.00, hsd: 2.00, costPer: 1.50, sph: 0.50, label: '118–128.99%' },
    { min: 107, max: 117.99,   mobile: 1.00, hsd: 1.00, costPer: 0.50, sph: 0.25, label: '107–117.99%' },
    { min: 100, max: 106.99,   mobile: 0,    hsd: 0,    costPer: 0,    sph: 0,    label: '100–106.99%' },
    { min: 95,  max: 99.99,    mobile:-1.00, hsd:-1.00, costPer:-0.50, sph:-0.25, label: '95–99.99%' },
    { min: 90,  max: 94.99,    mobile:-2.00, hsd:-2.00, costPer:-1.00, sph:-0.50, label: '90–94.99%' },
    { min: 85,  max: 89.99,    mobile:-3.00, hsd:-3.00, costPer:-2.00, sph:-0.75, label: '85–89.99%' },
    { min: 80,  max: 84.99,    mobile:-4.00, hsd:-4.00, costPer:-2.50, sph:-1.00, label: '80–84.99%' },
    { min: 0,   max: 79.99,    mobile:-5.00, hsd:-5.00, costPer:-3.00, sph:-1.00, label: '< 79.99%' },
];

const HOUR_GATE_SITE_TIERS = [
    { min: 100,  max: Infinity, penalty: 0,     label: '\u2265 100%' },
    { min: 95,   max: 99.99,    penalty: -2.00, label: '95\u201399.99%' },
    { min: 90,   max: 94.99,    penalty: -4.00, label: '90\u201394.99%' },
    { min: 0,    max: 89.99,    penalty: -6.00, label: '< 90%' },
];

function getGainshareTier(pct, site) {
    if (pct === null || pct === undefined) return null;
    var tiers = site ? GAINSHARE_SITE_TIERS : GAINSHARE_TIERS;
    return tiers.find(t => pct >= t.min && pct <= t.max) || tiers[tiers.length - 1];
}

function getHourGateTier(pct) {
    if (pct === null || pct === undefined) return null;
    return HOUR_GATE_SITE_TIERS.find(t => pct >= t.min && pct <= t.max) || HOUR_GATE_SITE_TIERS[HOUR_GATE_SITE_TIERS.length - 1];
}

// ── Goal Metrics Definition ─────────────────────────────────────────────────
const GOAL_METRICS = [
    { goalKey: 'Hours Goal',       label: 'Hours',     actualKey: 'hours',    mode: 'sum', fmt: 'num'  },
    { goalKey: 'SPH GOAL',         label: 'SPH / GPH', actualKey: 'gph',      mode: 'avg', fmt: 'dec2' },
    { goalKey: 'HOMES GOAL',       label: 'Homes',     actualKey: 'goals',    mode: 'sum', fmt: 'num'  },
    { goalKey: 'RGU GOAL',         label: 'RGU',       actualKey: 'rgu',      mode: 'sum', fmt: 'num'  },
    { goalKey: 'HSD Sell In Goal', label: 'New XI',    actualKey: 'newXI',    mode: 'sum', fmt: 'num'  },
    { goalKey: 'XM GOAL',          label: 'XM Lines',  actualKey: 'xmLines',  mode: 'sum', fmt: 'num'  },
    { goalKey: 'VIDEO GOAL',       label: 'Video',     actualKey: 'newVideo', mode: 'sum', fmt: 'num'  },
    { goalKey: 'XH GOAL',          label: 'XH',        actualKey: 'newXH',    mode: 'sum', fmt: 'num'  },
    { goalKey: 'Projected Phone',  label: 'Phone',     actualKey: null,       mode: null,  fmt: 'num'  },
];

// ── Region / Site Mapping ───────────────────────────────────────────────────
const REGION_TO_SITE = {
    'SD-Xfinity':       'DR',
    'Belize City-XOTM': 'BZ',
    'OW-XOTM':          'BZ',
    'San Ignacio-XOTM': 'BZ',
};

// ── MBR Export Constants ────────────────────────────────────────────────────
const MBR_COLORS = {
    purple:       '6137F4',
    purpleDark:   '4a28c4',
    amber:        'FFAA00',
    green:        '008557',
    blue:         '1F69FF',
    orange:       'E54F00',
    red:          'E5004C',
    textPrimary:  '1a1a1a',
    textSecondary:'888888',
    white:        'FFFFFF',
    lightGray:    'FAFAFA',
    cardBorder:   'E2E8F0',
};

const MBR_FONT = 'Segoe UI';
const MBR_BILLING_RATE = 19.77;

const MBR_SITE_NAMES = {
    'Belize City-XOTM': 'Belize City',
    'San Ignacio-XOTM':  'San Ignacio',
    'SD-Xfinity':        'Dom. Republic',
};

function mbrSiteName(name) { return MBR_SITE_NAMES[name] || name; }

function getMbrCategory(jobType) {
    var jt = (jobType || '').trim();
    var upper = jt.toUpperCase();
    if (/^GLN/i.test(jt)) return 'Acquisition';
    if (/^GLU/i.test(jt)) return 'Multi-Product Expansion';
    if (/^GLB/i.test(jt)) return 'Up Tier & Ancillary';
    if (/\b(NONSUB|NON.?SUB|BAU|LOCALIZ|WR\s*NS)\b/i.test(upper)) return 'Acquisition';
    if (/\b(XM\s*UP|ADD.?A.?LINE|ONBOARD|LIKELY)\b/i.test(upper)) return 'Multi-Product Expansion';
    if (/\b(XMC|ATTACH|UP.?TIER|ANCILLARY)\b/i.test(upper)) return 'Up Tier & Ancillary';
    if (/^XM$/i.test(upper) || /^XM\s/i.test(upper)) return 'Multi-Product Expansion';
    return jt;
}

function mbrQuartileColor(pctToGoal) {
    if (pctToGoal >= 100) return MBR_COLORS.green;
    if (pctToGoal >= 80)  return MBR_COLORS.blue;
    if (pctToGoal > 0)    return MBR_COLORS.amber;
    return MBR_COLORS.red;
}

// ── Formatting Utilities ────────────────────────────────────────────────────
function fmt(n, dec) { return Number(n).toFixed(dec === undefined ? 1 : dec); }
function fmtPct(n) { return fmt(n, 1) + '%'; }
function fmtGoal(val, fmtType) {
    if (val === null || val === undefined || isNaN(val)) return '\u2014';
    if (fmtType === 'dec2') return Number(val).toFixed(2);
    if (fmtType === 'pct')  return Number(val).toFixed(1) + '%';
    return Math.round(val).toLocaleString();
}

// ── AI Color ────────────────────────────────────────────────────────────────
const AI_COLOR = '#0ea5e9';
