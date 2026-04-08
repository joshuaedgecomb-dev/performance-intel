<?php
/**
 * insights.php – Insights & Narrative Engine
 *
 * PHP port of the insights/narrative generation logic.
 * Produces win/opportunity insights and multi-paragraph narratives
 * for individual programs and the overall business.
 *
 * Requires programs.php (which loads normalize.php and goals.php).
 */

require_once __DIR__ . '/programs.php';

// ---------------------------------------------------------------------------
// Helper: build a single insight record
// ---------------------------------------------------------------------------

/**
 * Create a structured insight array.
 *
 * @param  string $type     'win' or 'opportunity'
 * @param  string $priority 'high', 'medium', or 'low'
 * @param  string $category Short label (e.g. 'top-performer', 'density')
 * @param  string $text     Human-readable insight sentence.
 * @return array
 */
function insight($type, $priority, $category, $text) {
    return [
        'type'     => $type,
        'priority' => $priority,
        'category' => $category,
        'text'     => $text,
    ];
}

// ---------------------------------------------------------------------------
// Function 2: generateWinInsights
// ---------------------------------------------------------------------------

/**
 * Generate positive / win insights for a single program.
 *
 * @param  array $program  Program array from buildProgram().
 * @param  int   $minHours Hours threshold for qualification (default 16).
 * @return array           Array of insight arrays.
 */
function generateWinInsights($program, $minHours = 16) {
    $q1Agents  = $program['q1Agents']  ?? [];
    $q2Agents  = $program['q2Agents']  ?? [];
    $regions   = $program['regions']   ?? [];
    $topAgent  = $program['topAgent']  ?? null;
    $qualified = $program['qualified'] ?? [];

    // Filter Q1 and Q2 agents to those meeting the hours threshold
    $q1Qual = array_values(array_filter($q1Agents, function ($a) use ($minHours) {
        return ($a['hours'] ?? 0) >= $minHours;
    }));
    $q2Qual = array_values(array_filter($q2Agents, function ($a) use ($minHours) {
        return ($a['hours'] ?? 0) >= $minHours;
    }));

    // If nobody qualifies, return a single low-priority placeholder
    if (count($q1Qual) === 0 && count($q2Qual) === 0) {
        return [
            insight('win', 'low', 'no-top-performers',
                'No agents currently meet the minimum hours threshold for top-performer recognition.')
        ];
    }

    $insights = [];

    // --- Top agent leading Q1 ---
    if ($topAgent) {
        $name  = $topAgent['agentName'] ?? 'Unknown';
        $hours = number_format($topAgent['hours'] ?? 0, 1);
        $pct   = number_format($topAgent['pctToGoal'] ?? 0, 1);
        $gph   = number_format($topAgent['gph'] ?? ($topAgent['aggGph'] ?? 0), 2);
        $insights[] = insight('win', 'high', 'top-performer',
            "{$name} leads Q1 with {$hours} hours, {$pct}% to goal, and {$gph} GPH.");
    }

    // --- Q1 density (3+ qualified agents) ---
    if (count($q1Qual) >= 3) {
        $firstThree = array_map(function ($a) {
            return $a['agentName'] ?? 'Unknown';
        }, array_slice($q1Qual, 0, 3));
        $nameList = implode(', ', $firstThree);
        $insights[] = insight('win', 'high', 'q1-density',
            count($q1Qual) . " qualified agents in Q1 including {$nameList}.");
    }

    // --- Q2 agents near goal ---
    if (count($q2Qual) > 0) {
        $totalHours = array_sum(array_column($q2Qual, 'hours'));
        $weightedPct = $totalHours > 0
            ? array_sum(array_map(function ($a) {
                return ($a['pctToGoal'] ?? 0) * ($a['hours'] ?? 0);
            }, $q2Qual)) / $totalHours
            : 0;
        $insights[] = insight('win', 'medium', 'q2-near-goal',
            count($q2Qual) . " Q2 agents are near goal with a weighted avg of "
            . number_format($weightedPct, 1) . "% attainment.");
    }

    // --- Multi-region: top region and gap to bottom ---
    if (count($regions) > 1) {
        $top    = $regions[0];
        $bottom = $regions[count($regions) - 1];
        $gap    = round($top['avgPct'] - $bottom['avgPct'], 1);
        $insights[] = insight('win', 'medium', 'top-region',
            ($top['name'] ?? 'Unknown') . " leads regions at "
            . number_format($top['avgPct'], 1) . "% avg attainment ("
            . number_format($gap, 1) . " pt gap to "
            . ($bottom['name'] ?? 'Unknown') . ").");
    }

    // --- Efficiency leader: highest GPH among qualified ---
    if (count($qualified) > 0) {
        $bestGph = null;
        $bestAgent = null;
        foreach ($qualified as $a) {
            $agGph = $a['aggGph'] ?? ($a['gph'] ?? 0);
            if ($bestGph === null || $agGph > $bestGph) {
                $bestGph   = $agGph;
                $bestAgent = $a;
            }
        }
        if ($bestAgent) {
            $insights[] = insight('win', 'medium', 'efficiency-leader',
                ($bestAgent['agentName'] ?? 'Unknown') . " is the efficiency leader at "
                . number_format($bestGph, 2) . " GPH.");
        }
    }

    return $insights;
}

