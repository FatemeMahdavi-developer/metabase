<?php

namespace Tests\Feature;

use App\Domain\Analytics\DashboardStore;
use App\Domain\Analytics\DrillResultPage;
use App\Domain\Analytics\Drivers\ConnectionManager;
use App\Domain\Analytics\ReportRunner;
use App\Models\AnalyticsConnection;
use App\Models\AnalyticsDashboard;
use App\Models\AnalyticsDashboardMember;
use App\Models\AnalyticsReport;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Validation\ValidationException;
use PDO;
use Tests\TestCase;

class DrillResultPageTest extends TestCase
{
    use RefreshDatabase;

    private User $owner;
    private AnalyticsConnection $connection;
    private string $path;

    protected function setUp(): void
    {
        parent::setUp();
        $this->owner = User::factory()->create();
        $this->actingAs($this->owner);
        $this->path = storage_path('framework/drill-pages-'.bin2hex(random_bytes(6)).'.sqlite');
        $pdo = new PDO('sqlite:'.$this->path);
        $pdo->exec('CREATE TABLE records (id INTEGER PRIMARY KEY, label TEXT, segment INTEGER, amount DECIMAL)');
        $pdo->beginTransaction();
        $statement = $pdo->prepare('INSERT INTO records VALUES (?, ?, ?, ?)');
        for ($index = 1; $index <= 2505; $index++) {
            $statement->execute([$index, in_array($index, [2499, 2503]) ? 'Needle%_literal' : 'Row'.str_pad((string) $index, 5, '0', STR_PAD_LEFT), $index % 2, $index / 2]);
        }
        $pdo->commit();
        $pdo = null;
        $this->connection = AnalyticsConnection::create(['owner_id' => $this->owner->id, 'name' => 'Drill pages fixture', 'driver' => 'sqlite', 'configuration' => ['path' => $this->path]]);
        app(ConnectionManager::class)->sync($this->connection);
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
        return array_replace(['connection_id' => $this->connection->id, 'source' => 'records', 'mode' => 'rows', 'metrics' => [], 'dimensions' => [], 'filters' => [], 'sort' => [['key' => 'id', 'direction' => 'asc']], 'joins' => [], 'expressions' => [], 'columns' => ['id', 'label', 'segment', 'amount'], 'limit' => 100], $changes);
    }

    public function test_pages_reach_all_matching_rows_beyond_legacy_and_preview_limits_without_changing_previews(): void
    {
        $service = app(DrillResultPage::class);
        $first = $service->run($this->query(), $this->owner->id);
        $this->assertCount(25, $first['rows']);
        $this->assertSame(range(1, 25), array_map('intval', array_column($first['rows'], 'id')));
        $this->assertSame(['page' => 1, 'page_size' => 25, 'total' => 2505, 'search' => '', 'sort' => null], $first['meta']['pagination']);
        $last = $service->run($this->query(), $this->owner->id, ['page' => 101]);
        $this->assertSame([2501.0, 2502.0, 2503.0, 2504.0, 2505.0], array_column($last['rows'], 'id'));
        $this->assertSame(hash('sha256', json_encode([$last['columns'], $last['rows']])), $last['meta']['result_signature']);
        $this->assertFalse($last['meta']['truncated']);
        $this->assertStringEndsWith('LIMIT 25 OFFSET 2500', $last['sql']);
        $clamped = $service->run($this->query(), $this->owner->id, ['page' => PHP_INT_MAX]);
        $this->assertSame($last['rows'], $clamped['rows']);
        $this->assertCount(100, app(ReportRunner::class)->run($this->query(), $this->owner->id)['rows']);
        $preview = app(ReportRunner::class)->run($this->query(['limit' => null, 'limit_explicit' => false]), $this->owner->id);
        $this->assertCount(2000, $preview['rows']);
        $this->assertTrue($preview['meta']['truncated']);
        $this->assertSame(2000, config('analytics.preview_row_limit'));
    }

