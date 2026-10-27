<?php

namespace Tests\Feature;

use App\Domain\Analytics\DashboardStore;
use App\Domain\Analytics\Drivers\ConnectionManager;
use App\Domain\Analytics\FilterValueService;
use App\Models\AnalyticsConnection;
use App\Models\AnalyticsDashboard;
use App\Models\AnalyticsReport;
use App\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;
use PDO;
use Symfony\Component\HttpKernel\Exception\HttpException;
use Tests\TestCase;

class FilterValuesTest extends TestCase
{
    use RefreshDatabase;

    private string $path;

    private User $owner;

    private AnalyticsConnection $connection;

    private AnalyticsDashboard $dashboard;

    private AnalyticsReport $report;

    private array $snapshot;

    protected function setUp(): void
    {
        parent::setUp();
        $this->owner = User::factory()->create();
        $this->actingAs($this->owner);
        $this->path = storage_path('framework/filter-values-'.bin2hex(random_bytes(6)).'.sqlite');
        $pdo = new PDO('sqlite:'.$this->path);
        $pdo->exec('CREATE TABLE records (id INTEGER PRIMARY KEY, label TEXT, segment INTEGER, happened_at TIMESTAMP, flag BOOLEAN)');
        $pdo->beginTransaction();
        $statement = $pdo->prepare('INSERT INTO records VALUES (?, ?, ?, ?, ?)');
        for ($index = 1; $index <= 250; $index++) {
            $statement->execute([$index, 'Name'.str_pad((string) $index, 3, '0', STR_PAD_LEFT), $index % 2, '2026-03-'.str_pad((string) (($index % 15) + 1), 2, '0', STR_PAD_LEFT).' 12:00:00', $index % 2]);
        }
        $statement->execute([251, null, 0, '2026-03-15 23:59:59', 0]);
        $statement->execute([252, '100%_literal', 0, '2026-02-28 23:59:59', 0]);
        $pdo->commit();
        $pdo = null;
        $this->connection = AnalyticsConnection::create(['owner_id' => $this->owner->id, 'name' => 'Fixture', 'driver' => 'sqlite', 'configuration' => ['path' => $this->path]]);
        app(ConnectionManager::class)->sync($this->connection);
        $this->report = AnalyticsReport::create(['owner_id' => $this->owner->id, 'name' => 'Records', 'query_definition' => $this->query(), 'display' => 'table', 'visualization_settings' => []]);
        $this->dashboard = AnalyticsDashboard::create(['owner_id' => $this->owner->id, 'name' => 'Filter values', 'settings' => []]);
        $this->snapshot = ['widgets' => [['key' => 'card', 'type' => 'report', 'report_id' => $this->report->id]], 'filters' => [$this->filter('label', 'label', 'text'), $this->filter('id', 'id', 'number'), $this->filter('segment', 'segment', 'number')]];
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
        return array_replace(['connection_id' => $this->connection->id, 'source' => 'records', 'mode' => 'rows', 'metrics' => [], 'dimensions' => [], 'filters' => [], 'sort' => [], 'joins' => [], 'expressions' => [], 'limit' => 2, 'limit_explicit' => true, 'columns' => ['id', 'label', 'segment', 'happened_at', 'flag']], $changes);
    }

    private function filter(string $key, string $target, string $type, array $changes = []): array
    {
        return array_replace(['key' => $key, 'label' => $key, 'type' => $type, 'required' => false, 'default_value' => null, 'settings' => [], 'bindings' => [['widget_key' => 'card', 'target' => $target, 'operator' => 'eq']]], $changes);
    }

    private function values(string $filter, array $parameters = [], array $options = []): array
    {
        return app(FilterValueService::class)->options($this->dashboard, $this->snapshot, $filter, $parameters, $options);
    }

    private function savePayload(array $filters, array $click = ['type' => 'menu']): array
    {
        return ['name' => 'Filter values', 'description' => '', 'folder_id' => null, 'version' => $this->dashboard->fresh()->version,
            'settings' => ['auto_apply' => false], 'tabs' => [['key' => 'main', 'name' => 'Main']],
            'widgets' => [['key' => 'card', 'type' => 'report', 'report_id' => $this->report->id, 'tab_key' => 'main', 'x' => 0, 'y' => 0, 'w' => 12, 'h' => 6, 'settings' => [], 'content' => null, 'click_behavior' => $click]], 'filters' => $filters];
    }

