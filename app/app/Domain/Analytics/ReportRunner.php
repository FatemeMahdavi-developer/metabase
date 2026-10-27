<?php

namespace App\Domain\Analytics;

use App\Domain\Analytics\Drivers\ConnectionManager;
use App\Models\AnalyticsConnection;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

class ReportRunner
{
    public function __construct(private ConnectionManager $connections) {}

    public function validate(array $definition, int $ownerId, ?AnalyticsConnection $stageConnection = null): array
    {
        $data = Validator::make($definition, [
            'connection_id' => 'required|integer', 'source' => 'required|string|max:200',
            'mode' => ['required', Rule::in(['aggregate', 'rows', 'native'])],
            'metrics' => 'present|array|max:10', 'metrics.*.key' => 'required|string|regex:/^[a-z][a-z0-9_]{0,40}$/', 'metrics.*.label' => 'nullable|string|max:150',
            'metrics.*.function' => ['required', Rule::in(['count', 'sum', 'avg', 'min', 'max', 'count_distinct'])], 'metrics.*.field' => 'nullable|string',
            'dimensions' => 'present|array|max:6', 'dimensions.*.field' => 'required|string',
            'dimensions.*.grain' => ['nullable', Rule::in(['day', 'week', 'month', 'quarter', 'year'])],
            'filters' => 'present|array|max:60', 'columns' => 'sometimes|array|min:1|max:50', 'columns.*' => 'string|distinct',
            'sort' => 'present|array|max:50', 'sort.*.key' => 'required|string|distinct', 'sort.*.direction' => ['required', Rule::in(['asc', 'desc'])],
            'joins' => 'sometimes|array|max:5', 'joins.*.field' => 'sometimes|string',
            'joins.*.source' => 'required_without:joins.*.field|string|max:200',
            'joins.*.alias' => 'required_without:joins.*.field|string|regex:/^[a-z][a-z0-9_]{0,40}$/',
            'joins.*.type' => ['sometimes', Rule::in(['left', 'inner', 'right', 'full'])],
            'joins.*.conditions' => 'required_without:joins.*.field|array|min:1|max:5',
            'joins.*.conditions.*.left' => 'required|string|max:200', 'joins.*.conditions.*.right' => 'required|string|max:200',
            'joins.*.conditions.*.operator' => ['required', Rule::in(['eq', 'neq', 'gt', 'gte', 'lt', 'lte'])],
            'expressions' => 'sometimes|array|max:10', 'expressions.*.key' => 'required|string|regex:/^[a-z][a-z0-9_]{0,40}$/',
            'expressions.*.label' => 'required|string|max:150', 'expressions.*.expression' => 'required|string|max:2000',
            'expressions.*.type' => ['sometimes', Rule::in(['number', 'text', 'boolean', 'date'])],
            'limit' => 'nullable|integer|min:1|required_if:limit_explicit,true', 'sql' => 'sometimes|string|max:20000',
            'limit_explicit' => 'sometimes|boolean', 'stages' => 'sometimes|array|max:5', 'stages.*' => 'array',
            'parameters' => 'sometimes|array|max:10', 'parameters.*.key' => 'required|string|regex:/^[a-z][a-z0-9_]{0,40}$/',
            'parameters.*.type' => ['required', Rule::in(['text', 'number', 'date'])], 'parameters.*.required' => 'boolean',
        ])->validate();
        $data['limit'] = isset($data['limit']) ? (int) $data['limit'] : null;
        $connection = $stageConnection ?? AnalyticsConnection::where('owner_id', $ownerId)->findOrFail($data['connection_id']);
        if (! $connection->isSupported()) {
            $this->invalid('connection_id', 'منبع گزارش باید PostgreSQL یا ClickHouse باشد.');
        }
        $data['connection_id'] = (int) $data['connection_id'];
        abort_unless($connection->owner_id === $ownerId && $connection->id === $data['connection_id'], 403);
        [$fields] = $this->fields($connection, $data);
        foreach ($data['expressions'] ?? [] as $index => $expression) {
            $data['expressions'][$index]['type'] = $fields[$expression['key']]['type'];
            $data['expressions'][$index]['expression'] = $fields[$expression['key']]['expression'];
        }
        if ($data['mode'] === 'native') {
            if (! empty($data['stages'])) {
                $this->invalid('stages', 'مراحل بعدی را در خود SQL تعریف کنید.');
            }
            $data['sql'] = trim($data['sql'] ?? '', " \t\n\r;");
            $this->validateSql($data['sql']);
            $data['parameters'] = $definition['parameters'] ?? [];
            preg_match_all('/\{\{([a-z][a-z0-9_]*)\}\}/', $data['sql'], $matches);
            $declared = array_column($data['parameters'], 'key');
            if (count($declared) !== count(array_unique($declared)) || array_diff($matches[1], $declared)) {
                $this->invalid('parameters', 'برای تمام متغیرهای SQL نوع و مقدار پیش‌فرض تعریف کنید.');
            }
            foreach ($data['parameters'] as $parameter) {
                if (isset($parameter['default']) && $parameter['default'] !== '') {
                    $this->typed($parameter['default'], $parameter['type']);
                }
            }

            return $data;
        }
        $keys = [];
        foreach ($data['dimensions'] as $dimension) {
            $this->field($fields, $dimension['field']);
            if (! empty($dimension['grain']) && $fields[$dimension['field']]['type'] !== 'date') {
                $this->invalid('dimensions', 'گروه‌بندی زمانی فقط برای تاریخ مجاز است.');
            }
            $keys[] = $dimension['field'];
        }
        foreach ($data['metrics'] as $metric) {
            if ($metric['function'] !== 'count') {
                $this->field($fields, $metric['field'] ?? '');
                if (in_array($metric['function'], ['sum', 'avg']) && $fields[$metric['field']]['type'] !== 'number') {
                    $this->invalid('metrics', 'مجموع و میانگین به ستون عددی نیاز دارند.');
                }
            }
            $keys[] = $metric['key'];
        }
        if (count($keys) !== count(array_unique($keys))) {
            $this->invalid('metrics', 'کلید ستون‌های خروجی باید یکتا باشد.');
        }
        if ($data['mode'] === 'aggregate' && ! $data['metrics']) {
            $this->invalid('metrics', 'حداقل یک محاسبه انتخاب کنید.');
        }
        if ($data['mode'] === 'rows') {
            $data['columns'] = $data['columns'] ?? array_slice(array_keys(array_filter($fields, fn ($field) => empty($field['hidden']))), 0, 50);
            if (! $data['columns']) {
                $this->invalid('columns', 'حداقل یک ستون قابل نمایش انتخاب کنید.');
            }
            foreach ($data['columns'] as $key) {
                $this->field($fields, $key);
            }
            $keys = $data['columns'];
        }
        foreach ($data['sort'] as $sort) {
            if (! in_array($sort['key'], $data['mode'] === 'rows' ? array_keys($fields) : $keys, true)) {
                $this->invalid('sort', 'مرتب‌سازی باید روی ستون خروجی باشد.');
            }
        }
        $data['filters'] = array_map(function ($filter) use ($fields) {
            $this->field($fields, $filter['field'] ?? '');

            return $this->validatedFilter($filter, $fields[$filter['field']]['type']);
        }, $definition['filters']);

        if (! empty($data['stages'])) {
            $base = $data;
            unset($base['stages']);
            $columns = $this->compile($base, $connection)['columns'];
            foreach ($data['stages'] as $index => $stage) {
                $virtual = $this->stageConnection($connection, $columns);
                if (isset($stage['stages']) || ($stage['mode'] ?? '') === 'native') {
                    $this->invalid('stages', 'هر مرحله روی ستون‌های خروجی مرحلهٔ قبلی کار می‌کند.');
                }
                $stage = $this->validate([...$stage, 'connection_id' => $connection->id, 'source' => 'analytics_stage'], $ownerId, $virtual);
                $data['stages'][$index] = collect($stage)->except(['connection_id', 'source'])->all();
                [$stageFields] = $this->fields($virtual, $stage);
                $data['stages'][$index]['field_labels'] = array_column($stageFields, 'label', 'key');
                $columns = $this->compile($stage, $virtual)['columns'];
            }
        }

        return $data;
    }

