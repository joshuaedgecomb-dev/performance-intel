<?php
/**
 * GET /JSON/get/programs.php
 * Builds all program summaries from cached agent/goal/new-hire data.
 * Returns the full programs array.
 */
require_once $_SERVER['DOCUMENT_ROOT'] . '/base.php';
require_once __DIR__ . '/_helpers.php';

header('Content-Type: application/json');

if (!empty($_GET['refresh'])) {
    cache_clear('programs_built');
}

$programs = getProgramsFromCache();
echo json_encode($programs, JSON_NUMERIC_CHECK);
