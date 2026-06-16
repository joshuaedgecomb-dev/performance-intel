<?php require_once 'base.php'; ?>
<!DOCTYPE html>
<html lang="en" data-bs-theme="dark">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Performance Intel</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&family=Fira+Code:wght@400;500;600;700&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="/css/perf-intel.css">
    <style>
        /* Loading overlay */
        #loadingOverlay {
            position: fixed;
            inset: 0;
            z-index: 9999;
            display: flex;
            align-items: center;
            justify-content: center;
            background: rgba(0, 0, 0, 0.7);
            backdrop-filter: blur(4px);
        }
        #loadingOverlay .spinner-border {
            width: 3rem;
            height: 3rem;
        }

        /* Navbar tweaks */
        .navbar-brand {
            font-family: 'Inter', sans-serif;
            font-weight: 800;
            letter-spacing: 0.5px;
            font-size: 1.1rem;
        }
        .status-badge {
            font-size: 0.75rem;
            padding: 0.25em 0.6em;
        }
        .nav-tabs .nav-link {
            font-weight: 500;
            font-size: 0.9rem;
        }

        /* Ensure tab content fills viewport below navbar */
        .main-content {
            padding-top: 110px;
            min-height: 100vh;
        }
        .tab-content > .tab-pane {
            padding: 1rem;
        }

        /* Toolbar buttons */
        .btn-toolbar-icon {
            border: none;
            background: transparent;
            font-size: 1.1rem;
            padding: 0.25rem 0.5rem;
            opacity: 0.7;
            transition: opacity 0.2s;
        }
        .btn-toolbar-icon:hover {
            opacity: 1;
        }
        .btn-toolbar-icon.active {
            opacity: 1;
            color: var(--bs-primary);
        }
    </style>
</head>
<body>

<!-- Loading Overlay -->
<div id="loadingOverlay">
    <div class="text-center">
        <div class="spinner-border text-primary" role="status">
            <span class="visually-hidden">Loading...</span>
        </div>
        <div class="text-light mt-3 fw-semibold">Loading Performance Data&hellip;</div>
    </div>
</div>

<!-- Top Navbar -->
<nav class="navbar navbar-expand fixed-top border-bottom" style="background: var(--bs-body-bg); z-index: 1030;">
    <div class="container-fluid flex-column align-items-stretch py-1">
        <!-- Top row: brand + status + toolbar -->
        <div class="d-flex align-items-center justify-content-between">
            <!-- Left: Brand + Status -->
            <div class="d-flex align-items-center gap-3">
                <span class="navbar-brand mb-0 text-primary">PERFORMANCE INTEL</span>
                <span id="statusPrograms" class="badge bg-secondary status-badge"></span>
                <span id="statusAgents" class="badge bg-info text-dark status-badge"></span>
                <span id="statusGoals" class="badge bg-success status-badge" style="display:none;">
                    <i class="bi bi-bullseye"></i> Goals Loaded
                </span>
                <span id="statusNewHires" class="badge bg-warning text-dark status-badge" style="display:none;">
                    <i class="bi bi-person-plus"></i> <span id="newHireCount"></span> New Hires
                </span>
            </div>

            <!-- Right: Toolbar -->
            <div class="d-flex align-items-center gap-1">
                <button class="btn-toolbar-icon" id="btnTheme" title="Toggle theme">
                    <i class="bi bi-moon-fill" id="themeIcon"></i>
                </button>
                <button class="btn btn-sm btn-outline-info" id="btnToday" title="Today / TV Mode">
                    TODAY
                </button>
                <button class="btn btn-sm btn-outline-warning" id="btnAI" title="AI Insights" style="display:none;">
                    AI
                </button>
                <button class="btn btn-sm btn-outline-success" id="btnMBR" title="MBR Export" data-bs-toggle="modal" data-bs-target="#mbrExportModal">
                    <i class="bi bi-file-earmark-ppt"></i> MBR
                </button>
                <button class="btn-toolbar-icon" id="btnSettings" title="Settings" data-bs-toggle="modal" data-bs-target="#settingsModal">
                    <i class="bi bi-gear-fill"></i>
                </button>
                <button class="btn-toolbar-icon" id="btnRefresh" title="Refresh data">
                    <i class="bi bi-arrow-clockwise"></i>
                </button>
            </div>
        </div>

        <!-- Bottom row: Nav tabs -->
        <ul class="nav nav-tabs border-bottom-0 mt-1" id="mainNav" role="tablist">
            <li class="nav-item" role="presentation">
                <a class="nav-link active" id="nav-overview-tab" data-bs-toggle="tab" href="#tab-overview" role="tab" aria-controls="tab-overview" aria-selected="true">Overview</a>
            </li>
            <li class="nav-item" role="presentation">
                <a class="nav-link" id="nav-programs-tab" data-bs-toggle="tab" href="#tab-programs" role="tab" aria-controls="tab-programs" aria-selected="false">Programs</a>
            </li>
            <li class="nav-item" role="presentation">
                <a class="nav-link" id="nav-comparison-tab" data-bs-toggle="tab" href="#tab-comparison" role="tab" aria-controls="tab-comparison" aria-selected="false">Comparison</a>
            </li>
        </ul>
    </div>
