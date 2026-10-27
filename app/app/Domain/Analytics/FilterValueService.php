<?php

namespace App\Domain\Analytics;

use App\Domain\Analytics\Drivers\ConnectionManager;
use App\Models\AnalyticsConnection;
use App\Models\AnalyticsDashboard;
use App\Models\AnalyticsReport;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\ValidationException;

class FilterValueService
{
    public function __construct(private ReportRunner $runner, private ConnectionManager $connections, private DashboardStore $store) {}

    public function options(AnalyticsDashboard $dashboard, array $snapshot, string $filterKey, array $parameters = [], array $options = []): array
    {
        abort_unless(auth()->check() && $dashboard->canRead((int) auth()->id()), 403);
        $options = Validator::make($options, ['search' => 'nullable|string|max:200', 'cursor' => 'nullable|string|max:1000', 'limit' => 'sometimes|integer|min:1|max:100'])->validate();
        $search = trim($options['search'] ?? '');
        $limit = (int) ($options['limit'] ?? 100);
        $filter = collect($snapshot['filters'])->firstWhere('key', $filterKey);
        abort_unless($filter, 404);
        $empty = ['values' => [], 'truncated' => false, 'has_more' => false, 'next_cursor' => null, 'null_available' => false, 'source' => 'none'];
        if ($filter['type'] === 'time_grain') {
            return [...$empty, 'values' => ['day', 'week', 'month', 'quarter', 'year'], 'source' => 'grains'];
        }
        $byKey = collect($snapshot['filters'])->keyBy('key');
        $parent = $filter['settings']['parent_key'] ?? null;
        $seen = [];
        while ($parent) {
            if (isset($seen[$parent]) || ! isset($byKey[$parent])) {
                throw ValidationException::withMessages(['filters' => 'وابستگی فیلتر معتبر نیست.']);
            }
            $seen[$parent] = true;
            $ancestor = $byKey[$parent];
            $value = array_key_exists($parent, $parameters) ? $parameters[$parent] : $ancestor['default_value'];
            if ($value === null || $value === '' || $value === []) {
                return [...$empty, 'waiting_for_filter' => $ancestor['label']];
            }
            $parent = $ancestor['settings']['parent_key'] ?? null;
        }
        $excluded = [$filterKey => true];
        do {
            $changed = false;
            foreach ($snapshot['filters'] as $candidate) {
                if (! isset($excluded[$candidate['key']]) && isset($excluded[$candidate['settings']['parent_key'] ?? ''])) {
                    $excluded[$candidate['key']] = true;
                    $changed = true;
                }
            }
        } while ($changed);
        $parameters = array_diff_key($parameters, $excluded);
        $binding = $filter['bindings'][0] ?? null;
        $widget = $binding ? collect($snapshot['widgets'])->firstWhere('key', $binding['widget_key']) : null;
        $report = $widget ? AnalyticsReport::where('owner_id', $dashboard->owner_id)->findOrFail($widget['report_id']) : null;
        $custom = $filter['settings']['values'] ?? [];
        $fingerprint = hash('sha256', json_encode([$dashboard->id, $dashboard->version, $filterKey, auth()->id(), $search, $parameters, $report?->version, $custom]));
        if ($custom || $report?->query_definition['mode'] === 'native') {
            $values = array_values(array_unique($custom, SORT_REGULAR));
            if ($filter['type'] === 'number') {
                foreach ($values as &$value) {
                    $this->runner->typed($value, 'number');
                    $value += 0;
                }
                unset($value);
            }
            $values = array_values(array_filter($values, fn ($value) => $search === '' || mb_stripos((string) $value, $search) !== false));
            usort($values, fn ($left, $right) => $filter['type'] === 'number' ? $left <=> $right : strcmp((string) $left, (string) $right));
            $offset = $this->offset($options['cursor'] ?? null, $fingerprint);
            $page = array_slice($values, $offset, $limit + 1);

            return $this->page($page, $limit, $offset, $fingerprint, false, $custom ? 'custom' : 'native');
        }
        if (! $binding || ! $report) {
            return $empty;
        }
        $definition = $this->runner->validate($report->query_definition, $dashboard->owner_id);
        $connection = AnalyticsConnection::where('owner_id', $dashboard->owner_id)->findOrFail($definition['connection_id']);
        [$stageIndex, $fieldKey] = $this->runner->filterLocation($binding['target']);
        $fields = $this->runner->filterFields($connection, $definition);
        abort_unless(isset($fields[$binding['target']]) && $fields[$binding['target']]['type'] === $filter['type'], 422, 'ستون مقصد فیلتر معتبر نیست.');
        if ($stageIndex === null) {
            unset($definition['stages']);
        } else {
            $definition['stages'] = array_slice($definition['stages'], 0, $stageIndex + 1);
        }
        $extra = [];
        foreach ($snapshot['filters'] as $other) {
            if (isset($excluded[$other['key']])) {
                continue;
            }
            $otherBinding = collect($other['bindings'])->firstWhere('widget_key', $widget['key']);
            $value = array_key_exists($other['key'], $parameters) ? $parameters[$other['key']] : $other['default_value'];
            if (! $otherBinding || $value === null || $value === '' || $value === []) {
                continue;
            }
            [$otherStage, $otherField] = $this->runner->filterLocation($otherBinding['target']);
            if ($otherStage !== null && ($stageIndex === null || $otherStage > $stageIndex)) {
                continue;
            }
            if ($other['type'] === 'time_grain') {
                if (! in_array($value, ['day', 'week', 'month', 'quarter', 'year'], true)) {
                    throw ValidationException::withMessages(['parameters' => 'گروه‌بندی زمانی معتبر نیست.']);
                }
                $dimensions = &$definition['dimensions'];
                if ($otherStage !== null) {
                    $dimensions = &$definition['stages'][$otherStage]['dimensions'];
                }
                foreach ($dimensions as &$dimension) {
                    if ($dimension['field'] === $otherField) {
                        $dimension['grain'] = $value;
                    }
                }
                unset($dimensions, $dimension);
            } else {
                $extra[] = $this->store->parameterFilter($other, $otherBinding, $value);
            }
        }
        $countKey = $fieldKey === 'filter_option_count' ? 'filter_option_count_2' : 'filter_option_count';
        $distinct = ['mode' => 'aggregate', 'metrics' => [['key' => $countKey, 'function' => 'count']], 'dimensions' => [['field' => $fieldKey]], 'sort' => [], 'limit' => null, 'limit_explicit' => false];
        if ($stageIndex === null) {
            $definition = [...$definition, ...$distinct];
            unset($definition['columns']);
        } else {
            $definition['stages'][$stageIndex] = [...$definition['stages'][$stageIndex], ...$distinct];
            unset($definition['stages'][$stageIndex]['columns']);
        }
        $definition = $this->runner->validate($definition, $dashboard->owner_id);
        $compiled = $this->runner->compile($definition, $connection, $extra);
        // This suffix belongs to our compiler; limits inside preceding stages stay intact.
        $sourceSql = preg_replace('/ LIMIT \d+$/', '', $compiled['sql']);
        $quote = fn ($key) => '"'.str_replace('"', '""', $key).'"';
        $column = $quote('filter_values').'.'.$quote($fieldKey);
        $from = ' FROM ('.$sourceSql.') '.$quote('filter_values');
        $cast = $connection->driver === 'clickhouse' ? 'toString('.$column.')' : 'CAST('.$column.' AS TEXT)';
        $bindings = $compiled['bindings'];
        $where = $column.' IS NOT NULL';
        if ($search !== '') {
            if ($connection->driver === 'clickhouse') {
                $where .= ' AND positionCaseInsensitiveUTF8('.$cast.', :fv_search) > 0';
                $bindings['fv_search'] = $search;
            } else {
                $where .= ' AND LOWER('.$cast.") LIKE LOWER(:fv_search) ESCAPE '!'";
                $bindings['fv_search'] = '%'.str_replace(['!', '%', '_'], ['!!', '!%', '!_'], $search).'%';
            }
        }
        $fingerprint = hash('sha256', json_encode([$fingerprint, $connection->configuration, $connection->updated_at, $compiled]));
        $offset = $this->offset($options['cursor'] ?? null, $fingerprint);
        $cacheKey = 'analytics-filter-values:'.hash('sha256', $fingerprint.':'.$offset.':'.$limit);

        return Cache::remember($cacheKey, config('analytics.cache_seconds', 30), function () use ($connection, $column, $from, $where, $bindings, $compiled, $limit, $offset, $fingerprint, $filter) {
            $driver = $this->connections->driver($connection);
            try {
                $rows = $driver->select('SELECT DISTINCT '.$column.' AS "value"'.$from.' WHERE '.$where.' ORDER BY '.$column.' ASC LIMIT '.($limit + 1).' OFFSET '.$offset, $bindings);
                $nullRows = $driver->select('SELECT 1 AS "present"'.$from.' WHERE '.$column.' IS NULL LIMIT 1', $compiled['bindings']);
            } catch (ValidationException $exception) {
                throw $exception;
            } catch (\Throwable) {
                throw ValidationException::withMessages(['values' => 'خواندن مقادیر فیلتر ناموفق بود؛ اتصال و ستون مقصد را بررسی کنید.']);
            }
            $values = array_column($rows, 'value');
            if ($filter['type'] === 'number') {
                $values = array_map(fn ($value) => is_numeric($value) ? $value + 0 : $value, $values);
            } elseif ($filter['type'] === 'boolean') {
                $values = array_map(fn ($value) => ! in_array($value, [false, 0, '0', 'f', 'false'], true), $values);
            }

            return $this->page($values, $limit, $offset, $fingerprint, (bool) $nullRows, 'database');
        });
    }

