<?php
/**
 * Fiscal Month & Pacing Utilities
 * Ported from app.jsx lines 142-192
 *
 * Fiscal period runs 22nd → 21st, counting only M–F business days.
 */

require_once __DIR__ . '/csv.php';

/**
 * Compute fiscal month info from an array of date strings ("YYYY-MM-DD").
 * Returns assoc array with fiscal boundaries, elapsed/remaining business days, pctElapsed.
 */
function getFiscalMonthInfo($datestrs) {
    if (!$datestrs || count($datestrs) === 0) return null;

    $sorted = array_filter($datestrs, function($d) { return !empty($d); });
    sort($sorted);
    if (count($sorted) === 0) return null;

    $minStr = $sorted[0];
    $maxStr = $sorted[count($sorted) - 1];

    $minDate = new DateTime($minStr);
    $maxDate = new DateTime($maxStr);

    // Fiscal end = 21st of the month after the dataset's first date
    $fiscalEnd = new DateTime($minDate->format('Y-m') . '-01');
    $fiscalEnd->modify('+1 month');
    $fiscalEnd->setDate((int)$fiscalEnd->format('Y'), (int)$fiscalEnd->format('m'), 21);

    $elapsedBDays   = countBusinessDays($minDate, $maxDate);
    $totalBDays     = countBusinessDays($minDate, $fiscalEnd);
    $remainingBDays = max(0, $totalBDays - $elapsedBDays);
    $pctElapsed     = $totalBDays > 0 ? ($elapsedBDays / $totalBDays) * 100 : 0;

    return [
        'fiscalStart'    => $minStr,
        'fiscalEnd'      => $fiscalEnd->format('Y-m-d'),
        'lastDataDate'   => $maxStr,
        'elapsedBDays'   => $elapsedBDays,
        'remainingBDays' => $remainingBDays,
        'totalBDays'     => $totalBDays,
        'pctElapsed'     => $pctElapsed,
    ];
}

/**
 * Count business days (M-F) between two dates, inclusive.
 */
function countBusinessDays(DateTime $start, DateTime $end) {
    $n = 0;
    $cur = clone $start;
    while ($cur <= $end) {
        $dow = (int)$cur->format('N'); // 1=Mon, 7=Sun
        if ($dow <= 5) $n++;
        $cur->modify('+1 day');
    }
    return $n;
}

/**
 * Calculate pacing projections.
 * Returns projected EOM, daily rate, required daily rate, projected attainment %.
 */
function calcPacing($actual, $plan, $elapsedBDays, $totalBDays) {
    if (!$plan || !$elapsedBDays || !$totalBDays) return null;

    $dailyRate     = $actual / $elapsedBDays;
    $projected     = round($dailyRate * $totalBDays);
    $projectedPct  = ($projected / $plan) * 100;
    $delta         = $projected - $plan;
    $remainingDays = $totalBDays - $elapsedBDays;
    $requiredDaily = $remainingDays > 0 ? ($plan - $actual) / $remainingDays : null;

    return [
        'dailyRate'    => $dailyRate,
        'projected'    => $projected,
        'projectedPct' => $projectedPct,
        'delta'        => round($delta),
        'requiredDaily' => $requiredDaily,
    ];
}

/**
 * Compute effective hours threshold with auto-scaling based on fiscal elapsed days.
 */
function computeEffectiveThreshold($baseThreshold, $fiscalInfo, $autoScale = true) {
    if (!$autoScale || !$fiscalInfo || !$fiscalInfo['totalBDays'] || !$fiscalInfo['elapsedBDays']) {
        return $baseThreshold;
    }
    $ratio = $fiscalInfo['elapsedBDays'] / $fiscalInfo['totalBDays'];
    return max(1, round($baseThreshold * $ratio * 10) / 10);
}
