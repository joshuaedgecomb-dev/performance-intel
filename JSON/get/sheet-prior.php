<?php
/**
 * GET /JSON/get/sheet-prior.php
 * Fetches prior-month agent CSV from Google Sheets, normalizes, caches, returns JSON.
 * ?refresh=1 forces cache clear.
 */
require_once $_SERVER['DOCUMENT_ROOT'] . '/base.php';
require_once __DIR__ . '/_helpers.php';

header('Content-Type: application/json');

if (!empty($_GET['refresh'])) {
    cache_clear('sheet_prior_agents');
}

$agents = getPriorAgentsFromCache();
echo json_encode($agents, JSON_NUMERIC_CHECK);
