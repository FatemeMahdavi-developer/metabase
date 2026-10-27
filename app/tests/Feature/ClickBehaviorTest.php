<?php

namespace Tests\Feature;

use App\Domain\Analytics\ClickBehaviorValidator;
use App\Models\AnalyticsConnection;
use App\Models\AnalyticsDashboard;
use App\Models\AnalyticsReport;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;
use Tests\TestCase;

class ClickBehaviorTest extends TestCase
{
    use RefreshDatabase;

    private User $owner;

    private AnalyticsConnection $connection;

    protected function setUp(): void
    {
        parent::setUp();
        $this->owner = User::factory()->create();
        $this->connection = AnalyticsConnection::create(['owner_id' => $this->owner->id, 'name' => 'Catalog only', 'driver' => 'sqlite',
            'configuration' => ['path' => storage_path('framework/absent-click-'.bin2hex(random_bytes(6)).'.sqlite')],
            'catalog' => [['key' => 'orders', 'label' => 'Orders', 'fields' => [['key' => 'id', 'label' => 'ID', 'type' => 'number'], ['key' => 'status', 'label' => 'Status', 'type' => 'text'], ['key' => 'ordered_at', 'label' => 'Date', 'type' => 'date']]]]]);
    }

    private function query(array $changes = []): array
    {
        return array_replace(['connection_id' => $this->connection->id, 'source' => 'orders', 'mode' => 'rows', 'metrics' => [], 'dimensions' => [], 'filters' => [], 'sort' => [], 'joins' => [], 'limit' => null, 'limit_explicit' => false], $changes);
    }

    private function filters(): array
    {
        return [['key' => 'category', 'type' => 'text'], ['key' => 'minimum', 'type' => 'number'], ['key' => 'period', 'type' => 'date']];
    }

    private function validateClick(array $click, ?array $query = null, ?int $actor = null): array
    {
        return app(ClickBehaviorValidator::class)->validate($click, $query ?? $this->query(), $this->owner->id, $this->filters(), $actor ?? $this->owner->id);
    }

    private function rejected(array $click, ?array $query = null, ?int $actor = null): void
    {
        try {
            $this->validateClick($click, $query, $actor);
            $this->fail('Invalid click configuration was accepted.');
        } catch (ValidationException $exception) {
            $this->assertNotEmpty($exception->errors());
        }
    }

    public function test_legacy_cross_filter_normalizes_typed_mapping_without_opening_source_database(): void
    {
        $result = $this->validateClick(['type' => 'filter', 'filter_key' => 'category', 'column' => 'status']);
        $this->assertSame([['target' => 'category', 'source' => 'column', 'key' => 'status']], $result['mappings']);
        $this->assertSame('category', $result['filter_key']);
        $this->assertFileDoesNotExist($this->connection->configuration['path']);
        $this->rejected(['type' => 'filter', 'filter_key' => 'category', 'column' => 'id']);
        $this->rejected(['type' => 'filter', 'filter_key' => 'unknown', 'column' => 'status']);
        $this->rejected(['type' => 'filter', 'mappings' => [['target' => 'category', 'source' => 'parameter', 'key' => 'category']]]);
    }

    public function test_output_column_overrides_validate_final_stage_schema_and_reject_nested_configuration(): void
    {
        $stage = ['mode' => 'rows', 'metrics' => [], 'dimensions' => [], 'filters' => [], 'sort' => [], 'columns' => ['count'], 'limit' => null, 'limit_explicit' => false];
        $query = $this->query(['mode' => 'aggregate', 'metrics' => [['key' => 'count', 'function' => 'count']], 'dimensions' => [['field' => 'status']], 'stages' => [$stage]]);
        $result = $this->validateClick(['type' => 'menu', 'columns' => ['count' => ['type' => 'filter', 'filter_key' => 'minimum']]], $query);
        $this->assertSame('count', $result['columns']['count']['mappings'][0]['key']);
        $this->rejected(['type' => 'menu', 'columns' => ['status' => ['type' => 'none']]], $query);
        $this->rejected(['type' => 'menu', 'columns' => ['count' => ['type' => 'menu', 'columns' => ['count' => ['type' => 'none']]]]], $query);
        $this->assertSame(['type' => 'menu'], $this->validateClick([]));
    }

