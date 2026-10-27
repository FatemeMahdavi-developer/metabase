<?php

namespace App\Http\Controllers;

use App\Domain\Analytics\ClickBehaviorValidator;
use App\Domain\Analytics\ConnectionUniqueness;
use App\Domain\Analytics\DashboardStore;
use App\Domain\Analytics\DrillService;
use App\Domain\Analytics\Drivers\ConnectionManager;
use App\Domain\Analytics\ReportRunner;
use App\Models\AnalyticsConnection;
use App\Models\AnalyticsDashboard;
use App\Models\AnalyticsDashboardMember;
use App\Models\AnalyticsDashboardRevision;
use App\Models\AnalyticsDashboardWidget;
use App\Models\AnalyticsFolder;
use App\Models\AnalyticsReport;
use App\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

class AnalyticsController extends Controller
{
    public function __construct(private ReportRunner $runner, private DashboardStore $store, private ConnectionManager $connections, private DrillService $drills) {}

    public function index(Request $request): array
    {
        $userId = $request->user()->id;
        $shared = AnalyticsDashboardMember::query()->where('user_id', $userId)->pluck('dashboard_id');

        return [
            'connections' => AnalyticsConnection::where('owner_id', $userId)->whereIn('driver', config('analytics.connection_drivers'))->orderBy('name')->get()->map->publicData(),
            'folders' => AnalyticsFolder::query()->where('owner_id', $userId)->orderBy('name')->get(),
            'reports' => AnalyticsReport::where('owner_id', $userId)->latest()->get()->map(fn ($report) => $this->reportData($report)),
            'dashboards' => AnalyticsDashboard::where(fn ($query) => $query->where('owner_id', $userId)->orWhereIn('id', $shared))->latest()->get()->map(fn ($dashboard) => [...$dashboard->toArray(), 'can_edit' => $dashboard->canEdit($userId), 'is_owner' => $dashboard->owner_id === $userId]),
        ];
    }

    public function connectionSave(Request $request, ?AnalyticsConnection $connection = null): array
    {
        if ($connection?->exists) {
            abort_unless($connection->owner_id === $request->user()->id, 403);
            abort_unless($connection->isSupported(), 404);
        }
        $data = $this->connectionData($request, $connection);
        $connection ??= new AnalyticsConnection;
        $connection->fill([...$data, 'owner_id' => $request->user()->id, 'catalog' => null, 'synced_at' => null]);
        ConnectionUniqueness::validate($connection);
        if ($request->boolean('test_first')) {
            $connection->catalog = $this->connections->catalog($connection);
            $connection->synced_at = now();
        }
        $connection->save();

        return $connection->publicData();
    }

    private function reportData(AnalyticsReport $report): array
    {
        $definition = $report->query_definition;
        try {
            $fields = $this->runner->filterFields(AnalyticsConnection::findOrFail($definition['connection_id']), $definition);
        } catch (ValidationException|ModelNotFoundException) {
            $fields = [];
        }

        return [...$report->toArray(), 'available_fields' => array_values(array_map(fn ($field) => collect($field)->except('sql')->all(), $fields))];
    }

    public function connectionTest(Request $request): array
    {
        $existing = null;
        if ($request->filled('connection_id')) {
            $request->validate(['connection_id' => 'integer']);
            $existing = AnalyticsConnection::where('owner_id', $request->user()->id)->whereIn('driver', config('analytics.connection_drivers'))->findOrFail($request->integer('connection_id'));
        }
        $connection = new AnalyticsConnection([...$this->connectionData($request, $existing), 'owner_id' => $request->user()->id]);
        $catalog = $this->connections->catalog($connection);

        return ['ok' => true, 'table_count' => count($catalog), 'catalog' => $catalog];
    }

    public function connectionSync(Request $request, AnalyticsConnection $connection): array
    {
        abort_unless($connection->owner_id === $request->user()->id, 403);
        abort_unless($connection->isSupported(), 404);

        return $this->connections->sync($connection)->publicData();
    }

    public function connectionDelete(Request $request, AnalyticsConnection $connection): array
    {
        abort_unless($connection->owner_id === $request->user()->id, 403);
        abort_if(AnalyticsReport::where('owner_id', $connection->owner_id)->get()->contains(fn ($report) => $report->query_definition['connection_id'] === $connection->id), 422, 'ابتدا گزارش‌های این اتصال را حذف یا به منبع دیگری منتقل کنید.');
        $connection->delete();

        return ['ok' => true];
    }

