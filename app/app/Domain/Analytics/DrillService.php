<?php

namespace App\Domain\Analytics;

use App\Models\AnalyticsConnection;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

/** Clicks select server-owned result coordinates, never client-supplied SQL or values. */
class DrillService
{
    public function __construct(private ReportRunner $runner) {}

    public function options(array $definition, int $ownerId, array $context, array $extraFilters = []): array
    {
        $state = $this->prepare($definition, $ownerId, $context, $extraFilters);

        return ['context' => $state['context'], 'actions' => $this->actions($state), 'query_definition' => $state['definition']];
    }

    public function resolveContext(array $definition, int $ownerId, array $context, array $extraFilters = []): array
    {
        $state = $this->prepare($definition, $ownerId, $context, $extraFilters);

        return ['query_definition' => $state['definition'], 'row' => $state['row'], 'column' => $state['column'], 'columns' => $state['result']['columns'], 'context' => $state['context']];
    }

    public function apply(array $definition, int $ownerId, array $context, string $actionId, array $extraFilters = [], array $input = []): array
    {
        $state = $this->prepare($definition, $ownerId, $context, $extraFilters);
        $action = collect($this->actions($state))->firstWhere('id', $actionId);
        if (! $action) {
            $this->invalid('action', 'این عملیات برای ستون و ردیف انتخاب‌شده در دسترس نیست.');
        }
        $query = $state['definition'];
        if ($query['mode'] === 'native') {
            $query = $this->nativeAction($state, $action, $input);
        } else {
            $query = $this->structuredAction($state, $action, $input);
        }
        $query = $this->runner->validate($query, $ownerId);
        $result = $this->runner->run($query, $ownerId);
        $record = null;
        if (in_array($action['type'], ['object_details', 'foreign_details', 'related_records'])) {
            $table = collect($state['connection']->catalog)->firstWhere('key', $query['source']);
            $record = ['table_key' => $query['source'], 'table_label' => $table['label'] ?? $query['source'], 'label' => $table['label'] ?? $query['source'], ...collect($table)->only(['original_name', 'display_names', 'label_kind'])->all()];
        }

        return ['query_definition' => $query, 'result' => $result, 'action' => $action, 'display' => $action['display'] ?? null, 'record' => $record];
    }

