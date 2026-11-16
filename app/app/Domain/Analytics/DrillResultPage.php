<?php

namespace App\Domain\Analytics;

use App\Domain\Analytics\Drivers\ConnectionManager;
use App\Models\AnalyticsConnection;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

/** Bounded pages for an authorized, replayed drill query; ordinary previews are unchanged. */
class DrillResultPage
{
    public function __construct(private ReportRunner $runner, private ConnectionManager $connections) {}

    public function run(array $definition, int $ownerId, array $options = []): array
    {
        $options = Validator::make($options, [
            'page' => 'sometimes|integer|min:1',
            'page_size' => 'sometimes|integer|min:5|max:100',
            'search' => 'nullable|string|max:200',
            'sort' => 'nullable|array:key,direction|size:2',
            'sort.key' => 'required_with:sort|string|max:200',
            'sort.direction' => ['required_with:sort', Rule::in(['asc', 'desc'])],
        ])->validate();
        $page = (int) ($options['page'] ?? 1);
        $size = (int) ($options['page_size'] ?? 25);
        $search = trim($options['search'] ?? '');
        $sort = $options['sort'] ?? null;
        $data = $this->runner->validate($definition, $ownerId);
        $connection = AnalyticsConnection::where('owner_id', $ownerId)->findOrFail($data['connection_id']);
        $compiled = $this->runner->compile($data, $connection);
        $columns = $compiled['columns'];
        $finalIndex = ! empty($data['stages']) ? array_key_last($data['stages']) : null;
        $final = $finalIndex !== null ? $data['stages'][$finalIndex] : $data;
        if ($final['mode'] === 'rows') {
            // A validated row sort may use a field outside the visible projection.
            // Carry it through the page wrapper, then remove it from returned rows.
            $internalSortKeys = array_values(array_diff(array_column($final['sort'], 'key'), array_column($columns, 'key')));
            if ($internalSortKeys) {
                $executionData = $data;
                $projection = array_values(array_unique([...$final['columns'], ...$internalSortKeys]));
                if ($finalIndex !== null) {
                    $executionData['stages'][$finalIndex]['columns'] = $projection;
                } else {
                    $executionData['columns'] = $projection;
                }
                $compiled = $this->runner->compile($executionData, $connection);
            }
        }
        $executionColumns = $compiled['columns'];
        $queryLimit = ! empty($final['limit_explicit']) ? (int) $final['limit'] : null;
        // compile() always adds this final fetch bound. Its preview ceiling may be
        // lower than an intentional limit; preserve the latter, never a preview.
        $baseSql = preg_replace('/ LIMIT \d+$/D', $queryLimit === null ? '' : ' LIMIT '.$queryLimit, $compiled['sql'], 1, $replaced);
        if ($replaced !== 1) {
            throw ValidationException::withMessages(['query' => 'ساختار پرس‌وجوی صفحه‌بندی معتبر نیست.']);
        }
        $driver = $this->connections->driver($connection);
        $quote = fn (string $name): string => $this->runner->quote($name, $connection->driver);
        $bindings = $compiled['bindings'];
        $started = microtime(true);
        try {
            if (! $columns) {
                $probe = $driver->select('SELECT * FROM ('.$baseSql.') '.$quote('analytics_drill_probe').' LIMIT 1', $bindings);
                foreach ($probe[0] ?? [] as $key => $value) {
                    $columns[] = MetadataLabels::alias(['key' => $key, 'label' => $key, 'type' => is_bool($value) ? 'boolean' : (is_numeric($value) ? 'number' : 'text')]);
                }
            }
            $keys = array_column($columns, 'key');
            $orderingColumns = $executionColumns ?: $columns;
            $orderingKeys = array_column($orderingColumns, 'key');
            if ($sort !== null && ! in_array($sort['key'], $keys, true)) {
                throw ValidationException::withMessages(['sort.key' => 'ستون مرتب‌سازی در نتیجه موجود نیست.']);
            }
            $alias = $quote('analytics_drill_page');
            $expression = fn (string $key): string => $alias.'.'.$quote($key);
            $filteredSql = 'SELECT * FROM ('.$baseSql.') '.$alias;
            if ($search !== '' && $columns) {
                $conditions = [];
                foreach ($columns as $index => $column) {
                    $name = 'drill_page_search_'.$index;
                    while (array_key_exists($name, $bindings)) {
                        $name .= '_';
                    }
                    $bindings[$name] = mb_strtolower($search, 'UTF-8');
                    $field = $expression($column['key']);
                    $conditions[] = match ($connection->driver) {
                        'clickhouse' => 'positionCaseInsensitiveUTF8(toString('.$field.'), :'.$name.') > 0',
                        'pgsql' => 'POSITION(:'.$name.' IN LOWER(CAST('.$field.' AS TEXT))) > 0',
                        default => 'INSTR(LOWER(CAST('.$field.' AS TEXT)), :'.$name.') > 0',
                    };
                }
                // Literal substring matching keeps %, _ and quotes as data.
                $filteredSql .= ' WHERE ('.implode(' OR ', $conditions).')';
            }
            $count = $driver->select('SELECT COUNT(*) AS '.$quote('drill_total').' FROM ('.$filteredSql.') '.$quote('analytics_drill_count'), $bindings);
            $total = (int) ($count[0]['drill_total'] ?? 0);
            $page = min($page, intdiv(max(0, $total - 1), $size) + 1);
            $ordering = [];
            if ($sort !== null) {
                $ordering[$sort['key']] = $sort['direction'];
            } else {
                foreach ($final['sort'] ?? [] as $item) {
                    if (in_array($item['key'], $orderingKeys, true)) {
                        $ordering[$item['key']] = $item['direction'];
                    }
                }
            }
            foreach ([...array_filter($columns, fn ($column) => ! empty($column['primary'])), ...$columns] as $column) {
                $ordering[$column['key']] ??= 'asc';
            }
            $sortSql = [];
            foreach ($ordering as $key => $direction) {
                $field = $expression($key);
                $column = $orderingColumns[array_search($key, $orderingKeys, true)];
                if ($column['type'] === 'text') {
                    $field = $connection->driver === 'clickhouse' ? 'toString('.$field.')' : 'CAST('.$field.' AS TEXT)';
                }
                $sortSql[] = $field.' '.strtoupper($direction);
            }
            $sql = $filteredSql.($sortSql ? ' ORDER BY '.implode(', ', $sortSql) : '').' LIMIT '.$size.' OFFSET '.(($page - 1) * $size);
            $rows = $driver->select($sql, $bindings);
        } catch (ValidationException $exception) {
            throw $exception;
        } catch (\Throwable) {
            throw ValidationException::withMessages(['query' => 'اجرای صفحهٔ نتیجه ناموفق بود؛ ساختار و مقادیر پرس‌وجو را بررسی کنید.']);
        }
        $outputKeys = array_fill_keys(array_column($columns, 'key'), true);
        foreach ($rows as &$row) {
            $row = array_intersect_key($row, $outputKeys);
            foreach ($columns as $column) {
                if ($column['type'] === 'number' && isset($row[$column['key']]) && is_numeric($row[$column['key']])) {
                    $row[$column['key']] = (float) $row[$column['key']];
                }
            }
        }
        unset($row);

        return ['columns' => $columns, 'rows' => $rows, 'sql' => $sql, 'meta' => [
            'cached' => false, 'row_count' => count($rows), 'limit' => $size,
            'query_limit' => $queryLimit, 'truncated' => false,
            'duration_ms' => round((microtime(true) - $started) * 1000),
            'result_signature' => hash('sha256', json_encode([$columns, $rows])),
            'pagination' => ['page' => $page, 'page_size' => $size, 'total' => $total, 'search' => $search, 'sort' => $sort],
        ]];
    }
}