    public function connectionMetadata(Request $request, AnalyticsConnection $connection): array
    {
        abort_unless($connection->owner_id === $request->user()->id, 403);
        abort_unless($connection->isSupported(), 404);
        $data = $request->validate(['table' => 'required|string|max:200', 'field' => 'nullable|string|max:200', 'label' => 'sometimes|required|string|max:150', 'labels' => 'sometimes|array:fa,en', 'labels.fa' => 'nullable|string|max:150', 'labels.en' => 'nullable|string|max:150', 'description' => 'nullable|string|max:3000', 'hidden' => 'sometimes|boolean', 'semantic_type' => ['nullable', Rule::in(['category', 'name', 'currency', 'quantity', 'percentage', 'url', 'email', 'city', 'country'])]]);
        $table = collect($connection->catalog ?? [])->firstWhere('key', $data['table']);
        abort_unless($table, 422, 'جدول معتبر نیست.');
        $metadata = $connection->metadata ?? [];
        $custom = collect($data)->except(['table', 'field'])->all();
        if (! empty($data['field'])) {
            abort_unless(collect($table['fields'])->contains('key', $data['field']), 422, 'ستون معتبر نیست.');
            $previous = $metadata[$data['table']]['fields'][$data['field']] ?? [];
            $metadata[$data['table']]['fields'][$data['field']] = $this->mergeDataMetadata($previous, $custom);
        } else {
            $metadata[$data['table']] = $this->mergeDataMetadata($metadata[$data['table']] ?? [], collect($custom)->only(['label', 'labels', 'description'])->all());
        }
        $connection->update(['metadata' => $metadata, 'catalog' => $this->connections->applyMetadata($connection->catalog, $metadata)]);

        return $connection->refresh()->publicData();
    }

    private function mergeDataMetadata(array $previous, array $changes): array
    {
        if (array_key_exists('labels', $changes)) {
            $changes['labels'] = [...($previous['labels'] ?? []), ...$changes['labels']];
        }

        return [...$previous, ...$changes];
    }

    private function connectionData(Request $request, ?AnalyticsConnection $connection = null): array
    {
        $data = $request->validate(['name' => 'required|string|max:150', 'driver' => ['required', Rule::in(config('analytics.connection_drivers'))], 'configuration' => 'required|array']);
        $configuration = Validator::make($data['configuration'], $data['driver'] === 'sqlite' ? ['path' => 'required|string|max:1000'] : [
            'host' => 'required|string|max:200|regex:/^[a-zA-Z0-9_.\-:\[\]]+$/', 'port' => 'required|integer|min:1|max:65535',
            'database' => 'required|string|max:150', 'username' => 'required|string|max:150', 'password' => 'nullable|string|max:500',
            'ssl' => 'sometimes|boolean', 'sslmode' => ['sometimes', Rule::in(['disable', 'prefer', 'require', 'verify-full'])],
        ])->validate();
        if ($connection && ! array_key_exists('password', $configuration) && $data['driver'] !== 'sqlite') {
            $configuration['password'] = $connection->configuration['password'] ?? '';
        }

        return ['name' => $data['name'], 'driver' => $data['driver'], 'configuration' => $configuration];
    }

    public function folderSave(Request $request): array
    {
        $data = $request->validate(['name' => 'required|string|max:100']);
        $id = AnalyticsFolder::query()->create([...$data, 'owner_id' => $request->user()->id])->id;

        return ['id' => $id, 'name' => $data['name']];
    }

