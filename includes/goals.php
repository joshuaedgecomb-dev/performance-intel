<?php
/**
 * Goals Engine
 * PHP port of the goals/plan-matching logic from the JavaScript app.
 * Provides fuzzy job-type-to-goal matching across multiple strategies.
 */

require_once __DIR__ . '/csv.php';

/* ---------------------------------------------------------------
 * Key normalization helpers
 * ------------------------------------------------------------- */

/**
 * Normalize a string for loose comparison:
 * lowercase, collapse whitespace/underscores/hyphens/slashes to single space, trim.
 * e.g. "HSD Sell In Goal" → "hsd sell in goal"
 */
function normKey($s) {
    $s = strtolower(trim($s ?? ''));
    $s = preg_replace('/[\s_\-\/]+/', ' ', $s);
    return trim($s);
}

/**
 * Compact a string for ultra-loose comparison:
 * lowercase, strip ALL whitespace and common separators.
 * e.g. "Non-Sub" → "nonsub"
 */
function compactKey($s) {
    $s = strtolower(trim($s ?? ''));
    return preg_replace('/[\s_\-\/]+/', '', $s);
}

/* ---------------------------------------------------------------
 * Column lookup
 * ------------------------------------------------------------- */

/**
 * Find a value from a row by trying multiple candidate column names.
 * Comparison is case/space insensitive via normKey.
 * Returns the first non-empty match, or empty string.
 */
function findCol($row, ...$candidates) {
    if (!is_array($row)) return '';

    // Build a map of normKey(column) → original column name
    $map = [];
    foreach ($row as $key => $val) {
        $map[normKey($key)] = $key;
    }

    foreach ($candidates as $candidate) {
        $nk = normKey($candidate);
        if (isset($map[$nk])) {
            $val = trim($row[$map[$nk]] ?? '');
            if ($val !== '') return $val;
        }
    }
    return '';
}

/* ---------------------------------------------------------------
 * Goal lookup builder
 * ------------------------------------------------------------- */

/**
 * Build a multi-index lookup structure from parsed goal CSV rows.
 *
 * Returns ['byTA' => ..., 'byTarget' => ..., 'byROC' => ..., 'byProject' => ...]
 * or null if input is null/empty.
 *
 * Indexes:
 *   byTA      — Target Audience → site → [rows]
 *   byTarget  — full Target name → site → [rows]
 *   byROC     — ROC code → site → [rows]
 *   byProject — Project → [unique Target Audience names]
 */
function buildGoalLookup($goalsRows) {
    if (!$goalsRows || !is_array($goalsRows) || count($goalsRows) === 0) {
        return null;
    }

    $byTA      = [];
    $byTarget  = [];
    $byROC     = [];
    $byProject = [];

    foreach ($goalsRows as &$row) {
        $ta      = findCol($row, 'Target Audience', 'Target');
        $target  = findCol($row, 'Target');
        $site    = strtoupper(findCol($row, 'Site'));
        $project = findCol($row, 'Project', 'Initiative', 'Campaign Type');
        $rocRaw  = strtoupper(findCol($row, 'ROC Numbers', 'ROC Number', 'ROC', 'ROC Code', 'GL Code'));
        $funding = findCol($row, 'Funding');

        // Split ROC codes by comma, semicolon, or whitespace
        $rocCodes = preg_split('/[,;\s]+/', $rocRaw, -1, PREG_SPLIT_NO_EMPTY);

        // Skip rows without a target audience or site
        if ($ta === '' || $site === '') continue;

        // Attach metadata to the row
        $row['_funding'] = $funding;
        $row['_target']  = $target;
        $row['_roc']     = $rocRaw;

        // Index by Target Audience → site
        $byTA[$ta][$site][] = $row;

        // Index by full Target → site
        if ($target !== '') {
            $byTarget[$target][$site][] = $row;
        }

        // Index by each ROC code → site
        foreach ($rocCodes as $roc) {
            $roc = trim($roc);
            if ($roc !== '') {
                $byROC[$roc][$site][] = $row;
            }
        }

        // Index by Project → unique TAs
        if ($project !== '') {
            if (!isset($byProject[$project])) {
                $byProject[$project] = [];
            }
            if (!in_array($ta, $byProject[$project], true)) {
                $byProject[$project][] = $ta;
            }
        }
    }
    unset($row);

    return [
        'byTA'      => $byTA,
        'byTarget'  => $byTarget,
        'byROC'     => $byROC,
        'byProject' => $byProject,
    ];
}

/* ---------------------------------------------------------------
 * Fuzzy matching — 8-strategy cascade
 * ------------------------------------------------------------- */

