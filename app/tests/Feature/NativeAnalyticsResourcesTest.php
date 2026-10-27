<?php

namespace Tests\Feature;

use App\Domain\Analytics\Drivers\ConnectionManager;
use App\Domain\Analytics\Filament\PanelActions;
use App\Domain\Analytics\ReportRunner;
use App\Filament\Pages\AnalyticsDashboardEditor;
use App\Filament\Pages\AnalyticsDashboardView;
use App\Filament\Pages\AnalyticsReportEditor;
use App\Filament\Pages\Dashboard;
use App\Filament\Resources\AnalyticsConnectionResource;
use App\Filament\Resources\AnalyticsConnectionResource\Pages\ListAnalyticsConnections;
use App\Filament\Resources\AnalyticsDashboardResource;
use App\Filament\Resources\AnalyticsDashboardResource\Pages\ListAnalyticsDashboards;
use App\Filament\Resources\AnalyticsReportResource;
use App\Filament\Resources\AnalyticsReportResource\Pages\ListAnalyticsReports;
use App\Models\AnalyticsConnection;
use App\Models\AnalyticsDashboard;
use App\Models\AnalyticsReport;
use App\Models\User;
use Filament\Facades\Filament;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;
use Livewire\Livewire;
use PDO;
use Symfony\Component\HttpKernel\Exception\HttpException;
use Tests\TestCase;

class NativeAnalyticsResourcesTest extends TestCase
{
    use RefreshDatabase;

    private User $owner;

    private string $sourcePath;

    protected function setUp(): void
    {
        parent::setUp();
        // The application's base User uses Filament's local-environment access rule.
        config(['app.env' => 'local']);
        $this->owner = User::factory()->create();
        $this->actingAs($this->owner);
        Filament::setCurrentPanel(Filament::getPanel('admin'));
        Filament::bootCurrentPanel();
        $this->sourcePath = storage_path('framework/native-panel-'.bin2hex(random_bytes(6)).'.sqlite');
        $source = new PDO('sqlite:'.$this->sourcePath);
        $source->exec('CREATE TABLE events (id INTEGER PRIMARY KEY, amount INTEGER); INSERT INTO events VALUES (1,10),(2,20)');
    }

    protected function tearDown(): void
    {
        parent::tearDown();
        if (isset($this->sourcePath) && is_file($this->sourcePath)) {
            unlink($this->sourcePath);
        }
    }

    private function connection(?User $owner = null, string $driver = 'pgsql'): AnalyticsConnection
    {
        return AnalyticsConnection::create([
            'owner_id' => ($owner ?? $this->owner)->id, 'name' => 'Native source '.$driver, 'driver' => $driver,
            'configuration' => $driver === 'sqlite' ? ['path' => $this->sourcePath] : ['host' => 'localhost', 'port' => $driver === 'pgsql' ? 5432 : 8123, 'database' => 'events', 'username' => $driver === 'pgsql' ? 'postgres' : 'default', 'password' => 'private-panel-test-secret', ...($driver === 'pgsql' ? ['sslmode' => 'prefer'] : ['ssl' => false])],
        ]);
    }

    private function normalizedJsonMaps(array $value): array
    {
        $value = array_map(fn ($item) => is_array($item) ? $this->normalizedJsonMaps($item) : $item, $value);
        if (! array_is_list($value)) {
            ksort($value);
        }

        return $value;
    }

    public function test_native_resource_lists_use_own_routes_and_exclude_other_users_records(): void
    {
        $other = User::factory()->create();
        $own = $this->connection();
        $foreign = $this->connection($other);
        Livewire::test(ListAnalyticsConnections::class)->assertSuccessful()->assertCanSeeTableRecords([$own])->assertCanNotSeeTableRecords([$foreign]);
        $this->assertSame('/admin/analytics/databases', parse_url(AnalyticsConnectionResource::getUrl(), PHP_URL_PATH));
        $this->assertSame('/admin/analytics/dashboards', parse_url(AnalyticsDashboardResource::getUrl(), PHP_URL_PATH));
        $this->assertSame('/admin/analytics/reports', parse_url(AnalyticsReportResource::getUrl(), PHP_URL_PATH));
        foreach ([AnalyticsConnectionResource::getUrl(), AnalyticsDashboardResource::getUrl(), AnalyticsReportResource::getUrl()] as $url) {
            $this->get($url)->assertOk()->assertSee('fi-sidebar', false)->assertDontSee('id="analytics-studio"', false);
        }
    }