    private function stageConnection(AnalyticsConnection $connection, array $columns): AnalyticsConnection
    {
        $virtual = clone $connection;
        $virtual->catalog = [['key' => 'analytics_stage', 'label' => 'نتیجهٔ مرحلهٔ قبلی', 'fields' => $columns, 'virtual' => true], ...array_filter($connection->catalog ?? [], fn ($table) => empty($table['virtual']))];

        return $virtual;
    }

    public function stageContexts(array $definition, AnalyticsConnection $connection): array
    {
        $base = $definition;
        unset($base['stages']);
        $contexts = [];
        $virtual = $connection;
        foreach ([$base, ...($definition['stages'] ?? [])] as $index => $stage) {
            if ($index > 0) {
                $virtual = $this->stageConnection($connection, $columns);
                $stage = [...$stage, 'source' => 'analytics_stage', 'connection_id' => $connection->id];
            }
            [$fields] = $this->fields($virtual, $stage);
            $columns = $this->compile($stage, $virtual)['columns'];
            $contexts[] = ['index' => $index, 'definition' => $stage, 'fields' => $fields, 'columns' => $columns];
        }

        return $contexts;
    }

    public function fields(AnalyticsConnection $connection, array $data): array
    {
        $catalog = $connection->displayCatalog();
        $table = collect($catalog)->firstWhere('key', $data['source']);
        if (! $table) {
            $this->invalid('source', 'جدول انتخاب‌شده در این اتصال وجود ندارد؛ ساختار را همگام کنید.');
        }
        $fields = [];
        $quote = fn ($name) => $this->quote($name, $connection->driver);
        foreach ($table['fields'] as $field) {
            $lineage = empty($table['virtual']) ? ['source_table' => $table['key'], 'source_field' => $field['key']] : collect($field)->only(['source_table', 'source_field'])->all();
            $fields[$field['key']] = [...$field, ...$lineage, 'sql' => $quote('t0').'.'.$quote($field['key'])];
        }
        $joinSql = '';
        $used = [];
        $joinTables = collect($catalog)->reject(fn ($table) => ! empty($table['virtual']));
        foreach ($data['joins'] ?? [] as $index => $join) {
            if (isset($join['field'])) {
                $this->field($fields, $join['field']);
                $relation = $fields[$join['field']]['relation'] ?? null;
                $target = $relation ? $joinTables->firstWhere('key', $relation['table']) : null;
                if (! $target || ! empty($relation['composite']) || isset($used[$join['field']])) {
                    $this->invalid('joins', 'این ستون رابطهٔ قابل اتصال ندارد یا تکراری است.');
                }
                $prefix = $join['field'];
                $conditions = [['left' => $join['field'], 'operator' => 'eq', 'right' => $relation['field']]];
            } else {
                $target = $joinTables->firstWhere('key', $join['source'] ?? null);
                $prefix = $join['alias'] ?? '';
                $conditions = $join['conditions'] ?? [];
                if (! $target || ! preg_match('/^[a-z][a-z0-9_]{0,40}$/', $prefix) || isset($used[$prefix]) || isset($fields[$prefix]) || ! $conditions || count($conditions) > 5) {
                    $this->invalid('joins', 'جدول، نام یا شرط اتصال معتبر نیست.');
                }
            }
            $used[$prefix] = true;
            $alias = 'j'.$index;
            $on = [];
            $targetFields = collect($target['fields'])->keyBy('key');
            foreach ($conditions as $condition) {
                $this->field($fields, $condition['left'] ?? '');
                $right = $targetFields[$condition['right'] ?? ''] ?? null;
                $operator = ['eq' => '=', 'neq' => '<>', 'gt' => '>', 'gte' => '>=', 'lt' => '<', 'lte' => '<='][$condition['operator'] ?? ''] ?? null;
                if (! $right || ! $operator || $fields[$condition['left']]['type'] !== $right['type']) {
                    $this->invalid('joins', 'ستون‌ها و عملگر شرط ON باید معتبر و دارای نوع سازگار باشند.');
                }
                $on[] = $fields[$condition['left']]['sql'].' '.$operator.' '.$quote($alias).'.'.$quote($right['key']);
            }
            $type = ['left' => 'LEFT', 'inner' => 'INNER', 'right' => 'RIGHT', 'full' => 'FULL'][$join['type'] ?? 'left'] ?? null;
            if (! $type) {
                $this->invalid('joins', 'نوع اتصال معتبر نیست.');
            }
            $joinSql .= ' '.$type.' JOIN '.$this->tableQuote($target['key'], $connection->driver, $target['schema'] ?? $connection->configuration['database'] ?? null).' '.$quote($alias).' ON '.implode(' AND ', $on);
            foreach ($target['fields'] as $field) {
                $key = $prefix.'.'.$field['key'];
                $fields[$key] = [...MetadataLabels::joined($field, $target, $key), 'label' => $target['label'].' → '.$field['label'], 'source_table' => $target['key'], 'source_field' => $field['key'], 'sql' => $quote($alias).'.'.$quote($field['key'])];
            }
        }
        foreach ($data['expressions'] ?? [] as $expression) {
            if (isset($fields[$expression['key']])) {
                $this->invalid('expressions', 'نام ستون محاسباتی تکراری است.');
            }
            $compiled = (new ExpressionCompiler)->compile($expression['expression'], $fields, $connection->driver);
            $fields[$expression['key']] = MetadataLabels::alias(['key' => $expression['key'], 'label' => $expression['label'], 'type' => $compiled['type'], 'sql' => $compiled['sql'], 'expression' => $compiled['expression'], 'nullable' => true, 'computed' => true]);
        }

        return [$fields, $joinSql];
    }