/**
 * Find goal entries for a given job type, using a 7-strategy fuzzy match.
 *
 * Returns array of ['targetAudience' => string, 'siteMap' => [site => [rows]]].
 *
 * Strategy priority:
 *   0. Direct ROC code match (highest)
 *   1. Exact TA match in byTA
 *   2. Normalized match (normKey)
 *   3. Compact match (compactKey)
 *   4. Project match (normKey then compactKey against byProject keys)
 *   5. Substring/boundary match (word boundary, min 5 chars)
 *   6. Compact includes (compactKey substring in either direction)
 *   7. Word overlap (≥70% of significant words overlap, min 2 common)
 */
function getGoalEntries($goalLookup, $jobType, $rocCode = null) {
    if (!$goalLookup || $jobType === '') return [];

    $byTA      = $goalLookup['byTA']      ?? [];
    $byTarget  = $goalLookup['byTarget']  ?? [];
    $byROC     = $goalLookup['byROC']     ?? [];
    $byProject = $goalLookup['byProject'] ?? [];

    $results = [];

    // --- Strategy 0: Direct ROC code match ---
    if ($rocCode !== null && $rocCode !== '') {
        $roc = strtoupper(trim($rocCode));
        if (isset($byROC[$roc])) {
            $results[] = [
                'targetAudience' => $roc,
                'siteMap'        => $byROC[$roc],
            ];
            return $results;
        }
    }

    // --- Strategy 1: Exact TA match ---
    if (isset($byTA[$jobType])) {
        $results[] = [
            'targetAudience' => $jobType,
            'siteMap'        => $byTA[$jobType],
        ];
        return $results;
    }

    // --- Strategy 2: Normalized match (normKey) ---
    $jobNorm = normKey($jobType);
    foreach ($byTA as $ta => $siteMap) {
        if (normKey($ta) === $jobNorm) {
            $results[] = [
                'targetAudience' => $ta,
                'siteMap'        => $siteMap,
            ];
            return $results;
        }
    }

    // --- Strategy 3: Compact match (compactKey) ---
    $jobCompact = compactKey($jobType);
    foreach ($byTA as $ta => $siteMap) {
        if (compactKey($ta) === $jobCompact) {
            $results[] = [
                'targetAudience' => $ta,
                'siteMap'        => $siteMap,
            ];
            return $results;
        }
    }

    // --- Strategy 4: Project match (normKey then compactKey) ---
    foreach ($byProject as $proj => $taList) {
        if (normKey($proj) === $jobNorm || compactKey($proj) === $jobCompact) {
            foreach ($taList as $ta) {
                if (isset($byTA[$ta])) {
                    $results[] = [
                        'targetAudience' => $ta,
                        'siteMap'        => $byTA[$ta],
                    ];
                }
            }
            if (!empty($results)) return $results;
        }
    }

    // --- Strategy 5: Substring / word-boundary match (min 5 chars) ---
    foreach ($byTA as $ta => $siteMap) {
        $taNorm = normKey($ta);
        if (strlen($taNorm) < 5 && strlen($jobNorm) < 5) continue;

        // Check if the shorter string appears at a word boundary in the longer
        $shorter = strlen($taNorm) <= strlen($jobNorm) ? $taNorm : $jobNorm;
        $longer  = strlen($taNorm) <= strlen($jobNorm) ? $jobNorm : $taNorm;

        if (strlen($shorter) >= 5) {
            $pattern = '/\b' . preg_quote($shorter, '/') . '\b/i';
            if (preg_match($pattern, $longer)) {
                $results[] = [
                    'targetAudience' => $ta,
                    'siteMap'        => $siteMap,
                ];
            }
        }
    }
    if (!empty($results)) return $results;

    // --- Strategy 6: Compact includes (compactKey substring) ---
    foreach ($byTA as $ta => $siteMap) {
        $taCompact = compactKey($ta);
        if ($taCompact === '' || $jobCompact === '') continue;

        if (strpos($taCompact, $jobCompact) !== false || strpos($jobCompact, $taCompact) !== false) {
            $results[] = [
                'targetAudience' => $ta,
                'siteMap'        => $siteMap,
            ];
        }
    }
    if (!empty($results)) return $results;

    // --- Strategy 7: Word overlap (≥70%, min 2 common significant words) ---
    $jobWords = array_filter(explode(' ', $jobNorm), function ($w) {
        return strlen($w) > 2;
    });
    $jobWordCount = count($jobWords);

    if ($jobWordCount >= 2) {
        foreach ($byTA as $ta => $siteMap) {
            $taWords = array_filter(explode(' ', normKey($ta)), function ($w) {
                return strlen($w) > 2;
            });
            $taWordCount = count($taWords);
            if ($taWordCount < 2) continue;

            $common = count(array_intersect($jobWords, $taWords));
            $maxLen = max($jobWordCount, $taWordCount);

            if ($common >= 2 && ($common / $maxLen) >= 0.7) {
                $results[] = [
                    'targetAudience' => $ta,
                    'siteMap'        => $siteMap,
                ];
            }
        }
    }

    return $results;
}

/* ---------------------------------------------------------------
 * Plan / metric computation
 * ------------------------------------------------------------- */