// ---------------------------------------------------------------------------
// Function 3: generateOppInsights
// ---------------------------------------------------------------------------

/**
 * Generate opportunity / risk insights for a single program.
 *
 * @param  array $program    Program array from buildProgram().
 * @param  array $allAgents  Full set of normalized agent rows.
 * @param  array $newHireSet Associative array of new-hire names (name => true).
 * @param  int   $minHours   Hours threshold (default 16).
 * @return array             Array of insight arrays.
 */
function generateOppInsights($program, $allAgents, $newHireSet, $minHours = 16) {
    $q4Agents  = $program['q4Agents']  ?? [];
    $q3Agents  = $program['q3Agents']  ?? [];
    $qualified = $program['qualified'] ?? [];
    $agents    = $program['agents']    ?? [];

    // Filter Q3/Q4 to those meeting the hours threshold
    $q3Qual = array_values(array_filter($q3Agents, function ($a) use ($minHours) {
        return ($a['hours'] ?? 0) >= $minHours;
    }));
    $q4Qual = array_values(array_filter($q4Agents, function ($a) use ($minHours) {
        return ($a['hours'] ?? 0) >= $minHours;
    }));

    // High-hours but low performance: qualified agents under 50% to goal
    $highHoursLow = array_values(array_filter($qualified, function ($a) {
        return ($a['pctToGoal'] ?? 0) < 50;
    }));

    // Under-threshold: unique agents with hours > 0 but < minHours
    $underThresholdAgents = array_values(array_filter(
        collapseToUniqueAgents($agents),
        function ($a) use ($minHours) {
            $h = $a['hours'] ?? 0;
            return $h > 0 && $h < $minHours;
        }
    ));

    // New hires in Q3/Q4 who are qualified
    $newHireOpps = array_values(array_filter($qualified, function ($a) use ($newHireSet, $q3Agents, $q4Agents) {
        $name = $a['agentName'] ?? '';
        if ($name === '' || !isset($newHireSet[$name])) {
            return false;
        }
        // Check if in Q3 or Q4
        $q = $a['quartile'] ?? '';
        return $q === 'Q3' || $q === 'Q4';
    }));

    // If everything is clean, return a single low-priority insight
    if (count($q4Qual) === 0 && count($q3Qual) === 0
        && count($highHoursLow) === 0 && count($underThresholdAgents) < 15
        && count($newHireOpps) === 0) {
        return [
            insight('opportunity', 'low', 'no-concerns',
                'No significant performance concerns identified at this time.')
        ];
    }

    $insights = [];

    // --- Q4 qualified agents (high priority) ---
    if (count($q4Qual) > 0) {
        $firstThree = array_map(function ($a) {
            return $a['agentName'] ?? 'Unknown';
        }, array_slice($q4Qual, 0, 3));
        $nameList   = implode(', ', $firstThree);
        $totalHours = number_format(array_sum(array_column($q4Qual, 'hours')), 1);
        $insights[] = insight('opportunity', 'high', 'q4-agents',
            count($q4Qual) . " Q4 agents with {$minHours}+ hours ({$totalHours} total): {$nameList}.");
    }

    // --- Q3 qualified agents (high priority) ---
    if (count($q3Qual) > 0) {
        $totalHours = array_sum(array_column($q3Qual, 'hours'));
        $weightedPct = $totalHours > 0
            ? array_sum(array_map(function ($a) {
                return ($a['pctToGoal'] ?? 0) * ($a['hours'] ?? 0);
            }, $q3Qual)) / $totalHours
            : 0;

        // Find the lowest performer in Q3
        $lowest = null;
        foreach ($q3Qual as $a) {
            if ($lowest === null || ($a['pctToGoal'] ?? 0) < ($lowest['pctToGoal'] ?? 0)) {
                $lowest = $a;
            }
        }
        $lowestName = $lowest ? ($lowest['agentName'] ?? 'Unknown') : 'Unknown';
        $insights[] = insight('opportunity', 'high', 'q3-agents',
            count($q3Qual) . " Q3 agents (weighted avg " . number_format($weightedPct, 1)
            . "% to goal); lowest: {$lowestName}.");
    }

    // --- High hours, low pctToGoal (< 50%) (medium priority) ---
    if (count($highHoursLow) > 0) {
        $insights[] = insight('opportunity', 'medium', 'high-hours-low-pct',
            count($highHoursLow) . " qualified agents are below 50% to goal despite significant hours.");
    }

    // --- Under-threshold agents >= 15 (medium priority) ---
    if (count($underThresholdAgents) >= 15) {
        $avgHours = count($underThresholdAgents) > 0
            ? array_sum(array_column($underThresholdAgents, 'hours')) / count($underThresholdAgents)
            : 0;
        $insights[] = insight('opportunity', 'medium', 'under-threshold',
            count($underThresholdAgents) . " agents are under the {$minHours}-hour threshold (avg "
            . number_format($avgHours, 1) . " hours).");
    }

    // --- New hire opportunities (medium priority) ---
    if (count($newHireOpps) > 0) {
        $insights[] = insight('opportunity', 'medium', 'new-hire-risk',
            count($newHireOpps) . " new hires are in Q3/Q4 and may need additional coaching.");
    }

    return $insights;
}