    private function prepare(array $definition, int $ownerId, array $context, array $extraFilters): array
    {
        if (array_diff(array_keys($context), ['column_key', 'row_index', 'result_signature', 'kind', 'scope_fields'])) {
            $this->invalid('context', 'برای انتخاب داده فقط شناسهٔ ستون و شمارهٔ ردیف مجاز است.');
        }
        $context = Validator::make($context, [
            'column_key' => 'required|string|max:200', 'row_index' => 'nullable|integer|min:0',
            'result_signature' => 'sometimes|string|regex:/^[a-f0-9]{64}$/',
            'kind' => ['sometimes', Rule::in(['header', 'cell', 'point', 'total'])],
            'scope_fields' => 'sometimes|array|max:6', 'scope_fields.*' => 'required|string|distinct|max:200',
        ])->validate();
        $definition = $this->runner->validate($definition, $ownerId);
        $connection = AnalyticsConnection::where('owner_id', $ownerId)->findOrFail($definition['connection_id']);
        $connection->catalog = $connection->displayCatalog();
        $definition = $this->materialize($definition, $connection, $extraFilters);
        $definition = $this->runner->validate($definition, $ownerId);
        $result = $this->runner->run($definition, $ownerId);
        $column = collect($result['columns'])->firstWhere('key', $context['column_key']);
        if (! $column) {
            $this->invalid('column_key', 'ستون انتخاب‌شده در خروجی این پرسش وجود ندارد.');
        }
        $signature = hash('sha256', json_encode([$result['columns'], $result['rows']]));
        if (isset($context['result_signature'])) {
            abort_unless(hash_equals($signature, $context['result_signature']), 409, 'داده‌ها تغییر کرده‌اند؛ نتیجه را دوباره اجرا کنید.');
        }
        $rowIndex = isset($context['row_index']) ? (int) $context['row_index'] : null;
        $kind = $context['kind'] ?? ($rowIndex === null ? 'header' : 'cell');
        if (($kind === 'header' && $rowIndex !== null) || (in_array($kind, ['cell', 'point']) && $rowIndex === null)) {
            $this->invalid('context', 'نوع انتخاب و شمارهٔ ردیف سازگار نیستند.');
        }
        $row = $rowIndex !== null ? ($result['rows'][$rowIndex] ?? null) : null;
        if ($rowIndex !== null && ! $row) {
            $this->invalid('row_index', 'ردیف انتخاب‌شده در خروجی فعلی وجود ندارد.');
        }
        $value = $row[$column['key']] ?? null;
        $contexts = $definition['mode'] === 'native' ? [] : $this->runner->stageContexts($definition, $connection);
        $last = $contexts ? $contexts[array_key_last($contexts)] : null;
        $sample = $value ?? collect($result['rows'])->pluck($column['key'])->first(fn ($value) => $value !== null);
        if ($definition['mode'] === 'native' && $column['type'] === 'text' && $sample !== null && preg_match('/^\d{4}-\d{2}-\d{2}(?:[ T].*)?$/D', (string) $sample)) {
            $column['type'] = 'date';
        }
        $summary = null;
        foreach (array_reverse($contexts) as $stage) {
            if ($stage['definition']['mode'] === 'aggregate') {
                $summary = $stage;
                break;
            }
        }
        $breakouts = $summary ? array_column($summary['definition']['dimensions'], 'field') : ($definition['mode'] === 'native' ? array_values(array_diff(array_column($result['columns'], 'key'), [$column['key']])) : []);
        $scope = $context['scope_fields'] ?? $breakouts;
        if ($definition['mode'] === 'native' && ! array_key_exists('scope_fields', $context)) {
            $scope = [];
        }
        if (array_diff($scope, $breakouts) || ($kind === 'total' && $rowIndex === null && $scope)) {
            $this->invalid('scope_fields', 'مجموع فقط می‌تواند روی گروه‌بندی‌های واقعی این پرسش انتخاب شود.');
        }
        if ($kind === 'total') {
            $virtualRow = [];
            foreach ($scope as $field) {
                $virtualRow[$field] = $row[$field] ?? null;
            }
            $dimensionKeys = $summary ? array_column($summary['definition']['dimensions'], 'field') : $scope;
            $measureKeys = $definition['mode'] === 'native' ? ($column['type'] === 'number' ? [$column['key']] : [])
                : array_column(array_filter($result['columns'], fn ($column) => $column['type'] === 'number' && ! in_array($column['key'], $dimensionKeys, true)), 'key');
            foreach ($measureKeys as $key) {
                $virtualRow[$key] = 0.0;
            }
            foreach ($result['rows'] as $candidate) {
                $matching = true;
                foreach ($scope as $field) {
                    if (($candidate[$field] ?? null) !== ($row[$field] ?? null)) {
                        $matching = false;
                        break;
                    }
                }
                if ($matching) {
                    foreach ($measureKeys as $key) {
                        if (is_numeric($candidate[$key] ?? null)) {
                            $virtualRow[$key] += $candidate[$key];
                        }
                    }
                }
            }
            $row = $virtualRow;
            $value = $row[$column['key']] ?? null;
        }

        return ['definition' => $definition, 'connection' => $connection, 'owner_id' => $ownerId, 'result' => $result,
            'row' => $row, 'column' => $column, 'value' => $value, 'contexts' => $contexts, 'last' => $last, 'summary' => $summary,
            'context' => ['column_key' => $column['key'], 'row_index' => $rowIndex, 'kind' => $kind, 'scope_fields' => $scope, 'column_label' => $column['label'], 'label' => $column['label'], ...collect($column)->only(['original_name', 'display_names', 'label_kind'])->all(), 'type' => $column['type'], 'value' => $value, 'result_signature' => $signature]];
    }

    private function materialize(array $query, AnalyticsConnection $connection, array $filters): array
    {
        if ($query['mode'] === 'native') {
            foreach ($filters as $filter) {
                $index = array_search($filter['field'], array_column($query['parameters'], 'key'), true);
                if ($index === false) {
                    $this->invalid('parameters', 'متغیر داشبورد در SQL وجود ندارد.');
                }
                $this->runner->typed($filter['value'], $query['parameters'][$index]['type']);
                $query['parameters'][$index]['default'] = $filter['value'];
            }

            return $query;
        }
        $contexts = $this->runner->stageContexts($query, $connection);
        foreach ($filters as $filter) {
            [$index, $field] = $this->runner->filterLocation($filter['field']);
            $stageNumber = $index === null ? 0 : $index + 1;
            $metadata = $contexts[$stageNumber]['fields'][$field] ?? null;
            if (! $metadata) {
                $this->invalid('parameters', 'ستون مقصد فیلتر داشبورد در این مرحله وجود ندارد.');
            }
            $filter = $this->runner->validatedFilter([...$filter, 'field' => $field], $metadata['type']);
            if ($index === null) {
                $query['filters'][] = $filter;
            } else {
                $query['stages'][$index]['filters'][] = $filter;
            }
        }

        return $query;
    }

