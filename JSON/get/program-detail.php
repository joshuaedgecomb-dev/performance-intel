<?php
/**
 * GET /JSON/get/program-detail.php?program=X
 * Returns full program data for one program, including supervisor stats,
 * weekly rollup, fiscal info, and narrative insights.
 */
require_once $_SERVER['DOCUMENT_ROOT'] . '/base.php';
require_once __DIR__ . '/_helpers.php';

header('Content-Type: application/json');

$programName = $_GET['program'] ?? '';
if ($programName === '') {
    http_response_code(400);
    echo json_encode(['error' => 'Missing required parameter: program']);
    exit;
}

$programs = getProgramsFromCache();

// Find the matching program
$program = null;
foreach ($programs as $p) {
    if ($p['jobType'] === $programName) {
        $program = $p;
        break;
    }
}

if ($program === null) {
    http_response_code(404);
    echo json_encode(['error' => 'Program not found: ' . $programName]);
    exit;
}

$fiscalInfo      = getFiscalInfoFromCache();
$supervisorStats = buildSupervisorStats($program['agents']);
$weeklyRollup    = buildWeeklyRollup($program['agents']);

// ── Narrative insights ──────────────────────────────────────────────────────

$winInsights = [];
$oppInsights = [];

// Attainment-based
if ($program['attainment'] !== null) {
    if ($program['attainment'] >= 100) {
        $winInsights[] = 'Goal attainment is ' . round($program['attainment'], 1) . '% — exceeding plan.';
    } elseif ($program['attainment'] < 80) {
        $oppInsights[] = 'Attainment is ' . round($program['attainment'], 1) . '% — ' . round(100 - $program['attainment'], 1) . ' points below target.';
    }
}

// Q1 rate
if ($program['q1Rate'] >= 30) {
    $winInsights[] = round($program['q1Rate'], 1) . '% Q1 rate — strong performer distribution.';
} elseif ($program['q1Rate'] < 15) {
    $oppInsights[] = 'Q1 rate is only ' . round($program['q1Rate'], 1) . '% — too few top performers.';
}

// Health score
if ($program['healthScore'] >= 80) {
    $winInsights[] = 'Health score of ' . round($program['healthScore'], 1) . ' indicates a well-balanced program.';
} elseif ($program['healthScore'] < 50) {
    $oppInsights[] = 'Health score of ' . round($program['healthScore'], 1) . ' signals structural issues.';
}

// Top agent
if ($program['topAgent']) {
    $winInsights[] = 'Top performer: ' . ($program['topAgent']['agentName'] ?? 'N/A') . ' with ' . round($program['topAgent']['hours'] ?? 0, 1) . ' hours.';
}

// Q4 count
$q4Count = count($program['q4Agents'] ?? []);
if ($q4Count > 0) {
    $oppInsights[] = $q4Count . ' agent(s) in Q4 require coaching attention.';
}

// Build narrative summary
$narrative = '';
if ($program['attainment'] !== null) {
    $narrative = $program['jobType'] . ' is at ' . round($program['attainment'], 1) . '% attainment';
    $narrative .= ' with ' . $program['uniqueAgentCount'] . ' agents producing ' . round($program['gph'], 2) . ' GPH.';
} else {
    $narrative = $program['jobType'] . ' has ' . $program['uniqueAgentCount'] . ' agents producing ' . round($program['gph'], 2) . ' GPH.';
}

// ── Response ────────────────────────────────────────────────────────────────

// Remove raw agent rows from output to keep payload manageable
$output = $program;
unset($output['agents']);

$output['supervisorStats'] = $supervisorStats;
$output['weeklyRollup']    = $weeklyRollup;
$output['fiscalInfo']      = $fiscalInfo;
$output['winInsights']     = $winInsights;
$output['oppInsights']     = $oppInsights;
$output['narrative']       = $narrative;

echo json_encode($output, JSON_NUMERIC_CHECK);
