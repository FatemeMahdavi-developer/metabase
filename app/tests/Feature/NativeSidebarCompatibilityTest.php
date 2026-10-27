<?php

namespace Tests\Feature;

use App\Filament\Resources\AnalyticsDashboardResource;
use App\Models\User;
use DOMDocument;
use DOMXPath;
use Filament\Facades\Filament;
use Filament\Navigation\NavigationGroup;
use Filament\Navigation\NavigationItem;
use Filament\Support\Facades\FilamentView;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Blade;
use Tests\TestCase;

class NativeSidebarCompatibilityTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        config(['app.env' => 'local']);
        $this->actingAs(User::factory()->create());
        Filament::setCurrentPanel(Filament::getPanel('admin'));
        Filament::bootCurrentPanel();
    }

    public function test_filament_uses_the_application_owned_sidebar_override(): void
    {
        $this->assertSame(
            realpath(resource_path('views/vendor/filament-panels/components/sidebar/index.blade.php')),
            realpath(view()->getFinder()->find('filament-panels::components.sidebar.index')),
        );
    }

    public function test_the_override_preserves_native_controls_for_fixed_collapsible_and_unnamed_groups(): void
    {
        $html = Blade::render('<x-filament-panels::sidebar :navigation="$navigation" />', [
            'navigation' => [
                NavigationGroup::make('Collapsible group')->collapsed()->items([
                    NavigationItem::make('Collapsible item')->url('/admin/analytics/dashboards'),
                ]),
                NavigationGroup::make('Fixed group')->collapsible(false)->icon('heroicon-o-squares-2x2')->items([
                    NavigationItem::make('Fixed item')->url('/admin/analytics/reports'),
                ]),
                NavigationGroup::make()->items([
                    NavigationItem::make('Home item')->url('/admin'),
                ]),
            ],
        ]);
        $xpath = $this->xpath($html);

        $this->assertSame(3, $xpath->query('//li[@data-group-label]')->length);
        $this->assertSame(1, $xpath->query('//li[@data-group-label="Collapsible group"]//button[contains(@class, "fi-sidebar-group-collapse-button")]')->length);
        $this->assertSame(0, $xpath->query('//li[@data-group-label="Fixed group"]//button[contains(@class, "fi-sidebar-group-collapse-button")]')->length);
        $this->assertSame(1, $xpath->query('//li[@data-group-label="Fixed group"]//*[contains(@class, "fi-sidebar-group-icon")]')->length);
        $this->assertSame(1, $xpath->query('//li[@data-group-label="Fixed group"]//ul[contains(@class, "fi-sidebar-group-items")]//a[@href="/admin/analytics/reports"]')->length);
        $this->assertSame(1, $xpath->query('//script[@data-analytics-sidebar-state]')->length);
    }

    public function test_native_analytics_pages_keep_spa_links_when_their_group_is_non_collapsible(): void
    {
        $label = AnalyticsDashboardResource::getNavigationGroup();
        $panel = Filament::getCurrentPanel()->spa();
        FilamentView::spa($panel->hasSpaMode());
        foreach ($panel->getNavigationGroups() as $group) {
            if ($group instanceof NavigationGroup && $group->getLabel() === $label) {
                $group->collapsible(false);
            }
        }

        $response = $this->get('/admin/analytics/dashboards')->assertOk();
        $xpath = $this->xpath($response->getContent());
        $group = '//li[@data-group-label="'.$label.'"]';

        $this->assertSame(1, $xpath->query($group)->length);
        $this->assertSame(0, $xpath->query($group.'//button[contains(@class, "fi-sidebar-group-collapse-button")]')->length);
        $this->assertSame(3, $xpath->query($group.'//ul[contains(@class, "fi-sidebar-group-items")]//a[@*[name()="wire:navigate"]]')->length);
        $this->assertSame(1, $xpath->query('//script[@data-analytics-sidebar-state]')->length);
    }

    public function test_dashboard_submenus_use_the_same_group_controls_as_other_menus(): void
    {
        $html = Blade::render('<x-filament-panels::sidebar :navigation="$navigation" />', [
            'navigation' => [
                NavigationGroup::make()->items([
                    NavigationItem::make('Dashboard')->icon('heroicon-o-home')->url('/admin')->childItems([
                        NavigationItem::make('Active dashboard')->icon('heroicon-o-chart-bar-square')->url('/admin/analytics/dashboards/1/view'),
                    ]),
                ]),
                NavigationGroup::make('Dashboard builder')->icon('heroicon-o-squares-2x2')->items([
                    NavigationItem::make('Dashboards')->url('/admin/analytics/dashboards'),
                ]),
            ],
        ]);
        $xpath = $this->xpath($html);

        foreach (['Dashboard', 'Dashboard builder'] as $label) {
            $group = '//li[@data-group-label="'.$label.'"]';
            $this->assertSame(1, $xpath->query($group.'/div[contains(@class, "fi-sidebar-group-button")]')->length);
            $this->assertSame(1, $xpath->query($group.'//button[contains(@class, "fi-sidebar-group-collapse-button")]')->length);
            $this->assertSame(1, $xpath->query($group.'/ul[contains(@class, "fi-sidebar-group-items")]/li[contains(@class, "fi-sidebar-item")]')->length);
        }
        $this->assertSame(1, $xpath->query('//li[@data-group-label="Dashboard"]/div/a[@href="/admin"]')->length);
        $this->assertSame(1, $xpath->query('//li[@data-group-label="Dashboard"]/ul//a[@href="/admin/analytics/dashboards/1/view"]')->length);
    }

    private function xpath(string $html): DOMXPath
    {
        $document = new DOMDocument;
        $previous = libxml_use_internal_errors(true);
        $document->loadHTML('<?xml encoding="utf-8" ?>'.$html);
        libxml_clear_errors();
        libxml_use_internal_errors($previous);

        return new DOMXPath($document);
    }
}
