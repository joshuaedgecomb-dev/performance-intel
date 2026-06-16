<?php
/**
 * programs.php – PHP port of program/region/supervisor building from app.jsx
 *
 * Provides program construction, region aggregation, supervisor stats,
 * weekly rollups, Spanish Callback stats, and health scoring.
 */

require_once __DIR__ . '/normalize.php';
require_once __DIR__ . '/goals.php';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

$GOAL_METRICS = [
    ['goalKey' => 'Hours Goal',       'label' => 'Hours',     'actualKey' => 'hours',    'mode' => 'sum', 'fmt' => 'num'],
    ['goalKey' => 'SPH GOAL',         'label' => 'SPH / GPH', 'actualKey' => 'gph',      'mode' => 'avg', 'fmt' => 'dec2'],
    ['goalKey' => 'HOMES GOAL',       'label' => 'Homes',     'actualKey' => 'goals',    'mode' => 'sum', 'fmt' => 'num'],
    ['goalKey' => 'RGU GOAL',         'label' => 'RGU',       'actualKey' => 'rgu',      'mode' => 'sum', 'fmt' => 'num'],
    ['goalKey' => 'HSD Sell In Goal', 'label' => 'New XI',    'actualKey' => 'newXI',    'mode' => 'sum', 'fmt' => 'num'],
    ['goalKey' => 'XM GOAL',          'label' => 'XM Lines',  'actualKey' => 'xmLines',  'mode' => 'sum', 'fmt' => 'num'],
    ['goalKey' => 'VIDEO GOAL',       'label' => 'Video',     'actualKey' => 'newVideo', 'mode' => 'sum', 'fmt' => 'num'],
    ['goalKey' => 'XH GOAL',          'label' => 'XH',        'actualKey' => 'newXH',    'mode' => 'sum', 'fmt' => 'num'],
    ['goalKey' => 'Projected Phone',  'label' => 'Phone',     'actualKey' => null,       'mode' => null,  'fmt' => 'num'],
];

$REGION_TO_SITE = [
    'SD-Xfinity'        => 'DR',
    'Belize City-XOTM'  => 'BZ',
    'OW-XOTM'           => 'BZ',
    'San Ignacio-XOTM'  => 'BZ',
];

// ---------------------------------------------------------------------------
// Function 1: getActual – compute actual metric value from agent rows
// ---------------------------------------------------------------------------

/**
 * Compute the actual value for a given metric key across agent rows.
 *
 * @param  array       $agents    Normalized agent rows.
 * @param  string|null $actualKey Metric key ('hours','gph','goals','rgu','newXI','xmLines','newXH','newVideo').
 * @return float|int|null
 */
function getActual($agents, $actualKey) {
    if ($actualKey === null) {
        return null;
    }

    switch ($actualKey) {
        case 'hours':
            return array_sum(array_column($agents, 'hours'));

        case 'gph':
            $totalHours = array_sum(array_column($agents, 'hours'));
            if ($totalHours <= 0) {
                return 0;
            }
            return array_sum(array_column($agents, 'goals')) / $totalHours;

        case 'goals':
            return array_sum(array_column($agents, 'goals'));

        case 'rgu':
            return array_sum(array_column($agents, 'rgu'));

        case 'newXI':
            $hasAny = false;
            $sum = 0;
            foreach ($agents as $a) {
                $val = $a['newXI'] ?? 0;
                $sum += $val;
                if ($val > 0) $hasAny = true;
            }
            return $hasAny ? $sum : null;

        case 'xmLines':
            $hasAny = false;
            $sum = 0;
            foreach ($agents as $a) {
                $val = $a['xmLines'] ?? 0;
                $sum += $val;
                if ($val > 0) $hasAny = true;
            }
            return $hasAny ? $sum : null;

        case 'newXH':
            $hasAny = false;
            $sum = 0;
            foreach ($agents as $a) {
                $val = $a['newXH'] ?? 0;
                $sum += $val;
                if ($val > 0) $hasAny = true;
            }
            return $hasAny ? $sum : null;

        case 'newVideo':
            $hasAny = false;
            $sum = 0;
            foreach ($agents as $a) {
                $val = $a['newVideo'] ?? 0;
                $sum += $val;
                if ($val > 0) $hasAny = true;
            }
            return $hasAny ? $sum : null;

        default:
            return null;
    }
}

