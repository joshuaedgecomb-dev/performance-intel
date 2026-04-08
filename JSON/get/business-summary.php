<?php
/**
 * GET /JSON/get/business-summary.php
 * Global aggregates for the overview tab.
 */
require_once $_SERVER['DOCUMENT_ROOT'] . '/base.php';
require_once __DIR__ . '/_helpers.php';

header('Content-Type: application/json');

$agents     = getAgentsFromCache();
$goalLookup = getGoalLookupFromCache();
$programs   = getProgramsFromCache();
$fiscalInfo = getFiscalInfoFromCache();

// ── Global totals ───────────────────────────────────────────────────────────

$totalAgents = uniqueNames($agents);
$totalHours  = array_sum(array_column($agents, 'hours'));
$totalGoals  = array_sum(array_column($agents, 'goals'));
$gph         = $totalHours > 0 ? $totalGoals / $totalHours : 0;

// Plan totals from goal lookup
$planTotal    = getGlobalPlanGoals($goalLookup);
$attainment   = $planTotal ? ($totalGoals / $planTotal) * 100 : null;

// Global sub-metric totals
$globalRgu      = array_sum(array_column($agents, 'rgu'));
$globalNewXI    = array_sum(array_column($agents, 'newXI'));
$globalXmLines  = array_sum(array_column($agents, 'xmLines'));
$globalNewXH    = array_sum(array_column($agents, 'newXH'));
$globalNewVideo = array_sum(array_column($agents, 'newVideo'));

// Global plan sub-metrics
$globalPlanRgu     = getGlobalPlanForKey($goalLookup, 'RGU GOAL');
$globalPlanNewXI   = getGlobalPlanForKey($goalLookup, 'HSD Sell In Goal');
$globalPlanXmLines = getGlobalPlanForKey($goalLookup, 'XM GOAL');
$globalPlanHours   = getGlobalPlanForKey($goalLookup, 'Hours Goal');

// Regions and global quartile distribution
$regions    = buildRegions($agents);
$distUnique = uniqueQuartileDist($agents);

// ── Insights ────────────────────────────────────────────────────────────────

$insights = generateBusinessInsights($programs, $totalAgents, $totalGoals, $gph, $attainment, $distUnique);

// ── Program summaries ───────────────────────────────────────────────────────

$programSummaries = [];
foreach ($programs as $p) {
    $programSummaries[] = [
        'jobType'          => $p['jobType'],
        'uniqueAgentCount' => $p['uniqueAgentCount'],
        'attainment'       => $p['attainment'],
        'healthScore'      => $p['healthScore'],
    ];
}

// ── Response ────────────────────────────────────────────────────────────────

echo json_encode([
    'totalAgents'      => $totalAgents,
    'totalHours'       => $totalHours,
    'globalGoals'      => $totalGoals,
    'gph'              => $gph,
    'planTotal'        => $planTotal,
    'attainment'       => $attainment,
    'regions'          => $regions,
    'distUnique'       => $distUnique,
    'globalRgu'        => $globalRgu,
    'globalNewXI'      => $globalNewXI,
    'globalXmLines'    => $globalXmLines,
    'globalNewXH'      => $globalNewXH,
    'globalNewVideo'   => $globalNewVideo,
    'globalPlanRgu'    => $globalPlanRgu,
    'globalPlanNewXI'  => $globalPlanNewXI,
    'globalPlanXmLines'=> $globalPlanXmLines,
    'globalPlanHours'  => $globalPlanHours,
    'fiscalInfo'       => $fiscalInfo,
    'insights'         => $insights,
    'programs'         => $programSummaries,
], JSON_NUMERIC_CHECK);

// ── Insight generator ───────────────────────────────────────────────────────

/**
 * Generate top-level business insights from program data.
 */
function generateBusinessInsights($programs, $totalAgents, $totalGoals, $gph, $attainment, $distUnique) {
    $insights = [];

    // Attainment insight
    if ($attainment !== null) {
        if ($attainment >= 100) {
            $insights[] = ['type' => 'success', 'text' => 'Global goal attainment is at ' . round($attainment, 1) . '% — on track.'];
        } elseif ($attainment >= 80) {
            $insights[] = ['type' => 'warning', 'text' => 'Global attainment is ' . round($attainment, 1) . '% — close but needs push.'];
        } else {
            $insights[] = ['type' => 'danger', 'text' => 'Global attainment is only ' . round($attainment, 1) . '% — significant gap to plan.'];
        }
    }

    // Q1 rate insight
    $total = array_sum($distUnique);
    if ($total > 0) {
        $q1Rate = ($distUnique['Q1'] / $total) * 100;
        if ($q1Rate >= 30) {
            $insights[] = ['type' => 'success', 'text' => round($q1Rate, 1) . '% of agents are in Q1 — strong top-performer base.'];
        } elseif ($q1Rate < 15) {
            $insights[] = ['type' => 'danger', 'text' => 'Only ' . round($q1Rate, 1) . '% of agents are in Q1 — need more high performers.'];
        }
    }

    // Top / bottom programs
    if (count($programs) > 0) {
        $top = $programs[0];
        if ($top['attainment'] !== null) {
            $insights[] = ['type' => 'info', 'text' => 'Top program: ' . $top['jobType'] . ' at ' . round($top['attainment'], 1) . '% attainment.'];
        }
        $bottom = $programs[count($programs) - 1];
        if ($bottom['attainment'] !== null && $bottom['attainment'] < 80) {
            $insights[] = ['type' => 'warning', 'text' => 'Lowest program: ' . $bottom['jobType'] . ' at ' . round($bottom['attainment'], 1) . '% attainment.'];
        }
    }

    return $insights;
}
