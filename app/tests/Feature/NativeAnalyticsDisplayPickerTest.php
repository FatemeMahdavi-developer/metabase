<?php

namespace Tests\Feature;

use App\Enums\AnalyticsDisplay;
use App\Filament\Pages\AnalyticsReportEditor;
use App\Models\User;
use Filament\Facades\Filament;
use Filament\Forms\Components\Radio;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Livewire\Livewire;
use Tests\TestCase;

class NativeAnalyticsDisplayPickerTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        config(['app.env' => 'local']);
        app()->setLocale('fa');
        $this->actingAs(User::factory()->create());
        Filament::setCurrentPanel(Filament::getPanel('admin'));
        Filament::bootCurrentPanel();
    }

    public function test_all_display_types_have_a_preview_and_description_with_the_current_type_selected(): void
    {
        $form = Livewire::test(AnalyticsReportEditor::class, ['record' => 'new'])
            ->call('openWorkbenchForm', 'display', ['display' => 'bar'], [], 'display-preview')
            ->assertFormFieldExists('display', 'workbenchForm', fn ($field) => $field instanceof Radio)
            ->assertFormSet(['display' => 'bar'], 'workbenchForm');

        foreach (AnalyticsDisplay::cases() as $display) {
            $form->assertSee('data-display-preview="'.$display->value.'"', false)
                ->assertSee($display->label())
                ->assertSee(__('analytics.display_descriptions.'.$display->value));
        }

        $this->assertSame(12, substr_count($form->html(), 'data-display-preview='));
    }

    public function test_choosing_funnel_dispatches_the_existing_display_draft_contract(): void
    {
        Livewire::test(AnalyticsReportEditor::class, ['record' => 'new'])
            ->call('openWorkbenchForm', 'display', ['display' => 'bar'], [], 'display-funnel')
            ->fillForm(['display' => 'funnel'], 'workbenchForm')
            ->call('submitWorkbenchForm')
            ->assertHasNoFormErrors()
            ->assertDispatched('analytics-form-submitted', fn ($event, $data) =>
                $data['requestId'] === 'display-funnel' && $data['data'] === ['display' => 'funnel']);
    }

    public function test_missing_and_unknown_display_types_are_rejected(): void
    {
        Livewire::test(AnalyticsReportEditor::class, ['record' => 'new'])
            ->call('openWorkbenchForm', 'display', [], [], 'display-invalid')
            ->call('submitWorkbenchForm')
            ->assertHasFormErrors(['display' => 'required'], 'workbenchForm')
            ->assertNotDispatched('analytics-form-submitted')
            ->fillForm(['display' => 'unknown-chart'], 'workbenchForm')
            ->call('submitWorkbenchForm')
            ->assertHasFormErrors(['display' => 'in'], 'workbenchForm')
            ->assertNotDispatched('analytics-form-submitted');
    }
}
