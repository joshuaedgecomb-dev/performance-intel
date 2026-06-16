<?php
/**
 * GET /JSON/get/agent-daily.php?agent=X&program=Y
 * Returns the day-by-day performance profile for a single agent in a program.
 */
require_once $_SERVER['DOCUMENT_ROOT'] . '/base.php';
require_once __DIR__ . '/_helpers.php';

header('Content-Type: application/json');

$agentName = $_GET['agent'] ?? '';
$program   = $_GET['program'] ?? '';

if ($agentName === '' || $program === '') {
    http_response_code(400);
    echo json_encode(['error' => 'Missing required parameters: agent, program']);
    exit;
}

$agents  = getAgentsFromCache();
$profile = buildAgentDailyProfile($agentName, $program, $agents);

echo json_encode($profile, JSON_NUMERIC_CHECK);