    private function actions(array $state): array
    {
        $actions = [];
        $query = $state['definition'];
        $column = $state['column'];
        $native = $query['mode'] === 'native';
        $header = $state['context']['kind'] === 'header';
        $last = $native ? null : $state['last']['definition'];
        $canFilter = $native ? count($query['parameters']) < 10 : ($last['mode'] !== 'aggregate' || count($query['stages'] ?? []) < 5);
        $add = function (string $id, string $type, string $label, string $group, array $attributes = []) use (&$actions) {
            $actions[] = ['id' => $id, 'type' => $type, 'label' => $label, 'group' => $group, ...$attributes];
        };
        $title = fn (array $entity, string $prefix = '', string $suffix = '') => ['display_names' => MetadataLabels::titleNames($entity, $prefix, $suffix), 'label_kind' => 'physical'];
        if ($header) {
            if ($canFilter) {
                $add('filter:custom', 'custom_filter', 'فیلتر این ستون', 'filter', ['requires_input' => true, 'field_key' => $column['key'], 'field_type' => $column['type']]);
            }
            $existing = $native ? null : collect($last['sort'])->firstWhere('key', $column['key']);
            foreach (['asc' => 'مرتب‌سازی صعودی', 'desc' => 'مرتب‌سازی نزولی'] as $direction => $label) {
                if (($existing['direction'] ?? null) !== $direction) {
                    $add('sort:'.$direction, 'sort', $label, 'sort', ['direction' => $direction]);
                }
            }
            if ($native || ($last['mode'] === 'rows' && ($column['role'] ?? null) !== 'metric')) {
                $structured = in_array($column['semantic_type'] ?? '', ['description', 'comment']) || preg_match('/json|map|array|tuple/i', $column['raw_type'] ?? '');
                if (! $structured && empty($column['primary']) && ($column['type'] !== 'number' || $native || count($last['expressions'] ?? []) < 10)) {
                    $add('distribution', 'distribution', 'توزیع مقادیر این ستون', 'distribution', ['display' => 'bar']);
                }
                $functions = ['count_distinct' => 'تعداد مقادیر یکتا'];
                if ($column['type'] === 'number') {
                    $functions = ['sum' => 'مجموع', 'avg' => 'میانگین', ...$functions];
                }
                $functions += ['min' => 'کمینه', 'max' => 'بیشینه'];
                foreach ($functions as $function => $label) {
                    $add('summarize:'.$function, 'summarize', $label.' '.$column['label'], 'summarize', ['function' => $function, 'display' => 'number', ...$title($column, $label.' ')]);
                }
                $date = $native ? $this->nativeDateColumn($state) : collect($state['last']['fields'])->first(fn ($field) => $field['type'] === 'date' && empty($field['hidden']));
                if ($column['type'] === 'number' && $date) {
                    $add('summarize:sum_by_time', 'summarize_time', 'مجموع '.$column['label'].' در طول زمان', 'summarize', ['function' => 'sum', 'field_key' => $date['key'], 'field_label' => $date['label'], 'grain' => 'month', 'display' => 'line', ...$title($column, 'مجموع ', ' در طول زمان')]);
                }
            }

            return $actions;
        }
        $filterableValue = $state['value'] === null || ($column['type'] === 'text' ? is_string($state['value']) && mb_strlen($state['value']) <= 500 : true);
        if ($state['context']['kind'] !== 'total' && $canFilter && $filterableValue && empty($column['primary']) && empty($column['relation']) && ($native || $last['mode'] !== 'aggregate' || count($last['dimensions']) > 0)) {
            $empty = $state['value'] === null || ($column['type'] === 'text' && $state['value'] === '');
            $operators = $empty ? ($column['type'] === 'text' ? ['is_empty' => 'خالی است', 'not_empty' => 'خالی نیست'] : ['is_null' => 'خالی است', 'not_null' => 'خالی نیست']) : ['eq' => 'برابر با', 'neq' => 'برابر نیست با'];
            if ($state['value'] !== null && in_array($column['type'], ['number', 'date'])) {
                $operators = ['lt' => 'کوچک‌تر از', 'gt' => 'بزرگ‌تر از', ...$operators];
            }
            foreach ($operators as $operator => $label) {
                $add('filter:'.$operator, 'quick_filter', $label, 'quick_filter', ['operator' => $operator]);
            }
            if ($column['type'] === 'text' && ! $empty) {
                foreach (['contains' => 'شامل متن', 'not_contains' => 'شامل متن نیست'] as $operator => $label) {
                    $add('filter:'.$operator, 'quick_filter', $label, 'quick_filter', ['operator' => $operator, 'requires_input' => true, 'field_type' => 'text']);
                }
            }
        }
        if ($native) {
            $add('underlying', 'underlying', 'نمایش نتیجهٔ SQL به صورت جدول', 'records', ['display' => 'table']);
            foreach ($state['result']['columns'] as $field) {
                if ($field['type'] === 'text') {
                    $add('breakout:'.rawurlencode($field['key']), 'breakout', 'گروه‌بندی بر اساس '.$field['label'], 'breakout', ['field_key' => $field['key'], 'field_label' => $field['label'], 'display' => 'bar', ...$title($field, 'گروه‌بندی بر اساس ')]);
                }
            }

            return $actions;
        }
        $summary = $state['summary'];
        if ($canFilter && ! empty($column['relation']) && empty($column['primary']) && $state['context']['kind'] !== 'total') {
            $add('foreign_filter', 'foreign_filter', 'مشاهدهٔ ردیف‌های دارای این ارتباط', 'filter', ['operator' => $state['value'] === null ? 'is_null' : 'eq']);
        }
        if ($summary && $this->traceableDimensions($state, $summary)) {
            $add('underlying', 'underlying', 'مشاهدهٔ ردیف‌های سازندهٔ این نتیجه', 'records', ['display' => 'table']);

            foreach ($this->scopeDimensions($state, $summary) as $dimension) {
                $next = ['year' => 'quarter', 'quarter' => 'month', 'month' => 'week', 'week' => 'day'][$dimension['grain'] ?? ''] ?? null;
                if ($next && $state['row'][$dimension['field']] !== null) {
                    $labels = ['quarter' => 'فصل', 'month' => 'ماه', 'week' => 'هفته', 'day' => 'روز'];
                    $add('zoom:'.$next, 'zoom', 'نمایش این بازه بر اساس '.$labels[$next], 'zoom', ['grain' => $next, 'field_key' => $dimension['field'], 'display' => 'line']);
                    break;
                }
            }
            foreach ($summary['fields'] as $field) {
                if (empty($field['hidden']) && empty($field['primary']) && in_array($field['type'], ['text', 'boolean', 'date'])) {
                    $add('breakout:'.rawurlencode($field['key']), 'breakout', 'تفکیک بر اساس '.$field['label'], 'breakout', ['field_key' => $field['key'], 'field_label' => $field['label'], 'display' => 'bar', ...$title($field, 'تفکیک بر اساس ')]);
                }
            }

        }
        if ($last['mode'] === 'rows' && $state['row'] !== null) {
            $object = $this->objectKeys($state);
            if ($object) {
                $add('object_details', 'object_details', 'مشاهدهٔ جزئیات رکورد', 'records', ['display' => 'table', 'table_key' => $object['table']]);
                foreach ($state['connection']->catalog as $table) {
                    foreach ($table['fields'] as $field) {
                        $relation = $field['relation'] ?? null;
                        if ($relation && empty($relation['composite']) && empty($field['hidden']) && $relation['table'] === $object['table'] && array_key_exists($relation['field'], $object['values'])) {
                            $add('related:'.rawurlencode($table['key']).':'.rawurlencode($field['key']), 'related_records', 'رکوردهای مرتبط در '.$table['label'], 'records', ['display' => 'table', 'table_key' => $table['key'], 'field_key' => $field['key'], 'target_field' => $relation['field'], ...$title($table, 'رکوردهای مرتبط در ')]);
                        }
                    }
                }
            }
            $relation = $column['relation'] ?? null;
            if ($relation && empty($relation['composite']) && $state['value'] !== null && collect($state['connection']->catalog)->contains('key', $relation['table'])) {
                $add('foreign_details', 'foreign_details', 'مشاهدهٔ رکورد مرتبط', 'records', ['display' => 'table', 'table_key' => $relation['table'], 'field_key' => $relation['field']]);
            }
        }

        return $actions;
    }

