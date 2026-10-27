<?php

namespace Tests\Feature;

use App\Domain\Analytics\ReportRunner;
use App\Models\AnalyticsConnection;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Client\Request;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

class ClickHouseCatalogTest extends TestCase
{
    use RefreshDatabase;

    private User $owner;

    private array $configuration = ['host' => 'catalog.test', 'port' => 8123, 'database' => 'analytics', 'username' => 'reader', 'password' => 'catalog-secret'];

    private array $engines = ['events_without_model' => 'MergeTree', 'sales_view' => 'View', 'sales_materialized' => 'MaterializedView', 'live_view' => 'LiveView', 'window_view' => 'WindowView'];

    private bool $failColumns = false;

    private bool $failWithJsonException = false;

    protected function setUp(): void
    {
        parent::setUp();
        $this->owner = User::factory()->create();
        $this->actingAs($this->owner);
        // The catalog deliberately exceeds the preview limits, without any model classes.
        config(['analytics.preview_row_limit' => 2, 'analytics.preview_aggregate_limit' => 3]);
        Http::preventStrayRequests();
        Http::fake(function (Request $request) {
            $parameters = $this->parameters($request);
            if (str_contains($request->body(), 'FROM system.tables')) {
                $data = [];
                foreach ($this->engines as $name => $engine) {
                    $data[] = ['database' => $this->configuration['database'], 'name' => $name, 'engine' => $engine];
                }
            } elseif (str_contains($request->body(), 'FROM system.columns')) {
                if ($this->failColumns) {
                    return $this->failWithJsonException
                        ? Http::response(['data' => [['name' => 'partial', 'type' => 'String', 'is_in_primary_key' => 0]], 'exception' => 'metadata streamed exception with private details'])
                        : Http::response('metadata limit or permission failure', 500);
                }
                $data = [
                    ['name' => 'event_id', 'type' => 'UInt64', 'is_in_primary_key' => 1],
                    ['name' => 'occurred_at', 'type' => "Nullable(DateTime64(3, 'UTC'))", 'is_in_primary_key' => 0],
                    ['name' => 'amount', 'type' => 'Nullable(Decimal(18, 2))', 'is_in_primary_key' => 0],
                    ['name' => 'status', 'type' => 'LowCardinality(Nullable(String))', 'is_in_primary_key' => 0],
                    ['name' => 'enabled', 'type' => 'Bool', 'is_in_primary_key' => 0],
                ];
            } else {
                $data = [['event_id' => '42', 'status' => 'ready']];
            }
            // Model the server's row-limit setting so truncated catalog requests fail the tests.
            $limit = (int) ($parameters['max_result_rows'] ?? 0);
            if ($limit > 0 && $parameters['result_overflow_mode'] === 'break') {
                $data = array_slice($data, 0, $limit);
            }

            return Http::response(['data' => $data]);
        });
    }

    private function parameters(Request $request): array
    {
        parse_str(parse_url($request->url(), PHP_URL_QUERY), $parameters);

        return $parameters;
    }

    private function connection(?User $user = null): AnalyticsConnection
    {
        return AnalyticsConnection::create(['owner_id' => ($user ?? $this->owner)->id, 'name' => 'ClickHouse catalog', 'driver' => 'clickhouse', 'configuration' => $this->configuration]);
    }

    private function definition(AnalyticsConnection $connection, string $table): array
    {
        return ['connection_id' => $connection->id, 'source' => $this->configuration['database'].'.'.$table, 'mode' => 'rows', 'columns' => ['event_id', 'status'], 'metrics' => [], 'dimensions' => [], 'filters' => [], 'sort' => [], 'joins' => []];
    }

