<?php
/**
 * normalize.php – PHP port of normalization logic from app.jsx
 *
 * Provides agent-row normalization, quartile classification,
 * new-hire parsing, and various aggregation helpers.
 */

require_once __DIR__ . '/csv.php';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

$VALID_REGIONS = ['SD-Xfinity', 'Belize City-XOTM', 'OW-XOTM', 'San Ignacio-XOTM'];

$WEEK_LABELS = [
    '4'  => 'Jan 22–24',
    '5'  => 'Jan 25–31',
    '6'  => 'Feb 1–7',
    '7'  => 'Feb 8–14',
    '8'  => 'Feb 15–21',
    '9'  => 'Feb 22–28',
    '10' => 'Mar 1–7',
    '52' => 'Dec 29–31',
];

$WEEK_BDAYS = [
    '52' => 3,
    '4'  => 3,
    '5'  => 5,
    '6'  => 5,
    '7'  => 5,
    '8'  => 5,
    '9'  => 5,
    '10' => 5,
];

// ---------------------------------------------------------------------------
// Quartile helper
// ---------------------------------------------------------------------------

/**
 * Map a percent-to-goal value to a quartile label.
 */
function getQuartile($pctToGoal) {
    if ($pctToGoal >= 100) return 'Q1';
    if ($pctToGoal >= 80)  return 'Q2';
    if ($pctToGoal > 0)    return 'Q3';
    return 'Q4';
}

// ---------------------------------------------------------------------------
// Main 3-pass normalisation
// ---------------------------------------------------------------------------

/**
 * Normalize raw CSV rows into enriched agent rows with aggregate quartiles.
 *
 * @param  array $rows      Array of associative arrays (parsed CSV).
 * @param  int   $minHours  Minimum-hours threshold (default 16, reserved for future use).
 * @return array            Normalized + quartile-stamped rows.
 */