</nav>

<!-- Main Content -->
<div class="main-content">
    <div class="tab-content" id="mainTabContent">
        <!-- Overview Tab -->
        <div class="tab-pane fade show active" id="tab-overview" role="tabpanel" aria-labelledby="nav-overview-tab">
        </div>

        <!-- Programs Tab (with sub-tabs) -->
        <div class="tab-pane fade" id="tab-programs" role="tabpanel" aria-labelledby="nav-programs-tab">
            <ul class="nav nav-pills mb-3" id="programTabs"></ul>
            <div class="tab-content" id="programTabContent"></div>
        </div>

        <!-- Comparison Tab -->
        <div class="tab-pane fade" id="tab-comparison" role="tabpanel" aria-labelledby="nav-comparison-tab">
        </div>

        <!-- Today / TV Mode Tab (hidden from main nav, toggled via button) -->
        <div class="tab-pane fade" id="tab-today" role="tabpanel">
        </div>
    </div>
</div>

<!-- Settings Modal -->
<div class="modal fade" id="settingsModal" tabindex="-1" aria-labelledby="settingsModalLabel" aria-hidden="true">
    <div class="modal-dialog modal-lg modal-dialog-scrollable">
        <div class="modal-content">
            <div class="modal-header">
                <h5 class="modal-title" id="settingsModalLabel"><i class="bi bi-gear"></i> Settings</h5>
                <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
            </div>
            <div class="modal-body">
                <h6 class="text-muted mb-3">Google Sheets Data Sources</h6>

                <div class="mb-3">
                    <label for="settingSheetAgents" class="form-label fw-semibold">Agent Data Sheet URL</label>
                    <input type="url" class="form-control" id="settingSheetAgents" placeholder="https://docs.google.com/spreadsheets/d/...">
                    <div class="form-text" id="settingSheetAgentsCurrent"></div>
                </div>

                <div class="mb-3">
                    <label for="settingSheetGoals" class="form-label fw-semibold">Goals Sheet URL</label>
                    <input type="url" class="form-control" id="settingSheetGoals" placeholder="https://docs.google.com/spreadsheets/d/...">
                    <div class="form-text" id="settingSheetGoalsCurrent"></div>
                </div>

                <div class="mb-3">
                    <label for="settingSheetRoster" class="form-label fw-semibold">Roster / New Hires Sheet URL</label>
                    <input type="url" class="form-control" id="settingSheetRoster" placeholder="https://docs.google.com/spreadsheets/d/...">
                    <div class="form-text" id="settingSheetRosterCurrent"></div>
                </div>

                <div class="mb-3">
                    <label for="settingSheetPrior" class="form-label fw-semibold">Prior Month Data Sheet URL</label>
                    <input type="url" class="form-control" id="settingSheetPrior" placeholder="https://docs.google.com/spreadsheets/d/...">
                    <div class="form-text" id="settingSheetPriorCurrent"></div>
                </div>

                <div class="mb-3">
                    <label for="settingSheetPriorGoals" class="form-label fw-semibold">Prior Month Goals Sheet URL</label>
                    <input type="url" class="form-control" id="settingSheetPriorGoals" placeholder="https://docs.google.com/spreadsheets/d/...">
                    <div class="form-text" id="settingSheetPriorGoalsCurrent"></div>
                </div>

                <hr>
                <h6 class="text-muted mb-3">Display Options</h6>

                <div class="row align-items-end mb-3">
                    <div class="col-md-6">
                        <label for="settingHoursThreshold" class="form-label fw-semibold">Hours Threshold</label>
                        <input type="number" class="form-control" id="settingHoursThreshold" min="0" step="1" placeholder="e.g. 40">
                        <div class="form-text">Minimum hours for an agent to appear in rankings</div>
                    </div>
                    <div class="col-md-6">
                        <div class="form-check form-switch mt-2">
                            <input class="form-check-input" type="checkbox" id="settingAutoScale" checked>
                            <label class="form-check-label" for="settingAutoScale">Auto-scale threshold by business days elapsed</label>
                        </div>
                    </div>
                </div>
            </div>
            <div class="modal-footer d-flex justify-content-between">
                <button type="button" class="btn btn-outline-danger" id="btnSettingsReset">
                    <i class="bi bi-arrow-counterclockwise"></i> Reset to Defaults
                </button>
                <div>
                    <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancel</button>
                    <button type="button" class="btn btn-primary" id="btnSettingsSave">
                        <i class="bi bi-check-lg"></i> Save &amp; Reload
                    </button>
                </div>
            </div>
        </div>
    </div>