    public function test_native_dashboard_create_initializes_tabs_and_redirects_to_its_editor(): void
    {
        $component = Livewire::test(ListAnalyticsDashboards::class)
            ->callAction('create', data: ['name' => 'Native dashboard', 'description' => 'Created through Filament'])
            ->assertHasNoActionErrors();
        $dashboard = AnalyticsDashboard::where('name', 'Native dashboard')->firstOrFail();
        $this->assertSame($this->owner->id, $dashboard->owner_id);
        $this->assertSame(['auto_apply' => true, 'width' => 'wide', 'refresh_interval' => 0], $dashboard->settings);
        $this->assertDatabaseHas('analytics_dashboard_tabs', ['dashboard_id' => $dashboard->id, 'key' => 'main']);
        $component->assertRedirect(AnalyticsDashboardEditor::getUrl(['record' => $dashboard->id]));
    }

    public function test_dashboard_list_persists_status_and_drag_order(): void
    {
        $first = app(PanelActions::class)->createDashboard(['name' => 'First']);
        $second = app(PanelActions::class)->createDashboard(['name' => 'Second']);
        $this->assertTrue($first->fresh()->is_active);

        Livewire::test(ListAnalyticsDashboards::class)
            ->call('updateTableColumnState', 'is_active', (string) $first->id, false)
            ->call('reorderTable', [$second->id, $first->id]);

        $this->assertFalse($first->refresh()->is_active);
        $this->assertSame(1, $second->refresh()->sort_order);
        $this->assertSame(2, $first->sort_order);
        Livewire::test(ListAnalyticsDashboards::class)
            ->assertCanSeeTableRecords([$second, $first], inOrder: true)
            ->call('updateTableColumnState', 'is_active', (string) $first->id, true);
        $this->assertTrue($first->refresh()->is_active);
    }

    public function test_dashboard_viewer_cannot_change_status_or_reorder(): void
    {
        $dashboard = app(PanelActions::class)->createDashboard(['name' => 'Shared status']);
        $viewer = User::factory()->create();
        DB::table('analytics_dashboard_members')->insert(['dashboard_id' => $dashboard->id, 'user_id' => $viewer->id, 'role' => 'viewer']);
        $this->actingAs($viewer);

        Livewire::test(ListAnalyticsDashboards::class)
            ->call('updateTableColumnState', 'is_active', (string) $dashboard->id, false);
        $this->assertTrue($dashboard->refresh()->is_active);
        Livewire::test(ListAnalyticsDashboards::class)
            ->call('reorderTable', [$dashboard->id])->assertForbidden();
    }

    public function test_dashboard_reordering_accepts_repeated_browser_keys_without_changing_other_owners_records(): void
    {
        $first = app(PanelActions::class)->createDashboard(['name' => 'First repeated key']);
        $second = app(PanelActions::class)->createDashboard(['name' => 'Second repeated key']);
        $foreign = AnalyticsDashboard::create(['owner_id' => User::factory()->create()->id, 'name' => 'Foreign dashboard', 'settings' => []]);

        Livewire::test(ListAnalyticsDashboards::class)
            ->call('reorderTable', [(string) $second->id, (string) $first->id, (string) $second->id])
            ->assertSuccessful();
        $this->assertSame(1, $second->refresh()->sort_order);
        $this->assertSame(2, $first->refresh()->sort_order);

        Livewire::test(ListAnalyticsDashboards::class)
            ->call('reorderTable', [$first->id, $foreign->id])->assertSuccessful();
        $this->assertSame(2, $first->refresh()->sort_order);
        $this->assertSame(1, $foreign->refresh()->sort_order);
    }

