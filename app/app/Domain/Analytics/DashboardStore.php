<?php

namespace App\Domain\Analytics;

use App\Models\AnalyticsConnection;
use App\Models\AnalyticsDashboard;
use App\Models\AnalyticsDashboardFilter;
use App\Models\AnalyticsDashboardRevision;
use App\Models\AnalyticsDashboardTab;
use App\Models\AnalyticsDashboardWidget;
use App\Models\AnalyticsFilterBinding;
use App\Models\AnalyticsFolder;
use App\Models\AnalyticsReport;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

class DashboardStore
{
    public function __construct(private ReportRunner $runner) {}

    public function snapshot(AnalyticsDashboard $dashboard): array
    {
        $widgets = AnalyticsDashboardWidget::query()->where('dashboard_id', $dashboard->id)->orderBy('y')->orderBy('x')->get();
        $filters = AnalyticsDashboardFilter::query()->where('dashboard_id', $dashboard->id)->orderBy('position')->get();
        $bindings = AnalyticsFilterBinding::query()->whereIn('widget_id', $widgets->pluck('id'))->get();

        return [
            'id' => $dashboard->id, 'name' => $dashboard->name, 'description' => $dashboard->description,
            'folder_id' => $dashboard->folder_id, 'version' => $dashboard->version, 'settings' => $dashboard->settings,
            'tabs' => AnalyticsDashboardTab::query()->where('dashboard_id', $dashboard->id)->orderBy('position')->get()->map(fn ($tab) => ['key' => $tab->key, 'name' => $tab->name])->all(),
            'widgets' => $widgets->map(fn ($widget) => [
                'key' => $widget->key, 'report_id' => $widget->report_id, 'tab_key' => $widget->tab_key, 'type' => $widget->type,
                'x' => $widget->x, 'y' => $widget->y, 'w' => $widget->w, 'h' => $widget->h,
                'settings' => $widget->settings, 'content' => $widget->content,
                'click_behavior' => $widget->click_behavior ?? [],
            ])->all(),
            'filters' => $filters->map(fn ($filter) => [
                'key' => $filter->key, 'label' => $filter->label, 'type' => $filter->type, 'required' => (bool) $filter->required,
                'default_value' => $filter->default_value, 'settings' => $filter->settings,
                'bindings' => $bindings->where('filter_id', $filter->id)->map(fn ($binding) => ['widget_key' => $widgets->firstWhere('id', $binding->widget_id)->key, 'target' => $binding->target, 'operator' => $binding->operator])->values()->all(),
            ])->all(),
        ];
    }