// ---------------------------------------------------------------------------
// Function 4: generateNarrative
// ---------------------------------------------------------------------------

/**
 * Generate a multi-paragraph narrative for a single program.
 *
 * @param  array      $program    Program array from buildProgram().
 * @param  array|null $fiscalInfo Fiscal month info from getFiscalMonthInfo().
 * @param  array      $newHireSet Associative array of new-hire names.
 * @param  int        $minHours   Hours threshold (default 16).
 * @return array                  Array of paragraph strings.
 */
function generateNarrative($program, $fiscalInfo, $newHireSet, $minHours = 16) {
    $paragraphs = [];

    $jobType    = $program['jobType']          ?? 'Unknown';
    $totalHours = $program['totalHours']       ?? 0;
    $totalGoals = $program['totalGoals']       ?? 0;
    $gph        = $program['gph']              ?? 0;
    $attainment = $program['attainment']       ?? null;
    $planGoals  = $program['planGoals']        ?? null;
    $healthScore = $program['healthScore']     ?? 0;
    $uniqueCount = $program['uniqueAgentCount'] ?? 0;
    $q1Agents   = $program['q1Agents']         ?? [];
    $q2Agents   = $program['q2Agents']         ?? [];
    $q3Agents   = $program['q3Agents']         ?? [];
    $q4Agents   = $program['q4Agents']         ?? [];
    $regions    = $program['regions']          ?? [];
    $qualified  = $program['qualified']        ?? [];
    $distUnique = $program['distUnique']       ?? ['Q1' => 0, 'Q2' => 0, 'Q3' => 0, 'Q4' => 0];

    $pctElapsed = $fiscalInfo['pctElapsed'] ?? null;

    // --- Opening: status + attainment + pacing ---
    $status = $attainment !== null
        ? ($attainment >= 100 ? 'on track' : ($attainment >= 80 ? 'approaching target' : 'below target'))
        : 'not yet measured against plan';

    $opening = "{$jobType} is currently {$status}.";
    if ($attainment !== null) {
        $opening .= " Attainment stands at " . number_format($attainment, 1) . "%"
            . " ({$totalGoals} homes against a plan of " . number_format($planGoals) . ").";
    }
    if ($pctElapsed !== null) {
        $opening .= " We are " . number_format($pctElapsed, 0) . "% through the fiscal month.";
    }
    $paragraphs[] = $opening;

    // --- Workforce composition: Q1-Q4 breakdown ---
    $q1c = $distUnique['Q1'];
    $q2c = $distUnique['Q2'];
    $q3c = $distUnique['Q3'];
    $q4c = $distUnique['Q4'];
    $composition = "The workforce of {$uniqueCount} unique agents breaks down as: "
        . "{$q1c} in Q1, {$q2c} in Q2, {$q3c} in Q3, and {$q4c} in Q4.";

    $q1Rate = $uniqueCount > 0 ? ($q1c / $uniqueCount) * 100 : 0;
    if ($q1Rate >= 30) {
        $composition .= " Q1 density is strong at " . number_format($q1Rate, 0) . "%.";
    } elseif ($q1Rate >= 20) {
        $composition .= " Q1 rate of " . number_format($q1Rate, 0) . "% is moderate.";
    } else {
        $composition .= " Q1 rate of " . number_format($q1Rate, 0) . "% needs improvement.";
    }
    $paragraphs[] = $composition;

    // --- Site comparison (multi-site) ---
    if (count($regions) > 1) {
        $top    = $regions[0];
        $bottom = $regions[count($regions) - 1];
        $gap    = round($top['avgPct'] - $bottom['avgPct'], 1);
        $site   = ($top['name'] ?? 'Top site') . " leads with "
            . number_format($top['avgPct'], 1) . "% avg attainment, while "
            . ($bottom['name'] ?? 'Bottom site') . " trails at "
            . number_format($bottom['avgPct'], 1) . "% (gap of "
            . number_format($gap, 1) . " points).";
        $paragraphs[] = $site;
    }

    // --- Top performers: name top 3 Q1 with hours and GPH ---
    $q1Qual = array_values(array_filter($q1Agents, function ($a) use ($minHours) {
        return ($a['hours'] ?? 0) >= $minHours;
    }));
    if (count($q1Qual) > 0) {
        $topThree = array_slice($q1Qual, 0, 3);
        $parts = array_map(function ($a) {
            $name  = $a['agentName'] ?? 'Unknown';
            $hours = number_format($a['hours'] ?? 0, 1);
            $agGph = number_format($a['aggGph'] ?? ($a['gph'] ?? 0), 2);
            return "{$name} ({$hours} hrs, {$agGph} GPH)";
        }, $topThree);
        $paragraphs[] = "Top performers: " . implode('; ', $parts) . ".";
    }

    // --- Risk agents: Q4 with minHours+ ---
    $q4Qual = array_values(array_filter($q4Agents, function ($a) use ($minHours) {
        return ($a['hours'] ?? 0) >= $minHours;
    }));
    if (count($q4Qual) > 0) {
        $riskNames = array_map(function ($a) {
            return $a['agentName'] ?? 'Unknown';
        }, array_slice($q4Qual, 0, 5));
        $paragraphs[] = count($q4Qual) . " Q4 agents have {$minHours}+ hours and need attention: "
            . implode(', ', $riskNames) . ".";
    }

    // --- New hires ---
    $newHiresInProgram = $program['newHiresInProgram'] ?? [];
    if (count($newHiresInProgram) > 0) {
        $nhQ1 = 0;
        $nhQ3Q4 = 0;
        foreach ($newHiresInProgram as $a) {
            $q = $a['quartile'] ?? 'Q4';
            if ($q === 'Q1') {
                $nhQ1++;
            } elseif ($q === 'Q3' || $q === 'Q4') {
                $nhQ3Q4++;
            }
        }
        $paragraphs[] = count($newHiresInProgram) . " new hires are active in this program: "
            . "{$nhQ1} in Q1, {$nhQ3Q4} in Q3/Q4.";
    }

    // --- Product mix ---
    $hsd  = $program['totalNewXI']    ?? 0;
    $xm   = $program['totalXmLines']  ?? 0;
    $rgu  = $program['totalRgu']      ?? 0;
    if ($hsd > 0 || $xm > 0 || $rgu > 0) {
        $paragraphs[] = "Product mix: " . number_format($hsd) . " HSD, "
            . number_format($xm) . " XM, " . number_format($rgu) . " RGU.";
    }

    // --- Pacing projection ---
    if ($fiscalInfo && $planGoals && $totalGoals > 0) {
        $pacing = calcPacing(
            $totalGoals,
            $planGoals,
            $fiscalInfo['elapsedBDays'] ?? 0,
            $fiscalInfo['totalBDays'] ?? 0
        );
        if ($pacing) {
            $projected = number_format($pacing['projected']);
            $projPct   = number_format($pacing['projectedPct'], 1);
            $outlook   = $pacing['projectedPct'] >= 100 ? 'on pace to meet plan'
                : ($pacing['projectedPct'] >= 85 ? 'close to plan' : 'at risk of missing plan');
            $paragraphs[] = "Pacing projects {$projected} homes ({$projPct}% of plan). "
                . "The program is {$outlook}.";
        }
    }

    // --- Closing: health score assessment ---
    $grade = $healthScore >= 80 ? 'Healthy'
        : ($healthScore >= 60 ? 'Moderate' : 'Needs Attention');
    $paragraphs[] = "Overall health score: " . number_format($healthScore, 1)
        . " ({$grade}).";

    return $paragraphs;
}

