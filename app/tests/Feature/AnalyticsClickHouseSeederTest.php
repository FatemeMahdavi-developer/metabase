<?php

namespace Tests\Feature;

use App\Domain\Analytics\DashboardStore;
use App\Domain\Analytics\ReportRunner;
use App\Models\AnalyticsConnection;
use App\Models\AnalyticsDashboard;
use App\Models\AnalyticsReport;
use App\Models\User;
use Database\Seeders\AnalyticsClickHouseSeeder;
use Filament\Facades\Filament;
use Filament\Panel;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Client\Factory;
use Illuminate\Http\Client\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Validation\ValidationException;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

class AnalyticsClickHouseSeederTest extends TestCase
{
    use RefreshDatabase;

    private User $owner;

    private array $options;

    protected function setUp(): void
    {
        parent::setUp();

        $this->owner = User::factory()->create();
        $this->options = [
            'owner_connection' => 'sqlite',
            'owner_email' => null,
            'connection_id' => null,
            'laravel_connection' => 'clickhouse',
            'source' => 'incidents',
            'date_field' => 'event_time',
            'category_field' => null,
            'value_field' => null,
            'dashboard_name' => 'ClickHouse fixture dashboard',
        ];
        config()->set('database.connections.clickhouse', null);
        Http::preventStrayRequests();
        $this->fakeCatalog();
    }

    private function connection(array $configuration = [], ?User $owner = null, string $driver = 'clickhouse', string $name = 'Existing ClickHouse'): AnalyticsConnection
    {
        return AnalyticsConnection::create([
            'owner_id' => ($owner ?? $this->owner)->id,
            'name' => $name,
            'driver' => $driver,
            'configuration' => array_replace([
                'host' => 'clickhouse.test', 'port' => 8123, 'database' => 'warehouse',
                'username' => 'readonly-user', 'password' => 'fixture-secret', 'ssl' => false,
            ], $configuration),
        ]);
    }

    private function fakeCatalog(bool $failColumns = false, bool $withQueryResults = false): void
    {
        Http::swap(new Factory);
        Http::preventStrayRequests();
        Http::fake(function (Request $request) use ($failColumns, $withQueryResults) {
            if (str_contains($request->body(), 'FROM system.tables')) {
                return Http::response(['data' => [
                    ['database' => 'warehouse', 'name' => 'incidents', 'engine' => 'MergeTree'],
                    ['database' => 'warehouse', 'name' => 'unmodelled_events', 'engine' => 'MergeTree'],
                    ['database' => 'warehouse', 'name' => 'incident_view', 'engine' => 'View'],
                ]]);
            }
            if (str_contains($request->body(), 'FROM system.columns')) {
                if ($failColumns) {
                    return Http::response('ClickHouse unavailable: fixture-secret', 500);
                }

                return Http::response(['data' => [
                    ['name' => 'id', 'type' => 'UInt64', 'is_in_primary_key' => 1],
                    ['name' => 'event_time', 'type' => 'DateTime64(3)', 'is_in_primary_key' => 0],
                    ['name' => 'severity', 'type' => 'LowCardinality(String)', 'is_in_primary_key' => 0],
                    ['name' => 'amount', 'type' => 'Nullable(Decimal(18, 2))', 'is_in_primary_key' => 0],
                    ['name' => 'active', 'type' => 'Bool', 'is_in_primary_key' => 0],
                    ['name' => 'tags', 'type' => 'Array(String)', 'is_in_primary_key' => 0],
                ]]);
            }
            if (preg_match('/^SELECT\b/i', ltrim($request->body()))) {
                if (! $withQueryResults) {
                    return Http::response(['data' => []]);
                }

                // Representative ClickHouse JSON responses for the five saved questions.
                $row = match (true) {
                    str_contains($request->body(), 'SUM(') => ['total' => '125.50'],
                    str_contains($request->body(), 'GROUP BY') && str_contains($request->body(), '`severity`') => ['severity' => 'critical', 'records' => '12'],
                    str_contains($request->body(), 'GROUP BY') => ['event_time' => '2026-10-17', 'records' => '12'],
                    str_contains($request->body(), 'COUNT(') => ['records' => '12'],
                    default => ['id' => '42', 'event_time' => '2026-10-17 11:40:18.123', 'severity' => 'critical', 'amount' => '125.50', 'active' => true, 'tags' => ['siem', 'network']],
                };

                return Http::response(['data' => [$row]]);
            }

            return Http::response('Only read-only SELECT is expected.', 400);
        });
    }

