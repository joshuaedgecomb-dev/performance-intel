<?php
/**
 * POST /JSON/config/set.php
 * Accepts POST with key/value pairs. Merges into includes/.config.json.
 * Returns success status.
 */
require_once $_SERVER['DOCUMENT_ROOT'] . '/base.php';
require_once $_SERVER['DOCUMENT_ROOT'] . '/includes/cache.php';
require_once $_SERVER['DOCUMENT_ROOT'] . '/JSON/get/_helpers.php';

header('Content-Type: application/json');

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['error' => 'Method not allowed. Use POST.']);
    exit;
}

// Accept JSON body or form-encoded POST data
$input = json_decode(file_get_contents('php://input'), true);
if (!$input || !is_array($input)) {
    $input = $_POST;
}

if (empty($input)) {
    http_response_code(400);
    echo json_encode(['error' => 'No key/value pairs provided.']);
    exit;
}

// Load existing config, merge, write
$config = getConfig() ?: [];
foreach ($input as $key => $value) {
    $config[$key] = $value;
}

$configFile = $_SERVER['DOCUMENT_ROOT'] . '/includes/.config.json';
$written = file_put_contents($configFile, json_encode($config, JSON_PRETTY_PRINT | JSON_NUMERIC_CHECK));

if ($written === false) {
    http_response_code(500);
    echo json_encode(['error' => 'Failed to write config file.']);
    exit;
}

echo json_encode(['success' => true, 'config' => $config], JSON_NUMERIC_CHECK);