    private function traceableDimensions(array $state, array $summary): bool
    {
        foreach ($this->scopeDimensions($state, $summary) as $dimension) {
            if (! $state['row'] || ! array_key_exists($dimension['field'], $state['row'])) {
                return false;
            }
        }

        return true;
    }

    private function scopeDimensions(array $state, array $summary): array
    {
        return array_filter($summary['definition']['dimensions'], fn ($dimension) => in_array($dimension['field'], $state['context']['scope_fields'], true));
    }

    private function structuredAction(array $state, array $action, array $input): array
    {
        $query = $state['definition'];
        $lastIndex = $state['last']['index'];
        $stage = $state['last']['definition'];
        $column = $state['column'];
        switch ($action['type']) {
            case 'quick_filter':
            case 'custom_filter':
            case 'foreign_filter':
                $filter = $this->filter($state, $action, $input);
                if ($stage['mode'] === 'aggregate') {
                    $query['stages'][] = $this->rowStage();
                    $lastIndex++;
                    $stage = $query['stages'][array_key_last($query['stages'])];
                }
                $stage['filters'][] = $filter;
                break;
            case 'sort':
                $stage['sort'] = [['key' => $column['key'], 'direction' => $action['direction']]];
                break;
            case 'underlying':
            case 'zoom':
            case 'breakout':
                $summary = $state['summary'];
                $lastIndex = $summary['index'];
                $query['stages'] = array_slice($query['stages'] ?? [], 0, $lastIndex);
                $stage = $summary['definition'];
                foreach ($this->scopeDimensions($state, $summary) as $dimension) {
                    if ($action['type'] === 'zoom' && $dimension['field'] !== $action['field_key']) {
                        continue;
                    }
                    $stage['filters'][] = $this->dimensionFilter($dimension, $state['row'][$dimension['field']]);
                }
                $stage['sort'] = [];
                $stage['limit'] = null;
                $stage['limit_explicit'] = false;
                unset($stage['columns']);
                if ($action['type'] === 'underlying') {
                    $stage['mode'] = 'rows';
                    $stage['metrics'] = [];
                    $stage['dimensions'] = [];
                } elseif ($action['type'] === 'zoom') {
                    foreach ($stage['dimensions'] as &$dimension) {
                        if ($dimension['field'] === $action['field_key']) {
                            $dimension['grain'] = $action['grain'];
                        }
                    }
                    unset($dimension);
                } else {
                    $field = $summary['fields'][$action['field_key']];
                    $stage['dimensions'] = [['field' => $field['key'], 'grain' => $field['type'] === 'date' ? 'month' : null]];
                }
                break;
            case 'distribution':
                if ($column['type'] === 'number' && empty($column['relation'])) {
                    $boundsStage = [...$stage, 'mode' => 'aggregate', 'metrics' => [['key' => 'drill_min', 'function' => 'min', 'field' => $column['key']], ['key' => 'drill_max', 'function' => 'max', 'field' => $column['key']]], 'dimensions' => [], 'sort' => [], 'limit' => null, 'limit_explicit' => false];
                    $boundsQuery = $this->replaceStage($query, $lastIndex, $boundsStage);
                    $bounds = $this->runner->run($boundsQuery, $state['owner_id'])['rows'][0] ?? [];
                    $width = $this->binWidth($bounds['drill_min'] ?? null, $bounds['drill_max'] ?? null);
                    $key = $this->uniqueKey('drill_bin', array_keys($state['last']['fields']));
                    $stage['expressions'][] = ['key' => $key, 'label' => $column['label'].' (بازهٔ '.$width.')', 'expression' => 'floor(['.$column['key'].'] / '.$width.') * '.$width];
                    $dimension = ['field' => $key];
                } else {
                    $dimension = ['field' => $column['key'], 'grain' => $column['type'] === 'date' ? 'month' : null];
                }
                $stage = [...$stage, 'mode' => 'aggregate', 'metrics' => [['key' => 'drill_count', 'label' => 'تعداد', 'function' => 'count']], 'dimensions' => [$dimension], 'sort' => [], 'limit' => null, 'limit_explicit' => false];
                unset($stage['columns']);
                break;
            case 'summarize':
                $stage = [...$stage, 'mode' => 'aggregate', 'metrics' => [['key' => 'drill_value', 'label' => $action['label'], 'function' => $action['function'], 'field' => $column['key']]], 'dimensions' => [], 'sort' => [], 'limit' => null, 'limit_explicit' => false];
                unset($stage['columns']);
                break;
            case 'summarize_time':
                $stage = [...$stage, 'mode' => 'aggregate', 'metrics' => [['key' => 'drill_value', 'label' => $action['label'], 'function' => 'sum', 'field' => $column['key']]], 'dimensions' => [['field' => $action['field_key'], 'grain' => $action['grain']]], 'sort' => [], 'limit' => null, 'limit_explicit' => false];
                unset($stage['columns']);
                break;
            case 'object_details':
                $object = $this->objectKeys($state);
                if ($object['table'] === $query['source'] && $lastIndex === 0) {
                    unset($stage['columns']);
                    $stage['limit'] = null;
                    $stage['limit_explicit'] = false;
                    foreach ($object['values'] as $key => $value) {
                        $stage['filters'][] = ['field' => $key, 'operator' => 'eq', 'value' => $value];
                    }
                    break;
                }

                return $this->tableQuery($state, $object['table'], array_map(fn ($key, $value) => ['field' => $key, 'operator' => 'eq', 'value' => $value], array_keys($object['values']), array_values($object['values'])));
            case 'foreign_details':
                return $this->tableQuery($state, $action['table_key'], [['field' => $action['field_key'], 'operator' => 'eq', 'value' => $state['value']]]);
            case 'related_records':
                $object = $this->objectKeys($state);

                return $this->tableQuery($state, $action['table_key'], [['field' => $action['field_key'], 'operator' => 'eq', 'value' => $object['values'][$action['target_field']]]]);
        }

        return $this->replaceStage($query, $lastIndex, $stage);
    }

