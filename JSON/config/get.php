<?php
/**
 * GET /JSON/config/get.php
 * Returns all config values as a JSON object.
 */
require_once $_SERVER['DOCUMENT_ROOT'] . '/base.php';
require_once $_SERVER['DOCUMENT_ROOT'] . '/includes/cache.php';
require_once $_SERVER['DOCUMENT_ROOT'] . '/JSON/get/_helpers.php';

header('Content-Type: application/json');

$config = getConfig();
echo json_encode($config, JSON_NUMERIC_CHECK);