// ---------------------------------------------------------------------------
// Function 2: buildRegions – group agents by region with quartile stats
// ---------------------------------------------------------------------------

/**
 * Group agents by region and compute per-region statistics.
 * Returns array sorted by avgPct descending.
 *
 * @param  array $agents  Normalized agent rows.
 * @return array          Array of region stat associative arrays.
 */
function buildRegions($agents) {
    // Group agents by region
    $map = [];
    foreach ($agents as $a) {
        $r = $a['region'] ?? 'Unknown';
        if (!isset($map[$r])) {
            $map[$r] = [];
        }
        $map[$r][] = $a;
    }

    $regions = [];
    foreach ($map as $name => $aa) {
        $count = count($aa);
        $totalHours = 0;
        $totalGoals = 0;
        $sumPct = 0;
        $sumGph = 0;

        foreach ($aa as $a) {
            $totalHours += $a['hours'];
            $totalGoals += $a['goals'];
            $sumPct += $a['pctToGoal'] ?? 0;
            $sumGph += $a['gph'] ?? 0;
        }

        $avgPct = $count > 0 ? $sumPct / $count : 0;
        $avgGPH = $count > 0 ? $sumGph / $count : 0;

        $dist = quartileDist($aa);

        // Unique agent names in Q1
        $q1Names = [];
        $q4Names = [];
        $allNames = [];
        foreach ($aa as $a) {
            $aName = $a['agentName'] ?? '';
            if ($aName === '') continue;
            $allNames[$aName] = true;
            $q = $a['quartile'] ?? 'Q4';
            if ($q === 'Q1') $q1Names[$aName] = true;
            if ($q === 'Q4') $q4Names[$aName] = true;
        }

        $regions[] = [
            'name'         => $name,
            'count'        => $count,
            'totalHours'   => $totalHours,
            'totalGoals'   => $totalGoals,
            'avgPct'       => $avgPct,
            'avgGPH'       => $avgGPH,
            'q1Count'      => $dist['Q1'],
            'q2Count'      => $dist['Q2'],
            'q3Count'      => $dist['Q3'],
            'q4Count'      => $dist['Q4'],
            'uniqueQ1'     => count($q1Names),
            'uniqueQ4'     => count($q4Names),
            'uniqueAgents' => count($allNames),
        ];
    }

    // Sort by avgPct descending
    usort($regions, function ($a, $b) {
        return $b['avgPct'] <=> $a['avgPct'];
    });

    return $regions;
}

// ---------------------------------------------------------------------------
// Function 3: calculateHealthScore – composite health metric
// ---------------------------------------------------------------------------

/**
 * Calculate composite health score.
 * 40% attainment (capped at 150), 30% Q1 rate, 20% hours utilization, 10% stability.
 * If attainment is null, use q1Rate for that component.
 *
 * @param  float|null $attainment       Goal attainment percentage.
 * @param  float      $q1Rate           Q1 agent rate percentage.
 * @param  float      $hoursUtilization Hours utilization percentage.
 * @param  float      $stability        Stability score (100 - variance).
 * @return float
 */
function calculateHealthScore($attainment, $q1Rate, $hoursUtilization, $stability) {
    $att = min($attainment ?? $q1Rate, 150);
    return (
        $att              * 0.40 +
        $q1Rate           * 0.30 +
        $hoursUtilization * 0.20 +
        $stability        * 0.10
    );
}

// ---------------------------------------------------------------------------
// Function 4: buildProgram – main program builder
// ---------------------------------------------------------------------------

/**
 * Build a rich program object for a single job type.
 *
 * @param  array  $agents      Normalized rows for this job type.
 * @param  string $jobType     The job type name.
 * @param  array  $goalEntries Array of ['targetAudience' => ..., 'siteMap' => ...].
 * @param  array  $newHireSet  Associative array of new hire names (name => true).
 * @param  int    $minHours    Hours threshold for qualification (default 16).
 * @return array               Associative array with all program fields.
 */
