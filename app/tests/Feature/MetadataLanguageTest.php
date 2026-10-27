<?php

namespace Tests\Feature;

use App\Domain\Analytics\DrillService;
use App\Domain\Analytics\Drivers\ConnectionManager;
use App\Domain\Analytics\ReportRunner;
use App\Models\AnalyticsConnection;
use App\Models\AnalyticsReport;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Validation\ValidationException;
use PDO;
use Tests\TestCase;

class MetadataLanguageTest extends TestCase
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
        $this->path = storage_path('framework/metadata-language-'.bin2hex(random_bytes(6)).'.sqlite');
        $pdo = new PDO('sqlite:'.$this->path);
        $pdo->exec("CREATE TABLE customer_records (id INTEGER PRIMARY KEY, city_name TEXT);
            CREATE TABLE order_records (id INTEGER PRIMARY KEY, customer_id INTEGER REFERENCES customer_records(id), total_amount DECIMAL, status_code TEXT);
            INSERT INTO customer_records VALUES (1,'Tehran'),(2,'شیراز');
            INSERT INTO order_records VALUES (1,1,100,'paid'),(2,2,200,'pending'),(3,1,300,'paid');");
        $pdo = null;
        $this->connection = AnalyticsConnection::create(['owner_id' => $this->owner->id, 'name' => 'Language fixture', 'driver' => 'sqlite', 'configuration' => ['path' => $this->path]]);
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
        return array_replace(['connection_id' => $this->connection->id, 'source' => 'order_records', 'mode' => 'rows', 'metrics' => [], 'dimensions' => [], 'filters' => [], 'sort' => [['key' => 'id', 'direction' => 'asc']], 'joins' => [], 'expressions' => [], 'limit' => null, 'limit_explicit' => false], $changes);
    }

    private function metadata(array $data): array
    {
        return $this->putJson('/analytics/api/connections/'.$this->connection->id.'/metadata', $data)->assertOk()->json();
    }

    private function table(array $catalog, string $key = 'order_records'): array
    {
        return collect($catalog)->firstWhere('key', $key);
    }

    private function field(array $catalog, string $key = 'total_amount', string $table = 'order_records'): array
    {
        return collect($this->table($catalog, $table)['fields'])->firstWhere('key', $key);
    }

    private function names(): void
    {
        $this->metadata(['table' => 'order_records', 'label' => 'سفارش‌ها', 'labels' => ['fa' => 'سفارش‌ها', 'en' => 'Orders']]);
        $this->metadata(['table' => 'order_records', 'field' => 'total_amount', 'label' => 'مبلغ', 'labels' => ['fa' => 'مبلغ فروش', 'en' => 'Order amount']]);
        $this->metadata(['table' => 'customer_records', 'label' => 'مشتریان', 'labels' => ['fa' => 'مشتریان', 'en' => 'Customers']]);
        $this->metadata(['table' => 'customer_records', 'field' => 'city_name', 'label' => 'شهر', 'labels' => ['fa' => 'شهر', 'en' => 'City']]);
    }

    public function test_default_names_are_exact_identifiers_and_offline_legacy_catalogs_are_enriched_without_sync(): void
    {
        $catalog = $this->connection->publicData()['catalog'];
        $this->assertSame(['original' => 'order_records', 'fa' => 'order_records', 'en' => 'order_records'], $this->table($catalog)['display_names']);
        $this->assertSame(['original' => 'total_amount', 'fa' => 'total_amount', 'en' => 'total_amount'], $this->field($catalog)['display_names']);
        $this->assertSame('physical', $this->field($catalog)['label_kind']);
        $missing = storage_path('framework/metadata-language-absent-'.bin2hex(random_bytes(6)).'.sqlite');
        foreach (['sqlite', 'pgsql', 'clickhouse'] as $driver) {
            $key = $driver === 'sqlite' ? 'order_records' : 'warehouse.order_records';
            $legacy = [['key' => $key, 'label' => 'سفارش‌های قدیمی', 'fields' => [['key' => 'status_code', 'label' => 'وضعیت قدیمی', 'type' => 'text', 'hidden' => true, 'description' => 'Retain', 'semantic_type' => 'category']]]];
            $connection = AnalyticsConnection::create(['owner_id' => $this->owner->id, 'name' => 'Offline '.$driver, 'driver' => $driver, 'configuration' => ['path' => $missing, 'password' => 'private'], 'catalog' => $legacy]);
            $public = $connection->publicData();
            $this->assertSame($key, $public['catalog'][0]['original_name']);
            $this->assertSame(['original' => $key, 'fa' => 'سفارش‌های قدیمی', 'en' => $key], $public['catalog'][0]['display_names']);
            $this->assertSame('وضعیت قدیمی', $public['catalog'][0]['fields'][0]['display_names']['fa']);
            $this->assertTrue($public['catalog'][0]['fields'][0]['hidden']);
            $this->assertSame('Retain', $public['catalog'][0]['fields'][0]['description']);
            $this->assertSame('category', $public['catalog'][0]['fields'][0]['semantic_type']);
            $this->assertArrayNotHasKey('password', $public['configuration']);
            $this->assertSame($legacy, $connection->refresh()->catalog);
            $this->assertNull($connection->synced_at);
        }
        $this->assertFileDoesNotExist($missing);
    }

    public function test_multilingual_metadata_updates_merge_properties_and_null_clears_only_the_requested_language(): void
    {
        $this->metadata(['table' => 'order_records', 'field' => 'total_amount', 'label' => 'مبلغ قدیمی', 'labels' => ['fa' => 'مبلغ فروش', 'en' => 'Revenue'], 'description' => 'Keep description', 'hidden' => true, 'semantic_type' => 'currency']);
        $this->metadata(['table' => 'order_records', 'description' => 'Keep table', 'labels' => ['fa' => 'سفارش‌ها', 'en' => 'Orders']]);
        $partial = $this->metadata(['table' => 'order_records', 'field' => 'total_amount', 'labels' => ['en' => 'Order total']]);
        $field = $this->field($partial['catalog']);
        $this->assertSame(['original' => 'total_amount', 'fa' => 'مبلغ فروش', 'en' => 'Order total'], $field['display_names']);
        $this->assertSame('total_amount', $field['label']);
        $this->assertTrue($field['hidden']);
        $this->assertSame('currency', $field['semantic_type']);
        $this->assertSame('Keep description', $field['description']);
        $this->metadata(['table' => 'order_records', 'labels' => ['en' => null]]);
        $cleared = $this->metadata(['table' => 'order_records', 'field' => 'total_amount', 'labels' => ['fa' => null]]);
        $this->assertSame(['original' => 'total_amount', 'fa' => 'total_amount', 'en' => 'Order total'], $this->field($cleared['catalog'])['display_names']);
        $this->assertSame(['original' => 'order_records', 'fa' => 'سفارش‌ها', 'en' => 'order_records'], $this->table($cleared['catalog'])['display_names']);
        $this->assertSame('Keep table', $this->table($cleared['catalog'])['description']);
        $this->assertNull($this->connection->refresh()->metadata['order_records']['fields']['total_amount']['labels']['fa']);
        $synced = app(ConnectionManager::class)->sync($this->connection)->publicData();
        $this->assertSame($this->field($cleared['catalog'])['display_names'], $this->field($synced['catalog'])['display_names']);
        $this->assertTrue($this->field($synced['catalog'])['hidden']);
    }

    public function test_raw_join_and_stage_columns_preserve_names_lineage_aliases_and_untranslated_values(): void
    {
        $this->names();
        $runner = app(ReportRunner::class);
        $query = $runner->validate($this->query(['joins' => [['field' => 'customer_id']], 'columns' => ['id', 'total_amount', 'customer_id.city_name'], 'expressions' => [['key' => 'net', 'label' => 'Net فروش', 'expression' => '[Order amount] * 0.9']]]), $this->owner->id);
        $this->assertSame('[total_amount] * 0.9', $query['expressions'][0]['expression']);
        $result = $runner->run($query, $this->owner->id);
        $joined = collect($result['columns'])->firstWhere('key', 'customer_id.city_name');
        $this->assertSame(['original' => 'customer_id.city_name', 'fa' => 'مشتریان → شهر', 'en' => 'Customers → City'], $joined['display_names']);
        $this->assertSame('customer_records', $joined['source_table']);
        $this->assertSame('city_name', $joined['source_field']);
        $this->assertSame(['Tehran', 'شیراز', 'Tehran'], array_column($result['rows'], 'customer_id.city_name'));
        $this->assertStringContainsString('"j0"."city_name" AS "customer_id.city_name"', $result['sql']);
        $stage = ['mode' => 'rows', 'metrics' => [], 'dimensions' => [], 'filters' => [], 'sort' => [], 'columns' => ['customer_id.city_name', 'sales', 'half'], 'expressions' => [['key' => 'half', 'label' => 'Half فروش', 'expression' => '[Custom sales] / 2']], 'limit' => null, 'limit_explicit' => false];
        $summary = $runner->validate($this->query(['mode' => 'aggregate', 'joins' => [['field' => 'customer_id']], 'metrics' => [['key' => 'sales', 'label' => 'Custom sales', 'function' => 'sum', 'field' => 'total_amount']], 'dimensions' => [['field' => 'customer_id.city_name']], 'sort' => [], 'stages' => [$stage]]), $this->owner->id);
        $final = $runner->run($summary, $this->owner->id);
        foreach (['sales' => 'Custom sales', 'half' => 'Half فروش'] as $key => $label) {
            $column = collect($final['columns'])->firstWhere('key', $key);
            $this->assertSame('alias', $column['label_kind']);
            $this->assertSame(array_fill_keys(['original', 'fa', 'en'], $label), $column['display_names']);
        }
        $this->assertSame($joined['display_names'], $final['columns'][0]['display_names']);
        $fields = $runner->filterFields($this->connection->refresh(), $summary);
        $this->assertSame('stage:0:customer_id.city_name', $fields['stage:0:customer_id.city_name']['display_names']['original']);
        $this->assertSame('مرحلهٔ 2 → Customers → City', $fields['stage:0:customer_id.city_name']['display_names']['en']);
        $this->assertSame('Custom sales', $summary['stages'][0]['field_labels']['sales']);
        $saved = $this->postJson('/analytics/api/reports', ['name' => 'Original keys', 'query_definition' => $summary, 'display' => 'table', 'visualization_settings' => []])->assertOk()->json();
        $reopened = $this->getJson('/analytics/api/reports/'.$saved['id'])->assertOk()->json();
        $this->assertSame($summary, $reopened['query_definition']);
        $this->assertSame($summary, AnalyticsReport::findOrFail($saved['id'])->query_definition);
    }

    public function test_translated_expression_names_canonicalize_and_ambiguity_never_changes_physical_key_priority(): void
    {
        $this->names();
        $runner = app(ReportRunner::class);
        foreach (['[مبلغ فروش] + 1', '[Order amount] + 1', '[total_amount] + 1'] as $expression) {
            $query = $runner->validate($this->query(['expressions' => [['key' => 'custom', 'label' => 'User alias', 'expression' => $expression]]]), $this->owner->id);
            $this->assertSame('[total_amount] + 1', $query['expressions'][0]['expression']);
        }
        $this->metadata(['table' => 'order_records', 'field' => 'customer_id', 'labels' => ['en' => 'Order amount']]);
        try {
            $runner->validate($this->query(['expressions' => [['key' => 'custom', 'label' => 'Alias', 'expression' => '[Order amount] + 1']]]), $this->owner->id);
            $this->fail('Ambiguous translated display names must not select a field.');
        } catch (ValidationException $exception) {
            $this->assertArrayHasKey('expressions', $exception->errors());
        }
        $this->metadata(['table' => 'order_records', 'field' => 'customer_id', 'labels' => ['en' => 'total_amount']]);
        $query = $runner->validate($this->query(['expressions' => [['key' => 'custom', 'label' => 'Alias', 'expression' => '[total_amount] + 1']]]), $this->owner->id);
        $this->assertSame([101.0, 201.0, 301.0], array_column($runner->run($query, $this->owner->id)['rows'], 'custom'));
    }

    public function test_drill_descriptors_native_aliases_and_cache_refresh_keep_language_names_separate_from_values(): void
    {
        $this->names();
        $runner = app(ReportRunner::class);
        $query = $this->query();
        $first = $runner->run($query, $this->owner->id);
        $this->assertTrue($runner->run($query, $this->owner->id)['meta']['cached']);
        $this->metadata(['table' => 'order_records', 'field' => 'total_amount', 'labels' => ['en' => 'Updated amount']]);
        $changed = $runner->run($query, $this->owner->id);
        $this->assertFalse($changed['meta']['cached']);
        $this->assertSame($first['rows'], $changed['rows']);
        $this->assertSame($first['sql'], $changed['sql']);
        $this->assertSame('Updated amount', collect($changed['columns'])->firstWhere('key', 'total_amount')['display_names']['en']);
        $service = app(DrillService::class);
        $options = $service->options($query, $this->owner->id, ['column_key' => 'total_amount', 'row_index' => 0]);
        $this->assertSame(['original' => 'total_amount', 'fa' => 'مبلغ فروش', 'en' => 'Updated amount'], $options['context']['display_names']);
        $this->assertSame(100.0, $options['context']['value']);
        $header = $service->options($query, $this->owner->id, ['column_key' => 'total_amount']);
        $sum = collect($header['actions'])->firstWhere('id', 'summarize:sum');
        $this->assertSame('مجموع total_amount', $sum['display_names']['original']);
        $this->assertSame('مجموع Updated amount', $sum['display_names']['en']);
        $record = $service->apply($query, $this->owner->id, ['column_key' => 'id', 'row_index' => 0], 'object_details');
        $this->assertSame(['original' => 'order_records', 'fa' => 'سفارش‌ها', 'en' => 'Orders'], $record['record']['display_names']);
        $this->assertSame('order_records', $record['record']['table_key']);
        $this->assertSame([1.0], array_column($record['result']['rows'], 'id'));
        $native = $runner->run($this->query(['mode' => 'native', 'sql' => 'SELECT total_amount AS "User alias" FROM order_records ORDER BY id', 'parameters' => []]), $this->owner->id);
        $this->assertSame(array_fill_keys(['original', 'fa', 'en'], 'User alias'), $native['columns'][0]['display_names']);
        $this->assertSame('alias', $native['columns'][0]['label_kind']);
    }

    public function test_schema_qualified_remote_sql_remains_physical_and_metadata_validation_rejects_forgery(): void
    {
        $this->names();
        $runner = app(ReportRunner::class);
        foreach (['pgsql', 'clickhouse'] as $driver) {
            $connection = clone $this->connection->refresh();
            $connection->driver = $driver;
            $catalog = $connection->catalog;
            foreach ($catalog as &$table) {
                if ($table['key'] === 'order_records') {
                    $table['key'] = 'warehouse.order_records';
                }
            }
            unset($table);
            $connection->catalog = $catalog;
            $connection->metadata = ['warehouse.order_records' => $connection->metadata['order_records']];
            $query = $runner->validate($this->query(['source' => 'warehouse.order_records', 'columns' => ['total_amount']]), $this->owner->id, $connection);
            $compiled = $runner->compile($query, $connection);
            $quote = $driver === 'pgsql' ? '"' : '`';
            $this->assertStringContainsString('FROM '.$quote.'warehouse'.$quote.'.'.$quote.'order_records'.$quote, $compiled['sql']);
            $this->assertSame('total_amount', $compiled['columns'][0]['key']);
            $this->assertSame('total_amount', $compiled['columns'][0]['display_names']['original']);
            $this->assertSame('مبلغ فروش', $compiled['columns'][0]['display_names']['fa']);
        }
        $route = '/analytics/api/connections/'.$this->connection->id.'/metadata';
        foreach ([['labels' => ['original' => 'renamed']], ['labels' => ['de' => 'Feld']], ['labels' => ['en' => str_repeat('x', 151)]], ['labels' => ['fa' => ['invalid']]], ['field' => 'missing', 'labels' => ['en' => 'Invalid']], ['table' => 'missing', 'labels' => ['en' => 'Invalid']]] as $invalid) {
            $this->putJson($route, ['table' => 'order_records', ...$invalid])->assertUnprocessable();
        }
        $this->actingAs(User::factory()->create())->putJson($route, ['table' => 'order_records', 'labels' => ['en' => 'Forbidden']])->assertForbidden();
        $this->assertSame('Orders', $this->table($this->connection->refresh()->publicData()['catalog'])['display_names']['en']);
    }
}