function normalizeAgents($rows, $minHours = 16) {
    global $VALID_REGIONS;

    // -----------------------------------------------------------------------
    // Pass 1 – Filter & normalise each row
    // -----------------------------------------------------------------------
    $normalized = [];

    foreach ($rows as $row) {
        // Skip header echoes and blanks
        $jobType = isset($row['Job Type']) ? trim($row['Job Type']) : '';
        if ($jobType === '' || $jobType === 'Job Type' || $jobType === 'Not Found') {
            continue;
        }

        // Parse numeric fields (parseNum comes from csv.php)
        $hours       = parseNum($row['Hours']        ?? $row['hours']        ?? 0);
        $goals       = parseNum($row['Goals']        ?? $row['goals']        ?? 0);
        $gph         = parseNum($row['GPH']          ?? $row['gph']          ?? 0);
        $newXI       = parseNum($row['New XI']       ?? $row['NewData']      ?? 0);
        $xmLines     = parseNum($row['XM Lines']     ?? $row['XMLines']      ?? 0);
        $newXH       = parseNum($row['New XH']       ?? $row['NewXH']        ?? 0);
        $newVideo    = parseNum($row['New Video']     ?? $row['NewVideo']     ?? 0);
        $newVoice    = parseNum($row['NewVoice']      ?? $row['New Voice']    ?? 0);
        $newSecurity = parseNum($row['NewSecurity']   ?? $row['New Security'] ?? 0);

        // Compute RGU
        $rgu = $newVideo + $newXI + $newVoice + $newSecurity + $xmLines;

        // Region handling
        $rawRegion = $row['Region'] ?? $row['region'] ?? $row['REGION'] ?? 'Unknown';
        $rawRegion = trim($rawRegion);

        // Fix common misspelling
        if ($rawRegion === 'SD-Xfinty') {
            $rawRegion = 'SD-Xfinity';
        }

        // ROC code from Job field
        $rocCode = strtoupper(trim($row['Job'] ?? $row['job'] ?? ''));

        // Remap SD-Cox with GL* ROC code → SD-Xfinity
        if ($rawRegion === 'SD-Cox' && strpos($rocCode, 'GL') === 0) {
            $rawRegion = 'SD-Xfinity';
        }

        // Filter: skip rows not in valid regions
        if (!in_array($rawRegion, $VALID_REGIONS, true)) {
            continue;
        }

        // SPH Goal
        $sphGoal = parseNum($row['SPH Goal'] ?? $row['SPH GOAL'] ?? 0);

        // Goals number (numeric target)
        $goalsNum = parseNum($row['Goals number'] ?? $row['Goals Number'] ?? 0);

        // Day percent-to-goal
        $dayPct = $goalsNum > 0 ? ($goals / $goalsNum) * 100 : 0;

        // Week number
        $weekNum = $row['Week Number'] ?? $row['Week'] ?? '';

        // Agent / supervisor metadata
        $agentName  = trim($row['AgentName'] ?? '');
        $supervisor = trim($row['SupName'] ?? $row['Supervisor'] ?? '');
        $date       = trim($row['Date'] ?? $row['date'] ?? '');

        $isSpanishCallback = ($jobType === 'Spanish Callback');

        // Build normalised row (preserve originals + computed fields)
        $normalized[] = array_merge($row, [
            'hours'             => $hours,
            'goals'             => $goals,
            'gph'               => $gph,
            'newXI'             => $newXI,
            'xmLines'           => $xmLines,
            'newXH'             => $newXH,
            'newVideo'          => $newVideo,
            'newVoice'          => $newVoice,
            'newSecurity'       => $newSecurity,
            'rgu'               => $rgu,
            'date'              => $date,
            'weekNum'           => $weekNum,
            'jobType'           => $jobType,
            'rocCode'           => $rocCode,
            'region'            => $rawRegion,
            'agentName'         => $agentName,
            'supervisor'        => $supervisor,
            'sphGoal'           => $sphGoal,
            'goalsNum'          => $goalsNum,
            'dayPctToGoal'      => $dayPct,
            'isSpanishCallback' => $isSpanishCallback,
        ]);
    }

    // -----------------------------------------------------------------------
    // Pass 2 – Build per-agent rollups (skip Spanish Callback)
    // -----------------------------------------------------------------------
    $rollups = []; // keyed by "agentName|||jobType"

    foreach ($normalized as $r) {
        if ($r['isSpanishCallback']) {
            continue;
        }

        $key = $r['agentName'] . '|||' . $r['jobType'];

        if (!isset($rollups[$key])) {
            $rollups[$key] = [
                'totalHours'       => 0,
                'totalGoals'       => 0,
                'totalGoalsNum'    => 0,
                'totalNewXI'       => 0,
                'totalXmLines'     => 0,
                'totalNewXH'       => 0,
                'totalNewVideo'    => 0,
                'totalNewVoice'    => 0,
                'totalNewSecurity' => 0,
                'dates'            => [],  // date => ['hours' => ..., 'goals' => ...]
                'weekNums'         => [],
                'supervisor'       => '',
                'region'           => '',
                'sphGoal'          => 0,
            ];
        }

        $ru = &$rollups[$key];
        $ru['totalHours']       += $r['hours'];
        $ru['totalGoals']       += $r['goals'];
        $ru['totalGoalsNum']    += $r['goalsNum'];
        $ru['totalNewXI']       += $r['newXI'];
        $ru['totalXmLines']     += $r['xmLines'];
        $ru['totalNewXH']       += $r['newXH'];
        $ru['totalNewVideo']    += $r['newVideo'];
        $ru['totalNewVoice']    += $r['newVoice'];
        $ru['totalNewSecurity'] += $r['newSecurity'];

        // Track per-date hours & goals
        $d = $r['date'];
        if ($d !== '') {
            if (!isset($ru['dates'][$d])) {
                $ru['dates'][$d] = ['hours' => 0, 'goals' => 0];
            }
            $ru['dates'][$d]['hours'] += $r['hours'];
            $ru['dates'][$d]['goals'] += $r['goals'];
        }

        // Track week numbers
        if ($r['weekNum'] !== '') {
            $ru['weekNums'][$r['weekNum']] = true;
        }

        // Keep supervisor / region / sphGoal (take any non-empty / non-zero)
        if ($ru['supervisor'] === '' && $r['supervisor'] !== '') {
            $ru['supervisor'] = $r['supervisor'];
        }
        if ($ru['region'] === '' && $r['region'] !== '') {
            $ru['region'] = $r['region'];
        }
        if ($ru['sphGoal'] == 0 && $r['sphGoal'] != 0) {
            $ru['sphGoal'] = $r['sphGoal'];
        }

        unset($ru);
    }

    // Compute aggregate metrics for each rollup
    foreach ($rollups as $key => &$ru) {
        $ru['aggGph']        = $ru['totalHours'] > 0
            ? $ru['totalGoals'] / $ru['totalHours']
            : 0;
        $ru['aggPctToGoal']  = $ru['totalGoalsNum'] > 0
            ? ($ru['totalGoals'] / $ru['totalGoalsNum']) * 100
            : 0;
        $ru['aggQuartile']   = getQuartile($ru['aggPctToGoal']);
    }
    unset($ru);

    // -----------------------------------------------------------------------
    // Pass 3 – Stamp aggregate quartile onto every normalised row
    // -----------------------------------------------------------------------
    foreach ($normalized as &$r) {
        $key = $r['agentName'] . '|||' . $r['jobType'];

        if (isset($rollups[$key])) {
            $ru = $rollups[$key];
            $r['quartile']   = $ru['aggQuartile'];
            $r['pctToGoal']  = $ru['aggPctToGoal'];
            $r['aggGph']     = $ru['aggGph'];
            $r['aggRollup']  = $ru;
        } else {
            // Spanish Callback or unmatched – default to Q4
            $r['quartile']   = 'Q4';
            $r['pctToGoal']  = 0;
            $r['aggGph']     = 0;
            $r['aggRollup']  = null;
        }
    }
    unset($r);

    return $normalized;
}

