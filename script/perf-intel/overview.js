/**
 * overview.js — Business Overview tab renderer
 * Renders stat cards, pacing banner, charts, program table, region cards,
 * insights, and optional AI narrative into #tab-overview.
 */

function renderOverview(data) {
    var $tab = $('#tab-overview').empty();
    var fi   = data.fiscalInfo || {};
    var dist = data.distUnique || {};
    var programs = data.programs || [];
    var regions  = data.regions || [];
    var insights = data.insights || [];

    // ── Pacing projection ────────────────────────────────
    var pacing = null;
    if (data.attainment !== null && data.attainment !== undefined && data.planTotal) {
        pacing = calcPacing(data.globalGoals, data.planTotal, fi.elapsedBDays, fi.totalBDays);
    }

    // ── Row 1: Stat Cards ────────────────────────────────
    var attainSub = data.attainment !== null && data.attainment !== undefined
        ? fmtPct(data.attainment) + ' attainment'
        : '';

    var row1 =
        '<div class="row g-3 mb-3 fade-in">' +
            statCard('Total Agents', Number(data.totalAgents).toLocaleString(), 'across ' + programs.length + ' programs') +
            statCard('Total Hours', Number(data.totalHours).toLocaleString(), fmt(data.gph, 2) + ' GPH') +
            statCard('Total Sales', Number(data.globalGoals).toLocaleString(), attainSub) +
            statCard('Pacing', fi.elapsedBDays + ' of ' + fi.totalBDays + ' days', fi.remainingBDays + ' remaining') +
        '</div>';

    // ── Row 2: Fiscal Pacing Banner ──────────────────────
    var pctElapsed = fi.pctElapsed ? Math.min(fi.pctElapsed, 100) : 0;
    var projLine   = '';
    if (pacing) {
        projLine =
            '<div class="mt-2" style="font-size:0.85rem;color:var(--text-secondary);">' +
                'Projected: <strong style="color:' + attainColor(pacing.projectedPct) + ';">' +
                    Number(pacing.projected).toLocaleString() + ' homes (' + fmtPct(pacing.projectedPct) + ')' +
                '</strong>' +
                ' &mdash; Delta: <span style="color:' + (pacing.delta >= 0 ? Q_DEFS.Q1.color : Q_DEFS.Q4.color) + ';">' +
                    (pacing.delta >= 0 ? '+' : '') + Number(pacing.delta).toLocaleString() +
                '</span>' +
            '</div>';
    }

    var row2 =
        '<div class="pacing-banner mb-3 fade-in">' +
            '<div class="d-flex justify-content-between align-items-center" style="font-size:0.78rem;color:var(--text-muted);">' +
                '<span>' + (fi.fiscalStart || '') + '</span>' +
                '<strong style="color:var(--text-secondary);">' + fmt(pctElapsed, 0) + '% elapsed</strong>' +
                '<span>' + (fi.fiscalEnd || '') + '</span>' +
            '</div>' +
            '<div class="progress">' +
                '<div class="progress-bar" role="progressbar" style="width:' + pctElapsed + '%;" ' +
                    'aria-valuenow="' + pctElapsed + '" aria-valuemin="0" aria-valuemax="100"></div>' +
            '</div>' +
            projLine +
        '</div>';

    // ── Row 3: Charts ────────────────────────────────────
    var row3 =
        '<div class="row g-3 mb-3 fade-in">' +
            '<div class="col-md-6">' +
                '<div class="chart-container" id="overviewQuartileChart" style="min-height:320px;"></div>' +
            '</div>' +
            '<div class="col-md-6">' +
                '<div class="chart-container" id="overviewHealthChart" style="min-height:320px;"></div>' +
            '</div>' +
        '</div>';

    // ── Row 4: Program Leaderboard ───────────────────────
    var row4 =
        '<div class="perf-card mb-3 fade-in">' +
            '<h6 style="color:var(--text-dim);font-size:0.72rem;font-weight:600;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:0.75rem;">Program Leaderboard</h6>' +
            '<div id="overviewProgramTable"></div>' +
        '</div>';

    // ── Row 5: Region Cards ──────────────────────────────
    var regionCards = '';
    regions.forEach(function(r) {
        var avgColor = attainColor(r.avgPct || 0);
        regionCards +=
            '<div class="col-md-4 col-lg-3">' +
                '<div class="perf-card mb-3">' +
                    '<div style="font-weight:600;color:var(--text-warm);margin-bottom:0.5rem;">' + r.name + '</div>' +
                    '<div style="font-size:0.82rem;color:var(--text-secondary);line-height:1.8;">' +
                        '<div><span style="color:var(--text-muted);">Agents:</span> ' + r.uniqueAgents + '</div>' +
                        '<div><span style="color:var(--text-muted);">Sales:</span> ' + Number(r.totalGoals).toLocaleString() + '</div>' +
                        '<div><span style="color:var(--text-muted);">Avg % to Goal:</span> <span style="color:' + avgColor + ';font-weight:600;">' + fmtPct(r.avgPct) + '</span></div>' +
                        '<div><span style="color:var(--text-muted);">GPH:</span> ' + fmt(r.avgGPH, 2) + '</div>' +
                        '<div class="d-flex gap-3 mt-1">' +
                            '<span class="q-badge q1">Q1: ' + (r.uniqueQ1 || 0) + '</span>' +
                            '<span class="q-badge q4">Q4: ' + (r.uniqueQ4 || 0) + '</span>' +
                        '</div>' +
                    '</div>' +
                '</div>' +
            '</div>';
    });

    var row5 = regions.length
        ? '<div class="row g-3 mb-3 fade-in">' + regionCards + '</div>'
        : '';

    // ── Row 6: Insights ──────────────────────────────────
    var wins = insights.filter(function(i) { return i.type === 'win'; });
    var opps = insights.filter(function(i) { return i.type === 'opp'; });

    var insightHtml = '';
    if (wins.length || opps.length) {
        var winsHtml = '';
        wins.forEach(function(w) {
            winsHtml += '<div class="insight-win"><p class="insight-text">' + w.text + '</p></div>';
        });

        var oppsHtml = '';
        opps.forEach(function(o) {
            oppsHtml += '<div class="insight-opp"><p class="insight-text">' + o.text + '</p></div>';
        });

        insightHtml =
            '<div class="row g-3 mb-3 fade-in">' +
                '<div class="col-md-6">' +
                    '<h6 style="color:var(--text-dim);font-size:0.72rem;font-weight:600;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:0.5rem;">' +
                        '<span style="color:' + Q_DEFS.Q1.color + ';">&#9650;</span> Wins' +
                    '</h6>' +
                    (winsHtml || '<p style="color:var(--text-muted);font-size:0.85rem;">No wins flagged this period.</p>') +
                '</div>' +
                '<div class="col-md-6">' +
                    '<h6 style="color:var(--text-dim);font-size:0.72rem;font-weight:600;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:0.5rem;">' +
                        '<span style="color:' + Q_DEFS.Q3.color + ';">&#9679;</span> Opportunities' +
                    '</h6>' +
                    (oppsHtml || '<p style="color:var(--text-muted);font-size:0.85rem;">No opportunities flagged this period.</p>') +
                '</div>' +
            '</div>';
    }

    // ── Row 7: AI Narrative ──────────────────────────────
    var narrativeHtml = '';
    var templateNarrative = data.narrative && data.narrative.length
        ? data.narrative.map(function(p) { return '<p>' + p + '</p>'; }).join('')
        : '';

    narrativeHtml =
        '<div class="perf-card mb-3 fade-in" id="overviewNarrative">' +
            '<div class="d-flex justify-content-between align-items-center mb-2" style="cursor:pointer;" data-bs-toggle="collapse" data-bs-target="#narrativeBody">' +
                '<h6 style="color:var(--text-dim);font-size:0.72rem;font-weight:600;text-transform:uppercase;letter-spacing:0.06em;margin:0;">' +
                    '<span style="color:' + AI_COLOR + ';">&#9679;</span> Business Narrative' +
                '</h6>' +
                '<i class="bi bi-chevron-down" style="color:var(--text-muted);font-size:0.75rem;"></i>' +
            '</div>' +
            '<div class="collapse show" id="narrativeBody">' +
                '<div class="ai-content" id="narrativeContent">' +
                    (templateNarrative || '<p style="color:var(--text-muted);">Narrative will appear here once data is analyzed.</p>') +
                '</div>' +
            '</div>' +
        '</div>';

    // ── Append all to DOM ────────────────────────────────
    $tab.append(row1 + row2 + row3 + row4 + row5 + insightHtml + narrativeHtml);

    // ── Initialize Charts ────────────────────────────────
    buildQuartileChart(dist);
    buildHealthChart(programs);

    // ── Initialize Program Table ─────────────────────────
    buildProgramTable(data);

    // ── AI Narrative (if enabled) ────────────────────────
    if (PERF.localAI && PERF.ollamaAvailable && typeof generateNarrative === 'function') {
        generateNarrative(data, '#narrativeContent');
    }
}

