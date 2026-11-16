<?php

namespace Database\Seeders;

use App\Domain\Analytics\DashboardStore;
use App\Domain\Analytics\Drivers\ConnectionManager;
use App\Domain\Analytics\ReportRunner;
use App\Models\AnalyticsConnection;
use App\Models\AnalyticsDashboard;
use App\Models\AnalyticsFolder;
use App\Models\AnalyticsReport;
use App\Models\User;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;

class AnalyticsSalesDemoSeeder extends Seeder
{
    public function run(): void
    {
        $users = User::query()->limit(2)->get();
        throw_unless($users->count() === 1, \RuntimeException::class, 'Expected exactly one panel user.');
        $user = $users->first();
        $connection = AnalyticsConnection::where('owner_id', $user->id)->where('driver', 'pgsql')->get()
            ->first(fn ($item) => ($item->metadata['_postgres_seed_profile'] ?? null) === 'pgsql');
        throw_unless($connection, \RuntimeException::class, 'Run AnalyticsPostgresSeeder first.');
        $existingId = $connection->metadata['_sales_demo_dashboard'] ?? null;
        $existingDashboard = $existingId ? AnalyticsDashboard::where('owner_id', $user->id)->find($existingId) : null;
        DB::transaction(function () use ($user): void {
            if (DB::table('analytics_records')->where('owner_id', $user->id)->exists()) {
                return;
            }
            $categories = ['الکترونیک', 'پوشاک', 'خانه و آشپزخانه', 'ورزشی', 'کتاب'];
            $cities = ['تهران', 'مشهد', 'اصفهان', 'شیراز', 'تبریز', 'کرج'];
            $statuses = ['تکمیل شده', 'تکمیل شده', 'تکمیل شده', 'در حال ارسال', 'لغو شده'];
            $rows = [];
            for ($i = 0; $i < 900; $i++) {
                $quantity = 1 + (($i * 7) % 5);
                $rows[] = [
                    'owner_id' => $user->id,
                    'ordered_at' => now()->startOfDay()->subDays(89 - intdiv($i, 10))->toDateString(),
                    'category' => $categories[($i * 3 + intdiv($i, 10)) % 5],
                    'city' => $cities[($i * 5 + intdiv($i, 17)) % 6],
                    'status' => $statuses[($i + intdiv($i, 13)) % 5],
                    'amount' => (180000 + (($i * 7919) % 1800000)) * $quantity,
                    'quantity' => $quantity,
                    'customer' => 'مشتری نمونه '.(1 + ($i % 180)),
                    'created_at' => now(), 'updated_at' => now(),
                ];
            }
            foreach (array_chunk($rows, 200) as $chunk) {
                DB::table('analytics_records')->insert($chunk);
            }
        });
        $samples = $this->soarData($user->id);
        $connection->update(['catalog' => app(ConnectionManager::class)->catalog($connection), 'synced_at' => now()]);
        $base = [
            'connection_id' => $connection->id, 'source' => 'public.analytics_records',
            'mode' => 'aggregate', 'metrics' => [], 'dimensions' => [],
            'filters' => [['field' => 'owner_id', 'operator' => 'eq', 'value' => $user->id]],
            'sort' => [], 'joins' => [], 'limit' => 100,
        ];
        $sum = [['key' => 'revenue', 'function' => 'sum', 'field' => 'amount', 'label' => 'فروش (تومان)']];
        $count = [['key' => 'orders', 'function' => 'count', 'field' => null, 'label' => 'تعداد سفارش']];
        $definitions = [
            'revenue' => ['کل فروش (تومان)', 'number', ['metrics' => $sum], [0, 0, 6, 4]],
            'orders' => ['تعداد سفارش‌ها', 'number', ['metrics' => $count], [6, 0, 6, 4]],
            'average' => ['میانگین ارزش سفارش (تومان)', 'number', ['metrics' => [['key' => 'average', 'function' => 'avg', 'field' => 'amount']]], [12, 0, 6, 4]],
            'quantity' => ['تعداد کالای فروخته‌شده', 'number', ['metrics' => [['key' => 'quantity', 'function' => 'sum', 'field' => 'quantity']]], [18, 0, 6, 4]],
            'trend' => ['روند روزانه فروش', 'area', ['metrics' => $sum, 'dimensions' => [['field' => 'ordered_at', 'grain' => 'day']], 'sort' => [['key' => 'ordered_at', 'direction' => 'asc']]], [0, 4, 14, 9]],
            'categories' => ['فروش به تفکیک دسته‌بندی', 'bar', ['metrics' => $sum, 'dimensions' => [['field' => 'category', 'grain' => null]], 'sort' => [['key' => 'revenue', 'direction' => 'desc']]], [14, 4, 10, 9]],
            'cities' => ['سهم فروش شهرها', 'doughnut', ['metrics' => $sum, 'dimensions' => [['field' => 'city', 'grain' => null]]], [0, 13, 12, 8]],
            'status' => ['وضعیت سفارش‌ها', 'bar', ['metrics' => $count, 'dimensions' => [['field' => 'status', 'grain' => null]]], [12, 13, 12, 8]],
            'details' => ['جزئیات سفارش‌ها', 'table', ['mode' => 'rows', 'columns' => ['ordered_at', 'customer', 'category', 'city', 'status', 'amount', 'quantity'], 'sort' => [['key' => 'ordered_at', 'direction' => 'desc']], 'limit' => 100], [0, 21, 24, 12]],
        ];
        $definitions += $this->soarDefinitions($base);
        $runner = app(ReportRunner::class);
        foreach ($definitions as $key => $definition) {
            $query = array_replace($base, $definition[2]);
            if ($query['source'] === 'soar_demo') {
                $query = $this->inlineSoarQuery($query, $connection, $samples);
            }
            $query = $runner->validate($query, $user->id);
            $result = $runner->run($query, $user->id, [], true);
            throw_if(empty($result['rows']), \RuntimeException::class, 'Empty demo report: '.$key);
            $definitions[$key][2] = $query;
            $this->command?->info('Verified report '.$key.': '.count($result['rows']).' rows');
        }
        $dashboard = DB::transaction(function () use ($user, $connection, $definitions, $existingDashboard, $samples) {
            $this->upgradeLegacySoarReports($connection, $samples);
            $folderId = $existingDashboard?->folder_id
                ?? AnalyticsFolder::firstOrCreate(['owner_id' => $user->id, 'name' => 'نمونه فروش PostgreSQL'])->id;
            $dashboard = $existingDashboard ?? AnalyticsDashboard::create([
                'owner_id' => $user->id, 'folder_id' => $folderId,
                'name' => 'داشبورد جامع فروش | داده نمونه', 'version' => 0, 'is_active' => true, 'settings' => [],
            ]);
            $store = app(DashboardStore::class);
            $payload = $store->snapshot($dashboard);
            $changed = false;
            foreach (['overview' => 'نمای کلی فروش', 'soar' => 'نمونه SOAR', 'report-types' => 'انواع گزارش'] as $key => $name) {
                if (! collect($payload['tabs'])->contains('key', $key)) {
                    $payload['tabs'][] = compact('key', 'name');
                    $changed = true;
                }
            }
            foreach ($definitions as $key => $definition) {
                [$name, $display, $query, $layout] = $definition;
                $tab = $definition[5] ?? 'overview';
                $widgetKey = $tab === 'overview' ? 'sales-'.$key : $key;
                // Keep existing reports, widget settings and user-adjusted layouts.
                if (collect($payload['widgets'])->contains('key', $widgetKey)) {
                    continue;
                }
                $report = AnalyticsReport::create([
                    'owner_id' => $user->id, 'folder_id' => $folderId,
                    'name' => $name,
                    'description' => $tab === 'overview' ? 'داده نمونه فروش؛ مبالغ به تومان' : 'داده نمایشی SOAR برای بررسی انواع گزارش و استایل روشن و تاریک',
                    'query_definition' => $query, 'display' => $display,
                    'visualization_settings' => array_replace(['legend' => true, 'decimals' => 0], $definition[4] ?? []),
                ]);
                [$x, $y, $w, $h] = $layout;
                $payload['widgets'][] = [
                    'key' => $widgetKey, 'type' => 'report', 'report_id' => $report->id,
                    'tab_key' => $tab, 'x' => $x, 'y' => $y, 'w' => $w, 'h' => $h,
                    'settings' => [], 'click_behavior' => ['type' => 'details'],
                ];
                $changed = true;
            }
            if (! $existingDashboard) {
                $payload['description'] = 'داده نمونه فروش ۹۰ روز اخیر؛ مبالغ به تومان. همراه نمونه SOAR و تمام انواع گزارش.';
                $payload['settings'] = ['auto_apply' => true, 'refresh_interval' => 0, 'width' => 'wide'];
                $salesWidgets = array_values(array_filter($payload['widgets'], fn ($widget) => $widget['tab_key'] === 'overview'));
                foreach ([['period', 'بازه زمانی', 'date', 'ordered_at', 'between'], ['city', 'شهر', 'text', 'city', 'eq'], ['category', 'دسته‌بندی', 'text', 'category', 'eq']] as [$key, $label, $type, $field, $operator]) {
                    $payload['filters'][] = [
                        'key' => $key, 'label' => $label, 'type' => $type,
                        'required' => false, 'default_value' => null, 'settings' => ['operator' => $operator],
                        'bindings' => array_map(fn ($widget) => ['widget_key' => $widget['key'], 'target' => $field, 'operator' => $operator], $salesWidgets),
                    ];
                }
            }
            if ($changed) {
                $store->save($dashboard, $payload, $user->id);
            }
            if (($connection->metadata['_sales_demo_dashboard'] ?? null) !== $dashboard->id) {
                $connection->update(['metadata' => [...($connection->metadata ?? []), '_sales_demo_dashboard' => $dashboard->id]]);
            }

            return $dashboard;
        });
        $this->command?->info('Sales / SOAR dashboard ready: '.$dashboard->id);
    }

