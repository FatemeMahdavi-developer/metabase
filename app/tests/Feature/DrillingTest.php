<?php

namespace Tests\Feature;

use App\Domain\Analytics\DrillService;
use App\Domain\Analytics\Drivers\ConnectionManager;
use App\Domain\Analytics\Drivers\DatabaseDriver;
use App\Domain\Analytics\ReportRunner;
use App\Models\AnalyticsConnection;
use App\Models\AnalyticsReport;
use App\Models\User;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Cache;
use Illuminate\Validation\ValidationException;
use PDO;
use Symfony\Component\HttpKernel\Exception\HttpException;
use Tests\TestCase;

class DrillingTest extends TestCase
{
    use RefreshDatabase;

    private User $owner;

    private AnalyticsConnection $connection;

    private string $path;

    protected function setUp(): void
    {
        parent::setUp();
        $this->owner = User::factory()->create();
        $this->path = storage_path('framework/drilling-'.bin2hex(random_bytes(6)).'.sqlite');
        $pdo = new PDO('sqlite:'.$this->path);
        $pdo->exec("CREATE TABLE customers (id INTEGER PRIMARY KEY, city TEXT NOT NULL);
            CREATE TABLE orders (id INTEGER PRIMARY KEY, customer_id INTEGER REFERENCES customers(id), ordered_at TIMESTAMP NOT NULL, total DECIMAL NOT NULL, status TEXT);
            INSERT INTO customers VALUES (1,'Tehran'),(2,'Shiraz');
            INSERT INTO orders VALUES (1,1,'2026-01-01 10:00:00',100,NULL),(2,1,'2026-01-20 12:00:00',200,''),(3,1,'2026-01-25 16:00:00',300,'Paid'),(4,2,'2026-01-31 23:59:59',400,'paid'),(5,2,'2026-02-01 12:00:00',500,'pending'),(6,2,'2026-02-10 12:00:00',600,'paid');");
        $pdo = null;
        $this->connection = AnalyticsConnection::create(['owner_id' => $this->owner->id, 'name' => 'Drill fixture', 'driver' => 'sqlite', 'configuration' => ['path' => $this->path]]);
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
        return array_replace(['connection_id' => $this->connection->id, 'source' => 'orders', 'mode' => 'rows', 'metrics' => [], 'dimensions' => [], 'filters' => [], 'sort' => [['key' => 'id', 'direction' => 'asc']], 'joins' => [], 'expressions' => [], 'limit' => null, 'limit_explicit' => false], $changes);
    }

    private function queryResult(array $query): array
    {
        return app(ReportRunner::class)->run($query, $this->owner->id);
    }

    private function apply(array $query, string $column, ?int $index, string $action, array $extra = [], array $input = [], array $context = []): array
    {
        return app(DrillService::class)->apply($query, $this->owner->id, ['column_key' => $column, 'row_index' => $index, ...$context], $action, $extra, $input);
    }

    private function ids(array $response): array
    {
        return array_column($response['result']['rows'], 'id');
    }

    public function test_cell_filters_use_server_values_handle_text_null_and_leave_saved_query_unchanged(): void
    {
        $query = $this->query();
        $report = AnalyticsReport::create(['owner_id' => $this->owner->id, 'name' => 'Original', 'query_definition' => $query, 'display' => 'table', 'visualization_settings' => []]);
        $service = app(DrillService::class);
        $options = $service->options($query, $this->owner->id, ['column_key' => 'total', 'row_index' => 2]);
        $this->assertContains('filter:gt', array_column($options['actions'], 'id'));
        $this->assertSame(300.0, $options['context']['value']);
        $this->assertSame([4.0, 5.0, 6.0], $this->ids($this->apply($query, 'total', 2, 'filter:gt')));
        $this->assertSame([1.0, 2.0], $this->ids($this->apply($query, 'status', 0, 'filter:is_empty')));
        $this->assertSame([3.0, 4.0, 5.0, 6.0], $this->ids($this->apply($query, 'status', 0, 'filter:not_empty')));
        $this->assertSame($query, $report->refresh()->query_definition);
        foreach ([['column_key' => 'missing', 'row_index' => 0], ['column_key' => 'total', 'row_index' => 99], ['column_key' => 'total', 'row_index' => 0, 'value' => 9000]] as $invalid) {
            try {
                $service->options($query, $this->owner->id, $invalid);
                $this->fail('Forged click context was accepted.');
            } catch (ValidationException $exception) {
                $this->assertNotEmpty($exception->errors());
            }
        }
    }

    public function test_aggregate_quick_filter_appends_output_stage_and_underlying_keeps_dashboard_scope(): void
    {
        $query = $this->query(['mode' => 'aggregate', 'metrics' => [['key' => 'sales', 'label' => 'Sales', 'function' => 'sum', 'field' => 'total']], 'dimensions' => [['field' => 'customer_id.city']], 'joins' => [['field' => 'customer_id']], 'sort' => []]);
        $extra = [['field' => 'ordered_at', 'operator' => 'between', 'value' => ['2026-01-01', '2026-01-31']]];
        $response = $this->apply($query, 'sales', 0, 'filter:gt', $extra);
        $this->assertSame('rows', $response['query_definition']['stages'][0]['mode']);
        $this->assertSame([['customer_id.city' => 'Tehran', 'sales' => 600.0]], $response['result']['rows']);
        $response = $this->apply($query, 'sales', 1, 'underlying', $extra);
        $this->assertSame([1.0, 2.0, 3.0], $this->ids($response));
        $this->assertSame('table', $response['display']);
        $this->assertCount(2, $response['query_definition']['filters']);
        $this->assertStringContainsString('BETWEEN', $response['result']['sql']);
        $this->assertStringNotContainsString('SUM(', $response['result']['sql']);
    }

    public function test_underlying_records_of_later_summary_preserve_prior_aggregation_and_stage_filters(): void
    {
        $stage = ['mode' => 'aggregate', 'metrics' => [['key' => 'city_sales', 'function' => 'sum', 'field' => 'sales']], 'dimensions' => [['field' => 'customer.city']], 'joins' => [['source' => 'customers', 'alias' => 'customer', 'type' => 'inner', 'conditions' => [['left' => 'customer_id', 'operator' => 'eq', 'right' => 'id']]]], 'expressions' => [], 'filters' => [], 'sort' => [], 'limit' => null, 'limit_explicit' => false];
        $query = $this->query(['mode' => 'aggregate', 'metrics' => [['key' => 'sales', 'function' => 'sum', 'field' => 'total']], 'dimensions' => [['field' => 'customer_id']], 'sort' => [], 'stages' => [$stage]]);
        $extra = [['field' => 'total', 'operator' => 'gte', 'value' => 200], ['field' => 'stage:0:customer.city', 'operator' => 'eq', 'value' => 'Tehran']];
        $response = $this->apply($query, 'city_sales', 0, 'underlying', $extra);
        $this->assertSame('aggregate', $response['query_definition']['mode']);
        $this->assertSame('rows', $response['query_definition']['stages'][0]['mode']);
        $this->assertCount(1, $response['result']['rows']);
        $this->assertSame(500.0, $response['result']['rows'][0]['sales']);
        $this->assertSame('Tehran', $response['result']['rows'][0]['customer.city']);
        $this->assertStringContainsString('SUM(', $response['result']['sql']);
    }

    public function test_time_zoom_filters_period_preserves_all_category_series_and_existing_parameters(): void
    {
        $query = $this->query(['mode' => 'aggregate', 'metrics' => [['key' => 'sales', 'function' => 'sum', 'field' => 'total']], 'dimensions' => [['field' => 'ordered_at', 'grain' => 'month'], ['field' => 'customer_id.city']], 'joins' => [['field' => 'customer_id']], 'sort' => []]);
        $rows = $this->queryResult($query)['rows'];
        $index = collect($rows)->search(fn ($row) => $row['ordered_at'] === '2026-01-01' && $row['customer_id.city'] === 'Tehran');
        $response = $this->apply($query, 'sales', $index, 'zoom:week');
        $this->assertSame('week', $response['query_definition']['dimensions'][0]['grain']);
        $this->assertCount(1, $response['query_definition']['filters']);
        $this->assertSame(['2026-01-01', '2026-01-31'], $response['query_definition']['filters'][0]['value']);
        $this->assertEqualsCanonicalizing(['Shiraz', 'Tehran'], array_unique(array_column($response['result']['rows'], 'customer_id.city')));
        $this->assertSame(1000.0, array_sum(array_column($response['result']['rows'], 'sales')));
        $paid = [['field' => 'status', 'operator' => 'eq', 'value' => 'paid']];
        $response = $this->apply($query, 'sales', 0, 'zoom:week', $paid);
        $this->assertSame(400.0, array_sum(array_column($response['result']['rows'], 'sales')));
        $this->assertCount(2, $response['query_definition']['filters']);
    }

    public function test_pivot_totals_filter_only_real_selected_dimension_scope(): void
    {
        $query = $this->query(['mode' => 'aggregate', 'metrics' => [['key' => 'sales', 'function' => 'sum', 'field' => 'total']], 'dimensions' => [['field' => 'customer_id.city'], ['field' => 'status']], 'joins' => [['field' => 'customer_id']], 'sort' => []]);
        $rows = $this->queryResult($query)['rows'];
        $index = collect($rows)->search(fn ($row) => $row['customer_id.city'] === 'Tehran');
        $response = $this->apply($query, 'sales', $index, 'underlying', [], [], ['kind' => 'total', 'scope_fields' => ['customer_id.city']]);
        $this->assertSame([1.0, 2.0, 3.0], $this->ids($response));
        $options = app(DrillService::class)->options($query, $this->owner->id, ['column_key' => 'sales', 'row_index' => $index, 'kind' => 'total', 'scope_fields' => ['customer_id.city']]);
        $this->assertSame(600.0, $options['context']['value']);
        $this->assertNotContains('filter:eq', array_column($options['actions'], 'id'));
        $resolved = app(DrillService::class)->resolveContext($query, $this->owner->id, ['column_key' => 'sales', 'row_index' => $index, 'kind' => 'total', 'scope_fields' => ['customer_id.city']]);
        $this->assertSame(['customer_id.city' => 'Tehran', 'sales' => 600.0], $resolved['row']);
        $response = $this->apply($query, 'sales', null, 'underlying', [], [], ['kind' => 'total', 'scope_fields' => []]);
        $this->assertCount(6, $response['result']['rows']);
        $options = app(DrillService::class)->options($query, $this->owner->id, ['column_key' => 'sales', 'kind' => 'total', 'scope_fields' => []]);
        $this->assertSame(2100.0, $options['context']['value']);
        $resolved = app(DrillService::class)->resolveContext($query, $this->owner->id, ['column_key' => 'sales', 'kind' => 'total', 'scope_fields' => []]);
        $this->assertSame(['sales' => 2100.0], $resolved['row']);
        $this->expectException(ValidationException::class);
        $this->apply($query, 'sales', $index, 'underlying', [], [], ['kind' => 'total', 'scope_fields' => ['total']]);
    }

    public function test_header_sort_summary_distribution_and_categorical_breakout_use_source_fields(): void
    {
        $query = $this->query(['limit' => 2, 'limit_explicit' => true]);
        $this->assertSame([6.0, 5.0], $this->ids($this->apply($query, 'total', null, 'sort:desc')));
        $response = $this->apply($query, 'total', null, 'summarize:sum');
        $this->assertSame(2100.0, $response['result']['rows'][0]['drill_value']);
        $this->assertNull($response['query_definition']['limit']);
        $response = $this->apply($query, 'total', null, 'summarize:sum_by_time');
        $this->assertSame([1000.0, 1100.0], array_column($response['result']['rows'], 'drill_value'));
        $response = $this->apply($query, 'total', null, 'distribution');
        $this->assertSame(6.0, array_sum(array_column($response['result']['rows'], 'drill_count')));
        $this->assertStringContainsString('floor([total]', $response['query_definition']['expressions'][0]['expression']);
        $summary = $this->query(['mode' => 'aggregate', 'metrics' => [['key' => 'sales', 'function' => 'sum', 'field' => 'total']], 'dimensions' => [['field' => 'customer_id']], 'sort' => []]);
        $response = $this->apply($summary, 'sales', 0, 'breakout:status');
        $this->assertSame(600.0, array_sum(array_column($response['result']['rows'], 'sales')));
        $this->assertSame(['field' => 'status', 'grain' => null], $response['query_definition']['dimensions'][0]);
    }

    public function test_primary_foreign_and_reverse_relation_details_use_catalog_and_all_primary_keys(): void
    {
        $query = $this->query();
        $response = $this->apply($query, 'status', 2, 'object_details');
        $this->assertSame([3.0], $this->ids($response));
        $this->assertSame('orders', $response['record']['table_key']);
        $response = $this->apply($query, 'customer_id', 2, 'foreign_details');
        $this->assertSame([1.0], $this->ids($response));
        $this->assertSame('Tehran', $response['result']['rows'][0]['city']);
        $this->assertSame([1.0, 2.0, 3.0], $this->ids($this->apply($query, 'customer_id', 2, 'foreign_filter')));
        $customers = $this->query(['source' => 'customers']);
        $response = $this->apply($customers, 'city', 0, 'related:orders:customer_id');
        $this->assertSame([1.0, 2.0, 3.0], $this->ids($response));
        $pdo = new PDO('sqlite:'.$this->path);
        $pdo->exec("CREATE TABLE composite (tenant INTEGER, code INTEGER, name TEXT, PRIMARY KEY (tenant,code)); INSERT INTO composite VALUES (1,1,'A'),(1,2,'B'),(2,1,'C');");
        $pdo = null;
        app(ConnectionManager::class)->sync($this->connection);
        $query = $this->query(['source' => 'composite', 'sort' => [['key' => 'tenant', 'direction' => 'asc'], ['key' => 'code', 'direction' => 'asc']]]);
        $response = $this->apply($query, 'name', 1, 'object_details');
        $this->assertCount(1, $response['result']['rows']);
        $this->assertSame('B', $response['result']['rows'][0]['name']);
        $this->assertCount(2, $response['query_definition']['filters']);
    }

    public function test_native_actions_wrap_read_only_sql_and_preserve_bound_dashboard_parameters(): void
    {
        $query = $this->query(['mode' => 'native', 'sql' => 'SELECT id, total, status FROM orders WHERE total >= {{minimum}} ORDER BY id', 'parameters' => [['key' => 'minimum', 'type' => 'number', 'default' => 0]]]);
        $extra = [['field' => 'minimum', 'value' => 300]];
        $response = $this->apply($query, 'total', 0, 'filter:gt', $extra);
        $this->assertSame([4.0, 5.0, 6.0], $this->ids($response));
        $this->assertSame(300, $response['query_definition']['parameters'][0]['default']);
        $this->assertStringContainsString('{{drill_parameter}}', $response['query_definition']['sql']);
        $this->assertSame(300.0, $response['query_definition']['parameters'][1]['default']);
        $response = $this->apply($query, 'total', null, 'summarize:sum', $extra);
        $this->assertSame(1800.0, $response['result']['rows'][0]['drill_value']);
        $response = $this->apply($query, 'total', null, 'distribution', $extra);
        $this->assertSame(4.0, array_sum(array_column($response['result']['rows'], 'drill_count')));
        $response = $this->apply($query, 'status', null, 'filter:custom', $extra, ['operator' => 'eq', 'value' => "paid' OR 1=1 --"]);
        $this->assertSame([], $response['result']['rows']);
        $this->assertStringNotContainsString('OR 1=1', $response['result']['sql']);
        $options = app(DrillService::class)->options($query, $this->owner->id, ['column_key' => 'id', 'row_index' => 0], $extra);
        $this->assertNotContains('object_details', array_column($options['actions'], 'id'));
    }

    public function test_custom_text_predicates_treat_wildcards_literally_and_respect_case_and_empty_values(): void
    {
        $pdo = new PDO('sqlite:'.$this->path);
        $pdo->exec("UPDATE orders SET status='a%b_' WHERE id=2;");
        $pdo = null;
        $query = $this->query();
        $this->assertSame([3.0, 4.0, 6.0], $this->ids($this->apply($query, 'status', null, 'filter:custom', [], ['operator' => 'contains', 'value' => 'PAID', 'case_sensitive' => false])));
        $this->assertSame([3.0], $this->ids($this->apply($query, 'status', null, 'filter:custom', [], ['operator' => 'starts_with', 'value' => 'P', 'case_sensitive' => true])));
        $this->assertSame([2.0], $this->ids($this->apply($query, 'status', null, 'filter:custom', [], ['operator' => 'contains', 'value' => '%b_'])));
        $this->assertSame([5.0], $this->ids($this->apply($query, 'status', null, 'filter:custom', [], ['operator' => 'ends_with', 'value' => 'ING'])));
        $this->assertSame([5.0], $this->ids($this->apply($query, 'status', 2, 'filter:contains', [], ['operator' => 'ends_with', 'value' => 'ING'])));
        $this->assertSame([2.0, 5.0], $this->ids($this->apply($query, 'status', null, 'filter:custom', [], ['operator' => 'not_contains', 'value' => 'paid'])));
        $this->assertSame([1.0, 6.0], $this->ids($this->apply($query, 'total', null, 'filter:custom', [], ['operator' => 'not_between', 'value' => [200, 500]])));
    }

    public function test_result_signature_rejects_changed_coordinates_and_foreign_connection_ownership(): void
    {
        $query = $this->query();
        $result = $this->queryResult($query);
        $signature = $result['meta']['result_signature'];
        $this->assertSame($signature, $this->queryResult($query)['meta']['result_signature']);
        $pdo = new PDO('sqlite:'.$this->path);
        $pdo->exec('UPDATE orders SET total=999 WHERE id=1');
        $pdo = null;
        Cache::flush();
        try {
            app(DrillService::class)->options($query, $this->owner->id, ['column_key' => 'total', 'row_index' => 0, 'result_signature' => $signature]);
            $this->fail('Stale result signature was accepted.');
        } catch (HttpException $exception) {
            $this->assertSame(409, $exception->getStatusCode());
        }
        $this->expectException(ModelNotFoundException::class);
        app(DrillService::class)->options($query, User::factory()->create()->id, ['column_key' => 'total', 'row_index' => 0]);
    }

    public function test_materialized_report_and_dashboard_filter_scopes_remain_valid_during_replay(): void
    {
        $condition = ['field' => 'total', 'operator' => 'gte', 'value' => 0];
        $query = $this->query(['filters' => array_fill(0, 20, $condition)]);
        $response = $this->apply($query, 'total', 1, 'filter:gt', array_fill(0, 20, $condition));
        $this->assertCount(41, $response['query_definition']['filters']);
        $this->assertSame([3.0, 4.0, 5.0, 6.0], $this->ids($response));
        $response = $this->apply($response['query_definition'], 'total', 1, 'filter:lt');
        $this->assertCount(42, $response['query_definition']['filters']);
        $this->assertSame([3.0], $this->ids($response));
    }

    public function test_native_pivot_total_scope_is_resolved_from_server_output_and_bound_values(): void
    {
        $query = $this->query(['mode' => 'native', 'sql' => 'SELECT customer_id,status,SUM(total) AS sales FROM orders GROUP BY customer_id,status ORDER BY customer_id,status', 'parameters' => []]);
        $context = ['column_key' => 'sales', 'row_index' => 0, 'kind' => 'total', 'scope_fields' => ['customer_id']];
        $options = app(DrillService::class)->options($query, $this->owner->id, $context);
        $this->assertSame(600.0, $options['context']['value']);
        $this->assertNotContains('filter:gt', array_column($options['actions'], 'id'));
        $resolved = app(DrillService::class)->resolveContext($query, $this->owner->id, $context);
        $this->assertSame(['customer_id' => 1.0, 'sales' => 600.0], $resolved['row']);
        $response = $this->apply($query, 'sales', 0, 'underlying', [], [], ['kind' => 'total', 'scope_fields' => ['customer_id']]);
        $this->assertCount(3, $response['result']['rows']);
        $this->assertSame(600.0, array_sum(array_column($response['result']['rows'], 'sales')));
        $this->assertSame(1.0, $response['query_definition']['parameters'][0]['default']);
        $this->assertStringContainsString('{{drill_scope}}', $response['query_definition']['sql']);
        $options = app(DrillService::class)->options($query, $this->owner->id, ['column_key' => 'sales', 'kind' => 'total', 'scope_fields' => []]);
        $this->assertSame(2100.0, $options['context']['value']);
        $resolved = app(DrillService::class)->resolveContext($query, $this->owner->id, ['column_key' => 'sales', 'kind' => 'total', 'scope_fields' => []]);
        $this->assertSame(['sales' => 2100.0], $resolved['row']);
        $this->expectException(ValidationException::class);
        app(DrillService::class)->options($query, $this->owner->id, [...$context, 'scope_fields' => ['total']]);
    }

    public function test_date_part_filters_use_iso_weekdays_and_retain_timestamp_hours_across_drivers(): void
    {
        foreach ([['day_of_week', [7], [3.0, 5.0]], ['month', [1], [1.0, 2.0, 3.0, 4.0]], ['quarter', [1], [1.0, 2.0, 3.0, 4.0, 5.0, 6.0]], ['hour', [23], [4.0]]] as [$part, $values, $expected]) {
            $query = $this->query(['filters' => [['field' => 'ordered_at', 'operator' => 'in', 'date_part' => $part, 'value' => $values]]]);
            $this->assertSame($expected, array_column($this->queryResult($query)['rows'], 'id'));
        }
        $response = $this->apply($this->query(), 'ordered_at', null, 'filter:custom', [], ['operator' => 'not_in', 'date_part' => 'day_of_week', 'value' => [7]]);
        $this->assertSame([1.0, 2.0, 4.0, 6.0], $this->ids($response));
        $native = $this->query(['mode' => 'native', 'sql' => 'SELECT id,ordered_at,total FROM orders ORDER BY id', 'parameters' => []]);
        $response = $this->apply($native, 'ordered_at', null, 'filter:custom', [], ['operator' => 'in', 'date_part' => 'hour', 'value' => [23]]);
        $this->assertSame([4.0], $this->ids($response));
        $runner = app(ReportRunner::class);
        $this->assertSame('EXTRACT(ISODOW FROM field)', $runner->datePartExpression('field', 'day_of_week', 'pgsql'));
        $this->assertSame('toDayOfWeek(toDate(field))', $runner->datePartExpression('field', 'day_of_week', 'clickhouse'));
        $this->assertSame('toHour(toDateTime(field))', $runner->datePartExpression('field', 'hour', 'clickhouse'));
        foreach ([['type' => 'date', 'operator' => 'in', 'date_part' => 'day_of_week', 'value' => [0]], ['type' => 'date', 'operator' => 'in', 'date_part' => 'hour', 'value' => [24]], ['type' => 'text', 'operator' => 'in', 'date_part' => 'month', 'value' => [1]], ['type' => 'date', 'operator' => 'eq', 'date_part' => 'month', 'value' => [1]]] as $invalid) {
            try {
                $runner->validatedFilter(['field' => 'ordered_at', ...$invalid], $invalid['type']);
                $this->fail('Invalid date part was accepted.');
            } catch (ValidationException $exception) {
                $this->assertNotEmpty($exception->errors());
            }
        }
    }

    public function test_virtual_metric_alias_cannot_claim_primary_key_lineage_of_a_real_stage_named_table(): void
    {
        $pdo = new PDO('sqlite:'.$this->path);
        $pdo->exec("CREATE TABLE analytics_stage (id INTEGER PRIMARY KEY, secret TEXT); INSERT INTO analytics_stage VALUES (1,'Unrelated physical record');");
        $pdo = null;
        app(ConnectionManager::class)->sync($this->connection);
        $stage = ['mode' => 'rows', 'metrics' => [], 'dimensions' => [], 'filters' => [], 'sort' => [], 'columns' => ['status', 'id'], 'limit' => null, 'limit_explicit' => false];
        $query = $this->query(['mode' => 'aggregate', 'metrics' => [['key' => 'id', 'function' => 'count']], 'dimensions' => [['field' => 'status']], 'sort' => [], 'stages' => [$stage]]);
        $result = $this->queryResult($query);
        $metric = collect($result['columns'])->firstWhere('key', 'id');
        $this->assertSame('metric', $metric['role']);
        $this->assertArrayNotHasKey('source_table', $metric);
        $options = app(DrillService::class)->options($query, $this->owner->id, ['column_key' => 'id', 'row_index' => 0]);
        $this->assertNotContains('object_details', array_column($options['actions'], 'id'));
        $this->assertNotContains('foreign_details', array_column($options['actions'], 'id'));
    }

    public function test_computed_boolean_filters_bind_false_true_and_lists_across_source_and_output_stages(): void
    {
        $runner = app(ReportRunner::class);
        $query = $this->query(['expressions' => [['key' => 'above300', 'label' => 'Above 300', 'expression' => '[total] > 300']]]);
        foreach ([['eq', false, [1.0, 2.0, 3.0]], ['eq', true, [4.0, 5.0, 6.0]], ['neq', false, [4.0, 5.0, 6.0]], ['in', [false], [1.0, 2.0, 3.0]], ['not_in', [false], [4.0, 5.0, 6.0]], ['in', [false, true], [1.0, 2.0, 3.0, 4.0, 5.0, 6.0]]] as [$operator, $value, $expected]) {
            $filtered = [...$query, 'filters' => [['field' => 'above300', 'operator' => $operator, 'value' => $value]]];
            $this->assertSame($expected, array_column($this->queryResult($filtered)['rows'], 'id'));
        }
        $extra = [['field' => 'above300', 'operator' => 'eq', 'value' => false]];
        $this->assertSame([1.0, 2.0, 3.0], array_column($runner->run($query, $this->owner->id, $extra)['rows'], 'id'));
        $stage = ['mode' => 'rows', 'metrics' => [], 'dimensions' => [], 'filters' => [['field' => 'above300', 'operator' => 'not_in', 'value' => [false]]], 'sort' => [['key' => 'id', 'direction' => 'asc']], 'columns' => ['id', 'above300'], 'limit' => null, 'limit_explicit' => false];
        $this->assertSame([4.0, 5.0, 6.0], array_column($this->queryResult([...$query, 'stages' => [$stage]])['rows'], 'id'));
        $summary = [...$query, 'mode' => 'aggregate', 'metrics' => [['key' => 'records', 'function' => 'count']], 'dimensions' => [['field' => 'above300']], 'sort' => [], 'stages' => [[...$stage, 'columns' => ['above300', 'records'], 'sort' => []]]];
        $this->assertSame([['above300' => 1, 'records' => 3.0]], $this->queryResult($summary)['rows']);
        $pgsql = clone $this->connection;
        $pgsql->driver = 'pgsql';
        $filtered = [...$query, 'filters' => [['field' => 'above300', 'operator' => 'eq', 'value' => false]]];
        $this->assertSame(['p0' => false], $runner->compile($runner->validate($filtered, $this->owner->id), $pgsql)['bindings']);
    }

    public function test_derived_float_filters_compare_numerically_in_source_and_later_stages(): void
    {
        $query = $this->query(['expressions' => [['key' => 'adjusted', 'label' => 'Adjusted', 'expression' => '[total] / 8']]]);
        foreach ([['eq', 12.5, [1.0]], ['between', [25.0, 37.5], [2.0, 3.0]], ['gt', 50.0, [5.0, 6.0]]] as [$operator, $value, $expected]) {
            $filtered = [...$query, 'filters' => [['field' => 'adjusted', 'operator' => $operator, 'value' => $value]]];
            $this->assertSame($expected, array_column($this->queryResult($filtered)['rows'], 'id'));
        }
        $stage = ['mode' => 'rows', 'metrics' => [], 'dimensions' => [], 'filters' => [['field' => 'adjusted', 'operator' => 'between', 'value' => [25.0, 37.5]]], 'sort' => [['key' => 'id', 'direction' => 'asc']], 'columns' => ['id', 'adjusted'], 'limit' => null, 'limit_explicit' => false];
        $this->assertSame([2.0, 3.0], array_column($this->queryResult([...$query, 'stages' => [$stage]])['rows'], 'id'));
    }

    public function test_native_float_parameters_and_native_expression_filters_use_typed_numeric_placeholders(): void
    {
        $query = $this->query(['mode' => 'native', 'sql' => 'SELECT id,total/8.0 AS adjusted FROM orders WHERE total/8.0 = {{amount}} ORDER BY id', 'parameters' => [['key' => 'amount', 'type' => 'number', 'default' => 12.5]]]);
        $this->assertSame([1.0], array_column($this->queryResult($query)['rows'], 'id'));
        $query['sql'] = 'SELECT id,total/8.0 AS adjusted FROM orders WHERE total/8.0 BETWEEN {{minimum}} AND {{maximum}} ORDER BY id';
        $query['parameters'] = [['key' => 'minimum', 'type' => 'number', 'default' => 25.0], ['key' => 'maximum', 'type' => 'number', 'default' => 37.5]];
        $this->assertSame([2.0, 3.0], array_column($this->queryResult($query)['rows'], 'id'));
        $query['sql'] = 'SELECT id,total/8.0 AS adjusted,(total > 300) AS flag FROM orders ORDER BY id';
        $query['parameters'] = [];
        $this->assertSame([2.0], $this->ids($this->apply($query, 'adjusted', null, 'filter:custom', [], ['operator' => 'eq', 'value' => 25.0])));
        $this->assertSame([4.0, 5.0, 6.0], $this->ids($this->apply($query, 'flag', null, 'filter:custom', [], ['operator' => 'not_in', 'value' => [0]])));
    }

    public function test_sqlite_driver_preserves_integer_boolean_null_and_positional_binding_storage_types(): void
    {
        $driver = app(ConnectionManager::class)->driver($this->connection);
        $rows = $driver->select('SELECT typeof(:zero) AS zero_type,typeof(:yes) AS yes_type,typeof(:no) AS no_type,typeof(:empty) AS empty_type,typeof(:label) AS label_type,(2 > 3) = :no AS false_match,(2 < 3) = :yes AS true_match', ['zero' => 0, 'yes' => true, 'no' => false, 'empty' => null, 'label' => '0']);
        $this->assertSame([['zero_type' => 'integer', 'yes_type' => 'integer', 'no_type' => 'integer', 'empty_type' => 'null', 'label_type' => 'text', 'false_match' => 1, 'true_match' => 1]], $rows);
        $this->assertSame([['matched' => 1]], $driver->select('SELECT (2 > 3) = ? AS matched', [false]));
    }

    public function test_native_postgres_boolean_filters_compare_integer_parameters_and_keep_null_predicates_uncast(): void
    {
        $runner = app(ReportRunner::class);
        $query = $runner->validate($this->query(['mode' => 'native', 'sql' => 'SELECT id,(total > 300) AS flag FROM orders', 'parameters' => []]), $this->owner->id);
        $connection = clone $this->connection;
        $connection->driver = 'pgsql';
        $state = ['definition' => $query, 'connection' => $connection, 'column' => ['key' => 'flag', 'type' => 'boolean'], 'value' => false];
        $method = new \ReflectionMethod(DrillService::class, 'nativeAction');
        $service = app(DrillService::class);
        $action = ['type' => 'custom_filter', 'requires_input' => true];
        foreach ([['eq', false, [0]], ['neq', true, [1]], ['in', [false, true], [0, 1]], ['not_in', [false], [0]]] as [$operator, $value, $expectedBindings]) {
            $wrapped = $method->invoke($service, $state, $action, ['operator' => $operator, 'value' => $value]);
            $compiled = $runner->compile($runner->validate($wrapped, $this->owner->id), $connection);
            $this->assertStringContainsString('CAST("analytics_drill"."flag" AS INTEGER)', $compiled['sql']);
            $this->assertSame($expectedBindings, array_values($compiled['bindings']));
        }
        foreach (['is_null' => 'IS NULL', 'not_null' => 'IS NOT NULL'] as $operator => $predicate) {
            $wrapped = $method->invoke($service, $state, $action, ['operator' => $operator, 'value' => null]);
            $compiled = $runner->compile($runner->validate($wrapped, $this->owner->id), $connection);
            $this->assertStringContainsString('"analytics_drill"."flag" '.$predicate, $compiled['sql']);
            $this->assertStringNotContainsString('AS INTEGER', $compiled['sql']);
            $this->assertSame([], $compiled['bindings']);
        }
        $scope = [...$state, 'column' => ['key' => 'id', 'type' => 'number'], 'context' => ['scope_fields' => ['flag']], 'result' => ['columns' => [['key' => 'flag', 'type' => 'boolean']]], 'row' => ['flag' => false]];
        $wrapped = $method->invoke($service, $scope, ['type' => 'underlying'], []);
        $compiled = $runner->compile($runner->validate($wrapped, $this->owner->id), $connection);
        $this->assertStringContainsString('CAST("analytics_drill"."flag" AS INTEGER) = :p0', $compiled['sql']);
        $this->assertSame(['p0' => 0], $compiled['bindings']);
    }

    public function test_native_driver_boolean_values_are_described_as_booleans_instead_of_text(): void
    {
        $driver = new class implements DatabaseDriver
        {
            public function catalog(): array
            {
                return [];
            }

            public function select(string $sql, array $bindings = []): array
            {
                return [['id' => 1, 'flag' => false], ['id' => 2, 'flag' => true]];
            }
        };
        $this->mock(ConnectionManager::class)->shouldReceive('driver')->once()->andReturn($driver);
        $result = app(ReportRunner::class)->run($this->query(['mode' => 'native', 'sql' => 'SELECT id,flag FROM orders', 'parameters' => []]), $this->owner->id);
        $this->assertSame('boolean', collect($result['columns'])->firstWhere('key', 'flag')['type']);
        $this->assertSame([false, true], array_column($result['rows'], 'flag'));
    }
}