    public function test_interrupted_dashboard_drops_leave_the_saved_order_unchanged(): void
    {
        $first = app(PanelActions::class)->createDashboard(['name' => 'First interrupted drop']);
        $second = app(PanelActions::class)->createDashboard(['name' => 'Second interrupted drop']);

        foreach ([[], [''], ['temporary-row', $second->id, $first->id], [$second->id, $first->id, 999999], [$second->id]] as $order) {
            Livewire::test(ListAnalyticsDashboards::class)->call('reorderTable', $order)->assertSuccessful();
            $this->assertSame(1, $first->refresh()->sort_order);
            $this->assertSame(2, $second->refresh()->sort_order);
        }

        Livewire::test(ListAnalyticsDashboards::class)
            ->call('reorderTable', [$second->id, $first->id])->assertSuccessful();
        $this->assertSame(1, $second->refresh()->sort_order);
        $this->assertSame(2, $first->refresh()->sort_order);
    }

    public function test_active_dashboard_submenus_follow_saved_order_and_read_permissions(): void
    {
        $first = app(PanelActions::class)->createDashboard(['name' => 'First submenu']);
        $second = app(PanelActions::class)->createDashboard(['name' => 'Second submenu']);
        $hidden = app(PanelActions::class)->createDashboard(['name' => 'Inactive submenu']);
        $hidden->update(['is_active' => false]);
        $second->update(['sort_order' => 0]);
        $foreign = AnalyticsDashboard::create(['owner_id' => User::factory()->create()->id, 'name' => 'Private submenu', 'settings' => []]);

        $home = Dashboard::getNavigationItems()[0];
        $this->assertSame('/admin', parse_url($home->getUrl(), PHP_URL_PATH));
        $this->assertSame([], AnalyticsDashboardResource::getNavigationItems()[0]->getChildItems());
        $children = $home->getChildItems();
        $this->assertSame(['Second submenu', 'First submenu'], array_map(fn ($item) => $item->getLabel(), $children));
        $this->assertSame(AnalyticsDashboardView::getUrl(['record' => $second->id]), $children[0]->getUrl());
        $this->get($children[0]->getUrl())->assertOk();

        DB::table('analytics_dashboard_members')->insert(['dashboard_id' => $foreign->id, 'user_id' => $this->owner->id, 'role' => 'viewer']);
        $children = Dashboard::getNavigationItems()[0]->getChildItems();
        $this->assertContains('Private submenu', array_map(fn ($item) => $item->getLabel(), $children));

        Livewire::test(ListAnalyticsDashboards::class)
            ->call('updateTableColumnState', 'is_active', (string) $first->id, false)
            ->assertRedirect(AnalyticsDashboardResource::getUrl());
        $children = Dashboard::getNavigationItems()[0]->getChildItems();
        $this->assertNotContains('First submenu', array_map(fn ($item) => $item->getLabel(), $children));
    }

    public function test_native_collection_create_and_filter_are_owner_scoped(): void
    {
        Livewire::test(ListAnalyticsDashboards::class)->callAction('createFolder', data: ['name' => 'Native folder'])->assertHasNoActionErrors();
        $folder = DB::table('analytics_folders')->where('name', 'Native folder')->first();
        $this->assertSame($this->owner->id, $folder->owner_id);
        $own = app(PanelActions::class)->createDashboard(['name' => 'In folder', 'folder_id' => $folder->id]);
        $otherFolder = app(PanelActions::class)->createDashboard(['name' => 'Without folder']);
        Livewire::test(ListAnalyticsDashboards::class)->filterTable('folder_id', $folder->id)->assertCanSeeTableRecords([$own])->assertCanNotSeeTableRecords([$otherFolder]);
    }

    public function test_shared_dashboard_is_listed_but_viewer_cannot_delete_it(): void
    {
        $dashboard = app(PanelActions::class)->createDashboard(['name' => 'Shared dashboard']);
        $viewer = User::factory()->create();
        DB::table('analytics_dashboard_members')->insert(['dashboard_id' => $dashboard->id, 'user_id' => $viewer->id, 'role' => 'viewer']);
        $this->actingAs($viewer);
        Livewire::test(ListAnalyticsDashboards::class)->assertCanSeeTableRecords([$dashboard])->assertTableActionHidden('delete', $dashboard)->assertTableActionHidden('copy', $dashboard);
        $this->get(AnalyticsDashboardEditor::getUrl(['record' => $dashboard->id]))->assertOk();
    }

