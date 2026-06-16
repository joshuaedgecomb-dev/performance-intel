/**
 * engine.js — Client-side business logic
 * Pacing, fiscal calendar, health score, threshold calculations.
 * Ported from app.jsx lines 145-192, 740-745, 1091-1101
 */

// ── Fiscal Month Info ───────────────────────────────────────────────────────
// Fiscal period runs 22nd → 21st, counting only M–F business days.
function getFiscalMonthInfo(datestrs) {
    if (!datestrs || !datestrs.length) return null;
    var sorted = datestrs.filter(Boolean).sort();
    if (!sorted.length) return null;

    var minStr = sorted[0];
    var maxStr = sorted[sorted.length - 1];

    var parseLoc = function(s) {
        var p = s.split('-').map(Number);
        return new Date(p[0], p[1] - 1, p[2]);
    };
    var minDate = parseLoc(minStr);
    var maxDate = parseLoc(maxStr);

    // Fiscal end = 21st of the month after the dataset's first date
    var fiscalEnd = new Date(minDate.getFullYear(), minDate.getMonth() + 1, 21);

    var countBD = function(a, b) {
        var n = 0;
        var cur = new Date(a);
        var end = new Date(b);
        while (cur <= end) {
            var dw = cur.getDay();
            if (dw !== 0 && dw !== 6) n++;
            cur.setDate(cur.getDate() + 1);
        }
        return n;
    };

    var elapsedBDays   = countBD(minDate, maxDate);
    var totalBDays     = countBD(minDate, fiscalEnd);
    var remainingBDays = Math.max(0, totalBDays - elapsedBDays);
    var pctElapsed     = totalBDays > 0 ? (elapsedBDays / totalBDays) * 100 : 0;
    var pad2 = function(n) { return String(n).padStart(2, '0'); };
    var fmtD = function(d) { return d.getFullYear() + '-' + pad2(d.getMonth()+1) + '-' + pad2(d.getDate()); };

    return {
        fiscalStart: minStr,
        fiscalEnd: fmtD(fiscalEnd),
        lastDataDate: maxStr,
        elapsedBDays: elapsedBDays,
        remainingBDays: remainingBDays,
        totalBDays: totalBDays,
        pctElapsed: pctElapsed
    };
}

// ── Pacing Calculation ──────────────────────────────────────────────────────
function calcPacing(actual, plan, elapsedBDays, totalBDays) {
    if (!plan || !elapsedBDays || !totalBDays) return null;
    var dailyRate     = actual / elapsedBDays;
    var projected     = Math.round(dailyRate * totalBDays);
    var projectedPct  = (projected / plan) * 100;
    var delta         = projected - plan;
    var remainingDays = totalBDays - elapsedBDays;
    var requiredDaily = remainingDays > 0 ? (plan - actual) / remainingDays : null;
    return {
        dailyRate: dailyRate,
        projected: projected,
        projectedPct: projectedPct,
        delta: Math.round(delta),
        requiredDaily: requiredDaily
    };
}

// ── Health Score ─────────────────────────────────────────────────────────────
function calculateHealthScore(attainment, q1Rate, hoursUtilization, stability) {
    var att = Math.min(attainment !== null && attainment !== undefined ? attainment : q1Rate, 150);
    return (
        att              * 0.40 +
        q1Rate           * 0.30 +
        hoursUtilization * 0.20 +
        stability        * 0.10
    );
}

// ── Hours Threshold ──────────────────────────────────────────────────────────
function computeEffectiveThreshold(baseThreshold, fiscalInfo, autoScale) {
    if (!autoScale || !fiscalInfo || !fiscalInfo.totalBDays || !fiscalInfo.elapsedBDays) return baseThreshold;
    var ratio = fiscalInfo.elapsedBDays / fiscalInfo.totalBDays;
    return Math.max(1, Math.round(baseThreshold * ratio * 10) / 10);
}

// ── Utility: build sparkline SVG ─────────────────────────────────────────────
function buildSparklineSVG(points, color, height, width) {
    color = color || '#d97706';
    height = height || 32;
    width = width || 80;
    if (!points || points.length < 2) return '';
    var min = Math.min.apply(null, points);
    var max = Math.max.apply(null, points);
    var range = max - min || 1;
    var coords = points.map(function(v, i) {
        var x = (i / (points.length - 1)) * width;
        var y = height - ((v - min) / range) * (height - 4) - 2;
        return x.toFixed(1) + ',' + y.toFixed(1);
    }).join(' ');
    return '<svg width="' + width + '" height="' + height + '" viewBox="0 0 ' + width + ' ' + height + '">' +
        '<polyline points="' + coords + '" fill="none" stroke="' + color + '" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>' +
        '</svg>';
}

// ── Utility: trend arrow from data points ────────────────────────────────────
function trendArrow(points) {
    if (!points || points.length < 2) return '';
    var last = points[points.length - 1];
    var prev = points[points.length - 2];
    if (last > prev * 1.02) return '<span style="color:#16a34a">▲</span>';
    if (last < prev * 0.98) return '<span style="color:#dc2626">▼</span>';
    return '<span style="color:var(--text-dim)">—</span>';
}