    private function validateSnapshot(AnalyticsDashboard $dashboard, array $payload, int $actorId): array
    {
        abort_unless($dashboard->canEdit($actorId), 403);
        $data = Validator::make($payload, [
            'name' => 'required|string|max:150', 'description' => 'nullable|string|max:3000', 'folder_id' => 'nullable|integer',
            'version' => 'required|integer|min:0', 'settings' => 'present|array',
            'settings.auto_apply' => 'sometimes|boolean', 'settings.width' => ['sometimes', Rule::in(['wide', 'fixed'])],
            'settings.refresh_interval' => ['sometimes', Rule::in([0, 30, 60, 300])],
            'tabs' => 'required|array|min:1|max:12', 'tabs.*.key' => 'required|string|max:80|distinct|regex:/^[a-zA-Z0-9_-]+$/', 'tabs.*.name' => 'required|string|max:100',
            'widgets' => 'present|array|max:60', 'widgets.*.key' => 'required|string|max:80|distinct|regex:/^[a-zA-Z0-9_-]+$/', 'widgets.*.tab_key' => 'required|string|max:80',
            'widgets.*.type' => ['required', Rule::in(['report', 'text', 'heading', 'link'])], 'widgets.*.report_id' => 'nullable|integer',
            'widgets.*.x' => 'required|integer|min:0|max:23', 'widgets.*.y' => 'required|integer|min:0|max:1000',
            'widgets.*.w' => 'required|integer|min:2|max:24', 'widgets.*.h' => 'required|integer|min:2|max:30',
            'widgets.*.settings' => 'present|array', 'widgets.*.content' => 'nullable|string|max:20000', 'widgets.*.click_behavior' => 'nullable|array',
            'widgets.*.settings.title' => 'nullable|string|max:150', 'widgets.*.settings.decimals' => 'sometimes|integer|min:0|max:6',
            'widgets.*.settings.legend' => 'sometimes|boolean', 'widgets.*.settings.horizontal' => 'sometimes|boolean',
            'widgets.*.settings.color' => 'sometimes|regex:/^#[a-fA-F0-9]{6}$/',
            'widgets.*.settings.series_colors' => 'sometimes|array|max:12000', 'widgets.*.settings.series_colors.*' => 'regex:/^#[a-fA-F0-9]{6}$/',
            'widgets.*.settings.color_custom' => 'sometimes|boolean', 'widgets.*.settings.color_by_category' => 'sometimes|boolean', 'widgets.*.settings.show_total' => 'sometimes|boolean',
            'widgets.*.settings.center_mode' => ['sometimes', Rule::in(['total', 'percentage', 'none'])],
            'widgets.*.settings.percent_visibility' => ['sometimes', Rule::in(['tooltip', 'legend', 'inside', 'both', 'off'])],
            'widgets.*.settings.ring_thickness' => 'sometimes|integer|min:10|max:45', 'widgets.*.settings.center_key' => 'nullable|string|max:4000',
            'widgets.*.settings.gauge_style' => ['sometimes', Rule::in(['semi', 'ring'])],
            'widgets.*.settings._series_colors' => 'prohibited',
            'filters' => 'present|array|max:20', 'filters.*.key' => 'required|string|max:80|distinct|regex:/^[a-zA-Z0-9_-]+$/', 'filters.*.label' => 'required|string|max:100',
            'filters.*.type' => ['required', Rule::in(['text', 'number', 'date', 'boolean', 'time_grain'])], 'filters.*.required' => 'required|boolean',
            'filters.*.settings' => 'present|array', 'filters.*.bindings' => 'present|array|max:60',
            'filters.*.settings.values' => 'sometimes|array|max:100', 'filters.*.settings.values.*' => 'string|max:500',
            'filters.*.settings.parent_key' => 'nullable|string|max:80',
            'filters.*.settings.widget_type' => ['sometimes', Rule::in(['dropdown', 'search', 'input'])],
            'filters.*.settings.case_sensitive' => 'sometimes|boolean',
            'filters.*.bindings.*.widget_key' => 'required|string', 'filters.*.bindings.*.target' => 'required|string',
            'filters.*.bindings.*.operator' => ['required', Rule::in([...config('analytics.operators'), 'grain'])],
        ])->validate();
        // Laravel omits empty parents when only optional nested keys have rules.
        $data['settings'] = $payload['settings'];
        foreach ($data['widgets'] as $index => &$widget) {
            $widget['settings'] = $payload['widgets'][$index]['settings'];
        }
        unset($widget);
        foreach ($data['filters'] as $index => &$filter) {
            $filter['settings'] = $payload['filters'][$index]['settings'];
        }
        unset($filter);
        if (! empty($data['folder_id'])) {
            abort_unless(AnalyticsFolder::query()->where('id', $data['folder_id'])->where('owner_id', $dashboard->owner_id)->exists(), 422, 'مجموعه معتبر نیست.');
        }
        $reports = AnalyticsReport::whereIn('id', array_column($data['widgets'], 'report_id'))->where('owner_id', $dashboard->owner_id)->get()->keyBy('id');
        $tabs = array_column($data['tabs'], 'key');
        foreach ($data['widgets'] as $widget) {
            if (! in_array($widget['tab_key'], $tabs, true) || $widget['x'] + $widget['w'] > 24) {
                $this->invalid('widgets', 'تب یا ابعاد کارت معتبر نیست.');
            }
            if ($widget['type'] === 'report' && ! isset($reports[$widget['report_id'] ?? 0])) {
                $this->invalid('widgets', 'گزارش این کارت مجاز نیست.');
            }
            if (isset($widget['settings']['display']) && ! in_array($widget['settings']['display'], config('analytics.displays'))) {
                $this->invalid('widgets', 'نمایش کارت معتبر نیست.');
            }
            if ($widget['type'] === 'link' && (! filter_var($widget['content'], FILTER_VALIDATE_URL) || ! preg_match('~^https?://~i', $widget['content'] ?? ''))) {
                $this->invalid('content', 'آدرس لینک معتبر نیست.');
            }
        }
        foreach ($data['filters'] as $index => &$filter) {
            $filter['default_value'] = $payload['filters'][$index]['default_value'] ?? null;
            foreach ($filter['bindings'] as $binding) {
                $widget = collect($data['widgets'])->firstWhere('key', $binding['widget_key']);
                if (! $widget || $widget['type'] !== 'report') {
                    $this->invalid('bindings', 'فیلتر باید به یک کارت گزارش متصل شود.');
                }
                $report = $reports[$widget['report_id']];
                $definition = $report->query_definition;
                if ($definition['mode'] === 'native') {
                    $field = collect($definition['parameters'] ?? [])->firstWhere('key', $binding['target']);
                    if ($binding['operator'] !== 'eq') {
                        $this->invalid('bindings', 'متغیر SQL یک مقدار می‌پذیرد؛ عملگر برابر با را انتخاب کنید.');
                    }
                } else {
                    $connection = AnalyticsConnection::findOrFail($definition['connection_id']);
                    $fields = $this->runner->filterFields($connection, $definition);
                    $field = $fields[$binding['target']] ?? null;
                }
                if (! $field || ($filter['type'] === 'time_grain' ? $field['type'] !== 'date' : $field['type'] !== $filter['type'])) {
                    $this->invalid('bindings', 'نوع فیلتر با ستون مقصد سازگار نیست.');
                }
                if ($filter['type'] === 'time_grain') {
                    if (empty($field['is_dimension']) || $binding['operator'] !== 'grain') {
                        $this->invalid('bindings', 'گروه‌بندی زمانی باید به بُعد تاریخی گزارش متصل شود.');
                    }
                    if ($filter['default_value'] && ! in_array($filter['default_value'], ['day', 'week', 'month', 'quarter', 'year'])) {
                        $this->invalid('default_value', 'گروه‌بندی زمانی معتبر نیست.');
                    }
                } elseif ($filter['default_value'] !== null && $filter['default_value'] !== '') {
                    $this->parameterFilter($filter, $binding, $filter['default_value'], $definition['mode'] === 'native');
                }
            }
            if (count(array_column($filter['bindings'], 'widget_key')) !== count(array_unique(array_column($filter['bindings'], 'widget_key')))) {
                $this->invalid('bindings', 'اتصال تکراری فیلتر به کارت مجاز نیست.');
            }
            $parent = $filter['settings']['parent_key'] ?? null;
            if ($parent && ($parent === $filter['key'] || ! in_array($parent, array_column($data['filters'], 'key')))) {
                $this->invalid('filters', 'فیلتر وابسته معتبر نیست.');
            }
            if ($parent && (! empty($filter['settings']['values']) || ($filter['settings']['widget_type'] ?? 'dropdown') === 'input' || ! in_array($filter['type'], ['text', 'number', 'date', 'boolean'], true))) {
                $this->invalid('filters', 'فیلتر وابسته باید از مقادیر پویای دیتابیس استفاده کند.');
            }
        }
        unset($filter);
        foreach ($data['widgets'] as &$widget) {
            if ($widget['type'] === 'report') {
                $widget['click_behavior'] = app(ClickBehaviorValidator::class)->validate($widget['click_behavior'] ?? [], $reports[$widget['report_id']]->query_definition, $dashboard->owner_id, $data['filters'], $actorId);
            }
        }
        unset($widget);
        $parents = collect($data['filters'])->mapWithKeys(fn ($filter) => [$filter['key'] => $filter['settings']['parent_key'] ?? null])->all();
        foreach (array_keys($parents) as $key) {
            $seen = [];
            while ($key) {
                if (isset($seen[$key])) {
                    $this->invalid('filters', 'وابستگی حلقوی فیلترها مجاز نیست.');
                }
                $seen[$key] = true;
                $key = $parents[$key] ?? null;
            }
        }

        return $data;
    }

