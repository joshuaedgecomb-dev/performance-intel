<?php
/**
 * Shared helper functions for JSON endpoints.
 * Centralises cache-aware data fetching so individual endpoints stay DRY.
 */

require_once $_SERVER['DOCUMENT_ROOT'] . '/includes/cache.php';
require_once $_SERVER['DOCUMENT_ROOT'] . '/includes/csv.php';
require_once $_SERVER['DOCUMENT_ROOT'] . '/includes/normalize.php';
require_once $_SERVER['DOCUMENT_ROOT'] . '/includes/goals.php';
require_once $_SERVER['DOCUMENT_ROOT'] . '/includes/fiscal.php';
require_once $_SERVER['DOCUMENT_ROOT'] . '/includes/programs.php';

// ── Default Google Sheets URLs ──────────────────────────────────────────────

define('DEFAULT_SHEET_AGENTS_URL', 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRagC_XDSQ84y25onmWs6MUOZcEdWZNA6fVRRDFUzNWQp3ginYLtOIQsSrwmbAERkOJ-daTvbHqEtoy/pub?gid=667346347&single=true&output=csv');
define('DEFAULT_SHEET_GOALS_URL', 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRagC_XDSQ84y25onmWs6MUOZcEdWZNA6fVRRDFUzNWQp3ginYLtOIQsSrwmbAERkOJ-daTvbHqEtoy/pub?gid=1685208822&single=true&output=csv');
define('DEFAULT_SHEET_NEWHIRES_URL', 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRagC_XDSQ84y25onmWs6MUOZcEdWZNA6fVRRDFUzNWQp3ginYLtOIQsSrwmbAERkOJ-daTvbHqEtoy/pub?gid=25912283&single=true&output=csv');
define('DEFAULT_SHEET_PRIOR_AGENTS_URL', 'https://docs.google.com/spreadsheets/d/e/2PACX-1vTZkBGVIxieyjBKftqL1oecSaUxRkao-gz2B9q4Z8zCY8hEtSy1M28S00RDCS8JVPgPFXJAv2LbsZru/pub?gid=667346347&single=true&output=csv');
define('DEFAULT_SHEET_PRIOR_GOALS_URL', 'https://docs.google.com/spreadsheets/d/e/2PACX-1vTZkBGVIxieyjBKftqL1oecSaUxRkao-gz2B9q4Z8zCY8hEtSy1M28S00RDCS8JVPgPFXJAv2LbsZru/pub?gid=1685208822&single=true&output=csv');

// ── Config helper ───────────────────────────────────────────────────────────

define('CONFIG_FILE', $_SERVER['DOCUMENT_ROOT'] . '/includes/.config.json');

/**
 * Read a single config value (or all config if $key is null).
 */
function getConfig($key = null, $default = null) {
    $config = [];
    if (file_exists(CONFIG_FILE)) {
        $raw = file_get_contents(CONFIG_FILE);
        $config = json_decode($raw, true) ?: [];
    }
    if ($key === null) return $config;
    return $config[$key] ?? $default;
}

// ── Cache-aware data fetchers ───────────────────────────────────────────────

/**
 * Get normalized agent rows from cache, falling back to a fresh Google Sheets fetch.
 */
function getAgentsFromCache() {
    $cached = cache_get('sheet_agents');
    if ($cached !== null) return $cached;

    $url = getConfig('sheet_agents_url', DEFAULT_SHEET_AGENTS_URL);
    $text = fetchCSV($url);
    if (!$text) return [];

    $rows = parseCSV($text);
    $agents = normalizeAgents($rows);
    cache_set('sheet_agents', $agents, 300);
    return $agents;
}

/**
 * Get raw goal rows from cache, falling back to a fresh Google Sheets fetch.
 */
function getGoalsFromCache() {
    $cached = cache_get('sheet_goals');
    if ($cached !== null) return $cached;

    $url = getConfig('sheet_goals_url', DEFAULT_SHEET_GOALS_URL);
    $text = fetchCSV($url);
    if (!$text) return [];

    $rows = parseCSV($text);
    cache_set('sheet_goals', $rows, 300);
    return $rows;
}

/**
 * Get parsed new-hire rows from cache, falling back to a fresh Google Sheets fetch.
 */
function getNewHiresFromCache() {
    $cached = cache_get('sheet_newhires');
    if ($cached !== null) return $cached;

    $url = getConfig('sheet_newhires_url', DEFAULT_SHEET_NEWHIRES_URL);
    $text = fetchCSV($url);
    if (!$text) return [];

    $rows = parseCSV($text);
    $newHires = parseNewHires($rows);
    cache_set('sheet_newhires', $newHires, 300);
    return $newHires;
}

/**
 * Build and return the goal lookup structure (cached on top of goal rows).
 */
function getGoalLookupFromCache() {
    $cached = cache_get('goal_lookup');
    if ($cached !== null) return $cached;

    $goalRows = getGoalsFromCache();
    $lookup = buildGoalLookup($goalRows);
    if ($lookup) {
        cache_set('goal_lookup', $lookup, 300);
    }
    return $lookup;
}

/**
 * Return an associative array of new hire names (<=60 days) for quick membership tests.
 */
function getNewHireSetFromCache() {
    $newHires = getNewHiresFromCache();
    $set = [];
    foreach ($newHires as $nh) {
        if ($nh['days'] === null || $nh['days'] <= 60) {
            $set[$nh['name']] = true;
        }
    }
    return $set;
}

/**
 * Build all programs (cached).
 */
function getProgramsFromCache() {
    $cached = cache_get('programs_built');
    if ($cached !== null) return $cached;

    $agents     = getAgentsFromCache();
    $goalLookup = getGoalLookupFromCache();
    $newHireSet = getNewHireSetFromCache();
    $programs   = buildPrograms($agents, $goalLookup, $newHireSet);
    cache_set('programs_built', $programs, 300);
    return $programs;
}

/**
 * Get fiscal month info derived from the agent date strings.
 */
function getFiscalInfoFromCache() {
    $cached = cache_get('fiscal_info');
    if ($cached !== null) return $cached;

    $agents = getAgentsFromCache();
    $dates = [];
    foreach ($agents as $a) {
        $d = $a['date'] ?? '';
        if ($d !== '') $dates[] = $d;
    }
    $info = getFiscalMonthInfo($dates);
    if ($info) {
        cache_set('fiscal_info', $info, 300);
    }
    return $info;
}

/**
 * Get prior-month normalized agents from cache.
 */
function getPriorAgentsFromCache() {
    $cached = cache_get('sheet_prior_agents');
    if ($cached !== null) return $cached;

    $url = getConfig('sheet_prior_agents_url', DEFAULT_SHEET_PRIOR_AGENTS_URL);
    $text = fetchCSV($url);
    if (!$text) return [];

    $rows = parseCSV($text);
    $agents = normalizeAgents($rows);
    cache_set('sheet_prior_agents', $agents, 300);
    return $agents;
}

/**
 * Get prior-month goal rows from cache.
 */
function getPriorGoalsFromCache() {
    $cached = cache_get('sheet_prior_goals');
    if ($cached !== null) return $cached;

    $url = getConfig('sheet_prior_goals_url', DEFAULT_SHEET_PRIOR_GOALS_URL);
    $text = fetchCSV($url);
    if (!$text) return [];

    $rows = parseCSV($text);
    cache_set('sheet_prior_goals', $rows, 300);
    return $rows;
}
