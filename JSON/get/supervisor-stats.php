<?php
/**
 * GET /JSON/get/supervisor-stats.php?program=X
 * Returns supervisor-level statistics for a given program.
 */
require_once $_SERVER['DOCUMENT_ROOT'] . '/base.php';
require_once __DIR__ . '/_helpers.php';

header('Content-Type: application/json');

$programName = $_GET['program'] ?? '';
if ($programName === '') {
    http_response_code(400);
    echo json_encode(['error' => 'Missing required parameter: program']);
    exit;
}

$programs = getProgramsFromCache();

// Find matching program
$programData = null;
foreach ($programs as $p) {
    if ($p['jobType'] === $programName) {
        $programData = $p;
        break;
    }
}

if ($programData === null) {
    http_response_code(404);
    echo json_encode(['error' => 'Program not found: ' . $programName]);
    exit;
}

$stats = buildSupervisorStats($programData['agents']);
echo json_encode($stats, JSON_NUMERIC_CHECK);