    private function runSeeder(): void
    {
        $seeder = $this->app->make(AnalyticsClickHouseSeeder::class);
        $seeder->options = array_replace($seeder->options, $this->options);
        $seeder->run();
    }

    private function assertInvalidSeeder(): ValidationException
    {
        try {
            $this->runSeeder();
        } catch (ValidationException $exception) {
            $this->assertNotEmpty($exception->errors());
            $this->assertStringNotContainsString('fixture-secret', $exception->getMessage());

            return $exception;
        }

        $this->fail('The invalid ClickHouse seeder configuration was accepted.');
    }

    private function assertNoDashboardArtifacts(): void
    {
        foreach (['analytics_reports', 'analytics_dashboards', 'analytics_dashboard_widgets', 'analytics_dashboard_tabs', 'analytics_dashboard_filters', 'analytics_filter_bindings', 'analytics_dashboard_revisions'] as $table) {
            $this->assertDatabaseCount($table, 0);
        }
    }

    public function test_seeder_uses_live_catalog_for_all_tables_and_creates_five_queryable_widgets(): void
    {
        $this->fakeCatalog(withQueryResults: true);
        $connection = $this->connection();
        $this->options['category_field'] = 'severity';
        $this->options['value_field'] = 'amount';

        $this->runSeeder();

        $this->assertDatabaseCount('analytics_connections', 1);
        $this->assertDatabaseCount('analytics_reports', 5);
        $this->assertDatabaseCount('analytics_dashboards', 1);
        $connection->refresh();
        $this->assertSame(['warehouse.incidents', 'warehouse.unmodelled_events', 'warehouse.incident_view'], array_column($connection->catalog, 'key'));
        $this->assertSame('view', collect($connection->catalog)->firstWhere('key', 'warehouse.incident_view')['kind']);
        $this->assertNotNull($connection->synced_at);
        $this->assertNotContains('unmodelled_events', array_map(fn ($path) => basename($path, '.php'), glob(app_path('Models/*.php'))));

        $dashboard = AnalyticsDashboard::sole();
        $this->assertSame(['connection_id' => $connection->id, 'source' => 'warehouse.incidents'], $dashboard->settings['clickhouse_seed']);
        $store = app(DashboardStore::class);
        $snapshot = $store->snapshot($dashboard);
        $widgets = collect($snapshot['widgets'])->keyBy('key');
        $this->assertEqualsCanonicalizing(['clickhouse-count', 'clickhouse-sum', 'clickhouse-trend', 'clickhouse-distribution', 'clickhouse-records'], $widgets->keys()->all());
        $this->assertCount(1, $snapshot['filters']);
        $this->assertSame('period', $snapshot['filters'][0]['key']);
        $this->assertCount(5, $snapshot['filters'][0]['bindings']);
        foreach ($snapshot['filters'][0]['bindings'] as $binding) {
            $this->assertSame('event_time', $binding['target']);
            $this->assertSame('between', $binding['operator']);
        }

        $expectedDisplays = ['clickhouse-count' => 'number', 'clickhouse-sum' => 'number', 'clickhouse-trend' => 'area', 'clickhouse-distribution' => 'doughnut', 'clickhouse-records' => 'table'];
        $expectedRows = [
            'clickhouse-count' => ['records' => 12.0],
            'clickhouse-sum' => ['total' => 125.5],
            'clickhouse-trend' => ['event_time' => '2026-10-17', 'records' => 12.0],
            'clickhouse-distribution' => ['severity' => 'critical', 'records' => 12.0],
            'clickhouse-records' => ['id' => 42.0, 'event_time' => '2026-10-17 11:40:18.123', 'severity' => 'critical', 'amount' => 125.5, 'active' => true, 'tags' => ['siem', 'network']],
        ];
        foreach ($widgets as $key => $widget) {
            $report = AnalyticsReport::findOrFail($widget['report_id']);
            $this->assertSame($expectedDisplays[$key], $report->display);
            $this->assertSame('warehouse.incidents', $report->query_definition['source']);
            $this->assertSame($connection->id, $report->query_definition['connection_id']);
            $compiled = app(ReportRunner::class)->compile($report->query_definition, $connection);
            $this->assertStringContainsString('`warehouse`.`incidents`', $compiled['sql']);
            $result = $store->widgetQuery($dashboard, $key, ['period' => ['2026-10-01', '2026-10-17']], refresh: true);
            $this->assertSame([$expectedRows[$key]], $result['rows']);
            $this->assertSame(array_keys($expectedRows[$key]), array_column($result['columns'], 'key'));
            $this->assertSame(1, $result['meta']['row_count']);
            $this->assertFalse($result['meta']['truncated']);
        }
        Http::assertSent(fn (Request $request) => str_contains($request->body(), 'toDate(`t0`.`event_time`)'));
        Http::assertSent(fn (Request $request) => str_contains($request->body(), 'SUM('));
        Http::assertSent(fn (Request $request) => str_contains($request->url(), 'param_p0=2026-10-01'));
        $widgetRequests = Http::recorded(fn (Request $request) => ! str_contains($request->body(), 'FROM system.'));
        $this->assertCount(5, $widgetRequests);
        foreach ($widgetRequests as [$request]) {
            parse_str(parse_url($request->url(), PHP_URL_QUERY), $parameters);
            $this->assertSame('2026-10-01', $parameters['param_p0']);
            $this->assertSame('2026-10-17', $parameters['param_p1']);
            $this->assertStringContainsString('{p0:String}', $request->body());
            $this->assertStringContainsString('{p1:String}', $request->body());
        }
        foreach (Http::recorded() as [$request]) {
            parse_str(parse_url($request->url(), PHP_URL_QUERY), $parameters);
            $this->assertSame('2', $parameters['readonly']);
            $this->assertSame('warehouse', $parameters['database']);
            $this->assertMatchesRegularExpression('/^SELECT\b/i', ltrim($request->body()));
        }

        $library = $this->actingAs($this->owner)->getJson('/analytics/api/library')->assertOk();
        $this->assertCount(3, $library->json('connections.0.catalog'));
        $library->assertJsonMissing(['password' => 'fixture-secret']);
    }

