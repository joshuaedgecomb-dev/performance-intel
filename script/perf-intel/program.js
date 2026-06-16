/**
 * program.js — Program Detail View
 * Renders the full program detail with sub-tabs: Scorecard, Agents, Gainshare,
 * Pacing, Daily, Teams, By Site, Goals.
 * Uses BaseJS framework (jQuery, Bootstrap 5, CanvasJS via gcs.chart.*, DataTables via gcs.bsdt()).
 */

// ── Helpers ────────────────────────────────────────────────────────────────────

function sanitizeId(name) {
    return (name || '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase();
}

function safeNum(v, dec) {
    if (v === null || v === undefined || isNaN(v)) return '\u2014';
    return Number(v).toFixed(dec === undefined ? 0 : dec);
}

function safeInt(v) {
    if (v === null || v === undefined || isNaN(v)) return '\u2014';
    return Math.round(v).toLocaleString();
}

// ── Entry Point ────────────────────────────────────────────────────────────────

function renderProgram(targetSelector, programName) {
    var $target = $(targetSelector);
    $target.html('<div class="text-center p-5"><div class="spinner-border text-warning"></div></div>');

    $.getJSON('/JSON/get/program-detail.php', { program: programName }, function(data) {
        buildProgramView($target, data, programName);
    }).fail(function() {
        $target.html('<div class="text-center text-danger p-5">Failed to load program data.</div>');
    });
}

// ── Main View Builder ──────────────────────────────────────────────────────────

function buildProgramView($target, data, programName) {
    var id = sanitizeId(programName);
    var tabDefs = [
        { key: 'scorecard', label: 'Scorecard',  active: true },
        { key: 'agents',    label: 'Agents' },
        { key: 'gainshare', label: 'Gainshare' },
        { key: 'pacing',    label: 'Pacing' },
        { key: 'daily',     label: 'Daily' },
        { key: 'teams',     label: 'Teams' },
        { key: 'bysite',    label: 'By Site' },
        { key: 'goals',     label: 'Goals' },
    ];

    // Build nav-pills
    var navHtml = '<ul class="nav nav-pills mb-3" id="prog-' + id + '-tabs">';
    tabDefs.forEach(function(t) {
        navHtml += '<li class="nav-item">' +
            '<a class="nav-link' + (t.active ? ' active' : '') + '" data-bs-toggle="pill" href="#prog-' + id + '-' + t.key + '">' +
            t.label + '</a></li>';
    });
    navHtml += '</ul>';

    // Build tab panes
    var contentHtml = '<div class="tab-content" id="prog-' + id + '-tabContent">';
    tabDefs.forEach(function(t) {
        var show = t.active ? ' show active' : '';
        contentHtml += '<div class="tab-pane fade' + show + '" id="prog-' + id + '-' + t.key + '"></div>';
    });
    contentHtml += '</div>';

    $target.html(navHtml + contentHtml);

    // Render scorecard immediately (it's the active tab)
    renderScorecard('#prog-' + id + '-scorecard', data, id);

    // Track which sub-tabs have been rendered
    var rendered = { scorecard: true };

    // Lazy-load other sub-tabs on shown.bs.tab
    $target.find('a[data-bs-toggle="pill"]').on('shown.bs.tab', function() {
        var href = $(this).attr('href');
        var key = href.replace('#prog-' + id + '-', '');
        if (rendered[key]) return;
        rendered[key] = true;

        switch (key) {
            case 'agents':    renderAgents(href, data, programName, id);  break;
            case 'gainshare': renderGainshare(href, data, id);           break;
            case 'pacing':    renderPacing(href, data, id);              break;
            case 'daily':     renderDaily(href, data, id);               break;
            case 'teams':     renderTeams(href, data, id);               break;
            case 'bysite':    renderBySite(href, data, programName, id); break;
            case 'goals':     renderGoals(href, data, id);               break;
        }
    });
}

// ============================================================================
// SUB-TAB 1: SCORECARD
// ============================================================================

function renderScorecard(sel, data, id) {
    var $pane = $(sel);
    var p = data;

    var attPct = p.attainment !== null ? Number(p.attainment).toFixed(1) + '%' : '\u2014';
    var attClr = p.attainment !== null ? attainColor(p.attainment) : 'var(--text-dim)';
    var hsClr  = p.healthScore >= 80 ? '#16a34a' : (p.healthScore >= 50 ? '#d97706' : '#dc2626');

    // ── Stat Cards Row ─────────────────────────────────────────────────────
    var html = '<div class="row g-3 mb-4">';
    html += statCard('Agents',     safeInt(p.uniqueAgentCount));
    html += statCard('Hours',      safeNum(p.totalHours, 1));
    html += statCard('Sales',      safeInt(p.actGoals), p.planGoals ? 'Plan: ' + safeInt(p.planGoals) : null);
    html += statCard('GPH',        safeNum(p.gph, 3));
    html += statCard('Attainment', attPct, null, attClr);
    html += statCard('Health',     safeNum(p.healthScore, 1) + ' / 100', null, hsClr);
    html += '</div>';

    // ── Metrics Compare Table ──────────────────────────────────────────────
    html += '<div class="perf-card mb-4">';
    html += '<h6 class="text-amber mb-3" style="font-size:0.78rem;text-transform:uppercase;letter-spacing:0.06em;">Metrics vs Plan</h6>';
    html += '<table class="table table-sm table-hover mb-0">';
    html += '<thead><tr><th>Metric</th><th class="text-end">Plan</th><th class="text-end">Actual</th><th class="text-end">Attain %</th><th style="width:30%;">Progress</th></tr></thead>';
    html += '<tbody>';

    GOAL_METRICS.forEach(function(m) {
        if (!m.actualKey) return; // skip Phone (no actual)

        var plan = getGoalPlan(p.goalEntry, m.goalKey, m.mode);
        var actual = getActualFromData(p, m.actualKey);

        if (plan === null && actual === null) return;

        var att = plan && plan > 0 ? (actual / plan) * 100 : null;
        var attStr = att !== null ? Number(att).toFixed(1) + '%' : '\u2014';
        var attC   = att !== null ? attainColor(att) : 'var(--text-dim)';
        var barW   = att !== null ? Math.min(att, 100) : 0;

        html += '<tr>';
        html += '<td>' + m.label + '</td>';
        html += '<td class="text-end font-data">' + fmtGoal(plan, m.fmt) + '</td>';
        html += '<td class="text-end font-data">' + fmtGoal(actual, m.fmt) + '</td>';
        html += '<td class="text-end font-data" style="color:' + attC + ';">' + attStr + '</td>';
        html += '<td><div style="background:var(--bg-tertiary);border-radius:3px;height:6px;overflow:hidden;">' +
            '<div style="width:' + barW + '%;height:100%;background:' + attC + ';border-radius:3px;transition:width 0.6s ease;"></div>' +
            '</div></td>';
        html += '</tr>';
    });
    html += '</tbody></table></div>';

    // ── Insights ───────────────────────────────────────────────────────────
    var wins = data.winInsights || [];
    var opps = data.oppInsights || [];

    if (wins.length || opps.length) {
        html += '<div class="row g-3 mb-4">';
        html += '<div class="col-md-6">';
        if (wins.length) {
            html += '<h6 style="color:#16a34a;font-size:0.75rem;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:0.5rem;">Wins</h6>';
            wins.forEach(function(w) {
                html += '<div class="insight-win"><p class="insight-text">' + escHtml(w) + '</p></div>';
            });
        }
        html += '</div><div class="col-md-6">';
        if (opps.length) {
            html += '<h6 style="color:#d97706;font-size:0.75rem;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:0.5rem;">Opportunities</h6>';
            opps.forEach(function(o) {
                html += '<div class="insight-opp"><p class="insight-text">' + escHtml(o) + '</p></div>';
            });
        }
        html += '</div></div>';
    }

    // ── Narrative ──────────────────────────────────────────────────────────
    if (data.narrative) {
        var collapseId = 'narr-' + id;
        html += '<div class="perf-card mb-4">';
        html += '<a class="text-amber" style="font-size:0.78rem;text-transform:uppercase;letter-spacing:0.06em;text-decoration:none;cursor:pointer;" ' +
            'data-bs-toggle="collapse" href="#' + collapseId + '">Narrative Summary &#x25BC;</a>';
        html += '<div class="collapse mt-2" id="' + collapseId + '">';
        html += '<p class="insight-text">' + escHtml(data.narrative) + '</p>';
        html += '</div></div>';
    }

    $pane.html('<div class="fade-in">' + html + '</div>');
}

function statCard(label, value, sub, color) {
    var html = '<div class="col-md-3 col-sm-6 col-6"><div class="stat-card">';
    html += '<div class="label">' + label + '</div>';
    html += '<div class="value"' + (color ? ' style="color:' + color + ';"' : '') + '>' + value + '</div>';
    if (sub) html += '<div class="sub">' + sub + '</div>';
    html += '</div></div>';
    return html;
}

// ============================================================================
// SUB-TAB 2: AGENTS
// ============================================================================

function renderAgents(sel, data, programName, id) {
    var $pane = $(sel);
    var agents = buildUniqueAgentList(data);

    if (!agents.length) {
        $pane.html('<div class="text-center text-muted p-4">No agent data available.</div>');
        return;
    }

    // Build table container and modal
    var tableId = 'agentTbl-' + id;
    var modalId = 'agentModal-' + id;
    $pane.html(
        '<div id="' + tableId + '"></div>' +
        '<div class="modal fade" id="' + modalId + '" tabindex="-1"><div class="modal-dialog modal-lg modal-dialog-scrollable">' +
        '<div class="modal-content"><div class="modal-header"><h5 class="modal-title">Agent Daily Profile</h5>' +
        '<button type="button" class="btn-close" data-bs-dismiss="modal"></button></div>' +
        '<div class="modal-body" id="' + modalId + '-body"></div></div></div></div>'
    );

    gcs.bsdt({
        id: tableId,
        parent: '#' + tableId,
        url: '/JSON/get/program-detail.php',
        urlData: { program: programName },
        map: function(raw) {
            return buildUniqueAgentList(raw);
        },
        column: ['agentName', 'region', 'hours', 'goals', 'gph', 'pctToGoal', 'quartile'],
        header: ['Agent', 'Region', 'Hours', 'Sales', 'GPH', '% to Goal', 'Quartile'],
        render: ['', '', 'number(1)', 'number(0)', 'number(3)', 'number(1)', ''],
        search: true,
        paging: true,
        responsive: true,
        growFull: false,
        title: 'Agents',
        columns: [
            { title: 'Agent', data: 'agentName', name: 'agentName' },
            { title: 'Region', data: 'region', name: 'region' },
            { title: 'Hours', data: 'hours', name: 'hours', className: 'text-end font-data',
              render: function(d) { return safeNum(d, 1); } },
            { title: 'Sales', data: 'goals', name: 'goals', className: 'text-end font-data',
              render: function(d) { return safeInt(d); } },
            { title: 'GPH', data: 'gph', name: 'gph', className: 'text-end font-data',
              render: function(d) { return safeNum(d, 3); } },
            { title: '% to Goal', data: 'pctToGoal', name: 'pctToGoal', className: 'text-end font-data',
              render: function(d) {
                  if (d === null || d === undefined) return '\u2014';
                  var c = attainColor(d);
                  return '<span style="color:' + c + ';">' + Number(d).toFixed(1) + '%</span>';
              }
            },
            { title: 'Quartile', data: 'quartile', name: 'quartile', className: 'text-center',
              render: function(d) {
                  var q = d || 'Q4';
                  var def = Q_DEFS[q] || Q_DEFS.Q4;
                  return '<span class="q-badge ' + q.toLowerCase() + '">' + def.badge + '</span>';
              }
            }
        ],
        info: function(row) {
            loadAgentProfile(row.agentName, programName, modalId);
        },
        infotitle: 'Profile',
        draw: function() {
            // Sort by hours desc initially
        }
    });
}

function loadAgentProfile(agentName, programName, modalId) {
    var $body = $('#' + modalId + '-body');
    $body.html('<div class="text-center p-4"><div class="spinner-border text-warning"></div></div>');

    var modal = new bootstrap.Modal(document.getElementById(modalId));
    modal.show();

    $.getJSON('/JSON/get/agent-daily.php', { agent: agentName, program: programName }, function(profile) {
        var html = '<h6 class="mb-3">' + escHtml(agentName) + '</h6>';

        if (profile && profile.dailyRows && profile.dailyRows.length) {
            html += '<table class="table table-sm table-striped table-hover">';
            html += '<thead><tr><th>Date</th><th class="text-end">Hours</th><th class="text-end">Goals</th><th class="text-end">GPH</th></tr></thead><tbody>';
            profile.dailyRows.forEach(function(r) {
                var gph = r.hours > 0 ? (r.goals / r.hours) : 0;
                html += '<tr><td>' + r.date + '</td><td class="text-end font-data">' + safeNum(r.hours, 1) +
                    '</td><td class="text-end font-data">' + safeInt(r.goals) +
                    '</td><td class="text-end font-data">' + safeNum(gph, 3) + '</td></tr>';
            });
            html += '</tbody></table>';

            // Summary stats
            if (profile.totalHours !== undefined) {
                html += '<div class="row g-2 mt-2">';
                html += '<div class="col-4"><div class="stat-card"><div class="label">Total Hours</div><div class="value" style="font-size:1.1rem;">' + safeNum(profile.totalHours, 1) + '</div></div></div>';
                html += '<div class="col-4"><div class="stat-card"><div class="label">Total Sales</div><div class="value" style="font-size:1.1rem;">' + safeInt(profile.totalGoals) + '</div></div></div>';
                html += '<div class="col-4"><div class="stat-card"><div class="label">GPH</div><div class="value" style="font-size:1.1rem;">' + safeNum(profile.gph, 3) + '</div></div></div>';
                html += '</div>';
            }
        } else {
            html += '<div class="text-muted">No daily data available for this agent.</div>';
        }

        $body.html(html);
    }).fail(function() {
        $body.html('<div class="text-danger">Failed to load agent profile.</div>');
    });
}

// ============================================================================
// SUB-TAB 3: GAINSHARE
// ============================================================================

function renderGainshare(sel, data, id) {
    var $pane = $(sel);
    var att = data.attainment;
    var currentTier = att !== null ? getGainshareTier(att, false) : null;

    var html = '<div class="perf-card mb-4">';
    html += '<h6 class="text-amber mb-3" style="font-size:0.78rem;text-transform:uppercase;letter-spacing:0.06em;">Program Gainshare Tiers</h6>';

    if (att !== null) {
        html += '<p style="font-size:0.85rem;color:var(--text-secondary);margin-bottom:1rem;">Current Attainment: <strong style="color:' + attainColor(att) + ';">' + Number(att).toFixed(1) + '%</strong></p>';
    }

    html += buildGainshareTable(GAINSHARE_TIERS, currentTier);
    html += '</div>';

    // Site-level gainshare (if multiple sites exist)
    var regions = data.regions || [];
    var siteBuckets = {};
    regions.forEach(function(r) {
        var site = REGION_TO_SITE[r.name] || 'Other';
        if (!siteBuckets[site]) siteBuckets[site] = { agents: 0, hours: 0, goals: 0, regions: [] };
        siteBuckets[site].agents += r.uniqueAgents || r.count;
        siteBuckets[site].hours += r.totalHours;
        siteBuckets[site].goals += r.totalGoals;
        siteBuckets[site].regions.push(r);
    });

    var siteKeys = Object.keys(siteBuckets);
    if (siteKeys.length > 1) {
        html += '<div class="perf-card mb-4">';
        html += '<h6 class="text-amber mb-3" style="font-size:0.78rem;text-transform:uppercase;letter-spacing:0.06em;">Site-Level Gainshare</h6>';

        siteKeys.forEach(function(siteKey) {
            var sb = siteBuckets[siteKey];
            var siteGph = sb.hours > 0 ? sb.goals / sb.hours : 0;
            // For site tiers, compute a site attainment relative to plan (use program-level plan pro-rated)
            var sitePlan = data.planGoals && data.totalHours > 0 ? (data.planGoals * (sb.hours / data.totalHours)) : null;
            var siteAtt = sitePlan && sitePlan > 0 ? (sb.goals / sitePlan) * 100 : null;
            var siteTier = siteAtt !== null ? getGainshareTier(siteAtt, true) : null;

            html += '<h6 style="font-size:0.82rem;color:var(--text-secondary);margin:1rem 0 0.5rem;">' + escHtml(siteKey) +
                ' &mdash; ' + sb.agents + ' agents, ' + safeNum(sb.hours, 1) + ' hrs, ' + safeInt(sb.goals) + ' sales, ' +
                safeNum(siteGph, 3) + ' GPH</h6>';
            html += buildGainshareTable(GAINSHARE_SITE_TIERS, siteTier);
        });
        html += '</div>';
    }

    $pane.html('<div class="fade-in">' + html + '</div>');
}

function buildGainshareTable(tiers, currentTier) {
    var html = '<table class="table table-sm mb-3">';
    html += '<thead><tr><th>Tier</th><th class="text-end">Mobile $</th><th class="text-end">HSD $</th><th class="text-end">Cost/Per $</th><th class="text-end">SPH $</th></tr></thead>';
    html += '<tbody>';

    tiers.forEach(function(t) {
        var isCurrent = currentTier && t.label === currentTier.label;
        var cls = '';
        if (isCurrent) {
            cls = 'gainshare-row current';
        } else if (t.mobile > 0) {
            cls = 'gainshare-row positive';
        } else if (t.mobile < 0) {
            cls = 'gainshare-row negative';
        }

        html += '<tr class="' + cls + '">';
        html += '<td>' + t.label + (isCurrent ? ' <span class="q-badge q3">CURRENT</span>' : '') + '</td>';
        html += '<td class="text-end font-data" style="color:' + bonusColor(t.mobile) + ';">' + formatMoney(t.mobile) + '</td>';
        html += '<td class="text-end font-data" style="color:' + bonusColor(t.hsd) + ';">' + formatMoney(t.hsd) + '</td>';
        html += '<td class="text-end font-data" style="color:' + bonusColor(t.costPer) + ';">' + formatMoney(t.costPer) + '</td>';
        html += '<td class="text-end font-data" style="color:' + bonusColor(t.sph) + ';">' + formatMoney(t.sph) + '</td>';
        html += '</tr>';
    });

    html += '</tbody></table>';
    return html;
}

function formatMoney(v) {
    if (v === 0) return '$0.00';
    var sign = v > 0 ? '+' : '';
    return sign + '$' + Math.abs(v).toFixed(2);
}

// ============================================================================
// SUB-TAB 4: PACING
// ============================================================================

function renderPacing(sel, data, id) {
    var $pane = $(sel);
    var fi = data.fiscalInfo;

    if (!fi) {
        $pane.html('<div class="text-center text-muted p-4">No fiscal calendar data available.</div>');
        return;
    }

    var html = '';

    // ── Primary pacing: Goals/Homes ────────────────────────────────────────
    var goalPacing = calcPacing(data.actGoals || 0, data.planGoals, fi.elapsedBDays, fi.totalBDays);

    html += '<div class="pacing-banner mb-4">';
    html += '<h6 class="text-amber mb-2" style="font-size:0.78rem;text-transform:uppercase;letter-spacing:0.06em;">Goal Pacing</h6>';

    if (goalPacing) {
        var projClr = attainColor(goalPacing.projectedPct);
        html += '<div class="row g-3 mb-3">';
        html += pacingStat('Daily Rate', safeNum(goalPacing.dailyRate, 2) + ' / day');
        html += pacingStat('Required Rate', goalPacing.requiredDaily !== null ? safeNum(goalPacing.requiredDaily, 2) + ' / day' : '\u2014');
        html += pacingStat('Projected EOM', safeInt(goalPacing.projected), projClr);
        html += pacingStat('Gap to Plan', (goalPacing.delta >= 0 ? '+' : '') + safeInt(goalPacing.delta), goalPacing.delta >= 0 ? '#16a34a' : '#dc2626');
        html += '</div>';

        // Progress bar
        var pctW = Math.min(goalPacing.projectedPct || 0, 100);
        html += '<div class="d-flex justify-content-between" style="font-size:0.75rem;color:var(--text-muted);">';
        html += '<span>0%</span><span style="color:' + projClr + ';font-weight:600;">' + safeNum(goalPacing.projectedPct, 1) + '% projected</span><span>100%</span>';
        html += '</div>';
        html += '<div class="progress"><div class="progress-bar" style="width:' + pctW + '%;"></div></div>';
    } else {
        html += '<p class="text-muted" style="font-size:0.85rem;">No plan data available for pacing calculation.</p>';
    }
    html += '</div>';

    // ── Fiscal info card ───────────────────────────────────────────────────
    html += '<div class="perf-card mb-4">';
    html += '<h6 class="text-amber mb-2" style="font-size:0.78rem;text-transform:uppercase;letter-spacing:0.06em;">Fiscal Period</h6>';
    html += '<div class="row g-3">';
    html += pacingStat('Start', fi.fiscalStart || '\u2014');
    html += pacingStat('End', fi.fiscalEnd || '\u2014');
    html += pacingStat('Elapsed Days', fi.elapsedBDays + ' / ' + fi.totalBDays + ' BD');
    html += pacingStat('% Elapsed', safeNum(fi.pctElapsed, 1) + '%');
    html += '</div></div>';

    // ── Per-metric pacing ──────────────────────────────────────────────────
    html += '<div class="perf-card mb-4">';
    html += '<h6 class="text-amber mb-3" style="font-size:0.78rem;text-transform:uppercase;letter-spacing:0.06em;">Per-Metric Pacing</h6>';
    html += '<table class="table table-sm table-hover mb-0">';
    html += '<thead><tr><th>Metric</th><th class="text-end">Plan</th><th class="text-end">Actual</th><th class="text-end">Daily Rate</th><th class="text-end">Projected</th><th class="text-end">Gap</th></tr></thead>';
    html += '<tbody>';

    GOAL_METRICS.forEach(function(m) {
        if (!m.actualKey) return;
        var plan = getGoalPlan(data.goalEntry, m.goalKey, m.mode);
        var actual = getActualFromData(data, m.actualKey);
        if (plan === null || plan <= 0) return;

        var pace = calcPacing(actual || 0, plan, fi.elapsedBDays, fi.totalBDays);
        if (!pace) return;

        var gapClr = pace.delta >= 0 ? '#16a34a' : '#dc2626';
        html += '<tr>';
        html += '<td>' + m.label + '</td>';
        html += '<td class="text-end font-data">' + fmtGoal(plan, m.fmt) + '</td>';
        html += '<td class="text-end font-data">' + fmtGoal(actual, m.fmt) + '</td>';
        html += '<td class="text-end font-data">' + safeNum(pace.dailyRate, 2) + '</td>';
        html += '<td class="text-end font-data">' + fmtGoal(pace.projected, m.fmt) + '</td>';
        html += '<td class="text-end font-data" style="color:' + gapClr + ';">' + (pace.delta >= 0 ? '+' : '') + safeInt(pace.delta) + '</td>';
        html += '</tr>';
    });

    html += '</tbody></table></div>';

    $pane.html('<div class="fade-in">' + html + '</div>');
}

function pacingStat(label, value, color) {
    return '<div class="col-md-3 col-sm-6 col-6">' +
        '<div style="font-size:0.72rem;color:var(--text-dim);text-transform:uppercase;letter-spacing:0.06em;">' + label + '</div>' +
        '<div class="font-data" style="font-size:1.1rem;font-weight:600;' + (color ? 'color:' + color + ';' : 'color:var(--text-warm);') + '">' + value + '</div>' +
        '</div>';
}

// ============================================================================
// SUB-TAB 5: DAILY
// ============================================================================

function renderDaily(sel, data, id) {
    var $pane = $(sel);
    var rollup = data.weeklyRollup;

    if (!rollup || !rollup.programWeekly || !rollup.programWeekly.length) {
        $pane.html('<div class="text-center text-muted p-4">No daily/weekly data available.</div>');
        return;
    }

    var chartId = 'prog-' + id + '-dailyChart';
    var html = '<div class="chart-container mb-4" id="' + chartId + '" style="min-height:350px;"></div>';

    // Weekly summary table
    html += '<div class="perf-card">';
    html += '<h6 class="text-amber mb-3" style="font-size:0.78rem;text-transform:uppercase;letter-spacing:0.06em;">Weekly Summary</h6>';
    html += '<table class="table table-sm table-striped table-hover mb-0">';
    html += '<thead><tr><th>Week</th><th class="text-end">Goals</th><th class="text-end">Hours</th><th class="text-end">GPH</th><th class="text-end">Agents</th></tr></thead>';
    html += '<tbody>';

    rollup.programWeekly.forEach(function(w) {
        html += '<tr>';
        html += '<td>Wk ' + w.week + '</td>';
        html += '<td class="text-end font-data">' + safeInt(w.goals) + '</td>';
        html += '<td class="text-end font-data">' + safeNum(w.hours, 1) + '</td>';
        html += '<td class="text-end font-data">' + safeNum(w.gph, 3) + '</td>';
        html += '<td class="text-end font-data">' + (w.agentCount || 0) + '</td>';
        html += '</tr>';
    });

    html += '</tbody></table></div>';
    $pane.html('<div class="fade-in">' + html + '</div>');

    // Build chart data from weekly rollup
    var chartData = [];
    rollup.programWeekly.forEach(function(w) {
        chartData.push({ Key: 'Goals', Date: 'Week ' + w.week, Value: w.goals || 0 });
        chartData.push({ Key: 'GPH x100', Date: 'Week ' + w.week, Value: (w.gph || 0) * 100 });
    });

    if (chartData.length > 0) {
        try {
            gcs.chart.buildMultiLineChartData({
                target: '#' + chartId,
                title: 'Weekly Trends',
                data: chartData,
                key: 'Key',
                x: 'Date',
                xDate: false,
                y: 'Value',
                showLegend: true
            });
        } catch (e) {
            $('#' + chartId).html('<div class="text-muted text-center p-3">Chart rendering unavailable.</div>');
        }
    }
}

// ============================================================================
// SUB-TAB 6: TEAMS (Supervisor Cards)
// ============================================================================

function renderTeams(sel, data, id) {
    var $pane = $(sel);
    var sups = data.supervisorStats || [];

    if (!sups.length) {
        $pane.html('<div class="text-center text-muted p-4">No supervisor data available.</div>');
        return;
    }

    var weeklyBySup = (data.weeklyRollup && data.weeklyRollup.bySupervisor) || {};
    var html = '<div class="row g-3">';

    sups.forEach(function(s, idx) {
        var collapseId = 'sup-agents-' + id + '-' + idx;
        var q1Rate = s.q1Rate !== undefined ? Number(s.q1Rate).toFixed(1) + '%' : '\u2014';

        html += '<div class="col-md-6 col-lg-4">';
        html += '<div class="supervisor-card">';

        // Header
        html += '<div class="d-flex justify-content-between align-items-start mb-2">';
        html += '<div>';
        html += '<div style="font-size:0.9rem;font-weight:600;color:var(--text-warm);">' + escHtml(s.supervisor) + '</div>';
        html += '<div style="font-size:0.72rem;color:var(--text-dim);">' + s.uNames + ' agents</div>';
        html += '</div>';

        // Sparkline
        var wkData = weeklyBySup[s.supervisor];
        if (wkData && wkData.length >= 2) {
            var points = wkData.map(function(w) { return w.gph || 0; });
            html += '<div class="sparkline-area">' + buildSparklineSVG(points) + ' ' + trendArrow(points) + '</div>';
        }
        html += '</div>';

        // Stats row
        html += '<div class="d-flex gap-3 mb-2" style="font-size:0.8rem;">';
        html += '<div><span style="color:var(--text-dim);">Goals:</span> <span class="font-data">' + safeInt(s.totalGoals) + '</span></div>';
        html += '<div><span style="color:var(--text-dim);">GPH:</span> <span class="font-data">' + safeNum(s.gph, 3) + '</span></div>';
        html += '<div><span style="color:var(--text-dim);">Q1:</span> <span class="font-data" style="color:#16a34a;">' + q1Rate + '</span></div>';
        html += '</div>';

        // Quartile distribution bar
        var distU = s.distU || {};
        var total = (distU.Q1 || 0) + (distU.Q2 || 0) + (distU.Q3 || 0) + (distU.Q4 || 0);
        if (total > 0) {
            html += '<div class="d-flex" style="height:4px;border-radius:2px;overflow:hidden;margin-bottom:0.5rem;">';
            ['Q1','Q2','Q3','Q4'].forEach(function(q) {
                var pct = ((distU[q] || 0) / total) * 100;
                if (pct > 0) html += '<div style="width:' + pct + '%;background:' + Q_DEFS[q].color + ';"></div>';
            });
            html += '</div>';
        }

        // Collapsible agent list
        html += '<a class="text-muted" style="font-size:0.72rem;text-decoration:none;cursor:pointer;" data-bs-toggle="collapse" href="#' + collapseId + '">Show agents &#x25BC;</a>';
        html += '<div class="collapse mt-2" id="' + collapseId + '">';

        if (s.agentList && s.agentList.length) {
            html += '<table class="table table-sm mb-0" style="font-size:0.78rem;">';
            html += '<thead><tr><th>Agent</th><th class="text-end">Hours</th><th class="text-end">Goals</th><th class="text-center">Q</th></tr></thead><tbody>';
            s.agentList.forEach(function(a) {
                var q = a.quartile || 'Q4';
                html += '<tr>';
                html += '<td>' + escHtml(a.agentName) + '</td>';
                html += '<td class="text-end font-data">' + safeNum(a.totalHours, 1) + '</td>';
                html += '<td class="text-end font-data">' + safeInt(a.totalGoals) + '</td>';
                html += '<td class="text-center"><span class="q-badge ' + q.toLowerCase() + '">' + q + '</span></td>';
                html += '</tr>';
            });
            html += '</tbody></table>';
        }
        html += '</div>'; // collapse

        html += '</div></div>'; // supervisor-card, col
    });

    html += '</div>';
    $pane.html('<div class="fade-in">' + html + '</div>');
}

// ============================================================================
// SUB-TAB 7: BY SITE
// ============================================================================

function renderBySite(sel, data, programName, id) {
    var $pane = $(sel);
    var regions = data.regions || [];

    if (!regions.length) {
        $pane.html('<div class="text-center text-muted p-4">No regional data available.</div>');
        return;
    }

    // Group regions into site buckets
    var siteBuckets = {};
    regions.forEach(function(r) {
        var site = REGION_TO_SITE[r.name] || 'Other';
        if (!siteBuckets[site]) siteBuckets[site] = { agents: 0, hours: 0, goals: 0, regions: [] };
        siteBuckets[site].agents += r.uniqueAgents || r.count;
        siteBuckets[site].hours += r.totalHours;
        siteBuckets[site].goals += r.totalGoals;
        siteBuckets[site].regions.push(r);
    });

    var html = '';
    var siteIdx = 0;

    Object.keys(siteBuckets).forEach(function(siteKey) {
        var sb = siteBuckets[siteKey];
        var siteGph = sb.hours > 0 ? sb.goals / sb.hours : 0;

        // Compute site attainment
        var sitePlan = data.planGoals && data.totalHours > 0 ? (data.planGoals * (sb.hours / data.totalHours)) : null;
        var siteAtt = sitePlan && sitePlan > 0 ? (sb.goals / sitePlan) * 100 : null;
        var siteTier = siteAtt !== null ? getGainshareTier(siteAtt, true) : null;

        html += '<div class="perf-card mb-4">';
        html += '<h6 class="text-amber mb-3" style="font-size:0.85rem;">' + escHtml(siteKey) + '</h6>';

        // Summary stats
        html += '<div class="row g-3 mb-3">';
        html += '<div class="col-md-3 col-6"><div class="stat-card"><div class="label">Agents</div><div class="value" style="font-size:1.1rem;">' + sb.agents + '</div></div></div>';
        html += '<div class="col-md-3 col-6"><div class="stat-card"><div class="label">Hours</div><div class="value" style="font-size:1.1rem;">' + safeNum(sb.hours, 1) + '</div></div></div>';
        html += '<div class="col-md-3 col-6"><div class="stat-card"><div class="label">Goals</div><div class="value" style="font-size:1.1rem;">' + safeInt(sb.goals) + '</div></div></div>';
        html += '<div class="col-md-3 col-6"><div class="stat-card"><div class="label">GPH</div><div class="value" style="font-size:1.1rem;">' + safeNum(siteGph, 3) + '</div></div></div>';
        html += '</div>';

        // Gainshare tier info
        if (siteAtt !== null) {
            html += '<div style="font-size:0.82rem;color:var(--text-secondary);margin-bottom:0.75rem;">Site Attainment: ' +
                '<strong style="color:' + attainColor(siteAtt) + ';">' + Number(siteAtt).toFixed(1) + '%</strong>';
            if (siteTier) {
                html += ' &mdash; Tier: ' + siteTier.label;
            }
            html += '</div>';
        }

        // Regions within this site
        sb.regions.forEach(function(r) {
            html += '<div style="font-size:0.78rem;color:var(--text-muted);margin-bottom:0.25rem;">' +
                escHtml(r.name) + ': ' + (r.uniqueAgents || r.count) + ' agents, ' +
                safeNum(r.totalHours, 1) + ' hrs, ' + safeInt(r.totalGoals) + ' sales, ' +
                safeNum(r.avgGPH, 3) + ' GPH</div>';
        });

        // Agent table container for this site
        var siteTableId = 'siteTbl-' + id + '-' + siteIdx;
        html += '<div id="' + siteTableId + '" class="mt-3"></div>';

        html += '</div>'; // perf-card
        siteIdx++;
    });

    $pane.html('<div class="fade-in">' + html + '</div>');

    // Now build the DataTables for each site
    siteIdx = 0;
    Object.keys(siteBuckets).forEach(function(siteKey) {
        var sb = siteBuckets[siteKey];
        var siteTableId = 'siteTbl-' + id + '-' + siteIdx;
        var regionNames = sb.regions.map(function(r) { return r.name; });

        gcs.bsdt({
            id: siteTableId,
            parent: '#' + siteTableId,
            url: '/JSON/get/program-detail.php',
            urlData: { program: programName },
            map: function(raw) {
                var agents = buildUniqueAgentList(raw);
                return agents.filter(function(a) {
                    return regionNames.indexOf(a.region) >= 0;
                });
            },
            columns: [
                { title: 'Agent', data: 'agentName', name: 'agentName' },
                { title: 'Region', data: 'region', name: 'region' },
                { title: 'Hours', data: 'hours', name: 'hours', className: 'text-end font-data',
                  render: function(d) { return safeNum(d, 1); } },
                { title: 'Sales', data: 'goals', name: 'goals', className: 'text-end font-data',
                  render: function(d) { return safeInt(d); } },
                { title: 'GPH', data: 'gph', name: 'gph', className: 'text-end font-data',
                  render: function(d) { return safeNum(d, 3); } },
                { title: 'Quartile', data: 'quartile', name: 'quartile', className: 'text-center',
                  render: function(d) {
                      var q = d || 'Q4';
                      var def = Q_DEFS[q] || Q_DEFS.Q4;
                      return '<span class="q-badge ' + q.toLowerCase() + '">' + def.badge + '</span>';
                  }
                }
            ],
            search: true,
            paging: false,
            responsive: true,
            growFull: false,
            title: siteKey + ' Agents'
        });

        siteIdx++;
    });
}

// ============================================================================
// SUB-TAB 8: GOALS
// ============================================================================

function renderGoals(sel, data, id) {
    var $pane = $(sel);
    var entries = data.goalEntries || [];

    if (!entries.length) {
        $pane.html('<div class="text-center text-muted p-4">No goal entries available for this program.</div>');
        return;
    }

    // Flatten goal entries: each entry has targetAudience and siteMap with rows
    var rows = [];
    entries.forEach(function(entry) {
        var ta = entry.targetAudience || '\u2014';
        var siteMap = entry.siteMap || {};
        Object.keys(siteMap).forEach(function(site) {
            var siteRows = siteMap[site] || [];
            siteRows.forEach(function(r) {
                rows.push({
                    targetAudience: ta,
                    site: site,
                    homesGoal:  parseFloat(r['HOMES GOAL'] || r['Homes Goal'] || 0) || 0,
                    rguGoal:    parseFloat(r['RGU GOAL'] || r['RGU Goal'] || 0) || 0,
                    hsdGoal:    parseFloat(r['HSD Sell In Goal'] || r['HSD GOAL'] || 0) || 0,
                    xmGoal:     parseFloat(r['XM GOAL'] || r['XM Goal'] || 0) || 0,
                    hoursGoal:  parseFloat(r['Hours Goal'] || r['HOURS GOAL'] || 0) || 0,
                    sphGoal:    parseFloat(r['SPH GOAL'] || r['SPH Goal'] || 0) || 0,
                    funding:    r['Funding'] || r['FUNDING'] || '\u2014',
                    roc:        r['ROC'] || r['ROC Code'] || '\u2014'
                });
            });
        });
    });

    if (!rows.length) {
        $pane.html('<div class="text-center text-muted p-4">No detailed goal rows found.</div>');
        return;
    }

    var tableId = 'goalsTbl-' + id;
    $pane.html('<div id="' + tableId + '"></div>');

    gcs.bsdt({
        id: tableId,
        parent: '#' + tableId,
        url: '/JSON/get/program-detail.php',
        urlData: { program: data.jobType },
        map: function(raw) {
            var flatRows = [];
            var ge = raw.goalEntries || [];
            ge.forEach(function(entry) {
                var ta = entry.targetAudience || '\u2014';
                var sm = entry.siteMap || {};
                Object.keys(sm).forEach(function(site) {
                    (sm[site] || []).forEach(function(r) {
                        flatRows.push({
                            targetAudience: ta,
                            site: site,
                            homesGoal:  parseFloat(r['HOMES GOAL'] || r['Homes Goal'] || 0) || 0,
                            rguGoal:    parseFloat(r['RGU GOAL'] || r['RGU Goal'] || 0) || 0,
                            hsdGoal:    parseFloat(r['HSD Sell In Goal'] || r['HSD GOAL'] || 0) || 0,
                            xmGoal:     parseFloat(r['XM GOAL'] || r['XM Goal'] || 0) || 0,
                            hoursGoal:  parseFloat(r['Hours Goal'] || r['HOURS GOAL'] || 0) || 0,
                            sphGoal:    parseFloat(r['SPH GOAL'] || r['SPH Goal'] || 0) || 0,
                            funding:    r['Funding'] || r['FUNDING'] || '\u2014',
                            roc:        r['ROC'] || r['ROC Code'] || '\u2014'
                        });
                    });
                });
            });
            return flatRows;
        },
        columns: [
            { title: 'Target Audience', data: 'targetAudience', name: 'targetAudience' },
            { title: 'Site', data: 'site', name: 'site' },
            { title: 'Homes Goal', data: 'homesGoal', name: 'homesGoal', className: 'text-end font-data',
              render: function(d) { return safeInt(d); } },
            { title: 'RGU Goal', data: 'rguGoal', name: 'rguGoal', className: 'text-end font-data',
              render: function(d) { return safeInt(d); } },
            { title: 'HSD Goal', data: 'hsdGoal', name: 'hsdGoal', className: 'text-end font-data',
              render: function(d) { return safeInt(d); } },
            { title: 'XM Goal', data: 'xmGoal', name: 'xmGoal', className: 'text-end font-data',
              render: function(d) { return safeInt(d); } },
            { title: 'Hours Goal', data: 'hoursGoal', name: 'hoursGoal', className: 'text-end font-data',
              render: function(d) { return safeNum(d, 1); } },
            { title: 'SPH Goal', data: 'sphGoal', name: 'sphGoal', className: 'text-end font-data',
              render: function(d) { return safeNum(d, 2); } },
            { title: 'Funding', data: 'funding', name: 'funding' },
            { title: 'ROC', data: 'roc', name: 'roc' }
        ],
        search: true,
        paging: false,
        responsive: true,
        growFull: false,
        title: 'Goal Entries'
    });
}

// ============================================================================
// SHARED DATA HELPERS
// ============================================================================

/**
 * Build a deduplicated agent list from program-detail response data.
 * Combines q1Agents + q2Agents + q3Agents + q4Agents.
 */
function buildUniqueAgentList(data) {
    var agents = [];
    var seen = {};

    ['q1Agents', 'q2Agents', 'q3Agents', 'q4Agents'].forEach(function(key) {
        var arr = data[key] || [];
        arr.forEach(function(a) {
            var name = a.agentName || a.name || '';
            if (name && !seen[name]) {
                seen[name] = true;
                agents.push({
                    agentName:  name,
                    region:     a.region || '',
                    hours:      a.hours || 0,
                    goals:      a.goals || 0,
                    gph:        a.gph || (a.hours > 0 ? a.goals / a.hours : 0),
                    pctToGoal:  a.pctToGoal !== undefined ? a.pctToGoal : null,
                    quartile:   a.quartile || 'Q4'
                });
            }
        });
    });

    // Sort by hours descending
    agents.sort(function(a, b) { return b.hours - a.hours; });
    return agents;
}

/**
 * Sum the plan value for a given goalKey from the combined goalEntry (siteMap).
 * For 'avg' mode metrics (like SPH/GPH), compute weighted average instead of sum.
 */
function getGoalPlan(goalEntry, goalKey, mode) {
    if (!goalEntry) return null;

    var total = 0;
    var count = 0;
    var found = false;

    Object.keys(goalEntry).forEach(function(site) {
        var rows = goalEntry[site] || [];
        rows.forEach(function(row) {
            // Try to find the value with various key normalizations
            var val = null;
            Object.keys(row).forEach(function(k) {
                if (k.toLowerCase().replace(/[\s_\-\/]+/g, ' ').trim() ===
                    goalKey.toLowerCase().replace(/[\s_\-\/]+/g, ' ').trim()) {
                    val = parseFloat(row[k]);
                }
            });
            if (val !== null && !isNaN(val) && val > 0) {
                found = true;
                total += val;
                count++;
            }
        });
    });

    if (!found) return null;

    if (mode === 'avg' && count > 0) {
        return total / count;
    }
    return total;
}

/**
 * Get actual value for a metric from the program data object.
 */
function getActualFromData(data, actualKey) {
    if (!actualKey) return null;

    switch (actualKey) {
        case 'hours':    return data.totalHours || 0;
        case 'gph':      return data.gph || 0;
        case 'goals':    return data.actGoals || data.totalGoals || 0;
        case 'rgu':      return data.totalRgu || 0;
        case 'newXI':    return data.totalNewXI !== undefined ? data.totalNewXI : null;
        case 'xmLines':  return data.totalXmLines !== undefined ? data.totalXmLines : null;
        case 'newVideo':return data.totalNewVideo !== undefined ? data.totalNewVideo : null;
        case 'newXH':    return data.totalNewXH !== undefined ? data.totalNewXH : null;
        default:         return null;
    }
}

/**
 * Escape HTML entities for safe rendering.
 */
function escHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