    public function test_connection_test_reads_all_tables_views_and_columns_without_preview_truncation(): void
    {
        $response = $this->postJson('/analytics/api/connections/test', ['name' => 'ClickHouse catalog', 'driver' => 'clickhouse', 'configuration' => $this->configuration])
            ->assertOk()->assertJsonPath('table_count', 5)->assertJsonCount(5, 'catalog')
            ->assertJsonPath('catalog.0.key', 'analytics.events_without_model')
            ->assertJsonPath('catalog.0.kind', 'table')->assertJsonPath('catalog.0.engine', 'MergeTree')
            ->assertJsonCount(5, 'catalog.0.fields')
            ->assertJsonPath('catalog.0.fields.0.type', 'number')->assertJsonPath('catalog.0.fields.0.primary', true)
            ->assertJsonPath('catalog.0.fields.1.type', 'date')->assertJsonPath('catalog.0.fields.1.nullable', true)
            ->assertJsonPath('catalog.0.fields.2.type', 'number')->assertJsonPath('catalog.0.fields.3.type', 'text')
            ->assertJsonPath('catalog.0.fields.4.type', 'boolean')->assertDontSee('catalog-secret');
        foreach (array_keys($this->engines) as $index => $name) {
            $response->assertJsonPath('catalog.'.$index.'.key', 'analytics.'.$name);
            $response->assertJsonPath('catalog.'.$index.'.kind', $index === 0 ? 'table' : 'view');
        }
        $this->assertDatabaseCount('analytics_connections', 0);
        Http::assertSentCount(6);
        Http::assertSent(fn (Request $request) => str_contains($request->body(), 'FROM system.tables WHERE database = {database:String} ORDER BY name') && $this->parameters($request)['param_database'] === 'analytics');
        Http::assertNotSent(fn (Request $request) => $this->parameters($request)['max_result_rows'] !== '0' || $this->parameters($request)['result_overflow_mode'] !== 'throw' || $this->parameters($request)['readonly'] !== '2');
    }

    public function test_synced_catalog_exposes_unmodeled_tables_and_views_as_report_sources(): void
    {
        $connection = $this->connection();
        $foreign = $this->connection(User::factory()->create());
        $this->postJson('/analytics/api/connections/'.$connection->id.'/sync')->assertOk()->assertJsonCount(5, 'catalog')->assertDontSee('catalog-secret');
        $this->assertCount(5, $connection->refresh()->catalog);
        $this->assertNotNull($connection->synced_at);
        $library = $this->getJson('/analytics/api/library')->assertOk()->assertJsonCount(1, 'connections')->assertJsonPath('connections.0.id', $connection->id)->assertJsonCount(5, 'connections.0.catalog')->assertDontSee('catalog-secret');
        $this->assertNotContains($foreign->id, array_column($library->json('connections'), 'id'));
        foreach (array_keys($this->engines) as $name) {
            $preview = $this->postJson('/analytics/api/reports/preview', ['query_definition' => $this->definition($connection, $name)])
                ->assertOk()->assertJsonPath('rows.0.event_id', 42)->assertJsonPath('rows.0.status', 'ready');
            $this->assertStringContainsString('FROM `analytics`.`'.$name.'` `t0`', $preview->json('sql'));
        }
        Http::assertSent(fn (Request $request) => ! str_contains($request->body(), 'FROM system.') && $this->parameters($request)['max_result_rows'] === '4' && $this->parameters($request)['result_overflow_mode'] === 'break' && $this->parameters($request)['readonly'] === '2');
        Http::assertNotSent(fn (Request $request) => ! str_contains($request->body(), 'FROM system.') && $this->parameters($request)['max_result_rows'] === '0');
    }

    public function test_sync_cannot_expose_another_owners_catalog_and_unknown_sources_are_rejected(): void
    {
        $connection = $this->connection();
        $foreign = $this->connection(User::factory()->create());
        $this->postJson('/analytics/api/connections/'.$foreign->id.'/sync')->assertForbidden();
        $this->postJson('/analytics/api/reports/preview', ['query_definition' => $this->definition($foreign, 'events_without_model')])->assertNotFound();
        Http::assertNothingSent();
        $this->postJson('/analytics/api/connections/'.$connection->id.'/sync')->assertOk();
        $this->postJson('/analytics/api/reports/preview', ['query_definition' => $this->definition($connection, 'not_in_database')])->assertUnprocessable();
        Http::assertSentCount(6);
    }