    public function test_search_reaches_values_beyond_first_page_and_escapes_wildcards(): void
    {
        $first = $this->values('id', [], ['limit' => 50]);
        $this->assertSame(range(1, 50), $first['values']);
        $this->assertTrue($first['has_more']);
        $second = $this->values('id', [], ['limit' => 50, 'cursor' => $first['next_cursor']]);
        $this->assertSame(range(51, 100), $second['values']);
        $this->assertSame(['Name249'], $this->values('label', [], ['search' => 'name249'])['values']);
        $this->assertSame(['100%_literal'], $this->values('label', [], ['search' => '%_'])['values']);
        $this->assertSame([], $this->values('label', [], ['search' => "' OR 1=1 --"])['values']);
        $this->assertSame([250], $this->values('id', [], ['search' => '250'])['values']);
    }

    public function test_search_preserves_linked_zero_and_other_values_but_excludes_self(): void
    {
        $this->snapshot['filters'][0]['settings']['parent_key'] = 'segment';
        $this->assertSame('segment', $this->values('label')['waiting_for_filter']);
        $result = $this->values('label', ['segment' => 0, 'label' => 'Name001'], ['limit' => 100]);
        $this->assertContains('Name002', $result['values']);
        $this->assertNotContains('Name001', $result['values']);
        $this->assertTrue($result['null_available']);
        $this->assertSame([], $this->values('label', ['segment' => null])['values']);
        $this->snapshot['filters'][2]['default_value'] = 1;
        $this->assertSame([], $this->values('label', ['segment' => null])['values']);
    }

    public function test_stage_candidates_preserve_earlier_explicit_limit(): void
    {
        $stage = ['mode' => 'rows', 'columns' => ['id', 'label'], 'metrics' => [], 'dimensions' => [], 'filters' => [], 'sort' => [], 'joins' => [], 'expressions' => [], 'limit' => null, 'limit_explicit' => false];
        $this->report->update(['query_definition' => $this->query(['limit' => 1, 'stages' => [$stage]])]);
        $this->snapshot['filters'][0]['bindings'][0]['target'] = 'stage:0:label';
        $this->assertSame(['Name001'], $this->values('label')['values']);
    }

    public function test_cursors_cannot_be_tampered_with_or_reused_for_another_search(): void
    {
        $cursor = $this->values('id', [], ['limit' => 5])['next_cursor'];
        foreach ([$cursor.'tampered', $cursor] as $index => $candidate) {
            try {
                $this->values('id', [], ['cursor' => $candidate, 'search' => $index ? '2' : '']);
                $this->fail('Invalid cursor was accepted.');
            } catch (ValidationException $exception) {
                $this->assertArrayHasKey('cursor', $exception->errors());
            }
        }
    }

    public function test_custom_and_native_values_do_not_execute_arbitrary_native_sql(): void
    {
        $this->snapshot['filters'][0]['settings']['values'] = ['A', 'B', 'C'];
        $first = $this->values('label', [], ['limit' => 2]);
        $this->assertSame(['A', 'B'], $first['values']);
        $this->assertSame(['C'], $this->values('label', [], ['limit' => 2, 'cursor' => $first['next_cursor']])['values']);
        $this->report->update(['query_definition' => $this->query(['mode' => 'native', 'sql' => 'SELECT impossible FROM missing', 'parameters' => [['key' => 'label', 'type' => 'text', 'default' => 'A']]])]);
        $this->assertSame(['B'], $this->values('label', [], ['search' => 'b'])['values']);
        $this->snapshot['filters'][0]['settings']['values'] = [];
        $this->assertSame([], $this->values('label')['values']);
    }

    public function test_shared_viewers_are_allowed_and_other_accounts_are_rejected(): void
    {
        $viewer = User::factory()->create();
        $this->actingAs($viewer);
        try {
            $this->values('id');
            $this->fail('Unauthorized values were exposed.');
        } catch (HttpException $exception) {
            $this->assertSame(403, $exception->getStatusCode());
        }
        DB::table('analytics_dashboard_members')->insert(['dashboard_id' => $this->dashboard->id, 'user_id' => $viewer->id, 'role' => 'viewer']);
        $this->assertSame([1, 2], $this->values('id', [], ['limit' => 2])['values']);
        $this->snapshot['widgets'][0]['report_id'] = AnalyticsReport::create(['owner_id' => $viewer->id, 'name' => 'Foreign', 'query_definition' => $this->query(), 'display' => 'table', 'visualization_settings' => []])->id;
        $this->expectException(ModelNotFoundException::class);
        $this->values('id');
    }