    public function save(AnalyticsDashboard $dashboard, array $payload, int $actorId): array
    {
        $data = $this->validateSnapshot($dashboard, $payload, $actorId);

        return DB::transaction(function () use ($dashboard, $data, $actorId) {
            $updated = AnalyticsDashboard::where('id', $dashboard->id)->where('version', $data['version'])->update([
                'name' => $data['name'], 'description' => $data['description'] ?? null, 'folder_id' => $data['folder_id'] ?? null,
                'settings' => json_encode($data['settings']), 'version' => $data['version'] + 1, 'updated_at' => now(),
            ]);
            abort_unless($updated, 409, 'این داشبورد توسط شخص دیگری تغییر کرده است. نسخهٔ تازه را باز کنید.');
            // Rows are keyed by stable client UUIDs, independent of database IDs.
            AnalyticsDashboardTab::query()->where('dashboard_id', $dashboard->id)->delete();
            AnalyticsDashboardFilter::query()->where('dashboard_id', $dashboard->id)->delete();
            AnalyticsDashboardWidget::query()->where('dashboard_id', $dashboard->id)->delete();
            foreach ($data['tabs'] as $position => $tab) {
                AnalyticsDashboardTab::query()->create(['dashboard_id' => $dashboard->id, 'key' => $tab['key'], 'name' => $tab['name'], 'position' => $position]);
            }
            $widgetIds = [];
            foreach ($data['widgets'] as $widget) {
                $widgetIds[$widget['key']] = AnalyticsDashboardWidget::query()->create([
                    'dashboard_id' => $dashboard->id, 'key' => $widget['key'], 'tab_key' => $widget['tab_key'],
                    'report_id' => $widget['type'] === 'report' ? $widget['report_id'] : null, 'type' => $widget['type'],
                    'x' => $widget['x'], 'y' => $widget['y'], 'w' => $widget['w'], 'h' => $widget['h'],
                    'settings' => $widget['settings'], 'content' => $widget['content'] ?? null, 'click_behavior' => $widget['click_behavior'] ?? [],
                ])->id;
            }
            foreach ($data['filters'] as $position => $filter) {
                $id = AnalyticsDashboardFilter::query()->create([
                    'dashboard_id' => $dashboard->id, 'key' => $filter['key'], 'label' => $filter['label'], 'type' => $filter['type'],
                    'default_value' => $filter['default_value'], 'required' => $filter['required'], 'position' => $position, 'settings' => $filter['settings'],
                ])->id;
                foreach ($filter['bindings'] as $binding) {
                    AnalyticsFilterBinding::query()->create(['filter_id' => $id, 'widget_id' => $widgetIds[$binding['widget_key']], 'target' => $binding['target'], 'operator' => $binding['operator']]);
                }
            }
            $snapshot = $this->snapshot($dashboard->refresh());
            AnalyticsDashboardRevision::query()->create(['dashboard_id' => $dashboard->id, 'created_by' => $actorId, 'version' => $snapshot['version'], 'snapshot' => $snapshot, 'created_at' => now()]);

            return $snapshot;
        });
    }

