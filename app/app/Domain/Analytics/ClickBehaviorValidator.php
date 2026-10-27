<?php

namespace App\Domain\Analytics;

use App\Models\AnalyticsConnection;
use App\Models\AnalyticsDashboard;
use App\Models\AnalyticsDashboardWidget;
use App\Models\AnalyticsReport;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

class ClickBehaviorValidator
{
    public function __construct(private ReportRunner $runner) {}

    public function validate(array $click, array $reportDefinition, int $ownerId, array $currentFilters, int $actorId): array
    {
        $filters = collect($currentFilters)->keyBy('key')->all();
        $needsColumns = ! empty($click['columns']) || ! empty($click['column']) || ! empty($click['mappings']) || ($click['type'] ?? '') === 'filter' || str_contains(($click['url'] ?? '').($click['link_text'] ?? ''), '{{');
        $columns = $needsColumns ? $this->outputColumns($reportDefinition, $ownerId) : [];
        $result = $this->rule($click, $columns, $filters, $actorId);
        if (isset($click['columns'])) {
            if (! is_array($click['columns']) || count($click['columns']) > 50 || ($click['columns'] && array_is_list($click['columns']))) {
                $this->invalid('columns', 'رفتار هر ستون باید با شناسهٔ واقعی آن ذخیره شود.');
            }
            $result['columns'] = [];
            foreach ($click['columns'] as $key => $configuration) {
                if (! isset($columns[$key]) || ! is_array($configuration) || array_key_exists('columns', $configuration)) {
                    $this->invalid('columns', 'ستون یا تنظیم تو در توی رفتار کلیک معتبر نیست.');
                }
                $result['columns'][$key] = $this->rule($configuration, $columns, $filters, $actorId, $key);
            }
        }

        return $result;
    }

    public function canReadReport(AnalyticsReport $report, int $actorId): bool
    {
        if ($report->owner_id === $actorId) {
            return true;
        }

        return AnalyticsDashboardWidget::where('report_id', $report->id)
            ->whereHas('dashboard', fn ($query) => $query->where('owner_id', $actorId)
                ->orWhereHas('members', fn ($members) => $members->where('user_id', $actorId)))
            ->exists();
    }

    private function outputColumns(array $definition, int $ownerId): array
    {
        $definition = $this->runner->validate($definition, $ownerId);
        if ($definition['mode'] === 'native') {
            return collect($this->runner->run($definition, $ownerId)['columns'])->keyBy('key')->all();
        }
        $connection = AnalyticsConnection::where('owner_id', $ownerId)->findOrFail($definition['connection_id']);
        $contexts = $this->runner->stageContexts($definition, $connection);

        return collect($contexts[array_key_last($contexts)]['columns'])->keyBy('key')->all();
    }