// ---------------------------------------------------------------------------
// New-hire parsing
// ---------------------------------------------------------------------------

/**
 * Parse new-hire rows into a simple list with days-since-hire.
 *
 * @param  array $rows  Array of associative arrays.
 * @return array        Array of ['name' => ..., 'startDate' => ..., 'days' => ...].
 */
function parseNewHires($rows) {
    $now    = new DateTime();
    $result = [];

    foreach ($rows as $row) {
        // Build name: prefer "First Name" + "Last Name", fall back to other fields
        $first = trim($row['First Name'] ?? '');
        $last  = trim($row['Last Name']  ?? '');
        $name  = trim("$first $last");

        if ($name === '') {
            $name = trim($row['AgentName'] ?? $row['Name'] ?? $row['Agent Name'] ?? '');
        }
        if ($name === '') {
            continue;
        }

        // Skip inactive (has an end date)
        $endDate = trim($row['End Date'] ?? '');
        if ($endDate !== '') {
            continue;
        }

        // Parse hire date
        $hireDateStr = trim(
            $row['Hire Date'] ?? $row['StartDate'] ?? $row['Start Date'] ?? $row['start_date'] ?? ''
        );

        if ($hireDateStr !== '') {
            try {
                $hireDate = new DateTime($hireDateStr);
                $days     = (int) $now->diff($hireDate)->days;

                // Skip if more than 180 days since hire
                if ($days > 180) {
                    continue;
                }

                $result[] = [
                    'name'      => $name,
                    'startDate' => $hireDateStr,
                    'days'      => $days,
                ];
            } catch (Exception $e) {
                // Unparseable date – skip
                continue;
            }
        } else {
            // No hire date (legacy format) – include anyway
            $result[] = [
                'name'      => $name,
                'startDate' => null,
                'days'      => null,
            ];
        }
    }

    return $result;
}

// ---------------------------------------------------------------------------
// Quartile distribution helpers
// ---------------------------------------------------------------------------

/**
 * Deduplicated quartile distribution – one entry per unique agentName.
 *
 * @param  array $agents  Normalized agent rows.
 * @return array          ['Q1' => n, 'Q2' => n, 'Q3' => n, 'Q4' => n]
 */
function uniqueQuartileDist($agents) {
    $seen = [];
    $dist = ['Q1' => 0, 'Q2' => 0, 'Q3' => 0, 'Q4' => 0];

    foreach ($agents as $a) {
        $name = $a['agentName'] ?? '';
        if ($name === '' || isset($seen[$name])) {
            continue;
        }
        $seen[$name] = true;
        $q = $a['quartile'] ?? 'Q4';
        if (isset($dist[$q])) {
            $dist[$q]++;
        }
    }

    return $dist;
}

/**
 * Simple (non-deduplicated) quartile distribution across all rows.
 *
 * @param  array $agents  Normalized agent rows.
 * @return array          ['Q1' => n, 'Q2' => n, 'Q3' => n, 'Q4' => n]
 */
function quartileDist($agents) {
    $dist = ['Q1' => 0, 'Q2' => 0, 'Q3' => 0, 'Q4' => 0];

    foreach ($agents as $a) {
        $q = $a['quartile'] ?? 'Q4';
        if (isset($dist[$q])) {
            $dist[$q]++;
        }
    }

    return $dist;
}

// ---------------------------------------------------------------------------
// Collapse to unique agents
// ---------------------------------------------------------------------------

/**
 * Deduplicate multi-row agents into one entry per agentName.
 * Sums hours, goals, goalsNum, newXI, xmLines, newXH, newVideo.
 * Keeps pctToGoal and quartile from the first row (already aggregate-stamped).
 * Collects unique ROC codes.
 *
 * @param  array $rows  Normalized agent rows.
 * @return array        One entry per unique agent.
 */