    public function filterLocation(string $target): array
    {
        return preg_match('/^stage:(\d+):(.+)$/D', $target, $matches) ? [(int) $matches[1], $matches[2]] : [null, $target];
    }

    public function filterFields(AnalyticsConnection $connection, array $definition): array
    {
        if ($definition['mode'] === 'native') {
            return collect($definition['parameters'] ?? [])->keyBy('key')->all();
        }
        [$fields] = $this->fields($connection, $definition);
        foreach ($fields as $key => &$field) {
            $field['is_dimension'] = in_array($key, array_column($definition['dimensions'], 'field'), true);
        }
        unset($field);
        if (empty($definition['stages'])) {
            return $fields;
        }
        $base = $definition;
        unset($base['stages']);
        $columns = $this->compile($base, $connection)['columns'];
        foreach ($definition['stages'] as $index => $stage) {
            $virtual = $this->stageConnection($connection, $columns);
            $stage = [...$stage, 'source' => 'analytics_stage'];
            [$stageFields] = $this->fields($virtual, $stage);
            foreach ($stageFields as $key => $field) {
                $target = 'stage:'.$index.':'.$key;
                $fields[$target] = [...MetadataLabels::stage($field, $target, $index + 2), 'is_dimension' => in_array($key, array_column($stage['dimensions'], 'field'), true)];
            }
            $columns = $this->compile($stage, $virtual)['columns'];
        }

        return $fields;
    }