    public function test_null_marker_is_distinct_from_clearing_and_required_filters_wait(): void
    {
        $store = app(DashboardStore::class);
        $this->snapshot['filters'][0]['required'] = true;
        $this->assertSame('label', $store->widgetQuery($this->dashboard, 'card', [], false, false, $this->snapshot)['meta']['waiting_for_filter']);
        $result = $store->widgetQuery($this->dashboard, 'card', ['label' => ['kind' => 'null']], true, false, $this->snapshot);
        $this->assertSame(251.0, $result['rows'][0]['id']);
        $this->assertSame(1, count($result['rows']));
        $this->snapshot['filters'][0]['required'] = false;
        $this->assertSame(2, count($store->widgetQuery($this->dashboard, 'card', ['label' => null], true, false, $this->snapshot)['rows']));
    }

    public function test_relative_dates_follow_metabase_period_semantics_and_recompute_each_day(): void
    {
        $store = app(DashboardStore::class);
        CarbonImmutable::setTestNow('2026-03-15 10:00:00');
        $marker = ['kind' => 'relative_date', 'unit' => 'day', 'amount' => 7, 'direction' => 'past', 'include_current' => false];
        $this->assertSame(['2026-03-08', '2026-03-14', false], $store->dateParameterRange($marker));
        $this->assertSame(['2026-03-08', '2026-03-15', false], $store->dateParameterRange([...$marker, 'include_current' => true]));
        CarbonImmutable::setTestNow('2026-03-16 10:00:00');
        $this->assertSame(['2026-03-09', '2026-03-15', false], $store->dateParameterRange($marker));
        $this->assertSame(['2026-02-01', '2026-02-28', true], $store->dateParameterRange([...$marker, 'unit' => 'month', 'amount' => 1, 'exclude' => true]));
        $this->assertSame(['2026-01-01', '2026-03-31', false], $store->dateParameterRange([...$marker, 'unit' => 'quarter', 'direction' => 'current']));
        $this->assertSame(['2026-04-01', '2026-05-31', false], $store->dateParameterRange([...$marker, 'unit' => 'month', 'amount' => 2, 'direction' => 'future']));
    }

    public function test_filter_settings_preserve_false_zero_and_column_click_rules_when_saved(): void
    {
        $filters = [$this->filter('flag', 'flag', 'boolean', ['default_value' => false, 'required' => true]),
            $this->filter('segment', 'segment', 'number', ['default_value' => 0, 'settings' => ['widget_type' => 'input']])];
        $click = ['type' => 'menu', 'columns' => ['id' => ['type' => 'filter', 'filter_key' => 'segment', 'column' => 'segment'], 'label' => ['type' => 'none']]];
        $store = app(DashboardStore::class);
        $saved = $store->save($this->dashboard, $this->savePayload($filters, $click), $this->owner->id);
        $this->assertFalse($saved['filters'][0]['default_value']);
        $this->assertSame(0, $saved['filters'][1]['default_value']);
        $this->assertSame('input', $saved['filters'][1]['settings']['widget_type']);
        $this->assertSame('none', $saved['widgets'][0]['click_behavior']['columns']['label']['type']);
        $this->assertSame('segment', $saved['widgets'][0]['click_behavior']['columns']['id']['mappings'][0]['target']);
        $context = $store->interactionContext($this->dashboard, 'card');
        $this->assertArrayNotHasKey('waiting_for_filter', $context);
        $this->assertSame([0, 0], array_column($context['extra_filters'], 'value'));
    }

    public function test_symbolic_and_null_defaults_round_trip_without_freezing_the_date(): void
    {
        $store = app(DashboardStore::class);
        CarbonImmutable::setTestNow('2026-03-15 10:00:00');
        $marker = ['kind' => 'relative_date', 'unit' => 'day', 'amount' => 7, 'direction' => 'past', 'include_current' => false, 'exclude' => false];
        $filter = $this->filter('period', 'happened_at', 'date', ['default_value' => $marker, 'bindings' => [['widget_key' => 'card', 'target' => 'happened_at', 'operator' => 'between']]]);
        $saved = $store->save($this->dashboard, $this->savePayload([$filter]), $this->owner->id);
        $this->assertSame($marker, $saved['filters'][0]['default_value']);
        $this->assertSame(['2026-03-08', '2026-03-14'], $store->interactionContext($this->dashboard, 'card')['extra_filters'][0]['value']);
        CarbonImmutable::setTestNow('2026-03-16 10:00:00');
        $this->assertSame(['2026-03-09', '2026-03-15'], $store->interactionContext($this->dashboard, 'card')['extra_filters'][0]['value']);
        $null = $this->filter('blank', 'label', 'text', ['default_value' => ['kind' => 'null'], 'required' => true, 'settings' => ['widget_type' => 'search']]);
        $saved = $store->save($this->dashboard->fresh(), $this->savePayload([$null]), $this->owner->id);
        $this->assertSame(['kind' => 'null'], $saved['filters'][0]['default_value']);
        $this->assertSame(251.0, $store->widgetQuery($this->dashboard, 'card', [])['rows'][0]['id']);
    }

