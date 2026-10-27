<?php

namespace Tests\Feature;

use App\Domain\Analytics\Drivers\ClickHouseDriver;
use App\Domain\Analytics\Drivers\ConnectionManager;
use App\Domain\Analytics\Drivers\SqliteDriver;
use App\Domain\Analytics\ReportRunner;
use App\Models\AnalyticsConnection;
use App\Models\AnalyticsReport;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Validation\ValidationException;
use PDO;
use Tests\TestCase;

class AnalyticsTest extends TestCase
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
        $this->path = storage_path('framework/testing-analytics-'.bin2hex(random_bytes(6)).'.sqlite');
        $pdo = new PDO('sqlite:'.$this->path);
        $pdo->exec("CREATE TABLE customers (id INTEGER PRIMARY KEY, city TEXT NOT NULL);
            CREATE TABLE orders (id INTEGER PRIMARY KEY, customer_id INTEGER REFERENCES customers(id), ordered_at TIMESTAMP NOT NULL, total DECIMAL NOT NULL, status TEXT);
            INSERT INTO customers VALUES (1, 'Tehran'), (2, 'Shiraz');
            INSERT INTO orders VALUES (1,1,'2026-01-01 10:00:00',100,'paid'), (2,1,'2026-01-31 23:59:59',200,'paid'), (3,2,'2026-02-01 12:00:00',300,'pending'), (4,2,'2026-02-20 12:00:00',400,NULL);
            CREATE VIEW order_view AS SELECT * FROM orders;");
        $pdo = null;
        $this->connection = AnalyticsConnection::create(['owner_id' => $this->owner->id, 'name' => 'Fixture', 'driver' => 'sqlite', 'configuration' => ['path' => $this->path]]);
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
        return array_replace(['connection_id' => $this->connection->id, 'source' => 'orders', 'mode' => 'aggregate', 'metrics' => [['key' => 'sales', 'function' => 'sum', 'field' => 'total']], 'dimensions' => [], 'filters' => [], 'sort' => [], 'joins' => [], 'limit' => 100], $changes);
    }

    private function report(array $query = []): AnalyticsReport
    {
        return AnalyticsReport::create(['owner_id' => $this->owner->id, 'name' => 'Sales', 'query_definition' => $this->query($query), 'display' => 'number', 'visualization_settings' => []])->refresh();
    }

    public function test_explicit_join_strategies_multiple_conditions_and_catalog_validation(): void
    {
        $pdo = new PDO('sqlite:'.$this->path);
        $pdo->exec("INSERT INTO customers VALUES (3, 'Unmatched'); INSERT INTO orders VALUES (5,99,'2026-03-01',500,'paid');");
        $join = ['alias' => 'customer', 'source' => 'customers', 'type' => 'left', 'conditions' => [['left' => 'customer_id', 'operator' => 'eq', 'right' => 'id']]];
        foreach (['left' => 5, 'inner' => 4, 'right' => 5, 'full' => 6] as $type => $count) {
            $result = $this->postJson('/analytics/api/reports/preview', ['query_definition' => $this->query(['mode' => 'rows', 'columns' => ['id', 'customer.city'], 'joins' => [[...$join, 'type' => $type]]])])->assertOk();
            $this->assertCount($count, $result->json('rows'));
            $this->assertStringContainsString(strtoupper($type).' JOIN', $result->json('sql'));
        }
        $join['type'] = 'inner';
        $join['conditions'][] = ['left' => 'id', 'operator' => 'eq', 'right' => 'id'];
        $this->postJson('/analytics/api/reports/preview', ['query_definition' => $this->query(['joins' => [$join]])])->assertOk()->assertJsonPath('rows.0.sales', 100);
        foreach ([['source' => 'customers; DROP TABLE orders'], ['alias' => 'x";'], ['conditions' => [['left' => 'status', 'operator' => 'eq', 'right' => 'id']]], ['conditions' => [['left' => 'customer.city', 'operator' => 'eq', 'right' => 'city']]]] as $invalid) {
            $this->postJson('/analytics/api/reports/preview', ['query_definition' => $this->query(['joins' => [array_replace($join, $invalid)]])])->assertUnprocessable();
        }
        $second = ['alias' => 'again', 'source' => 'customers', 'type' => 'left', 'conditions' => [['left' => 'customer.id', 'operator' => 'eq', 'right' => 'id']]];
        $result = $this->postJson('/analytics/api/reports/preview', ['query_definition' => $this->query(['joins' => [$join, $second], 'dimensions' => [['field' => 'again.city']]])])->assertOk();
        $this->assertSame('Tehran', $result->json('rows')[0]['again.city']);
    }

    public function test_custom_column_grammar_arithmetic_strings_dependencies_and_injection(): void
    {
        $expressions = [
            ['key' => 'tax', 'label' => 'مالیات', 'expression' => 'round([total] * 0.09, 2)'],
            ['key' => 'gross', 'label' => 'با مالیات', 'expression' => '[total] + [tax]'],
            ['key' => 'label', 'label' => 'برچسب', 'expression' => 'concat(upper(coalesce([status], "unknown")), "!")'],
            ['key' => 'tier', 'label' => 'سطح', 'expression' => 'case([total] >= 300 and [total] <= 400, "large", "small")'],
        ];
        $this->postJson('/analytics/api/reports/preview', ['query_definition' => $this->query(['mode' => 'rows', 'columns' => ['tax', 'gross', 'label'], 'expressions' => $expressions])])->assertOk()->assertJsonPath('rows.0.tax', 9)->assertJsonPath('rows.0.gross', 109)->assertJsonPath('rows.3.label', 'UNKNOWN!')->assertJsonPath('columns.0.label', 'مالیات');
        $this->postJson('/analytics/api/reports/preview', ['query_definition' => $this->query(['expressions' => $expressions, 'metrics' => [['key' => 'taxes', 'label' => 'جمع مالیات', 'function' => 'sum', 'field' => 'tax']]])])->assertOk()->assertJsonPath('rows.0.taxes', 90)->assertJsonPath('columns.0.label', 'جمع مالیات');
        $this->postJson('/analytics/api/reports/preview', ['query_definition' => $this->query(['mode' => 'rows', 'columns' => ['tier'], 'expressions' => $expressions])])->assertOk()->assertJsonPath('rows.0.tier', 'small')->assertJsonPath('rows.2.tier', 'large');
        foreach (['[total]; DROP TABLE orders', 'pg_read_file("/etc/passwd")', '[missing] + 1', '[status] * 2', 'round([total], 2, 3)', str_repeat('(', 30).'1'.str_repeat(')', 30)] as $expression) {
            $this->postJson('/analytics/api/reports/preview', ['query_definition' => $this->query(['expressions' => [['key' => 'custom', 'label' => 'Test', 'expression' => $expression]]])])->assertUnprocessable();
        }
    }

    public function test_optional_native_sql_blocks_bind_values_and_omit_empty_parameters(): void
    {
        $query = $this->query(['mode' => 'native', 'sql' => 'SELECT SUM(total) AS sales FROM orders WHERE 1=1 [[ AND status = {{status}} ]]', 'parameters' => [['key' => 'status', 'type' => 'text', 'required' => false, 'default' => '']]]);
        $this->postJson('/analytics/api/reports/preview', ['query_definition' => $query])->assertOk()->assertJsonPath('rows.0.sales', 1000);
        $this->postJson('/analytics/api/reports/preview', ['query_definition' => $query, 'parameters' => [['field' => 'status', 'value' => 'paid']]])->assertOk()->assertJsonPath('rows.0.sales', 300);
        $this->postJson('/analytics/api/reports/preview', ['query_definition' => $query, 'parameters' => [['field' => 'status', 'value' => "paid' OR 1=1 --"]]])->assertOk()->assertJsonPath('rows.0.sales', null);
        $query['sql'] = 'SELECT * FROM orders [[ WHERE status = {{status}}';
        $this->postJson('/analytics/api/reports/preview', ['query_definition' => $query])->assertUnprocessable();
    }

    public function test_existing_connection_test_reuses_secret_without_exposing_it(): void
    {
        Http::fake(['*' => Http::response(['data' => []])]);
        $connection = AnalyticsConnection::create(['owner_id' => $this->owner->id, 'name' => 'Remote', 'driver' => 'clickhouse', 'configuration' => ['host' => 'localhost', 'port' => 8123, 'database' => 'default', 'username' => 'reader', 'password' => 'private-secret']]);
        $payload = ['connection_id' => $connection->id, 'name' => 'Remote', 'driver' => 'clickhouse', 'configuration' => ['host' => 'localhost', 'port' => 8123, 'database' => 'default', 'username' => 'reader']];
        $this->postJson('/analytics/api/connections/test', $payload)->assertOk()->assertJsonMissing(['password' => 'private-secret']);
        Http::assertSent(fn ($request) => $request->hasHeader('Authorization', 'Basic '.base64_encode('reader:private-secret')));
        $this->actingAs(User::factory()->create())->postJson('/analytics/api/connections/test', $payload)->assertNotFound();
    }

    public function test_metadata_labels_visibility_survive_sync_and_preserve_raw_identifiers(): void
    {
        $route = '/analytics/api/connections/'.$this->connection->id.'/metadata';
        $this->putJson($route, ['table' => 'orders', 'field' => 'status', 'label' => 'وضعیت', 'description' => 'وضعیت سفارش', 'semantic_type' => 'category', 'hidden' => true])->assertOk();
        $this->putJson($route, ['table' => 'orders', 'label' => 'سفارش‌ها', 'description' => 'فروشگاه'])->assertOk();
        $connection = app(ConnectionManager::class)->sync($this->connection->refresh());
        $table = collect($connection->catalog)->firstWhere('key', 'orders');
        $this->assertSame('سفارش‌ها', $table['label']);
        $field = collect($table['fields'])->firstWhere('key', 'status');
        $this->assertSame('وضعیت', $field['label']);
        $this->assertSame('category', $field['semantic_type']);
        $this->assertSame('text', $field['type']);
        $response = $this->postJson('/analytics/api/reports/preview', ['query_definition' => $this->query(['mode' => 'rows'])])->assertOk();
        $this->assertNotContains('status', array_column($response->json('columns'), 'key'));
        $this->postJson('/analytics/api/reports/preview', ['query_definition' => $this->query(['mode' => 'rows', 'columns' => ['status']])])->assertOk()->assertJsonPath('columns.0.label', 'وضعیت');
        $this->putJson($route, ['table' => 'orders', 'field' => 'invalid', 'label' => 'Unknown'])->assertUnprocessable();
        $this->actingAs(User::factory()->create())->putJson($route, ['table' => 'orders', 'label' => 'Forbidden'])->assertForbidden();
    }

    public function test_notebook_stages_filter_and_summarize_previous_results_without_losing_bindings(): void
    {
        $stage = ['mode' => 'rows', 'metrics' => [], 'dimensions' => [], 'filters' => [['field' => 'sales', 'operator' => 'gte', 'value' => 400]], 'sort' => [], 'limit' => 100];
        $definition = $this->query(['joins' => [['field' => 'customer_id']], 'dimensions' => [['field' => 'customer_id.city']], 'filters' => [['field' => 'total', 'operator' => 'gte', 'value' => 100]], 'stages' => [$stage]]);
        $response = $this->postJson('/analytics/api/reports/preview', ['query_definition' => $definition])->assertOk();
        $this->assertSame('Shiraz', $response->json('rows')[0]['customer_id.city']);
        $response->assertJsonPath('rows.0.sales', 700);
        $this->assertStringContainsString(':p0', $response->json('sql'));
        $this->assertStringContainsString(':s0_p0', $response->json('sql'));
        $definition['stages'][] = ['mode' => 'aggregate', 'metrics' => [['key' => 'average', 'function' => 'avg', 'field' => 'sales']], 'dimensions' => [], 'filters' => [], 'sort' => [], 'limit' => 100];
        $this->postJson('/analytics/api/reports/preview', ['query_definition' => $definition])->assertOk()->assertJsonPath('rows.0.average', 700);
        $invalid = $definition;
        $invalid['stages'][0]['filters'][0]['field'] = 'total';
        $this->postJson('/analytics/api/reports/preview', ['query_definition' => $invalid])->assertUnprocessable();
        $invalid = $definition;
        $invalid['stages'][0]['stages'] = [];
        $this->postJson('/analytics/api/reports/preview', ['query_definition' => $invalid])->assertUnprocessable();
    }

    public function test_joining_and_summarizing_an_aggregate_stage_uses_only_previous_output_and_catalog_tables(): void
    {
        $stage = ['mode' => 'rows', 'metrics' => [], 'dimensions' => [], 'filters' => [['field' => 'customer.city', 'operator' => 'eq', 'value' => 'Shiraz']], 'sort' => [], 'limit' => 100,
            'joins' => [['source' => 'customers', 'alias' => 'customer', 'type' => 'inner', 'conditions' => [['left' => 'customer_id', 'operator' => 'eq', 'right' => 'id']]]],
            'columns' => ['customer_id', 'sales', 'customer.city', 'net'], 'expressions' => [['key' => 'net', 'label' => 'Net sales', 'expression' => '[sales] * 0.9']]];
        $query = $this->query(['dimensions' => [['field' => 'customer_id']], 'stages' => [$stage]]);
        $response = $this->postJson('/analytics/api/reports/preview', ['query_definition' => $query])->assertOk();
        $response->assertJsonCount(1, 'rows')->assertJsonPath('rows.0.sales', 700)->assertJsonPath('rows.0.customer_id', 2);
        $this->assertSame('Shiraz', $response->json('rows')[0]['customer.city']);
        $response->assertJsonPath('rows.0.net', 630)->assertJsonPath('query_definition.stages.0.expressions.0.type', 'number');
        $this->assertStringContainsString('INNER JOIN "customers"', $response->json('sql'));
        $this->assertSame('Customers → City', $response->json('query_definition.stages')[0]['field_labels']['customer.city']);
        $query['stages'][] = ['mode' => 'aggregate', 'metrics' => [['key' => 'average', 'function' => 'avg', 'field' => 'net']], 'dimensions' => [], 'filters' => [], 'sort' => [], 'limit' => 100];
        $this->postJson('/analytics/api/reports/preview', ['query_definition' => $query])->assertOk()->assertJsonPath('rows.0.average', 630);
        $invalid = $query;
        $invalid['stages'][0]['joins'][0]['conditions'][0]['left'] = 'total';
        $this->postJson('/analytics/api/reports/preview', ['query_definition' => $invalid])->assertUnprocessable();
        $invalid = $query;
        $invalid['stages'][0]['joins'][0]['source'] = 'analytics_stage';
        $this->postJson('/analytics/api/reports/preview', ['query_definition' => $invalid])->assertUnprocessable();
        $pdo = new PDO('sqlite:'.$this->path);
        $pdo->exec('CREATE TABLE analytics_stage (id INTEGER PRIMARY KEY, title TEXT); INSERT INTO analytics_stage VALUES (1, \'First customer\'), (2, \'Second customer\')');
        app(ConnectionManager::class)->sync($this->connection);
        $stage['joins'][0]['source'] = 'analytics_stage';
        $stage['filters'] = [];
        $stage['columns'] = ['sales', 'customer.title'];
        $query['stages'] = [$stage];
        $response = $this->postJson('/analytics/api/reports/preview', ['query_definition' => $query])->assertOk()->assertJsonCount(2, 'rows');
        $this->assertSame('First customer', $response->json('rows')[0]['customer.title']);
    }

    public function test_dashboard_stage_bindings_options_and_drill_through_keep_the_query_pipeline(): void
    {
        $stage = ['mode' => 'rows', 'metrics' => [], 'dimensions' => [], 'filters' => [], 'sort' => [], 'limit' => 100,
            'joins' => [['source' => 'customers', 'alias' => 'customer', 'type' => 'inner', 'conditions' => [['left' => 'customer_id', 'operator' => 'eq', 'right' => 'id']]]],
            'columns' => ['sales', 'customer.city', 'net'], 'expressions' => [['key' => 'net', 'label' => 'Net sales', 'expression' => '[sales] * 0.9']]];
        $summary = ['mode' => 'aggregate', 'metrics' => [['key' => 'net_sales', 'function' => 'sum', 'field' => 'net']], 'dimensions' => [['field' => 'customer.city']], 'filters' => [], 'sort' => [], 'limit' => 100];
        $report = $this->report(['dimensions' => [['field' => 'customer_id']], 'stages' => [$stage, $summary]]);
        $dashboard = $this->dashboard($report);
        $url = '/analytics/api/dashboards/'.$dashboard['id'];
        $dashboard['filters'] = [
            ['key' => 'city', 'label' => 'City', 'type' => 'text', 'required' => false, 'default_value' => null, 'settings' => [], 'bindings' => [['widget_key' => 'card', 'target' => 'stage:0:customer.city', 'operator' => 'eq']]],
            ['key' => 'minimum', 'label' => 'Minimum', 'type' => 'number', 'required' => false, 'default_value' => null, 'settings' => [], 'bindings' => [['widget_key' => 'card', 'target' => 'stage:0:net', 'operator' => 'gte']]],
        ];
        $saved = $this->putJson($url, $dashboard)->assertOk()->json();
        $shown = $this->getJson($url)->assertOk();
        $fields = collect($shown->json('reports.0.available_fields'))->keyBy('key');
        $this->assertSame('text', $fields['stage:0:customer.city']['type']);
        $this->assertTrue($fields['stage:1:customer.city']['is_dimension']);
        $this->assertArrayNotHasKey('sql', $fields['stage:0:customer.city']);
        $this->postJson($url.'/widgets/card/query', ['parameters' => ['city' => 'Tehran', 'minimum' => 200]])->assertOk()->assertJsonCount(1, 'rows')->assertJsonPath('rows.0.net_sales', 270);
        $this->postJson($url.'/filters/city/options', ['parameters' => ['minimum' => 500]])->assertOk()->assertJsonPath('values', ['Shiraz']);
        $this->postJson($url.'/widgets/card/query', ['details' => true, 'parameters' => ['_clicked' => ['customer.city' => 'Tehran']]])->assertOk()->assertJsonCount(1, 'rows')->assertJsonPath('rows.0.net_sales', 270);
        $saved['filters'][0]['bindings'][0]['target'] = 'stage:5:customer.city';
        $this->putJson($url, $saved)->assertUnprocessable();
    }

    public function test_dashboard_time_grain_can_target_a_later_summary_stage(): void
    {
        $stage = ['mode' => 'aggregate', 'metrics' => [['key' => 'total', 'function' => 'sum', 'field' => 'sales']], 'dimensions' => [['field' => 'ordered_at', 'grain' => 'month']], 'filters' => [], 'sort' => [], 'limit' => 100];
        $dashboard = $this->dashboard($this->report(['dimensions' => [['field' => 'ordered_at', 'grain' => 'month']], 'stages' => [$stage]]));
        $url = '/analytics/api/dashboards/'.$dashboard['id'];
        $dashboard['filters'] = [['key' => 'grain', 'label' => 'Grain', 'type' => 'time_grain', 'required' => false, 'default_value' => 'month', 'settings' => [], 'bindings' => [['widget_key' => 'card', 'target' => 'stage:0:ordered_at', 'operator' => 'grain']]]];
        $this->putJson($url, $dashboard)->assertOk();
        $this->postJson($url.'/widgets/card/query', ['parameters' => ['grain' => 'month']])->assertOk()->assertJsonCount(2, 'rows');
        $this->postJson($url.'/widgets/card/query', ['parameters' => ['grain' => 'quarter']])->assertOk()->assertJsonCount(1, 'rows')->assertJsonPath('rows.0.ordered_at', '2026-01-01')->assertJsonPath('rows.0.total', 1000);
    }

    public function test_library_stays_accessible_when_a_saved_report_needs_schema_sync(): void
    {
        $report = $this->report();
        $this->connection->update(['catalog' => null, 'synced_at' => null]);
        $this->getJson('/analytics/api/library')->assertOk()->assertJsonPath('reports.0.id', $report->id)->assertJsonPath('reports.0.available_fields', []);
        $this->postJson('/analytics/api/connections/'.$this->connection->id.'/sync')->assertOk();
        $this->assertNotEmpty($this->getJson('/analytics/api/library')->assertOk()->json('reports.0.available_fields'));
    }

    public function test_intermediate_stage_limit_is_only_applied_when_explicit(): void
    {
        $stage = ['mode' => 'aggregate', 'metrics' => [['key' => 'total', 'function' => 'sum', 'field' => 'total']], 'dimensions' => [], 'filters' => [], 'sort' => [], 'limit' => 100];
        $query = $this->query(['mode' => 'rows', 'limit' => 1, 'columns' => ['total'], 'stages' => [$stage]]);
        $this->postJson('/analytics/api/reports/preview', ['query_definition' => $query])->assertOk()->assertJsonPath('rows.0.total', 1000);
        $query['limit_explicit'] = true;
        $this->postJson('/analytics/api/reports/preview', ['query_definition' => $query])->assertOk()->assertJsonPath('rows.0.total', 100);
    }

    public function test_connection_configuration_change_invalidates_cached_results_with_same_timestamp(): void
    {
        $runner = app(ReportRunner::class);
        $first = $runner->run($this->query(), $this->owner->id);
        $this->assertSame(1000.0, $first['rows'][0]['sales']);
        $this->assertTrue($runner->run($this->query(), $this->owner->id)['meta']['cached']);
        $otherPath = $this->path.'.other.sqlite';
        copy($this->path, $otherPath);
        try {
            $pdo = new PDO('sqlite:'.$otherPath);
            $pdo->exec('UPDATE orders SET total=7');
            $pdo = null;
            $updatedAt = $this->connection->updated_at->toJSON();
            $this->connection->timestamps = false;
            $this->connection->update(['configuration' => ['path' => $otherPath]]);
            $this->connection->timestamps = true;
            $this->assertSame($updatedAt, $this->connection->refresh()->updated_at->toJSON());
            $second = $runner->run($this->query(), $this->owner->id);
            $this->assertFalse($second['meta']['cached']);
            $this->assertSame(28.0, $second['rows'][0]['sales']);
        } finally {
            unlink($otherPath);
        }
    }

    public function test_explicit_row_limit_is_exact_removable_and_separate_from_preview_constraints(): void
    {
        config(['analytics.preview_row_limit' => 2]);
        $query = $this->query(['mode' => 'rows', 'columns' => ['id', 'total'], 'sort' => [['key' => 'id', 'direction' => 'asc']], 'limit' => 2, 'limit_explicit' => true]);
        $result = $this->postJson('/analytics/api/reports/preview', ['query_definition' => $query])->assertOk();
        $result->assertJsonCount(2, 'rows')->assertJsonPath('meta.query_limit', 2)->assertJsonPath('meta.preview_limit', 2)->assertJsonPath('meta.truncated', false);
        $this->assertStringEndsWith(' LIMIT 2', $result->json('sql'));
        $query['limit'] = 3000;
        $result = $this->postJson('/analytics/api/reports/preview', ['query_definition' => $query])->assertOk();
        $result->assertJsonCount(2, 'rows')->assertJsonPath('meta.query_limit', 3000)->assertJsonPath('meta.limit', 2)->assertJsonPath('meta.truncated', true);
        $this->assertStringEndsWith(' LIMIT 3', $result->json('sql'));
        $query['limit'] = null;
        $query['limit_explicit'] = false;
        config(['analytics.preview_row_limit' => 2000]);
        $this->postJson('/analytics/api/reports/preview', ['query_definition' => $query])->assertOk()->assertJsonCount(4, 'rows')->assertJsonPath('meta.query_limit', null)->assertJsonPath('meta.preview_limit', 2000)->assertJsonPath('meta.truncated', false);
        $query['limit_explicit'] = true;
        $this->postJson('/analytics/api/reports/preview', ['query_definition' => $query])->assertUnprocessable();
        foreach ([0, -1, 2.5, '1 OR 1=1'] as $invalid) {
            $query['limit'] = $invalid;
            $this->postJson('/analytics/api/reports/preview', ['query_definition' => $query])->assertUnprocessable();
        }
    }

    public function test_sort_supports_multiple_prioritized_source_columns_and_rejects_duplicates(): void
    {
        $query = $this->query(['mode' => 'rows', 'columns' => ['id'], 'sort' => [['key' => 'status', 'direction' => 'asc'], ['key' => 'customer_id', 'direction' => 'desc'], ['key' => 'total', 'direction' => 'desc']], 'limit' => null, 'limit_explicit' => false]);
        $result = $this->postJson('/analytics/api/reports/preview', ['query_definition' => $query])->assertOk();
        $this->assertSame([4, 2, 1, 3], array_column($result->json('rows'), 'id'));
        $this->assertSame(['id'], array_column($result->json('columns'), 'key'));
        $this->assertStringContainsString('ORDER BY "t0"."status" ASC, "t0"."customer_id" DESC, "t0"."total" DESC', $result->json('sql'));
        $query['joins'] = [['field' => 'customer_id']];
        $query['sort'] = [['key' => 'customer_id.city', 'direction' => 'asc'], ['key' => 'total', 'direction' => 'desc'], ['key' => 'id', 'direction' => 'asc']];
        $result = $this->postJson('/analytics/api/reports/preview', ['query_definition' => $query])->assertOk();
        $this->assertSame([4, 3, 2, 1], array_column($result->json('rows'), 'id'));
        $query['sort'][] = ['key' => 'total', 'direction' => 'asc'];
        $this->postJson('/analytics/api/reports/preview', ['query_definition' => $query])->assertUnprocessable();
        $query['sort'] = [['key' => 'id; DROP TABLE orders', 'direction' => 'asc']];
        $this->postJson('/analytics/api/reports/preview', ['query_definition' => $query])->assertUnprocessable();
        $query['sort'] = [['key' => 'id', 'direction' => 'sideways']];
        $this->postJson('/analytics/api/reports/preview', ['query_definition' => $query])->assertUnprocessable();
    }

    public function test_intermediate_sorts_and_explicit_limits_apply_before_following_aggregation(): void
    {
        config(['analytics.preview_row_limit' => 1, 'analytics.preview_aggregate_limit' => 10]);
        $stage = ['mode' => 'rows', 'metrics' => [], 'dimensions' => [], 'filters' => [], 'sort' => [['key' => 'total', 'direction' => 'asc'], ['key' => 'id', 'direction' => 'asc']], 'limit' => 1, 'limit_explicit' => true];
        $summary = ['mode' => 'aggregate', 'metrics' => [['key' => 'total_sales', 'function' => 'sum', 'field' => 'total']], 'dimensions' => [], 'filters' => [], 'sort' => [], 'limit' => null, 'limit_explicit' => false];
        $query = $this->query(['mode' => 'rows', 'columns' => ['id', 'total'], 'sort' => [['key' => 'total', 'direction' => 'desc']], 'limit' => 2, 'limit_explicit' => true, 'stages' => [$stage, $summary]]);
        $result = $this->postJson('/analytics/api/reports/preview', ['query_definition' => $query])->assertOk()->assertJsonPath('rows.0.total_sales', 300)->assertJsonPath('meta.query_limit', null)->assertJsonPath('meta.preview_limit', 10);
        $this->assertStringContainsString('ORDER BY "t0"."total" DESC LIMIT 2', $result->json('sql'));
        $this->assertStringContainsString('ORDER BY "t0"."total" ASC, "t0"."id" ASC LIMIT 1', $result->json('sql'));
        $query['limit_explicit'] = false;
        $query['limit'] = null;
        $query['stages'][0]['limit_explicit'] = false;
        $query['stages'][0]['limit'] = null;
        $result = $this->postJson('/analytics/api/reports/preview', ['query_definition' => $query])->assertOk()->assertJsonPath('rows.0.total_sales', 1000);
        $this->assertSame(1, substr_count($result->json('sql'), ' LIMIT '));
    }

    public function test_native_and_aggregate_response_caps_preserve_query_limit_metadata_and_cache(): void
    {
        config(['analytics.preview_row_limit' => 2, 'analytics.preview_aggregate_limit' => 3]);
        $runner = app(ReportRunner::class);
        $query = $this->query(['mode' => 'native', 'sql' => 'SELECT id, total FROM orders ORDER BY id', 'parameters' => [], 'limit' => 50000, 'limit_explicit' => true]);
        $result = $runner->run($query, $this->owner->id);
        $this->assertSame(50000, $result['meta']['query_limit']);
        $this->assertSame(2, $result['meta']['preview_limit']);
        $this->assertTrue($result['meta']['truncated']);
        $this->assertStringEndsWith(' LIMIT 3', $result['sql']);
        $query['limit'] = 60000;
        $result = $runner->run($query, $this->owner->id);
        $this->assertFalse($result['meta']['cached']);
        $this->assertSame(60000, $result['meta']['query_limit']);
        $this->assertTrue($runner->run($query, $this->owner->id)['meta']['cached']);
        $query = $this->query(['dimensions' => [['field' => 'id']], 'limit' => null, 'limit_explicit' => false]);
        $this->postJson('/analytics/api/reports/preview', ['query_definition' => $query])->assertOk()->assertJsonCount(3, 'rows')->assertJsonPath('meta.preview_limit', 3)->assertJsonPath('meta.query_limit', null)->assertJsonPath('meta.truncated', true);
    }

    public function test_drill_through_null_category_selects_null_source_rows(): void
    {
        $dashboard = $this->dashboard($this->report(['dimensions' => [['field' => 'status']]]));
        $result = $this->postJson('/analytics/api/dashboards/'.$dashboard['id'].'/widgets/card/query', ['parameters' => ['_clicked' => ['status' => null]], 'details' => true])->assertOk();
        $this->assertCount(1, $result->json('rows'));
        $result->assertJsonPath('rows.0.id', 4)->assertJsonPath('rows.0.status', null);
    }

    private function dashboard(?AnalyticsReport $report = null): array
    {
        $report ??= $this->report();
        $dashboard = $this->postJson('/analytics/api/dashboards', ['name' => 'Board'])->assertOk()->json();
        $dashboard['widgets'] = [['key' => 'card', 'report_id' => $report->id, 'type' => 'report', 'tab_key' => 'main', 'x' => 0, 'y' => 0, 'w' => 12, 'h' => 8, 'settings' => [], 'click_behavior' => ['type' => 'details']]];
        $dashboard['filters'] = [['key' => 'period', 'label' => 'Period', 'type' => 'date', 'required' => false, 'default_value' => null, 'settings' => [], 'bindings' => [['widget_key' => 'card', 'target' => 'ordered_at', 'operator' => 'between']]]];

        return $this->putJson('/analytics/api/dashboards/'.$dashboard['id'], $dashboard)->assertOk()->json();
    }

    public function test_schema_contains_views_keys_types_and_relations(): void
    {
        $tables = collect($this->connection->catalog)->keyBy('key');
        $this->assertSame('view', $tables['order_view']['kind']);
        $fields = collect($tables['orders']['fields'])->keyBy('key');
        $this->assertSame(['table' => 'customers', 'field' => 'id'], $fields['customer_id']['relation']);
        $this->assertSame('date', $fields['ordered_at']['type']);
        $this->assertTrue($fields['id']['primary']);
        $this->assertFalse($fields['id']['nullable']);
        $this->postJson('/analytics/api/connections/test', ['name' => 'Test', 'driver' => 'sqlite', 'configuration' => ['path' => $this->path]])->assertOk()->assertJsonPath('table_count', 3);
    }

    public function test_connection_secrets_are_encrypted_and_not_returned_and_servers_are_optional(): void
    {
        $response = $this->postJson('/analytics/api/connections', ['name' => 'Offline PostgreSQL', 'driver' => 'pgsql', 'configuration' => ['host' => 'localhost', 'port' => 5432, 'database' => 'analytics', 'username' => 'reader', 'password' => 'super-secret']])->assertOk();
        $id = $response->json('id');
        $response->assertJsonMissing(['password' => 'super-secret'])->assertJsonPath('has_password', true);
        $this->assertStringNotContainsString('super-secret', DB::table('analytics_connections')->where('id', $id)->value('configuration'));
        $this->putJson('/analytics/api/connections/'.$id, ['name' => 'Changed', 'driver' => 'pgsql', 'configuration' => ['host' => 'localhost', 'port' => 5432, 'database' => 'analytics', 'username' => 'reader']])->assertOk();
        $this->assertSame('super-secret', AnalyticsConnection::find($id)->configuration['password']);
        $this->postJson('/analytics/api/connections', ['name' => 'Offline ClickHouse', 'driver' => 'clickhouse', 'configuration' => ['host' => 'localhost', 'port' => 8123, 'database' => 'default', 'username' => 'default']])->assertOk();
        $this->getJson('/analytics/api/library')->assertOk()->assertJsonMissing(['password' => 'super-secret']);
    }

    public function test_aggregations_date_ranges_injections_and_joined_dimensions(): void
    {
        $result = $this->postJson('/analytics/api/reports/preview', ['query_definition' => $this->query(['filters' => [['field' => 'ordered_at', 'operator' => 'between', 'value' => ['2026-01-01', '2026-01-31']]]])])->assertOk();
        $result->assertJsonPath('rows.0.sales', 300);
        $joined = $this->postJson('/analytics/api/reports/preview', ['query_definition' => $this->query(['joins' => [['field' => 'customer_id']], 'dimensions' => [['field' => 'customer_id.city']], 'sort' => [['key' => 'sales', 'direction' => 'desc']]])])->assertOk();
        $this->assertSame('Shiraz', $joined->json()['rows'][0]['customer_id.city']);
        $joined->assertJsonPath('rows.0.sales', 700);
        $this->postJson('/analytics/api/reports/preview', ['query_definition' => $this->query(['filters' => [['field' => 'status', 'operator' => 'eq', 'value' => "paid' OR 1=1 --"]]])])->assertOk()->assertJsonPath('rows.0.sales', null);
        $this->postJson('/analytics/api/reports/preview', ['query_definition' => $this->query(['filters' => [['field' => 'total', 'operator' => 'gte', 'value' => '1 OR 1=1']]])])->assertUnprocessable();
        $this->postJson('/analytics/api/reports/preview', ['query_definition' => $this->query(['source' => 'orders; DROP TABLE orders'])])->assertUnprocessable();
    }

    public function test_raw_columns_limits_null_filters_and_cache(): void
    {
        $runner = app(ReportRunner::class);
        $query = $this->query(['mode' => 'rows', 'columns' => ['id', 'total'], 'limit' => 2, 'sort' => [['key' => 'id', 'direction' => 'asc']]]);
        $result = $runner->run($query, $this->owner->id);
        $this->assertTrue($result['meta']['truncated']);
        $this->assertCount(2, $result['rows']);
        $this->assertTrue($runner->run($query, $this->owner->id)['meta']['cached']);
        $this->assertFalse($runner->run($query, $this->owner->id, [], true)['meta']['cached']);
        $this->postJson('/analytics/api/reports/preview', ['query_definition' => $this->query(['filters' => [['field' => 'status', 'operator' => 'is_null']]])])->assertOk()->assertJsonPath('rows.0.sales', 400);
    }

    public function test_native_parameters_are_bound_and_writes_are_blocked(): void
    {
        $query = $this->query(['mode' => 'native', 'sql' => 'WITH selected AS (SELECT * FROM orders WHERE status={{status}}) SELECT SUM(total) AS sales FROM selected', 'parameters' => [['key' => 'status', 'type' => 'text', 'default' => 'paid']]]);
        $this->postJson('/analytics/api/reports/preview', ['query_definition' => $query])->assertOk()->assertJsonPath('rows.0.sales', 300);
        $query['parameters'][0]['default'] = "paid' OR 1=1 --";
        $this->postJson('/analytics/api/reports/preview', ['query_definition' => $query])->assertOk()->assertJsonPath('rows.0.sales', null);
        foreach (['DELETE FROM orders', 'SELECT * FROM orders; DROP TABLE orders', "SELECT * FROM file('/etc/passwd')", 'WITH gone AS (DELETE FROM orders RETURNING *) SELECT * FROM gone'] as $sql) {
            $this->postJson('/analytics/api/reports/preview', ['query_definition' => $this->query(['mode' => 'native', 'sql' => $sql])])->assertUnprocessable();
        }
    }

    public function test_sqlite_driver_itself_rejects_writes(): void
    {
        $this->expectException(\PDOException::class);
        (new SqliteDriver(['path' => $this->path]))->select('DELETE FROM orders');
    }

    public function test_dashboard_filters_required_values_and_revision_restore(): void
    {
        $dashboard = $this->dashboard();
        $url = '/analytics/api/dashboards/'.$dashboard['id'];
        $this->postJson($url.'/widgets/card/query', ['parameters' => ['period' => ['2026-01-01', '2026-01-31']]])->assertOk()->assertJsonPath('rows.0.sales', 300);
        $dashboard['filters'][0]['required'] = true;
        $updated = $this->putJson($url, $dashboard)->assertOk()->json();
        $this->postJson($url.'/widgets/card/query', [])->assertOk()->assertJsonPath('meta.waiting_for_filter', 'Period');
        $this->putJson($url, $dashboard)->assertConflict();
        $revision = $this->getJson($url.'/revisions')->assertOk()->json()[1];
        $this->postJson($url.'/revisions/'.$revision['id'].'/restore', ['version' => $updated['version']])->assertOk()->assertJsonPath('filters.0.required', false);
    }

    public function test_drill_through_only_uses_saved_dimensions(): void
    {
        $dashboard = $this->dashboard($this->report(['dimensions' => [['field' => 'ordered_at', 'grain' => 'month']]]));
        $this->postJson('/analytics/api/dashboards/'.$dashboard['id'].'/widgets/card/query', ['details' => true, 'parameters' => ['_clicked' => ['ordered_at' => '2026-01-01', 'status' => 'pending']]])->assertOk()->assertJsonCount(2, 'rows')->assertJsonPath('rows.1.total', 200);
        $this->postJson('/analytics/api/dashboards/'.$dashboard['id'].'/widgets/card/query', ['details' => true, 'parameters' => ['_clicked' => ['ordered_at' => 'bad-date']]])->assertUnprocessable();
    }

    public function test_ownership_sharing_permissions_and_copy(): void
    {
        $dashboard = $this->dashboard();
        $report = $this->report();
        $viewer = User::factory()->create();
        $url = '/analytics/api/dashboards/'.$dashboard['id'];
        $this->actingAs($viewer)->getJson($url)->assertForbidden();
        $this->postJson('/analytics/api/reports/preview', ['query_definition' => $this->query()])->assertNotFound();
        $this->postJson('/analytics/api/reports/'.$report->id.'/query', [])->assertForbidden();
        $this->postJson('/analytics/api/connections/'.$this->connection->id.'/sync', [])->assertForbidden();
        $this->actingAs($this->owner)->postJson($url.'/share', ['email' => $viewer->email, 'role' => 'viewer'])->assertOk();
        $this->actingAs($viewer)->getJson($url)->assertOk()->assertJsonPath('can_edit', false);
        $this->postJson($url.'/widgets/card/query', [])->assertOk()->assertJsonPath('rows.0.sales', 1000);
        $this->putJson($url, $dashboard)->assertForbidden();
        $this->postJson($url.'/share', ['email' => $this->owner->email, 'role' => 'editor'])->assertForbidden();
        $copy = $this->actingAs($this->owner)->postJson($url.'/copy', ['copy_reports' => true])->assertOk()->json();
        $this->assertNotSame($dashboard['id'], $copy['id']);
        $this->assertNotSame($dashboard['widgets'][0]['report_id'], $copy['widgets'][0]['report_id']);
        $this->assertSame($dashboard['filters'][0]['bindings'], $copy['filters'][0]['bindings']);
    }

    public function test_save_validates_geometry_bindings_cycles_and_report_version(): void
    {
        $dashboard = $this->dashboard();
        $url = '/analytics/api/dashboards/'.$dashboard['id'];
        $bad = $dashboard;
        $bad['widgets'][0]['x'] = 20;
        $this->putJson($url, $bad)->assertUnprocessable();
        $bad = $dashboard;
        $bad['filters'][0]['bindings'][0]['target'] = 'total';
        $this->putJson($url, $bad)->assertUnprocessable();
        $bad = $dashboard;
        $bad['filters'][] = [...$bad['filters'][0], 'key' => 'child'];
        $bad['filters'][0]['settings'] = ['parent_key' => 'child'];
        $bad['filters'][1]['settings'] = ['parent_key' => 'period'];
        $this->putJson($url, $bad)->assertUnprocessable();
        $report = $this->report();
        $payload = $report->toArray();
        $payload['name'] = 'Changed';
        $this->putJson('/analytics/api/reports/'.$report->id, $payload)->assertOk()->assertJsonPath('version', 2);
        $this->putJson('/analytics/api/reports/'.$report->id, $payload)->assertConflict();
        $this->deleteJson('/analytics/api/connections/'.$this->connection->id)->assertUnprocessable();
    }

    public function test_postgres_and_clickhouse_compile_without_running_servers(): void
    {
        $runner = app(ReportRunner::class);
        $query = $this->query(['dimensions' => [['field' => 'ordered_at', 'grain' => 'month']], 'filters' => [['field' => 'total', 'operator' => 'gte', 'value' => 200]]]);
        $pg = clone $this->connection;
        $pg->driver = 'pgsql';
        $compiled = $runner->compile($query, $pg);
        $this->assertStringContainsString("date_trunc('month'", $compiled['sql']);
        $this->assertSame(200, $compiled['bindings']['p0']);
        $ch = clone $this->connection;
        $ch->driver = 'clickhouse';
        $this->assertStringContainsString('toStartOfMonth', $runner->compile($query, $ch)['sql']);
        Http::preventStrayRequests();
        Http::fake(['http://soar_db:8123/*' => Http::response(['data' => [['sales' => '1000']]])]);
        $driver = new ClickHouseDriver(['host' => 'soar_db', 'port' => 8123, 'database' => 'default', 'username' => 'default', 'password' => 'secret']);
        $this->assertSame([['sales' => '1000']], $driver->select('SELECT SUM(total) AS sales FROM orders WHERE total >= :p0', ['p0' => 200]));
        Http::assertSent(fn ($request) => parse_url($request->url(), PHP_URL_HOST) === 'soar_db' && str_contains($request->body(), '{p0:Int64}') && str_contains($request->url(), 'readonly=2') && str_contains($request->url(), 'param_p0=200'));
    }

    public function test_clickhouse_parameters_skip_quoted_text_identifiers_comments_and_casts(): void
    {
        Http::preventStrayRequests();
        Http::fake(['*' => Http::response(['data' => [['value' => 42]]])]);
        $driver = new ClickHouseDriver(['host' => 'localhost', 'port' => 8123, 'database' => 'default']);
        $sql = <<<'SQL'
SELECT ':literal', 'a\'b:escaped', 'a''b:doubled', "column:quoted", `column:tick`, :amount::Float64 -- :comment
/* :block */ WHERE city = :city OR city = :city
SQL;
        $this->assertSame([['value' => 42]], $driver->select($sql, ['amount' => 42, 'city' => 'Shiraz']));
        Http::assertSent(function ($request) use ($sql) {
            $expected = str_replace([':amount::Float64', '= :city'], ['{amount:Int64}::Float64', '= {city:String}'], $sql);

            return $request->body() === $expected && str_contains($request->url(), 'param_amount=42') && str_contains($request->url(), 'param_city=Shiraz');
        });
        $this->expectException(\RuntimeException::class);
        $driver->select('SELECT :missing');
    }

    public function test_draft_preview_uses_new_bindings_without_saving_and_checks_editor_access(): void
    {
        $dashboard = $this->dashboard();
        $url = '/analytics/api/dashboards/'.$dashboard['id'];
        $dashboard['filters'][0]['default_value'] = ['2026-02-01', '2026-02-28'];
        $this->postJson($url.'/widgets/card/preview', ['dashboard' => $dashboard])->assertOk()->assertJsonPath('rows.0.sales', 700);
        $this->getJson($url)->assertOk()->assertJsonPath('filters.0.default_value', null)->assertJsonPath('version', 2);
        $editor = User::factory()->create();
        $this->postJson($url.'/share', ['email' => $editor->email, 'role' => 'editor'])->assertOk();
        $this->actingAs($editor)->postJson($url.'/widgets/card/preview', ['dashboard' => $dashboard])->assertOk()->assertJsonPath('rows.0.sales', 700);
        $this->getJson($url)->assertOk()->assertJsonPath('reports.0.available_fields.0.key', 'id');
        $this->actingAs($this->owner)->postJson($url.'/share', ['email' => $editor->email, 'role' => 'viewer'])->assertOk();
        $this->actingAs($editor)->postJson($url.'/widgets/card/preview', ['dashboard' => $dashboard])->assertForbidden();
    }

    public function test_filter_suggestions_follow_other_bound_filters(): void
    {
        $dashboard = $this->dashboard($this->report(['joins' => [['field' => 'customer_id']]]));
        $url = '/analytics/api/dashboards/'.$dashboard['id'];
        $dashboard['filters'][] = ['key' => 'city', 'label' => 'City', 'type' => 'text', 'required' => false, 'default_value' => null, 'settings' => ['parent_key' => 'period'], 'bindings' => [['widget_key' => 'card', 'target' => 'customer_id.city', 'operator' => 'eq']]];
        $this->putJson($url, $dashboard)->assertOk();
        $this->postJson($url.'/filters/city/options', [])->assertOk()->assertJsonPath('values', [])->assertJsonPath('waiting_for_filter', 'Period');
        $this->postJson($url.'/filters/city/options', ['parameters' => ['period' => ['2026-01-01', '2026-01-31']]])->assertOk()->assertJsonPath('values', ['Tehran']);
        $this->postJson($url.'/filters/not-a-filter/options', [])->assertNotFound();
    }

    public function test_time_grain_and_native_parameter_dashboard_bindings(): void
    {
        $dashboard = $this->dashboard($this->report(['dimensions' => [['field' => 'ordered_at', 'grain' => 'month']]]));
        $url = '/analytics/api/dashboards/'.$dashboard['id'];
        $dashboard['filters'][] = ['key' => 'grain', 'label' => 'Grain', 'type' => 'time_grain', 'required' => false, 'default_value' => 'year', 'settings' => [], 'bindings' => [['widget_key' => 'card', 'target' => 'ordered_at', 'operator' => 'grain']]];
        $this->putJson($url, $dashboard)->assertOk();
        $this->postJson($url.'/widgets/card/query', [])->assertOk()->assertJsonCount(1, 'rows')->assertJsonPath('rows.0.sales', 1000);
        $this->postJson($url.'/widgets/card/query', ['parameters' => ['grain' => 'day']])->assertOk()->assertJsonCount(4, 'rows');
        $report = $this->report(['mode' => 'native', 'sql' => 'SELECT SUM(total) AS sales FROM orders WHERE status={{status}}', 'parameters' => [['key' => 'status', 'type' => 'text', 'default' => 'paid']]]);
        $dashboard = $this->getJson($url)->json();
        $dashboard['widgets'][0]['report_id'] = $report->id;
        $dashboard['filters'] = [['key' => 'status', 'label' => 'Status', 'type' => 'text', 'required' => false, 'default_value' => 'pending', 'settings' => [], 'bindings' => [['widget_key' => 'card', 'target' => 'status', 'operator' => 'eq']]]];
        $this->putJson($url, $dashboard)->assertOk();
        $this->postJson($url.'/widgets/card/query', [])->assertOk()->assertJsonPath('rows.0.sales', 300);
    }

    public function test_connection_errors_do_not_expose_credentials_or_remote_details(): void
    {
        Http::preventStrayRequests();
        Http::fake(['*' => Http::response('Remote failure includes secret', 500)]);
        $this->postJson('/analytics/api/connections/test', ['name' => 'Broken', 'driver' => 'clickhouse', 'configuration' => ['host' => 'localhost', 'port' => 8123, 'database' => 'default', 'username' => 'default', 'password' => 'super-secret']])->assertUnprocessable()->assertDontSee('super-secret')->assertDontSee('Remote failure');
        $this->postJson('/analytics/api/connections', ['name' => 'Invalid', 'driver' => 'sqlite', 'test_first' => true, 'configuration' => ['path' => $this->path.'.missing']])->assertUnprocessable();
        $this->assertDatabaseMissing('analytics_connections', ['name' => 'Invalid']);
    }

    public function test_internal_sqlite_database_cannot_be_added_as_an_analytics_source(): void
    {
        config(['database.connections.sqlite.database' => $this->path]);
        $this->expectException(ValidationException::class);
        app(ConnectionManager::class)->driver($this->connection);
    }

    public function test_composite_foreign_keys_are_identified_and_do_not_generate_partial_joins(): void
    {
        $pdo = new PDO('sqlite:'.$this->path);
        $pdo->exec('CREATE TABLE parent (a INTEGER, b INTEGER, PRIMARY KEY(a,b)); CREATE TABLE child (a INTEGER, b INTEGER, FOREIGN KEY(a,b) REFERENCES parent(a,b));');
        $pdo = null;
        app(ConnectionManager::class)->sync($this->connection);
        $table = collect($this->connection->catalog)->firstWhere('key', 'child');
        $this->assertTrue($table['fields'][0]['relation']['composite']);
        $this->postJson('/analytics/api/reports/preview', ['query_definition' => $this->query(['source' => 'child', 'metrics' => [['key' => 'count', 'function' => 'count']], 'joins' => [['field' => 'a']]])])->assertUnprocessable();
    }

    public function test_minimum_and_maximum_keep_the_source_column_type(): void
    {
        $this->postJson('/analytics/api/reports/preview', ['query_definition' => $this->query(['metrics' => [['key' => 'first_order', 'function' => 'min', 'field' => 'ordered_at'], ['key' => 'last_status', 'function' => 'max', 'field' => 'status']]])])->assertOk()->assertJsonPath('columns.0.type', 'date')->assertJsonPath('columns.1.type', 'text')->assertJsonPath('rows.0.first_order', '2026-01-01 10:00:00');
    }
}