    public function test_native_database_form_defaults_to_postgresql_and_offers_only_supported_drivers(): void
    {
        $component = Livewire::test(ListAnalyticsConnections::class)->mountAction('create')->assertActionDataSet([
            'driver' => 'pgsql', 'configuration.host' => 'localhost', 'configuration.port' => 5432, 'configuration.database' => 'unisq', 'configuration.username' => 'postgres', 'configuration.sslmode' => 'prefer',
        ]);
        $fields = $component->instance()->getMountedActionForm()->getFlatFields(withHidden: true);
        $this->assertSame(['pgsql' => 'PostgreSQL', 'clickhouse' => 'ClickHouse'], $fields['driver']->getOptions());
        $this->assertArrayNotHasKey('configuration.path', $fields);
        $this->assertSame(['pgsql' => 'PostgreSQL', 'clickhouse' => 'ClickHouse'], $component->instance()->getTable()->getFilter('driver')->getOptions());

        $component->setActionData(['driver' => 'clickhouse'])->assertActionDataSet([
            'configuration.host' => 'localhost', 'configuration.port' => 8123, 'configuration.database' => '', 'configuration.username' => 'default', 'configuration.ssl' => false,
        ])->setActionData(['driver' => 'pgsql'])->assertActionDataSet([
            'configuration.host' => 'localhost', 'configuration.port' => 5432, 'configuration.database' => 'unisq', 'configuration.username' => 'postgres', 'configuration.sslmode' => 'prefer',
        ]);
    }

    public function test_native_database_list_hides_legacy_sqlite_connections_without_deleting_them(): void
    {
        $postgres = $this->connection();
        $clickhouse = $this->connection(driver: 'clickhouse');
        $legacy = $this->connection(driver: 'sqlite');
        $before = $legacy->fresh()->getRawOriginal();

        Livewire::test(ListAnalyticsConnections::class)
            ->assertCanSeeTableRecords([$postgres, $clickhouse])
            ->assertCanNotSeeTableRecords([$legacy]);

        $this->assertSame($before, $legacy->refresh()->getRawOriginal());
        $this->assertFileExists($this->sourcePath);
        $this->assertDatabaseCount('analytics_connections', 3);
    }

    public function test_connection_api_rejects_sqlite_for_create_and_test(): void
    {
        config(['analytics.connection_drivers' => ['pgsql', 'clickhouse']]);
        $this->mock(ConnectionManager::class)->shouldNotReceive('catalog');
        $payload = ['name' => 'Rejected SQLite', 'driver' => 'sqlite', 'configuration' => ['path' => $this->sourcePath], 'test_first' => true];
        $this->postJson('/analytics/api/connections', $payload)->assertUnprocessable()->assertJsonValidationErrors('driver');
        $this->postJson('/analytics/api/connections/test', $payload)->assertUnprocessable()->assertJsonValidationErrors('driver');
        $this->assertDatabaseCount('analytics_connections', 0);
    }

    public function test_native_database_modal_creates_and_syncs_postgresql_catalog_without_external_services(): void
    {
        $catalog = [['key' => 'public.events', 'label' => 'events', 'schema' => 'public', 'kind' => 'base table', 'fields' => [
            ['key' => 'id', 'label' => 'id', 'raw_type' => 'integer', 'type' => 'number', 'primary' => true, 'nullable' => false, 'relation' => null],
        ]]];
        $this->partialMock(ConnectionManager::class)->shouldReceive('catalog')->twice()->withArgs(fn (AnalyticsConnection $connection) => $connection->driver === 'pgsql')->andReturn($catalog);
        Livewire::test(ListAnalyticsConnections::class)->callAction('create', data: [
            'name' => 'Native PostgreSQL catalog', 'driver' => 'pgsql', 'configuration' => ['host' => 'db', 'port' => 5432, 'database' => 'soar_app', 'username' => 'postgres', 'sslmode' => 'prefer'], 'test_first' => true,
        ])->assertHasNoActionErrors();
        $record = AnalyticsConnection::where('name', 'Native PostgreSQL catalog')->firstOrFail();
        $this->assertSame($this->owner->id, $record->owner_id);
        $this->assertNotNull($record->synced_at);
        $this->assertSame($catalog, $record->catalog);
        Livewire::test(ListAnalyticsConnections::class)->callTableAction('sync', $record)->assertHasNoTableActionErrors();
        $this->assertSame($catalog, $record->refresh()->catalog);
    }