// ── Stat Card Helper ─────────────────────────────────────
function statCard(label, value, sub) {
    return (
        '<div class="col-md-3 col-6">' +
            '<div class="stat-card">' +
                '<div class="label">' + label + '</div>' +
                '<div class="value">' + value + '</div>' +
                (sub ? '<div class="sub">' + sub + '</div>' : '') +
            '</div>' +
        '</div>'
    );
}

// ── Quartile Doughnut Chart ──────────────────────────────
function buildQuartileChart(dist) {
    var q1 = dist.Q1 || 0;
    var q2 = dist.Q2 || 0;
    var q3 = dist.Q3 || 0;
    var q4 = dist.Q4 || 0;

    gcs.chart.buildDoughnutChartData({
        target: '#overviewQuartileChart',
        title: 'Quartile Distribution',
        data: [
            { Label: 'Q1 (' + q1 + ')', Count: q1 },
            { Label: 'Q2 (' + q2 + ')', Count: q2 },
            { Label: 'Q3 (' + q3 + ')', Count: q3 },
            { Label: 'Q4 (' + q4 + ')', Count: q4 }
        ],
        showTotal: true,
        optsOverride: {
            data: [{
                dataPoints: [
                    { label: 'Q1 (' + q1 + ')', y: q1, color: Q_DEFS.Q1.color },
                    { label: 'Q2 (' + q2 + ')', y: q2, color: Q_DEFS.Q2.color },
                    { label: 'Q3 (' + q3 + ')', y: q3, color: Q_DEFS.Q3.color },
                    { label: 'Q4 (' + q4 + ')', y: q4, color: Q_DEFS.Q4.color }
                ],
                indexLabelFontSize: 12
            }]
        }
    });
}