    public function test_custom_lists_and_free_inputs_cannot_have_linked_value_dependencies(): void
    {
        foreach ([['widget_type' => 'input'], ['widget_type' => 'dropdown', 'values' => ['Name001']]] as $settings) {
            $filters = [$this->filter('segment', 'segment', 'number'), $this->filter('label', 'label', 'text', ['settings' => [...$settings, 'parent_key' => 'segment']])];
            try {
                app(DashboardStore::class)->save($this->dashboard, $this->savePayload($filters), $this->owner->id);
                $this->fail('Unsupported linked source was accepted.');
            } catch (ValidationException $exception) {
                $this->assertNotEmpty($exception->errors());
            }
        }
    }

    public function test_native_simple_date_parameters_reject_range_and_null_defaults(): void
    {
        $this->report->update(['query_definition' => $this->query(['mode' => 'native', 'sql' => 'SELECT id FROM records WHERE happened_at >= {{since}}', 'parameters' => [['key' => 'since', 'type' => 'date', 'default' => '2026-01-01']]])]);
        foreach ([['kind' => 'null'], ['kind' => 'relative_date', 'unit' => 'day', 'amount' => 7, 'direction' => 'past'], ['kind' => 'date_range', 'from' => '2026-03-01', 'to' => '2026-03-07', 'exclude' => true]] as $marker) {
            $filter = $this->filter('since', 'since', 'date', ['default_value' => $marker]);
            try {
                app(DashboardStore::class)->save($this->dashboard, $this->savePayload([$filter]), $this->owner->id);
                $this->fail('A multi-value default for a simple SQL variable was accepted.');
            } catch (ValidationException $exception) {
                $this->assertArrayHasKey('parameters', $exception->errors());
            }
        }
    }

    public function test_excluded_weekdays_months_quarters_and_hours_match_the_actual_timestamp_values(): void
    {
        $this->report->update(['query_definition' => $this->query(['limit' => null, 'limit_explicit' => false])]);
        $pdo = new PDO('sqlite:'.$this->path);
        $pdo->exec("INSERT INTO records VALUES (253, 'Undated', 1, NULL, 1)");
        $rows = $pdo->query('SELECT id, happened_at FROM records ORDER BY id')->fetchAll(PDO::FETCH_ASSOC);
        $snapshot = [...$this->snapshot, 'filters' => [$this->filter('period', 'happened_at', 'date')]];
        $store = app(DashboardStore::class);
        foreach ([['day_of_week', [6, 7]], ['month', [2]], ['quarter', [1]], ['hour', [12]]] as [$part, $values]) {
            foreach ([true, false] as $exclude) {
                $marker = ['kind' => 'date_parts', 'part' => $part, 'values' => $values, 'exclude' => $exclude];
                $expected = [];
                foreach ($rows as $row) {
                    if ($row['happened_at'] === null) {
                        continue;
                    }
                    $date = new \DateTimeImmutable($row['happened_at']);
                    $value = match ($part) {
                        'day_of_week' => (int) $date->format('N'), 'month' => (int) $date->format('n'), 'quarter' => (int) ceil((int) $date->format('n') / 3), 'hour' => (int) $date->format('G')
                    };
                    if (in_array($value, $values, true) !== $exclude) {
                        $expected[] = (int) $row['id'];
                    }
                }
                $result = $store->widgetQuery($this->dashboard, 'card', ['period' => $marker], true, false, $snapshot);
                $actual = array_map('intval', array_column($result['rows'], 'id'));
                sort($actual);
                $this->assertSame($expected, $actual, $part.' exclude='.(int) $exclude);
            }
        }
        $this->assertSame([253], array_map('intval', array_column($store->widgetQuery($this->dashboard, 'card', ['period' => ['kind' => 'presence', 'empty' => true]], true, false, $snapshot)['rows'], 'id')));
        $this->assertCount(252, $store->widgetQuery($this->dashboard, 'card', ['period' => ['kind' => 'presence', 'empty' => false]], true, false, $snapshot)['rows']);
    }

