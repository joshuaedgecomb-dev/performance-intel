/**
 * mbr.js — MBR (Monthly Business Review) PowerPoint export
 * Ported from app.jsx lines 4498-5503.
 * Uses PptxGenJS loaded dynamically from CDN.
 *
 * Depends on: constants.js (MBR_COLORS, MBR_FONT, MBR_BILLING_RATE, etc.),
 *             engine.js   (calcPacing, getFiscalMonthInfo)
 */

var MBR_W = 13.33; // Widescreen slide width in inches

// ── Helpers: Goal plan extraction from goalEntry siteMap ────────────────────
// goalEntry is { siteName: [ {col: val, ...}, ... ], ... }

function _mbrParseNum(v) {
    if (v === null || v === undefined || v === '') return 0;
    if (typeof v === 'number') return v;
    var n = parseFloat(String(v).replace(/[^0-9.\-]/g, ''));
    return isNaN(n) ? 0 : n;
}

function _mbrFindCol(row) {
    // Search remaining args as possible column names
    for (var i = 1; i < arguments.length; i++) {
        var key = arguments[i];
        if (row[key] !== undefined && row[key] !== null && row[key] !== '') return row[key];
    }
    return null;
}

function _mbrComputePlanRow(row) {
    return {
        homesGoal: Math.ceil(_mbrParseNum(_mbrFindCol(row, 'HOMES GOAL', 'Homes Goal', 'Home Goal', 'Homes'))),
        rguGoal:   Math.ceil(_mbrParseNum(_mbrFindCol(row, 'RGU GOAL', 'RGU Goal', 'RGU'))),
        hsdGoal:   Math.ceil(_mbrParseNum(_mbrFindCol(row, 'HSD GOAL', 'HSD Goal', 'HSD Sell In Goal', 'New XI Goal'))),
        xmGoal:    Math.ceil(_mbrParseNum(_mbrFindCol(row, 'XM GOAL', 'XM Goal', 'XM Sell In Goal', 'XM Lines Goal'))),
        videoGoal: Math.ceil(_mbrParseNum(_mbrFindCol(row, 'VIDEO GOAL', 'Video Goal', 'Video Sell In Goal', 'New Video Goal'))),
        xhGoal:    Math.ceil(_mbrParseNum(_mbrFindCol(row, 'XH GOAL', 'XH Goal', 'XH Sell In Goal', 'New XH Goal'))),
        hoursGoal: Math.ceil(_mbrParseNum(_mbrFindCol(row, 'Hours Goal', 'HOURS GOAL', 'Hour Goal'))),
        sphGoal:   _mbrParseNum(_mbrFindCol(row, 'SPH GOAL', 'SPH Goal', 'SPH'))
    };
}

function _mbrUniqueRows(siteMap) {
    if (!siteMap) return [];
    var rows = [];
    var keys = Object.keys(siteMap);
    for (var i = 0; i < keys.length; i++) {
        var arr = siteMap[keys[i]];
        if (Array.isArray(arr)) {
            for (var j = 0; j < arr.length; j++) rows.push(arr[j]);
        }
    }
    return rows;
}

function _mbrGetPlanForKey(goalEntry, metricKey) {
    var rows = _mbrUniqueRows(goalEntry);
    var total = 0;
    for (var i = 0; i < rows.length; i++) {
        var p = _mbrComputePlanRow(rows[i]);
        if      (metricKey === 'HOMES GOAL')       total += p.homesGoal;
        else if (metricKey === 'RGU GOAL')          total += p.rguGoal;
        else if (metricKey === 'HSD Sell In Goal')  total += p.hsdGoal;
        else if (metricKey === 'XM GOAL')           total += p.xmGoal;
        else if (metricKey === 'VIDEO GOAL')        total += p.videoGoal;
        else if (metricKey === 'XH GOAL')           total += p.xhGoal;
        else if (metricKey === 'Hours Goal')        total += p.hoursGoal;
        else if (metricKey === 'SPH GOAL')          { /* avg, not sum — handle separately */ }
        else total += _mbrParseNum(rows[i][metricKey] || 0);
    }
    return total > 0 ? total : null;
}

function _mbrGetSphGoal(goalEntry) {
    var rows = _mbrUniqueRows(goalEntry);
    var vals = [];
    for (var i = 0; i < rows.length; i++) {
        var v = _mbrComputePlanRow(rows[i]).sphGoal;
        if (v > 0) vals.push(v);
    }
    if (!vals.length) return null;
    var sum = 0;
    for (var j = 0; j < vals.length; j++) sum += vals[j];
    return sum / vals.length;
}

function _mbrFormatFiscalFilename(fiscalEnd) {
    if (!fiscalEnd) return 'GCS_MBR_000000.pptx';
    var parts = fiscalEnd.split('-');
    return 'GCS_MBR_' + parts[1] + parts[2] + parts[0].slice(2) + '.pptx';
}

function _mbrGetMinHours() {
    var cfg = (window.PERF && window.PERF.config) || {};
    return cfg.hoursThreshold || 16;
}

// ── Ensure PptxGenJS is loaded ─────────────────────────────────────────────

function ensurePptxGen(callback) {
    if (typeof PptxGenJS !== 'undefined') return callback();
    var script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/pptxgenjs@4.0.1/dist/pptxgenjs.bundle.js';
    script.onload = callback;
    script.onerror = function() {
        if (typeof gcs !== 'undefined') gcs.toast({ message: 'Failed to load PptxGenJS library', type: 'danger' });
    };
    document.head.appendChild(script);
}

// ── Title Slide ────────────────────────────────────────────────────────────

function buildMbrTitleSlide(pres, fiscalInfo) {
    var slide = pres.addSlide();
    slide.bkgd = MBR_COLORS.purple;

    // Decorative circles
    slide.addShape(pres.shapes.OVAL, {
        x: 9.5, y: -1.5, w: 5, h: 5, fill: { color: '5228D4' }
    });
    slide.addShape(pres.shapes.OVAL, {
        x: -2, y: 4.5, w: 5, h: 5, fill: { color: '5228D4' }
    });

    slide.addText('MONTHLY BUSINESS REVIEW', {
        x: 0.8, y: 2.0, w: 11.5, h: 1.2,
        fontSize: 42, fontFace: MBR_FONT, color: MBR_COLORS.white, bold: true
    });
    slide.addText('GLOBAL CALLCENTER SOLUTIONS (GCS)', {
        x: 0.8, y: 3.2, w: 11.5, h: 0.7,
        fontSize: 20, fontFace: MBR_FONT, color: MBR_COLORS.amber
    });

    var fiscalEnd = (fiscalInfo && fiscalInfo.fiscalEnd) || '';
    var dateLabel = '';
    if (fiscalEnd) {
        var parts = fiscalEnd.split('-');
        var months = ['','January','February','March','April','May','June',
                      'July','August','September','October','November','December'];
        dateLabel = (months[parseInt(parts[1], 10)] || '') + ' ' + parts[0];
    }
    slide.addText(dateLabel, {
        x: 0.8, y: 3.9, w: 11.5, h: 0.5,
        fontSize: 16, fontFace: MBR_FONT, color: MBR_COLORS.white, italic: true
    });

    // Accent line
    slide.addShape(pres.shapes.RECTANGLE, {
        x: 0, y: 5.5, w: MBR_W, h: 0.05, fill: { color: MBR_COLORS.amber }
    });
}