    public function preview(AnalyticsDashboard $dashboard, array $draft, int $actorId, string $widgetKey, array $parameters): array
    {
        $snapshot = $this->validateSnapshot($dashboard, $draft, $actorId);

        return $this->widgetQuery($dashboard, $widgetKey, $parameters, true, false, $snapshot);
    }

    public function widgetQuery(AnalyticsDashboard $dashboard, string $widgetKey, array $parameters, bool $refresh = false, bool $details = false, ?array $snapshot = null): array
    {
        $context = $this->interactionContext($dashboard, $widgetKey, $parameters, $snapshot);
        if (isset($context['waiting_for_filter'])) {
            return ['columns' => [], 'rows' => [], 'meta' => ['waiting_for_filter' => $context['waiting_for_filter']]];
        }
        $definition = $context['definition'];
        $extra = $context['extra_filters'];
        if ($details && isset($parameters['_clicked']) && is_array($parameters['_clicked'])) {
            // Only dimensions already present in the saved report can be used for drill-through.
            $stageIndex = ! empty($definition['stages']) ? array_key_last($definition['stages']) : null;
            $dimensions = $stageIndex !== null ? $definition['stages'][$stageIndex]['dimensions'] : $definition['dimensions'];
            foreach ($dimensions as $dimension) {
                $key = $dimension['field'];
                if (! array_key_exists($key, $parameters['_clicked'])) {
                    continue;
                }
                $value = $parameters['_clicked'][$key];
                $target = $stageIndex !== null ? 'stage:'.$stageIndex.':'.$key : $key;
                if ($value === null) {
                    $extra[] = ['field' => $target, 'operator' => 'is_null', 'value' => null];

                    continue;
                }
                if (! empty($dimension['grain'])) {
                    $this->runner->typed($value, 'date');
                    $start = CarbonImmutable::parse($value);
                    $end = match ($dimension['grain']) {
                        'day' => $start, 'week' => $start->addDays(6), 'month' => $start->endOfMonth(),
                        'quarter' => $start->addMonths(3)->subDay(), 'year' => $start->endOfYear(),
                    };
                    $extra[] = ['field' => $target, 'operator' => 'between', 'value' => [$start->format('Y-m-d'), $end->format('Y-m-d')]];
                } else {
                    $extra[] = ['field' => $target, 'operator' => 'eq', 'value' => $value];
                }
            }
        }

        return $this->runner->run($definition, $dashboard->owner_id, $extra, $refresh, $details);
    }

