<?php

namespace Tests\Feature;

use App\Filament\Pages\AnalyticsDashboardView;
use App\Filament\Pages\AnalyticsReportEditor;
use App\Models\AnalyticsConnection;
use App\Models\AnalyticsDashboard;
use App\Models\AnalyticsReport;
use App\Models\User;
use Filament\Facades\Filament;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Livewire\Features\SupportLockedProperties\CannotUpdateLockedPropertyException;
use Livewire\Livewire;
use Tests\TestCase;

class NativeAnalyticsWorkbenchTest extends TestCase
{
    use RefreshDatabase;

    private User $owner;

    protected function setUp(): void
    {
        parent::setUp();
        config(['app.env' => 'local']);
        $this->owner = User::factory()->create();
        Filament::setCurrentPanel(Filament::getPanel('admin'));
        Filament::bootCurrentPanel();
    }

    private function records(): array
    {
        $connection = AnalyticsConnection::create([
            'owner_id' => $this->owner->id,
            'name' => 'Private workbench source',
            'driver' => 'sqlite',
            // HTTP rendering must not connect to a data source; JavaScript loads it separately.
            'configuration' => ['path' => '/unused-workbench-http-test.sqlite'],
        ]);
        $report = AnalyticsReport::create([
            'owner_id' => $this->owner->id,
            'name' => 'Private workbench report',
            'display' => 'table',
            'visualization_settings' => [],
            'query_definition' => ['connection_id' => $connection->id, 'source' => 'events', 'mode' => 'rows'],
        ]);
        $dashboard = AnalyticsDashboard::create([
            'owner_id' => $this->owner->id,
            'name' => 'Private workbench dashboard',
            'settings' => [],
        ]);

        return [$dashboard, $report, $connection];
    }

    public function test_guests_are_redirected_to_the_panel_login_for_every_analytics_entry(): void
    {
        foreach ([
            '/admin/analytics',
            '/admin/analytics/dashboards',
            '/admin/analytics/dashboards/1',
            '/admin/analytics/dashboards/1/view',
            '/admin/analytics/reports',
            '/admin/analytics/reports/1',
            '/admin/analytics/reports/new',
            '/admin/analytics/databases',
            '/admin/analytics/databases/1',
        ] as $path) {
            $this->get($path)->assertRedirect('/admin/login');
        }
    }

    public function test_owners_can_refresh_each_direct_workbench_url_with_its_locked_context(): void
    {
        [$dashboard, $report, $connection] = $this->records();
        $this->actingAs($this->owner);

        foreach ([
            ['dashboards', $dashboard->id, 'dashboard'],
            ['reports', $report->id, 'report'],
            ['reports', 'new', 'report'],
            ['databases', $connection->id, 'browser'],
        ] as [$section, $id, $view]) {
            $this->get('/admin/analytics/'.$section.'/'.$id)->assertOk()
                ->assertSee('id="analytics-studio"', false)
                ->assertSee('data-section="'.$view.'"', false)
                ->assertSee('data-record="'.$id.'"', false)
                ->assertSee('fi-sidebar', false);
        }
    }

    public function test_foreign_records_are_rejected_before_the_workbench_is_rendered(): void
    {
        [$dashboard, $report, $connection] = $this->records();
        $this->actingAs(User::factory()->create());

        $this->get('/admin/analytics/dashboards/'.$dashboard->id)->assertForbidden()->assertDontSee('id="analytics-studio"', false);
        $this->get('/admin/analytics/dashboards/'.$dashboard->id.'/view')->assertForbidden()->assertDontSee('id="analytics-studio"', false);
        $this->get('/admin/analytics/reports/'.$report->id)->assertNotFound()->assertDontSee('id="analytics-studio"', false);
        $this->get('/admin/analytics/databases/'.$connection->id)->assertNotFound()->assertDontSee('id="analytics-studio"', false);
    }

    public function test_a_shared_dashboard_remains_readable_until_membership_is_revoked(): void
    {
        [$dashboard] = $this->records();
        $viewer = User::factory()->create();
        DB::table('analytics_dashboard_members')->insert(['dashboard_id' => $dashboard->id, 'user_id' => $viewer->id, 'role' => 'viewer']);
        $this->actingAs($viewer);
        $url = '/admin/analytics/dashboards/'.$dashboard->id;

        $this->get($url)->assertOk()->assertSee('data-record="'.$dashboard->id.'"', false);
        $this->get($url.'/view')->assertOk()->assertSee('data-read-only="true"', false);
        DB::table('analytics_dashboard_members')->where('dashboard_id', $dashboard->id)->where('user_id', $viewer->id)->delete();
        $this->get($url)->assertForbidden();
        $this->get($url.'/view')->assertForbidden();
    }

    public function test_dashboard_view_has_its_own_route_and_keeps_the_editor_separate(): void
    {
        [$dashboard] = $this->records();
        $this->actingAs($this->owner);
        $url = '/admin/analytics/dashboards/'.$dashboard->id.'/view';

        $this->assertSame($url, parse_url(AnalyticsDashboardView::getUrl(['record' => $dashboard->id]), PHP_URL_PATH));
        $this->get($url)->assertOk()->assertSee('data-read-only="true"', false);
        $this->get('/admin/analytics/dashboards/'.$dashboard->id)->assertOk()->assertSee('data-read-only="false"', false);
        $component = Livewire::test(AnalyticsDashboardView::class, ['record' => (string) $dashboard->id]);
        $routes = $component->instance()->getAnalyticsRoutes();
        $this->assertStringEndsWith('/__record__/view', $routes['dashboard']);
    }

    public function test_invalid_record_identifiers_do_not_fall_back_to_a_different_editor(): void
    {
        $this->actingAs($this->owner);
        foreach ([
            '/admin/analytics/dashboards/new',
            '/admin/analytics/dashboards/-1',
            '/admin/analytics/dashboards/unexpected/view',
            '/admin/analytics/dashboards/999999/view',
            '/admin/analytics/reports/unexpected',
            '/admin/analytics/reports/1.5',
            '/admin/analytics/databases/new',
            '/admin/analytics/databases/0',
        ] as $path) {
            $this->get($path)->assertNotFound();
        }
    }

    public function test_the_previous_studio_entry_redirects_to_the_native_dashboard_resource(): void
    {
        $this->actingAs($this->owner);
        $this->get('/admin/analytics')->assertRedirect('/admin/analytics/dashboards');
    }

    public function test_livewire_clients_cannot_replace_the_mounted_record_identifier(): void
    {
        [, $report] = $this->records();
        $this->actingAs($this->owner);
        $this->expectException(CannotUpdateLockedPropertyException::class);

        Livewire::test(AnalyticsReportEditor::class, ['record' => (string) $report->id])
            ->set('recordId', (string) ($report->id + 100));
    }
}