function buildProgram($agents, $jobType, $goalEntries, $newHireSet, $minHours = 16) {
    // Combine all goalEntry siteMaps into one combinedSiteMap
    $combinedSiteMap = [];
    foreach ($goalEntries as $entry) {
        $siteMap = $entry['siteMap'] ?? [];
        foreach ($siteMap as $site => $rows) {
            if (!isset($combinedSiteMap[$site])) {
                $combinedSiteMap[$site] = [];
            }
            foreach ($rows as $row) {
                $combinedSiteMap[$site][] = $row;
            }
        }
    }
    $goalEntry = count($combinedSiteMap) > 0 ? $combinedSiteMap : null;

    // Deduplicate: one entry per unique agent (hours/goals summed across all rows)
    $uniqueAgents = collapseToUniqueAgents($agents);

    // Filter qualified (hours >= minHours)
    $qualified = array_filter($uniqueAgents, function ($a) use ($minHours) {
        return $a['hours'] >= $minHours;
    });
    $qualified = array_values($qualified);

    // Q1-Q4 by quartile
    $q1 = array_values(array_filter($uniqueAgents, function ($a) { return ($a['quartile'] ?? '') === 'Q1'; }));
    $q2 = array_values(array_filter($uniqueAgents, function ($a) { return ($a['quartile'] ?? '') === 'Q2'; }));
    $q3 = array_values(array_filter($uniqueAgents, function ($a) { return ($a['quartile'] ?? '') === 'Q3'; }));
    $q4 = array_values(array_filter($uniqueAgents, function ($a) { return ($a['quartile'] ?? '') === 'Q4'; }));

    // Sort Q1 and Q4 by hours descending
    usort($q1, function ($a, $b) { return $b['hours'] <=> $a['hours']; });
    usort($q2, function ($a, $b) { return $b['hours'] <=> $a['hours']; });
    usort($q4, function ($a, $b) { return $b['hours'] <=> $a['hours']; });

    // Unique names count
    $uniqueNameCount = uniqueNames($agents);

    // Totals from raw agent rows
    $totalHours   = array_sum(array_column($agents, 'hours'));
    $totalGoals   = array_sum(array_column($agents, 'goals'));
    $gph          = $totalHours > 0 ? $totalGoals / $totalHours : 0;

    // Quartile distributions
    $dist       = quartileDist($agents);
    $distUnique = uniqueQuartileDist($agents);

    // Use deduplicated arrays for rates
    $uniqueQ1Count    = count($q1);
    $q1Rate           = $uniqueNameCount > 0 ? ($uniqueQ1Count / $uniqueNameCount) * 100 : 0;
    $hoursUtilization = $uniqueNameCount > 0 ? (count($qualified) / $uniqueNameCount) * 100 : 0;

    // Build regions
    $regions  = buildRegions($agents);
    $variance = count($regions) > 1
        ? $regions[0]['avgPct'] - $regions[count($regions) - 1]['avgPct']
        : 0;
    $stability = max(0, 100 - $variance);

    // Goals attainment
    $actGoals   = $totalGoals;
    $planGoals  = getPlanGoals($goalEntry);
    $attainment = $planGoals ? ($actGoals / $planGoals) * 100 : null;

    // Health score
    $healthScore = calculateHealthScore($attainment, $q1Rate, $hoursUtilization, $stability);

    // Top and worst agents
    $topAgent   = !empty($q1) ? $q1[0] : null;
    $worstAgent = null;
    // First try Q4 agents with minHours+ hours
    foreach ($q4 as $a) {
        if ($a['hours'] >= $minHours) {
            $worstAgent = $a;
            break;
        }
    }
    if ($worstAgent === null && !empty($q4)) {
        $worstAgent = $q4[0];
    }

    // Sub-metric totals
    $totalNewXI    = array_sum(array_column($agents, 'newXI'));
    $totalXmLines  = array_sum(array_column($agents, 'xmLines'));
    $totalNewXH    = array_sum(array_column($agents, 'newXH'));
    $totalNewVideo = array_sum(array_column($agents, 'newVideo'));
    $totalRgu      = array_sum(array_column($agents, 'rgu'));

    // Sub-metric flags
    $hasNewXI   = false;
    $hasXMLines = false;
    $hasNewXH   = false;
    $hasNewVideo = false;
    foreach ($agents as $a) {
        if (($a['newXI'] ?? 0) > 0)    $hasNewXI   = true;
        if (($a['xmLines'] ?? 0) > 0)  $hasXMLines = true;
        if (($a['newXH'] ?? 0) > 0)    $hasNewXH   = true;
        if (($a['newVideo'] ?? 0) > 0)  $hasNewVideo = true;
    }

    // New hires in this program (unique agents whose name is in newHireSet)
    $newHiresInProgram = [];
    foreach ($uniqueAgents as $a) {
        $name = $a['agentName'] ?? '';
        if ($name !== '' && isset($newHireSet[$name])) {
            $newHiresInProgram[] = $a;
        }
    }

    return [
        'jobType'          => $jobType,
        'agents'           => $agents,
        'regions'          => $regions,
        // Counts
        'totalRowCount'    => count($agents),
        'uniqueAgentCount' => $uniqueNameCount,
        'totalHours'       => $totalHours,
        'totalGoals'       => $actGoals,
        'gph'              => $gph,
        // Sub-metric totals
        'totalNewXI'       => $totalNewXI,
        'totalXmLines'     => $totalXmLines,
        'totalNewXH'       => $totalNewXH,
        'totalNewVideo'    => $totalNewVideo,
        'totalRgu'         => $totalRgu,
        // Distribution
        'dist'             => $dist,
        'distUnique'       => $distUnique,
        'q1Rate'           => $q1Rate,
        'hoursUtilization' => $hoursUtilization,
        'stability'        => $stability,
        'healthScore'      => $healthScore,
        // Filtered sets
        'qualified'        => $qualified,
        'q1Agents'         => $q1,
        'q2Agents'         => $q2,
        'q3Agents'         => $q3,
        'q4Agents'         => $q4,
        'topAgent'         => $topAgent,
        'worstAgent'       => $worstAgent,
        // Goals
        'goalEntry'        => $goalEntry,
        'goalEntries'      => $goalEntries,
        'planGoals'        => $planGoals,
        'actGoals'         => $actGoals,
        'attainment'       => $attainment,
        // Sub-metric flags
        'hasNewXI'         => $hasNewXI,
        'hasXMLines'       => $hasXMLines,
        'hasNewXH'         => $hasNewXH,
        'hasNewVideo'      => $hasNewVideo,
        // New hires
        'newHiresInProgram' => $newHiresInProgram,
    ];
}