    private function filter(array $state, array $action, array $input): array
    {
        if (array_diff(array_keys($input), ['operator', 'value', 'case_sensitive', 'date_part', 'relative_date'])) {
            $this->invalid('input', 'فقط عملگر و مقدار شرط قابل تنظیم است.');
        }
        if (array_key_exists('relative_date', $input) && ($state['definition']['mode'] === 'native' || $action['type'] !== 'custom_filter')) {
            $this->invalid('relative_date', 'بازهٔ نسبی فقط در فیلتر سفارشی پرسش گرافیکی پشتیبانی می‌شود.');
        }
        $operator = $action['type'] === 'custom_filter' || (($action['requires_input'] ?? false) && isset($input['operator'])) ? ($input['operator'] ?? '') : $action['operator'];
        $value = ($action['requires_input'] ?? false) && array_key_exists('value', $input) ? $input['value'] : $state['value'];
        if ($state['column']['type'] === 'date' && is_string($value) && preg_match('/^\d{4}-\d{2}-\d{2}/', $value)) {
            $value = substr($value, 0, 10);
        }

        return $this->runner->validatedFilter(['field' => $state['column']['key'], 'operator' => $operator, 'value' => $value, ...array_intersect_key($input, ['case_sensitive' => true, 'date_part' => true, 'relative_date' => true])], $state['column']['type']);
    }

