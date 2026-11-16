<?php

namespace Tests\Feature;

use App\Domain\Analytics\DashboardStore;
use App\Domain\Analytics\Drivers\ConnectionManager;
use App\Domain\Analytics\ReportRunner;
use App\Models\AnalyticsConnection;
use App\Models\AnalyticsDashboard;
use App\Models\AnalyticsReport;
use App\Models\User;
use Database\Seeders\AnalyticsSalesDemoSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

class AnalyticsSalesDemoSeederTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        $owner = User::factory()->create();
        AnalyticsConnection::create([
            'owner_id' => $owner->id, 'name' => 'Demo fixture', 'driver' => 'pgsql',
            'configuration' => ['host' => '127.0.0.1', 'port' => 5432, 'database' => 'demo_fixture', 'username' => 'fixture'],
            'metadata' => ['_postgres_seed_profile' => 'pgsql'],
        ]);
        // Persistence tests stay isolated; seeder execution also verifies every query against PostgreSQL.
        $this->mock(ConnectionManager::class, fn ($mock) => $mock->shouldReceive('catalog')->andReturn([]));
        $this->mock(ReportRunner::class, function ($mock) {
            $mock->makePartial();
            $mock->shouldReceive('validate')->andReturnUsing(fn (array $query) => $query);
            $mock->shouldReceive('run')->andReturn(['columns' => [], 'rows' => [['value' => 1]], 'meta' => []]);
            $mock->shouldReceive('filterFields')->andReturn([
                'ordered_at' => ['type' => 'date'], 'city' => ['type' => 'text'], 'category' => ['type' => 'text'],
            ]);
        });
    }

    public function test_it_creates_all_report_types_and_reruns_without_duplicates_or_new_revisions(): void
    {
        $this->seed(AnalyticsSalesDemoSeeder::class);
        $dashboard = AnalyticsDashboard::sole();
        $store = app(DashboardStore::class);
        $snapshot = $store->snapshot($dashboard);
        $this->assertEqualsCanonicalizing(config('analytics.displays'), AnalyticsReport::pluck('display')->unique()->all());
        $this->assertCount(28, $snapshot['widgets']);
        $this->assertSame(['overview', 'soar', 'report-types'], array_column($snapshot['tabs'], 'key'));
        $this->assertCount(14, array_filter($snapshot['widgets'], fn ($widget) => $widget['tab_key'] === 'soar'));
        $this->assertDatabaseCount('analytics_records', 900);
        $this->assertFalse(Schema::hasTable('analytics_soar_demo_records'));
        $this->assertSame(18, AnalyticsReport::all()->where('query_definition.mode', 'native')->count());
        foreach (AnalyticsReport::all() as $report) {
            $this->assertSame('public.analytics_records', $report->query_definition['source']);
            if ($report->query_definition['mode'] === 'native') {
                $this->assertStringContainsString('VALUES', $report->query_definition['sql']);
                $this->assertStringNotContainsString('analytics_soar_demo_records', $report->query_definition['sql']);
            }
        }
        $this->assertSame(5, AnalyticsReport::where('display', 'gauge')->count());
        foreach (AnalyticsReport::all() as $report) {
            $this->assertArrayNotHasKey('color', $report->visualization_settings);
            $this->assertArrayNotHasKey('series_colors', $report->visualization_settings);
        }

        $this->seed(AnalyticsSalesDemoSeeder::class);
        $this->assertSame($snapshot, $store->snapshot($dashboard->fresh()));
        $this->assertDatabaseCount('analytics_reports', 28);
        $this->assertDatabaseCount('analytics_dashboard_revisions', 1);
        $this->assertFalse(Schema::hasTable('analytics_soar_demo_records'));
    }

    public function test_it_upgrades_an_existing_sales_dashboard_and_preserves_user_edits_and_filter_bindings(): void
    {
        $this->seed(AnalyticsSalesDemoSeeder::class);
        $dashboard = AnalyticsDashboard::sole();
        $store = app(DashboardStore::class);
        $legacy = $store->snapshot($dashboard);
        $legacy['tabs'] = [$legacy['tabs'][0]];
        $legacy['widgets'] = array_values(array_filter($legacy['widgets'], fn ($widget) => $widget['tab_key'] === 'overview'));
        $legacy['widgets'][0]['h'] = 6;
        $legacy['widgets'][0]['settings'] = ['color' => '#e84d8a', 'color_custom' => true];
        $legacy['name'] = 'داشبورد ویرایش‌شده کاربر';
        $legacy['settings']['auto_apply'] = false;
        $store->save($dashboard, $legacy, $dashboard->owner_id);
        AnalyticsReport::whereNotIn('id', array_column($legacy['widgets'], 'report_id'))->delete();
        $firstReport = AnalyticsReport::findOrFail($legacy['widgets'][0]['report_id']);
        $firstReport->update(['name' => 'گزارش ویرایش‌شده کاربر']);
        $reportBefore = $firstReport->fresh()->toArray();
        $legacy = $store->snapshot($dashboard->fresh());

        $this->seed(AnalyticsSalesDemoSeeder::class);
        $upgraded = $store->snapshot($dashboard->fresh());
        $sales = array_values(array_filter($upgraded['widgets'], fn ($widget) => $widget['tab_key'] === 'overview'));
        $this->assertSame($legacy['widgets'], $sales);
        $this->assertSame($legacy['filters'], $upgraded['filters']);
        $this->assertSame($legacy['settings'], $upgraded['settings']);
        $this->assertSame($legacy['name'], $upgraded['name']);
        $this->assertSame($reportBefore, $firstReport->fresh()->toArray());
        $this->assertSame($dashboard->id, AnalyticsDashboard::sole()->id);
        $this->assertDatabaseCount('analytics_reports', 28);
        $this->assertCount(28, $upgraded['widgets']);
        $this->assertCount(3, $upgraded['tabs']);
    }

    public function test_it_upgrades_legacy_queries_without_the_old_table_and_preserves_report_and_dashboard_edits(): void
    {
        $this->seed(AnalyticsSalesDemoSeeder::class);
        $dashboard = AnalyticsDashboard::sole();
        $store = app(DashboardStore::class);
        $snapshot = $store->snapshot($dashboard);
        $widget = collect($snapshot['widgets'])->firstWhere('key', 'soar-severity');
        $report = AnalyticsReport::findOrFail($widget['report_id']);
        $report->update([
            'name' => 'My edited severity report',
            'visualization_settings' => ['color' => '#ff5500', 'horizontal' => true],
            'query_definition' => [
                'connection_id' => AnalyticsConnection::sole()->id,
                'source' => 'public.analytics_soar_demo_records', 'mode' => 'rows',
                'columns' => ['label', 'value'], 'metrics' => [], 'dimensions' => [], 'joins' => [],
                'filters' => [
                    ['field' => 'owner_id', 'operator' => 'eq', 'value' => $dashboard->owner_id],
                    ['field' => 'dataset', 'operator' => 'eq', 'value' => 'severity'],
                    ['field' => 'value', 'operator' => 'gte', 'value' => 300],
                ],
                'sort' => [['key' => 'value', 'direction' => 'desc']], 'limit' => 50,
            ],
        ]);
        $version = $report->version;

        $this->seed(AnalyticsSalesDemoSeeder::class);
        $report->refresh();
        $this->assertFalse(Schema::hasTable('analytics_soar_demo_records'));
        $this->assertSame('My edited severity report', $report->name);
        $this->assertSame(['color' => '#ff5500', 'horizontal' => true], $report->visualization_settings);
        $this->assertSame($version + 1, $report->version);
        $this->assertSame('native', $report->query_definition['mode']);
        $this->assertSame('public.analytics_records', $report->query_definition['source']);
        $this->assertStringContainsString('VALUES', $report->query_definition['sql']);
        $this->assertStringContainsString('"t0"."value" >= 300', $report->query_definition['sql']);
        $this->assertStringContainsString('ORDER BY "t0"."value" DESC', $report->query_definition['sql']);
        $this->assertStringNotContainsString('analytics_soar_demo_records', $report->query_definition['sql']);
        $this->assertSame($snapshot, $store->snapshot($dashboard->fresh()));

        $definition = $report->query_definition;
        $this->seed(AnalyticsSalesDemoSeeder::class);
        $this->assertSame($definition, $report->fresh()->query_definition);
        $this->assertSame($version + 1, $report->fresh()->version);
        $this->assertDatabaseCount('analytics_records', 900);
        $this->assertDatabaseCount('analytics_reports', 28);
    }
}
