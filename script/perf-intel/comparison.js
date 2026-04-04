/**
 * comparison.js — Month-over-Month Comparison tab renderer
 * Loads data from /JSON/get/comparison-data.php and renders delta cards,
 * campaign table, DOW analysis, weekly trends, and agent movement into
 * #tab-comparison.
 */

// ── Entry Point ────────────────────────────────────────────────────────────────
function renderComparison() {
    var $tab = $('#tab-comparison').empty();
    $tab.html('<div class="text-center p-5"><div class="spinner-border text-warning"></div></div>');

    $.getJSON('/JSON/get/comparison-data.php', function(data) {
        buildComparisonView($tab, data);
    }).fail(function() {
        $tab.html('<div class="text-center text-danger p-5">Failed to load comparison data.</div>');
    });
}

// ── Main Builder ───────────────────────────────────────────────────────────────
function buildComparisonView($tab, data) {
    $tab.empty();

    // Guard: no prior data available
    if (!data || !data.prior || !data.prior.programs || !data.prior.programs.length) {
        $tab.html(
            '<div class="perf-card mb-3 text-center p-5 fade-in">' +
                '<h6 style="color:var(--text-warm);">No Prior Month Data</h6>' +
                '<p style="color:var(--text-muted);font-size:0.85rem;">Prior-month comparison data is not yet available. Data will appear here once two consecutive months have been processed.</p>' +
            '</div>'
        );
        return;
    }

    var cur    = data.current  || {};
    var prior  = data.prior    || {};
    var deltas = data.deltas   || {};
    var dow    = data.dowAnalysis      || {};
    var weekly = data.weeklyComparison || [];
    var move   = data.agentMovement    || {};

    // ── Row 0: AI Narrative (optional) ───────────────────
    var narrativeHtml = '';
    if (PERF.localAI) {
        narrativeHtml =
            '<div class="perf-card mb-3 fade-in" id="compNarrative">' +
                '<div class="d-flex justify-content-between align-items-center mb-2" style="cursor:pointer;" data-bs-toggle="collapse" data-bs-target="#compNarrativeBody">' +
                    '<h6 style="color:var(--text-dim);font-size:0.72rem;font-weight:600;text-transform:uppercase;letter-spacing:0.06em;margin:0;">' +
                        '<span style="color:' + AI_COLOR + ';">&#9679;</span> MoM Comparison Narrative' +
                    '</h6>' +
                    '<i class="bi bi-chevron-down" style="color:var(--text-muted);font-size:0.75rem;"></i>' +
                '</div>' +
                '<div class="collapse show" id="compNarrativeBody">' +
                    '<div class="ai-content" id="compNarrativeContent">' +
                        '<p style="color:var(--text-muted);">Generating narrative...</p>' +
                    '</div>' +
                '</div>' +
            '</div>';
    }

    // ── Row 1: Delta Stat Cards ──────────────────────────
    var row1 =
        '<div class="row g-3 mb-3 fade-in">' +
            compDeltaCard('Agents',  cur.totalAgents,  prior.totalAgents,  deltas.agents, 0) +
            compDeltaCard('Sales',   cur.totalGoals,   prior.totalGoals,   deltas.goals,  0) +
            compDeltaCard('Hours',   cur.totalHours,   prior.totalHours,   deltas.hours,  0) +
            compDeltaCard('GPH',     cur.gph,          prior.gph,          deltas.gph,    3) +
        '</div>';

    // ── Row 2: Campaign Comparison Table ─────────────────
    var row2 =
        '<div class="perf-card mb-3 fade-in">' +
            '<h6 style="color:var(--text-dim);font-size:0.72rem;font-weight:600;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:0.75rem;">Campaign Comparison</h6>' +
            '<div id="compCampaignTable"></div>' +
        '</div>';

    // ── Row 3: Day-of-Week Analysis ──────────────────────
    var row3 =
        '<div class="row g-3 mb-3 fade-in">' +
            '<div class="col-md-6">' +
                '<div class="perf-card">' +
                    '<h6 style="color:var(--text-dim);font-size:0.72rem;font-weight:600;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:0.75rem;">Current Month &mdash; Day of Week</h6>' +
                    buildDOWCards(dow.current || []) +
                '</div>' +
            '</div>' +
            '<div class="col-md-6">' +
                '<div class="perf-card">' +
                    '<h6 style="color:var(--text-dim);font-size:0.72rem;font-weight:600;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:0.75rem;">Prior Month &mdash; Day of Week</h6>' +
                    buildDOWCards(dow.prior || []) +
                '</div>' +
            '</div>' +
        '</div>';

    // ── Row 4: Weekly Trends Chart ───────────────────────
    var row4 =
        '<div class="perf-card mb-3 fade-in">' +
            '<h6 style="color:var(--text-dim);font-size:0.72rem;font-weight:600;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:0.75rem;">Weekly Trends</h6>' +
            '<div class="chart-container" id="compWeeklyChart" style="min-height:320px;"></div>' +
        '</div>';

    // ── Row 5: Agent Movement Tables ─────────────────────
    var row5 =
        '<div class="row g-3 mb-3 fade-in">' +
            '<div class="col-md-6">' +
                '<div class="perf-card">' +
                    '<h6 style="color:var(--text-dim);font-size:0.72rem;font-weight:600;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:0.75rem;">' +
                        '<span style="color:' + Q_DEFS.Q1.color + ';">&#9650;</span> Top Improvers' +
                    '</h6>' +
                    '<div id="compImproversTable"></div>' +
                '</div>' +
            '</div>' +
            '<div class="col-md-6">' +
                '<div class="perf-card">' +
                    '<h6 style="color:var(--text-dim);font-size:0.72rem;font-weight:600;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:0.75rem;">' +
                        '<span style="color:' + Q_DEFS.Q4.color + ';">&#9660;</span> Top Decliners' +
                    '</h6>' +
                    '<div id="compDeclinersTable"></div>' +
                '</div>' +
            '</div>' +
        '</div>';

    // ── Row 6: New / Departed Agents ─────────────────────
    var newAgents      = move['new']      || [];
    var departedAgents = move.departed     || [];
    var row6 = '';

    if (newAgents.length || departedAgents.length) {
        row6 =
            '<div class="row g-3 mb-3 fade-in">' +
                (newAgents.length
                    ? '<div class="' + (departedAgents.length ? 'col-md-6' : 'col-12') + '">' +
                        '<div class="perf-card">' +
                            '<h6 style="color:var(--text-dim);font-size:0.72rem;font-weight:600;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:0.75rem;">' +
                                '<span style="color:' + Q_DEFS.Q1.color + ';">+</span> New Agents This Month' +
                            '</h6>' +
                            buildAgentList(newAgents, 'currentPct') +
                        '</div>' +
                      '</div>'
                    : '') +
                (departedAgents.length
                    ? '<div class="' + (newAgents.length ? 'col-md-6' : 'col-12') + '">' +
                        '<div class="perf-card">' +
                            '<h6 style="color:var(--text-dim);font-size:0.72rem;font-weight:600;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:0.75rem;">' +
                                '<span style="color:' + Q_DEFS.Q4.color + ';">&minus;</span> Agents Not Seen This Month' +
                            '</h6>' +
                            buildAgentList(departedAgents, 'priorPct') +
                        '</div>' +
                      '</div>'
                    : '') +
            '</div>';
    }

    // ── Append all to DOM ────────────────────────────────
    $tab.append(narrativeHtml + row1 + row2 + row3 + row4 + row5 + row6);

    // ── Post-render: Campaign Table ──────────────────────
    buildCampaignComparisonTable(cur.programs || [], prior.programs || []);

    // ── Post-render: Weekly Chart ────────────────────────
    buildWeeklyComparisonChart(weekly);

    // ── Post-render: Agent Movement Tables ───────────────
    buildMovementTable('#compImproversTable', move.improved || [], 'desc');
    buildMovementTable('#compDeclinersTable', move.declined || [], 'asc');

    // ── Post-render: AI Narrative ────────────────────────
    if (PERF.localAI && PERF.ollamaAvailable && typeof generateNarrative === 'function') {
        generateNarrative(data, '#compNarrativeContent');
    }
}