    public function reportSave(Request $request, ?AnalyticsReport $report = null): array
    {
        $userId = $request->user()->id;
        if ($report?->exists) {
            abort_unless($report->owner_id === $userId, 403);
        }
        $data = $request->validate([
            'name' => 'required|string|max:150', 'description' => 'nullable|string|max:3000', 'folder_id' => 'nullable|integer',
            'query_definition' => 'required|array', 'display' => ['required', Rule::in(config('analytics.displays'))],
            'visualization_settings' => 'present|array', 'version' => 'sometimes|integer',
            'visualization_settings.decimals' => 'sometimes|integer|min:0|max:6',
            'visualization_settings.legend' => 'sometimes|boolean', 'visualization_settings.horizontal' => 'sometimes|boolean',
            'visualization_settings.color' => 'sometimes|regex:/^#[a-fA-F0-9]{6}$/',
            'visualization_settings.series_colors' => 'sometimes|array|max:12000', 'visualization_settings.series_colors.*' => 'regex:/^#[a-fA-F0-9]{6}$/',
            'visualization_settings.color_custom' => 'sometimes|boolean', 'visualization_settings.color_by_category' => 'sometimes|boolean', 'visualization_settings.show_total' => 'sometimes|boolean',
            'visualization_settings.center_mode' => ['sometimes', Rule::in(['total', 'percentage', 'none'])],
            'visualization_settings.percent_visibility' => ['sometimes', Rule::in(['tooltip', 'legend', 'inside', 'both', 'off'])],
            'visualization_settings.ring_thickness' => 'sometimes|integer|min:10|max:45', 'visualization_settings.center_key' => 'nullable|string|max:4000',
            'visualization_settings.gauge_style' => ['sometimes', Rule::in(['semi', 'ring'])],
            'visualization_settings._series_colors' => 'prohibited',
        ]);
        $data['visualization_settings'] = $request->input('visualization_settings');
        if (! empty($data['folder_id'])) {
            abort_unless(AnalyticsFolder::query()->where('id', $data['folder_id'])->where('owner_id', $userId)->exists(), 422);
        }
        $data['query_definition'] = $this->runner->validate($data['query_definition'], $userId);
        if ($report?->exists) {
            $updated = AnalyticsReport::where('id', $report->id)->where('version', $data['version'] ?? -1)->update([
                ...collect($data)->except('version')->all(), 'query_definition' => json_encode($data['query_definition']),
                'visualization_settings' => json_encode($data['visualization_settings']), 'version' => $report->version + 1, 'updated_at' => now(),
            ]);
            abort_unless($updated, 409, 'گزارش تغییر کرده است؛ نسخهٔ تازه را باز کنید.');

            return $report->refresh()->toArray();
        }

        return AnalyticsReport::create([...$data, 'owner_id' => $userId])->refresh()->toArray();
    }

    public function validateDefinition(Request $request): array
    {
        $data = $request->validate(['query_definition' => 'required|array']);

        return ['query_definition' => $this->runner->validate($data['query_definition'], $request->user()->id)];
    }

    public function validateExpression(Request $request): array
    {
        $data = $request->validate(['query_definition' => 'required|array', 'expression_key' => 'required|string|max:41', 'stage_index' => 'nullable|integer|min:0|max:4']);
        $definition = $this->runner->validate($data['query_definition'], $request->user()->id);
        $stageIndex = $data['stage_index'] ?? null;
        $stage = $stageIndex === null ? $definition : ($definition['stages'][$stageIndex] ?? null);
        abort_unless($stage && $stage['mode'] !== 'native', 422, 'مرحلهٔ ستون محاسباتی معتبر نیست.');
        $expression = collect($stage['expressions'] ?? [])->firstWhere('key', $data['expression_key']);
        abort_unless($expression, 422, 'ستون محاسباتی پیدا نشد.');

        return ['type' => $expression['type'], 'query_definition' => $definition];
    }

    public function preview(Request $request): array
    {
        $data = $request->validate(['query_definition' => 'required|array', 'parameters' => 'sometimes|array|max:20']);

        $definition = $this->runner->validate($data['query_definition'], $request->user()->id);

        return [...$this->runner->run($definition, $request->user()->id, $data['parameters'] ?? [], true), 'query_definition' => $definition];
    }

    public function reportQuery(Request $request, AnalyticsReport $report): array
    {
        abort_unless($report->owner_id === $request->user()->id, 403);
        $data = $request->validate(['filters' => 'sometimes|array|max:20', 'refresh' => 'sometimes|boolean', 'details' => 'sometimes|boolean']);

        return $this->runner->run($report->query_definition, $report->owner_id, $data['filters'] ?? [], $data['refresh'] ?? false, $data['details'] ?? false);
    }

    public function reportDelete(Request $request, AnalyticsReport $report): array
    {
        abort_unless($report->owner_id === $request->user()->id, 403);
        abort_if(AnalyticsDashboardWidget::query()->where('report_id', $report->id)->exists(), 422, 'این گزارش در داشبورد استفاده شده است؛ ابتدا کارت‌های آن را حذف کنید.');
        $report->delete();

        return ['ok' => true];
    }