    public function test_rerun_preserves_user_names_layout_reports_and_revisions_but_refreshes_catalog(): void
    {
        $connection = $this->connection();
        $this->options['category_field'] = 'severity';
        $this->options['value_field'] = 'amount';
        $this->runSeeder();
        $dashboard = AnalyticsDashboard::sole();
        $store = app(DashboardStore::class);
        $draft = $store->snapshot($dashboard);
        $draft['name'] = 'My edited ClickHouse dashboard';
        $draft['widgets'][0]['h'] = 5;
        $before = $store->save($dashboard, $draft, $this->owner->id);
        AnalyticsReport::findOrFail($draft['widgets'][0]['report_id'])->update(['name' => 'My edited report']);
        $reportIds = AnalyticsReport::query()->orderBy('id')->pluck('id')->all();
        $revisionCount = DB::table('analytics_dashboard_revisions')->count();
        $oldSyncedAt = $connection->refresh()->synced_at;
        $this->travel(1)->minute();

        $this->runSeeder();

        $this->assertDatabaseCount('analytics_connections', 1);
        $this->assertDatabaseCount('analytics_dashboards', 1);
        $this->assertSame($reportIds, AnalyticsReport::query()->orderBy('id')->pluck('id')->all());
        $this->assertSame('My edited report', AnalyticsReport::findOrFail($draft['widgets'][0]['report_id'])->name);
        $this->assertSame($before, $store->snapshot($dashboard->refresh()));
        $this->assertSame($revisionCount, DB::table('analytics_dashboard_revisions')->count());
        $this->assertTrue($connection->refresh()->synced_at->greaterThan($oldSyncedAt));
    }

    public function test_table_without_optional_fields_gets_only_count_and_records_without_date_filter(): void
    {
        $this->connection();
        $this->options['date_field'] = null;
        $this->runSeeder();

        $this->assertDatabaseCount('analytics_reports', 2);
        $snapshot = app(DashboardStore::class)->snapshot(AnalyticsDashboard::sole());
        $this->assertEqualsCanonicalizing(['clickhouse-count', 'clickhouse-records'], array_column($snapshot['widgets'], 'key'));
        $this->assertSame([], $snapshot['filters']);
    }