    public function test_edit_connection_keeps_password_private_and_preserves_it_when_empty(): void
    {
        $record = $this->connection(driver: 'clickhouse');
        $component = Livewire::test(ListAnalyticsConnections::class)->mountTableAction('edit', $record)
            ->assertTableActionDataSet(['name' => $record->name, 'configuration.host' => 'localhost']);
        $this->assertStringNotContainsString('private-panel-test-secret', json_encode($component->get('mountedTableActionsData')));
        $component->setTableActionData(['name' => 'Renamed native source', 'configuration.password' => '', 'configuration.port' => '8443'])->callMountedTableAction()->assertHasNoTableActionErrors();
        $this->assertSame('private-panel-test-secret', $record->refresh()->configuration['password']);
        $this->assertSame('Renamed native source', $record->name);
        $this->assertSame(8443, $record->configuration['port']);
    }

    public function test_native_postgresql_create_and_edit_work_without_contacting_the_server(): void
    {
        $this->mock(ConnectionManager::class)->shouldNotReceive('catalog');
        Livewire::test(ListAnalyticsConnections::class)->callAction('create', data: [
            'name' => 'Native PostgreSQL', 'driver' => 'pgsql', 'test_first' => false,
            'configuration' => ['host' => 'soar_db', 'port' => '5432', 'database' => 'soar_app', 'username' => 'analytics_reader', 'password' => 'native-pg-private-test-secret', 'sslmode' => 'require'],
        ])->assertHasNoActionErrors();

        $record = AnalyticsConnection::where('name', 'Native PostgreSQL')->firstOrFail();
        $this->assertSame($this->owner->id, $record->owner_id);
        $this->assertSame('pgsql', $record->driver);
        $this->assertSame('soar_db', $record->configuration['host']);
        $this->assertSame(5432, $record->configuration['port']);
        $this->assertSame('require', $record->configuration['sslmode']);
        $this->assertNull($record->catalog);
        $this->assertNull($record->synced_at);
        $this->assertStringNotContainsString('native-pg-private-test-secret', DB::table('analytics_connections')->where('id', $record->id)->value('configuration'));

        $component = Livewire::test(ListAnalyticsConnections::class)->mountTableAction('edit', $record)
            ->assertTableActionDataSet(['configuration.host' => 'soar_db', 'configuration.port' => 5432, 'configuration.sslmode' => 'require']);
        $this->assertStringNotContainsString('native-pg-private-test-secret', json_encode($component->get('mountedTableActionsData')));
        $component->setTableActionData(['name' => 'Renamed PostgreSQL', 'configuration.host' => 'soar_db_replica', 'configuration.port' => '5433', 'configuration.password' => '', 'configuration.sslmode' => 'prefer'])
            ->callMountedTableAction()->assertHasNoTableActionErrors();

        $record->refresh();
        $this->assertSame('Renamed PostgreSQL', $record->name);
        $this->assertSame('soar_db_replica', $record->configuration['host']);
        $this->assertSame('soar_app', $record->configuration['database']);
        $this->assertSame(5433, $record->configuration['port']);
        $this->assertSame('prefer', $record->configuration['sslmode']);
        $this->assertSame('native-pg-private-test-secret', $record->configuration['password']);
        $this->assertDatabaseCount('analytics_connections', 1);
    }