    public function compile(array $data, AnalyticsConnection $connection, array $extraFilters = [], bool $details = false, string $bindingPrefix = '', ?string $fromSql = null): array
    {
        [$fields, $joins] = $this->fields($connection, $data);
        $bindings = [];
        $quote = fn ($name) => $this->quote($name, $connection->driver);
        if ($data['mode'] === 'native') {
            $values = [];
            foreach ($extraFilters as $filter) {
                $values[$filter['field']] = $filter['value'];
            }
            $parameters = collect($data['parameters'])->keyBy('key');
            $nativeSql = preg_replace_callback('/\[\[(.*?)\]\]/s', function ($match) use ($parameters, $values) {
                preg_match_all('/\{\{([a-z][a-z0-9_]*)\}\}/', $match[1], $variables);
                if (! $variables[1]) {
                    $this->invalid('sql', 'بخش اختیاری SQL باید حداقل یک متغیر داشته باشد.');
                }
                foreach ($variables[1] as $variable) {
                    $value = $values[$variable] ?? $parameters[$variable]['default'] ?? null;
                    if ($value === null || $value === '') {
                        if (! empty($parameters[$variable]['required'])) {
                            $this->invalid('parameters', 'متغیر الزامی '.$variable.' را وارد کنید.');
                        }

                        return '';
                    }
                }

                return $match[1];
            }, $data['sql']);
            if (str_contains($nativeSql, '[[') || str_contains($nativeSql, ']]')) {
                $this->invalid('sql', 'بخش اختیاری SQL ناقص یا تو در تو است.');
            }
            $sql = preg_replace_callback('/\{\{([a-z][a-z0-9_]*)\}\}/', function ($match) use ($parameters, $values, &$bindings, $bindingPrefix, $connection) {
                $parameter = $parameters[$match[1]];
                $value = $values[$match[1]] ?? $parameter['default'] ?? null;
                $this->typed($value, $parameter['type']);
                if ($parameter['type'] === 'number') {
                    $value = is_numeric($value) ? $value + 0 : $value;
                }
                $key = $bindingPrefix.'p'.count($bindings);
                $bindings[$key] = $value;

                return $parameter['type'] === 'number' && $connection->driver === 'sqlite' ? 'CAST(:'.$key.' AS REAL)' : ':'.$key;
            }, $nativeSql);

            return ['sql' => 'SELECT * FROM ('.$sql.') '.$quote('result').' LIMIT '.$this->fetchLimit($data), 'bindings' => $bindings, 'columns' => []];
        }
        $stageFilters = [];
        $baseFilters = [];
        foreach ($extraFilters as $filter) {
            [$stageIndex, $fieldKey] = $this->filterLocation($filter['field']);
            if ($stageIndex === null) {
                $baseFilters[] = $filter;
            } else {
                if (! isset($data['stages'][$stageIndex])) {
                    $this->invalid('bindings', 'مرحلهٔ مقصد فیلتر وجود ندارد.');
                }
                $stageFilters[$stageIndex][] = [...$filter, 'field' => $fieldKey];
            }
        }
        $columns = [];
        $select = [];
        $groups = [];
        if ($data['mode'] === 'rows' || $details) {
            foreach ($details ? array_slice(array_keys($fields), 0, 20) : $data['columns'] as $key) {
                $select[] = $fields[$key]['sql'].' AS '.$quote($key);
                $columns[] = $this->column($fields[$key]);
            }
        } else {
            foreach ($data['dimensions'] as $dimension) {
                $field = $fields[$dimension['field']];
                $expression = ! empty($dimension['grain']) ? $this->dateExpression($field['sql'], $dimension['grain'], $connection->driver) : $field['sql'];
                $select[] = $expression.' AS '.$quote($dimension['field']);
                $groups[] = $expression;
                $columns[] = [...$this->column($field), 'role' => 'dimension', 'grain' => $dimension['grain'] ?? null];
            }
            foreach ($data['metrics'] as $metric) {
                $field = $metric['function'] === 'count' ? '*' : $fields[$metric['field']]['sql'];
                $expression = $metric['function'] === 'count_distinct' ? 'COUNT(DISTINCT '.$field.')' : strtoupper($metric['function']).'('.$field.')';
                $select[] = $expression.' AS '.$quote($metric['key']);
                $columns[] = MetadataLabels::alias(['key' => $metric['key'], 'label' => $metric['label'] ?? $metric['key'], 'type' => in_array($metric['function'], ['min', 'max']) ? $fields[$metric['field']]['type'] : 'number', 'role' => 'metric']);
            }
        }
        $conditions = [];
        foreach ([...$data['filters'], ...$baseFilters] as $filter) {
            $this->field($fields, $filter['field']);
            $filter = $this->validatedFilter($filter, $fields[$filter['field']]['type']);
            $field = $fields[$filter['field']]['sql'];
            // Date filters include the entire day even when the source stores timestamps.
            if (! empty($filter['date_part'])) {
                $field = $this->datePartExpression($field, $filter['date_part'], $connection->driver);
            } elseif ($fields[$filter['field']]['type'] === 'date') {
                $field = match ($connection->driver) {
                    'sqlite' => "date($field)", 'pgsql' => "CAST($field AS date)", 'clickhouse' => "toDate($field)",
                };
            }
            $operator = $filter['operator'];
            $value = isset($filter['relative_date']) ? app(DateFilterRange::class)->relativeRange($filter['relative_date']) : $filter['value'];
            $boolean = $fields[$filter['field']]['type'] === 'boolean';
            $cast = $connection->driver === 'sqlite' ? ($boolean ? 'INTEGER' : (($fields[$filter['field']]['type'] === 'number' || ! empty($filter['date_part'])) ? 'REAL' : null)) : null;
            $bind = function ($item) use (&$bindings, $bindingPrefix, $cast, $boolean, $connection) {
                $key = $bindingPrefix.'p'.count($bindings);
                $bindings[$key] = $boolean && $connection->driver === 'pgsql' ? (bool) $item : $item;

                return $cast ? 'CAST(:'.$key.' AS '.$cast.')' : ':'.$key;
            };
            $conditions[] = match ($operator) {
                'is_null' => "$field IS NULL", 'not_null' => "$field IS NOT NULL",
                'is_empty' => "($field IS NULL OR $field = '')", 'not_empty' => "($field IS NOT NULL AND $field <> '')",
                'in', 'not_in' => "$field ".($operator === 'in' ? 'IN' : 'NOT IN').' ('.implode(', ', array_map($bind, $value)).')',
                'between', 'not_between' => "$field ".($operator === 'not_between' ? 'NOT ' : '').'BETWEEN '.$bind($value[0]).' AND '.$bind($value[1]),
                'contains', 'not_contains', 'starts_with', 'ends_with' => $this->textCondition($field, $operator, $value, $bind, $connection->driver, $filter['case_sensitive']),
                default => "$field ".(['eq' => '=', 'neq' => '<>', 'gt' => '>', 'lt' => '<', 'gte' => '>=', 'lte' => '<='][$operator]).' '.$bind($value),
            };
        }
        $sql = 'SELECT '.implode(', ', $select).' FROM '.($fromSql ?? $this->tableQuote($data['source'], $connection->driver, $connection->configuration['database'] ?? null)).' '.$quote('t0').$joins;
        if ($conditions) {
            $sql .= ' WHERE '.implode(' AND ', array_map(fn ($condition) => '('.$condition.')', $conditions));
        }
        if ($groups) {
            $sql .= ' GROUP BY '.implode(', ', $groups);
        }
        if (! $details && $data['sort']) {
            $sql .= ' ORDER BY '.implode(', ', array_map(fn ($sort) => ($data['mode'] === 'rows' ? $fields[$sort['key']]['sql'] : $quote($sort['key'])).' '.strtoupper($sort['direction']), $data['sort']));
        } elseif ($groups) {
            $sql .= ' ORDER BY '.$quote($data['dimensions'][0]['field']);
        }
        $sql .= ' LIMIT '.$this->fetchLimit($data, $details);

        if (! $details) {
            $previousExplicitLimit = ! empty($data['limit_explicit']);
            $previousLimit = $data['limit'];
            foreach ($data['stages'] ?? [] as $index => $stage) {
                $sql = preg_replace('/ LIMIT \d+$/', $previousExplicitLimit ? ' LIMIT '.$previousLimit : '', $sql);
                $virtual = $this->stageConnection($connection, $columns);
                $compiled = $this->compile([...$stage, 'source' => 'analytics_stage', 'connection_id' => $connection->id], $virtual, $stageFilters[$index] ?? [], false, 's'.$index.'_', '('.$sql.')');
                $sql = $compiled['sql'];
                $columns = $compiled['columns'];
                $bindings = [...$bindings, ...$compiled['bindings']];
                $previousExplicitLimit = ! empty($stage['limit_explicit']);
                $previousLimit = $stage['limit'];
            }
        }

        return ['sql' => $sql, 'bindings' => $bindings, 'columns' => $columns];
    }