    public function test_failed_schema_refresh_keeps_the_previous_complete_catalog(): void
    {
        $connection = $this->connection();
        $this->postJson('/analytics/api/connections/'.$connection->id.'/sync')->assertOk();
        $catalog = $connection->refresh()->catalog;
        $this->failColumns = true;
        $this->postJson('/analytics/api/connections/'.$connection->id.'/sync')->assertUnprocessable()->assertDontSee('catalog-secret')->assertDontSee('metadata limit or permission failure');
        $this->assertSame($catalog, $connection->refresh()->catalog);
    }

    public function test_dotted_database_and_table_names_remain_whole_identifiers_in_queries_and_joins(): void
    {
        $this->configuration['database'] = 'tenant.logs`east';
        $this->engines = ['events.raw`stream' => 'MergeTree', 'lookup.part`two' => 'View', '.inner_id.0a1b' => 'MergeTree'];
        $connection = $this->connection();
        $this->postJson('/analytics/api/connections/'.$connection->id.'/sync')->assertOk()->assertJsonCount(3, 'catalog')
            ->assertJsonPath('catalog.0.key', 'tenant.logs`east.events.raw`stream')->assertJsonPath('catalog.2.key', 'tenant.logs`east..inner_id.0a1b');
        $definition = $this->definition($connection, 'events.raw`stream');
        $definition['joins'] = [['source' => 'tenant.logs`east.lookup.part`two', 'alias' => 'lookup', 'type' => 'left', 'conditions' => [['left' => 'event_id', 'operator' => 'eq', 'right' => 'event_id']]]];
        $preview = $this->postJson('/analytics/api/reports/preview', ['query_definition' => $definition])->assertOk();
        $this->assertStringContainsString('FROM `tenant.logs\\`east`.`events.raw\\`stream` `t0`', $preview->json('sql'));
        $this->assertStringContainsString('LEFT JOIN `tenant.logs\\`east`.`lookup.part\\`two` `j0`', $preview->json('sql'));
        $inner = $this->postJson('/analytics/api/reports/preview', ['query_definition' => $this->definition($connection, '.inner_id.0a1b')])->assertOk();
        $this->assertStringContainsString('FROM `tenant.logs\\`east`.`.inner_id.0a1b` `t0`', $inner->json('sql'));
        Http::assertSent(fn (Request $request) => str_contains($request->body(), 'FROM system.columns') && $this->parameters($request)['param_table'] === 'events.raw`stream');
    }

    public function test_http_200_with_partial_data_and_an_exception_does_not_replace_the_catalog(): void
    {
        $connection = $this->connection();
        $this->postJson('/analytics/api/connections/'.$connection->id.'/sync')->assertOk();
        $catalog = $connection->refresh()->catalog;
        $this->failColumns = true;
        $this->failWithJsonException = true;
        $this->postJson('/analytics/api/connections/'.$connection->id.'/sync')->assertUnprocessable()->assertDontSee('private details')->assertDontSee('catalog-secret');
        $this->assertSame($catalog, $connection->refresh()->catalog);
    }

    public function test_dotted_table_compilation_without_a_configured_schema_splits_only_the_first_dot(): void
    {
        $this->engines = ['events.raw`stream' => 'MergeTree'];
        $connection = $this->connection();
        $this->postJson('/analytics/api/connections/'.$connection->id.'/sync')->assertOk();
        $connection->refresh();
        $definition = app(ReportRunner::class)->validate($this->definition($connection, 'events.raw`stream'), $this->owner->id);
        $connection->configuration = [];
        $compiled = app(ReportRunner::class)->compile($definition, $connection);
        $this->assertStringContainsString('FROM `analytics`.`events.raw\\`stream` `t0`', $compiled['sql']);
    }

    public function test_clickhouse_identifier_quoting_escapes_backslashes_before_backticks(): void
    {
        $runner = app(ReportRunner::class);
        $slash = chr(92);
        $this->assertSame('`path'.$slash.$slash.'folder'.$slash.'`quoted`', $runner->quote('path'.$slash.'folder`quoted', 'clickhouse'));
        $this->assertSame('`a'.$slash.$slash.$slash.'`b`', $runner->quote('a'.$slash.'`b', 'clickhouse'));
        foreach (['sqlite', 'pgsql'] as $driver) {
            $this->assertSame('"a'.$slash.'""b"', $runner->quote('a'.$slash.'"b', $driver));
        }
    }
}
