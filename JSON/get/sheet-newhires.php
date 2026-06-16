<?php
/**
 * GET /JSON/get/sheet-newhires.php
 * Fetches new-hires CSV from Google Sheets, parses with parseNewHires(), caches, returns JSON.
 * ?refresh=1 forces cache clear.
 */
require_once $_SERVER['DOCUMENT_ROOT'] . '/base.php';
require_once __DIR__ . '/_helpers.php';

header('Content-Type: application/json');

if (!empty($_GET['refresh'])) {
    cache_clear('sheet_newhires');
}

$newHires = getNewHiresFromCache();
echo json_encode($newHires, JSON_NUMERIC_CHECK);