function collapseToUniqueAgents($rows) {
    $map = [];

    foreach ($rows as $r) {
        $name = $r['agentName'] ?? '';
        if ($name === '') {
            continue;
        }

        if (!isset($map[$name])) {
            $map[$name] = $r;
            $map[$name]['rocCodes'] = [];
            if (!empty($r['rocCode'])) {
                $map[$name]['rocCodes'][] = $r['rocCode'];
            }
        } else {
            $map[$name]['hours']    += $r['hours'];
            $map[$name]['goals']    += $r['goals'];
            $map[$name]['goalsNum'] += $r['goalsNum'];
            $map[$name]['newXI']    += $r['newXI'];
            $map[$name]['xmLines']  += $r['xmLines'];
            $map[$name]['newXH']    += $r['newXH'];
            $map[$name]['newVideo'] += $r['newVideo'];

            // Collect unique ROC codes
            if (!empty($r['rocCode']) && !in_array($r['rocCode'], $map[$name]['rocCodes'], true)) {
                $map[$name]['rocCodes'][] = $r['rocCode'];
            }
        }
    }

    return array_values($map);
}

// ---------------------------------------------------------------------------
// Unique name count
// ---------------------------------------------------------------------------

/**
 * Count unique agent names.
 *
 * @param  array $agents  Normalized agent rows.
 * @return int
 */
function uniqueNames($agents) {
    $names = [];
    foreach ($agents as $a) {
        $name = $a['agentName'] ?? '';
        if ($name !== '') {
            $names[$name] = true;
        }
    }
    return count($names);
}

// ---------------------------------------------------------------------------
// Agent daily profile
// ---------------------------------------------------------------------------

/**
 * Build a day-by-day performance profile for a single agent + job type.
 *
 * @param  string $agentName  Agent name to filter on.
 * @param  string $jobType    Job type to filter on.
 * @param  array  $allRows    Full set of normalised rows.
 * @return array              Profile with daily breakdown and summary stats.
 */
function buildAgentDailyProfile($agentName, $jobType, $allRows) {
    // Filter rows for this agent + job type
    $filtered = [];
    foreach ($allRows as $r) {
        if (($r['agentName'] ?? '') === $agentName && ($r['jobType'] ?? '') === $jobType) {
            $filtered[] = $r;
        }
    }

    // Group by date
    $byDate = [];
    foreach ($filtered as $r) {
        $d = $r['date'] ?? '';
        if ($d === '') {
            continue;
        }
        if (!isset($byDate[$d])) {
            $byDate[$d] = ['hours' => 0, 'goals' => 0];
        }
        $byDate[$d]['hours'] += $r['hours'];
        $byDate[$d]['goals'] += $r['goals'];
    }

    // Build days array
    $days        = [];
    $totalHours  = 0;
    $totalGoals  = 0;
    $workedDays  = 0;
    $absentDays  = 0;
    $gphValues   = [];

    ksort($byDate);

    foreach ($byDate as $date => $info) {
        $h      = $info['hours'];
        $g      = $info['goals'];
        $dayGph = $h > 0 ? $g / $h : 0;
        $worked = $h > 0;

        $days[] = [
            'date'   => $date,
            'hours'  => $h,
            'goals'  => $g,
            'gph'    => $dayGph,
            'worked' => $worked,
            'absent' => !$worked,
        ];

        $totalHours += $h;
        $totalGoals += $g;

        if ($worked) {
            $workedDays++;
            $gphValues[] = $dayGph;
        } else {
            $absentDays++;
        }
    }

    // GPH mean & standard deviation
    $gphMean = count($gphValues) > 0 ? array_sum($gphValues) / count($gphValues) : 0;
    $gphStd  = 0;

    if (count($gphValues) > 1) {
        $sumSqDiff = 0;
        foreach ($gphValues as $v) {
            $sumSqDiff += ($v - $gphMean) ** 2;
        }
        $gphStd = sqrt($sumSqDiff / count($gphValues));
    }

    // Consistency: 1 - (std / mean) clamped to [0, 1]
    $consistency = $gphMean > 0 ? max(0, min(1, 1 - ($gphStd / $gphMean))) : 0;

    // Pull metadata from the first filtered row
    $first      = $filtered[0] ?? [];
    $sphGoal    = $first['sphGoal']    ?? 0;
    $quartile   = $first['quartile']   ?? 'Q4';
    $supervisor = $first['supervisor'] ?? '';

    return [
        'agentName'   => $agentName,
        'jobType'     => $jobType,
        'sphGoal'     => $sphGoal,
        'days'        => $days,
        'totalHours'  => $totalHours,
        'totalGoals'  => $totalGoals,
        'workedDays'  => $workedDays,
        'absentDays'  => $absentDays,
        'gphMean'     => $gphMean,
        'gphStd'      => $gphStd,
        'consistency' => $consistency,
        'quartile'    => $quartile,
        'supervisor'  => $supervisor,
    ];
}