    private function dimensionFilter(array $dimension, mixed $value): array
    {
        if ($value === null) {
            return ['field' => $dimension['field'], 'operator' => 'is_null', 'value' => null];
        }
        if (empty($dimension['grain'])) {
            return ['field' => $dimension['field'], 'operator' => 'eq', 'value' => $value];
        }
        $this->runner->typed($value, 'date');
        $start = CarbonImmutable::parse($value);
        $end = match ($dimension['grain']) {
            'day' => $start, 'week' => $start->addDays(6), 'month' => $start->endOfMonth(), 'quarter' => $start->addMonths(3)->subDay(), 'year' => $start->endOfYear(),
        };

        return ['field' => $dimension['field'], 'operator' => 'between', 'value' => [$start->format('Y-m-d'), $end->format('Y-m-d')]];
    }

    private function objectKeys(array $state): ?array
    {
        $tableKey = $state['column']['source_table'] ?? $state['definition']['source'];
        $table = collect($state['connection']->catalog)->firstWhere('key', $tableKey);
        $primary = array_filter($table['fields'] ?? [], fn ($field) => ! empty($field['primary']));
        if (! $primary) {
            return null;
        }
        $values = [];
        foreach ($primary as $field) {
            $column = collect($state['result']['columns'])->first(fn ($column) => ($column['source_table'] ?? null) === $tableKey && ($column['source_field'] ?? null) === $field['key']);
            if (! $column || ! isset($state['row'][$column['key']])) {
                return null;
            }
            $values[$field['key']] = $state['row'][$column['key']];
        }

        return ['table' => $tableKey, 'values' => $values];
    }