    public function run(array $definition, int $ownerId, array $extraFilters = [], bool $refresh = false, bool $details = false): array
    {
        $data = $this->validate($definition, $ownerId);
        // Multi-stage drill-through retains the pipeline and its filters.
        $details = $details && empty($data['stages']);
        $connection = AnalyticsConnection::where('owner_id', $ownerId)->findOrFail($data['connection_id']);
        $compiled = $this->compile($data, $connection, $extraFilters, $details);
        $finalStage = ! $details && ! empty($data['stages']) ? $data['stages'][array_key_last($data['stages'])] : $data;
        $limit = $this->resultLimit($finalStage, $details);
        $queryLimit = $details ? null : $this->queryLimit($finalStage);
        $key = 'analytics:'.hash('sha256', json_encode([$connection->id, $connection->updated_at, $connection->configuration, $ownerId, $compiled, $details, $limit, $queryLimit]));
        if (! $refresh && ($result = Cache::get($key))) {
            $result['meta']['cached'] = true;
            $result['meta']['result_signature'] = hash('sha256', json_encode([$result['columns'], $result['rows']]));

            return $result;
        }
        $start = microtime(true);
        try {
            $rows = $this->connections->driver($connection)->select($compiled['sql'], $compiled['bindings']);
        } catch (ValidationException $exception) {
            throw $exception;
        } catch (\Throwable) {
            $this->invalid('query', 'اجرای Query ناموفق بود؛ نوع فیلدها، ساختار جدول و مقادیر پارامترها را بررسی کنید.');
        }
        $columns = $compiled['columns'];
        if (! $columns && $rows) {
            foreach ($rows[0] as $name => $value) {
                $columns[] = MetadataLabels::alias(['key' => $name, 'label' => $name, 'type' => is_bool($value) ? 'boolean' : (is_numeric($value) ? 'number' : 'text')]);
            }
        }
        $truncated = count($rows) > $limit;
        $rows = array_slice($rows, 0, $limit);
        foreach ($rows as &$row) {
            foreach ($columns as $column) {
                if ($column['type'] === 'number' && isset($row[$column['key']]) && is_numeric($row[$column['key']])) {
                    $row[$column['key']] = (float) $row[$column['key']];
                }
            }
        }
        $result = ['columns' => $columns, 'rows' => $rows, 'meta' => ['cached' => false, 'row_count' => count($rows), 'limit' => $limit, 'query_limit' => $queryLimit, 'preview_limit' => $this->previewLimit($finalStage, $details), 'truncated' => $truncated, 'duration_ms' => round((microtime(true) - $start) * 1000), 'result_signature' => hash('sha256', json_encode([$columns, $rows]))], 'sql' => $compiled['sql']];
        Cache::put($key, $result, (int) config('analytics.cache_seconds', 30));

        return $result;
    }