</div>

<!-- MBR Export Modal -->
<div class="modal fade" id="mbrExportModal" tabindex="-1" aria-labelledby="mbrExportModalLabel" aria-hidden="true">
    <div class="modal-dialog">
        <div class="modal-content">
            <div class="modal-header">
                <h5 class="modal-title" id="mbrExportModalLabel"><i class="bi bi-file-earmark-ppt"></i> MBR Export</h5>
                <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
            </div>
            <div class="modal-body">
                <p class="text-muted">Generate a Monthly Business Review PowerPoint deck from the current data.</p>
                <div id="mbrExportStatus"></div>
            </div>
            <div class="modal-footer">
                <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Close</button>
                <button type="button" class="btn btn-success" id="btnMBRExport">
                    <i class="bi bi-download"></i> Export PPTX
                </button>
            </div>
        </div>
    </div>
</div>

<!-- BaseJS Framework -->
<script src="/script/BaseJS/basejs.js"></script>

<!-- Custom JS -->
<script src="/script/perf-intel/constants.js"></script>
<script src="/script/perf-intel/engine.js"></script>
<script src="/script/perf-intel/overview.js"></script>
<script src="/script/perf-intel/program.js"></script>
<script src="/script/perf-intel/comparison.js"></script>
<script src="/script/perf-intel/today.js"></script>
<script src="/script/perf-intel/mbr.js"></script>
<script src="/script/perf-intel/ai.js"></script>

<script>
/* ======================================================
   Performance Intel — Initialization
   ====================================================== */