// ── Slide Header (reusable for content slides) ─────────────────────────────

function addMbrSlideHeader(slide, pres, title, subtitle) {
    // Purple header band
    slide.addShape(pres.shapes.RECTANGLE, {
        x: 0, y: 0, w: MBR_W, h: 1.15, fill: { color: MBR_COLORS.purple }
    });
    slide.addShape(pres.shapes.RECTANGLE, {
        x: 0, y: 0.7, w: MBR_W, h: 0.45, fill: { color: '5228D4' }
    });
    // Amber accent line
    slide.addShape(pres.shapes.RECTANGLE, {
        x: 0, y: 1.15, w: MBR_W, h: 0.05, fill: { color: MBR_COLORS.amber }
    });
    // Company name
    slide.addText('GLOBAL CALLCENTER SOLUTIONS', {
        x: 0.5, y: 0.15, w: 6, h: 0.3,
        fontSize: 9, fontFace: MBR_FONT, color: 'C0C0E0'
    });
    // Title
    slide.addText(title, {
        x: 0.5, y: 0.4, w: 10, h: 0.45,
        fontSize: 22, fontFace: MBR_FONT, color: MBR_COLORS.white, bold: true
    });
    // Subtitle
    if (subtitle) {
        slide.addText(subtitle, {
            x: 0.5, y: 0.8, w: 10, h: 0.3,
            fontSize: 12, fontFace: MBR_FONT, color: MBR_COLORS.amber
        });
    }
    // Footer
    slide.addShape(pres.shapes.RECTANGLE, {
        x: 0, y: 7.2, w: MBR_W, h: 0.3, fill: { color: 'F5F5FA' }
    });
    slide.addShape(pres.shapes.RECTANGLE, {
        x: 0, y: 7.2, w: MBR_W, h: 0.01, fill: { color: MBR_COLORS.cardBorder }
    });
    slide.addText('GCS  |  Performance Intel', {
        x: 0.5, y: 7.22, w: 4, h: 0.2,
        fontSize: 7, fontFace: MBR_FONT, color: MBR_COLORS.textSecondary, italic: true
    });
}

// ── Summary Slide ──────────────────────────────────────────────────────────

