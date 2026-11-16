<?php

namespace Tests\Feature;

use App\Filament\Pages\AnalyticsReportEditor;
use App\Models\User;
use Filament\Facades\Filament;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Livewire\Livewire;
use Tests\TestCase;

class NativeAnalyticsResultTableTest extends TestCase
{
    use RefreshDatabase;

    public function test_result_table_templates_use_complete_filament_search_and_pagination_components(): void
    {
        $html = Livewire::test(\Tests\Fixtures\NativeAnalyticsTableFixture::class)->html();
        foreach (['fi-ta-ctn', 'fi-ta-table', 'fi-ta-header-cell', 'fi-ta-row', 'fi-ta-cell', 'fi-input-wrp', 'fi-input', 'fi-pagination-item', 'fi-ta-empty-state'] as $component) {
            $this->assertStringContainsString($component, $html);
        }
        $this->assertStringContainsString('analytics-native-table-header-asc', $html);
        $this->assertStringContainsString('aria-sort="ascending"', $html);
        $this->assertStringContainsString('aria-sort="descending"', $html);
        $this->assertStringContainsString('fi-active', $html);
        $this->assertStringContainsString('fi-disabled', $html);
        $this->assertStringContainsString('fi-pagination-records-per-page-select', $html);
        $this->assertStringContainsString('fi-pagination-previous-btn', $html);
        $this->assertStringNotContainsString('soar-pagination', $html);
    }

    public function test_report_workbench_includes_native_table_templates_outside_the_client_renderer(): void
    {
        config(['app.env' => 'local']);
        $this->actingAs(User::factory()->create());
        Filament::setCurrentPanel(Filament::getPanel('admin'));
        Filament::bootCurrentPanel();
        Livewire::test(AnalyticsReportEditor::class, ['record' => 'new'])
            ->assertSee('id="analytics-native-table-shell"', false)
            ->assertSee('id="analytics-native-table-pagination"', false)
            ->assertSee('fi-ta-table', false);
    }
}
