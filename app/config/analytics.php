<?php

return [
    // Disabled by default so an accidentally copied public/hot can never make
    // an offline/LAN panel load a stale or unreachable development bundle.
    'vite_hmr' => env('ANALYTICS_VITE_HMR', false),
    'connection_drivers' => ['pgsql', 'clickhouse'],
    'displays' => ['number', 'bar', 'line', 'area', 'pie', 'doughnut', 'scatter', 'table', 'pivot', 'funnel', 'progress', 'gauge'],
    'operators' => ['eq', 'neq', 'in', 'not_in', 'contains', 'not_contains', 'starts_with', 'ends_with', 'between', 'not_between', 'gt', 'lt', 'gte', 'lte', 'is_null', 'not_null', 'is_empty', 'not_empty'],
    'cache_seconds' => 30,
    'preview_row_limit' => 2000,
    'preview_aggregate_limit' => 10000,
];