    private function queryLimit(array $data): ?int
    {
        return ! empty($data['limit_explicit']) ? $data['limit'] : null;
    }

    private function previewLimit(array $data, bool $details = false): int
    {
        return max(1, (int) config(! $details && $data['mode'] === 'aggregate' ? 'analytics.preview_aggregate_limit' : 'analytics.preview_row_limit', 2000));
    }

    private function resultLimit(array $data, bool $details = false): int
    {
        $preview = $this->previewLimit($data, $details);
        $explicit = $details ? null : $this->queryLimit($data);
        // Older saved questions stored their preview size in limit without the flag.
        $legacy = ! array_key_exists('limit_explicit', $data) ? ($data['limit'] ?? null) : null;

        return min($preview, $explicit ?? $legacy ?? $preview);
    }

    private function fetchLimit(array $data, bool $details = false): int
    {
        $resultLimit = $this->resultLimit($data, $details);
        $explicit = $details ? null : $this->queryLimit($data);

        // Reaching a deliberate query limit is a complete result, not truncation.
        return $explicit !== null && $explicit <= $resultLimit ? $explicit : $resultLimit + 1;
    }

    public function validatedFilter(array $filter, string $type): array
    {
        $operator = $filter['operator'] ?? '';
        if (! in_array($operator, config('analytics.operators'), true)) {
            $this->invalid('operator', 'عملگر فیلتر معتبر نیست.');
        }
        if (array_key_exists('relative_date', $filter)) {
            if ($type !== 'date' || ! in_array($operator, ['between', 'not_between'], true) || ! is_array($filter['relative_date']) || ($filter['value'] ?? null) !== null || isset($filter['date_part']) || ! empty($filter['case_sensitive'])) {
                $this->invalid('relative_date', 'بازهٔ نسبی فقط برای شرط بازهٔ تاریخ مجاز است؛ مقدار ثابت یا بخش تاریخ را حذف کنید.');
            }

            return ['field' => $filter['field'], 'operator' => $operator, 'value' => null, 'relative_date' => app(DateFilterRange::class)->validateRelative($filter['relative_date'])];
        }
        if (array_key_exists('date_part', $filter)) {
            if ($type !== 'date' || ! in_array($operator, ['in', 'not_in'])) {
                $this->invalid('date_part', 'بخش تاریخ فقط برای ستون تاریخی و انتخاب یا حذف مقادیر مجاز است.');
            }
            $bounds = ['day_of_week' => [1, 7], 'month' => [1, 12], 'quarter' => [1, 4], 'hour' => [0, 23]];
            $part = $filter['date_part'];
            if (! is_string($part) || ! isset($bounds[$part])) {
                $this->invalid('date_part', 'بخش تاریخ معتبر نیست.');
            }
            [$minimum, $maximum] = $bounds[$part];
            $validated = Validator::make($filter, ['value' => 'required|array|min:1|max:24', 'value.*' => 'required|integer|distinct|min:'.$minimum.'|max:'.$maximum])->validate();

            return ['field' => $filter['field'], 'operator' => $operator, 'date_part' => $part, 'value' => array_map('intval', array_values($validated['value']))];
        }
        $textOperators = ['contains', 'not_contains', 'starts_with', 'ends_with', 'is_empty', 'not_empty'];
        if (in_array($operator, $textOperators) && $type !== 'text') {
            $this->invalid('operator', 'این عملگر فقط برای متن مجاز است.');
        }
        if (array_key_exists('case_sensitive', $filter)) {
            if (! in_array($operator, ['contains', 'not_contains', 'starts_with', 'ends_with']) && $filter['case_sensitive']) {
                $this->invalid('case_sensitive', 'حساسیت به بزرگی حروف فقط برای شرط‌های متنی مجاز است.');
            }
            Validator::make($filter, ['case_sensitive' => 'boolean'])->validate();
        }
        if (in_array($operator, ['is_null', 'not_null', 'is_empty', 'not_empty'])) {
            return ['field' => $filter['field'], 'operator' => $operator, 'value' => null];
        }
        $value = $filter['value'] ?? null;
        $values = in_array($operator, ['between', 'not_between', 'in', 'not_in']) ? $value : [$value];
        if (! is_array($values) || ! $values || count($values) > 100 || (in_array($operator, ['between', 'not_between']) && count($values) !== 2)) {
            $this->invalid('value', 'مقدار یا بازهٔ فیلتر معتبر نیست.');
        }
        foreach ($values as &$item) {
            $this->typed($item, $type);
            if ($type === 'number') {
                $item += 0;
            } elseif ($type === 'boolean') {
                $item = (int) $item;
            }
        }
        unset($item);
        if (in_array($operator, ['between', 'not_between']) && $values[0] > $values[1]) {
            $this->invalid('value', 'ابتدای بازه باید قبل از انتهای آن باشد.');
        }

        return ['field' => $filter['field'], 'operator' => $operator, 'value' => in_array($operator, ['between', 'not_between', 'in', 'not_in']) ? array_values($values) : $values[0], ...array_fill_keys(in_array($operator, ['contains', 'not_contains', 'starts_with', 'ends_with']) ? ['case_sensitive'] : [], (bool) ($filter['case_sensitive'] ?? false))];
    }