    public function test_native_postgresql_create_displays_invalid_host_error_on_the_nested_field(): void
    {
        Livewire::test(ListAnalyticsConnections::class)->callAction('create', data: [
            'name' => 'Invalid PostgreSQL host', 'driver' => 'pgsql', 'test_first' => false,
            'configuration' => ['host' => 'http://localhost:5432', 'port' => 5432, 'database' => 'reporting', 'username' => 'analytics_reader', 'sslmode' => 'prefer'],
        ])->assertHasActionErrors(['configuration.host'])->assertHasNoActionErrors(['host']);

        $this->assertDatabaseMissing('analytics_connections', ['name' => 'Invalid PostgreSQL host']);
        $this->assertDatabaseCount('analytics_connections', 0);
    }

    public function test_native_postgresql_edit_displays_nested_host_error_without_changing_the_record(): void
    {
        $record = AnalyticsConnection::create([
            'owner_id' => $this->owner->id, 'name' => 'Unchanged PostgreSQL', 'driver' => 'pgsql',
            'configuration' => ['host' => 'pgsql.internal', 'port' => 5432, 'database' => 'reporting', 'username' => 'analytics_reader', 'password' => 'native-pg-private-test-secret', 'sslmode' => 'prefer'],
        ]);
        $before = $record->fresh()->getRawOriginal();
        Livewire::test(ListAnalyticsConnections::class)->callTableAction('edit', $record, data: [
            'name' => 'Must not be saved', 'configuration.host' => 'https://localhost',
        ])->assertHasTableActionErrors(['configuration.host'])->assertHasNoTableActionErrors(['host']);

        $this->assertSame($before, $record->refresh()->getRawOriginal());
        $this->assertDatabaseMissing('analytics_connections', ['name' => 'Must not be saved']);
    }

    public function test_connection_failure_is_reported_without_saving_invalid_source(): void
    {
        $this->mock(ConnectionManager::class)->shouldReceive('catalog')->once()->andThrow(ValidationException::withMessages(['connection' => 'PostgreSQL test connection failed.']));
        Livewire::test(ListAnalyticsConnections::class)->callAction('create', data: [
            'name' => 'Unavailable PostgreSQL', 'driver' => 'pgsql', 'configuration' => ['host' => 'db', 'port' => 5432, 'database' => 'soar_app', 'username' => 'postgres', 'sslmode' => 'prefer'], 'test_first' => true,
        ])->assertHasActionErrors(['connection']);
        $this->assertDatabaseMissing('analytics_connections', ['name' => 'Unavailable PostgreSQL']);
    }

    public function test_native_report_metadata_retains_query_and_detects_a_stale_version(): void
    {
        $connection = $this->connection(driver: 'sqlite');
        app(ConnectionManager::class)->sync($connection);
        $definition = ['connection_id' => $connection->id, 'source' => 'events', 'mode' => 'rows', 'metrics' => [], 'dimensions' => [], 'filters' => [], 'sort' => [], 'limit' => 20];
        $report = AnalyticsReport::create(['owner_id' => $this->owner->id, 'name' => 'Native report', 'query_definition' => $definition, 'display' => 'table', 'visualization_settings' => ['decimals' => 2]]);
        $component = Livewire::test(ListAnalyticsReports::class)->callTableAction('edit', $report, data: ['name' => 'Native report renamed', 'description' => 'Metadata only', 'version' => 1])->assertHasNoTableActionErrors();
        $this->assertSame('Native report renamed', $report->refresh()->name);
        $this->assertSame(2, $report->version);
        $this->assertSame('events', $report->query_definition['source']);
        $this->assertSame(['decimals' => 2], $report->visualization_settings);
        $component->callTableAction('edit', $report, data: ['name' => 'Stale edit', 'version' => 1])->assertHasTableActionErrors();
        $this->assertSame('Native report renamed', $report->refresh()->name);
    }

    public function test_panel_adapter_rejects_another_users_connection_record(): void
    {
        $record = $this->connection(User::factory()->create());
        $this->expectException(HttpException::class);
        app(PanelActions::class)->saveConnection(['name' => 'Attempted takeover', 'driver' => 'pgsql', 'configuration' => $record->configuration], $record);
    }