    public function test_intentional_final_intermediate_and_native_sql_limits_are_preserved(): void
    {
        $service = app(DrillResultPage::class);
        $bounded = $service->run($this->query(['limit_explicit' => true]), $this->owner->id, ['page' => 5]);
        $this->assertSame(100, $bounded['meta']['pagination']['total']);
        $this->assertSame(4, $bounded['meta']['pagination']['page']);
        $this->assertSame(100.0, $bounded['rows'][24]['id']);
        $large = $service->run($this->query(['limit' => 2400, 'limit_explicit' => true]), $this->owner->id, ['page' => 96]);
        $this->assertSame(2400, $large['meta']['pagination']['total']);
        $this->assertSame(2400.0, $large['rows'][24]['id']);
        $stage = ['mode' => 'rows', 'metrics' => [], 'dimensions' => [], 'filters' => [], 'sort' => [], 'columns' => ['id', 'label'], 'limit' => null, 'limit_explicit' => false];
        $pipeline = $service->run($this->query(['limit_explicit' => true, 'stages' => [$stage]]), $this->owner->id, ['page_size' => 100]);
        $this->assertSame(100, $pipeline['meta']['pagination']['total']);
        $this->assertCount(100, $pipeline['rows']);
        $native = $service->run($this->query(['mode' => 'native', 'sql' => 'SELECT id,label FROM records ORDER BY id LIMIT 37', 'parameters' => [], 'limit' => null, 'limit_explicit' => false]), $this->owner->id, ['page' => 2]);
        $this->assertSame(37, $native['meta']['pagination']['total']);
        $this->assertCount(12, $native['rows']);
        $this->assertSame(37.0, $native['rows'][11]['id']);
        $this->assertStringContainsString('ORDER BY id LIMIT 37)', $native['sql']);
    }

    public function test_search_and_typed_sort_run_over_all_matches_with_literal_bound_search(): void
    {
        $service = app(DrillResultPage::class);
        $matched = $service->run($this->query(), $this->owner->id, ['search' => 'needle%_', 'sort' => ['key' => 'id', 'direction' => 'desc']]);
        $this->assertSame(2, $matched['meta']['pagination']['total']);
        $this->assertSame([2503.0, 2499.0], array_column($matched['rows'], 'id'));
        $this->assertStringNotContainsString('needle%_', $matched['sql']);
        $literal = $service->run($this->query(), $this->owner->id, ['search' => '%_']);
        $this->assertSame(2, $literal['meta']['pagination']['total']);
        $injection = $service->run($this->query(), $this->owner->id, ['search' => "' OR 1=1 --"]);
        $this->assertSame(0, $injection['meta']['pagination']['total']);
        $this->assertSame([], $injection['rows']);
        $sorted = $service->run($this->query(), $this->owner->id, ['page' => 2, 'page_size' => 5, 'sort' => ['key' => 'amount', 'direction' => 'desc']]);
        $this->assertSame([2500.0, 2499.0, 2498.0, 2497.0, 2496.0], array_column($sorted['rows'], 'id'));
        foreach ([['sort' => []], ['page_size' => 1000], ['page' => 0], ['sort' => ['key' => 'id DESC; DROP TABLE records', 'direction' => 'asc']], ['sort' => ['key' => 'id', 'direction' => 'sideways']]] as $invalid) {
            try {
                $service->run($this->query(), $this->owner->id, $invalid);
                $this->fail('Invalid pagination input was accepted');
            } catch (ValidationException $exception) {
                $this->assertNotEmpty($exception->errors());
            }
        }
    }

    public function test_report_page_api_replays_authorized_drill_and_resolves_late_page_nested_clicks(): void
    {
        $query = $this->query(['limit_explicit' => false]);
        $context = ['column_key' => 'amount', 'row_index' => 0, 'kind' => 'cell'];
        $path = [['context' => $context, 'action_id' => 'filter:gt']];
        $endpoint = '/analytics/api/reports/interactions/page';
        $this->postJson($endpoint, ['query_definition' => $query, 'context' => $context, 'path' => []])->assertUnprocessable()->assertJsonValidationErrors('path');
        $response = $this->postJson($endpoint, ['query_definition' => $query, 'context' => $context, 'path' => $path, 'pagination' => ['page' => 101]])->assertOk();
        $response->assertJsonPath('meta.pagination.total', 2504)->assertJsonPath('meta.pagination.page', 101);
        $this->assertSame([2502, 2503, 2504, 2505], array_column($response->json('rows'), 'id'));
        $pageContext = ['column_key' => 'id', 'row_index' => 0, 'kind' => 'cell', 'pagination' => $response->json('meta.pagination'), 'result_signature' => $response->json('meta.result_signature')];
        $options = $this->postJson('/analytics/api/reports/interactions/options', ['query_definition' => $query, 'context' => $pageContext, 'path' => $path])->assertOk();
        $options->assertJsonPath('context.value', 2502);
        $forged = [...$pageContext, 'result_signature' => str_repeat('0', 64)];
        $this->postJson('/analytics/api/reports/interactions/options', ['query_definition' => $query, 'context' => $forged, 'path' => $path])->assertConflict();
    }