function buildMbrSummarySlide(pres, perf) {
    var slide = pres.addSlide();
    slide.bkgd = MBR_COLORS.white;
    var fi = perf.fiscalInfo || {};
    var fiscalEnd = fi.fiscalEnd || '';
    var periodLabel = '';
    if (fiscalEnd) {
        var parts = fiscalEnd.split('-');
        var months = ['','JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
        periodLabel = (months[parseInt(parts[1], 10)] || '') + ' ' + parts[0] + ' MTD';
    }
    addMbrSlideHeader(slide, pres, 'SUMMARY \u2013 ' + periodLabel, 'Sales Performance');

    // ── KPI Cards ──
    var kpis = [
        { label: 'HOURS',   actual: perf.totalHours,      plan: perf.globalPlanHours,   color: MBR_COLORS.blue },
        { label: 'SALES',   actual: perf.globalGoals,      plan: perf.planTotal,          color: MBR_COLORS.blue },
        { label: 'XI RGUs', actual: perf.globalNewXI,      plan: perf.globalPlanNewXI,    color: MBR_COLORS.green },
        { label: 'XM RGUs', actual: perf.globalXmLines,    plan: perf.globalPlanXmLines,  color: MBR_COLORS.blue },
        { label: 'RGUs',    actual: perf.globalRgu,         plan: perf.globalPlanRgu,      color: MBR_COLORS.orange }
    ];
    var cardW = 1.75, cardH = 1.15, gapX = 0.12, startX = 0.5, startY = 1.4;
    for (var i = 0; i < kpis.length; i++) {
        var kpi = kpis[i];
        var x = startX + i * (cardW + gapX);
        var hasPlan = kpi.plan != null && kpi.plan > 0;
        var pctGoal = hasPlan ? (kpi.actual / kpi.plan) * 100 : null;
        var pacing = hasPlan && fi.elapsedBDays ? calcPacing(kpi.actual, kpi.plan, fi.elapsedBDays, fi.totalBDays) : null;

        // Card shadow
        slide.addShape(pres.shapes.ROUNDED_RECTANGLE, {
            x: x + 0.02, y: startY + 0.03, w: cardW, h: cardH,
            fill: { color: 'E0E0E0' }, rectRadius: 0.05
        });
        // Card face
        slide.addShape(pres.shapes.ROUNDED_RECTANGLE, {
            x: x, y: startY, w: cardW, h: cardH,
            fill: { color: 'FFF8E1' }, rectRadius: 0.05,
            line: { color: MBR_COLORS.cardBorder, width: 0.5 }
        });
        // Left accent
        slide.addShape(pres.shapes.RECTANGLE, {
            x: x, y: startY + 0.08, w: 0.05, h: cardH - 0.16,
            fill: { color: kpi.color }
        });
        // Label
        slide.addText(kpi.label, {
            x: x, y: startY + 0.05, w: cardW, h: 0.28,
            fontSize: 13, fontFace: MBR_FONT, color: kpi.color, bold: true, align: 'center'
        });
        // % to Goal
        if (hasPlan) {
            slide.addText(Math.round(pctGoal) + '% to Goal', {
                x: x, y: startY + 0.33, w: cardW, h: 0.32,
                fontSize: 11, fontFace: MBR_FONT, color: MBR_COLORS.textPrimary, align: 'center'
            });
        }
        // Pacing
        if (pacing) {
            slide.addText(Math.round(pacing.projectedPct) + '% Pacing', {
                x: x, y: startY + 0.68, w: cardW, h: 0.32,
                fontSize: 11, fontFace: MBR_FONT, color: MBR_COLORS.textPrimary, bold: true, align: 'center'
            });
        }
    }

    // ── Headcount block ──
    var hcX = 10.0;
    slide.addText('HEADCOUNT', {
        x: hcX, y: startY, w: 3, h: 0.28,
        fontSize: 14, fontFace: MBR_FONT, color: MBR_COLORS.orange, bold: true, align: 'center'
    });
    slide.addText(String(perf.uniqueAgentCount || perf.totalAgents || 0), {
        x: hcX, y: startY + 0.28, w: 3, h: 0.35,
        fontSize: 22, fontFace: MBR_FONT, color: MBR_COLORS.textPrimary, bold: true, align: 'center'
    });

    // Site distribution pie chart
    var regions = perf.regions || [];
    if (regions.length > 0) {
        var pieColors = ['008557','1F69FF','6137F4','FFAA00','E54F00','E5004C'];
        var chartData = [{
            name: 'Sites',
            labels: regions.map(function(r) { return mbrSiteName(r.name) + ', ' + (r.uniqueAgents || r.count); }),
            values: regions.map(function(r) { return r.uniqueAgents || r.count; })
        }];
        slide.addChart(pres.charts.PIE, chartData, {
            x: hcX + 0.15, y: startY + 0.7, w: 2.6, h: 1.53,
            showTitle: false, showValue: false, showPercent: true,
            showLegend: false, showLabel: true,
            dataLabelPosition: 'bestFit', dataLabelFontSize: 8,
            dataLabelColor: MBR_COLORS.textPrimary,
            chartColors: pieColors.slice(0, regions.length)
        });
    }

    // ── Per-category aggregate tables ──
    var programs = perf.programs || [];
    var categories = {};
    for (var pi = 0; pi < programs.length; pi++) {
        var cat = getMbrCategory(programs[pi].jobType);
        if (!categories[cat]) categories[cat] = [];
        categories[cat].push(programs[pi]);
    }
    var catList = [];
    var catKeys = Object.keys(categories);
    for (var ci = 0; ci < catKeys.length; ci++) {
        catList.push([catKeys[ci], categories[catKeys[ci]]]);
    }

    var catColors = {
        'Acquisition': MBR_COLORS.green,
        'Multi-Product Expansion': MBR_COLORS.blue,
        'Up Tier & Ancillary': MBR_COLORS.amber,
        'Other': MBR_COLORS.purple
    };
    var tableW = catList.length > 0 ? Math.min(4.0, (MBR_W - 0.8) / catList.length - 0.15) : 4.0;

    // Divider
    slide.addShape(pres.shapes.RECTANGLE, {
        x: 0.3, y: 3.55, w: MBR_W - 0.6, h: 0.015,
        fill: { color: MBR_COLORS.cardBorder }
    });

    var tableStartY = 3.8;
    var rowH = 0.2;
    var colW5 = [tableW * 0.24, tableW * 0.19, tableW * 0.19, tableW * 0.19, tableW * 0.19];

    // Build category data
    var catData = [];
    for (var cdi = 0; cdi < catList.length; cdi++) {
        var catName = catList[cdi][0];
        var progs = catList[cdi][1];
        var catColor = catColors[catName] || MBR_COLORS.purple;
        var totHours = 0, totSales = 0, totRgu = 0, totXI = 0, totXM = 0;
        var planHours = 0, planSales = 0, planRgu = 0, planXI = 0, planXM = 0;
        for (var p = 0; p < progs.length; p++) {
            var prog = progs[p];
            totHours += prog.totalHours || 0;
            totSales += prog.actGoals || prog.totalGoals || 0;
            totRgu   += prog.totalRgu || 0;
            totXI    += prog.totalNewXI || 0;
            totXM    += prog.totalXmLines || 0;
            var ge = prog.goalEntry;
            if (ge) {
                planHours += _mbrGetPlanForKey(ge, 'Hours Goal') || 0;
                planSales += prog.planGoals || 0;
                planRgu   += _mbrGetPlanForKey(ge, 'RGU GOAL') || 0;
                planXI    += _mbrGetPlanForKey(ge, 'HSD Sell In Goal') || 0;
                planXM    += _mbrGetPlanForKey(ge, 'XM GOAL') || 0;
            } else {
                planSales += prog.planGoals || 0;
            }
        }
        var volRows = [];
        var addCatRow = function(label, actual, plan, isDollar) {
            if (!plan && !actual) return;
            var pfx = isDollar ? '$  ' : '';
            var variance = plan ? actual - plan : 0;
            var pctG = plan ? Math.round((actual / plan) * 100) + '%' : '\u2014';
            var fmtV = isDollar
                ? function(v) { return pfx + Math.round(v).toLocaleString(); }
                : function(v) { return Math.round(v).toLocaleString(); };
            volRows.push([label, plan ? fmtV(plan) : '\u2014', fmtV(actual),
                plan ? ((variance >= 0 ? pfx : (isDollar ? '$ (' : '(')) + Math.abs(Math.round(variance)).toLocaleString() + (variance < 0 ? ')' : '')) : '\u2014',
                pctG]);
        };
        var catBudgetPlan = planHours ? planHours * MBR_BILLING_RATE : null;
        addCatRow('BUDGET', totHours * MBR_BILLING_RATE, catBudgetPlan, true);
        addCatRow('HOURS', totHours, planHours || null);
        addCatRow('HOMES SOLD', totSales, planSales || null);
        addCatRow('TOTAL RGUs', totRgu, planRgu || null);
        addCatRow('XI RGUs', totXI, planXI || null);
        addCatRow('XM RGUs', totXM, planXM || null);

        var costRows = [];
        if (totSales > 0) {
            var cpsPlan = planSales && planHours ? (planHours * MBR_BILLING_RATE) / planSales : null;
            var cpsAct = (totHours * MBR_BILLING_RATE) / totSales;
            costRows.push(['CPS',
                cpsPlan ? '$  ' + cpsPlan.toFixed(2) : '\u2014',
                '$  ' + cpsAct.toFixed(2),
                cpsPlan ? ((cpsAct - cpsPlan >= 0 ? '$  ' : '$ (') + Math.abs(cpsAct - cpsPlan).toFixed(2) + (cpsAct - cpsPlan < 0 ? ')' : '')) : '',
                cpsPlan ? Math.round((cpsAct / cpsPlan) * 100) + '%' : '']);
        }
        if (totHours > 0 && totSales > 0) {
            costRows.push(['SPH', '\u2014', (totSales / totHours).toFixed(2), '', '']);
        }
        catData.push({ cat: catName, catColor: catColor, volRows: volRows, costRows: costRows });
    }

    // Max volume rows for alignment
    var maxVolRows = 0;
    for (var mi = 0; mi < catData.length; mi++) {
        if (catData[mi].volRows.length > maxVolRows) maxVolRows = catData[mi].volRows.length;
    }
    var volTableEndY = tableStartY + 0.32 + rowH * (maxVolRows + 1) + 0.1;

    // Render category tables
    for (var ti = 0; ti < catData.length; ti++) {
        var d = catData[ti];
        var tx = 0.5 + ti * (tableW + 0.15);
        var catHdrStyle = { fontSize: 8, fontFace: MBR_FONT, color: MBR_COLORS.white, fill: { color: d.catColor }, bold: true };
        var catCellStyle = { fontSize: 8, fontFace: MBR_FONT, color: MBR_COLORS.textPrimary, fill: { color: MBR_COLORS.white } };

        var mkHdr = function() {
            return ['', 'Budget', 'Actual', 'Variance', '% Goal'].map(function(t, idx) {
                return { text: t, options: { fontSize: 8, fontFace: MBR_FONT, color: MBR_COLORS.white, fill: { color: d.catColor }, bold: true, align: idx === 0 ? 'left' : 'right' } };
            });
        };
        var mkRows = function(src) {
            return src.map(function(r) {
                return r.map(function(c, idx) {
                    return { text: c, options: { fontSize: 8, fontFace: MBR_FONT, color: MBR_COLORS.textPrimary, fill: { color: MBR_COLORS.white }, bold: idx === 0, align: idx === 0 ? 'left' : 'right' } };
                });
            });
        };

        // Category header bar
        slide.addShape(pres.shapes.ROUNDED_RECTANGLE, {
            x: tx, y: tableStartY, w: tableW, h: 0.32,
            fill: { color: d.catColor }, rectRadius: 0.04
        });
        slide.addText(d.cat.toUpperCase(), {
            x: tx, y: tableStartY, w: tableW, h: 0.32,
            fontSize: 10, fontFace: MBR_FONT, color: MBR_COLORS.white, bold: true, align: 'center', valign: 'middle'
        });

        // Volume table
        var vRows = mkRows(d.volRows);
        if (vRows.length > 0) {
            slide.addTable([mkHdr()].concat(vRows), {
                x: tx, y: tableStartY + 0.32, w: tableW, fontSize: 8,
                border: { pt: 0.3, color: MBR_COLORS.cardBorder },
                colW: colW5, rowH: rowH, margin: [1, 3, 1, 3]
            });
        }

        // Cost table
        var cRows = mkRows(d.costRows);
        if (cRows.length > 0) {
            slide.addTable([mkHdr()].concat(cRows), {
                x: tx, y: volTableEndY, w: tableW, fontSize: 8,
                border: { pt: 0.3, color: MBR_COLORS.cardBorder },
                colW: colW5, rowH: rowH, margin: [1, 3, 1, 3]
            });
        }
    }

    // Data source footer
    var lastDate = fi.lastDataDate || '';
    slide.addText('Data Source: BI data through ' + lastDate, {
        x: 0.5, y: 7.05, w: 8, h: 0.2,
        fontSize: 7, fontFace: MBR_FONT, color: MBR_COLORS.textSecondary, italic: true
    });
}

// ── Program Slide ──────────────────────────────────────────────────────────

function buildMbrProgramSlide(pres, program, fiscalInfo, narrativeText, oppsText) {
    var slide = pres.addSlide();
    slide.bkgd = MBR_COLORS.white;
    var category = getMbrCategory(program.jobType);
    var fiscalEnd = (fiscalInfo && fiscalInfo.fiscalEnd) || '';
    var periodLabel = '';
    if (fiscalEnd) {
        var parts = fiscalEnd.split('-');
        var months = ['','JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
        periodLabel = (months[parseInt(parts[1], 10)] || '') + ' ' + parts[0] + ' MTD';
    }
    addMbrSlideHeader(slide, pres, program.jobType, category + '  |  ' + periodLabel);
    var fi = fiscalInfo || {};

    // Category badge (top right)
    var catColors = { 'Acquisition': MBR_COLORS.green, 'Multi-Product Expansion': MBR_COLORS.blue, 'Up Tier & Ancillary': MBR_COLORS.amber };
    var badgeColor = catColors[category] || MBR_COLORS.purple;
    slide.addShape(pres.shapes.ROUNDED_RECTANGLE, {
        x: 10.82, y: 0.28, w: 2.1, h: 0.45, fill: { color: 'CCCCCC' }, rectRadius: 0.08
    });
    slide.addShape(pres.shapes.ROUNDED_RECTANGLE, {
        x: 10.8, y: 0.25, w: 2.1, h: 0.45, fill: { color: badgeColor }, rectRadius: 0.08
    });
    slide.addText(category, {
        x: 10.8, y: 0.25, w: 2.1, h: 0.45,
        fontSize: 9, fontFace: MBR_FONT, color: MBR_COLORS.white, bold: true, align: 'center', valign: 'middle'
    });

    // Truncate helper
    var truncate = function(text, max) {
        if (!text) return null;
        if (text.length <= max) return text;
        var cut = text.slice(0, max);
        var last = cut.lastIndexOf('.');
        return last > max * 0.5 ? cut.slice(0, last + 1) : cut + '...';
    };
    var narrative = truncate(narrativeText, 300) || 'Add project insights here';
    var opps = truncate(oppsText, 400) || 'Add team insights here';

    var tOpts = { fontSize: 8, fontFace: MBR_FONT };
    var hdrOpts = { fontSize: 8, fontFace: MBR_FONT, color: MBR_COLORS.white, fill: { color: MBR_COLORS.purple }, bold: true };
    var cellOpts = { fontSize: 8, fontFace: MBR_FONT, color: MBR_COLORS.textPrimary, fill: { color: MBR_COLORS.white } };

    // ══ LEFT COLUMN: PROJECT ══
    var lx = 0.5;
    var cy = 1.35;
    slide.addText('PROJECT', {
        x: lx, y: cy, w: 6.8, h: 0.28,
        fontSize: 12, fontFace: MBR_FONT, color: MBR_COLORS.textPrimary, bold: true, align: 'center'
    });
    cy += 0.32;

    // Volume metrics table
    var volRows = [];
    var ge = program.goalEntry;
    var actHrs = program.totalHours || 0;
    var planHrs = ge ? _mbrGetPlanForKey(ge, 'Hours Goal') : null;

    var addVolRow = function(label, actual, plan) {
        if (plan == null || plan <= 0) return;
        var variance = actual - plan;
        var pctG = (actual / plan) * 100;
        var pac = fi.elapsedBDays ? calcPacing(actual, plan, fi.elapsedBDays, fi.totalBDays) : null;
        volRows.push([label, Math.round(plan).toLocaleString(), Math.round(actual).toLocaleString(),
            (variance >= 0 ? '' : '(') + Math.abs(Math.round(variance)).toLocaleString() + (variance < 0 ? ')' : ''),
            Math.round(pctG) + '%', pac ? Math.round(pac.projectedPct) + '%' : '\u2014']);
    };

    // Budget row
    var budgetPlan = planHrs ? planHrs * MBR_BILLING_RATE : null;
    if (budgetPlan) {
        var budgetActual = actHrs * MBR_BILLING_RATE;
        var bVar = budgetActual - budgetPlan;
        var bPac = fi.elapsedBDays ? calcPacing(budgetActual, budgetPlan, fi.elapsedBDays, fi.totalBDays) : null;
        volRows.push(['BUDGET',
            '$  ' + Math.round(budgetPlan).toLocaleString(),
            '$  ' + Math.round(budgetActual).toLocaleString(),
            (bVar >= 0 ? '$  ' : '$ (') + Math.abs(Math.round(bVar)).toLocaleString() + (bVar < 0 ? ')' : ''),
            Math.round((budgetActual / budgetPlan) * 100) + '%',
            bPac ? Math.round(bPac.projectedPct) + '%' : '\u2014']);
    }
    addVolRow('HOURS', actHrs, planHrs);
    addVolRow('SALES', program.actGoals || program.totalGoals || 0, program.planGoals);
    addVolRow('RGUs', program.totalRgu || 0, ge ? _mbrGetPlanForKey(ge, 'RGU GOAL') : null);
    addVolRow('HSD RGUs', program.totalNewXI || 0, ge ? _mbrGetPlanForKey(ge, 'HSD Sell In Goal') : null);
    addVolRow('XM RGUs', program.totalXmLines || 0, ge ? _mbrGetPlanForKey(ge, 'XM GOAL') : null);

    // Cost/efficiency metrics
    var costRows = [];
    var actGoals = program.actGoals || program.totalGoals || 0;
    if (actGoals > 0) {
        var cpsPlan = program.planGoals && planHrs ? (planHrs * MBR_BILLING_RATE) / program.planGoals : null;
        var cpsActual = (actHrs * MBR_BILLING_RATE) / actGoals;
        costRows.push(['CPS',
            cpsPlan ? '$  ' + cpsPlan.toFixed(2) : '\u2014',
            '$  ' + cpsActual.toFixed(2),
            cpsPlan ? ((cpsActual - cpsPlan >= 0 ? '$  ' : '$ (') + Math.abs(cpsActual - cpsPlan).toFixed(2) + (cpsActual - cpsPlan < 0 ? ')' : '')) : '',
            cpsPlan ? Math.round((cpsActual / cpsPlan) * 100) + '%' : '']);
    }
    var sphPlanVal = ge ? _mbrGetSphGoal(ge) : null;
    if (sphPlanVal && actHrs > 0) {
        var sphAct = actGoals / actHrs;
        costRows.push(['SPH', sphPlanVal.toFixed(2), sphAct.toFixed(2),
            ((sphAct - sphPlanVal >= 0 ? '' : '(') + Math.abs(sphAct - sphPlanVal).toFixed(2) + (sphAct - sphPlanVal < 0 ? ')' : '')),
            Math.round((sphAct / sphPlanVal) * 100) + '%']);
    } else if (actHrs > 0 && actGoals > 0) {
        costRows.push(['SPH', '\u2014', (actGoals / actHrs).toFixed(2), '', '']);
    }

    // Render volume table
    var volHdr = ['', 'Budget', 'Actual', 'Variance', '% Goal', '% Pacing'].map(function(t, idx) {
        return { text: t, options: { fontSize: 8, fontFace: MBR_FONT, color: MBR_COLORS.white, fill: { color: MBR_COLORS.purple }, bold: true, align: idx === 0 ? 'left' : 'right' } };
    });
    var volDataRows = volRows.map(function(r, ri) {
        return r.map(function(c, idx) {
            return { text: c, options: { fontSize: 8, fontFace: MBR_FONT, color: MBR_COLORS.textPrimary, fill: { color: ri % 2 === 1 ? 'F5F5FA' : MBR_COLORS.white }, bold: idx === 0, align: idx === 0 ? 'left' : 'right' } };
        });
    });
    if (volDataRows.length > 0) {
        slide.addTable([volHdr].concat(volDataRows), {
            x: lx, y: cy, w: 6.8, fontSize: 8,
            border: { pt: 0.5, color: MBR_COLORS.cardBorder },
            colW: [1.0, 1.1, 1.1, 1.1, 0.8, 0.8],
            rowH: 0.2, margin: [2, 4, 2, 4]
        });
        cy += 0.2 * (volDataRows.length + 1) + 0.12;
    }

    // Render cost table
    var costHdr = ['', 'Budget', 'Actual', 'Variance', '% Goal'].map(function(t, idx) {
        return { text: t, options: { fontSize: 8, fontFace: MBR_FONT, color: MBR_COLORS.white, fill: { color: MBR_COLORS.purple }, bold: true, align: idx === 0 ? 'left' : 'right' } };
    });
    var costDataRows = costRows.map(function(r, ri) {
        return r.map(function(c, idx) {
            return { text: c, options: { fontSize: 8, fontFace: MBR_FONT, color: MBR_COLORS.textPrimary, fill: { color: ri % 2 === 1 ? 'F5F5FA' : MBR_COLORS.white }, bold: idx === 0, align: idx === 0 ? 'left' : 'right' } };
        });
    });
    if (costDataRows.length > 0) {
        slide.addTable([costHdr].concat(costDataRows), {
            x: lx, y: cy, w: 5.5, fontSize: 8,
            border: { pt: 0.5, color: MBR_COLORS.cardBorder },
            colW: [0.9, 1.1, 1.1, 1.1, 0.8],
            rowH: 0.2, margin: [2, 4, 2, 4]
        });
        cy += 0.2 * (costDataRows.length + 1) + 0.12;
    }

    // Project KPI Insights
    slide.addText('Project KPI Insights', {
        x: lx, y: cy, w: 6.8, h: 0.25,
        fontSize: 10, fontFace: MBR_FONT, color: MBR_COLORS.textPrimary, bold: true
    });
    cy += 0.25;
    slide.addText(narrative, {
        x: lx, y: cy, w: 6.8, h: 0.75,
        fontSize: 8, fontFace: MBR_FONT, color: MBR_COLORS.textPrimary, valign: 'top', wrap: true
    });

    // ══ RIGHT COLUMN: TEAM ══
    // Background wash
    slide.addShape(pres.shapes.RECTANGLE, {
        x: 7.4, y: 1.25, w: 5.93, h: 5.75, fill: { color: 'F8F9FC' }
    });
    // Vertical divider
    slide.addShape(pres.shapes.RECTANGLE, {
        x: 7.4, y: 1.35, w: 0.015, h: 5.5, fill: { color: MBR_COLORS.purple }
    });

    var rx = 7.6;
    var ry = 1.35;
    slide.addText('TEAM', {
        x: rx, y: ry, w: 5.3, h: 0.28,
        fontSize: 12, fontFace: MBR_FONT, color: MBR_COLORS.textPrimary, bold: true, align: 'center'
    });
    ry += 0.32;

    // Per-site quartile tables
    var progRegions = program.regions || [];
    var qGroups = [
        { key: 'Q1', label: '1st', agents: program.q1Agents || [], color: MBR_COLORS.green, bgTint: 'E8F5E9' },
        { key: 'Q2', label: '2nd', agents: program.q2Agents || [], color: MBR_COLORS.blue,  bgTint: 'E3F2FD' },
        { key: 'Q3', label: '3rd', agents: program.q3Agents || [], color: MBR_COLORS.amber, bgTint: 'FFF8E1' },
        { key: 'Q4', label: '4th', agents: program.q4Agents || [], color: MBR_COLORS.red,   bgTint: 'FFEBEE' }
    ];

    var nhSet = {};
    var nhi = program.newHiresInProgram || [];
    for (var n = 0; n < nhi.length; n++) { nhSet[nhi[n].agentName] = true; }

    var thOpts = { fontSize: 7, fontFace: MBR_FONT, color: MBR_COLORS.white, fill: { color: MBR_COLORS.purple }, bold: true };
    var teamHdr = [
        { text: 'Quartile', options: thOpts },
        { text: 'Agents',   options: { fontSize: 7, fontFace: MBR_FONT, color: MBR_COLORS.white, fill: { color: MBR_COLORS.purple }, bold: true, align: 'center' } },
        { text: '<60',      options: { fontSize: 7, fontFace: MBR_FONT, color: MBR_COLORS.white, fill: { color: MBR_COLORS.purple }, bold: true, align: 'center' } },
        { text: 'Hours',    options: { fontSize: 7, fontFace: MBR_FONT, color: MBR_COLORS.white, fill: { color: MBR_COLORS.purple }, bold: true, align: 'right' } },
        { text: 'Sales',    options: { fontSize: 7, fontFace: MBR_FONT, color: MBR_COLORS.white, fill: { color: MBR_COLORS.purple }, bold: true, align: 'right' } },
        { text: 'XI RGU',   options: { fontSize: 7, fontFace: MBR_FONT, color: MBR_COLORS.white, fill: { color: MBR_COLORS.purple }, bold: true, align: 'right' } },
        { text: 'XM RGU',   options: { fontSize: 7, fontFace: MBR_FONT, color: MBR_COLORS.white, fill: { color: MBR_COLORS.purple }, bold: true, align: 'right' } },
        { text: 'SPH',      options: { fontSize: 7, fontFace: MBR_FONT, color: MBR_COLORS.white, fill: { color: MBR_COLORS.purple }, bold: true, align: 'right' } }
    ];

    for (var ri2 = 0; ri2 < progRegions.length; ri2++) {
        var region = progRegions[ri2];
        if ((region.totalHours || 0) < 10) continue;

        slide.addText(mbrSiteName(region.name), {
            x: rx, y: ry, w: 5.3, h: 0.2,
            fontSize: 8, fontFace: MBR_FONT, color: MBR_COLORS.purple, bold: true
        });
        ry += 0.2;

        var siteRows = [];
        for (var qi = 0; qi < qGroups.length; qi++) {
            var qg = qGroups[qi];
            var siteAgents = qg.agents.filter(function(a) { return a.region === region.name; });
            var count = siteAgents.length;
            var nhCount = siteAgents.filter(function(a) { return nhSet[a.agentName]; }).length;
            var hours = siteAgents.reduce(function(s, a) { return s + a.hours; }, 0);
            var sales = siteAgents.reduce(function(s, a) { return s + a.goals; }, 0);
            var xiRgu = siteAgents.reduce(function(s, a) { return s + (a.newXI || 0); }, 0);
            var xmRgu = siteAgents.reduce(function(s, a) { return s + (a.xmLines || 0); }, 0);
            var sph = hours > 0 ? (sales / hours).toFixed(2) : '0.00';
            var rowFill = { color: qg.bgTint };
            var rc = { fontSize: 7, fontFace: MBR_FONT, color: MBR_COLORS.textPrimary, fill: rowFill };
            siteRows.push([
                { text: qg.label, options: { fontSize: 7, fontFace: MBR_FONT, color: qg.color, fill: rowFill, bold: true } },
                { text: String(count), options: { fontSize: 7, fontFace: MBR_FONT, color: MBR_COLORS.textPrimary, fill: rowFill, align: 'center' } },
                { text: String(nhCount), options: { fontSize: 7, fontFace: MBR_FONT, color: MBR_COLORS.textPrimary, fill: rowFill, align: 'center' } },
                { text: hours ? hours.toFixed(1) : '0', options: { fontSize: 7, fontFace: MBR_FONT, color: MBR_COLORS.textPrimary, fill: rowFill, align: 'right' } },
                { text: String(sales), options: { fontSize: 7, fontFace: MBR_FONT, color: MBR_COLORS.textPrimary, fill: rowFill, align: 'right' } },
                { text: String(xiRgu), options: { fontSize: 7, fontFace: MBR_FONT, color: MBR_COLORS.textPrimary, fill: rowFill, align: 'right' } },
                { text: String(xmRgu), options: { fontSize: 7, fontFace: MBR_FONT, color: MBR_COLORS.textPrimary, fill: rowFill, align: 'right' } },
                { text: sph, options: { fontSize: 7, fontFace: MBR_FONT, color: MBR_COLORS.textPrimary, fill: rowFill, align: 'right' } }
            ]);
        }

        slide.addTable([teamHdr].concat(siteRows), {
            x: rx, y: ry, w: 5.3, fontSize: 7,
            border: { pt: 0.3, color: MBR_COLORS.cardBorder },
            colW: [0.6, 0.5, 0.4, 0.75, 0.65, 0.6, 0.6, 0.5],
            rowH: 0.18, margin: [1, 3, 1, 3]
        });
        ry += 0.18 * 5 + 0.1;
    }

    // Tier legend
    slide.addText(
        'T1: 100%+ to goal | T2: 80%-99.9% to goal | T3: 1%-79.9% to goal | T4: 0% | Hours > ' + _mbrGetMinHours(),
        { x: rx, y: ry, w: 5.3, h: 0.2, fontSize: 6, fontFace: MBR_FONT, color: MBR_COLORS.textSecondary }
    );
    ry += 0.25;

    // Team Insights
    slide.addText('Team Insights', {
        x: rx, y: ry, w: 5.3, h: 0.25,
        fontSize: 10, fontFace: MBR_FONT, color: MBR_COLORS.textPrimary, bold: true
    });
    ry += 0.25;
    slide.addText(opps, {
        x: rx, y: ry, w: 5.3, h: 1.2,
        fontSize: 8, fontFace: MBR_FONT, color: MBR_COLORS.textPrimary, valign: 'top', wrap: true
    });

    // Data source
    slide.addText('Data Source: BI data through ' + (fi.lastDataDate || ''), {
        x: 0.5, y: 7.05, w: 8, h: 0.2,
        fontSize: 7, fontFace: MBR_FONT, color: MBR_COLORS.textSecondary, italic: true
    });
}

// ── Site Ranking Slide ─────────────────────────────────────────────────────

function buildMbrSiteRankingSlide(pres, perf) {
    var slide = pres.addSlide();
    slide.bkgd = MBR_COLORS.white;
    addMbrSlideHeader(slide, pres, 'SITE PERFORMANCE RANKING', 'Sales Performance by Site');

    var programs = perf.programs || [];
    var fi = perf.fiscalInfo || {};

    // Collect unique sites with >= 10 hrs
    var allSitesSet = {};
    for (var pi = 0; pi < programs.length; pi++) {
        var regs = programs[pi].regions || [];
        for (var ri = 0; ri < regs.length; ri++) {
            if ((regs[ri].totalHours || 0) >= 10) allSitesSet[regs[ri].name] = true;
        }
    }
    var sites = Object.keys(allSitesSet).sort();
    if (sites.length === 0 || programs.length === 0) return;

    var metrics = ['SPH', 'Hours', 'Sales', 'XI RGU', 'XM RGU'];
    var colorPool = [MBR_COLORS.green, MBR_COLORS.blue, MBR_COLORS.purple, MBR_COLORS.amber, MBR_COLORS.orange];
    var siteColors = {};
    for (var si = 0; si < sites.length; si++) {
        siteColors[sites[si]] = colorPool[si % colorPool.length];
    }

    var fontSize = 7;
    var hdrBase = { fontSize: fontSize, fontFace: MBR_FONT, bold: true, align: 'center', valign: 'middle' };

    // Header rows
    var hdr1 = [{ text: '', options: { fontSize: fontSize, fontFace: MBR_FONT, bold: true, align: 'center', valign: 'middle', color: MBR_COLORS.white, fill: { color: MBR_COLORS.purple } } }];
    var hdr2 = [{ text: 'PROGRAM', options: { fontSize: fontSize, fontFace: MBR_FONT, bold: true, align: 'left', valign: 'middle', color: MBR_COLORS.white, fill: { color: MBR_COLORS.purple } } }];

    for (var s = 0; s < sites.length; s++) {
        var sColor = siteColors[sites[s]];
        hdr1.push({ text: mbrSiteName(sites[s]), options: { fontSize: fontSize, fontFace: MBR_FONT, bold: true, align: 'center', valign: 'middle', color: MBR_COLORS.white, fill: { color: sColor } } });
        for (var mi = 1; mi < metrics.length; mi++) {
            hdr1.push({ text: '', options: { fontSize: fontSize, fontFace: MBR_FONT, bold: true, align: 'center', valign: 'middle', color: MBR_COLORS.white, fill: { color: sColor } } });
        }
        for (var mj = 0; mj < metrics.length; mj++) {
            hdr2.push({ text: metrics[mj], options: { fontSize: fontSize, fontFace: MBR_FONT, bold: true, align: 'center', valign: 'middle', color: MBR_COLORS.white, fill: { color: sColor } } });
        }
    }
    hdr1.push({ text: '', options: { fontSize: fontSize, fontFace: MBR_FONT, bold: true, align: 'center', valign: 'middle', color: MBR_COLORS.white, fill: { color: MBR_COLORS.purple } } });
    hdr2.push({ text: 'BEST SITE', options: { fontSize: fontSize, fontFace: MBR_FONT, bold: true, align: 'center', valign: 'middle', color: MBR_COLORS.white, fill: { color: MBR_COLORS.purple } } });

    // Data rows
    var dataRows = [];
    for (var dri = 0; dri < programs.length; dri++) {
        var prog = programs[dri];
        var rowBg = dri % 2 === 1 ? 'F5F5FA' : MBR_COLORS.white;
        var cellBase = { fontSize: fontSize, fontFace: MBR_FONT, fill: { color: rowBg }, valign: 'middle' };
        var row = [{ text: prog.jobType, options: { fontSize: fontSize, fontFace: MBR_FONT, fill: { color: rowBg }, valign: 'middle', bold: true, align: 'left', color: MBR_COLORS.textPrimary } }];

        var bestSite = null, bestSph = -1;
        for (var sj = 0; sj < sites.length; sj++) {
            var regionMatch = null;
            var progRegs = prog.regions || [];
            for (var rk = 0; rk < progRegs.length; rk++) {
                if (progRegs[rk].name === sites[sj]) { regionMatch = progRegs[rk]; break; }
            }
            var hasData = regionMatch && (regionMatch.totalHours || 0) >= 10;
            var hrs = hasData ? regionMatch.totalHours : 0;
            var sls = hasData ? regionMatch.totalGoals : 0;
            // Get XI/XM from agents
            var regionAgents = hasData ? (prog.agents || []).filter(function(a) { return a.region === sites[sj]; }) : [];
            var xiR = regionAgents.reduce(function(sum, a) { return sum + (a.newXI || 0); }, 0);
            var xmR = regionAgents.reduce(function(sum, a) { return sum + (a.xmLines || 0); }, 0);
            var sphVal = hrs > 0 ? sls / hrs : 0;

            if (hasData && sphVal > bestSph) { bestSph = sphVal; bestSite = sites[sj]; }

            var vals = [
                sphVal > 0 ? sphVal.toFixed(2) : '\u2014',
                hrs > 0 ? Math.round(hrs).toLocaleString() : '\u2014',
                sls > 0 ? String(sls) : '\u2014',
                xiR > 0 ? String(xiR) : '\u2014',
                xmR > 0 ? String(xmR) : '\u2014'
            ];
            for (var vi = 0; vi < vals.length; vi++) {
                row.push({ text: vals[vi], options: { fontSize: fontSize, fontFace: MBR_FONT, fill: { color: rowBg }, valign: 'middle', align: 'right', color: MBR_COLORS.textPrimary } });
            }
        }
        row.push({
            text: bestSite ? mbrSiteName(bestSite) : '\u2014',
            options: { fontSize: fontSize, fontFace: MBR_FONT, fill: { color: rowBg }, valign: 'middle', bold: true, align: 'center', color: bestSite ? MBR_COLORS.green : MBR_COLORS.textSecondary }
        });
        dataRows.push(row);
    }

    // Highlight winning SPH cells
    for (var hri = 0; hri < dataRows.length; hri++) {
        var bestVal = -1, bestCol = -1;
        for (var hsi = 0; hsi < sites.length; hsi++) {
            var colIdx = 1 + hsi * metrics.length;
            var cellText = dataRows[hri][colIdx].text;
            var parsed = parseFloat(cellText);
            if (!isNaN(parsed) && parsed > bestVal) { bestVal = parsed; bestCol = colIdx; }
        }
        if (bestCol >= 0) {
            var opts = dataRows[hri][bestCol].options;
            dataRows[hri][bestCol].options = { fontSize: opts.fontSize, fontFace: opts.fontFace, fill: opts.fill, valign: opts.valign, align: opts.align, color: MBR_COLORS.green, bold: true };
        }
    }

    // Column widths
    var progColW = 1.6, bestColW = 1.1;
    var metricColW = sites.length > 0 ? (MBR_W - 0.8 - progColW - bestColW) / (sites.length * metrics.length) : 0.5;
    var colW = [progColW];
    for (var cwi = 0; cwi < sites.length; cwi++) {
        for (var cwj = 0; cwj < metrics.length; cwj++) colW.push(metricColW);
    }
    colW.push(bestColW);

    var tableY = 1.4;
    slide.addTable([hdr1, hdr2].concat(dataRows), {
        x: 0.4, y: tableY, w: MBR_W - 0.8, fontSize: fontSize,
        border: { pt: 0.3, color: MBR_COLORS.cardBorder },
        colW: colW, rowH: 0.28, margin: [2, 3, 2, 3]
    });

    // Legend
    var legendY = tableY + 0.28 * (dataRows.length + 2) + 0.1;
    slide.addText(
        'Ranked by SPH (Sales Per Hour)  |  Sites with < 10 hours excluded  |  Green = best performing site',
        { x: 0.5, y: legendY, w: MBR_W - 1, h: 0.18, fontSize: 7, fontFace: MBR_FONT, color: MBR_COLORS.textSecondary, italic: true }
    );

    // Data source
    slide.addText('Data Source: BI data through ' + (fi.lastDataDate || ''), {
        x: 0.5, y: 7.05, w: 8, h: 0.2,
        fontSize: 7, fontFace: MBR_FONT, color: MBR_COLORS.textSecondary, italic: true
    });
}

// ── Placeholder Slides ─────────────────────────────────────────────────────

function buildMbrPlaceholderSlides(pres, programs) {
    var cw = MBR_W - 1;

    // Member & Team Insights
    var s1 = pres.addSlide();
    s1.bkgd = MBR_COLORS.white;
    addMbrSlideHeader(s1, pres, 'MEMBER & TEAM INSIGHTS', 'Insights');
    var insightY = 1.5;
    for (var i = 0; i < (programs || []).length; i++) {
        s1.addText(programs[i].jobType, {
            x: 0.5, y: insightY, w: cw, h: 0.35,
            fontSize: 13, fontFace: MBR_FONT, color: MBR_COLORS.purple, bold: true
        });
        s1.addText('Add member insights here', {
            x: 0.5, y: insightY + 0.35, w: cw, h: 0.6,
            fontSize: 10, fontFace: MBR_FONT, color: MBR_COLORS.textSecondary, italic: true
        });
        insightY += 1.05;
    }

    // Operations
    var s2 = pres.addSlide();
    s2.bkgd = MBR_COLORS.white;
    addMbrSlideHeader(s2, pres, 'OPERATIONS', 'Looking Ahead');
    var opsSections = ['Attrition', 'tNPS', 'My Performance Stats'];
    for (var j = 0; j < opsSections.length; j++) {
        var oy = 1.5 + j * 1.6;
        s2.addText(opsSections[j], {
            x: 0.5, y: oy, w: cw, h: 0.35,
            fontSize: 14, fontFace: MBR_FONT, color: MBR_COLORS.purple, bold: true
        });
        s2.addText('Add content here', {
            x: 0.5, y: oy + 0.4, w: cw, h: 0.8,
            fontSize: 10, fontFace: MBR_FONT, color: MBR_COLORS.textSecondary, italic: true
        });
    }

    // Action Items
    var s3 = pres.addSlide();
    s3.bkgd = MBR_COLORS.white;
    addMbrSlideHeader(s3, pres, 'ACTION ITEMS', 'Looking Ahead');
    var colHeaders = ['COMCAST TEAM', 'PARTNER TEAM'];
    for (var k = 0; k < colHeaders.length; k++) {
        var cx = k === 0 ? 0.5 : 6.9;
        s3.addText(colHeaders[k], {
            x: cx, y: 1.5, w: 5.8, h: 0.35,
            fontSize: 13, fontFace: MBR_FONT, color: MBR_COLORS.purple, bold: true
        });
        s3.addText('Add action items here', {
            x: cx, y: 1.9, w: 5.8, h: 4,
            fontSize: 10, fontFace: MBR_FONT, color: MBR_COLORS.textSecondary, italic: true, valign: 'top'
        });
    }
}

// ── Main MBR Generation ────────────────────────────────────────────────────

function generateMBR(perf, onProgress) {
    var programs = perf.programs || [];
    var fiscalInfo = perf.fiscalInfo || {};

    var pres = new PptxGenJS();
    pres.layout = 'LAYOUT_WIDE';
    pres.author = 'Performance Intel';
    pres.subject = 'Monthly Business Review';

    // Gather AI insights from cache (if available)
    var insights = {};
    for (var i = 0; i < programs.length; i++) {
        var prog = programs[i];
        if (onProgress) onProgress('Building slides for ' + prog.jobType + '...', i, programs.length);

        var cachedNarrative = (typeof getAICache === 'function') ? getAICache('narrative', prog.jobType, prog.totalGoals) : null;
        var cachedOpps      = (typeof getAICache === 'function') ? getAICache('opps', prog.jobType, prog.totalGoals) : null;
        var narrativeStr = cachedNarrative ? (Array.isArray(cachedNarrative) ? cachedNarrative.join('\n\n') : cachedNarrative) : null;
        var oppsStr      = cachedOpps ? (Array.isArray(cachedOpps) ? cachedOpps.join('\n') : cachedOpps) : null;
        insights[prog.jobType] = { narrative: narrativeStr, opps: oppsStr };
    }

    if (onProgress) onProgress('Building slides...', programs.length, programs.length);

    buildMbrTitleSlide(pres, fiscalInfo);
    buildMbrSummarySlide(pres, perf);

    for (var j = 0; j < programs.length; j++) {
        var ins = insights[programs[j].jobType] || {};
        buildMbrProgramSlide(pres, programs[j], fiscalInfo, ins.narrative, ins.opps);
    }

    buildMbrSiteRankingSlide(pres, perf);
    buildMbrPlaceholderSlides(pres, programs);

    var filename = _mbrFormatFiscalFilename(fiscalInfo.fiscalEnd);
    return pres.writeFile({ fileName: filename }).then(function() {
        return filename;
    });
}

// ── Export Entry Point (called from index.php #btnMBRExport) ───────────────

function exportMBR() {
    var $status = $('#mbrExportStatus');
    var data = window.PERF && window.PERF.businessSummary;

    if (!data || !data.fiscalInfo) {
        $status.html('<div class="alert alert-warning">No data loaded. Please wait for data to finish loading.</div>');
        return;
    }

    $status.html('<div class="text-muted"><i class="bi bi-hourglass-split"></i> Loading PowerPoint library...</div>');

    ensurePptxGen(function() {
        $status.html('<div class="text-muted"><i class="bi bi-hourglass-split"></i> Fetching full program data...</div>');

        // Fetch full programs (with agents, goalEntry, etc.) for the MBR
        $.getJSON('/JSON/get/programs.php', function(programs) {
            // Merge full programs into perf data
            var perf = {
                programs:         programs,
                fiscalInfo:       data.fiscalInfo,
                totalAgents:      data.totalAgents,
                totalHours:       data.totalHours,
                globalGoals:      data.globalGoals,
                gph:              data.gph,
                planTotal:        data.planTotal,
                attainment:       data.attainment,
                regions:          data.regions,
                distUnique:       data.distUnique,
                globalRgu:        data.globalRgu,
                globalNewXI:      data.globalNewXI,
                globalXmLines:    data.globalXmLines,
                globalPlanRgu:    data.globalPlanRgu,
                globalPlanNewXI:  data.globalPlanNewXI,
                globalPlanXmLines:data.globalPlanXmLines,
                globalPlanHours:  data.globalPlanHours,
                uniqueAgentCount: data.totalAgents
            };

            $status.html('<div class="text-muted"><i class="bi bi-hourglass-split"></i> Generating MBR deck...</div>');

            try {
                generateMBR(perf, function(msg) {
                    $status.html('<div class="text-muted"><i class="bi bi-hourglass-split"></i> ' + msg + '</div>');
                }).then(function(filename) {
                    $status.html('<div class="alert alert-success"><i class="bi bi-check-circle"></i> Exported: ' + filename + '</div>');
                    setTimeout(function() {
                        var modal = bootstrap.Modal.getInstance(document.getElementById('mbrExportModal'));
                        if (modal) modal.hide();
                    }, 1500);
                }).catch(function(err) {
                    console.error('MBR generation failed:', err);
                    $status.html('<div class="alert alert-danger"><i class="bi bi-x-circle"></i> Export failed: ' + (err.message || err) + '</div>');
                });
            } catch (err) {
                console.error('MBR generation failed:', err);
                $status.html('<div class="alert alert-danger"><i class="bi bi-x-circle"></i> Export failed: ' + (err.message || err) + '</div>');
            }
        }).fail(function() {
            $status.html('<div class="alert alert-danger"><i class="bi bi-x-circle"></i> Failed to fetch program data.</div>');
        });
    });
}