gcs.basejsDone.then(() => {
    gcs.ajaxerror();

    // ── Global state ──────────────────────────────────
    window.PERF = {
        agents:          null,
        goals:           null,
        goalLookup:      null,
        newHires:        null,
        programs:        null,
        fiscalInfo:      null,
        businessSummary: null,
        priorAgents:     null,
        priorGoalLookup: null,
        config:          {},
        localAI:         false,
        ollamaAvailable: false,
    };

    // ── Load saved config ─────────────────────────────
    $.getJSON('/JSON/config/get.php', function(cfg) {
        PERF.config = cfg || {};
        populateSettings();
    });

    // ── Check Ollama availability ─────────────────────
    $.ajax({
        url: 'http://localhost:11434/api/tags',
        timeout: 2000,
        success: function(d) {
            PERF.ollamaAvailable = d.models && d.models.length > 0;
            if (PERF.ollamaAvailable) $('#btnAI').show();
        },
        error: function() {
            PERF.ollamaAvailable = false;
        }
    });

    // ── Theme toggle ──────────────────────────────────
    updateThemeIcon();
    $('#btnTheme').on('click', function() {
        gcs.toggleTheme();
        updateThemeIcon();
    });

    function updateThemeIcon() {
        var isDark = document.documentElement.getAttribute('data-bs-theme') === 'dark';
        $('#themeIcon').attr('class', isDark ? 'bi bi-sun-fill' : 'bi bi-moon-fill');
    }

    // ── Today / TV Mode toggle ────────────────────────
    $('#btnToday').on('click', function() {
        var $btn = $(this);
        var isActive = $btn.hasClass('active');

        if (isActive) {
            // Return to previous tab
            $btn.removeClass('active');
            $('#mainNav .nav-link').first().tab('show');
            $('#tab-today').removeClass('show active');
        } else {
            // Show Today tab
            $btn.addClass('active');
            $('#mainNav .nav-link').removeClass('active');
            $('.tab-pane').removeClass('show active');
            $('#tab-today').addClass('show active');

            if (!$('#tab-today').data('loaded')) {
                $('#tab-today').data('loaded', true);
                if (typeof renderToday === 'function') renderToday();
            }
        }
    });

    // ── AI toggle ─────────────────────────────────────
    $('#btnAI').on('click', function() {
        PERF.localAI = !PERF.localAI;
        $(this).toggleClass('active', PERF.localAI);
        gcs.toast({
            message: 'AI Insights ' + (PERF.localAI ? 'enabled' : 'disabled'),
            type: PERF.localAI ? 'success' : 'secondary'
        });
    });

    // ── Refresh button ────────────────────────────────
    $('#btnRefresh').on('click', function() {
        loadAllData(true);
    });

    // ── Tab lazy-loading: Comparison ──────────────────
    $('a[data-bs-toggle="tab"][href="#tab-comparison"]').on('shown.bs.tab', function() {
        if ($('#tab-comparison').data('loaded')) return;
        $('#tab-comparison').data('loaded', true);
        if (typeof renderComparison === 'function') renderComparison();
    });

    // ── Tab lazy-loading: Programs container ──────────
    $('a[data-bs-toggle="tab"][href="#tab-programs"]').on('shown.bs.tab', function() {
        // Trigger first program tab if not yet loaded
        var $first = $('#programTabs .nav-link.active');
        if ($first.length) $first.trigger('shown.bs.tab');
    });

    // ── Settings: Save ────────────────────────────────
    $('#btnSettingsSave').on('click', function() {
        var cfg = {
            sheetAgents:      $('#settingSheetAgents').val(),
            sheetGoals:       $('#settingSheetGoals').val(),
            sheetRoster:      $('#settingSheetRoster').val(),
            sheetPrior:       $('#settingSheetPrior').val(),
            sheetPriorGoals:  $('#settingSheetPriorGoals').val(),
            hoursThreshold:   parseInt($('#settingHoursThreshold').val()) || 0,
            autoScale:        $('#settingAutoScale').is(':checked')
        };
        $.ajax({
            url: '/JSON/config/set.php',
            method: 'POST',
            contentType: 'application/json',
            data: JSON.stringify(cfg),
            success: function() {
                PERF.config = cfg;
                bootstrap.Modal.getInstance(document.getElementById('settingsModal')).hide();
                gcs.toast({ message: 'Settings saved. Reloading data...', type: 'success' });
                loadAllData(true);
            },
            error: function() {
                gcs.toast({ message: 'Failed to save settings', type: 'danger' });
            }
        });
    });

    // ── Settings: Reset ───────────────────────────────
    $('#btnSettingsReset').on('click', function() {
        gcs.confirm({ message: 'Reset all settings to defaults?' }).then(function(ok) {
            if (!ok) return;
            $('#settingSheetAgents, #settingSheetGoals, #settingSheetRoster, #settingSheetPrior, #settingSheetPriorGoals').val('');
            $('#settingHoursThreshold').val('');
            $('#settingAutoScale').prop('checked', true);
        });
    });

    // ── MBR Export ────────────────────────────────────
    $('#btnMBRExport').on('click', function() {
        if (typeof exportMBR === 'function') {
            exportMBR();
        } else {
            gcs.toast({ message: 'MBR export module not loaded', type: 'warning' });
        }
    });

    // ── Initial data load ─────────────────────────────
    loadAllData();
});