// ---------------------------------------------------------------------------
// Function 5: generateBusinessNarrative
// ---------------------------------------------------------------------------

/**
 * Generate a business-wide narrative.
 *
 * @param  array      $perf       Performance summary with: programs, globalGoals,
 *                                planTotal, totalHours, uniqueAgentCount, regions.
 * @param  array|null $fiscalInfo Fiscal month info.
 * @return array                  Array of paragraph strings.
 */
function generateBusinessNarrative($perf, $fiscalInfo) {
    $paragraphs = [];

    $programs    = $perf['programs']         ?? [];
    $globalGoals = $perf['globalGoals']      ?? null;
    $planTotal   = $perf['planTotal']        ?? null;
    $totalHours  = $perf['totalHours']       ?? 0;
    $agentCount  = $perf['uniqueAgentCount'] ?? 0;
    $regions     = $perf['regions']          ?? [];
    $pctElapsed  = $fiscalInfo['pctElapsed'] ?? null;

    // Overall actual homes across all programs
    $totalHomes = 0;
    foreach ($programs as $p) {
        $totalHomes += $p['totalGoals'] ?? 0;
    }

    $attainment = $planTotal ? ($totalHomes / $planTotal) * 100 : null;

    // --- Opening: overall status ---
    $status = 'in progress';
    if ($attainment !== null) {
        $status = $attainment >= 100 ? 'on track'
            : ($attainment >= 80 ? 'approaching target' : 'below target');
    }
    $opening = "The business is currently {$status} with {$agentCount} active agents"
        . " across " . count($programs) . " programs.";
    if ($attainment !== null) {
        $opening .= " Overall attainment is " . number_format($attainment, 1) . "%"
            . " (" . number_format($totalHomes) . " homes against "
            . number_format($planTotal) . " plan).";
    }
    if ($pctElapsed !== null) {
        $opening .= " The fiscal month is " . number_format($pctElapsed, 0) . "% elapsed.";
    }
    $paragraphs[] = $opening;

    // --- Program ranking: strongest vs needs-attention ---
    if (count($programs) > 0) {
        // Programs are already sorted by attainment desc
        $strongest = $programs[0];
        $weakest   = $programs[count($programs) - 1];

        $strongAtt = $strongest['attainment'] ?? null;
        $weakAtt   = $weakest['attainment']   ?? null;

        $ranking = ($strongest['jobType'] ?? 'Unknown') . " is the strongest program";
        if ($strongAtt !== null) {
            $ranking .= " at " . number_format($strongAtt, 1) . "% attainment";
        }
        $ranking .= ", while " . ($weakest['jobType'] ?? 'Unknown') . " needs attention";
        if ($weakAtt !== null) {
            $ranking .= " at " . number_format($weakAtt, 1) . "%";
        }
        $ranking .= ".";
        $paragraphs[] = $ranking;
    }

    // --- Site summary ---
    if (count($regions) > 1) {
        $top    = $regions[0];
        $bottom = $regions[count($regions) - 1];
        $topName    = $top['name'] ?? 'Top site';
        $bottomName = $bottom['name'] ?? 'Bottom site';
        $topPct     = number_format($top['avgPct'] ?? 0, 1);
        $bottomPct  = number_format($bottom['avgPct'] ?? 0, 1);
        $gap        = round(($top['avgPct'] ?? 0) - ($bottom['avgPct'] ?? 0), 1);
        $paragraphs[] = "{$topName} leads at {$topPct}% avg attainment vs "
            . "{$bottomName} at {$bottomPct}% ({$gap} pt spread).";
    }

    // --- Pacing projection ---
    if ($fiscalInfo && $planTotal && $totalHomes > 0) {
        $pacing = calcPacing(
            $totalHomes,
            $planTotal,
            $fiscalInfo['elapsedBDays'] ?? 0,
            $fiscalInfo['totalBDays'] ?? 0
        );
        if ($pacing) {
            $projected = number_format($pacing['projected']);
            $projPct   = number_format($pacing['projectedPct'], 1);
            $outlook   = $pacing['projectedPct'] >= 100 ? 'on pace'
                : ($pacing['projectedPct'] >= 85 ? 'within reach' : 'at risk');
            $paragraphs[] = "Pacing projects {$projected} homes ({$projPct}% of plan). "
                . "Outlook: {$outlook}.";
        }
    }

    return $paragraphs;
}