    public function interactionContext(AnalyticsDashboard $dashboard, string $widgetKey, array $parameters = [], ?array $snapshot = null): array
    {
        $snapshot ??= $this->snapshot($dashboard);
        $widget = collect($snapshot['widgets'])->firstWhere('key', $widgetKey);
        abort_unless($widget && $widget['type'] === 'report', 404);
        $report = AnalyticsReport::where('owner_id', $dashboard->owner_id)->findOrFail($widget['report_id']);
        $definition = $report->query_definition;
        $extra = [];
        foreach ($snapshot['filters'] as $filter) {
            $binding = collect($filter['bindings'])->firstWhere('widget_key', $widgetKey);
            if (! $binding) {
                continue;
            }
            $value = array_key_exists($filter['key'], $parameters) ? $parameters[$filter['key']] : $filter['default_value'];
            if ($value === null || $value === '' || $value === []) {
                if ($filter['required']) {
                    return ['definition' => $definition, 'extra_filters' => $extra, 'widget' => $widget, 'waiting_for_filter' => $filter['label']];
                }

                continue;
            }
            if ($filter['type'] === 'time_grain') {
                if (! in_array($value, ['day', 'week', 'month', 'quarter', 'year'])) {
                    $this->invalid('parameters', 'گروه‌بندی زمانی معتبر نیست.');
                }
                [$stageIndex, $fieldKey] = $this->runner->filterLocation($binding['target']);
                $dimensions = &$definition['dimensions'];
                if ($stageIndex !== null) {
                    $dimensions = &$definition['stages'][$stageIndex]['dimensions'];
                }
                foreach ($dimensions as &$dimension) {
                    if ($dimension['field'] === $fieldKey) {
                        $dimension['grain'] = $value;
                    }
                }
                unset($dimension, $dimensions);
            } else {
                $extra[] = $this->parameterFilter($filter, $binding, $value, $definition['mode'] === 'native');
            }
        }

        return ['definition' => $definition, 'extra_filters' => $extra, 'widget' => $widget];
    }