    public function test_rerun_preserves_dashboard_after_normal_ui_save_removes_unknown_settings(): void
    {
        $connection = $this->connection();
        $this->runSeeder();
        $dashboard = AnalyticsDashboard::sole();
        $store = app(DashboardStore::class);
        $draft = $store->snapshot($dashboard);
        $draft['name'] = 'Renamed through the dashboard editor';
        $draft['widgets'][0]['h'] = 6;
        // The browser settings form serializes these three known fields only.
        $draft['settings'] = ['width' => 'fixed', 'auto_apply' => false, 'refresh_interval' => 60];
        $saved = $store->save($dashboard, $draft, $this->owner->id);
        $this->assertArrayNotHasKey('clickhouse_seed', $dashboard->refresh()->settings);
        AnalyticsReport::findOrFail($draft['widgets'][0]['report_id'])->update(['name' => 'Report renamed in the editor']);
        $reportIds = AnalyticsReport::query()->orderBy('id')->pluck('id')->all();

        $this->runSeeder();

        $this->assertDatabaseCount('analytics_dashboards', 1);
        $this->assertSame($reportIds, AnalyticsReport::query()->orderBy('id')->pluck('id')->all());
        $this->assertSame('Report renamed in the editor', AnalyticsReport::findOrFail($draft['widgets'][0]['report_id'])->name);
        $this->assertSame($saved, $store->snapshot($dashboard->refresh()));
        $this->assertSame($dashboard->id, $connection->refresh()->metadata['_clickhouse_seed_dashboards']['warehouse.incidents']);
    }

    public function test_qualified_source_can_select_a_table_without_any_laravel_model(): void
    {
        $this->connection();
        $this->options['source'] = 'warehouse.unmodelled_events';
        $this->runSeeder();

        foreach (AnalyticsReport::all() as $report) {
            $this->assertSame('warehouse.unmodelled_events', $report->query_definition['source']);
        }
        $this->assertSame('warehouse.unmodelled_events', AnalyticsDashboard::sole()->settings['clickhouse_seed']['source']);
    }

    public function test_unknown_source_does_not_leave_synced_metadata_or_dashboard_artifacts(): void
    {
        $connection = $this->connection();
        $connection->update(['catalog' => [['key' => 'previous.catalog']], 'metadata' => ['previous.catalog' => ['label' => 'Keep me']]]);
        $this->options['source'] = 'missing_source';

        $this->assertInvalidSeeder();

        $this->assertSame([['key' => 'previous.catalog']], $connection->refresh()->catalog);
        $this->assertSame(['previous.catalog' => ['label' => 'Keep me']], $connection->metadata);
        $this->assertNull($connection->synced_at);
        $this->assertNoDashboardArtifacts();
    }

    public static function invalidFields(): array
    {
        return [
            'date column is text' => ['date_field', 'severity'],
            'date column is missing' => ['date_field', 'missing'],
            'value column is text' => ['value_field', 'severity'],
            'value column is missing' => ['value_field', 'missing'],
            'value column is an array' => ['value_field', 'tags'],
            'category column is missing' => ['category_field', 'missing'],
            'category column is an array' => ['category_field', 'tags'],
        ];
    }

    #[DataProvider('invalidFields')]
    public function test_missing_or_incompatible_fields_are_rejected_atomically(string $option, string $field): void
    {
        $connection = $this->connection();
        $this->options[$option] = $field;

        $this->assertInvalidSeeder();

        $this->assertNull($connection->refresh()->catalog);
        $this->assertNull($connection->synced_at);
        $this->assertNoDashboardArtifacts();
    }

    public function test_multiple_users_require_explicit_owner_and_owner_cannot_use_another_users_connection(): void
    {
        $other = User::factory()->create();
        $connection = $this->connection([], $other);

        $this->assertInvalidSeeder();
        Http::assertNothingSent();
        $this->options['owner_email'] = $this->owner->email;
        $this->options['connection_id'] = $connection->id;
        $this->assertInvalidSeeder();
        Http::assertNothingSent();
        $this->assertNull($connection->refresh()->catalog);
        $this->assertNoDashboardArtifacts();
    }