// ---------------------------------------------------------------------------
// Function 6: generateBusinessInsights
// ---------------------------------------------------------------------------

/**
 * Generate business-wide insights (wins + opportunities).
 *
 * @param  array $params  Associative array with keys:
 *                        programs, regions, newHireSet, globalGoals, planTotal.
 * @return array          Array of insight arrays.
 */
function generateBusinessInsights($params) {
    $programs   = $params['programs']    ?? [];
    $regions    = $params['regions']     ?? [];
    $newHireSet = $params['newHireSet']  ?? [];
    $globalGoals = $params['globalGoals'] ?? null;
    $planTotal  = $params['planTotal']   ?? null;
    $minHours   = $params['minHours']    ?? 16;

    $insights = [];

    // -----------------------------------------------------------------------
    // Wins
    // -----------------------------------------------------------------------

    // Win: top program (highest attainment)
    if (count($programs) > 0) {
        $top = $programs[0]; // already sorted by attainment desc
        $att = $top['attainment'] ?? null;
        $label = $top['jobType'] ?? 'Unknown';
        if ($att !== null) {
            $insights[] = insight('win', 'high', 'top-program',
                "{$label} leads all programs at " . number_format($att, 1) . "% attainment.");
        } else {
            $insights[] = insight('win', 'medium', 'top-program',
                "{$label} has the highest health score (" . number_format($top['healthScore'] ?? 0, 1) . ").");
        }
    }

    // Win: top region
    if (count($regions) > 0) {
        $topRegion = $regions[0];
        $insights[] = insight('win', 'medium', 'top-region',
            ($topRegion['name'] ?? 'Unknown') . " leads regions at "
            . number_format($topRegion['avgPct'] ?? 0, 1) . "% avg attainment.");
    }

    // Win: total Q1 agent count across all programs
    $totalQ1 = 0;
    foreach ($programs as $p) {
        $totalQ1 += count($p['q1Agents'] ?? []);
    }
    if ($totalQ1 > 0) {
        $insights[] = insight('win', 'medium', 'q1-count',
            "{$totalQ1} agents are in Q1 across all programs.");
    }

    // Win: programs at or above 80% target
    $above80 = array_filter($programs, function ($p) {
        return ($p['attainment'] ?? 0) >= 80;
    });
    if (count($above80) > 0) {
        $names = array_map(function ($p) { return $p['jobType'] ?? 'Unknown'; }, $above80);
        $insights[] = insight('win', 'medium', 'programs-above-80',
            count($above80) . " program(s) at or above 80% target: " . implode(', ', $names) . ".");
    }

    // -----------------------------------------------------------------------
    // Opportunities
    // -----------------------------------------------------------------------

    // Opp: Q4 agents with minHours+ hours across all programs
    $allQ4Qual = [];
    foreach ($programs as $p) {
        $q4 = $p['q4Agents'] ?? [];
        foreach ($q4 as $a) {
            if (($a['hours'] ?? 0) >= $minHours) {
                $allQ4Qual[] = $a;
            }
        }
    }
    if (count($allQ4Qual) > 0) {
        $insights[] = insight('opportunity', 'high', 'q4-agents',
            count($allQ4Qual) . " Q4 agents have {$minHours}+ hours across all programs.");
    }

    // Opp: lowest program
    if (count($programs) > 1) {
        $lowest = $programs[count($programs) - 1];
        $lowAtt = $lowest['attainment'] ?? null;
        $label  = $lowest['jobType'] ?? 'Unknown';
        if ($lowAtt !== null) {
            $insights[] = insight('opportunity', 'high', 'lowest-program',
                "{$label} trails at " . number_format($lowAtt, 1) . "% attainment.");
        } else {
            $insights[] = insight('opportunity', 'medium', 'lowest-program',
                "{$label} has the lowest health score (" . number_format($lowest['healthScore'] ?? 0, 1) . ").");
        }
    }

    // Opp: region lagging by 15+ points from the top
    if (count($regions) > 1) {
        $topPct = $regions[0]['avgPct'] ?? 0;
        foreach (array_slice($regions, 1) as $r) {
            $gap = $topPct - ($r['avgPct'] ?? 0);
            if ($gap >= 15) {
                $insights[] = insight('opportunity', 'high', 'region-gap',
                    ($r['name'] ?? 'Unknown') . " lags by " . number_format($gap, 1)
                    . " points from the top region.");
                break; // report the worst lagging region only
            }
        }
    }

    // Opp: under-threshold agents (>= 15 across all programs)
    $allUnder = [];
    foreach ($programs as $p) {
        $unique = collapseToUniqueAgents($p['agents'] ?? []);
        foreach ($unique as $a) {
            $h = $a['hours'] ?? 0;
            if ($h > 0 && $h < $minHours) {
                $name = $a['agentName'] ?? '';
                if ($name !== '') {
                    $allUnder[$name] = $a;
                }
            }
        }
    }
    if (count($allUnder) >= 15) {
        $insights[] = insight('opportunity', 'medium', 'under-threshold',
            count($allUnder) . " agents across programs are under the {$minHours}-hour threshold.");
    }

    // Opp: new hires active
    $activeNewHires = 0;
    foreach ($programs as $p) {
        $activeNewHires += count($p['newHiresInProgram'] ?? []);
    }
    if ($activeNewHires > 0) {
        $insights[] = insight('opportunity', 'medium', 'new-hires-active',
            "{$activeNewHires} new hires are active and may need monitoring.");
    }

    return $insights;
}