    public function test_date_part_defaults_round_trip_and_invalid_parts_are_rejected(): void
    {
        $store = app(DashboardStore::class);
        $marker = ['kind' => 'date_parts', 'part' => 'hour', 'values' => [0, 23], 'exclude' => true];
        $filter = $this->filter('period', 'happened_at', 'date', ['default_value' => $marker]);
        $saved = $store->save($this->dashboard, $this->savePayload([$filter]), $this->owner->id);
        $this->assertSame($marker, $saved['filters'][0]['default_value']);
        $condition = $store->interactionContext($this->dashboard, 'card')['extra_filters'][0];
        $this->assertSame('hour', $condition['date_part']);
        $this->assertSame('not_in', $condition['operator']);
        $this->assertSame([0, 23], $condition['value']);
        foreach ([['part' => 'month', 'values' => [13]], ['part' => 'day_of_week', 'values' => [0]], ['part' => 'quarter', 'values' => [0]], ['part' => 'hour', 'values' => [24]], ['part' => 'hour', 'values' => []], ['part' => 'hour); DROP TABLE records', 'values' => [1]]] as $invalid) {
            try {
                $store->parameterFilter($filter, $filter['bindings'][0], [...$marker, ...$invalid]);
                $this->fail('Invalid date part was accepted.');
            } catch (ValidationException $exception) {
                $this->assertNotEmpty($exception->errors());
            }
        }
    }

    public function test_parent_choices_ignore_transitive_descendant_constraints(): void
    {
        $this->snapshot['filters'][1]['settings']['parent_key'] = 'segment';
        $this->snapshot['filters'][0]['settings']['parent_key'] = 'id';
        $result = $this->values('segment', ['segment' => 1, 'id' => 1, 'label' => 'Name001']);
        $this->assertSame([0, 1], $result['values']);
        $idChoices = $this->values('id', ['segment' => 0, 'id' => 2, 'label' => 'Name002'], ['limit' => 3]);
        $this->assertSame([2, 4, 6], $idChoices['values']);
        $this->snapshot['filters'][0]['default_value'] = 'Name001';
        $this->assertSame([0, 1], $this->values('segment')['values']);
    }

    public function test_literal_empty_values_are_distinct_from_clearing_and_zero_false_stay_selected(): void
    {
        $pdo = new PDO('sqlite:'.$this->path);
        $pdo->exec("INSERT INTO records VALUES (254, '', 0, '2026-03-01', 0)");
        $result = $this->values('label');
        $this->assertContains('', $result['values']);
        $this->assertTrue($result['null_available']);
        $store = app(DashboardStore::class);
        $filtered = $store->widgetQuery($this->dashboard, 'card', ['label' => ['kind' => 'empty']], true, false, $this->snapshot);
        $this->assertSame([251, 254], array_map('intval', array_column($filtered['rows'], 'id')));
        $nullOnly = $store->widgetQuery($this->dashboard, 'card', ['label' => ['kind' => 'null']], true, false, $this->snapshot);
        $this->assertSame([251], array_map('intval', array_column($nullOnly['rows'], 'id')));
        $this->assertSame(2, count($store->widgetQuery($this->dashboard, 'card', ['label' => null], true, false, $this->snapshot)['rows']));
        $this->snapshot['filters'][] = $this->filter('flag', 'flag', 'boolean');
        $context = $store->interactionContext($this->dashboard, 'card', ['flag' => false, 'segment' => 0], $this->snapshot);
        $this->assertSame([0, 0], array_column($context['extra_filters'], 'value'));
    }

    public function test_negative_bindings_exclude_selected_null_or_empty_categories(): void
    {
        $pdo = new PDO('sqlite:'.$this->path);
        $pdo->exec("INSERT INTO records VALUES (254, '', 0, '2026-03-01', 0)");
        $this->report->update(['query_definition' => $this->query(['limit' => null, 'limit_explicit' => false])]);
        $store = app(DashboardStore::class);
        foreach (['neq', 'not_in', 'not_null', 'not_empty', 'not_contains'] as $operator) {
            $snapshot = $this->snapshot;
            $snapshot['filters'][0]['bindings'][0]['operator'] = $operator;
            $null = $store->widgetQuery($this->dashboard, 'card', ['label' => ['kind' => 'null']], true, false, $snapshot);
            $this->assertNotContains(251.0, array_column($null['rows'], 'id'), $operator);
            $this->assertContains(254.0, array_column($null['rows'], 'id'), $operator);
            $empty = $store->widgetQuery($this->dashboard, 'card', ['label' => ['kind' => 'empty']], true, false, $snapshot);
            $this->assertNotContains(251.0, array_column($empty['rows'], 'id'), $operator);
            $this->assertNotContains(254.0, array_column($empty['rows'], 'id'), $operator);
            $this->assertContains(1.0, array_column($empty['rows'], 'id'), $operator);
        }
    }
}