// ── Delta Stat Card ────────────────────────────────────────────────────────────
function compDeltaCard(label, curVal, priorVal, delta, decimals) {
    decimals = decimals || 0;
    var curDisplay   = decimals > 0 ? Number(curVal || 0).toFixed(decimals) : Number(curVal || 0).toLocaleString();
    var priorDisplay = decimals > 0 ? Number(priorVal || 0).toFixed(decimals) : Number(priorVal || 0).toLocaleString();
    var deltaNum     = Number(delta || 0);
    var deltaDisplay = (deltaNum >= 0 ? '+' : '') + (decimals > 0 ? deltaNum.toFixed(decimals) : deltaNum.toLocaleString());
    var deltaColor   = deltaNum > 0 ? Q_DEFS.Q1.color : (deltaNum < 0 ? Q_DEFS.Q4.color : 'var(--text-dim)');

    return (
        '<div class="col-md-3 col-6">' +
            '<div class="stat-card">' +
                '<div class="label">' + label + '</div>' +
                '<div class="value">' + curDisplay + '</div>' +
                '<div class="sub" style="line-height:1.6;">' +
                    'Prior: ' + priorDisplay +
                    '<br><span style="color:' + deltaColor + ';font-weight:600;">' + deltaDisplay + '</span>' +
                '</div>' +
            '</div>' +
        '</div>'
    );
}