    private function nativeAction(array $state, array $action, array $input): array
    {
        $query = $state['definition'];
        $driver = $state['connection']->driver;
        $quote = fn ($key) => $this->runner->quote($key, $driver);
        $source = '('.$query['sql'].') '.$quote('analytics_drill');
        $field = $quote('analytics_drill').'.'.$quote($state['column']['key']);
        $sql = 'SELECT * FROM '.$source;
        switch ($action['type']) {
            case 'quick_filter':
            case 'custom_filter':
                $filter = $this->filter($state, $action, $input);
                if (in_array($filter['operator'], ['is_null', 'not_null', 'is_empty', 'not_empty'])) {
                    $sql .= ' WHERE '.match ($filter['operator']) {
                        'is_null' => "$field IS NULL", 'not_null' => "$field IS NOT NULL", 'is_empty' => "($field IS NULL OR $field = '')", 'not_empty' => "($field IS NOT NULL AND $field <> '')",
                    };
                    break;
                }
                if (! empty($filter['date_part'])) {
                    $field = $this->runner->datePartExpression($field, $filter['date_part'], $driver);
                } elseif ($state['column']['type'] === 'date') {
                    $field = match ($driver) {
                        'sqlite' => "date($field)", 'pgsql' => "CAST($field AS date)", 'clickhouse' => "toDate($field)"
                    };
                } elseif ($state['column']['type'] === 'boolean' && $driver === 'pgsql') {
                    $field = 'CAST('.$field.' AS INTEGER)';
                }
                $values = in_array($filter['operator'], ['between', 'not_between', 'in', 'not_in']) ? $filter['value'] : [$filter['value']];
                $parameters = [];
                foreach ($values as $value) {
                    if (count($query['parameters']) >= 10) {
                        $this->invalid('parameters', 'حداکثر ده متغیر در SQL مجاز است؛ تعداد شرط‌های این پرسش را کاهش دهید.');
                    }
                    $key = $this->uniqueKey('drill_parameter', array_column($query['parameters'], 'key'));
                    $query['parameters'][] = ['key' => $key, 'type' => $state['column']['type'] === 'boolean' || ! empty($filter['date_part']) ? 'number' : $state['column']['type'], 'default' => $value, 'required' => true];
                    $parameters[] = '{{'.$key.'}}';
                }
                $bound = $parameters[0];
                $predicate = match ($filter['operator']) {
                    'eq' => "$field = $bound", 'neq' => "$field <> $bound", 'gt' => "$field > $bound", 'lt' => "$field < $bound", 'gte' => "$field >= $bound", 'lte' => "$field <= $bound",
                    'between', 'not_between' => $field.($filter['operator'] === 'not_between' ? ' NOT' : '').' BETWEEN '.$parameters[0].' AND '.$parameters[1],
                    'in', 'not_in' => $field.($filter['operator'] === 'not_in' ? ' NOT' : '').' IN ('.implode(', ', $parameters).')',
                    default => $this->nativeTextCondition($field, $filter, $bound, $driver),
                };
                $sql .= ' WHERE '.$predicate;
                break;
            case 'sort':
                $sql .= ' ORDER BY '.$field.' '.strtoupper($action['direction']);
                break;
            case 'underlying':
                if (! $state['context']['scope_fields']) {
                    return $query;
                }
                $predicates = [];
                foreach ($state['context']['scope_fields'] as $key) {
                    $metadata = collect($state['result']['columns'])->firstWhere('key', $key);
                    $dimension = $quote('analytics_drill').'.'.$quote($key);
                    $value = $state['row'][$key] ?? null;
                    if ($value === null || $value === '') {
                        $predicates[] = $value === null ? "$dimension IS NULL" : "$dimension = ''";

                        continue;
                    }
                    if (count($query['parameters']) >= 10) {
                        $this->invalid('parameters', 'برای این محدوده متغیر SQL بیشتری لازم است؛ تعداد شرط‌های پرسش را کاهش دهید.');
                    }
                    $parameter = $this->uniqueKey('drill_scope', array_column($query['parameters'], 'key'));
                    if ($metadata['type'] === 'boolean') {
                        $value = (int) $value;
                        if ($driver === 'pgsql') {
                            $dimension = 'CAST('.$dimension.' AS INTEGER)';
                        }
                    }
                    $query['parameters'][] = ['key' => $parameter, 'type' => in_array($metadata['type'], ['number', 'boolean']) ? 'number' : 'text', 'default' => $value, 'required' => true];
                    $predicates[] = $dimension.' = {{'.$parameter.'}}';
                }
                $sql .= ' WHERE '.implode(' AND ', $predicates);
                break;
            case 'breakout':
                $dimension = $quote('analytics_drill').'.'.$quote($action['field_key']);
                $sql = 'SELECT '.$dimension.' AS '.$quote($action['field_key']).', COUNT(*) AS '.$quote('drill_count').' FROM '.$source.' GROUP BY '.$dimension.' ORDER BY '.$dimension;
                break;
            case 'summarize':
                $function = $action['function'] === 'count_distinct' ? 'COUNT(DISTINCT '.$field.')' : strtoupper($action['function']).'('.$field.')';
                $sql = 'SELECT '.$function.' AS '.$quote('drill_value').' FROM '.$source;
                break;
            case 'summarize_time':
                $date = $quote('analytics_drill').'.'.$quote($action['field_key']);
                $date = match ($driver) {
                    'sqlite' => "strftime('%Y-%m-01', $date)", 'pgsql' => "CAST(date_trunc('month', $date) AS date)", 'clickhouse' => "toStartOfMonth(toDate($date))"
                };
                $sql = 'SELECT '.$date.' AS '.$quote($action['field_key']).', SUM('.$field.') AS '.$quote('drill_value').' FROM '.$source.' GROUP BY '.$date.' ORDER BY '.$date;
                break;
            case 'distribution':
                if ($state['column']['type'] === 'number') {
                    $boundsQuery = [...$query, 'sql' => 'SELECT MIN('.$field.') AS '.$quote('drill_min').', MAX('.$field.') AS '.$quote('drill_max').' FROM '.$source];
                    $bounds = $this->runner->run($boundsQuery, $state['owner_id'])['rows'][0] ?? [];
                    $width = $this->binWidth($bounds['drill_min'] ?? null, $bounds['drill_max'] ?? null);
                    $compiled = (new ExpressionCompiler)->compile('floor([value] / '.$width.') * '.$width, ['value' => ['sql' => $field, 'type' => 'number']], $driver);
                    $field = $compiled['sql'];
                } elseif ($state['column']['type'] === 'date') {
                    $field = match ($driver) {
                        'sqlite' => "strftime('%Y-%m-01', $field)", 'pgsql' => "CAST(date_trunc('month', $field) AS date)", 'clickhouse' => "toStartOfMonth(toDate($field))"
                    };
                }
                $sql = 'SELECT '.$field.' AS '.$quote($state['column']['key']).', COUNT(*) AS '.$quote('drill_count').' FROM '.$source.' GROUP BY '.$field.' ORDER BY '.$field;
                break;
        }
        $query['sql'] = $sql;
        $query['limit'] = null;
        $query['limit_explicit'] = false;

        return $query;
    }