    public function test_laravel_authenticated_user_is_the_owner_without_console_owner_configuration(): void
    {
        $other = User::factory()->create();
        $selected = $this->connection();
        $this->connection(['host' => 'other-owner.test'], $other);
        Filament::setCurrentPanel(null);
        $this->actingAs($this->owner, 'web');
        $this->options['owner_connection'] = 'not-a-configured-postgresql-profile';
        $this->options['owner_email'] = ' '.$this->owner->email.' ';

        $this->runSeeder();

        $dashboard = AnalyticsDashboard::sole();
        $this->assertSame($this->owner->id, $dashboard->owner_id);
        $this->assertSame($selected->id, $dashboard->settings['clickhouse_seed']['connection_id']);
        foreach (AnalyticsReport::all() as $report) {
            $this->assertSame($this->owner->id, $report->owner_id);
        }
        $this->assertSame('sqlite', DB::getDefaultConnection());
        Http::assertNotSent(fn (Request $request) => str_contains($request->url(), 'other-owner.test'));
    }

    public function test_current_filament_panel_guard_selects_its_user_instead_of_the_default_guard_user(): void
    {
        $other = User::factory()->create();
        $selected = $this->connection();
        $this->connection(['host' => 'default-guard-owner.test'], $other);
        config()->set('auth.guards.analytics_filament', ['driver' => 'session', 'provider' => 'users']);
        Filament::setCurrentPanel(Panel::make()->id('analytics-test')->authGuard('analytics_filament'));
        $this->actingAs($other, 'web');
        Auth::guard('analytics_filament')->setUser($this->owner);
        $this->options['owner_connection'] = 'not-a-configured-postgresql-profile';

        $this->runSeeder();

        $dashboard = AnalyticsDashboard::sole();
        $this->assertSame($this->owner->id, $dashboard->owner_id);
        $this->assertSame($selected->id, $dashboard->settings['clickhouse_seed']['connection_id']);
        $this->assertSame($other->id, Auth::user()->id);
        $this->assertSame($this->owner->id, Filament::auth()->user()->id);
        Http::assertNotSent(fn (Request $request) => str_contains($request->url(), 'default-guard-owner.test'));
    }

    public function test_authenticated_user_cannot_assign_the_dashboard_to_another_owner_email(): void
    {
        $other = User::factory()->create();
        $this->connection();
        Filament::setCurrentPanel(null);
        $this->actingAs($this->owner);
        $this->options['owner_email'] = $other->email;

        $exception = $this->assertInvalidSeeder();

        $this->assertArrayHasKey('owner_email', $exception->errors());
        Http::assertNothingSent();
        $this->assertNoDashboardArtifacts();
    }

    public function test_an_unsaved_authenticated_user_cannot_claim_an_existing_users_id(): void
    {
        $unsaved = User::factory()->make(['email' => $this->owner->email]);
        $unsaved->id = $this->owner->id;
        Filament::setCurrentPanel(null);
        $this->actingAs($unsaved);

        $exception = $this->assertInvalidSeeder();

        $this->assertArrayHasKey('owner_email', $exception->errors());
        Http::assertNothingSent();
        $this->assertNoDashboardArtifacts();
    }

    public function test_a_deleted_authenticated_user_cannot_create_dashboard_artifacts(): void
    {
        Filament::setCurrentPanel(null);
        $this->actingAs($this->owner);
        // A stale authenticated object must not be accepted just because it has a key.
        DB::table('users')->where('id', $this->owner->id)->delete();

        $exception = $this->assertInvalidSeeder();

        $this->assertArrayHasKey('owner_email', $exception->errors());
        Http::assertNothingSent();
        $this->assertDatabaseCount('users', 0);
        $this->assertNoDashboardArtifacts();
    }

