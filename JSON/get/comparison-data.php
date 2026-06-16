<?php
/**
 * GET /JSON/get/comparison-data.php
 * Returns prior vs current month comparison data with computed deltas.
 */
require_once $_SERVER['DOCUMENT_ROOT'] . '/base.php';
require_once __DIR__ . '/_helpers.php';

header('Content-Type: application/json');

$currentAgents = getAgentsFromCache();
$priorAgents   = getPriorAgentsFromCache();

// ── Build per-program summaries for each month ──────────────────────────────

function buildMonthSummary($agents) {
    $byJob = [];
    foreach ($agents as $a) {
        $jt = $a['jobType'] ?? '';
        if ($jt === '' || ($a['isSpanishCallback'] ?? false)) continue;
        if (!isset($byJob[$jt])) {
            $byJob[$jt] = ['hours' => 0, 'goals' => 0, 'rgu' => 0, 'names' => []];
        }
        $byJob[$jt]['hours'] += $a['hours'];
        $byJob[$jt]['goals'] += $a['goals'];
        $byJob[$jt]['rgu']   += $a['rgu'] ?? 0;
        $name = $a['agentName'] ?? '';
        if ($name !== '') {
            $byJob[$jt]['names'][$name] = true;
        }
    }

    $programs = [];
    foreach ($byJob as $jt => $d) {
        $programs[$jt] = [
            'jobType'    => $jt,
            'hours'      => $d['hours'],
            'goals'      => $d['goals'],
            'rgu'        => $d['rgu'],
            'gph'        => $d['hours'] > 0 ? $d['goals'] / $d['hours'] : 0,
            'agentCount' => count($d['names']),
        ];
    }
    return $programs;
}

$currentSummary = buildMonthSummary($currentAgents);
$priorSummary   = buildMonthSummary($priorAgents);

// ── Compute deltas ──────────────────────────────────────────────────────────

$allJobTypes = array_unique(array_merge(array_keys($currentSummary), array_keys($priorSummary)));
sort($allJobTypes);

$comparison = [];
foreach ($allJobTypes as $jt) {
    $cur   = $currentSummary[$jt] ?? null;
    $prior = $priorSummary[$jt]   ?? null;

    $entry = [
        'jobType' => $jt,
        'current' => $cur,
        'prior'   => $prior,
    ];

    if ($cur && $prior) {
        $entry['delta'] = [
            'hours'      => $cur['hours'] - $prior['hours'],
            'goals'      => $cur['goals'] - $prior['goals'],
            'rgu'        => $cur['rgu'] - $prior['rgu'],
            'gph'        => $cur['gph'] - $prior['gph'],
            'agentCount' => $cur['agentCount'] - $prior['agentCount'],
        ];
        $entry['delta']['goalsPct'] = $prior['goals'] > 0
            ? (($cur['goals'] - $prior['goals']) / $prior['goals']) * 100
            : null;
        $entry['delta']['gphPct'] = $prior['gph'] > 0
            ? (($cur['gph'] - $prior['gph']) / $prior['gph']) * 100
            : null;
    } else {
        $entry['delta'] = null;
    }

    $comparison[] = $entry;
}

// ── Global totals ───────────────────────────────────────────────────────────

function globalTotals($agents) {
    $hours = array_sum(array_column($agents, 'hours'));
    $goals = array_sum(array_column($agents, 'goals'));
    $rgu   = array_sum(array_column($agents, 'rgu'));
    return [
        'hours'      => $hours,
        'goals'      => $goals,
        'rgu'        => $rgu,
        'gph'        => $hours > 0 ? $goals / $hours : 0,
        'agentCount' => uniqueNames($agents),
    ];
}

$curTotals   = globalTotals($currentAgents);
$priorTotals = globalTotals($priorAgents);

$globalDelta = [
    'hours'      => $curTotals['hours'] - $priorTotals['hours'],
    'goals'      => $curTotals['goals'] - $priorTotals['goals'],
    'rgu'        => $curTotals['rgu'] - $priorTotals['rgu'],
    'gph'        => $curTotals['gph'] - $priorTotals['gph'],
    'agentCount' => $curTotals['agentCount'] - $priorTotals['agentCount'],
];

echo json_encode([
    'programs'    => $comparison,
    'current'     => $curTotals,
    'prior'       => $priorTotals,
    'globalDelta' => $globalDelta,
], JSON_NUMERIC_CHECK);