    private function rule(array $click, array $columns, array $sourceFilters, int $actorId, ?string $selectedColumn = null): array
    {
        $data = Validator::make([...$click, 'type' => $click['type'] ?? 'menu'], [
            'type' => ['required', Rule::in(['menu', 'none', 'details', 'filter', 'dashboard', 'report', 'url'])],
            'column' => 'nullable|string|max:200', 'filter_key' => 'nullable|string|max:80',
            'dashboard_id' => 'nullable|integer|min:1', 'report_id' => 'nullable|integer|min:1',
            'url' => 'nullable|string|max:2000', 'link_text' => 'nullable|string|max:500',
            'mappings' => 'sometimes|array|max:20', 'mappings.*.target' => 'required|string|max:200|distinct',
            'mappings.*.source' => ['required', Rule::in(['column', 'parameter'])], 'mappings.*.key' => 'required|string|max:200',
        ])->validate();
        if (isset($data['column']) && ! isset($columns[$data['column']])) {
            $this->invalid('column', 'ستون مقدار کلیک در خروجی این پرسش وجود ندارد.');
        }
        $result = ['type' => $data['type']];
        if (in_array($data['type'], ['menu', 'none', 'details'])) {
            return $result;
        }
        if (isset($data['column'])) {
            $result['column'] = $data['column'];
        }
        $mappings = $data['mappings'] ?? [];
        if ($data['type'] === 'filter') {
            if (! $mappings && isset($data['filter_key'])) {
                $key = $data['column'] ?? $selectedColumn ?? array_key_first($columns);
                $mappings = [['target' => $data['filter_key'], 'source' => 'column', 'key' => $key]];
            }
            if (! $mappings) {
                $this->invalid('mappings', 'حداقل یک فیلتر مقصد برای کلیک انتخاب کنید.');
            }
            $this->mappings($mappings, $columns, $sourceFilters, $sourceFilters, false);
            $result['mappings'] = $mappings;
            // Keep the old fields readable by clients upgrading an existing dashboard.
            $result['filter_key'] = $mappings[0]['target'];
            $result['column'] = $mappings[0]['key'];

            return $result;
        }
        if ($data['type'] === 'dashboard') {
            $dashboard = AnalyticsDashboard::find($data['dashboard_id'] ?? 0);
            if (! $dashboard || ! $dashboard->canRead($actorId)) {
                $this->invalid('dashboard_id', 'داشبورد مقصد وجود ندارد یا به آن دسترسی ندارید.');
            }
            $targets = $dashboard->filters()->get(['key', 'type'])->mapWithKeys(fn ($filter) => [$filter->key => ['type' => $filter->type]])->all();
            $this->mappings($mappings, $columns, $sourceFilters, $targets, true);

            return [...$result, 'dashboard_id' => $dashboard->id, 'mappings' => $mappings];
        }
        if ($data['type'] === 'report') {
            $report = AnalyticsReport::find($data['report_id'] ?? 0);
            if (! $report || ! $this->canReadReport($report, $actorId)) {
                $this->invalid('report_id', 'پرسش مقصد وجود ندارد یا به آن دسترسی ندارید.');
            }
            $definition = $this->runner->validate($report->query_definition, $report->owner_id);
            if ($definition['mode'] === 'native') {
                $targets = collect($definition['parameters'])->keyBy('key')->all();
            } else {
                $connection = AnalyticsConnection::where('owner_id', $report->owner_id)->findOrFail($definition['connection_id']);
                $targets = $this->runner->filterFields($connection, $definition);
            }
            $this->mappings($mappings, $columns, $sourceFilters, $targets, true);

            return [...$result, 'report_id' => $report->id, 'mappings' => $mappings];
        }
        $url = $data['url'] ?? '';
        $this->placeholders($url, $columns, $sourceFilters);
        $testUrl = preg_replace('/\{\{[^{}]+\}\}/', 'analytics-value', $url);
        if (! preg_match('~^https?://~i', $url) || ! filter_var($testUrl, FILTER_VALIDATE_URL)) {
            $this->invalid('url', 'لینک باید یک آدرس معتبر http یا https باشد.');
        }
        $result['url'] = $url;
        if (isset($data['link_text'])) {
            $this->placeholders($data['link_text'], $columns, $sourceFilters);
            $result['link_text'] = $data['link_text'];
        }

        return $result;
    }

    private function mappings(array $mappings, array $columns, array $sourceFilters, array $targets, bool $allowParameters): void
    {
        $seen = [];
        foreach ($mappings as $mapping) {
            if (isset($seen[$mapping['target']])) {
                $this->invalid('mappings', 'هر مقصد فقط یک مقدار کلیک می‌پذیرد.');
            }
            $seen[$mapping['target']] = true;
            $target = $targets[$mapping['target']] ?? null;
            $source = $mapping['source'] === 'column' ? ($columns[$mapping['key']] ?? null) : ($sourceFilters[$mapping['key']] ?? null);
            if (! $allowParameters && $mapping['source'] !== 'column') {
                $this->invalid('mappings', 'تغییر فیلتر همین داشبورد باید از مقدار یک ستون انجام شود.');
            }
            if (! $target || ! $source || $target['type'] !== $source['type']) {
                $this->invalid('mappings', 'نوع ستون یا پارامتر با مقصد کلیک سازگار نیست.');
            }
        }
    }

    private function placeholders(string $text, array $columns, array $parameters): void
    {
        preg_match_all('/\{\{([^{}]+)\}\}/', $text, $matches);
        foreach ($matches[1] as $placeholder) {
            if ($placeholder === 'value' && $columns) {
                continue;
            }
            if (str_starts_with($placeholder, 'column:') && isset($columns[substr($placeholder, 7)])) {
                continue;
            }
            if (str_starts_with($placeholder, 'parameter:') && isset($parameters[substr($placeholder, 10)])) {
                continue;
            }
            $this->invalid('url', 'متغیر لینک باید از ستون‌ها یا پارامترهای واقعی داشبورد انتخاب شود.');
        }
        $without = preg_replace('/\{\{[^{}]+\}\}/', '', $text);
        if (str_contains($without, '{{') || str_contains($without, '}}')) {
            $this->invalid('url', 'متغیر لینک ناقص است.');
        }
    }

    private function invalid(string $field, string $message): never
    {
        throw ValidationException::withMessages(['click_behavior.'.$field => $message]);
    }
}