    public function test_authenticated_user_from_an_unrelated_database_is_rejected_despite_matching_identity(): void
    {
        config()->set('database.connections.unrelated_users', [
            'driver' => 'sqlite', 'database' => ':memory:', 'prefix' => '',
        ]);
        $unrelated = DB::connection('unrelated_users');
        $unrelated->statement('CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT NOT NULL)');
        $unrelated->table('users')->insert(['id' => $this->owner->id, 'email' => $this->owner->email]);
        $foreignUser = User::on('unrelated_users')->findOrFail($this->owner->id);
        $unrelated->enableQueryLog();
        $unrelated->flushQueryLog();
        Filament::setCurrentPanel(null);
        $this->actingAs($foreignUser);

        $exception = $this->assertInvalidSeeder();

        $this->assertArrayHasKey('owner_connection', $exception->errors());
        $this->assertSame([], $unrelated->getQueryLog(), 'An authenticated user must belong to the analytics identity database.');
        Http::assertNothingSent();
        $this->assertNoDashboardArtifacts();
    }

    public function test_unauthenticated_http_context_cannot_fall_back_to_the_only_database_user(): void
    {
        Filament::setCurrentPanel(null);
        (new \ReflectionProperty($this->app, 'isRunningInConsole'))->setValue($this->app, false);
        $this->connection();
        $this->options['owner_email'] = $this->owner->email;

        $exception = $this->assertInvalidSeeder();

        $this->assertArrayHasKey('owner_email', $exception->errors());
        Http::assertNothingSent();
        $this->assertNoDashboardArtifacts();
    }

    public function test_guest_filament_guard_does_not_fall_back_to_another_authenticated_guard(): void
    {
        config()->set('auth.guards.analytics_filament', ['driver' => 'session', 'provider' => 'users']);
        Filament::setCurrentPanel(Panel::make()->id('analytics-test')->authGuard('analytics_filament'));
        $this->actingAs($this->owner, 'web');
        (new \ReflectionProperty($this->app, 'isRunningInConsole'))->setValue($this->app, false);
        $this->connection();

        $exception = $this->assertInvalidSeeder();

        $this->assertArrayHasKey('owner_email', $exception->errors());
        $this->assertSame($this->owner->id, Auth::user()->id);
        $this->assertNull(Filament::auth()->user());
        Http::assertNothingSent();
        $this->assertNoDashboardArtifacts();
    }

    public function test_named_postgresql_owner_connection_keeps_the_default_database_and_dashboard_owner(): void
    {
        $database = DB::connection();
        $defaultConnection = DB::getDefaultConnection();
        // Resolve the pgsql name to the existing isolated SQLite database: no server is contacted.
        config()->set('database.connections.pgsql', $database->getConfig());
        DB::extend('pgsql', fn () => $database);
        $this->connection();
        $this->assertSame('pgsql', (new AnalyticsClickHouseSeeder)->options['owner_connection']);
        $this->options['owner_connection'] = 'pgsql';
        $this->options['owner_email'] = ' '.$this->owner->email.' ';

        $this->runSeeder();

        $this->assertSame($defaultConnection, DB::getDefaultConnection());
        $this->assertSame($database, DB::connection('pgsql'));
        $this->assertSame($this->owner->id, AnalyticsDashboard::sole()->owner_id);
        foreach (AnalyticsReport::all() as $report) {
            $this->assertSame($this->owner->id, $report->owner_id);
        }
        $this->assertDatabaseCount('users', 1);
    }

    public function test_unknown_owner_connection_is_rejected_before_clickhouse_is_contacted(): void
    {
        $defaultConnection = DB::getDefaultConnection();
        $this->options['owner_connection'] = 'missing-filament-connection';

        $exception = $this->assertInvalidSeeder();

        $this->assertArrayHasKey('owner_connection', $exception->errors());
        $this->assertSame($defaultConnection, DB::getDefaultConnection());
        Http::assertNothingSent();
        $this->assertDatabaseCount('users', 1);
        $this->assertDatabaseCount('analytics_connections', 0);
        $this->assertNoDashboardArtifacts();
    }

    public function test_owner_connection_to_a_different_database_is_rejected_even_when_id_and_email_collide(): void
    {
        config()->set('database.connections.unrelated_users', [
            'driver' => 'sqlite', 'database' => ':memory:', 'prefix' => '',
        ]);
        $unrelated = DB::connection('unrelated_users');
        $unrelated->statement('CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT NOT NULL)');
        $unrelated->table('users')->insert(['id' => $this->owner->id, 'email' => $this->owner->email]);
        $unrelated->enableQueryLog();
        $unrelated->flushQueryLog();
        $this->options['owner_connection'] = 'unrelated_users';
        $this->options['owner_email'] = $this->owner->email;

        $exception = $this->assertInvalidSeeder();

        $this->assertArrayHasKey('owner_connection', $exception->errors());
        $this->assertSame([], $unrelated->getQueryLog(), 'The database identity must be checked before querying an unrelated users table.');
        $this->assertSame('sqlite', DB::getDefaultConnection());
        Http::assertNothingSent();
        $this->assertDatabaseCount('users', 1);
        $this->assertDatabaseCount('analytics_connections', 0);
        $this->assertNoDashboardArtifacts();
    }