// ── Program Health Bar Chart ─────────────────────────────
function buildHealthChart(programs) {
    if (!programs || !programs.length) return;

    gcs.chart.buildBarChartData({
        target: '#overviewHealthChart',
        title: 'Program Attainment',
        data: programs.map(function(p) {
            return {
                Label: p.jobType,
                Count: p.attainment || p.healthScore
            };
        })
    });
}

// ── Program Leaderboard DataTable ────────────────────────
function buildProgramTable(data) {
    var programs = data.programs || [];
    if (!programs.length) return;

    gcs.bsdt({
        parent: '#overviewProgramTable',
        data: programs,
        example: { jobType: '', uniqueAgentCount: 0, totalGoals: 0, gph: 0, attainment: 0, healthScore: 0, planGoals: 0 },
        column: ['jobType', 'uniqueAgentCount', 'totalGoals', 'gph', 'attainment', 'healthScore', 'planGoals'],
        header: ['Program', 'Agents', 'Sales', 'GPH', 'Attain %', 'Health', 'Plan'],
        render: ['text()', 'number()', 'number()', 'number(null,null,3)', 'number(null,null,1,null,"%")', 'number(null,null,0)', 'number()'],
        order: [{ name: 'attainment', dir: 'desc' }],
        paging: false,
        info: function(row) {
            var idx = data.programs.findIndex(function(p) { return p.jobType === row.jobType; });
            if (idx >= 0) {
                $('a[href="#tab-programs"]').tab('show');
                setTimeout(function() {
                    $('a[data-program="' + row.jobType + '"]').tab('show');
                }, 100);
            }
        }
    });
}