// ---------------------------------------------------------------------------
// Function 5: buildPrograms – build all programs from agent data
// ---------------------------------------------------------------------------

/**
 * Build program objects for every job type.
 * Filters out Spanish Callback agents (tracked separately).
 * Matches goals via ROC codes first, then falls back to name-based matching.
 * Returns array sorted by attainment desc (or healthScore if no attainment).
 *
 * @param  array      $agents      Full set of normalized agent rows.
 * @param  array|null $goalLookup  Goal lookup from buildGoalLookup().
 * @param  array      $newHireSet  Associative array of new hire names (name => true).
 * @param  int        $minHours    Hours threshold (default 16).
 * @return array                   Array of program associative arrays.
 */
function buildPrograms($agents, $goalLookup, $newHireSet, $minHours = 16) {
    // Filter out Spanish Callback agents
    $mainAgents = array_filter($agents, function ($a) {
        return !($a['isSpanishCallback'] ?? false);
    });
    $mainAgents = array_values($mainAgents);

    // Get unique job types, sorted
    $jobTypes = [];
    foreach ($mainAgents as $a) {
        $jt = $a['jobType'] ?? '';
        if ($jt !== '') {
            $jobTypes[$jt] = true;
        }
    }
    $jobTypes = array_keys($jobTypes);
    sort($jobTypes);

    $programs = [];
    foreach ($jobTypes as $jt) {
        // Get agents for this job type
        $progAgents = array_values(array_filter($mainAgents, function ($a) use ($jt) {
            return ($a['jobType'] ?? '') === $jt;
        }));

        // Collect unique ROC codes from agents
        $agentRocs = [];
        foreach ($progAgents as $a) {
            $roc = $a['rocCode'] ?? '';
            if ($roc !== '' && !isset($agentRocs[$roc])) {
                $agentRocs[$roc] = true;
            }
        }
        $agentRocs = array_keys($agentRocs);

        $goalEntries = [];
        if ($goalLookup) {
            // Try ROC-based matching first if agents have ROC codes
            if (count($agentRocs) > 0) {
                foreach ($agentRocs as $roc) {
                    $rocEntries = getGoalEntries($goalLookup, $jt, $roc);
                    foreach ($rocEntries as $e) {
                        // Avoid duplicates by targetAudience
                        $isDup = false;
                        foreach ($goalEntries as $existing) {
                            if ($existing['targetAudience'] === $e['targetAudience']) {
                                $isDup = true;
                                break;
                            }
                        }
                        if (!$isDup) {
                            $goalEntries[] = $e;
                        }
                    }
                }
            }
            // Fall back to name-based matching if no ROC matches found
            if (count($goalEntries) === 0) {
                $goalEntries = getGoalEntries($goalLookup, $jt);
            }
        }

        $programs[] = buildProgram($progAgents, $jt, $goalEntries, $newHireSet, $minHours);
    }

    // Sort by attainment desc (or healthScore if no attainment)
    usort($programs, function ($a, $b) {
        $aAtt = $a['attainment'];
        $bAtt = $b['attainment'];
        if ($aAtt !== null && $bAtt !== null) {
            return $bAtt <=> $aAtt;
        }
        // Programs with attainment sort before those without
        if ($aAtt !== null && $bAtt === null) return -1;
        if ($aAtt === null && $bAtt !== null) return 1;
        return $b['healthScore'] <=> $a['healthScore'];
    });

    return $programs;
}