    public function datePartExpression(string $field, string $part, string $driver): string
    {
        return match ($driver) {
            'sqlite' => match ($part) {
                'day_of_week' => "((CAST(strftime('%w', $field) AS INTEGER) + 6) % 7 + 1)", 'month' => "CAST(strftime('%m', $field) AS INTEGER)",
                'quarter' => "((CAST(strftime('%m', $field) AS INTEGER) + 2) / 3)", 'hour' => "CAST(strftime('%H', $field) AS INTEGER)",
            },
            'pgsql' => 'EXTRACT('.['day_of_week' => 'ISODOW', 'month' => 'MONTH', 'quarter' => 'QUARTER', 'hour' => 'HOUR'][$part].' FROM '.$field.')',
            'clickhouse' => match ($part) {
                'day_of_week' => "toDayOfWeek(toDate($field))", 'month' => "toMonth(toDate($field))",
                'quarter' => "toQuarter(toDate($field))", 'hour' => "toHour(toDateTime($field))",
            },
        };
    }

    private function textCondition(string $field, string $operator, string $value, \Closure $bind, string $driver, bool $caseSensitive): string
    {
        $needle = $bind($value);
        if (! $caseSensitive) {
            $lower = $driver === 'clickhouse' ? 'lowerUTF8' : 'LOWER';
            $field = "$lower($field)";
            $needle = "$lower($needle)";
        }
        $contains = match ($driver) {
            'sqlite' => "INSTR($field, $needle)", 'pgsql' => "POSITION($needle IN $field)", 'clickhouse' => "positionUTF8($field, $needle)",
        };
        if (in_array($operator, ['contains', 'not_contains'])) {
            return $contains.($operator === 'contains' ? ' > 0' : ' = 0');
        }
        if ($driver === 'clickhouse') {
            return ($operator === 'starts_with' ? 'startsWith' : 'endsWith')."($field, $needle)";
        }
        $comparison = $bind($value);
        if (! $caseSensitive) {
            $comparison = "LOWER($comparison)";
        }

        return $operator === 'starts_with' ? "SUBSTR($field, 1, LENGTH($needle)) = $comparison" : "SUBSTR($field, LENGTH($field) - LENGTH($needle) + 1) = $comparison";
    }