    public function test_shared_widget_paging_keeps_saved_scope_and_rejects_outsiders(): void
    {
        $report = AnalyticsReport::create(['owner_id' => $this->owner->id, 'name' => 'Records', 'query_definition' => $this->query(), 'display' => 'table', 'visualization_settings' => []]);
        $dashboard = AnalyticsDashboard::create(['owner_id' => $this->owner->id, 'name' => 'Scoped records', 'settings' => []]);
        app(DashboardStore::class)->save($dashboard, ['name' => $dashboard->name, 'description' => '', 'folder_id' => null, 'version' => $dashboard->fresh()->version,
            'settings' => ['auto_apply' => true], 'tabs' => [['key' => 'main', 'name' => 'Main']],
            'widgets' => [['key' => 'card', 'type' => 'report', 'report_id' => $report->id, 'tab_key' => 'main', 'x' => 0, 'y' => 0, 'w' => 12, 'h' => 6, 'settings' => [], 'content' => null, 'click_behavior' => ['type' => 'menu']]],
            'filters' => [['key' => 'segment', 'label' => 'Segment', 'type' => 'number', 'required' => true, 'default_value' => 0, 'settings' => [], 'bindings' => [['widget_key' => 'card', 'target' => 'segment', 'operator' => 'eq']]]],
        ], $this->owner->id);
        $viewer = User::factory()->create();
        AnalyticsDashboardMember::create(['dashboard_id' => $dashboard->id, 'user_id' => $viewer->id, 'role' => 'viewer']);
        $this->actingAs($viewer);
        $context = ['column_key' => 'amount', 'row_index' => 0, 'kind' => 'cell'];
        $body = ['context' => $context, 'path' => [['context' => $context, 'action_id' => 'filter:gt']], 'parameters' => ['segment' => 0], 'pagination' => ['page' => 51], 'query_definition' => ['source' => 'untrusted']];
        $endpoint = '/analytics/api/dashboards/'.$dashboard->id.'/widgets/card/interactions/page';
        $response = $this->postJson($endpoint, $body)->assertOk()->assertJsonPath('meta.pagination.total', 1251);
        $this->assertSame([2504], array_column($response->json('rows'), 'id'));
        $this->assertSame($this->query(), $report->fresh()->query_definition);
        $this->actingAs(User::factory()->create());
        $this->postJson($endpoint, $body)->assertForbidden();
    }

    public function test_non_projected_row_order_is_preserved_without_exposing_internal_sort_fields(): void
    {
        $service = app(DrillResultPage::class);
        $source = $this->query(['columns' => ['id', 'label'], 'sort' => [['key' => 'amount', 'direction' => 'desc']], 'limit' => null, 'limit_explicit' => false]);
        $stage = ['mode' => 'rows', 'metrics' => [], 'dimensions' => [], 'filters' => [], 'sort' => [['key' => 'amount', 'direction' => 'desc']], 'columns' => ['id', 'label'], 'limit' => null, 'limit_explicit' => false];
        $pipeline = $this->query(['limit' => null, 'limit_explicit' => false, 'stages' => [$stage]]);
        foreach ([$source, $pipeline] as $query) {
            $page = $service->run($query, $this->owner->id, ['page' => 2, 'page_size' => 5]);
            $this->assertSame([2500.0, 2499.0, 2498.0, 2497.0, 2496.0], array_column($page['rows'], 'id'));
            $this->assertSame(['id', 'label'], array_column($page['columns'], 'key'));
            foreach ($page['rows'] as $row) {
                $this->assertSame(['id', 'label'], array_keys($row));
            }
            $this->assertSame(hash('sha256', json_encode([$page['columns'], $page['rows']])), $page['meta']['result_signature']);
        }
    }
}