// ---------------------------------------------------------------------------
// Function 6: buildSpanishCallbackStats – SC comparative stats
// ---------------------------------------------------------------------------

/**
 * Build Spanish Callback statistics.
 *
 * @param  array $agents  Full set of normalized agent rows.
 * @return array|null     Stats array, or null if no SC agents.
 */
function buildSpanishCallbackStats($agents) {
    // Filter to isSpanishCallback rows
    $scAgents = array_filter($agents, function ($a) {
        return !empty($a['isSpanishCallback']);
    });
    $scAgents = array_values($scAgents);

    if (count($scAgents) === 0) {
        return null;
    }

    $totalHours = array_sum(array_column($scAgents, 'hours'));
    $totalGoals = array_sum(array_column($scAgents, 'goals'));
    $gph        = $totalHours > 0 ? $totalGoals / $totalHours : 0;

    // Unique names
    $uNames = [];
    foreach ($scAgents as $a) {
        $name = $a['agentName'] ?? '';
        if ($name !== '') {
            $uNames[$name] = true;
        }
    }
    $uNames = array_keys($uNames);

    // Per-agent rollup
    $agentMap = [];
    foreach ($scAgents as $a) {
        $name = $a['agentName'] ?? '';
        if ($name === '') continue;
        if (!isset($agentMap[$name])) {
            $agentMap[$name] = [
                'hours'      => 0,
                'goals'      => 0,
                'goalsNum'   => 0,
                'supervisor' => $a['supervisor'] ?? '',
                'region'     => $a['region'] ?? '',
            ];
        }
        $agentMap[$name]['hours']    += $a['hours'];
        $agentMap[$name]['goals']    += $a['goals'];
        $agentMap[$name]['goalsNum'] += $a['goalsNum'] ?? 0;
    }

    $agentList = [];
    foreach ($agentMap as $name => $d) {
        if ($d['hours'] <= 0) continue;
        $agGph = $d['hours'] > 0 ? $d['goals'] / $d['hours'] : 0;
        $pct   = $d['goalsNum'] > 0 ? ($d['goals'] / $d['goalsNum']) * 100 : 0;
        $agentList[] = array_merge($d, [
            'name'     => $name,
            'agGph'    => $agGph,
            'pct'      => $pct,
            'quartile' => getQuartile($pct),
        ]);
    }

    // Sort by GPH descending
    usort($agentList, function ($a, $b) {
        return $b['agGph'] <=> $a['agGph'];
    });

    // Weekly trend rollup
    $weekMap = [];
    foreach ($scAgents as $a) {
        $wk = ($a['weekNum'] ?? '') ?: '?';
        if (!isset($weekMap[$wk])) {
            $weekMap[$wk] = ['goals' => 0, 'hours' => 0];
        }
        $weekMap[$wk]['goals'] += $a['goals'];
        $weekMap[$wk]['hours'] += $a['hours'];
    }

    $WEEK_ORDER = ['52', '4', '5', '6', '7', '8', '9', '10'];
    $weekEntries = [];
    foreach ($weekMap as $wk => $d) {
        $weekEntries[] = [
            'week'  => $wk,
            'goals' => $d['goals'],
            'hours' => $d['hours'],
            'gph'   => $d['hours'] > 0 ? $d['goals'] / $d['hours'] : 0,
        ];
    }
    // Sort by WEEK_ORDER (descending index, matching JS logic)
    usort($weekEntries, function ($a, $b) use ($WEEK_ORDER) {
        $ai = array_search($a['week'], $WEEK_ORDER);
        $bi = array_search($b['week'], $WEEK_ORDER);
        $ai = $ai === false ? 99 : $ai;
        $bi = $bi === false ? 99 : $bi;
        return $bi - $ai;
    });

    // Unique quartile distribution from agentList
    $distU = ['Q1' => 0, 'Q2' => 0, 'Q3' => 0, 'Q4' => 0];
    foreach ($agentList as $a) {
        $q = $a['quartile'] ?? 'Q4';
        if (isset($distU[$q])) {
            $distU[$q]++;
        }
    }

    return [
        'totalHours'  => $totalHours,
        'totalGoals'  => $totalGoals,
        'gph'         => $gph,
        'uNames'      => $uNames,
        'agentList'   => $agentList,
        'weeklyTrend' => $weekEntries,
        'distU'       => $distU,
    ];
}

