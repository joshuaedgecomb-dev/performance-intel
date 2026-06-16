<?php
/**
 * CSV Parsing & Formatting Utilities
 * Ported from app.jsx lines 27-62
 */

/**
 * Parse CSV text into an array of associative arrays.
 * Handles quoted fields, UTF-8 BOM, and mixed line endings.
 */
function parseCSV($text) {
    // Strip UTF-8 BOM
    $text = ltrim($text, "\xEF\xBB\xBF");
    $text = trim($text);
    $lines = preg_split('/\r?\n/', $text);
    if (count($lines) < 2) return [];

    // Parse header row
    $headers = array_map(function($h) {
        return trim(trim($h), '"');
    }, str_getcsv($lines[0]));

    $rows = [];
    for ($i = 1; $i < count($lines); $i++) {
        $line = trim($lines[$i]);
        if ($line === '') continue;
        $vals = str_getcsv($line);
        $row = [];
        foreach ($headers as $idx => $h) {
            $row[$h] = isset($vals[$idx]) ? trim(trim($vals[$idx]), '"') : '';
        }
        $rows[] = $row;
    }
    return $rows;
}

/**
 * Parse a percentage string into a float.
 * "95.5%" → 95.5, "" → 0
 */
function parsePct($val) {
    $n = floatval(preg_replace('/[%]/', '', trim($val ?? '0')));
    return is_nan($n) ? 0 : $n;
}

/**
 * Parse a numeric string, stripping commas, %, $.
 */
function parseNum($val) {
    $n = floatval(preg_replace('/[,%$]/', '', trim($val ?? '0')));
    return is_nan($n) ? 0 : $n;
}

/** Format a number with N decimal places */
function fmt($n, $dec = 1) {
    return number_format((float)$n, $dec, '.', '');
}

/** Format as percentage string */
function fmtPct($n) {
    return fmt($n, 1) . '%';
}

/** Format a goal value based on type */
function fmtGoal($val, $fmtType = null) {
    if ($val === null || !is_numeric($val)) return '—';
    if ($fmtType === 'dec2') return number_format((float)$val, 2, '.', '');
    if ($fmtType === 'pct') return number_format((float)$val, 1, '.', '') . '%';
    return number_format(round($val), 0, '.', ',');
}

/**
 * Fetch CSV content from a URL (Google Sheets published CSV).
 * Returns raw text or null on failure.
 */
function fetchCSV($url) {
    if (!$url) return null;
    $ctx = stream_context_create([
        'http' => [
            'timeout' => 30,
            'header' => "User-Agent: PHP\r\n",
        ],
        'ssl' => [
            'verify_peer' => false,
            'verify_peer_name' => false,
        ],
    ]);
    $text = @file_get_contents($url, false, $ctx);
    return $text !== false ? $text : null;
}