    private function soarData(int $ownerId): array
    {
        $rows = [];
        $add = function (string $dataset, string $label, float $value, int $order = 0, array $extra = []) use (&$rows, $ownerId): void {
            $rows[] = array_replace([
                'owner_id' => $ownerId, 'dataset' => $dataset, 'label' => $label, 'value' => $value,
                'sort_order' => $order, 'secondary_value' => null, 'successful' => 0, 'failed' => 0,
            ], $extra);
        };
        foreach (['memory' => 58, 'load' => 1.45, 'disk' => 48, 'cpu' => 63, 'memory-usage' => 72] as $dataset => $value) {
            $add($dataset, 'SOAR-Server-01', $value);
        }
        $shape = [0.12, 0.18, 0.15, 0.2, 0.55, 0.85, 0.42, 0.3, 0.4, 0.32, 0.28, 0.25, 0.34, 0.22, 0.72, 0.94, 0.83, 0.9, 0.63, 0.74, 0.45, 0.62, 0.81, 0.79];
        foreach ($shape as $hour => $value) {
            $label = sprintf('%02d:00', $hour);
            $add('download', $label, $hour === 23 ? 40.46 : round(12 + $value * 36, 2), $hour);
            $add('upload', $label, $hour === 23 ? 50 : round(15 + $value * 45, 2), $hour);
            $add('ping', $label, $hour === 23 ? 526 : round(180 + $value * 420), $hour);
            $add('alerts-trend', $label, round(350 + $value * 3000), $hour);
            $add('response-load', $label, round(0.3 + $value * 2.4, 2), $hour, ['secondary_value' => round(160 + $value * 390 + ($hour % 4) * 25)]);
        }
        foreach (['Low' => 312, 'Medium' => 478, 'High' => 285, 'Critical' => 209] as $label => $value) {
            $add('severity', $label, $value, count($rows));
        }
        foreach (['پردازش یک' => 730, 'پردازش دو' => 100, 'پردازش سه' => 80, 'پردازش چهار' => 60, 'پردازش پنج' => 30] as $label => $value) {
            $add('alert-status', $label, $value, count($rows));
        }
        $add('workflow', 'فعال', 73, 0);
        $add('workflow', 'غیرفعال', 27, 1);
        $playbooks = ['User Investigation', 'Phishing Response', 'Malware Analysis', 'IOC Enrichment', 'Threat Hunting', 'Endpoint Isolation', 'Email Quarantine', 'Account Lockout', 'URL Analysis', 'File Detonation'];
        foreach ([1256, 987, 845, 642, 512, 398, 287, 231, 178, 156] as $index => $value) {
            $successful = 90 - $index * 7;
            $add('playbooks', $playbooks[$index], $value, $index, ['successful' => $successful, 'failed' => 100 - $successful]);
        }
        foreach (['هشدارهای دریافت‌شده' => 1000, 'بررسی اولیه' => 820, 'تحلیل‌شده' => 730, 'رسیدگی کامل' => 620] as $label => $value) {
            $add('funnel', $label, $value, count($rows));
        }
        return $rows;
    }