// ---------------------------------------------------------------------------
// Function 7: buildSupervisorStats – per-supervisor team aggregation
// ---------------------------------------------------------------------------

/**
 * Build supervisor-level statistics.
 * Groups agents by supervisor and computes per-team metrics.
 * Returns array sorted by GPH descending.
 *
 * @param  array $agents  Normalized agent rows (typically for one program).
 * @return array          Array of supervisor stat associative arrays.
 */
function buildSupervisorStats($agents) {
    // Group rows by supervisor, then by agentName
    $map = [];
    foreach ($agents as $a) {
        $sup  = ($a['supervisor'] ?? '') ?: 'Unknown';
        $name = $a['agentName'] ?? '';
        if (!isset($map[$sup])) {
            $map[$sup] = [];
        }
        if (!isset($map[$sup][$name])) {
            $map[$sup][$name] = [];
        }
        $map[$sup][$name][] = $a;
    }

    $result = [];
    foreach ($map as $supervisor => $agentRows) {
        // Build agentList: per-agent rollup
        $agentList = [];
        foreach ($agentRows as $name => $rows) {
            $totalGoals = 0;
            $totalHours = 0;
            $totalHsd   = 0;
            $totalXm    = 0;
            foreach ($rows as $r) {
                $totalGoals += $r['goals'];
                $totalHours += $r['hours'];
                $totalHsd   += $r['newXI'] ?? 0;
                $totalXm    += $r['xmLines'] ?? 0;
            }
            $aggGph  = $totalHours > 0 ? $totalGoals / $totalHours : 0;
            $region  = $rows[0]['region'] ?? '';
            $quartile = $rows[0]['quartile'] ?? 'Q4';

            $agentList[] = [
                'agentName'  => $name,
                'totalGoals' => $totalGoals,
                'totalHours' => $totalHours,
                'aggGph'     => $aggGph,
                'quartile'   => $quartile,
                'totalHsd'   => $totalHsd,
                'totalXm'    => $totalXm,
                'region'     => $region,
            ];
        }

        // Team totals from agentList
        $teamGoals = 0;
        $teamHours = 0;
        $teamHsd   = 0;
        $teamXm    = 0;
        foreach ($agentList as $a) {
            $teamGoals += $a['totalGoals'];
            $teamHours += $a['totalHours'];
            $teamHsd   += $a['totalHsd'];
            $teamXm    += $a['totalXm'];
        }
        $teamGph = $teamHours > 0 ? $teamGoals / $teamHours : 0;

        // Quartile distribution
        $distU = ['Q1' => 0, 'Q2' => 0, 'Q3' => 0, 'Q4' => 0];
        foreach ($agentList as $a) {
            $q = $a['quartile'] ?? 'Q4';
            if (isset($distU[$q])) {
                $distU[$q]++;
            }
        }

        $uNames = count($agentList);
        $q1Rate = $uNames > 0 ? ($distU['Q1'] / $uNames) * 100 : 0;

        // Keep all raw rows for this supervisor (for weekly rollup)
        $supRows = array_values(array_filter($agents, function ($a) use ($supervisor) {
            return (($a['supervisor'] ?? '') ?: 'Unknown') === $supervisor;
        }));

        // Sort agents by hours descending
        usort($agentList, function ($a, $b) {
            return $b['totalHours'] <=> $a['totalHours'];
        });

        $result[] = [
            'supervisor'  => $supervisor,
            'totalGoals'  => $teamGoals,
            'totalHours'  => $teamHours,
            'totalHsd'    => $teamHsd,
            'totalXm'     => $teamXm,
            'gph'         => $teamGph,
            'distU'       => $distU,
            'uNames'      => $uNames,
            'q1Rate'      => $q1Rate,
            'rows'        => $supRows,
            'agentList'   => $agentList,
        ];
    }

    // Sort supervisors by GPH descending
    usort($result, function ($a, $b) {
        return $b['gph'] <=> $a['gph'];
    });

    return $result;
}