    public function dashboardCreate(Request $request): array
    {
        $data = $request->validate(['name' => 'required|string|max:150', 'description' => 'nullable|string|max:3000', 'folder_id' => 'nullable|integer']);

        return DB::transaction(function () use ($data, $request) {
            $dashboard = AnalyticsDashboard::create([...$data, 'owner_id' => $request->user()->id, 'version' => 0, 'settings' => ['auto_apply' => true, 'width' => 'wide', 'refresh_interval' => 0]]);

            return $this->store->save($dashboard, [...$data, 'version' => 0, 'settings' => $dashboard->settings, 'tabs' => [['key' => 'main', 'name' => 'نمای کلی']], 'widgets' => [], 'filters' => []], $request->user()->id);
        });
    }

    public function dashboardShow(Request $request, AnalyticsDashboard $dashboard): array
    {
        abort_unless($dashboard->canRead($request->user()->id), 403);
        $snapshot = $this->store->snapshot($dashboard);
        $reports = AnalyticsReport::whereIn('id', array_column($snapshot['widgets'], 'report_id'))->get()->map(fn ($report) => $this->reportData($report))->all();

        return [...$snapshot, 'can_edit' => $dashboard->canEdit($request->user()->id), 'is_owner' => $dashboard->owner_id === $request->user()->id, 'reports' => $reports];
    }

    public function dashboardSave(Request $request, AnalyticsDashboard $dashboard): array
    {
        return $this->store->save($dashboard, $request->all(), $request->user()->id);
    }

    public function dashboardDelete(Request $request, AnalyticsDashboard $dashboard): array
    {
        abort_unless($dashboard->owner_id === $request->user()->id, 403);
        $dashboard->delete();

        return ['ok' => true];
    }

    public function dashboardCopy(Request $request, AnalyticsDashboard $dashboard): array
    {
        abort_unless($dashboard->owner_id === $request->user()->id, 403);

        return DB::transaction(function () use ($dashboard, $request) {
            $snapshot = $this->store->snapshot($dashboard);
            $copy = $dashboard->replicate();
            $copy->name .= ' — کپی';
            $copy->version = 0;
            $copy->save();
            $snapshot['name'] = $copy->name;
            $snapshot['version'] = 0;
            if ($request->boolean('copy_reports')) {
                $mapping = [];
                foreach ($snapshot['widgets'] as &$widget) {
                    if ($widget['report_id']) {
                        if (! isset($mapping[$widget['report_id']])) {
                            $report = AnalyticsReport::findOrFail($widget['report_id'])->replicate();
                            $report->name .= ' — کپی';
                            $report->version = 1;
                            $report->save();
                            $mapping[$widget['report_id']] = $report->id;
                        }
                        $widget['report_id'] = $mapping[$widget['report_id']];
                    }
                }
                unset($widget);
            }

            return $this->store->save($copy, $snapshot, $request->user()->id);
        });
    }

    public function widgetQuery(Request $request, AnalyticsDashboard $dashboard, string $widget): array
    {
        abort_unless($dashboard->canRead($request->user()->id), 403);
        $data = $request->validate(['parameters' => 'sometimes|array|max:30', 'refresh' => 'sometimes|boolean', 'details' => 'sometimes|boolean']);

        return $this->store->widgetQuery($dashboard, $widget, $data['parameters'] ?? [], $data['refresh'] ?? false, $data['details'] ?? false);
    }

    public function dashboardPreview(Request $request, AnalyticsDashboard $dashboard, string $widget): array
    {
        $data = $request->validate(['dashboard' => 'required|array', 'parameters' => 'sometimes|array|max:30']);

        return $this->store->preview($dashboard, $data['dashboard'], $request->user()->id, $widget, $data['parameters'] ?? []);
    }

    public function filterOptions(Request $request, AnalyticsDashboard $dashboard, string $filter): array
    {
        abort_unless($dashboard->canRead($request->user()->id), 403);
        $data = $request->validate(['parameters' => 'sometimes|array|max:30', 'search' => 'nullable|string|max:200', 'cursor' => 'nullable|string|max:2000', 'limit' => 'sometimes|integer|min:1|max:100']);

        return $this->store->filterOptions($dashboard, $filter, $data['parameters'] ?? [], collect($data)->except('parameters')->all());
    }

    public function reportInteraction(Request $request): array
    {
        $request->validate(['query_definition' => 'required|array']);
        $definition = $this->runner->validate($request->input('query_definition'), $request->user()->id);

        return $this->interact($request, $definition, $request->user()->id);
    }