/* ──────────────────────────────────────────────────────
   Data Loading
   ────────────────────────────────────────────────────── */
function loadAllData(refresh) {
    var qs = refresh ? '?refresh=1' : '';
    $('#loadingOverlay').show();

    $.getJSON('/JSON/get/business-summary.php' + qs, function(data) {
        PERF.businessSummary = data;
        PERF.fiscalInfo      = data.fiscalInfo;

        updateStatusBar(data);
        buildProgramTabs(data.programs || []);

        if (typeof renderOverview === 'function') renderOverview(data);

        $('#loadingOverlay').hide();
    }).fail(function() {
        $('#loadingOverlay').hide();
        gcs.toast({ message: 'Failed to load data', type: 'danger' });
    });
}

/* ──────────────────────────────────────────────────────
   Status Bar
   ────────────────────────────────────────────────────── */
function updateStatusBar(data) {
    $('#statusPrograms').text(data.programs ? data.programs.length + ' programs' : '');
    $('#statusAgents').text(data.totalAgents ? data.totalAgents + ' agents' : '');

    if (data.planTotal) {
        $('#statusGoals').show();
    } else {
        $('#statusGoals').hide();
    }

    if (data.newHireCount && data.newHireCount > 0) {
        $('#newHireCount').text(data.newHireCount);
        $('#statusNewHires').show();
    } else {
        $('#statusNewHires').hide();
    }
}

/* ──────────────────────────────────────────────────────
   Dynamic Program Tabs
   ────────────────────────────────────────────────────── */
function buildProgramTabs(programs) {
    var $tabs    = $('#programTabs').empty();
    var $content = $('#programTabContent').empty();

    PERF.programs = programs;

    programs.forEach(function(p, i) {
        var id     = 'prog-' + i;
        var active = i === 0 ? 'active' : '';
        var show   = i === 0 ? 'show active' : '';

        $tabs.append(
            '<li class="nav-item">' +
                '<a class="nav-link ' + active + '" data-bs-toggle="pill" href="#' + id + '" data-program="' + p.jobType + '">' +
                    p.jobType +
                '</a>' +
            '</li>'
        );
        $content.append(
            '<div class="tab-pane fade ' + show + '" id="' + id + '"></div>'
        );
    });

    // Lazy-load program detail on tab show
    $tabs.find('.nav-link').on('shown.bs.tab', function() {
        var prog   = $(this).data('program');
        var target = $(this).attr('href');
        if ($(target).data('loaded')) return;
        $(target).data('loaded', true);
        if (typeof renderProgram === 'function') renderProgram(target, prog);
    });

    // Load first program immediately
    if (programs.length > 0) {
        var firstTab = '#prog-0';
        if (typeof renderProgram === 'function') {
            $(firstTab).data('loaded', true);
            renderProgram(firstTab, programs[0].jobType);
        }
    }
}

/* ──────────────────────────────────────────────────────
   Populate Settings Modal from Config
   ────────────────────────────────────────────────────── */
function populateSettings() {
    var c = PERF.config || {};

    $('#settingSheetAgents').val(c.sheetAgents || '');
    $('#settingSheetGoals').val(c.sheetGoals || '');
    $('#settingSheetRoster').val(c.sheetRoster || '');
    $('#settingSheetPrior').val(c.sheetPrior || '');
    $('#settingSheetPriorGoals').val(c.sheetPriorGoals || '');
    $('#settingHoursThreshold').val(c.hoursThreshold || '');
    $('#settingAutoScale').prop('checked', c.autoScale !== false);

    // Show current URLs as helper text
    $('#settingSheetAgentsCurrent').text(c.sheetAgents ? 'Current: ' + c.sheetAgents : '');
    $('#settingSheetGoalsCurrent').text(c.sheetGoals ? 'Current: ' + c.sheetGoals : '');
    $('#settingSheetRosterCurrent').text(c.sheetRoster ? 'Current: ' + c.sheetRoster : '');
    $('#settingSheetPriorCurrent').text(c.sheetPrior ? 'Current: ' + c.sheetPrior : '');
    $('#settingSheetPriorGoalsCurrent').text(c.sheetPriorGoals ? 'Current: ' + c.sheetPriorGoals : '');
}
</script>

</body>
</html>
