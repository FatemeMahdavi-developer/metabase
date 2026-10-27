<?php

namespace Tests\Feature;

use App\Domain\Analytics\DashboardStore;
use App\Models\AnalyticsConnection;
use App\Models\AnalyticsDashboard;
use App\Models\AnalyticsReport;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Validation\ValidationException;
use Tests\TestCase;

class VisualizationSettingsTest extends TestCase
{
    use RefreshDatabase;

    private User $owner;

    private AnalyticsConnection $connection;

    protected function setUp(): void
    {
        parent::setUp();
        $this->owner = User::factory()->create();
        $this->actingAs($this->owner);
        $this->connection = AnalyticsConnection::create(['owner_id' => $this->owner->id, 'name' => 'Catalog only', 'driver' => 'sqlite',
            'configuration' => ['path' => storage_path('framework/absent-visualization-'.bin2hex(random_bytes(6)).'.sqlite')],
            'catalog' => [['key' => 'orders', 'label' => 'Orders', 'fields' => [['key' => 'id', 'label' => 'ID', 'type' => 'number'], ['key' => 'status', 'label' => 'Status', 'type' => 'text'], ['key' => 'amount', 'label' => 'Amount', 'type' => 'number']]]]]);
    }

    private function query(): array
    {
        return ['connection_id' => $this->connection->id, 'source' => 'orders', 'mode' => 'aggregate', 'metrics' => [['key' => 'sales', 'function' => 'sum', 'field' => 'amount']], 'dimensions' => [['field' => 'status']], 'filters' => [], 'sort' => [], 'joins' => [], 'expressions' => [], 'limit' => null, 'limit_explicit' => false];
    }

    private function settings(): array
    {
        return ['series_colors' => [json_encode(['category', 'status', null]) => '#A58AD3', json_encode(['category', 'status', 'null']) => '#f2a86f', json_encode(['category', 'status', 'a.b']) => '#123456'],
            'color_custom' => false, 'color_by_category' => true, 'show_total' => true, 'center_mode' => 'percentage', 'percent_visibility' => 'inside', 'ring_thickness' => 45, 'center_key' => 'sales', 'gauge_style' => 'ring'];
    }

    private function reportPayload(array $settings): array
    {
        return ['name' => 'Donut colors', 'query_definition' => $this->query(), 'display' => 'doughnut', 'visualization_settings' => $settings];
    }

    private function dashboardPayload(AnalyticsReport $report, array $settings): array
    {
        return ['name' => 'Donut dashboard', 'version' => 0, 'settings' => [], 'tabs' => [['key' => 'main', 'name' => 'Main']], 'filters' => [],
            'widgets' => [['key' => 'donut', 'type' => 'report', 'report_id' => $report->id, 'tab_key' => 'main', 'x' => 0, 'y' => 0, 'w' => 12, 'h' => 8, 'settings' => $settings, 'click_behavior' => ['type' => 'menu']]]];
    }

    public function test_question_save_reopen_preserves_typed_series_color_keys_and_donut_settings_without_query_execution(): void
    {
        $saved = $this->postJson('/analytics/api/reports', $this->reportPayload($this->settings()))->assertOk()->json();
        $this->assertSame($this->settings(), $saved['visualization_settings']);
        $this->getJson('/analytics/api/reports/'.$saved['id'])->assertOk()->assertJsonPath('visualization_settings', $this->settings());
        $this->assertFileDoesNotExist($this->connection->configuration['path']);
        $this->assertSame($this->settings(), AnalyticsReport::findOrFail($saved['id'])->visualization_settings);
    }

    public function test_question_validation_rejects_unsafe_colors_runtime_maps_and_invalid_visual_controls(): void
    {
        foreach ([['series_colors' => ['paid' => 'red; background:url(example)']], ['series_colors' => ['paid' => null]], ['_series_colors' => ['paid' => '#123456']], ['color_custom' => 'yes'], ['color_by_category' => 'yes'], ['show_total' => 'yes'], ['center_mode' => 'script'], ['percent_visibility' => 'invalid'], ['ring_thickness' => 9], ['ring_thickness' => 46], ['center_key' => str_repeat('x', 4001)], ['gauge_style' => 'invalid']] as $invalid) {
            $this->postJson('/analytics/api/reports', $this->reportPayload($invalid))->assertUnprocessable();
        }
        $this->assertDatabaseCount('analytics_reports', 0);
    }

    public function test_dashboard_save_preserves_visual_settings_and_rejects_invalid_widget_controls(): void
    {
        $report = AnalyticsReport::create(['owner_id' => $this->owner->id, ...$this->reportPayload([])]);
        $dashboard = AnalyticsDashboard::create(['owner_id' => $this->owner->id, 'name' => 'Donut dashboard', 'version' => 0, 'settings' => []]);
        $store = app(DashboardStore::class);
        foreach ([['series_colors' => ['paid' => '#12']], ['_series_colors' => ['paid' => '#123456']], ['ring_thickness' => -10], ['show_total' => 'yes'], ['center_mode' => 'invalid'], ['percent_visibility' => 'invalid'], ['gauge_style' => 'invalid']] as $invalid) {
            try {
                $store->save($dashboard, $this->dashboardPayload($report, $invalid), $this->owner->id);
                $this->fail('Invalid widget visual settings were accepted.');
            } catch (ValidationException $exception) {
                $this->assertNotEmpty($exception->errors());
            }
        }
        $saved = $store->save($dashboard, $this->dashboardPayload($report, $this->settings()), $this->owner->id);
        $this->assertSame($this->settings(), $saved['widgets'][0]['settings']);
        $this->assertFileDoesNotExist($this->connection->configuration['path']);
    }

    public function test_series_color_map_has_a_server_side_entry_bound(): void
    {
        $colors = array_fill_keys(array_map(fn ($index) => 'series_'.$index, range(0, 12000)), '#123456');
        $this->postJson('/analytics/api/reports', $this->reportPayload(['series_colors' => $colors]))->assertUnprocessable()->assertJsonValidationErrors('visualization_settings.series_colors');
    }
}