    public function typed(mixed $value, string $type): void
    {
        Validator::make(['value' => $value], ['value' => match ($type) {
            'number' => 'required|numeric', 'date' => 'required|date_format:Y-m-d', 'boolean' => 'required|boolean', default => 'required|string|max:500',
        }])->validate();
    }

    public function validateSql(string $sql): void
    {
        // Native SQL is a single read-only SELECT/CTE. Driver sessions also enforce read-only mode.
        $clean = preg_replace('/\x27(?:\x27\x27|[^\x27])*\x27|--[^\n]*|\/\*.*?\*\//s', ' ', $sql);
        if (! preg_match('/^\s*(SELECT|WITH)\b/i', $clean) || str_contains($clean, ';') || preg_match('/\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|ATTACH|DETACH|PRAGMA|COPY|CALL|EXECUTE|GRANT|REVOKE|SET|INTO|OUTFILE|FORMAT|SETTINGS|SYSTEM|OPTIMIZE|LOAD|VACUUM|file|url|remote|s3|mysql|postgresql|sqlite|pg_read_file|pg_write_file|dblink|load_extension)\b/i', $clean)) {
            $this->invalid('sql', 'فقط یک Query خواندنی SELECT یا WITH مجاز است؛ دستورات نوشتن، فایل و اتصال خارجی مجاز نیستند.');
        }
    }

    public function quote(string $identifier, string $driver): string
    {
        if ($driver === 'clickhouse') {
            return '`'.str_replace(['\\', '`'], ['\\\\', '\\`'], $identifier).'`';
        }

        return '"'.str_replace('"', '""', $identifier).'"';
    }

    private function tableQuote(string $table, string $driver, ?string $schema = null): string
    {
        if ($driver === 'sqlite') {
            return $this->quote($table, $driver);
        }
        // ClickHouse identifiers may contain dots, including .inner_id.* tables.
        $parts = $driver === 'clickhouse'
            ? ($schema !== null && str_starts_with($table, $schema.'.') ? [$schema, substr($table, strlen($schema) + 1)] : explode('.', $table, 2))
            : explode('.', $table);

        return implode('.', array_map(fn ($part) => $this->quote($part, $driver), $parts));
    }

    private function column(array $field): array
    {
        return ['key' => $field['key'], 'label' => $field['label'], 'type' => $field['type'], ...collect($field)->only(['raw_type', 'primary', 'relation', 'source_table', 'source_field', 'semantic_type', 'hidden', 'grain', 'role', 'computed', 'original_name', 'display_names', 'label_kind'])->all()];
    }

    private function field(array $fields, string $key): void
    {
        if (! isset($fields[$key])) {
            $this->invalid('field', 'ستون انتخاب‌شده در منبع داده وجود ندارد.');
        }
    }

    private function dateExpression(string $field, string $grain, string $driver): string
    {
        return match ($driver) {
            'sqlite' => match ($grain) {
                'day' => "date($field)", 'week' => "date($field, '-6 days', 'weekday 1')", 'month' => "strftime('%Y-%m-01', $field)",
                'year' => "strftime('%Y-01-01', $field)", 'quarter' => "printf('%s-%02d-01', strftime('%Y', $field), ((cast(strftime('%m', $field) as integer)-1)/3)*3+1)",
            },
            'pgsql' => "CAST(date_trunc('$grain', $field) AS date)",
            'clickhouse' => match ($grain) {
                'day' => "toDate($field)", 'week' => "toStartOfWeek(toDate($field), 1)", 'month' => "toStartOfMonth(toDate($field))", 'quarter' => "toStartOfQuarter(toDate($field))", 'year' => "toStartOfYear(toDate($field))",
            },
        };
    }

    private function invalid(string $field, string $message): never
    {
        throw ValidationException::withMessages([$field => $message]);
    }
}