    public function test_external_metabase_account_cannot_be_used_as_the_filament_owner(): void
    {
        config()->set('database.connections.metabase', [
            'driver' => 'sqlite', 'database' => ':memory:', 'prefix' => '',
        ]);
        $metabase = DB::connection('metabase');
        $metabase->statement('CREATE TABLE core_user (id INTEGER PRIMARY KEY, email TEXT NOT NULL)');
        // A matching numeric ID in Metabase must not grant ownership in Filament.
        $metabase->table('core_user')->insert(['id' => $this->owner->id, 'email' => 'external-metabase@example.test']);
        $this->options['owner_email'] = 'external-metabase@example.test';

        $exception = $this->assertInvalidSeeder();

        $this->assertArrayHasKey('owner_email', $exception->errors());
        Http::assertNothingSent();
        $this->assertSame(1, $metabase->table('core_user')->count());
        $this->assertDatabaseCount('users', 1);
        $this->assertDatabaseCount('analytics_connections', 0);
        $this->assertNoDashboardArtifacts();
    }

    public function test_explicit_owner_and_connection_select_the_correct_clickhouse_database(): void
    {
        User::factory()->create();
        $this->connection();
        $selected = $this->connection(['host' => 'selected.test'], name: 'Selected ClickHouse');
        $this->options['owner_email'] = $this->owner->email;
        $this->options['connection_id'] = $selected->id;

        $this->runSeeder();

        $this->assertSame($this->owner->id, AnalyticsDashboard::sole()->owner_id);
        $this->assertSame($selected->id, AnalyticsDashboard::sole()->settings['clickhouse_seed']['connection_id']);
        Http::assertSent(fn (Request $request) => str_starts_with($request->url(), 'http://selected.test:8123/'));
    }

    public function test_multiple_clickhouse_connections_require_explicit_selection(): void
    {
        $this->connection();
        $this->connection(['host' => 'second.test'], name: 'Second ClickHouse');

        $this->assertInvalidSeeder();

        Http::assertNothingSent();
        $this->assertNoDashboardArtifacts();
    }

    public function test_existing_non_clickhouse_connection_cannot_be_selected(): void
    {
        $connection = $this->connection(['path' => ':memory:'], driver: 'sqlite');
        $this->options['connection_id'] = $connection->id;

        $this->assertInvalidSeeder();

        Http::assertNothingSent();
        $this->assertNoDashboardArtifacts();
    }

    public function test_laravel_connection_configuration_is_imported_with_http_override_and_user_alias(): void
    {
        config()->set('database.connections.clickhouse', [
            'driver' => 'clickhouse', 'host' => 'laravel-clickhouse.test', 'port' => 9000,
            'http_port' => 8443, 'database' => 'warehouse', 'user' => 'laravel-reader', 'password' => 'fixture-secret', 'ssl' => true,
        ]);
        $this->runSeeder();

        $connection = AnalyticsConnection::sole();
        $this->assertSame('clickhouse', $connection->driver);
        $this->assertSame('laravel-clickhouse.test', $connection->configuration['host']);
        $this->assertSame('laravel-reader', $connection->configuration['username']);
        $this->assertSame(8443, (int) $connection->configuration['port']);
        $this->assertTrue($connection->configuration['ssl']);
        $this->assertStringNotContainsString('fixture-secret', DB::table('analytics_connections')->sole()->configuration);
        Http::assertSent(fn (Request $request) => str_starts_with($request->url(), 'https://laravel-clickhouse.test:8443/') && $request->hasHeader('Authorization', 'Basic '.base64_encode('laravel-reader:fixture-secret')));

        $this->runSeeder();
        $this->assertDatabaseCount('analytics_connections', 1);
        $this->assertDatabaseCount('analytics_dashboards', 1);
    }