// ── Campaign Comparison Table ──────────────────────────────────────────────────
function buildCampaignComparisonTable(curPrograms, priorPrograms) {
    // Merge by jobType
    var map = {};
    curPrograms.forEach(function(p) {
        map[p.jobType] = {
            jobType:      p.jobType,
            curSales:     p.totalGoals || 0,
            priorSales:   0,
            curGPH:       p.gph || 0,
            priorGPH:     0,
            curAgents:    p.uniqueAgentCount || 0,
            priorAgents:  0
        };
    });
    priorPrograms.forEach(function(p) {
        if (!map[p.jobType]) {
            map[p.jobType] = {
                jobType:    p.jobType,
                curSales:   0,
                priorSales: 0,
                curGPH:     0,
                priorGPH:   0,
                curAgents:  0,
                priorAgents:0
            };
        }
        map[p.jobType].priorSales  = p.totalGoals || 0;
        map[p.jobType].priorGPH    = p.gph || 0;
        map[p.jobType].priorAgents = p.uniqueAgentCount || 0;
    });

    var rows = [];
    Object.keys(map).forEach(function(k) {
        var r = map[k];
        r.salesDelta = r.curSales - r.priorSales;
        r.gphDelta   = r.curGPH  - r.priorGPH;
        rows.push(r);
    });

    if (!rows.length) {
        $('#compCampaignTable').html('<p style="color:var(--text-muted);font-size:0.85rem;">No campaign data available.</p>');
        return;
    }

    gcs.bsdt({
        parent: '#compCampaignTable',
        data: rows,
        example: { jobType: '', curSales: 0, priorSales: 0, salesDelta: 0, curGPH: 0, priorGPH: 0, gphDelta: 0, curAgents: 0, priorAgents: 0 },
        column: ['jobType', 'curSales', 'priorSales', 'salesDelta', 'curGPH', 'priorGPH', 'gphDelta', 'curAgents', 'priorAgents'],
        header: ['Program', 'Cur Sales', 'Prior Sales', 'Delta', 'Cur GPH', 'Prior GPH', 'GPH Delta', 'Cur Agents', 'Prior Agents'],
        render: [
            'text()',
            'number()',
            'number()',
            function(val) {
                var n = Number(val);
                var color = n > 0 ? Q_DEFS.Q1.color : (n < 0 ? Q_DEFS.Q4.color : 'var(--text-dim)');
                var prefix = n > 0 ? '+' : '';
                return '<span style="color:' + color + ';font-weight:600;">' + prefix + n.toLocaleString() + '</span>';
            },
            'number(null,null,3)',
            'number(null,null,3)',
            function(val) {
                var n = Number(val);
                var color = n > 0 ? Q_DEFS.Q1.color : (n < 0 ? Q_DEFS.Q4.color : 'var(--text-dim)');
                var prefix = n > 0 ? '+' : '';
                return '<span style="color:' + color + ';font-weight:600;">' + prefix + n.toFixed(3) + '</span>';
            },
            'number()',
            'number()'
        ],
        order: [{ name: 'salesDelta', dir: 'desc' }],
        paging: false
    });
}