/**
 * Parse a single goal row into an associative array of metric values.
 */
function computePlanRow($row) {
    return [
        'homesGoal' => (int)ceil(parseNum(findCol($row, 'HOMES GOAL', 'Homes Goal', 'Home Goal', 'Homes'))),
        'rguGoal'   => (int)ceil(parseNum(findCol($row, 'RGU GOAL', 'RGU Goal', 'RGU'))),
        'hsdGoal'   => (int)ceil(parseNum(findCol($row, 'HSD GOAL', 'HSD Goal', 'HSD Sell In Goal', 'New XI Goal'))),
        'xmGoal'    => (int)ceil(parseNum(findCol($row, 'XM GOAL', 'XM Goal', 'XM Sell In Goal', 'XM Lines Goal'))),
        'videoGoal' => (int)ceil(parseNum(findCol($row, 'VIDEO GOAL', 'Video Goal', 'Video Sell In Goal', 'New Video Goal'))),
        'xhGoal'    => (int)ceil(parseNum(findCol($row, 'XH GOAL', 'XH Goal', 'XH Sell In Goal', 'New XH Goal'))),
        'hoursGoal' => (int)ceil(parseNum(findCol($row, 'Hours Goal', 'HOURS GOAL', 'Hour Goal'))),
        'sphGoal'   => parseNum(findCol($row, 'SPH GOAL', 'SPH Goal', 'SPH')),
    ];
}

/**
 * Flatten a siteMap (site → [rows]) into a single flat array of all rows.
 */
function uniqueRowsFromEntry($siteMap) {
    $all = [];
    foreach ($siteMap as $site => $rows) {
        foreach ($rows as $row) {
            $all[] = $row;
        }
    }
    return $all;
}

/**
 * Get total homes-goal from a siteMap (goalEntry).
 * Returns total or null if the sum is 0.
 */
function getPlanGoals($goalEntry) {
    $total = 0;
    $rows  = uniqueRowsFromEntry($goalEntry);
    foreach ($rows as $row) {
        $plan   = computePlanRow($row);
        $total += $plan['homesGoal'];
    }
    return $total > 0 ? $total : null;
}

/**
 * Get total for any metric key from a siteMap (goalEntry).
 *
 * Maps well-known goal names to computePlanRow keys; falls back to
 * pulling the raw column value via parseNum.
 * Returns total or null if the sum is 0.
 */
function getPlanForKey($goalEntry, $metricKey) {
    $keyMap = [
        'HOMES GOAL'       => 'homesGoal',
        'RGU GOAL'         => 'rguGoal',
        'HSD Sell In Goal' => 'hsdGoal',
        'XM GOAL'          => 'xmGoal',
        'VIDEO GOAL'       => 'videoGoal',
        'XH GOAL'          => 'xhGoal',
        'Hours Goal'       => 'hoursGoal',
    ];

    $planKey = $keyMap[$metricKey] ?? null;
    $total   = 0;
    $rows    = uniqueRowsFromEntry($goalEntry);

    foreach ($rows as $row) {
        if ($planKey !== null) {
            $plan   = computePlanRow($row);
            $total += $plan[$planKey];
        } else {
            $total += parseNum($row[$metricKey] ?? '');
        }
    }

    return $total > 0 ? $total : null;
}

/**
 * Sum homes-goal across ALL target audiences in byTA.
 * Returns total or null.
 */
function getGlobalPlanGoals($goalLookup) {
    if (!$goalLookup) return null;

    $total = 0;
    foreach ($goalLookup['byTA'] as $ta => $siteMap) {
        $rows = uniqueRowsFromEntry($siteMap);
        foreach ($rows as $row) {
            $plan   = computePlanRow($row);
            $total += $plan['homesGoal'];
        }
    }
    return $total > 0 ? $total : null;
}

/**
 * Sum a specific metric across ALL target audiences in byTA.
 * Returns total or null.
 */
function getGlobalPlanForKey($goalLookup, $metricKey) {
    if (!$goalLookup) return null;

    $keyMap = [
        'HOMES GOAL'       => 'homesGoal',
        'RGU GOAL'         => 'rguGoal',
        'HSD Sell In Goal' => 'hsdGoal',
        'XM GOAL'          => 'xmGoal',
        'VIDEO GOAL'       => 'videoGoal',
        'XH GOAL'          => 'xhGoal',
        'Hours Goal'       => 'hoursGoal',
    ];

    $planKey = $keyMap[$metricKey] ?? null;
    $total   = 0;

    foreach ($goalLookup['byTA'] as $ta => $siteMap) {
        $rows = uniqueRowsFromEntry($siteMap);
        foreach ($rows as $row) {
            if ($planKey !== null) {
                $plan   = computePlanRow($row);
                $total += $plan[$planKey];
            } else {
                $total += parseNum($row[$metricKey] ?? '');
            }
        }
    }

    return $total > 0 ? $total : null;
}