    public static function packageHttpsSettings(): array
    {
        return ['http' => [false], 'https' => [true]];
    }

    #[DataProvider('packageHttpsSettings')]
    public function test_package_database_profile_works_without_separate_analytics_configuration(bool $https): void
    {
        $this->assertFileDoesNotExist(config_path('analytics_clickhouse.php'));
        // Resolved database configuration is also available when Laravel config is cached.
        // Stale legacy analytics settings must not override the package connection or seed defaults.
        config()->set('analytics_clickhouse', [
            'owner_email' => 'missing@example.test', 'laravel_connection' => 'missing',
            'source' => 'missing', 'date_field' => 'missing',
        ]);
        config()->set('database.connections.clickhouse', [
            'driver' => 'clickhouse', 'host' => 'package-clickhouse.test', 'port' => 8123,
            'database' => 'warehouse', 'username' => 'package-reader',
            'password' => 'fixture-secret', 'https' => $https,
        ]);

        // Use the production ClickHouse defaults, with the isolated test owner database.
        $seeder = $this->app->make(AnalyticsClickHouseSeeder::class);
        $seeder->options['owner_connection'] = 'sqlite';
        $seeder->run();

        $connection = AnalyticsConnection::sole();
        $this->assertSame(8123, (int) $connection->configuration['port']);
        $this->assertSame('package-reader', $connection->configuration['username']);
        $this->assertSame($https, $connection->configuration['ssl']);
        $this->assertCount(3, $connection->catalog);
        $this->assertSame('warehouse.incidents', AnalyticsDashboard::sole()->settings['clickhouse_seed']['source']);
        $this->assertDatabaseCount('analytics_reports', 3);
        $scheme = $https ? 'https' : 'http';
        Http::assertSent(fn (Request $request) => str_starts_with($request->url(), $scheme.'://package-clickhouse.test:8123/'));
        foreach (Http::recorded() as [$request]) {
            parse_str(parse_url($request->url(), PHP_URL_QUERY), $parameters);
            $this->assertSame('2', $parameters['readonly']);
            $this->assertMatchesRegularExpression('/^SELECT\b/i', ltrim($request->body()));
        }
    }

    public static function nativePorts(): array
    {
        return [[9000], [9440]];
    }

    #[DataProvider('nativePorts')]
    public function test_native_laravel_ports_require_an_explicit_http_port(int $port): void
    {
        config()->set('database.connections.clickhouse', [
            'driver' => 'clickhouse', 'host' => 'laravel-clickhouse.test', 'port' => $port,
            'database' => 'warehouse', 'username' => 'reader',
        ]);

        $this->assertInvalidSeeder();

        Http::assertNothingSent();
        $this->assertDatabaseCount('analytics_connections', 0);
        $this->assertNoDashboardArtifacts();
    }

    public function test_laravel_http_port_is_preferred_over_native_port_without_global_override(): void
    {
        config()->set('database.connections.clickhouse', [
            'driver' => 'clickhouse', 'host' => 'laravel-clickhouse.test', 'port' => 9000, 'http_port' => 8124,
            'database' => 'warehouse', 'username' => 'reader',
        ]);

        $this->runSeeder();

        $this->assertSame(8124, (int) AnalyticsConnection::sole()->configuration['port']);
        Http::assertSent(fn (Request $request) => str_starts_with($request->url(), 'http://laravel-clickhouse.test:8124/'));
    }

    public function test_missing_import_configuration_does_not_create_any_connection_or_dashboard(): void
    {
        $this->assertInvalidSeeder();

        Http::assertNothingSent();
        $this->assertDatabaseCount('analytics_connections', 0);
        $this->assertNoDashboardArtifacts();
    }

    public function test_failed_schema_sync_rolls_back_an_imported_connection_and_all_dashboard_artifacts(): void
    {
        config()->set('database.connections.clickhouse', [
            'driver' => 'clickhouse', 'host' => 'laravel-clickhouse.test', 'port' => 8123,
            'database' => 'warehouse', 'username' => 'reader',
        ]);
        $this->fakeCatalog(failColumns: true);

        $this->assertInvalidSeeder();

        $this->assertDatabaseCount('analytics_connections', 0);
        $this->assertNoDashboardArtifacts();
    }
}