// ---------------------------------------------------------------------------
// Function 8: buildWeeklyRollup – weekly data by supervisor and program-wide
// ---------------------------------------------------------------------------

/**
 * Build weekly rollup data.
 *
 * @param  array $agents  Normalized agent rows (typically for one program).
 * @return array          ['weeks' => [...], 'bySupervisor' => [...], 'programWeekly' => [...]]
 */
function buildWeeklyRollup($agents) {
    $WEEK_ORDER = ['52', '4', '5', '6', '7', '8', '9', '10'];

    // Get unique weeks
    $weeksSet = [];
    foreach ($agents as $a) {
        $wk = $a['weekNum'] ?? '';
        if ($wk !== '') {
            $weeksSet[$wk] = true;
        }
    }
    $weeks = array_keys($weeksSet);

    // Sort weeks by WEEK_ORDER (descending index, matching JS sort)
    usort($weeks, function ($a, $b) use ($WEEK_ORDER) {
        $ai = array_search($a, $WEEK_ORDER);
        $bi = array_search($b, $WEEK_ORDER);
        $ai = $ai === false ? 99 : $ai;
        $bi = $bi === false ? 99 : $bi;
        return $bi - $ai;
    });

    // Build supervisor × week map
    $supMap = [];
    foreach ($agents as $a) {
        $sup = ($a['supervisor'] ?? '') ?: 'Unknown';
        $wk  = $a['weekNum'] ?? '';
        if ($wk === '') continue;

        if (!isset($supMap[$sup])) {
            $supMap[$sup] = [];
        }
        if (!isset($supMap[$sup][$wk])) {
            $supMap[$sup][$wk] = ['goals' => 0, 'hours' => 0, 'agentRows' => []];
        }
        $supMap[$sup][$wk]['goals'] += $a['goals'];
        $supMap[$sup][$wk]['hours'] += $a['hours'];
        $supMap[$sup][$wk]['agentRows'][] = $a;
    }

    // Build bySupervisor: for each supervisor, an array of weekly entries
    $bySupervisor = [];
    foreach ($supMap as $sup => $wkMap) {
        $bySupervisor[$sup] = [];
        foreach ($weeks as $wk) {
            $d = $wkMap[$wk] ?? ['goals' => 0, 'hours' => 0, 'agentRows' => []];
            $gph = $d['hours'] > 0 ? $d['goals'] / $d['hours'] : null;
            $dU  = uniqueQuartileDist($d['agentRows']);
            $uN  = uniqueNames($d['agentRows']);
            $q1R = $uN > 0 ? ($dU['Q1'] / $uN) * 100 : 0;

            $bySupervisor[$sup][] = [
                'week'       => $wk,
                'goals'      => $d['goals'],
                'hours'      => $d['hours'],
                'gph'        => $gph,
                'q1Rate'     => $q1R,
                'agentCount' => $uN,
            ];
        }
    }

    // Program-level weekly rollup (all agents combined)
    $programWeekly = [];
    foreach ($weeks as $wk) {
        $wa = array_values(array_filter($agents, function ($a) use ($wk) {
            return ($a['weekNum'] ?? '') === $wk;
        }));

        $g  = array_sum(array_column($wa, 'goals'));
        $h  = array_sum(array_column($wa, 'hours'));
        $dU = uniqueQuartileDist($wa);
        $uN = uniqueNames($wa);

        $programWeekly[] = [
            'week'       => $wk,
            'goals'      => $g,
            'hours'      => $h,
            'gph'        => $h > 0 ? $g / $h : null,
            'distU'      => $dU,
            'agentCount' => $uN,
        ];
    }

    return [
        'weeks'          => $weeks,
        'bySupervisor'   => $bySupervisor,
        'programWeekly'  => $programWeekly,
    ];
}