    public function parameterFilter(array $filter, array $binding, mixed $value, bool $native = false): array
    {
        if (is_array($value) && ! array_is_list($value)) {
            $negative = in_array($binding['operator'], ['neq', 'not_in', 'not_null', 'not_empty', 'not_contains', 'not_between'], true);
            if ($value === ['kind' => 'null'] && ! $native) {
                return ['field' => $binding['target'], 'operator' => $negative ? 'not_null' : 'is_null', 'value' => null];
            }
            if ($value === ['kind' => 'empty'] && ! $native && $filter['type'] === 'text') {
                return ['field' => $binding['target'], 'operator' => $negative ? 'not_empty' : 'is_empty', 'value' => null];
            }
            if (($value['kind'] ?? '') === 'presence' && ! $native) {
                Validator::make($value, ['empty' => 'required|boolean'])->validate();

                return ['field' => $binding['target'], 'operator' => $value['empty'] ? 'is_null' : 'not_null', 'value' => null];
            }
            if (($value['kind'] ?? '') === 'date_parts' && $filter['type'] === 'date' && ! $native) {
                $parts = Validator::make($value, ['part' => 'required|in:day_of_week,month,quarter,hour', 'values' => 'required|array|min:1|max:24', 'values.*' => 'required|integer|distinct', 'exclude' => 'sometimes|boolean'])->validate();

                return $this->runner->validatedFilter(['field' => $binding['target'], 'operator' => ($parts['exclude'] ?? true) ? 'not_in' : 'in', 'date_part' => $parts['part'], 'value' => $parts['values']], 'date');
            }
            if ($filter['type'] === 'date' && in_array($value['kind'] ?? '', ['relative_date', 'date_range'], true)) {
                [$from, $to, $exclude] = $this->dateParameterRange($value);
                if ($native) {
                    if ($exclude || $from !== $to) {
                        $this->invalid('parameters', 'متغیر سادهٔ SQL یک تاریخ می‌پذیرد؛ برای بازهٔ زمانی از فیلتر ستون استفاده کنید.');
                    }

                    return $this->runner->validatedFilter(['field' => $binding['target'], 'operator' => 'eq', 'value' => $from], 'date');
                }

                return $this->runner->validatedFilter(['field' => $binding['target'], 'operator' => $exclude ? 'not_between' : 'between', 'value' => [$from, $to]], 'date');
            }
            $this->invalid('parameters', 'مقدار ویژهٔ فیلتر معتبر نیست؛ متغیر SQL مقدار تهی نمی‌پذیرد.');
        }

        $condition = ['field' => $binding['target'], 'operator' => $binding['operator'], 'value' => $value];
        if ($filter['type'] === 'text' && in_array($binding['operator'], ['contains', 'not_contains', 'starts_with', 'ends_with'], true)) {
            $condition['case_sensitive'] = (bool) ($filter['settings']['case_sensitive'] ?? false);
        }

        return $this->runner->validatedFilter($condition, $filter['type']);
    }

    public function dateParameterRange(array $value): array
    {
        return app(DateFilterRange::class)->parameterRange($value);
    }

    public function filterOptions(AnalyticsDashboard $dashboard, string $filterKey, array $parameters = [], array $options = []): array
    {
        return app(FilterValueService::class)->options($dashboard, $this->snapshot($dashboard), $filterKey, $parameters, $options);
    }

    private function invalid(string $key, string $message): never
    {
        throw ValidationException::withMessages([$key => $message]);
    }
}