    public function widgetInteraction(Request $request, AnalyticsDashboard $dashboard, string $widget): array
    {
        abort_unless($dashboard->canRead($request->user()->id), 403);
        if ($request->has('navigation_context')) {
            $data = $request->validate(['parameters' => 'sometimes|array|max:30', 'navigation_context' => 'required|array']);
            $navigation = $this->resolveWidgetNavigation($dashboard, $widget, $data['parameters'] ?? [], $data['navigation_context'], $request->user()->id);

            return $this->interact($request, $navigation['definition'], $navigation['owner_id']);
        }
        $data = $request->validate(['parameters' => 'sometimes|array|max:30']);
        // Shared viewers can only replay server-approved actions from this saved card.
        $context = $this->store->interactionContext($dashboard, $widget, $data['parameters'] ?? []);
        abort_if(isset($context['waiting_for_filter']), 422, 'ابتدا فیلترهای الزامی داشبورد را انتخاب کنید.');

        return $this->interact($request, $context['definition'], $dashboard->owner_id, $context['extra_filters']);
    }

    public function widgetClickReport(Request $request, AnalyticsDashboard $dashboard, string $widget): array
    {
        abort_unless($dashboard->canRead($request->user()->id), 403);
        $data = $request->validate(['parameters' => 'sometimes|array|max:30', 'context' => 'required|array']);
        $navigation = $this->resolveWidgetNavigation($dashboard, $widget, $data['parameters'] ?? [], $data['context'], $request->user()->id);

        return ['query_definition' => $navigation['definition'], 'result' => $this->runner->run($navigation['definition'], $navigation['owner_id']), 'report' => $this->reportData($navigation['report'])];
    }

    private function resolveWidgetNavigation(AnalyticsDashboard $dashboard, string $widgetKey, array $parameters, array $clickContext, int $actorId): array
    {
        $source = $this->store->interactionContext($dashboard, $widgetKey, $parameters);
        abort_if(isset($source['waiting_for_filter']), 422, 'ابتدا فیلترهای الزامی داشبورد را انتخاب کنید.');
        $resolved = $this->drills->resolveContext($source['definition'], $dashboard->owner_id, $clickContext, $source['extra_filters']);
        abort_unless($resolved['row'] !== null, 422, 'برای باز کردن پرسش مقصد یک ردیف داده انتخاب کنید.');
        $behavior = $source['widget']['click_behavior'] ?? [];
        $behavior = $behavior['columns'][$resolved['column']['key']] ?? $behavior;
        unset($behavior['columns']);
        $filters = $this->store->snapshot($dashboard)['filters'];
        $behavior = app(ClickBehaviorValidator::class)->validate([...$behavior, 'column' => $behavior['column'] ?? $resolved['column']['key']], $source['definition'], $dashboard->owner_id, $filters, $actorId);
        abort_unless($behavior['type'] === 'report', 422, 'رفتار کلیک این ستون پرسش مقصد ندارد.');
        $report = AnalyticsReport::findOrFail($behavior['report_id']);
        $definition = $this->runner->validate($report->query_definition, $report->owner_id);
        $native = $definition['mode'] === 'native';
        $sourceFilters = collect($filters)->keyBy('key');
        $columns = collect($resolved['columns'])->keyBy('key');
        foreach ($behavior['mappings'] as $mapping) {
            if ($mapping['source'] === 'column') {
                $specification = $columns[$mapping['key']];
                abort_unless(array_key_exists($mapping['key'], $resolved['row']), 422, 'ستون نگاشت‌شده در محدودهٔ مجموع انتخاب‌شده وجود ندارد؛ یک سلول واقعی را انتخاب کنید.');
                $value = $resolved['row'][$mapping['key']] ?? null;
                if ($specification['type'] === 'date' && is_string($value)) {
                    $value = substr($value, 0, 10);
                    if (! $native && ! empty($specification['grain'])) {
                        $this->runner->typed($value, 'date');
                        $start = CarbonImmutable::parse($value);
                        $end = match ($specification['grain']) {
                            'day' => $start, 'week' => $start->addDays(6), 'month' => $start->endOfMonth(),
                            'quarter' => $start->addMonths(3)->subDay(), 'year' => $start->endOfYear(),
                        };
                        $value = ['kind' => 'date_range', 'from' => $start->format('Y-m-d'), 'to' => $end->format('Y-m-d')];
                    }
                }
                $value = $value === null ? ['kind' => 'null'] : ($value === '' && $specification['type'] === 'text' ? ['kind' => 'empty'] : $value);
            } else {
                $specification = $sourceFilters[$mapping['key']];
                $value = array_key_exists($mapping['key'], $parameters) ? $parameters[$mapping['key']] : $specification['default_value'];
                if ($value === null || $value === '' || $value === []) {
                    continue;
                }
            }
            $operator = ! $native && is_array($value) && array_is_list($value)
                ? (in_array($specification['type'], ['number', 'date']) && count($value) === 2 ? 'between' : 'in') : 'eq';
            $condition = $this->store->parameterFilter($specification, ['target' => $mapping['target'], 'operator' => $operator], $value, $native);
            if ($native) {
                $index = array_search($mapping['target'], array_column($definition['parameters'], 'key'), true);
                $definition['parameters'][$index]['default'] = $condition['value'];
            } else {
                [$stageIndex, $fieldKey] = $this->runner->filterLocation($mapping['target']);
                $condition['field'] = $fieldKey;
                if ($stageIndex === null) {
                    $definition['filters'][] = $condition;
                } else {
                    $definition['stages'][$stageIndex]['filters'][] = $condition;
                }
            }
        }

        return ['definition' => $this->runner->validate($definition, $report->owner_id), 'owner_id' => $report->owner_id, 'report' => $report];
    }