    /**
     * Compile the existing query builder against an in-memory VALUES dataset.
     * Only the resulting read-only SQL is saved; no demo table is created.
     */
    private function inlineSoarQuery(array $definition, AnalyticsConnection $connection, array $samples): array
    {
        $types = [
            'owner_id' => 'number', 'dataset' => 'text', 'label' => 'text', 'value' => 'number',
            'sort_order' => 'number', 'secondary_value' => 'number', 'successful' => 'number', 'failed' => 'number',
        ];
        foreach ($definition['filters'] as $filter) {
            if ($filter['field'] === 'dataset' && $filter['operator'] === 'eq') {
                $samples = array_values(array_filter($samples, fn ($row) => $row['dataset'] === $filter['value']));
            }
        }
        throw_if(! $samples, \RuntimeException::class, 'Unknown SOAR demo dataset.');

        $literal = static fn ($value): string => match (true) {
            $value === null => 'NULL',
            is_bool($value) => $value ? 'TRUE' : 'FALSE',
            is_int($value), is_float($value) => json_encode($value, JSON_PRESERVE_ZERO_FRACTION | JSON_THROW_ON_ERROR),
            default => "'".str_replace("'", "''", (string) $value)."'",
        };
        $tuples = array_map(fn ($row) => '('.implode(', ', array_map(fn ($key) => $literal($row[$key]), array_keys($types))).')', $samples);
        $columns = implode(', ', array_map(fn ($key) => '"'.$key.'"', array_keys($types)));
        $from = '(SELECT * FROM (VALUES '.implode(', ', $tuples).') AS demo('.$columns.'))';
        $virtual = clone $connection;
        $virtual->catalog = [[
            'key' => $definition['source'], 'label' => 'SOAR demo', 'virtual' => true,
            'fields' => array_map(fn ($key, $type) => ['key' => $key, 'label' => $key, 'type' => $type, 'nullable' => true], array_keys($types), array_values($types)),
        ], ...array_filter($connection->catalog ?? [], fn ($table) => $table['key'] !== $definition['source'])];
        $compiled = app(ReportRunner::class)->compile($definition, $virtual, fromSql: $from);
        $bindings = [];
        foreach ($compiled['bindings'] as $key => $value) {
            $bindings[':'.$key] = $literal($value);
        }

        return [
            'connection_id' => $connection->id, 'source' => 'public.analytics_records', 'mode' => 'native',
            'sql' => strtr($compiled['sql'], $bindings), 'parameters' => [],
            'metrics' => [], 'dimensions' => [], 'filters' => [], 'sort' => [], 'joins' => [],
            'limit' => $definition['limit'] ?? null, 'limit_explicit' => $definition['limit_explicit'] ?? false,
        ];
    }

