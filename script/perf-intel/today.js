/**
 * today.js — Today View & TV Mode
 * Fetches live OTM data and displays real-time leaderboards, region breakdowns,
 * product mix, and a full-screen TV Mode with auto-cycling slides.
 * Ported from app.jsx lines 9551-11667.
 */

// ── External API Endpoints ────────────────────────────────────────────────────
var OTM_URL  = 'https://smart-gcs.com/otm2/JSON/get/OTM.php?grp=1&job=1&loc=1&reg=1&sup=0&agt=1&dir=0';
var CODE_URL = 'https://smart-gcs.com/otm2/JSON/get/Code.php';

// ── Goal Codes (disposition codes that count as sales) ────────────────────────
var GOAL_CODES = new Set(['420','600','601','602','603','604','605','625','626','627','628','696','706','714']);

// ── Region Colors ─────────────────────────────────────────────────────────────
var REG_COLORS = {
    'SD-Xfinity':       '#d97706',
    'Belize City-XOTM': '#6366f1',
    'OW-XOTM':          '#0891b2',
    'San Ignacio-XOTM': '#c026d3',
};

function getRegColor(reg) {
    return REG_COLORS[reg] || '#6366f1';
}

// ── Product Labels ────────────────────────────────────────────────────────────
var PRODUCT_LABELS = {
    '401': 'HBO MAX', '402': 'Showtime', '403': 'STARZ', '404': 'Cinemax',
    '405': 'The Movie Channel', '409': 'Latino Add On', '415': 'Easy Enroll',
    '417': 'Epix', '418': 'AutoPay', '419': 'No Upgrade Repackage',
    '432': 'Samsung Handset', '433': 'iPhone Handset', '434': 'LG Handset',
    '435': 'Motorola Handset', '436': 'BYOD Handset (XMC)', '437': 'Google Pixel',
    '438': 'Tablet', '439': 'Smart Watch', '440': 'Case', '441': 'Screen Protector',
    '442': 'Memory Card', '443': 'Portable Charger', '444': 'Charging Pad',
    '445': 'Charging Stand', '446': 'Wall Charger', '459': 'Sports & News Pack',
    '460': 'Kids & Family Pack', '461': 'Entertainment Pack',
    '462': 'More Sports & Entertainment', '463': 'Deportes Add On',
    '464': 'Scheduled Install', '465': 'Xfinity Flex', '466': 'SIK',
    '467': 'XH Consult', '468': 'xFi Complete', '469': 'XH Camera',
    '470': 'XH In-home Consult', '475': 'X1 HD/DVR', '481': 'Corrected Order',
    '482': 'Gateway Modem', '483': 'xCam', '484': 'Unlimited HSD',
    '486': 'Comcast Doorbell', '487': 'Comcast Smartlock', '488': 'Wifi Pass',
    '489': 'Premiums Add On', '490': 'Carefree World 300',
    '491': 'Carefree Latin America 300', '492': 'XM Device Upgrade',
    '493': 'Xumo Stream Box', '495': 'Streamsaver', '500': 'Choice TV',
    '501': 'Popular TV', '502': 'Ultimate TV', '503': 'NowTV',
    '504': 'Prepaid Video', '513': 'Prepaid HSD', '514': 'Xfinity Voice',
    '515': 'Pro Protection XH', '516': 'Pro Protection Plus XH',
    '517': 'Self Protection', '518': 'Unlimited Intro XM',
    '519': 'Unlimited Plus XM', '522': 'Unlimited Premium XM',
    '523': 'By The Gig XM', '524': 'Now XI 200', '525': 'Now XI 100',
    '550': '5 Year Price Lock', '551': 'NowTV Latino', '552': 'Next Gen 300MB HSD',
    '553': 'Next Gen 500MB HSD', '554': 'Next Gen Gig HSD', '555': 'Next Gen 2Gig HSD',
    '556': '1 Year Price Lock', '600': 'HSD Beyond Fast', '601': 'HSD Super Fast',
    '602': 'HSD Even Faster', '603': 'HSD', '604': 'HSD Fast', '605': 'HSD (605)',
    '610': 'Voice', '696': 'Cox Unlimited', '701': 'New Video', '702': 'New HSD',
    '703': 'New Phone', '704': 'New XH', '706': 'HSD Save RGU',
    '713': 'Tier Upgrade - Video', '714': 'Tier Upgrade - HSD',
    '715': 'Tier Upgrade - Phone', '716': 'Tier Upgrade - XH', '717': 'New Mobile',
    '725': 'Tier Upgrade - Mobile', '740': 'New NOW XI 100', '742': 'New NOW XI 200',
    '744': 'New NOW XM', '817': 'XM Protection Plan',
};

function prodLabel(cod, apiCodes) {
    return PRODUCT_LABELS[String(cod)] || (apiCodes && apiCodes[String(cod)]) || ('Code ' + cod);
}

// ── Derived codes ─────────────────────────────────────────────────────────────
var NEW_HSD_CODE    = '702';
var NEW_MOBILE_CODE = '717';

function deriveHsdXm(products) {
    return {
        hsd: Number(products[NEW_HSD_CODE]) || 0,
        xml: Number(products[NEW_MOBILE_CODE]) || 0,
    };
}

// ── Valid Regions ─────────────────────────────────────────────────────────────
var VALID_REGIONS = new Set(['SD-Xfinity', 'Belize City-XOTM', 'OW-XOTM', 'San Ignacio-XOTM']);
var ALLOWED_REGIONS = new Set([
    'Belize City-XOTM', 'OW-XOTM', 'SD-Xfinty', 'San Ignacio-XOTM',
    'SD-Xfinity', 'SD-Cox',
]);

var COST_PER_HOUR = 19.77;

