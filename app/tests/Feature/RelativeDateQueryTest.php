<?php

namespace Tests\Feature;

use App\Domain\Analytics\DashboardStore;
use App\Domain\Analytics\DateFilterRange;
use App\Domain\Analytics\DrillService;
use App\Domain\Analytics\Drivers\ConnectionManager;
use App\Domain\Analytics\ReportRunner;
use App\Models\AnalyticsConnection;
use App\Models\AnalyticsReport;
use App\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Validation\ValidationException;
use PDO;
use Tests\TestCase;

class RelativeDateQueryTest extends TestCase
{
    use RefreshDatabase;

    private User $owner;

    private AnalyticsConnection $connection;

    private string $path;

    protected function setUp(): void
    {
        parent::setUp();
        config(['app.timezone' => 'UTC']);
        $this->owner = User::factory()->create();
        $this->actingAs($this->owner);
        $this->path = storage_path('framework/relative-query-'.bin2hex(random_bytes(6)).'.sqlite');
        $pdo = new PDO('sqlite:'.$this->path);
        $pdo->exec("CREATE TABLE records (id INTEGER PRIMARY KEY, happened_at TIMESTAMP, amount DECIMAL);
            INSERT INTO records VALUES (1,'2026-01-01 00:00:00',10),(2,'2026-01-20 12:00:00',20),(3,'2026-01-31 23:59:59',30),(4,'2026-02-01 00:00:00',40),(5,'2026-02-28 23:59:59',50),(6,'2026-03-01 00:00:00',60),(7,'2026-03-15 12:00:00',70),(8,NULL,80);");
        $pdo = null;
        $this->connection = AnalyticsConnection::create(['owner_id' => $this->owner->id, 'name' => 'Relative dates', 'driver' => 'sqlite', 'configuration' => ['path' => $this->path]]);
        app(ConnectionManager::class)->sync($this->connection);
    }

    protected function tearDown(): void
    {
        CarbonImmutable::setTestNow();
        parent::tearDown();
        if (isset($this->path) && is_file($this->path)) {
            unlink($this->path);
        }
    }

    private function query(array $changes = []): array
    {
        return array_replace(['connection_id' => $this->connection->id, 'source' => 'records', 'mode' => 'rows', 'metrics' => [], 'dimensions' => [], 'filters' => [], 'sort' => [['key' => 'id', 'direction' => 'asc']], 'joins' => [], 'expressions' => [], 'limit' => null, 'limit_explicit' => false], $changes);
    }

    private function relative(array $changes = []): array
    {
        return array_replace(['unit' => 'month', 'amount' => 1, 'direction' => 'past', 'include_current' => false], $changes);
    }

    private function clause(array $changes = []): array
    {
        return array_replace(['field' => 'happened_at', 'operator' => 'between', 'value' => null, 'relative_date' => $this->relative()], $changes);
    }

    public function test_saved_question_preserves_relative_descriptor_and_recomputes_after_clock_advances(): void
    {
        CarbonImmutable::setTestNow('2026-02-15 12:00:00 UTC');
        $clause = $this->clause();
        $saved = $this->postJson('/analytics/api/reports', ['name' => 'Previous month', 'query_definition' => $this->query(['filters' => [$clause]]), 'display' => 'table', 'visualization_settings' => []])->assertOk()->assertJsonPath('query_definition.filters.0', $clause)->json();
        $report = AnalyticsReport::findOrFail($saved['id']);
        $this->getJson('/analytics/api/reports/'.$report->id)->assertOk()->assertJsonPath('query_definition.filters.0', $clause);
        $response = $this->postJson('/analytics/api/reports/'.$report->id.'/query')->assertOk();
        $this->assertSame([1, 2, 3], array_column($response->json('rows'), 'id'));
        $this->assertSame([1.0, 2.0, 3.0], array_column(app(ReportRunner::class)->run($report->query_definition, $this->owner->id)['rows'], 'id'));
        CarbonImmutable::setTestNow('2026-03-15 12:00:00 UTC');
        $result = app(ReportRunner::class)->run($report->fresh()->query_definition, $this->owner->id);
        $this->assertSame([4.0, 5.0], array_column($result['rows'], 'id'));
        $this->assertFalse($result['meta']['cached']);
        $this->assertSame($clause, $report->fresh()->query_definition['filters'][0]);
    }

    public function test_relative_date_complements_and_output_stage_filters_preserve_symbolic_definitions(): void
    {
        CarbonImmutable::setTestNow('2026-02-15 12:00:00 UTC');
        $runner = app(ReportRunner::class);
        $query = $this->query(['filters' => [$this->clause(['operator' => 'not_between'])]]);
        $this->assertSame([4.0, 5.0, 6.0, 7.0], array_column($runner->run($query, $this->owner->id)['rows'], 'id'));
        $stage = ['mode' => 'rows', 'metrics' => [], 'dimensions' => [], 'filters' => [$this->clause()], 'sort' => [['key' => 'id', 'direction' => 'asc']], 'columns' => ['id', 'happened_at'], 'limit' => null, 'limit_explicit' => false];
        $query = $this->query(['stages' => [$stage]]);
        $validated = $runner->validate($query, $this->owner->id);
        $this->assertSame($this->relative(), $validated['stages'][0]['filters'][0]['relative_date']);
        $this->assertNull($validated['stages'][0]['filters'][0]['value']);
        $this->assertSame([1.0, 2.0, 3.0], array_column($runner->run($validated, $this->owner->id)['rows'], 'id'));
        CarbonImmutable::setTestNow('2026-03-15 12:00:00 UTC');
        $this->assertSame([4.0, 5.0], array_column($runner->run($validated, $this->owner->id)['rows'], 'id'));
        foreach (['pgsql' => 'CAST("t0"."happened_at" AS date)', 'clickhouse' => 'toDate(`t0`.`happened_at`)'] as $driver => $dateSql) {
            $connection = clone $this->connection;
            $connection->driver = $driver;
            $compiled = $runner->compile($runner->validate($this->query(['filters' => [$this->clause()]]), $this->owner->id), $connection);
            $this->assertSame(['p0' => '2026-02-01', 'p1' => '2026-02-28'], $compiled['bindings']);
            $this->assertStringContainsString($dateSql, $compiled['sql']);
        }
    }

    public function test_common_relative_ranges_use_application_timezone_and_existing_dashboard_period_semantics(): void
    {
        config(['app.timezone' => 'America/Los_Angeles']);
        CarbonImmutable::setTestNow('2026-03-01 01:00:00 UTC');
        $relative = $this->relative(['direction' => 'current']);
        $this->assertSame(['2026-02-01', '2026-02-28'], app(DateFilterRange::class)->relativeRange($relative));
        $this->assertSame(['2026-02-01', '2026-02-28', false], app(DashboardStore::class)->dateParameterRange(['kind' => 'relative_date', ...$relative]));
        $result = app(ReportRunner::class)->run($this->query(['filters' => [$this->clause(['relative_date' => $relative])]]), $this->owner->id);
        $this->assertSame([4.0, 5.0], array_column($result['rows'], 'id'));
    }

    public function test_relative_date_rejects_inapplicable_fields_operators_fixed_values_and_unbounded_properties(): void
    {
        foreach ([$this->clause(['field' => 'amount']), $this->clause(['operator' => 'eq']), $this->clause(['value' => ['2026-01-01', '2026-01-31']]), $this->clause(['date_part' => 'month']), $this->clause(['relative_date' => $this->relative(['amount' => 0])]), $this->clause(['relative_date' => $this->relative(['amount' => 366])]), $this->clause(['relative_date' => $this->relative(['unit' => 'hour'])]), $this->clause(['relative_date' => $this->relative(['sql' => '1 OR 1=1'])])] as $invalid) {
            $this->postJson('/analytics/api/reports/validate', ['query_definition' => $this->query(['filters' => [$invalid]])])->assertUnprocessable();
        }
    }

    public function test_structured_custom_drill_preserves_relative_date_but_native_sql_rejects_symbolic_input(): void
    {
        CarbonImmutable::setTestNow('2026-02-15 12:00:00 UTC');
        $service = app(DrillService::class);
        $input = ['operator' => 'between', 'value' => null, 'relative_date' => $this->relative()];
        $result = $service->apply($this->query(), $this->owner->id, ['column_key' => 'happened_at', 'row_index' => null], 'filter:custom', [], $input);
        $this->assertSame([1.0, 2.0, 3.0], array_column($result['result']['rows'], 'id'));
        $this->assertSame($this->clause(), $result['query_definition']['filters'][0]);
        $query = $this->query(['mode' => 'native', 'sql' => 'SELECT id,happened_at FROM records ORDER BY id', 'parameters' => []]);
        try {
            $service->apply($query, $this->owner->id, ['column_key' => 'happened_at', 'row_index' => null], 'filter:custom', [], $input);
            $this->fail('Native drill silently froze a relative date.');
        } catch (ValidationException $exception) {
            $this->assertArrayHasKey('relative_date', $exception->errors());
        }
    }
}