    private function nativeTextCondition(string $field, array $filter, string $bound, string $driver): string
    {
        if (empty($filter['case_sensitive'])) {
            $lower = $driver === 'clickhouse' ? 'lowerUTF8' : 'LOWER';
            $field = "$lower($field)";
            $bound = "$lower($bound)";
        }
        if (in_array($filter['operator'], ['contains', 'not_contains'])) {
            $position = match ($driver) {
                'sqlite' => "INSTR($field, $bound)", 'pgsql' => "POSITION($bound IN $field)", 'clickhouse' => "positionUTF8($field, $bound)"
            };

            return $position.($filter['operator'] === 'contains' ? ' > 0' : ' = 0');
        }
        if ($driver === 'clickhouse') {
            return ($filter['operator'] === 'starts_with' ? 'startsWith' : 'endsWith')."($field, $bound)";
        }

        return $filter['operator'] === 'starts_with' ? "SUBSTR($field, 1, LENGTH($bound)) = $bound" : "SUBSTR($field, LENGTH($field) - LENGTH($bound) + 1) = $bound";
    }

    private function nativeDateColumn(array $state): ?array
    {
        foreach ($state['result']['columns'] as $column) {
            $value = collect($state['result']['rows'])->pluck($column['key'])->first(fn ($value) => $value !== null);
            if ($value !== null && is_string($value) && preg_match('/^\d{4}-\d{2}-\d{2}(?:[ T].*)?$/D', $value)) {
                return $column;
            }
        }

        return null;
    }

    private function tableQuery(array $state, string $table, array $filters): array
    {
        return [...$this->rowStage(), 'connection_id' => $state['connection']->id, 'source' => $table, 'filters' => $filters];
    }

    private function rowStage(): array
    {
        return ['mode' => 'rows', 'metrics' => [], 'dimensions' => [], 'joins' => [], 'expressions' => [], 'filters' => [], 'sort' => [], 'limit' => null, 'limit_explicit' => false];
    }

    private function replaceStage(array $query, int $index, array $stage): array
    {
        unset($stage['source'], $stage['connection_id']);
        if ($index === 0) {
            return [...$query, ...$stage];
        }
        $query['stages'][$index - 1] = $stage;

        return $query;
    }

    private function uniqueKey(string $base, array $existing): string
    {
        $key = $base;
        for ($index = 1; in_array($key, $existing, true); $index++) {
            $key = $base.'_'.$index;
        }

        return $key;
    }

    private function binWidth(mixed $minimum, mixed $maximum): string
    {
        $range = (float) $maximum - (float) $minimum;
        if ($range <= 0 || ! is_finite($range)) {
            return '1';
        }
        $raw = $range / 10;
        $magnitude = pow(10, floor(log10($raw)));
        $width = ceil($raw / $magnitude) * $magnitude;

        return sprintf('%.12g', $width);
    }

    private function invalid(string $key, string $message): never
    {
        throw ValidationException::withMessages([$key => $message]);
    }
}