    public function test_native_report_display_filter_finds_doughnut_and_pivot_reports_with_translated_labels(): void
    {
        $connection = $this->connection();
        $definition = [
            'connection_id' => $connection->id, 'source' => 'events', 'mode' => 'aggregate',
            'metrics' => [['key' => 'total', 'function' => 'sum', 'field' => 'amount', 'label' => 'Total']],
            'dimensions' => [['field' => 'id', 'grain' => null]], 'filters' => [], 'sort' => [], 'limit' => 20,
        ];
        $reports = collect(['doughnut', 'pivot', 'table'])->mapWithKeys(fn (string $display) => [
            $display => AnalyticsReport::create(['owner_id' => $this->owner->id, 'name' => 'Native '.$display, 'query_definition' => $definition, 'display' => $display, 'visualization_settings' => []]),
        ]);

        Livewire::test(ListAnalyticsReports::class)
            ->assertCanSeeTableRecords($reports->values())
            ->filterTable('display', 'doughnut')
            ->assertCanSeeTableRecords([$reports['doughnut']])
            ->assertCanNotSeeTableRecords([$reports['pivot'], $reports['table']])
            ->assertTableColumnFormattedStateSet('display', 'دونات', $reports['doughnut'])
            ->filterTable('display', 'pivot')
            ->assertCanSeeTableRecords([$reports['pivot']])
            ->assertCanNotSeeTableRecords([$reports['doughnut'], $reports['table']])
            ->assertTableColumnFormattedStateSet('display', 'جدول محوری', $reports['pivot']);
    }

    public function test_native_report_copy_preserves_query_and_settings_but_has_its_own_identity_and_permissions(): void
    {
        $connection = $this->connection(driver: 'sqlite');
        app(ConnectionManager::class)->sync($connection);
        $definition = app(ReportRunner::class)->validate([
            'connection_id' => $connection->id, 'source' => 'events', 'mode' => 'rows',
            'metrics' => [], 'dimensions' => [], 'filters' => [], 'sort' => [['key' => 'amount', 'direction' => 'desc']], 'limit' => 20,
        ], $this->owner->id);
        $original = AnalyticsReport::create([
            'owner_id' => $this->owner->id, 'name' => 'Original report', 'description' => 'Original description', 'version' => 8,
            'query_definition' => $definition, 'display' => 'table', 'visualization_settings' => ['decimals' => 2, 'color' => '#314CFF'],
        ]);
        $component = Livewire::test(ListAnalyticsReports::class)
            ->mountTableAction('copy', $original)
            ->assertTableActionDataSet(['name' => 'Original report — کپی', 'description' => 'Original description'])
            ->setTableActionData(['name' => 'Independent copy', 'description' => 'Copy description'])
            ->callMountedTableAction()->assertHasNoTableActionErrors();
        $copy = AnalyticsReport::where('name', 'Independent copy')->firstOrFail();
        $this->assertNotSame($original->id, $copy->id);
        $this->assertSame($this->owner->id, $copy->owner_id);
        $this->assertSame(1, $copy->version);
        // JSON object key order is incidental; query list order and scalar types are preserved.
        $this->assertSame($this->normalizedJsonMaps($definition), $this->normalizedJsonMaps($copy->query_definition));
        $this->assertSame($original->visualization_settings, $copy->visualization_settings);
        $this->assertSame($original->display, $copy->display);
        $this->assertSame('Copy description', $copy->description);
        $this->assertSame('Original report', $original->refresh()->name);
        $this->assertSame('Original description', $original->description);
        $this->assertSame(8, $original->version);
        $component->assertRedirect(AnalyticsReportEditor::getUrl(['record' => $copy->id]));

        $this->actingAs(User::factory()->create());
        Livewire::test(ListAnalyticsReports::class)->assertCanNotSeeTableRecords([$original, $copy])->assertTableActionHidden('copy', $original);
        try {
            app(PanelActions::class)->copyReport($original, ['name' => 'Forbidden copy']);
            $this->fail('Another user must not be able to copy this report.');
        } catch (HttpException $exception) {
            $this->assertSame(403, $exception->getStatusCode());
        }
        $this->assertDatabaseMissing('analytics_reports', ['name' => 'Forbidden copy']);
    }
}