// ── Day-of-Week Cards ──────────────────────────────────────────────────────────
function buildDOWCards(dowArr) {
    if (!dowArr || !dowArr.length) {
        return '<p style="color:var(--text-muted);font-size:0.85rem;">No day-of-week data available.</p>';
    }

    // Find the best day by avg goals per day
    var bestIdx = 0;
    var bestAvg = -1;
    dowArr.forEach(function(d, i) {
        var avg = d.days > 0 ? d.goals / d.days : 0;
        if (avg > bestAvg) { bestAvg = avg; bestIdx = i; }
    });

    var html = '<div class="row g-2">';
    dowArr.forEach(function(d, i) {
        var avgGoals = d.days > 0 ? (d.goals / d.days).toFixed(1) : '0.0';
        var gph      = Number(d.gph || 0).toFixed(3);
        var isBest   = (i === bestIdx);
        var border   = isBest ? 'border:1px solid ' + Q_DEFS.Q1.color + ';' : '';
        var glow     = isBest ? 'box-shadow:0 0 6px ' + Q_DEFS.Q1.glow + ';' : '';

        html +=
            '<div class="col-6 col-lg-3">' +
                '<div class="perf-card p-2 mb-0" style="' + border + glow + '">' +
                    '<div style="font-weight:600;font-size:0.78rem;color:var(--text-warm);">' + d.dow + '</div>' +
                    '<div style="font-size:0.75rem;color:var(--text-secondary);line-height:1.6;">' +
                        '<div>Avg Sales/Day: <strong>' + avgGoals + '</strong></div>' +
                        '<div>GPH: <strong>' + gph + '</strong></div>' +
                        '<div style="color:var(--text-muted);font-size:0.7rem;">' + (d.days || 0) + ' day' + (d.days !== 1 ? 's' : '') + '</div>' +
                    '</div>' +
                '</div>' +
            '</div>';
    });
    html += '</div>';
    return html;
}

// ── Weekly Comparison Chart ────────────────────────────────────────────────────
function buildWeeklyComparisonChart(weekly) {
    if (!weekly || !weekly.length) {
        $('#compWeeklyChart').html('<div class="text-muted text-center p-3">No weekly data available.</div>');
        return;
    }

    var chartData = [];
    weekly.forEach(function(w) {
        chartData.push({ Key: 'Current Month', Date: w.week, Value: w.currentGoals || 0 });
        chartData.push({ Key: 'Prior Month',   Date: w.week, Value: w.priorGoals   || 0 });
    });

    if (chartData.length > 0) {
        try {
            gcs.chart.buildMultiLineChartData({
                target: '#compWeeklyChart',
                title: 'Weekly Sales Comparison',
                data: chartData,
                key: 'Key',
                x: 'Date',
                xDate: false,
                y: 'Value',
                showLegend: true
            });
        } catch (e) {
            $('#compWeeklyChart').html('<div class="text-muted text-center p-3">Chart rendering unavailable.</div>');
        }
    }
}

// ── Agent Movement Table ───────────────────────────────────────────────────────
function buildMovementTable(target, agents, dir) {
    if (!agents || !agents.length) {
        $(target).html('<p style="color:var(--text-muted);font-size:0.85rem;">No agent movement data available.</p>');
        return;
    }

    gcs.bsdt({
        parent: target,
        data: agents,
        example: { name: '', currentPct: 0, priorPct: 0, delta: 0 },
        column: ['name', 'currentPct', 'priorPct', 'delta'],
        header: ['Agent', 'Current %', 'Prior %', 'Delta'],
        render: [
            'text()',
            'number(null,null,1,null,"%")',
            'number(null,null,1,null,"%")',
            function(val) {
                var n = Number(val);
                var color = n > 0 ? Q_DEFS.Q1.color : (n < 0 ? Q_DEFS.Q4.color : 'var(--text-dim)');
                var prefix = n > 0 ? '+' : '';
                return '<span style="color:' + color + ';font-weight:600;">' + prefix + n.toFixed(1) + '%</span>';
            }
        ],
        order: [{ name: 'delta', dir: dir }],
        paging: false
    });
}

// ── New / Departed Agent List ──────────────────────────────────────────────────
function buildAgentList(agents, pctKey) {
    if (!agents || !agents.length) return '<p style="color:var(--text-muted);font-size:0.85rem;">None.</p>';

    var html = '<div style="max-height:280px;overflow-y:auto;">';
    agents.forEach(function(a) {
        var pctVal = a[pctKey];
        var pctStr = (pctVal !== null && pctVal !== undefined) ? Number(pctVal).toFixed(1) + '%' : '';
        var color  = pctStr ? attainColor(pctVal) : 'var(--text-secondary)';

        html +=
            '<div class="d-flex justify-content-between align-items-center py-1 px-2" style="font-size:0.82rem;border-bottom:1px solid var(--border-subtle);">' +
                '<span style="color:var(--text-secondary);">' + (a.name || '\u2014') + '</span>' +
                (pctStr ? '<span style="color:' + color + ';font-weight:600;">' + pctStr + '</span>' : '') +
            '</div>';
    });
    html += '</div>';
    return html;
}
