<?php

namespace Tests\Feature;

use App\Domain\Analytics\Drivers\ConnectionManager;
use App\Models\AnalyticsConnection;
use App\Models\AnalyticsDashboard;
use App\Models\AnalyticsReport;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use PDO;
use Tests\TestCase;

class InteractionApiTest extends TestCase
{
    use RefreshDatabase;

    private User $owner;

    private AnalyticsConnection $connection;

    private AnalyticsReport $report;

    private AnalyticsDashboard $dashboard;

    private string $path;

    protected function setUp(): void
    {
        parent::setUp();
        $this->owner = User::factory()->create();
        $this->actingAs($this->owner);
        $this->path = storage_path('framework/interaction-api-'.bin2hex(random_bytes(6)).'.sqlite');
        $pdo = new PDO('sqlite:'.$this->path);
        $pdo->exec("CREATE TABLE orders (id INTEGER PRIMARY KEY, total DECIMAL NOT NULL, status TEXT);
            INSERT INTO orders VALUES (1,100,'paid'),(2,200,'paid'),(3,300,'pending'),(4,400,'paid');");
        $pdo = null;
        $this->connection = AnalyticsConnection::create(['owner_id' => $this->owner->id, 'name' => 'API fixture', 'driver' => 'sqlite', 'configuration' => ['path' => $this->path]]);
        app(ConnectionManager::class)->sync($this->connection);
        $this->report = AnalyticsReport::create(['owner_id' => $this->owner->id, 'name' => 'Sales', 'query_definition' => $this->query(), 'display' => 'table', 'visualization_settings' => []]);
        $dashboard = $this->postJson('/analytics/api/dashboards', ['name' => 'Shared board'])->assertOk()->json();
        $dashboard['widgets'] = [['key' => 'card', 'report_id' => $this->report->id, 'type' => 'report', 'tab_key' => 'main', 'x' => 0, 'y' => 0, 'w' => 12, 'h' => 8, 'settings' => [], 'click_behavior' => ['type' => 'details']]];
        $dashboard['filters'] = [['key' => 'status', 'label' => 'Status', 'type' => 'text', 'required' => false, 'default_value' => 'paid', 'settings' => [], 'bindings' => [['widget_key' => 'card', 'target' => 'status', 'operator' => 'eq']]]];
        $this->putJson('/analytics/api/dashboards/'.$dashboard['id'], $dashboard)->assertOk();
        $this->dashboard = AnalyticsDashboard::findOrFail($dashboard['id']);
    }

    protected function tearDown(): void
    {
        parent::tearDown();
        if (isset($this->path) && is_file($this->path)) {
            unlink($this->path);
        }
    }

    private function query(array $changes = []): array
    {
        return array_replace(['connection_id' => $this->connection->id, 'source' => 'orders', 'mode' => 'rows', 'metrics' => [], 'dimensions' => [], 'filters' => [], 'sort' => [['key' => 'id', 'direction' => 'asc']], 'limit' => null, 'limit_explicit' => false], $changes);
    }

    private function widgetUrl(string $operation = 'options'): string
    {
        return '/analytics/api/dashboards/'.$this->dashboard->id.'/widgets/card/interactions/'.$operation;
    }

    public function test_owned_report_interaction_routes_execute_typed_actions_without_mutating_saved_report(): void
    {
        $context = ['column_key' => 'total', 'row_index' => 1];
        $response = $this->postJson('/analytics/api/reports/interactions/options', ['query_definition' => $this->query(), 'context' => $context])->assertOk()->assertJsonPath('context.value', 200);
        $this->assertContains('filter:gt', array_column($response->json('actions'), 'id'));
        $this->postJson('/analytics/api/reports/interactions/apply', ['query_definition' => $this->query(), 'context' => $context, 'action_id' => 'filter:gt'])
            ->assertOk()->assertJsonCount(2, 'result.rows')->assertJsonPath('result.rows.0.id', 3)->assertJsonPath('result.rows.1.id', 4);
        $this->assertSame($this->query(), $this->report->refresh()->query_definition);
        $this->postJson('/analytics/api/reports/interactions/apply', ['query_definition' => $this->query(), 'context' => [...$context, 'value' => 0], 'action_id' => 'filter:gt'])->assertUnprocessable();
        $this->postJson('/analytics/api/reports/interactions/apply', ['query_definition' => $this->query(), 'context' => $context, 'action_id' => 'DROP TABLE orders'])->assertUnprocessable();
    }

    public function test_shared_widget_replay_ignores_forged_query_and_keeps_dashboard_filters(): void
    {
        $viewer = User::factory()->create();
        DB::table('analytics_dashboard_members')->insert(['dashboard_id' => $this->dashboard->id, 'user_id' => $viewer->id, 'role' => 'viewer']);
        $this->actingAs($viewer);
        $context = ['column_key' => 'total', 'row_index' => 0];
        $forged = ['query_definition' => $this->query(['mode' => 'native', 'sql' => 'SELECT * FROM orders', 'parameters' => []]), 'context' => $context, 'action_id' => 'filter:gt'];
        $response = $this->postJson($this->widgetUrl('apply'), $forged)->assertOk()->assertJsonCount(2, 'result.rows');
        $this->assertSame([2, 4], array_column($response->json('result.rows'), 'id'));
        $next = ['column_key' => 'total', 'row_index' => 0, 'result_signature' => $response->json('result.meta.result_signature')];
        $this->postJson($this->widgetUrl('apply'), ['context' => $next, 'action_id' => 'filter:gt', 'path' => [['context' => $context, 'action_id' => 'filter:gt']]])
            ->assertOk()->assertJsonCount(1, 'result.rows')->assertJsonPath('result.rows.0.id', 4);
        $this->postJson('/analytics/api/reports/interactions/options', ['query_definition' => $this->query(), 'context' => $context])->assertNotFound();
        $this->assertSame($this->query(), $this->report->refresh()->query_definition);
    }

    public function test_widget_authorization_required_filters_and_missing_widgets_are_enforced(): void
    {
        $context = ['column_key' => 'total', 'row_index' => 0];
        DB::table('analytics_dashboard_filters')->where('dashboard_id', $this->dashboard->id)->update(['required' => true, 'default_value' => null]);
        $this->postJson($this->widgetUrl(), ['context' => $context])->assertUnprocessable();
        $this->postJson($this->widgetUrl(), ['context' => $context, 'parameters' => ['status' => 'paid']])->assertOk();
        $this->postJson(str_replace('/card/', '/missing/', $this->widgetUrl()), ['context' => $context])->assertNotFound();
        $this->actingAs(User::factory()->create())->postJson($this->widgetUrl(), ['context' => $context])->assertForbidden();
    }

    public function test_initial_widget_result_signature_rejects_stale_row_positions_after_source_changes(): void
    {
        $base = '/analytics/api/dashboards/'.$this->dashboard->id.'/widgets/card/query';
        $signature = $this->postJson($base, [])->assertOk()->json('meta.result_signature');
        $pdo = new PDO('sqlite:'.$this->path);
        $pdo->exec('UPDATE orders SET total=999 WHERE id=1');
        $pdo = null;
        Cache::flush();
        $context = ['column_key' => 'total', 'row_index' => 0, 'result_signature' => $signature];
        $this->postJson($this->widgetUrl(), ['context' => $context])->assertConflict();
        $this->postJson($this->widgetUrl('apply'), ['context' => $context, 'action_id' => 'filter:gt'])->assertConflict();
    }

    public function test_saved_widget_navigation_resolves_typed_mappings_and_shared_target_on_the_server(): void
    {
        $native = $this->query(['mode' => 'native', 'sql' => 'SELECT id,total,status FROM orders WHERE status={{category}} AND total >= {{minimum}} ORDER BY id', 'parameters' => [['key' => 'category', 'type' => 'text', 'default' => 'paid'], ['key' => 'minimum', 'type' => 'number', 'default' => 0]]]);
        $target = AnalyticsReport::create(['owner_id' => $this->owner->id, 'name' => 'Target', 'query_definition' => $native, 'display' => 'table', 'visualization_settings' => []]);
        $widgetId = DB::table('analytics_dashboard_widgets')->where('dashboard_id', $this->dashboard->id)->where('key', 'card')->value('id');
        $behavior = ['type' => 'report', 'report_id' => $target->id, 'mappings' => [['target' => 'category', 'source' => 'column', 'key' => 'status'], ['target' => 'minimum', 'source' => 'parameter', 'key' => 'minimum']]];
        DB::table('analytics_dashboard_widgets')->where('id', $widgetId)->update(['click_behavior' => json_encode($behavior)]);
        DB::table('analytics_dashboard_widgets')->insert(['dashboard_id' => $this->dashboard->id, 'key' => 'target', 'report_id' => $target->id, 'type' => 'report', 'tab_key' => 'main', 'x' => 12, 'y' => 0, 'w' => 12, 'h' => 8, 'settings' => '{}']);
        $filterId = DB::table('analytics_dashboard_filters')->insertGetId(['dashboard_id' => $this->dashboard->id, 'key' => 'minimum', 'label' => 'Minimum', 'type' => 'number', 'required' => false, 'default_value' => '200', 'settings' => '{}', 'position' => 1]);
        DB::table('analytics_filter_bindings')->insert(['filter_id' => $filterId, 'widget_id' => $widgetId, 'target' => 'total', 'operator' => 'gte']);
        $context = ['column_key' => 'status', 'row_index' => 0];
        $url = '/analytics/api/dashboards/'.$this->dashboard->id.'/widgets/card/click-report';
        $response = $this->postJson($url, ['context' => $context, 'report_id' => 99999, 'query_definition' => ['sql' => 'DELETE FROM orders']])->assertOk();
        $this->assertSame([2, 4], array_column($response->json('result.rows'), 'id'));
        $response->assertJsonPath('report.id', $target->id)->assertJsonPath('query_definition.parameters.1.default', 200);
        $viewer = User::factory()->create();
        DB::table('analytics_dashboard_members')->insert(['dashboard_id' => $this->dashboard->id, 'user_id' => $viewer->id, 'role' => 'viewer']);
        $this->actingAs($viewer)->postJson($url, ['context' => $context])->assertOk()->assertJsonCount(2, 'result.rows');
        $next = ['column_key' => 'total', 'row_index' => 0, 'result_signature' => $response->json('result.meta.result_signature')];
        $this->postJson($this->widgetUrl('apply'), ['navigation_context' => $context, 'context' => $next, 'action_id' => 'filter:gt', 'query_definition' => $this->query()])
            ->assertOk()->assertJsonCount(1, 'result.rows')->assertJsonPath('result.rows.0.id', 4);
        $this->assertSame($native, $target->refresh()->query_definition);
        $this->postJson($url, ['context' => $context, 'parameters' => ['minimum' => 'invalid-number']])->assertUnprocessable();
    }

    public function test_navigation_rejects_inaccessible_destinations_and_unconfigured_clicks(): void
    {
        $url = '/analytics/api/dashboards/'.$this->dashboard->id.'/widgets/card/click-report';
        $context = ['column_key' => 'status', 'row_index' => 0];
        $this->postJson($url, ['context' => $context])->assertUnprocessable();
        $other = User::factory()->create();
        $target = AnalyticsReport::create(['owner_id' => $other->id, 'name' => 'Private', 'query_definition' => $this->query(), 'display' => 'table', 'visualization_settings' => []]);
        DB::table('analytics_dashboard_widgets')->where('dashboard_id', $this->dashboard->id)->where('key', 'card')->update(['click_behavior' => json_encode(['type' => 'report', 'report_id' => $target->id, 'mappings' => []])]);
        $this->postJson($url, ['context' => $context])->assertUnprocessable();
        $this->postJson($this->widgetUrl(), ['navigation_context' => $context, 'context' => ['column_key' => 'total', 'row_index' => 0]])->assertUnprocessable();
        $this->actingAs(User::factory()->create())->postJson($url, ['context' => $context])->assertForbidden();
    }

    public function test_total_navigation_uses_server_sum_and_rejects_unscoped_dimension_mappings(): void
    {
        $summary = $this->query(['mode' => 'aggregate', 'metrics' => [['key' => 'sales', 'function' => 'sum', 'field' => 'total']], 'dimensions' => [['field' => 'status']], 'sort' => []]);
        $this->report->update(['query_definition' => $summary]);
        DB::table('analytics_dashboard_filters')->where('dashboard_id', $this->dashboard->id)->update(['default_value' => null]);
        $target = AnalyticsReport::create(['owner_id' => $this->owner->id, 'name' => 'Selected total', 'query_definition' => $this->query(['mode' => 'native', 'sql' => 'SELECT {{amount}} AS selected_total, {{category}} AS selected_category', 'parameters' => [['key' => 'amount', 'type' => 'number', 'default' => 0], ['key' => 'category', 'type' => 'text', 'default' => 'paid']]]), 'display' => 'number', 'visualization_settings' => []]);
        $behavior = ['type' => 'report', 'report_id' => $target->id, 'mappings' => [['target' => 'amount', 'source' => 'column', 'key' => 'sales']]];
        $widget = DB::table('analytics_dashboard_widgets')->where('dashboard_id', $this->dashboard->id)->where('key', 'card');
        $widget->update(['click_behavior' => json_encode($behavior)]);
        $url = '/analytics/api/dashboards/'.$this->dashboard->id.'/widgets/card/click-report';
        $context = ['column_key' => 'sales', 'kind' => 'total', 'scope_fields' => []];
        $this->postJson($url, ['context' => $context])->assertOk()->assertJsonPath('result.rows.0.selected_total', 1000);
        $behavior['mappings'][] = ['target' => 'category', 'source' => 'column', 'key' => 'status'];
        $widget->update(['click_behavior' => json_encode($behavior)]);
        $this->postJson($url, ['context' => $context])->assertUnprocessable();
        $context = ['column_key' => 'sales', 'row_index' => 0, 'kind' => 'total', 'scope_fields' => ['status']];
        $this->postJson($url, ['context' => $context])->assertOk()->assertJsonPath('result.rows.0.selected_total', 700)->assertJsonPath('result.rows.0.selected_category', 'paid');
    }

    public function test_bucketed_date_navigation_preserves_period_for_structured_target_and_single_native_date(): void
    {
        $pdo = new PDO('sqlite:'.$this->path);
        $pdo->exec("ALTER TABLE orders ADD COLUMN ordered_at TIMESTAMP; UPDATE orders SET ordered_at=CASE id WHEN 1 THEN '2026-01-01 10:00:00' WHEN 2 THEN '2026-01-31 23:59:59' WHEN 3 THEN '2026-02-01 12:00:00' ELSE '2026-02-10 12:00:00' END;");
        $pdo = null;
        app(ConnectionManager::class)->sync($this->connection);
        $this->report->update(['query_definition' => $this->query(['mode' => 'aggregate', 'metrics' => [['key' => 'sales', 'function' => 'sum', 'field' => 'total']], 'dimensions' => [['field' => 'ordered_at', 'grain' => 'month']], 'sort' => []])]);
        $target = AnalyticsReport::create(['owner_id' => $this->owner->id, 'name' => 'Raw orders', 'query_definition' => $this->query(['filters' => [['field' => 'total', 'operator' => 'gte', 'value' => 150]]]), 'display' => 'table', 'visualization_settings' => []]);
        $widget = DB::table('analytics_dashboard_widgets')->where('dashboard_id', $this->dashboard->id)->where('key', 'card');
        $widget->update(['click_behavior' => json_encode(['type' => 'report', 'report_id' => $target->id, 'mappings' => [['target' => 'ordered_at', 'source' => 'column', 'key' => 'ordered_at']]])]);
        $url = '/analytics/api/dashboards/'.$this->dashboard->id.'/widgets/card/click-report';
        $context = ['column_key' => 'ordered_at', 'row_index' => 0];
        $response = $this->postJson($url, ['context' => $context])->assertOk()->assertJsonCount(1, 'result.rows')->assertJsonPath('result.rows.0.id', 2);
        $response->assertJsonPath('query_definition.filters.0.field', 'total')->assertJsonPath('query_definition.filters.1.operator', 'between')->assertJsonPath('query_definition.filters.1.value', ['2026-01-01', '2026-01-31']);
        $target->update(['query_definition' => $this->query(['mode' => 'native', 'sql' => 'SELECT id,ordered_at FROM orders WHERE date(ordered_at)={{selected_date}}', 'parameters' => [['key' => 'selected_date', 'type' => 'date', 'default' => '2020-01-01']]])]);
        $widget->update(['click_behavior' => json_encode(['type' => 'report', 'report_id' => $target->id, 'mappings' => [['target' => 'selected_date', 'source' => 'column', 'key' => 'ordered_at']]])]);
        $this->postJson($url, ['context' => $context])->assertOk()->assertJsonCount(1, 'result.rows')->assertJsonPath('result.rows.0.id', 1)->assertJsonPath('query_definition.parameters.0.default', '2026-01-01');
    }
}
