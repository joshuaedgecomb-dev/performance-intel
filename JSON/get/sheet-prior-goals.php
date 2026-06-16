<?php
/**
 * GET /JSON/get/sheet-prior-goals.php
 * Fetches prior-month goals CSV from Google Sheets, parses, caches, returns JSON.
 * ?refresh=1 forces cache clear.
 */
require_once $_SERVER['DOCUMENT_ROOT'] . '/base.php';
require_once __DIR__ . '/_helpers.php';

header('Content-Type: application/json');

if (!empty($_GET['refresh'])) {
    cache_clear('sheet_prior_goals');
}

$goals = getPriorGoalsFromCache();
echo json_encode($goals, JSON_NUMERIC_CHECK);