    private function page(array $values, int $limit, int $offset, string $fingerprint, bool $nullAvailable, string $source): array
    {
        $more = count($values) > $limit;

        return ['values' => array_slice($values, 0, $limit), 'truncated' => $more, 'has_more' => $more, 'next_cursor' => $more ? $this->cursor($offset + $limit, $fingerprint) : null, 'null_available' => $nullAvailable, 'source' => $source];
    }

    private function cursor(int $offset, string $fingerprint): string
    {
        $payload = rtrim(strtr(base64_encode(json_encode(['offset' => $offset, 'fingerprint' => $fingerprint])), '+/', '-_'), '=');

        return $payload.'.'.hash_hmac('sha256', $payload, config('app.key'));
    }

    private function offset(?string $cursor, string $fingerprint): int
    {
        if (! $cursor) {
            return 0;
        }
        [$payload, $signature] = array_pad(explode('.', $cursor, 2), 2, '');
        $decoded = json_decode(base64_decode(strtr($payload, '-_', '+/'), true) ?: '', true);
        if (! hash_equals(hash_hmac('sha256', $payload, config('app.key')), $signature) || ! is_array($decoded) || ($decoded['fingerprint'] ?? '') !== $fingerprint || ! is_int($decoded['offset'] ?? null) || $decoded['offset'] < 0 || $decoded['offset'] > 1000000) {
            throw ValidationException::withMessages(['cursor' => 'صفحهٔ مقادیر تغییر کرده است؛ جست‌وجو را دوباره انجام دهید.']);
        }

        return $decoded['offset'];
    }
}