    public function test_dashboard_navigation_checks_access_destinations_and_unique_typed_parameter_mappings(): void
    {
        $destination = AnalyticsDashboard::create(['owner_id' => $this->owner->id, 'name' => 'Destination', 'settings' => [], 'version' => 0]);
        DB::table('analytics_dashboard_filters')->insert(['dashboard_id' => $destination->id, 'key' => 'target_category', 'label' => 'Category', 'type' => 'text', 'required' => false, 'position' => 0, 'settings' => '{}']);
        $click = ['type' => 'dashboard', 'dashboard_id' => $destination->id, 'mappings' => [['target' => 'target_category', 'source' => 'column', 'key' => 'status']]];
        $this->assertSame($destination->id, $this->validateClick($click)['dashboard_id']);
        $click['mappings'][0] = ['target' => 'target_category', 'source' => 'parameter', 'key' => 'category'];
        $this->assertSame('parameter', $this->validateClick($click)['mappings'][0]['source']);
        $click['mappings'][] = $click['mappings'][0];
        $this->rejected($click);
        $click['mappings'] = [['target' => 'target_category', 'source' => 'column', 'key' => 'id']];
        $this->rejected($click);
        $stranger = User::factory()->create();
        $click['mappings'] = [];
        $this->rejected($click, actor: $stranger->id);
        DB::table('analytics_dashboard_members')->insert(['dashboard_id' => $destination->id, 'user_id' => $stranger->id, 'role' => 'viewer']);
        $this->assertSame($destination->id, $this->validateClick($click, actor: $stranger->id)['dashboard_id']);
    }

    public function test_question_navigation_checks_access_and_target_fields_including_native_parameters(): void
    {
        $report = AnalyticsReport::create(['owner_id' => $this->owner->id, 'name' => 'Target', 'query_definition' => $this->query(), 'display' => 'table', 'visualization_settings' => []]);
        $click = ['type' => 'report', 'report_id' => $report->id, 'mappings' => [['target' => 'status', 'source' => 'column', 'key' => 'status']]];
        $this->assertSame($report->id, $this->validateClick($click)['report_id']);
        $click['mappings'][0]['target'] = 'missing';
        $this->rejected($click);
        $click['mappings'][0]['target'] = 'status';
        $stranger = User::factory()->create();
        $this->rejected($click, actor: $stranger->id);
        $dashboard = AnalyticsDashboard::create(['owner_id' => $this->owner->id, 'name' => 'Shared', 'settings' => [], 'version' => 0]);
        DB::table('analytics_dashboard_members')->insert(['dashboard_id' => $dashboard->id, 'user_id' => $stranger->id, 'role' => 'viewer']);
        DB::table('analytics_dashboard_widgets')->insert(['dashboard_id' => $dashboard->id, 'key' => 'target', 'type' => 'report', 'report_id' => $report->id, 'tab_key' => 'main', 'x' => 0, 'y' => 0, 'w' => 12, 'h' => 8, 'settings' => '{}']);
        $this->assertSame($report->id, $this->validateClick($click, actor: $stranger->id)['report_id']);
        $report->update(['query_definition' => $this->query(['mode' => 'native', 'sql' => 'SELECT * FROM orders WHERE status={{category}}', 'parameters' => [['key' => 'category', 'type' => 'text', 'default' => 'paid']]])]);
        $click['mappings'][0]['target'] = 'category';
        $this->assertSame('category', $this->validateClick($click)['mappings'][0]['target']);
    }

    public function test_link_placeholders_use_existing_columns_and_parameters_and_safe_http_urls(): void
    {
        $click = ['type' => 'url', 'url' => 'https://example.com/orders/{{column:id}}?status={{column:status}}&category={{parameter:category}}&value={{value}}', 'link_text' => 'سفارش {{column:id}}'];
        $this->assertSame($click['url'], $this->validateClick($click)['url']);
        $this->assertSame($click['link_text'], $this->validateClick($click)['link_text']);
        foreach (['javascript:alert(1)', 'data:text/html,test', 'https://example.com/{{column:missing}}', 'https://example.com/{{parameter:missing}}', 'https://example.com/{{id}}', 'https://example.com/{{value'] as $url) {
            $this->rejected(['type' => 'url', 'url' => $url]);
        }
    }
}