    private function upgradeLegacySoarReports(AnalyticsConnection $connection, array $samples): void
    {
        $runner = app(ReportRunner::class);
        foreach (AnalyticsReport::where('owner_id', $connection->owner_id)->get() as $report) {
            $definition = $report->query_definition;
            if (($definition['source'] ?? null) !== 'public.analytics_soar_demo_records' || (int) $definition['connection_id'] !== $connection->id) {
                continue;
            }
            $query = $runner->validate($this->inlineSoarQuery($definition, $connection, $samples), $connection->owner_id);
            $result = $runner->run($query, $connection->owner_id, [], true);
            throw_if(empty($result['rows']), \RuntimeException::class, 'Empty upgraded demo report: '.$report->id);
            $report->update(['query_definition' => $query, 'version' => $report->version + 1]);
        }
    }

    private function soarDefinitions(array $base): array
    {
        $query = fn (string $dataset, array $options = []) => array_replace($base, [
            'source' => 'soar_demo',
            'filters' => [...$base['filters'], ['field' => 'dataset', 'operator' => 'eq', 'value' => $dataset]],
        ], $options);
        $rows = fn (string $dataset) => $query($dataset, [
            'mode' => 'rows', 'columns' => ['label', 'value'],
            'sort' => [['key' => 'sort_order', 'direction' => 'asc']],
        ]);
        $scalar = fn (string $dataset) => $query($dataset, [
            'metrics' => [['key' => 'value', 'function' => 'max', 'field' => 'value', 'label' => 'مقدار']],
        ]);
        $chart = ['x' => 'label', 'y' => 'value', 'legend' => false];
        $gauge = ['target' => 100, 'suffix' => '%', 'legend' => false];
        $ring = [...$gauge, 'gauge_style' => 'ring', 'caption' => 'Normal'];
        $percent = ['x' => 'label', 'y' => 'value', 'center_mode' => 'percentage', 'percent_visibility' => 'legend', 'ring_thickness' => 28];

        return [
            'soar-memory' => ['مصرف حافظه', 'gauge', $scalar('memory'), [15, 0, 4, 7], $gauge, 'soar'],
            'soar-download' => ['سرعت دانلود (Mbps)', 'area', $rows('download'), [10, 0, 5, 7], [...$chart, 'decimals' => 2, 'show_y' => false], 'soar'],
            'soar-upload' => ['سرعت آپلود (Mbps)', 'area', $rows('upload'), [5, 0, 5, 7], [...$chart, 'show_y' => false], 'soar'],
            'soar-ping' => ['پینگ سرور (ms)', 'line', $rows('ping'), [0, 0, 5, 7], [...$chart, 'show_y' => false], 'soar'],
            'soar-load' => ['Load Average', 'gauge', $scalar('load'), [19, 0, 5, 7], [...$ring, 'target' => 3, 'suffix' => '', 'decimals' => 2], 'soar'],
            'soar-disk' => ['Disk Usage', 'gauge', $scalar('disk'), [19, 7, 5, 7], $ring, 'soar'],
            'soar-cpu' => ['CPU Usage', 'gauge', $scalar('cpu'), [19, 14, 5, 7], $ring, 'soar'],
            'soar-memory-usage' => ['Memory Usage', 'gauge', $scalar('memory-usage'), [19, 21, 5, 7], [...$ring, 'caption' => 'Warning'], 'soar'],
            'soar-severity' => ['سطح هشدار', 'bar', $rows('severity'), [12, 7, 7, 11], $chart, 'soar'],
            'soar-alert-trend' => ['روند هشدار در ۲۴ ساعت گذشته', 'area', $rows('alerts-trend'), [5, 7, 7, 11], $chart, 'soar'],
            'soar-alert-status' => ['وضعیت هشدار', 'doughnut', $rows('alert-status'), [0, 7, 5, 11], $percent, 'soar'],
            'soar-workflow' => ['وضعیت فعالیت جریان‌های کاری', 'doughnut', $rows('workflow'), [14, 18, 5, 10], $percent, 'soar'],
            'soar-executions' => ['وضعیت اجرای کتاب‌های اجرایی (درصد)', 'bar', $query('playbooks', [
                'dimensions' => [['field' => 'label', 'grain' => null]],
                'metrics' => [
                    ['key' => 'successful', 'function' => 'max', 'field' => 'successful', 'label' => 'موفق'],
                    ['key' => 'failed', 'function' => 'max', 'field' => 'failed', 'label' => 'ناموفق'],
                ],
                'sort' => [['key' => 'successful', 'direction' => 'desc']],
            ]), [7, 18, 7, 10], ['x' => 'label', 'horizontal' => true, 'stacked' => true, 'legend' => true], 'soar'],
            'soar-top-playbooks' => ['۱۰ کتاب اجرایی پرکاربرد', 'bar', $rows('playbooks'), [0, 18, 7, 10], [...$chart, 'horizontal' => true, 'color_by_category' => false], 'soar'],
            'types-pie' => ['سهم وضعیت‌های پردازش ـ دایره‌ای', 'pie', $rows('alert-status'), [0, 0, 12, 8], ['x' => 'label', 'y' => 'value', 'percent_visibility' => 'legend'], 'report-types'],
            'types-scatter' => ['رابطه بار سرور و زمان پاسخ', 'scatter', $query('response-load', [
                'mode' => 'rows', 'columns' => ['value', 'secondary_value'],
                'sort' => [['key' => 'sort_order', 'direction' => 'asc']],
            ]), [12, 0, 12, 8], ['x' => 'value', 'y' => 'secondary_value', 'points' => true, 'decimals' => 2, 'legend' => false, 'x_label' => 'بار سرور', 'y_label' => 'زمان پاسخ (ms)'], 'report-types'],
            'types-pivot' => ['فروش شهر و دسته‌بندی ـ جدول محوری', 'pivot', array_replace($base, [
                'metrics' => [['key' => 'revenue', 'function' => 'sum', 'field' => 'amount', 'label' => 'فروش (تومان)']],
                'dimensions' => [['field' => 'city', 'grain' => null], ['field' => 'category', 'grain' => null]],
            ]), [0, 8, 12, 13], ['x' => 'city', 'split' => 'category', 'y' => 'revenue'], 'report-types'],
            'types-funnel' => ['مراحل رسیدگی به هشدار ـ قیف', 'funnel', $rows('funnel'), [12, 8, 12, 13], $chart, 'report-types'],
            'types-progress' => ['پیشرفت جریان‌های کاری فعال', 'progress', $query('workflow', [
                'metrics' => [['key' => 'value', 'function' => 'max', 'field' => 'value', 'label' => 'درصد فعال']],
                'filters' => [...$base['filters'], ['field' => 'dataset', 'operator' => 'eq', 'value' => 'workflow'], ['field' => 'label', 'operator' => 'eq', 'value' => 'فعال']],
            ]), [0, 21, 24, 5], [...$gauge, 'caption' => 'هدف فعالیت جریان‌های کاری'], 'report-types'],
        ];
    }
}
