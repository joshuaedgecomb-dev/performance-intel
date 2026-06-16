<?php
/**
 * GET /JSON/get/sheet-goals.php
 * Fetches goals CSV from Google Sheets, parses, caches, returns raw rows as JSON.
 * ?refresh=1 forces cache clear.
 */
require_once $_SERVER['DOCUMENT_ROOT'] . '/base.php';
require_once __DIR__ . '/_helpers.php';

header('Content-Type: application/json');

if (!empty($_GET['refresh'])) {
    cache_clear('sheet_goals');
}

$goals = getGoalsFromCache();
echo json_encode($goals, JSON_NUMERIC_CHECK);
