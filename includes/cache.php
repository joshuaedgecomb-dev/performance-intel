<?php
/**
 * Simple file-based cache for parsed Google Sheets data.
 * Uses PHP session + temp files for cross-request caching.
 */

define('CACHE_DIR', sys_get_temp_dir() . '/perf_intel_cache');

if (!is_dir(CACHE_DIR)) {
    @mkdir(CACHE_DIR, 0755, true);
}

/**
 * Get cached data by key. Returns null if expired or missing.
 */
function cache_get($key) {
    $file = CACHE_DIR . '/' . md5($key) . '.json';
    if (!file_exists($file)) return null;

    $data = json_decode(file_get_contents($file), true);
    if (!$data || !isset($data['expires']) || !isset($data['value'])) return null;

    if (time() > $data['expires']) {
        @unlink($file);
        return null;
    }
    return $data['value'];
}

/**
 * Set cached data with TTL in seconds (default 5 minutes).
 */
function cache_set($key, $value, $ttl = 300) {
    $file = CACHE_DIR . '/' . md5($key) . '.json';
    $data = [
        'key' => $key,
        'expires' => time() + $ttl,
        'value' => $value,
    ];
    file_put_contents($file, json_encode($data, JSON_NUMERIC_CHECK));
}

/**
 * Clear a specific cache key.
 */
function cache_clear($key) {
    $file = CACHE_DIR . '/' . md5($key) . '.json';
    if (file_exists($file)) @unlink($file);
}

/**
 * Clear all cached data.
 */
function cache_clear_all() {
    $files = glob(CACHE_DIR . '/*.json');
    foreach ($files as $f) @unlink($f);
}