// ── Module state ──────────────────────────────────────────────────────────────
var _todayState = {
    raw: null,
    codes: {},
    loading: false,
    error: null,
    lastRefresh: null,
    autoRefreshId: null,
    activeOnly: false,
    prevAgentHours: {},
    sortBy: 'hrs',
    sortDir: -1,
    lbRegion: 'All',
    lbJob: null,
    progSortBy: 'hrs',
    progSortDir: -1,
    progSiteFilter: null,
    bzSiteFilter: null,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function _fmtToday(v, dec) {
    if (dec === undefined) dec = 0;
    return dec > 0 ? Number(v).toFixed(dec) : Math.round(v).toLocaleString();
}

function _timeStr(d) {
    if (!d) return '\u2014';
    var today = new Date();
    var isToday = d.toDateString() === today.toDateString();
    var time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return isToday ? time : d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' + time;
}

function _goalColor(pct) {
    if (pct === null || pct === undefined) return 'var(--text-faint)';
    if (pct >= 100) return '#16a34a';
    if (pct >= 90)  return '#22c55e';
    if (pct >= 70)  return '#d97706';
    if (pct >= 50)  return '#ea580c';
    return '#dc2626';
}

function _cps(hrs, goals) {
    var val = goals > 0 ? (hrs * COST_PER_HOUR) / goals : hrs * COST_PER_HOUR;
    return '$' + Math.round(val).toLocaleString();
}

function _fixReg(r) {
    var t = (r || '?').trim();
    if (t === 'SD-Xfinty') return 'SD-Xfinity';
    if (t === 'SD-Cox') return 'SD-Xfinity';
    return t;
}

function _getSite(reg) {
    return (reg || '').toUpperCase().indexOf('XOTM') >= 0 ? 'BZ' : 'DR';
}

// ── Restore state from localStorage ──────────────────────────────────────────
function _restoreState() {
    try {
        var saved = localStorage.getItem('today_raw_data');
        if (saved) _todayState.raw = JSON.parse(saved);
    } catch (e) { /* ignore */ }
    try {
        var codes = localStorage.getItem('today_codes');
        if (codes) _todayState.codes = JSON.parse(codes);
    } catch (e) { /* ignore */ }
    try {
        var ts = localStorage.getItem('today_last_refresh');
        if (ts) _todayState.lastRefresh = new Date(ts);
    } catch (e) { /* ignore */ }
    try {
        var ph = localStorage.getItem('today_prev_agent_hours');
        if (ph) _todayState.prevAgentHours = JSON.parse(ph);
    } catch (e) { /* ignore */ }
}

function _persistState() {
    try {
        if (_todayState.raw) localStorage.setItem('today_raw_data', JSON.stringify(_todayState.raw));
        if (_todayState.codes && Object.keys(_todayState.codes).length > 0)
            localStorage.setItem('today_codes', JSON.stringify(_todayState.codes));
        if (_todayState.lastRefresh)
            localStorage.setItem('today_last_refresh', _todayState.lastRefresh.toISOString());
        if (_todayState.prevAgentHours && Object.keys(_todayState.prevAgentHours).length > 0)
            localStorage.setItem('today_prev_agent_hours', JSON.stringify(_todayState.prevAgentHours));
    } catch (e) { /* ignore */ }
}

// ── Data Fetch ────────────────────────────────────────────────────────────────
function fetchTodayData(cb) {
    if (_todayState.loading) return;
    _todayState.loading = true;
    _todayState.error = null;

    // Snapshot current agent hours before replacing (for active detection)
    if (_todayState.raw && Array.isArray(_todayState.raw)) {
        var hoursMap = {};
        _todayState.raw.forEach(function (r) {
            var name = (r.agt || '').trim();
            if (name) hoursMap[name] = (hoursMap[name] || 0) + (Number(r.hrs) || 0);
        });
        if (Object.keys(hoursMap).length > 0) _todayState.prevAgentHours = hoursMap;
    }

    var tryDirect = function () {
        return Promise.all([
            fetch(OTM_URL).then(function (r) { return r.json(); }),
            fetch(CODE_URL).then(function (r) { return r.json(); }),
        ]);
    };

    var tryProxy = function () {
        var proxy = function (u) { return 'https://corsproxy.io/?' + encodeURIComponent(u); };
        return Promise.all([
            fetch(proxy(OTM_URL)).then(function (r) { return r.json(); }),
            fetch(proxy(CODE_URL)).then(function (r) { return r.json(); }),
        ]);
    };

    tryDirect().catch(function () { return tryProxy(); }).then(function (results) {
        var otm = results[0];
        var cArr = results[1];
        if (!Array.isArray(otm)) throw new Error('Unexpected response format');
        var cMap = {};
        if (Array.isArray(cArr)) {
            cArr.forEach(function (c) { cMap[String(c.cod)] = c.nam; });
        }
        _todayState.codes = cMap;
        _todayState.raw = otm;
        _todayState.lastRefresh = new Date();
        _todayState.loading = false;
        _persistState();
        if (cb) cb(null);
    }).catch(function (e) {
        _todayState.loading = false;
        _todayState.error = e.message || 'Fetch failed';
        if (cb) cb(e);
    });
}

// ── Process raw OTM data into structured objects ──────────────────────────────
function _processData() {
    var raw = _todayState.raw;
    if (!raw || !Array.isArray(raw)) return null;

    // Filter to allowed regions; SD-Cox only if GL job
    var filtered = raw.filter(function (row) {
        var reg = (row.reg || '').trim();
        var job = String(row.job || '').trim().toUpperCase();
        var grp = String(row.grp || '').trim().toUpperCase();
        if (!ALLOWED_REGIONS.has(reg)) return false;
        if (reg === 'SD-Cox') return job.indexOf('GL') === 0;
        return job.indexOf('GS') !== 0 && grp.indexOf('COX') < 0;
    });

    // Per-unique-agent aggregate
    var agentMap = {};
    filtered.forEach(function (row) {
        var name = (row.agt || '').trim();
        if (!name) return;
        var grp = row.grp || '?';
        var regNorm = _fixReg(row.reg);
        if (!agentMap[name]) {
            agentMap[name] = {
                name: name, loc: row.loc || '?', reg: regNorm,
                grps: {}, hrs: 0, sal: 0, rgu: 0, goals: 0,
                products: {},
            };
        }
        var a = agentMap[name];
        a.hrs += Number(row.hrs) || 0;
        a.sal += Number(row.sal) || 0;
        a.rgu += Number(row.rgu) || 0;
        a.reg  = regNorm;
        a.grps[grp] = true;

        Object.keys(row).forEach(function (k) {
            var v = Number(row[k]);
            if (v > 0 && /^\d+$/.test(k)) {
                a.products[k] = (a.products[k] || 0) + v;
                if (GOAL_CODES.has(k)) a.goals += v;
            }
        });
    });

    var agents = [];
    Object.keys(agentMap).forEach(function (name) {
        var a = agentMap[name];
        var effectiveGoals = a.sal > 0 ? a.sal : a.goals;
        var derived = deriveHsdXm(a.products);
        agents.push({
            name: a.name, loc: a.loc, reg: a.reg,
            grps: a.grps, hrs: a.hrs, sal: a.sal, rgu: a.rgu,
            goals: a.goals, effectiveGoals: effectiveGoals,
            products: a.products, hsd: derived.hsd, xml: derived.xml,
            pctToGoal: null,
        });
    });

    // Active agent detection
    var hasPrevHours = Object.keys(_todayState.prevAgentHours).length > 0;
    var activeAgentNames = {};
    if (hasPrevHours) {
        agents.forEach(function (a) {
            var prevHrs = _todayState.prevAgentHours[a.name] || 0;
            if (a.hrs > prevHrs) activeAgentNames[a.name] = true;
        });
    }
    var allCount = agents.length;
    var activeCount = hasPrevHours ? Object.keys(activeAgentNames).length : agents.length;

    var displayAgents = _todayState.activeOnly && hasPrevHours
        ? agents.filter(function (a) { return activeAgentNames[a.name]; })
        : agents;

    var displayNames = {};
    displayAgents.forEach(function (a) { displayNames[a.name] = true; });

    // By region — from raw rows for correct attribution
    var displayFiltered = _todayState.activeOnly && hasPrevHours
        ? filtered.filter(function (row) { return displayNames[(row.agt || '').trim()]; })
        : filtered;

    var byReg = {};
    var byRegAgents = {};
    displayFiltered.forEach(function (row) {
        var r = _fixReg(row.reg);
        if (!VALID_REGIONS.has(r)) return;
        var nm = (row.agt || '').trim();
        if (!byReg[r]) {
            byReg[r] = { count: 0, hrs: 0, goals: 0, sal: 0, rgu: 0, products: {} };
            byRegAgents[r] = {};
        }
        byRegAgents[r][nm] = true;
        byReg[r].hrs += Number(row.hrs) || 0;
        byReg[r].sal += Number(row.sal) || 0;
        byReg[r].rgu += Number(row.rgu) || 0;
        Object.keys(row).forEach(function (k) {
            var v = Number(row[k]);
            if (v > 0 && /^\d+$/.test(k)) {
                byReg[r].products[k] = (byReg[r].products[k] || 0) + v;
                if (GOAL_CODES.has(k)) byReg[r].goals += v;
            }
        });
    });
    Object.keys(byReg).forEach(function (r) {
        var s = byReg[r];
        s.count = Object.keys(byRegAgents[r]).length;
        s.goals = s.sal > 0 ? s.sal : s.goals;
    });

    // By program/group
    var grpMap = {};
    displayFiltered.forEach(function (row) {
        var g = row.grp || 'Unknown';
        var regNorm = _fixReg(row.reg);
        var jobCode = (row.job || '').trim();
        var key = jobCode ? regNorm + '|' + jobCode : regNorm + '|' + g;
        if (!grpMap[key]) {
            grpMap[key] = { grp: g, loc: row.loc || '?', reg: regNorm, roc: jobCode, agts: {}, hrs: 0, sal: 0, goals: 0, rgu: 0, products: {} };
        }
        grpMap[key].agts[(row.agt || '').trim()] = true;
        grpMap[key].hrs += Number(row.hrs) || 0;
        grpMap[key].sal += Number(row.sal) || 0;
        grpMap[key].rgu += Number(row.rgu) || 0;
        Object.keys(row).forEach(function (k) {
            var v = Number(row[k]);
            if (v > 0 && /^\d+$/.test(k)) {
                grpMap[key].products[k] = (grpMap[key].products[k] || 0) + v;
                if (GOAL_CODES.has(k)) grpMap[key].goals += v;
            }
        });
    });

    var programs = [];
    Object.keys(grpMap).forEach(function (key) {
        var p = grpMap[key];
        var effectiveGoals = p.sal > 0 ? p.sal : p.goals;
        var derived = deriveHsdXm(p.products);
        programs.push({
            grp: p.grp, loc: p.loc, reg: p.reg, roc: p.roc,
            agts: p.agts, agentCount: Object.keys(p.agts).length,
            hrs: p.hrs, sal: p.sal, rgu: p.rgu,
            goals: p.goals, effectiveGoals: effectiveGoals,
            products: p.products, hsd: derived.hsd, xml: derived.xml,
            pctToGoal: null,
        });
    });
    programs.sort(function (a, b) { return b.hrs - a.hrs; });

    // Unique regions
    var uniqueRegsSet = {};
    displayAgents.forEach(function (a) { uniqueRegsSet[a.reg] = true; });
    var uniqueRegs = Object.keys(uniqueRegsSet).sort();

    // Product totals
    var productTotals = {};
    displayAgents.forEach(function (a) {
        Object.keys(a.products).forEach(function (k) {
            productTotals[k] = (productTotals[k] || 0) + a.products[k];
        });
    });

    return {
        agents: displayAgents,
        totalHrs:   displayAgents.reduce(function (s, a) { return s + a.hrs; }, 0),
        totalGoals: displayAgents.reduce(function (s, a) { return s + a.effectiveGoals; }, 0),
        totalSal:   displayAgents.reduce(function (s, a) { return s + a.sal; }, 0),
        totalRgu:   displayAgents.reduce(function (s, a) { return s + a.rgu; }, 0),
        presentCount: displayAgents.length,
        activeCount: activeCount,
        allCount: allCount,
        byReg: byReg,
        programs: programs,
        productTotals: productTotals,
        uniqueRegs: uniqueRegs,
    };
}

// ── Sort agents ──────────────────────────────────────────────────────────────
function _sortedAgents(d) {
    if (!d) return [];
    var list = d.agents;
    if (_todayState.lbRegion !== 'All') {
        list = list.filter(function (a) { return a.reg === _todayState.lbRegion; });
    }
    if (_todayState.lbJob) {
        list = list.filter(function (a) { return a.grps[_todayState.lbJob]; });
    }
    var sortBy = _todayState.sortBy;
    var sortDir = _todayState.sortDir;
    return list.slice().sort(function (a, b) {
        var key = sortBy === 'goals' ? 'effectiveGoals' : sortBy;
        return ((a[key] || 0) - (b[key] || 0)) * sortDir;
    });
}

// ── Sort programs ────────────────────────────────────────────────────────────
function _sortedPrograms(d) {
    if (!d) return [];
    var list = d.programs;
    var sf = _todayState.progSiteFilter;
    if (sf) {
        list = list.filter(function (p) {
            var isBZ = (p.reg || '').toUpperCase().indexOf('XOTM') >= 0;
            if (sf === 'BZ') {
                if (_todayState.bzSiteFilter) return isBZ && p.reg === _todayState.bzSiteFilter;
                return isBZ;
            }
            return !isBZ;
        });
    }
    var sortBy = _todayState.progSortBy;
    var sortDir = _todayState.progSortDir;
    return list.slice().sort(function (a, b) {
        var va, vb;
        if (sortBy === 'grp') return sortDir * a.grp.localeCompare(b.grp);
        if (sortBy === 'roc') return sortDir * (a.roc || '').localeCompare(b.roc || '');
        if (sortBy === 'reg') return sortDir * (a.reg || '').localeCompare(b.reg || '');
        if (sortBy === 'agentCount') { va = a.agentCount; vb = b.agentCount; }
        else if (sortBy === 'hrs') { va = a.hrs; vb = b.hrs; }
        else if (sortBy === 'goals') { va = a.effectiveGoals; vb = b.effectiveGoals; }
        else if (sortBy === 'gph') { va = a.hrs > 0 ? a.effectiveGoals / a.hrs : 0; vb = b.hrs > 0 ? b.effectiveGoals / b.hrs : 0; }
        else if (sortBy === 'cps') { va = a.effectiveGoals > 0 ? (a.hrs * COST_PER_HOUR) / a.effectiveGoals : a.hrs * COST_PER_HOUR; vb = b.effectiveGoals > 0 ? (b.hrs * COST_PER_HOUR) / b.effectiveGoals : b.hrs * COST_PER_HOUR; }
        else if (sortBy === 'rgu') { va = a.rgu || 0; vb = b.rgu || 0; }
        else { va = a[sortBy] || 0; vb = b[sortBy] || 0; }
        return ((va || 0) - (vb || 0)) * sortDir;
    });
}

// ══════════════════════════════════════════════════════════════════════════════
// RENDER: Today View
// ══════════════════════════════════════════════════════════════════════════════

function renderToday() {
    var $tab = $('#tab-today');
    $tab.html('<div class="text-center p-5"><div class="spinner-border text-warning"></div><div class="mt-2" style="font-size:0.85rem;color:var(--text-dim);">Checking connection...</div></div>');

    // Initialize global namespace
    window.PERF = window.PERF || {};
    window.PERF.todayData = null;

    _restoreState();

    // If we have cached data, render immediately then refresh in background
    if (_todayState.raw) {
        _renderTodayView($tab);
    }

    // Fetch fresh data
    fetchTodayData(function (err) {
        if (err && !_todayState.raw) {
            _renderPasteMode($tab);
        } else {
            _renderTodayView($tab);
        }
    });

    // Auto-refresh every 5 minutes
    if (_todayState.autoRefreshId) clearInterval(_todayState.autoRefreshId);
    _todayState.autoRefreshId = setInterval(function () {
        fetchTodayData(function () {
            _renderTodayView($tab);
        });
    }, 5 * 60 * 1000);
}

// ── Paste Mode (fallback when CORS blocks fetch) ─────────────────────────────
function _renderPasteMode($tab) {
    var html =
        '<div style="min-height:80vh;padding:3rem 2.5rem;">' +
            '<div style="max-width:640px;margin:0 auto;">' +
                '<div style="font-size:0.82rem;color:#16a34a;letter-spacing:0.15em;text-transform:uppercase;margin-bottom:0.5rem;">Today\'s Operations -- Manual Data Load</div>' +
                '<div style="font-size:2.5rem;color:var(--text-warm);font-weight:700;margin-bottom:1.5rem;">Paste Live Data</div>' +

                '<div class="perf-card mb-3">' +
                    '<div style="font-size:0.8rem;color:var(--text-muted);letter-spacing:0.1em;text-transform:uppercase;margin-bottom:1rem;">Step 1 -- Open the live data URL</div>' +
                    '<a href="' + OTM_URL + '" target="_blank" rel="noreferrer" class="btn btn-sm" style="background:#16a34a18;border:1px solid #16a34a55;color:#16a34a;margin-bottom:0.5rem;">' +
                        'Open OTM Data Feed' +
                    '</a>' +
                    '<div style="font-size:0.82rem;color:var(--text-faint);margin-top:0.5rem;">This opens the live data in a new tab. You\'ll see raw JSON text.</div>' +
                '</div>' +

                '<div class="perf-card mb-3">' +
                    '<div style="font-size:0.8rem;color:var(--text-muted);letter-spacing:0.1em;text-transform:uppercase;margin-bottom:1rem;">Step 2 -- Copy & paste the data here</div>' +
                    '<div style="font-size:0.82rem;color:var(--text-muted);margin-bottom:0.75rem;">' +
                        'Press <kbd>Ctrl+A</kbd> then <kbd>Ctrl+C</kbd> to copy everything, then paste below.' +
                    '</div>' +
                    '<textarea id="todayPasteArea" class="form-control" rows="5" placeholder=\'Paste JSON here... (starts with [{&quot;agt&quot;:...)\' style="font-size:0.8rem;resize:vertical;"></textarea>' +
                    '<div id="todayPasteError" class="text-danger mt-2" style="font-size:0.82rem;display:none;"></div>' +
                    '<button id="btnTodayPasteLoad" class="btn btn-sm mt-2" style="background:#16a34a18;border:1px solid #16a34a;color:#16a34a;">Load Data</button>' +
                '</div>' +

                '<div style="font-size:0.8rem;color:var(--text-faint);text-align:center;">Direct fetch is blocked in this environment. Pasting the data works identically.</div>' +
            '</div>' +
        '</div>';

    $tab.html(html);

    $('#btnTodayPasteLoad').on('click', function () {
        var text = $('#todayPasteArea').val().trim();
        if (!text) return;
        try {
            var parsed = JSON.parse(text);
            if (!Array.isArray(parsed)) throw new Error('Expected a JSON array.');
            _todayState.raw = parsed;
            _todayState.lastRefresh = new Date();
            _persistState();
            _renderTodayView($tab);
        } catch (e) {
            $('#todayPasteError').text(e.message).show();
        }
    });
}

// ── Main Today View Renderer ─────────────────────────────────────────────────
function _renderTodayView($tab) {
    var d = _processData();
    if (!d) {
        _renderPasteMode($tab);
        return;
    }

    window.PERF = window.PERF || {};
    window.PERF.todayData = d;

    var now = _timeStr(_todayState.lastRefresh);
    var activeOnly = _todayState.activeOnly;
    var hasPrev = Object.keys(_todayState.prevAgentHours).length > 0;

    // ── Build HTML ───────────────────────────────────────────────────────
    var html = '<div style="padding:2rem 2.5rem;padding-bottom:4rem;">';

    // Header
    html +=
        '<div class="d-flex justify-content-between align-items-center mb-4">' +
            '<div>' +
                '<div style="font-size:0.82rem;color:#16a34a;letter-spacing:0.15em;text-transform:uppercase;margin-bottom:0.25rem;">' +
                    '&#9679; LIVE &middot; auto-refreshes every 5 min &middot; last loaded ' + now +
                '</div>' +
                '<div style="font-size:2.5rem;color:var(--text-warm);font-weight:700;">Today\'s Operations</div>' +
            '</div>' +
            '<div class="d-flex flex-column gap-2 align-items-end">' +
                '<button id="btnTVMode" class="btn" style="background:#6366f110;border:1px solid #6366f140;border-radius:6px;color:#6366f1;padding:0.5rem 1.25rem;font-size:1.1rem;font-weight:700;width:100%;display:flex;align-items:center;justify-content:center;gap:0.5rem;">' +
                    '<span style="font-size:1.6rem;line-height:1;">&#128250;</span> TV Mode' +
                '</button>' +
                '<button id="btnTodayRefresh" class="btn btn-sm" style="background:transparent;border:1px solid var(--text-faint);border-radius:6px;color:var(--text-muted);padding:0.4rem 1rem;font-size:0.8rem;width:100%;">' +
                    '&#10227; Refresh Data' +
                '</button>' +
            '</div>' +
        '</div>';

    // Active/All toggle bar
    html +=
        '<div class="d-flex justify-content-between align-items-center mb-2">' +
            '<div style="font-size:0.72rem;color:' + (activeOnly ? '#d97706' : 'var(--text-faint)') + ';letter-spacing:0.08em;">' +
                (activeOnly ? 'Showing agents whose hours increased since last refresh (currently dialing)' : 'Showing all agents with data today') +
                (!hasPrev ? ' -- needs one refresh cycle to detect active' : '') +
            '</div>' +
            '<div class="d-inline-flex" style="border-radius:6px;border:1px solid var(--border);overflow:hidden;">' +
                '<button class="btn btn-sm today-toggle-btn' + (!activeOnly ? ' today-toggle-active-all' : '') + '" data-mode="all" style="border:none;font-size:0.75rem;padding:0.3rem 0.7rem;">' +
                    'All Agents (' + d.allCount + ')' +
                '</button>' +
                '<button class="btn btn-sm today-toggle-btn' + (activeOnly ? ' today-toggle-active-on' : '') + '" data-mode="active" style="border:none;border-left:1px solid var(--border);font-size:0.75rem;padding:0.3rem 0.7rem;">' +
                    'Active' + (hasPrev ? ' (' + d.activeCount + ')' : '') +
                '</button>' +
            '</div>' +
        '</div>';

    // Pulse cards
    var gphPace = d.totalHrs > 0 ? (d.totalGoals / d.totalHrs).toFixed(3) : '0';
    var cards = [
        { v: d.presentCount, l: activeOnly ? 'Active' : 'On Floor', c: '#16a34a' },
        { v: _fmtToday(d.totalHrs, 1), l: 'Hours Today', c: '#6366f1' },
        { v: d.totalGoals || 0, l: 'Sales Today', c: '#d97706' },
        { v: d.totalRgu || '\u2014', l: 'RGU', c: '#2563eb' },
        { v: d.totalGoals > 0 ? gphPace : '\u2014', l: 'GPH Pace', c: '#16a34a' },
    ];
    html += '<div class="row g-2 mb-3">';
    cards.forEach(function (card) {
        html +=
            '<div class="col">' +
                '<div class="perf-card text-center" style="border:1px solid ' + card.c + '22;padding:1rem;">' +
                    '<div style="font-size:2.5rem;color:' + card.c + ';font-weight:700;line-height:1;">' + card.v + '</div>' +
                    '<div style="font-size:0.82rem;color:' + card.c + ';margin-top:0.2rem;">' + card.l + '</div>' +
                '</div>' +
            '</div>';
    });
    html += '</div>';

    // ── By Region + Product Mix side by side ──────────────────────────────
    html += '<div class="row g-3 mb-3">';

    // By Region
    html += '<div class="col-md-6"><div class="perf-card" style="padding:1.25rem;">';
    html += '<div style="font-size:0.8rem;color:var(--text-muted);letter-spacing:0.12em;text-transform:uppercase;margin-bottom:1rem;">By Region -- Live</div>';
    var regKeys = Object.keys(d.byReg).sort();
    regKeys.forEach(function (reg) {
        var s = d.byReg[reg];
        var gph = s.hrs > 0 ? s.goals / s.hrs : 0;
        var regColor = getRegColor(reg);
        html +=
            '<div style="padding:0.85rem 1rem;background:var(--bg-primary);border-radius:10px;border:1px solid ' + regColor + '22;margin-bottom:0.6rem;">' +
                '<div class="d-flex justify-content-between align-items-center mb-2">' +
                    '<span style="font-size:1.1rem;color:' + regColor + ';font-weight:600;">' + reg + '</span>' +
                    '<span style="font-size:0.82rem;color:var(--text-muted);">' + s.count + ' agents</span>' +
                '</div>' +
                '<div style="display:grid;grid-template-columns:repeat(4, 1fr);gap:0.5rem;">';
        var metrics = [
            { l: 'Hours', v: _fmtToday(s.hrs, 1), c: '#6366f1' },
            { l: 'Sales', v: s.goals || '\u2014', c: '#d97706' },
            { l: 'GPH',   v: s.goals > 0 ? gph.toFixed(3) : '\u2014', c: '#16a34a' },
            { l: 'RGU',   v: s.rgu || '\u2014', c: '#2563eb' },
        ];
        metrics.forEach(function (m) {
            html +=
                '<div style="text-align:center;">' +
                    '<div style="font-size:1.1rem;color:' + m.c + ';font-weight:600;">' + m.v + '</div>' +
                    '<div style="font-size:0.78rem;color:var(--text-dim);">' + m.l + '</div>' +
                '</div>';
        });
        html += '</div>';

        // Product chips for this region
        var prodEntries = Object.keys(s.products).map(function (k) { return [k, s.products[k]]; }).sort(function (a, b) { return b[1] - a[1]; });
        if (prodEntries.length > 0) {
            html += '<div class="d-flex flex-wrap gap-1 mt-2">';
            prodEntries.forEach(function (e) {
                html +=
                    '<span style="font-size:0.78rem;padding:0.1rem 0.35rem;border-radius:3px;background:#6366f108;border:1px solid #6366f120;color:#6366f1aa;" title="' + prodLabel(e[0], _todayState.codes) + ': ' + e[1] + '">' +
                        prodLabel(e[0], _todayState.codes) + ': ' + e[1] +
                    '</span>';
            });
            html += '</div>';
        }
        html += '</div>';
    });
    html += '</div></div>';

    // Product mix totals
    html += '<div class="col-md-6"><div class="perf-card" style="padding:1.25rem;">';
    html += '<div style="font-size:0.8rem;color:var(--text-muted);letter-spacing:0.12em;text-transform:uppercase;margin-bottom:1rem;">Product Mix Today</div>';
    var prodEntries = Object.keys(d.productTotals).map(function (k) { return [k, d.productTotals[k]]; }).sort(function (a, b) { return b[1] - a[1]; });
    if (prodEntries.length > 0) {
        html += '<div class="d-flex flex-wrap gap-1">';
        prodEntries.forEach(function (e) {
            html +=
                '<div style="font-size:0.8rem;padding:0.15rem 0.5rem;border-radius:3px;background:#6366f112;border:1px solid #6366f130;color:#6366f1;">' +
                    prodLabel(e[0], _todayState.codes) + ': ' + e[1] +
                '</div>';
        });
        html += '</div>';
    } else {
        html += '<div style="font-size:0.82rem;color:var(--text-faint);">No product data yet.</div>';
    }
    html += '</div></div>';

    html += '</div>'; // end row

    // ── Programs breakdown ──────────────────────────────────────────────
    html += '<div class="perf-card mb-3" style="padding:1.25rem;">';
    html += '<div class="d-flex justify-content-between align-items-center mb-3">';
    html += '<div style="font-size:0.8rem;color:var(--text-muted);letter-spacing:0.12em;text-transform:uppercase;">Performance by Campaign &middot; by Site</div>';
    html += '</div>';

    // Site filter tabs
    var uniqueProgRegs = {};
    d.programs.forEach(function (p) { uniqueProgRegs[p.reg] = true; });
    var allProgRegs = Object.keys(uniqueProgRegs).sort();
    var bzRegs = allProgRegs.filter(function (r) { return r.toUpperCase().indexOf('XOTM') >= 0; });
    var drRegs = allProgRegs.filter(function (r) { return r.toUpperCase().indexOf('XOTM') < 0; });

    if (bzRegs.length > 0 && drRegs.length > 0) {
        html += '<div class="d-flex flex-wrap gap-1 mb-3">';
        html += '<button class="btn btn-sm today-site-btn' + (!_todayState.progSiteFilter ? ' active' : '') + '" data-site="">All Sites</button>';
        if (drRegs.length > 0) html += '<button class="btn btn-sm today-site-btn' + (_todayState.progSiteFilter === 'DR' ? ' active' : '') + '" data-site="DR">DR</button>';
        if (bzRegs.length > 0) html += '<button class="btn btn-sm today-site-btn' + (_todayState.progSiteFilter === 'BZ' ? ' active' : '') + '" data-site="BZ">BZ</button>';
        html += '</div>';
    }

    // Program table
    var sortedProgs = _sortedPrograms(d);
    html += '<div style="overflow-x:auto;"><table class="table table-sm" style="font-size:0.8rem;white-space:nowrap;">';
    html += '<thead><tr style="border-bottom:2px solid var(--border);">';
    var progCols = [
        { k: 'grp', l: 'Program' }, { k: 'roc', l: 'ROC' }, { k: 'reg', l: 'Region' },
        { k: 'agentCount', l: 'Agents', r: true }, { k: 'hrs', l: 'Hours', r: true },
        { k: 'goals', l: 'Sales', r: true }, { k: 'gph', l: 'GPH', r: true },
        { k: 'cps', l: 'CPS', r: true }, { k: 'rgu', l: 'RGU', r: true },
    ];
    progCols.forEach(function (col) {
        var active = _todayState.progSortBy === col.k;
        var arrow = active ? (_todayState.progSortDir === -1 ? ' \u2193' : ' \u2191') : '';
        html += '<th class="today-sort-th" data-sort-type="prog" data-sort-key="' + col.k + '" style="padding:0.4rem 0.75rem;text-align:' + (col.r ? 'right' : 'left') + ';font-weight:400;color:' + (active ? '#d97706' : 'var(--text-dim)') + ';cursor:pointer;user-select:none;">' + col.l + arrow + '</th>';
    });
    html += '</tr></thead><tbody>';

    sortedProgs.forEach(function (p, i) {
        var eg = p.effectiveGoals;
        var gph = p.hrs > 0 ? eg / p.hrs : 0;
        var regColor = getRegColor(p.reg);
        html +=
            '<tr style="border-bottom:1px solid var(--bg-tertiary);background:' + (i % 2 === 0 ? 'transparent' : 'var(--bg-row-alt)') + ';">' +
                '<td style="padding:0.4rem 0.75rem;color:var(--text-primary);">' + p.grp + '</td>' +
                '<td style="padding:0.4rem 0.75rem;color:var(--text-dim);font-size:0.78rem;">' + (p.roc || '\u2014') + '</td>' +
                '<td style="padding:0.4rem 0.75rem;">' +
                    '<span style="background:' + regColor + '18;border:1px solid ' + regColor + '40;border-radius:3px;color:' + regColor + ';padding:0.1rem 0.35rem;">' + p.reg + '</span>' +
                '</td>' +
                '<td style="padding:0.4rem 0.75rem;color:var(--text-secondary);text-align:right;">' + p.agentCount + '</td>' +
                '<td style="padding:0.4rem 0.75rem;color:#6366f1;text-align:right;">' + _fmtToday(p.hrs, 2) + '</td>' +
                '<td style="padding:0.4rem 0.75rem;color:' + (eg > 0 ? '#d97706' : 'var(--text-faint)') + ';text-align:right;">' + (eg || '\u2014') + '</td>' +
                '<td style="padding:0.4rem 0.75rem;color:' + (eg > 0 ? '#16a34a' : 'var(--text-faint)') + ';text-align:right;">' + (eg > 0 ? gph.toFixed(3) : '\u2014') + '</td>' +
                '<td style="padding:0.4rem 0.75rem;color:var(--text-secondary);text-align:right;">' + _cps(p.hrs, eg) + '</td>' +
                '<td style="padding:0.4rem 0.75rem;color:' + (p.rgu > 0 ? '#2563eb' : 'var(--text-faint)') + ';text-align:right;">' + (p.rgu || '\u2014') + '</td>' +
            '</tr>';
    });

    // Programs footer
    var ptHrs = sortedProgs.reduce(function (s, p) { return s + p.hrs; }, 0);
    var ptGoals = sortedProgs.reduce(function (s, p) { return s + p.effectiveGoals; }, 0);
    var ptRgu = sortedProgs.reduce(function (s, p) { return s + (p.rgu || 0); }, 0);
    var ptAgents = sortedProgs.reduce(function (s, p) { return s + p.agentCount; }, 0);
    var ptGph = ptHrs > 0 ? ptGoals / ptHrs : 0;
    html += '</tbody><tfoot>';
    html +=
        '<tr style="border-top:2px solid var(--border);background:var(--bg-row-alt);">' +
            '<td style="padding:0.5rem 0.75rem;color:var(--text-warm);font-weight:700;">TOTAL</td>' +
            '<td></td><td></td>' +
            '<td style="padding:0.5rem 0.75rem;color:var(--text-warm);text-align:right;font-weight:700;">' + ptAgents + '</td>' +
            '<td style="padding:0.5rem 0.75rem;color:#6366f1;text-align:right;font-weight:700;">' + _fmtToday(ptHrs, 2) + '</td>' +
            '<td style="padding:0.5rem 0.75rem;color:' + (ptGoals > 0 ? '#d97706' : 'var(--text-faint)') + ';text-align:right;font-weight:700;">' + (ptGoals || '\u2014') + '</td>' +
            '<td style="padding:0.5rem 0.75rem;color:' + (ptGoals > 0 ? '#16a34a' : 'var(--text-faint)') + ';text-align:right;font-weight:700;">' + (ptGoals > 0 ? ptGph.toFixed(3) : '\u2014') + '</td>' +
            '<td style="padding:0.5rem 0.75rem;color:var(--text-secondary);text-align:right;font-weight:700;">' + _cps(ptHrs, ptGoals) + '</td>' +
            '<td style="padding:0.5rem 0.75rem;color:' + (ptRgu > 0 ? '#2563eb' : 'var(--text-faint)') + ';text-align:right;font-weight:700;">' + (ptRgu || '\u2014') + '</td>' +
        '</tr>';
    html += '</tfoot></table></div>';
    html += '</div>';

    // ── Agent leaderboard ──────────────────────────────────────────────
    html += '<div class="perf-card" style="padding:1.25rem;">';
    var sorted = _sortedAgents(d);
    html += '<div class="d-flex justify-content-between align-items-center mb-3 flex-wrap gap-2">';
    html += '<div style="font-size:0.8rem;color:var(--text-muted);letter-spacing:0.12em;text-transform:uppercase;">' +
        'Agent Leaderboard &middot; ' + sorted.length + ' ' +
        (_todayState.lbRegion === 'All' ? (_todayState.lbJob ? 'in ' + _todayState.lbJob : (activeOnly ? 'active now' : 'today')) : 'in ' + _todayState.lbRegion) +
        '</div>';
    html += '<div class="d-inline-flex" style="border-radius:6px;border:1px solid var(--border);overflow:hidden;">';
    html += '<button class="btn btn-sm today-toggle-btn' + (!activeOnly ? ' today-toggle-active-all' : '') + '" data-mode="all" style="border:none;font-size:0.72rem;padding:0.25rem 0.6rem;">All (' + d.allCount + ')</button>';
    html += '<button class="btn btn-sm today-toggle-btn' + (activeOnly ? ' today-toggle-active-on' : '') + '" data-mode="active" style="border:none;border-left:1px solid var(--border);font-size:0.72rem;padding:0.25rem 0.6rem;">Active' + (hasPrev ? ' (' + d.activeCount + ')' : '') + '</button>';
    html += '</div></div>';

    // Region selector
    html += '<div class="d-flex flex-wrap gap-1 mb-2">';
    var regOptions = ['All'].concat(d.uniqueRegs);
    regOptions.forEach(function (r) {
        var active = _todayState.lbRegion === r;
        var btnColor = r === 'All' ? 'var(--text-muted)' : getRegColor(r);
        html += '<button class="btn btn-sm today-lb-region-btn" data-region="' + r + '" style="background:' + (active ? btnColor + '20' : 'transparent') + ';border:1px solid ' + (active ? btnColor : 'var(--border)') + ';border-radius:6px;color:' + (active ? btnColor : 'var(--text-dim)') + ';padding:0.2rem 0.6rem;font-size:0.8rem;">' + r + '</button>';
    });
    html += '</div>';

    // Job/Program filter
    var regionAgents = _todayState.lbRegion === 'All' ? d.agents : d.agents.filter(function (a) { return a.reg === _todayState.lbRegion; });
    var jobSet = {};
    regionAgents.forEach(function (a) { if (a.grps) Object.keys(a.grps).forEach(function (g) { jobSet[g] = true; }); });
    var jobs = Object.keys(jobSet).sort();
    if (jobs.length >= 2) {
        html += '<div class="d-flex flex-wrap gap-1 mb-3">';
        html += '<button class="btn btn-sm today-lb-job-btn" data-job="" style="padding:0.2rem 0.55rem;border-radius:6px;border:1px solid ' + (!_todayState.lbJob ? '#16a34a' : 'var(--border)') + ';background:' + (!_todayState.lbJob ? '#16a34a18' : 'transparent') + ';color:' + (!_todayState.lbJob ? '#16a34a' : 'var(--text-dim)') + ';font-size:0.8rem;">All Programs</button>';
        jobs.forEach(function (j) {
            var active = _todayState.lbJob === j;
            html += '<button class="btn btn-sm today-lb-job-btn" data-job="' + j + '" style="padding:0.2rem 0.55rem;border-radius:6px;border:1px solid ' + (active ? '#16a34a' : 'var(--border)') + ';background:' + (active ? '#16a34a18' : 'transparent') + ';color:' + (active ? '#16a34a' : 'var(--text-dim)') + ';font-size:0.8rem;">' + j + '</button>';
        });
        html += '</div>';
    }

    // Agent table
    html += '<div style="overflow-x:auto;"><table class="table table-sm" style="font-size:0.8rem;white-space:nowrap;">';
    html += '<thead><tr style="border-bottom:2px solid var(--border);">';
    var agentCols = [
        { k: 'name', l: 'Agent' }, { k: null, l: 'Region' }, { k: null, l: 'Program' },
        { k: 'hrs', l: 'Hrs', r: true }, { k: 'effectiveGoals', l: 'Sales', r: true },
        { k: null, l: 'GPH', r: true }, { k: null, l: 'RGU', r: true },
        { k: null, l: 'CPS', r: true },
        { k: null, l: 'HSD %', r: true }, { k: null, l: 'Mobile %', r: true },
    ];
    agentCols.forEach(function (col) {
        if (col.k) {
            var active = _todayState.sortBy === col.k;
            var arrow = active ? (_todayState.sortDir === -1 ? ' \u2193' : ' \u2191') : '';
            html += '<th class="today-sort-th" data-sort-type="agent" data-sort-key="' + col.k + '" style="padding:0.4rem 0.6rem;text-align:' + (col.r ? 'right' : 'left') + ';font-weight:400;color:' + (active ? '#d97706' : 'var(--text-dim)') + ';cursor:pointer;user-select:none;">' + col.l + arrow + '</th>';
        } else {
            html += '<th style="padding:0.4rem 0.6rem;color:var(--text-dim);font-weight:400;text-align:' + (col.r ? 'right' : 'left') + ';">' + col.l + '</th>';
        }
    });
    html += '</tr></thead><tbody>';

    sorted.forEach(function (a, i) {
        var eg = a.effectiveGoals;
        var gph = a.hrs > 0 && eg > 0 ? (eg / a.hrs).toFixed(3) : '\u2014';
        var regColor = getRegColor(a.reg);
        var grpStr = Object.keys(a.grps).join(', ');
        html +=
            '<tr style="border-bottom:1px solid var(--bg-tertiary);background:' + (i % 2 === 0 ? 'transparent' : 'var(--bg-row-alt)') + ';">' +
                '<td style="padding:0.4rem 0.6rem;color:var(--text-warm);">' + a.name + '</td>' +
                '<td style="padding:0.4rem 0.6rem;">' +
                    '<span style="background:' + regColor + '18;border:1px solid ' + regColor + '40;border-radius:3px;color:' + regColor + ';padding:0.1rem 0.35rem;">' + a.reg + '</span>' +
                '</td>' +
                '<td style="padding:0.4rem 0.6rem;color:var(--text-muted);max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="' + grpStr + '">' + grpStr + '</td>' +
                '<td style="padding:0.4rem 0.6rem;color:#6366f1;text-align:right;">' + _fmtToday(a.hrs, 2) + '</td>' +
                '<td style="padding:0.4rem 0.6rem;color:' + (eg > 0 ? '#d97706' : 'var(--text-faint)') + ';text-align:right;font-weight:' + (eg > 0 ? '700' : '400') + ';">' + (eg || '\u2014') + '</td>' +
                '<td style="padding:0.4rem 0.6rem;color:' + (eg > 0 ? '#16a34a' : 'var(--text-faint)') + ';text-align:right;">' + gph + '</td>' +
                '<td style="padding:0.4rem 0.6rem;color:' + (a.rgu > 0 ? '#2563eb' : 'var(--text-faint)') + ';text-align:right;">' + (a.rgu || '\u2014') + '</td>' +
                '<td style="padding:0.4rem 0.6rem;color:var(--text-secondary);text-align:right;">' + _cps(a.hrs, eg) + '</td>' +
                '<td style="padding:0.4rem 0.6rem;color:' + (a.hsd > 0 && eg > 0 ? '#2563eb' : 'var(--text-faint)') + ';text-align:right;">' + (a.hsd > 0 && eg > 0 ? Math.round(a.hsd / eg * 100) + '%' : '\u2014') + '</td>' +
                '<td style="padding:0.4rem 0.6rem;color:' + (a.xml > 0 && eg > 0 ? '#8b5cf6' : 'var(--text-faint)') + ';text-align:right;">' + (a.xml > 0 && eg > 0 ? Math.round(a.xml / eg * 100) + '%' : '\u2014') + '</td>' +
            '</tr>';
    });

    // Agent footer
    var atHrs = sorted.reduce(function (s, a) { return s + a.hrs; }, 0);
    var atGoals = sorted.reduce(function (s, a) { return s + a.effectiveGoals; }, 0);
    var atRgu = sorted.reduce(function (s, a) { return s + (a.rgu || 0); }, 0);
    var atHsd = sorted.reduce(function (s, a) { return s + (a.hsd || 0); }, 0);
    var atXml = sorted.reduce(function (s, a) { return s + (a.xml || 0); }, 0);
    var atGph = atHrs > 0 ? atGoals / atHrs : 0;
    html += '</tbody><tfoot>';
    html +=
        '<tr style="border-top:2px solid var(--border);background:var(--bg-row-alt);">' +
            '<td style="padding:0.5rem 0.6rem;color:var(--text-warm);font-weight:700;">TOTAL (' + sorted.length + ')</td>' +
            '<td></td><td></td>' +
            '<td style="padding:0.5rem 0.6rem;color:#6366f1;text-align:right;font-weight:700;">' + _fmtToday(atHrs, 2) + '</td>' +
            '<td style="padding:0.5rem 0.6rem;color:' + (atGoals > 0 ? '#d97706' : 'var(--text-faint)') + ';text-align:right;font-weight:700;">' + (atGoals || '\u2014') + '</td>' +
            '<td style="padding:0.5rem 0.6rem;color:' + (atGoals > 0 ? '#16a34a' : 'var(--text-faint)') + ';text-align:right;font-weight:700;">' + (atGoals > 0 ? atGph.toFixed(3) : '\u2014') + '</td>' +
            '<td style="padding:0.5rem 0.6rem;color:' + (atRgu > 0 ? '#2563eb' : 'var(--text-faint)') + ';text-align:right;font-weight:700;">' + (atRgu || '\u2014') + '</td>' +
            '<td style="padding:0.5rem 0.6rem;color:var(--text-secondary);text-align:right;font-weight:700;">' + _cps(atHrs, atGoals) + '</td>' +
            '<td style="padding:0.5rem 0.6rem;color:' + (atHsd > 0 && atGoals > 0 ? '#2563eb' : 'var(--text-faint)') + ';text-align:right;font-weight:700;">' + (atHsd > 0 && atGoals > 0 ? Math.round(atHsd / atGoals * 100) + '%' : '\u2014') + '</td>' +
            '<td style="padding:0.5rem 0.6rem;color:' + (atXml > 0 && atGoals > 0 ? '#8b5cf6' : 'var(--text-faint)') + ';text-align:right;font-weight:700;">' + (atXml > 0 && atGoals > 0 ? Math.round(atXml / atGoals * 100) + '%' : '\u2014') + '</td>' +
        '</tr>';
    html += '</tfoot></table></div>';

    html += '<div style="font-size:0.78rem;color:var(--text-faint);padding:0.4rem 0.6rem;">' +
        'HSD % = New HSD / Sales &middot; Mobile % = New Mobile / Sales' +
        '</div>';
    html += '</div>';

    html += '</div>'; // end main wrapper

    $tab.html(html);

    // ── Bind events ─────────────────────────────────────────────────────
    var rerender = function () { _renderTodayView($tab); };

    // Active/All toggle
    $tab.find('.today-toggle-btn').on('click', function () {
        _todayState.activeOnly = $(this).data('mode') === 'active';
        rerender();
    });

    // TV Mode
    $tab.find('#btnTVMode').on('click', function () {
        startTVMode();
    });

    // Refresh
    $tab.find('#btnTodayRefresh').on('click', function () {
        var $btn = $(this);
        $btn.prop('disabled', true).text('Fetching...');
        fetchTodayData(function () {
            rerender();
        });
    });

    // Sort headers
    $tab.find('.today-sort-th').on('click', function () {
        var type = $(this).data('sort-type');
        var key = $(this).data('sort-key');
        if (type === 'prog') {
            if (_todayState.progSortBy === key) _todayState.progSortDir *= -1;
            else { _todayState.progSortBy = key; _todayState.progSortDir = -1; }
        } else {
            if (_todayState.sortBy === key) _todayState.sortDir *= -1;
            else { _todayState.sortBy = key; _todayState.sortDir = -1; }
        }
        rerender();
    });

    // Site filter
    $tab.find('.today-site-btn').on('click', function () {
        var site = $(this).data('site');
        _todayState.progSiteFilter = site || null;
        _todayState.bzSiteFilter = null;
        rerender();
    });

    // Region filter
    $tab.find('.today-lb-region-btn').on('click', function () {
        _todayState.lbRegion = $(this).data('region');
        _todayState.lbJob = null;
        rerender();
    });

    // Job filter
    $tab.find('.today-lb-job-btn').on('click', function () {
        var job = $(this).data('job');
        _todayState.lbJob = job || null;
        rerender();
    });
}


// ══════════════════════════════════════════════════════════════════════════════
// TV MODE — Full-screen auto-rotating overlay
// ══════════════════════════════════════════════════════════════════════════════

function startTVMode() {
    $('body').addClass('tv-active');

    var CYCLE_MS = 12000;
    var tvSite = 'ALL';
    var slideIdx = 0;
    var refreshInterval = null;
    var cycleInterval = null;
    var scrollFrame = null;

    function buildSlides() {
        var d = _processData();
        if (!d) return [];

        var slides = [];
        var siteAgents = tvSite === 'ALL' ? d.agents : d.agents.filter(function (a) { return _getSite(a.reg) === tvSite; });
        var sitePrograms = tvSite === 'ALL' ? d.programs : d.programs.filter(function (p) { return _getSite(p.reg) === tvSite; });

        // Overview slide
        var totHrs   = siteAgents.reduce(function (s, a) { return s + a.hrs; }, 0);
        var totGoals = siteAgents.reduce(function (s, a) { return s + a.effectiveGoals; }, 0);
        var totRgu   = siteAgents.reduce(function (s, a) { return s + a.rgu; }, 0);
        var totHsd   = sitePrograms.reduce(function (s, p) { return s + (p.hsd || 0); }, 0);
        var totXm    = sitePrograms.reduce(function (s, p) { return s + (p.xml || 0); }, 0);

        slides.push({
            type: 'overview',
            label: tvSite === 'ALL' ? 'Company Overview' : tvSite === 'DR' ? 'Dominican Republic' : 'Belize',
            agentCount: siteAgents.length, hrs: totHrs, goals: totGoals, rgu: totRgu,
            hsd: totHsd, xm: totXm, programs: sitePrograms,
        });

        // Per-campaign slides
        var grpTotals = {};
        sitePrograms.filter(function (p) { return !/(spanish callback|\bfeb\b|\bmar\b|^unknown$)/i.test(p.grp || ''); }).forEach(function (p) {
            if (!grpTotals[p.grp]) grpTotals[p.grp] = { grp: p.grp, hrs: 0, goals: 0, rgu: 0, hsd: 0, xm: 0, agentSet: {}, agentCount: 0 };
            var g = grpTotals[p.grp];
            g.hrs += p.hrs; g.goals += p.effectiveGoals; g.rgu += p.rgu;
            g.hsd += p.hsd || 0; g.xm += p.xml || 0;
            Object.keys(p.agts).forEach(function (n) { g.agentSet[n] = true; });
        });
        var grpArr = [];
        Object.keys(grpTotals).forEach(function (k) {
            var g = grpTotals[k];
            g.agentCount = Object.keys(g.agentSet).length;
            grpArr.push(g);
        });
        grpArr.sort(function (a, b) { return b.hrs - a.hrs; });

        grpArr.forEach(function (g) {
            var campAgents = siteAgents.filter(function (a) { return g.agentSet[a.name]; })
                .sort(function (a, b) { return b.effectiveGoals - a.effectiveGoals || b.hrs - a.hrs; });
            slides.push({
                type: 'campaign', label: g.grp,
                hrs: g.hrs, goals: g.goals, rgu: g.rgu, hsd: g.hsd, xm: g.xm,
                agentCount: g.agentCount,
                topAgents: campAgents.slice(0, 6),
            });
        });

        return slides;
    }

    function renderOverlay() {
        var slides = buildSlides();
        if (slides.length === 0) return;
        if (slideIdx >= slides.length) slideIdx = 0;
        var slide = slides[slideIdx];
        var gph = slide.hrs > 0 ? slide.goals / slide.hrs : 0;
        var now = _todayState.lastRefresh
            ? new Date(_todayState.lastRefresh).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            : '';

        var html = '';

        // Progress bar
        html += '<div id="tvProgressBar" style="height:3px;background:var(--border);flex-shrink:0;">' +
            '<div style="height:100%;background:#d97706;animation:tvProgress ' + CYCLE_MS + 'ms linear forwards;width:0%;"></div>' +
            '</div>';

        // Slide title
        html += '<div style="padding:0.75rem 2.5rem 0;flex-shrink:0;text-align:center;position:relative;">' +
            '<div style="font-size:clamp(2rem, 4vw, 3.5rem);color:var(--text-warm);font-weight:800;letter-spacing:-0.02em;">' + slide.label + '</div>' +
            '<div style="position:absolute;right:2.5rem;top:50%;transform:translateY(-50%);display:flex;align-items:center;gap:0.5rem;">' +
                '<div style="width:8px;height:8px;border-radius:50%;background:#16a34a;animation:pulse 2s infinite;"></div>' +
                '<span style="font-size:clamp(0.75rem, 1.1vw, 0.95rem);color:#16a34a;letter-spacing:0.1em;text-transform:uppercase;font-weight:600;">LIVE</span>' +
                '<span style="font-size:clamp(0.7rem, 1vw, 0.85rem);color:var(--text-faint);">' + now + '</span>' +
            '</div>' +
            '</div>';

        // Slide content
        html += '<div style="flex:1;overflow:hidden;padding:0.75rem 2.5rem 1rem;display:flex;flex-direction:column;">';
        html += '<div id="tvSlideContent" style="flex:1;min-height:0;display:flex;flex-direction:column;justify-content:center;">';

        if (slide.type === 'overview') {
            html += _tvRenderOverview(slide, gph);
        } else if (slide.type === 'campaign') {
            html += _tvRenderCampaign(slide, gph);
        }

        html += '</div></div>';

        var $content = $('#tvOverlay .tv-content');
        $content.html(html);

        // Start auto-scroll on overflow elements
        setTimeout(function () { _tvAutoScroll('#tvSlideContent .tv-scroll-area', CYCLE_MS); }, 100);

        // Dot indicators
        var dotHtml = '';
        for (var i = 0; i < slides.length; i++) {
            var active = i === slideIdx;
            dotHtml += '<div class="tv-dot" data-slide="' + i + '" style="width:' + (active ? '18px' : '6px') + ';height:6px;border-radius:3px;background:' + (active ? '#d97706' : 'var(--border)') + ';transition:all 0.3s;cursor:pointer;"></div>';
        }
        $('#tvDots').html(dotHtml);
        $('#tvDots').find('.tv-dot').on('click', function (e) {
            e.stopPropagation();
            slideIdx = Number($(this).data('slide'));
            renderOverlay();
        });
    }

    // Build overlay shell
    var overlayHtml =
        '<div class="tv-mode" id="tvOverlay" style="position:fixed;inset:0;z-index:9999;background:var(--bg-primary);color:var(--text-primary);display:flex;flex-direction:column;overflow:hidden;">' +

            // Top bar (hover reveal)
            '<div id="tvTopBar" style="position:absolute;top:0;left:0;right:0;z-index:10;display:flex;justify-content:space-between;align-items:center;padding:0.75rem 2.5rem;background:var(--bg-primary);border-bottom:1px solid var(--border);opacity:0;transition:opacity 0.3s ease;">' +
                '<div style="display:flex;align-items:center;gap:1rem;">' +
                    '<div style="width:8px;height:8px;border-radius:50%;background:#16a34a;animation:pulse 2s infinite;"></div>' +
                    '<span style="font-size:0.82rem;color:#16a34a;letter-spacing:0.15em;text-transform:uppercase;font-weight:600;">LIVE</span>' +
                    '<span id="tvLastUpdate" style="font-size:0.78rem;color:var(--text-faint);"></span>' +
                '</div>' +
                '<div style="display:flex;align-items:center;gap:1rem;">' +
                    // Active/All toggle
                    '<div style="display:inline-flex;border-radius:6px;border:1px solid var(--border);overflow:hidden;">' +
                        '<button class="tv-active-btn" data-mode="all" style="padding:0.3rem 0.7rem;border:none;font-size:0.78rem;cursor:pointer;">All</button>' +
                        '<button class="tv-active-btn" data-mode="active" style="padding:0.3rem 0.7rem;border:none;border-left:1px solid var(--border);font-size:0.78rem;cursor:pointer;">Active</button>' +
                    '</div>' +
                    // Site filter
                    '<div style="display:inline-flex;border-radius:6px;border:1px solid var(--border);overflow:hidden;">' +
                        '<button class="tv-site-btn" data-site="ALL" style="padding:0.3rem 0.85rem;border:none;font-size:0.78rem;cursor:pointer;">All</button>' +
                        '<button class="tv-site-btn" data-site="DR" style="padding:0.3rem 0.85rem;border:none;font-size:0.78rem;cursor:pointer;">DR</button>' +
                        '<button class="tv-site-btn" data-site="BZ" style="padding:0.3rem 0.85rem;border:none;font-size:0.78rem;cursor:pointer;">BZ</button>' +
                    '</div>' +
                    // Dots
                    '<div id="tvDots" style="display:flex;gap:0.3rem;"></div>' +
                    // ESC
                    '<button id="tvEscBtn" style="background:transparent;border:1px solid var(--border);border-radius:6px;color:var(--text-dim);padding:0.3rem 0.65rem;font-size:0.72rem;cursor:pointer;">ESC</button>' +
                '</div>' +
            '</div>' +

            // Content area
            '<div class="tv-content" style="flex:1;display:flex;flex-direction:column;"></div>' +

        '</div>';

    $('body').append(overlayHtml);

    // Inject keyframe CSS
    if (!$('#tvModeStyles').length) {
        $('head').append(
            '<style id="tvModeStyles">' +
                '@keyframes tvProgress { from { width: 0%; } to { width: 100%; } }' +
                '@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }' +
            '</style>'
        );
    }

    // Hover show/hide top bar
    $('#tvTopBar').on('mouseenter', function () { $(this).css('opacity', 1); });
    $('#tvTopBar').on('mouseleave', function () { $(this).css('opacity', 0); });

    // Update active button styles
    function updateTvButtons() {
        $('#tvOverlay .tv-active-btn').each(function () {
            var mode = $(this).data('mode');
            var isActive = (mode === 'active' && _todayState.activeOnly) || (mode === 'all' && !_todayState.activeOnly);
            $(this).css({
                fontWeight: isActive ? 700 : 400,
                background: isActive ? (mode === 'active' ? '#d9770618' : '#16a34a18') : 'transparent',
                color: isActive ? (mode === 'active' ? '#d97706' : '#16a34a') : 'var(--text-dim)',
            });
        });
        $('#tvOverlay .tv-site-btn').each(function () {
            var site = $(this).data('site');
            var isActive = site === tvSite;
            $(this).css({
                fontWeight: isActive ? 700 : 400,
                background: isActive ? '#d9770620' : 'transparent',
                color: isActive ? '#d97706' : 'var(--text-dim)',
            });
        });
    }

    // Bind TV controls
    $('#tvOverlay .tv-active-btn').on('click', function (e) {
        e.stopPropagation();
        _todayState.activeOnly = $(this).data('mode') === 'active';
        slideIdx = 0;
        updateTvButtons();
        renderOverlay();
    });

    $('#tvOverlay .tv-site-btn').on('click', function (e) {
        e.stopPropagation();
        tvSite = $(this).data('site');
        slideIdx = 0;
        updateTvButtons();
        renderOverlay();
    });

    $('#tvEscBtn').on('click', function (e) { e.stopPropagation(); exitTVMode(); });

    // Double-click to exit
    $('#tvOverlay').on('dblclick', function () { exitTVMode(); });

    // Escape key
    $(document).on('keydown.tvmode', function (e) {
        if (e.key === 'Escape') exitTVMode();
    });

    // Initial render
    updateTvButtons();
    renderOverlay();

    // Auto-cycle slides
    cycleInterval = setInterval(function () {
        var slides = buildSlides();
        if (slides.length > 1) {
            slideIdx = (slideIdx + 1) % slides.length;
            renderOverlay();
        }
    }, CYCLE_MS);

    // Auto-refresh data
    refreshInterval = setInterval(function () {
        fetchTodayData(function () {
            renderOverlay();
        });
    }, 5 * 60 * 1000);

    function exitTVMode() {
        if (refreshInterval) clearInterval(refreshInterval);
        if (cycleInterval) clearInterval(cycleInterval);
        if (scrollFrame) cancelAnimationFrame(scrollFrame);
        $(document).off('keydown.tvmode');
        $('body').removeClass('tv-active');
        $('#tvOverlay').remove();
        // Re-render today view with latest data
        var $tab = $('#tab-today');
        if ($tab.length) _renderTodayView($tab);
    }
}

// ── TV Mode: render overview slide ──────────────────────────────────────────
function _tvRenderOverview(slide, gph) {
    var html = '';

    // Stats grid
    var stats = [
        { v: slide.agentCount, l: 'On Floor', c: '#16a34a' },
        { v: Math.round(slide.hrs), l: 'Hours', c: '#6366f1' },
        { v: slide.goals, l: 'Sales', c: '#d97706' },
        { v: gph.toFixed(2), l: 'GPH', c: _goalColor(null) },
        { v: slide.rgu || '\u2013', l: 'RGU', c: '#2563eb' },
        { v: _cps(slide.hrs, slide.goals), l: 'Cost/Sale', c: _goalColor(null) },
        { v: slide.hsd || '\u2013', l: 'HSD', c: '#f59e0b' },
        { v: slide.xm || '\u2013', l: 'XM Lines', c: '#ec4899' },
    ];

    html += '<div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(120px, 1fr));gap:1rem;margin-bottom:1.5rem;">';
    stats.forEach(function (s) {
        html +=
            '<div style="background:var(--bg-tertiary);border-radius:16px;padding:1rem;text-align:center;border:1px solid ' + s.c + '20;">' +
                '<div style="font-size:clamp(1rem, 1.6vw, 1.3rem);color:var(--text-muted);text-transform:uppercase;letter-spacing:0.08em;font-weight:700;margin-bottom:0.1rem;">' + s.l + '</div>' +
                '<div style="font-size:clamp(1.8rem, 3.5vw, 3rem);color:' + s.c + ';font-weight:800;line-height:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + s.v + '</div>' +
            '</div>';
    });
    html += '</div>';

    // Campaign table
    var progRows = {};
    slide.programs.filter(function (p) { return !/(spanish callback|\bfeb\b|\bmar\b|^unknown$)/i.test(p.grp || ''); })
        .forEach(function (p) {
            if (!progRows[p.grp]) progRows[p.grp] = { grp: p.grp, hrs: 0, goals: 0, rgu: 0, hsd: 0, xm: 0, agentSet: {} };
            var r = progRows[p.grp];
            r.hrs += p.hrs; r.goals += p.effectiveGoals; r.rgu += p.rgu;
            r.hsd += p.hsd || 0; r.xm += p.xml || 0;
            Object.keys(p.agts).forEach(function (n) { r.agentSet[n] = true; });
        });
    var rows = [];
    Object.keys(progRows).forEach(function (k) { rows.push(progRows[k]); });
    rows.sort(function (a, b) { return b.hrs - a.hrs; });

    if (rows.length > 0) {
        var cols = ['Hrs', 'Sales', 'GPH', 'RGU', 'HSD', 'XM', 'CPS'];
        html += '<div class="tv-scroll-area" style="overflow:hidden;flex:1;min-height:0;">';

        // Header
        html += '<div style="display:grid;grid-template-columns:minmax(8rem, 2fr) repeat(' + cols.length + ', 1fr);align-items:end;gap:0.5rem;padding:0 1rem 0.3rem;border-bottom:2px solid var(--border);margin-bottom:0.35rem;">';
        html += '<div style="font-size:clamp(0.75rem, 1vw, 0.95rem);color:var(--text-muted);font-weight:700;text-transform:uppercase;letter-spacing:0.08em;">Campaign</div>';
        cols.forEach(function (h) {
            html += '<div style="text-align:center;font-size:clamp(0.75rem, 1vw, 0.95rem);color:var(--text-muted);font-weight:700;text-transform:uppercase;letter-spacing:0.06em;">' + h + '</div>';
        });
        html += '</div>';

        // Rows
        rows.forEach(function (p) {
            var pGph = p.hrs > 0 ? p.goals / p.hrs : 0;
            var agentCount = Object.keys(p.agentSet).length;
            var vals = [
                { v: Math.round(p.hrs), c: '#6366f1' },
                { v: p.goals, c: '#d97706' },
                { v: pGph.toFixed(2), c: _goalColor(null) },
                { v: p.rgu || '\u2013', c: '#2563eb' },
                { v: p.hsd || '\u2013', c: '#f59e0b' },
                { v: p.xm || '\u2013', c: '#ec4899' },
                { v: _cps(p.hrs, p.goals), c: _goalColor(null) },
            ];
            html += '<div style="background:var(--bg-tertiary);border-radius:10px;padding:0.6rem 1rem;border:1px solid var(--border);display:grid;grid-template-columns:minmax(8rem, 2fr) repeat(' + cols.length + ', 1fr);align-items:center;gap:0.5rem;margin-bottom:0.35rem;">';
            html += '<div><div style="font-size:clamp(0.85rem, 1.2vw, 1.1rem);color:var(--text-warm);font-weight:700;line-height:1.2;">' + p.grp + '</div>' +
                '<div style="font-size:clamp(0.65rem, 0.9vw, 0.8rem);color:var(--text-faint);margin-top:0.15rem;">' + agentCount + ' agents</div></div>';
            vals.forEach(function (val) {
                html += '<div style="text-align:center;"><div style="font-size:clamp(0.9rem, 1.2vw, 1.15rem);color:' + val.c + ';font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + val.v + '</div></div>';
            });
            html += '</div>';
        });
        html += '</div>';
    }

    return html;
}

// ── TV Mode: render campaign slide ──────────────────────────────────────────
function _tvRenderCampaign(slide, gph) {
    var html = '';
    var hasSales = slide.goals > 0;
    var topAgents = slide.topAgents || [];

    html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:2rem;height:100%;">';

    // Left: stat cards
    html += '<div style="display:flex;flex-direction:column;justify-content:center;">';
    html += '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:1.5rem;">';
    var stats = [
        { v: slide.agentCount, l: 'Agents', c: '#16a34a' },
        { v: Math.round(slide.hrs), l: 'Hours', c: '#6366f1' },
        { v: slide.goals, l: 'Sales', c: '#d97706' },
        { v: gph.toFixed(2), l: 'GPH', c: _goalColor(null) },
        { v: slide.rgu || '\u2013', l: 'RGU', c: '#2563eb' },
        { v: _cps(slide.hrs, slide.goals), l: 'Cost/Sale', c: _goalColor(null) },
        { v: slide.hsd || '\u2013', l: 'HSD', c: '#f59e0b' },
        { v: slide.xm || '\u2013', l: 'XM Lines', c: '#ec4899' },
    ];
    stats.forEach(function (s) {
        html +=
            '<div style="background:var(--bg-tertiary);border-radius:16px;padding:1rem;text-align:center;border:1px solid ' + s.c + '20;">' +
                '<div style="font-size:clamp(1.1rem, 1.8vw, 1.5rem);color:var(--text-muted);text-transform:uppercase;letter-spacing:0.08em;font-weight:700;margin-bottom:0.2rem;">' + s.l + '</div>' +
                '<div style="font-size:clamp(2rem, 4vw, 3.5rem);color:' + s.c + ';font-weight:800;line-height:1;">' + s.v + '</div>' +
            '</div>';
    });
    html += '</div></div>';

    // Right: agent leaderboard
    html += '<div style="background:var(--bg-tertiary);border-radius:16px;padding:1.25rem;border:1px solid var(--border);overflow:hidden;display:flex;flex-direction:column;">';
    html += '<div style="font-size:clamp(1.1rem, 2vw, 1.6rem);color:var(--text-muted);letter-spacing:0.1em;text-transform:uppercase;font-weight:700;margin-bottom:0.5rem;">' +
        (hasSales ? 'Top Agents' : 'Agents on Floor') + '</div>';

    if (topAgents.length === 0) {
        html += '<div style="color:var(--text-faint);font-size:1.2rem;">No agent data yet</div>';
    } else {
        html += '<div class="tv-scroll-area" style="flex:1;overflow:hidden;display:flex;flex-direction:column;gap:0.35rem;">';
        topAgents.forEach(function (a, i) {
            var aGph = a.hrs > 0 ? a.effectiveGoals / a.hrs : 0;
            var rank = hasSales ? (i === 0 ? '\uD83E\uDD47' : i === 1 ? '\uD83E\uDD48' : i === 2 ? '\uD83E\uDD49' : String(i + 1)) : String(i + 1);
            var nameSize = 'clamp(1.8rem, 3vw, 2.5rem)';
            var statSize = 'clamp(1.8rem, 3vw, 2.5rem)';
            var lblSize = 'clamp(1.2rem, 2vw, 1.7rem)';
            html +=
                '<div style="background:' + (hasSales && i < 3 ? 'var(--bg-secondary)' : 'transparent') + ';border-radius:6px;padding:0.5rem 0.75rem;border-bottom:1px solid var(--border);">' +
                    '<div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.25rem;">' +
                        '<span style="font-size:' + nameSize + ';min-width:1.8rem;text-align:center;">' + rank + '</span>' +
                        '<span style="color:var(--text-warm);font-size:' + nameSize + ';font-weight:700;">' + a.name + '</span>' +
                    '</div>' +
                    '<div style="display:flex;gap:1rem;padding-left:2.3rem;">' +
                        '<div style="text-align:center;">' +
                            '<span style="font-size:' + lblSize + ';color:var(--text-faint);text-transform:uppercase;letter-spacing:0.05em;font-weight:600;">Hrs </span>' +
                            '<span style="font-size:' + statSize + ';color:#6366f1;font-weight:700;">' + Math.round(a.hrs) + '</span>' +
                        '</div>' +
                        (hasSales ?
                            '<div style="text-align:center;">' +
                                '<span style="font-size:' + lblSize + ';color:var(--text-faint);text-transform:uppercase;letter-spacing:0.05em;font-weight:600;">Sales </span>' +
                                '<span style="font-size:' + statSize + ';color:#d97706;font-weight:700;">' + a.effectiveGoals + '</span>' +
                            '</div>' +
                            '<div style="text-align:center;">' +
                                '<span style="font-size:' + lblSize + ';color:var(--text-faint);text-transform:uppercase;letter-spacing:0.05em;font-weight:600;">GPH </span>' +
                                '<span style="font-size:' + statSize + ';color:#16a34a;font-weight:600;">' + aGph.toFixed(2) + '</span>' +
                            '</div>'
                        : '') +
                    '</div>' +
                '</div>';
        });
        html += '</div>';
    }
    html += '</div>';

    html += '</div>';
    return html;
}

// ── TV Mode: auto-scroll overflow elements ──────────────────────────────────
function _tvAutoScroll(selector, cycleMs) {
    var el = $(selector)[0];
    if (!el) return;
    el.scrollTop = 0;
    var scrollMax = el.scrollHeight - el.clientHeight;
    if (scrollMax <= 0) return;

    var pauseMs = 2000;
    var scrollDuration = cycleMs - pauseMs * 2;
    var phase = 'pause-top';
    var phaseStart = performance.now();
    var startTime = null;

    function step(now) {
        if (phase === 'pause-top') {
            if (now - phaseStart >= pauseMs) { phase = 'scrolling'; startTime = now; }
        } else if (phase === 'scrolling') {
            var elapsed = now - startTime;
            var pct = Math.min(elapsed / scrollDuration, 1);
            // Ease in-out
            var ease = pct < 0.5 ? 2 * pct * pct : 1 - Math.pow(-2 * pct + 2, 2) / 2;
            el.scrollTop = ease * scrollMax;
            if (pct >= 1) phase = 'done';
        } else {
            return;
        }
        requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
}