    private function interact(Request $request, array $definition, int $ownerId, array $extra = []): array
    {
        $data = $request->validate([
            'context' => 'required|array', 'path' => 'sometimes|array|max:8',
            'path.*.context' => 'required|array', 'path.*.action_id' => 'required|string|max:400', 'path.*.input' => 'sometimes|array|max:3',
            'action_id' => 'sometimes|required|string|max:400', 'input' => 'sometimes|array|max:3',
        ]);
        foreach ($data['path'] ?? [] as $step) {
            $next = $this->drills->apply($definition, $ownerId, $step['context'], $step['action_id'], $extra, $step['input'] ?? []);
            $definition = $next['query_definition'];
            $extra = [];
        }

        return isset($data['action_id'])
            ? $this->drills->apply($definition, $ownerId, $data['context'], $data['action_id'], $extra, $data['input'] ?? [])
            : $this->drills->options($definition, $ownerId, $data['context'], $extra);
    }

    public function reportShow(Request $request, AnalyticsReport $report): array
    {
        abort_unless(app(ClickBehaviorValidator::class)->canReadReport($report, $request->user()->id), 403);

        return $this->reportData($report);
    }

    public function revisions(Request $request, AnalyticsDashboard $dashboard): array
    {
        abort_unless($dashboard->canEdit($request->user()->id), 403);

        return AnalyticsDashboardRevision::query()->where('dashboard_id', $dashboard->id)->orderByDesc('version')->get(['id', 'version', 'created_at'])->toArray();
    }

    public function restore(Request $request, AnalyticsDashboard $dashboard, int $revision): array
    {
        abort_unless($dashboard->canEdit($request->user()->id), 403);
        $row = AnalyticsDashboardRevision::query()->where('dashboard_id', $dashboard->id)->where('id', $revision)->first();
        abort_unless($row, 404);
        $snapshot = $row->snapshot;
        $snapshot['version'] = $request->validate(['version' => 'required|integer'])['version'];

        return $this->store->save($dashboard, $snapshot, $request->user()->id);
    }

    public function share(Request $request, AnalyticsDashboard $dashboard): array
    {
        abort_unless($dashboard->owner_id === $request->user()->id, 403);
        $data = $request->validate(['email' => 'required|email', 'role' => ['required', Rule::in(['viewer', 'editor', 'remove'])]]);
        $user = User::where('email', $data['email'])->first();
        abort_unless($user && $user->id !== $dashboard->owner_id, 422, 'کاربر دیگری با این ایمیل پیدا نشد.');
        if ($data['role'] === 'remove') {
            AnalyticsDashboardMember::query()->where('dashboard_id', $dashboard->id)->where('user_id', $user->id)->delete();
        } else {
            AnalyticsDashboardMember::query()->updateOrCreate(['dashboard_id' => $dashboard->id, 'user_id' => $user->id], ['role' => $data['role']]);
        }

        return ['ok' => true];
    }
}
