<?php

namespace Tests\Feature;

use App\Domain\Analytics\Filament\WorkbenchForms;
use App\Filament\Pages\AnalyticsReportEditor;
use App\Models\AnalyticsDashboard;
use App\Models\AnalyticsFolder;
use App\Models\User;
use Filament\Facades\Filament;
use Filament\Forms\Components\Repeater;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Livewire\Livewire;
use Tests\TestCase;

class NativeAnalyticsWorkbenchFormsTest extends TestCase
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

    public function test_report_uses_real_filament_form_and_validates_before_dispatching_draft(): void
    {
        Livewire::test(AnalyticsReportEditor::class, ['record' => 'new'])
            ->call('openWorkbenchForm', 'report', ['name' => '', 'add_to_dashboard' => false], [], 'report-1')
            ->assertSee('fi-fo-text-input', false)
            ->fillForm(['name' => ''], 'workbenchForm')
            ->call('submitWorkbenchForm')
            ->assertHasFormErrors(['name' => 'required'], 'workbenchForm')
            ->assertNotDispatched('analytics-form-submitted')
            ->fillForm(['name' => 'گزارش فروش', 'description' => 'توضیح', 'add_to_dashboard' => true], 'workbenchForm')
            ->call('submitWorkbenchForm')
            ->assertHasNoFormErrors()
            ->assertDispatched('analytics-form-submitted', fn ($event, $data) => $data['requestId'] === 'report-1' && $data['data']['name'] === 'گزارش فروش' && $data['data']['add_to_dashboard']);
    }

    public function test_forms_switch_schema_and_dont_leak_previous_values(): void
    {
        Livewire::test(AnalyticsReportEditor::class, ['record' => 'new'])
            ->call('openWorkbenchForm', 'share', ['email' => 'private@example.com', 'role' => 'viewer'], [], 'share-1')
            ->assertFormFieldExists('email', 'workbenchForm')
            ->call('openWorkbenchForm', 'tab', ['name' => 'تب دوم'], [], 'tab-2')
            ->assertFormFieldExists('name', 'workbenchForm')
            ->assertFormFieldDoesNotExist('email', 'workbenchForm')
            ->call('submitWorkbenchForm')
            ->assertDispatched('analytics-form-submitted', fn ($event, $data) => $data['requestId'] === 'tab-2' && ! isset($data['data']['email']));
    }

    public function test_foreign_collection_is_not_selectable_in_report_form(): void
    {
        $folder = AnalyticsFolder::create(['owner_id' => User::factory()->create()->id, 'name' => 'Foreign folder']);
        Livewire::test(AnalyticsReportEditor::class, ['record' => 'new'])
            ->call('openWorkbenchForm', 'report', ['name' => 'Example'], [], 'report')
            ->fillForm(['folder_id' => $folder->id], 'workbenchForm')
            ->call('submitWorkbenchForm')
            ->assertHasFormErrors(['folder_id'], 'workbenchForm');
    }

    public function test_every_registered_form_renders_as_filament_components(): void
    {
        $field = ['key' => 'id', 'label' => 'ID', 'type' => 'number'];
        $context = ['fields' => [$field], 'tables' => [['key' => 'users', 'label' => 'Users', 'fields' => [$field]]], 'functions' => [], 'widgets' => [], 'connections' => [], 'parents' => [], 'type' => 'text'];
        foreach (array_keys(WorkbenchForms::TITLES) as $kind) {
            Livewire::test(AnalyticsReportEditor::class, ['record' => 'new'])
                ->call('openWorkbenchForm', $kind, [], $context, $kind)
                ->assertSuccessful()
                ->assertSee('data-analytics-native-form', false);
        }
    }

    public function test_visualization_numeric_constraints_are_enforced_by_filament(): void
    {
        Livewire::test(AnalyticsReportEditor::class, ['record' => 'new'])
            ->call('openWorkbenchForm', 'visualization', ['display' => 'doughnut', 'decimals' => 9, 'ring_thickness' => 99], [], 'viz')
            ->call('submitWorkbenchForm')
            ->assertHasFormErrors(['decimals' => 'max', 'ring_thickness' => 'max'], 'workbenchForm')
            ->fillForm(['decimals' => 2, 'ring_thickness' => 28], 'workbenchForm')
            ->call('submitWorkbenchForm')
            ->assertHasNoFormErrors();
    }

    public function test_unsupported_form_and_commands_are_rejected(): void
    {
        Livewire::test(AnalyticsReportEditor::class, ['record' => 'new'])
            ->call('openWorkbenchForm', 'arbitrary-class', [], [], 'x')->assertStatus(422);
        Livewire::test(AnalyticsReportEditor::class, ['record' => 'new'])
            ->call('openWorkbenchForm', 'report', [], [], 'x')
            ->call('workbenchCommand', 'delete')->assertStatus(422);
    }

    public function test_remote_filter_search_does_not_trust_client_dashboard_context(): void
    {
        $dashboard = AnalyticsDashboard::create([
            'owner_id' => User::factory()->create()->id,
            'name' => 'Private dashboard', 'settings' => [], 'version' => 1,
        ]);
        Livewire::test(AnalyticsReportEditor::class, ['record' => 'new'])
            ->call('openWorkbenchForm', 'filter_value', ['value_mode' => 'none'], [
                'type' => 'text', 'dashboard_id' => $dashboard->id, 'filter_key' => 'private',
            ], 'search')
            ->call('getFormSelectSearchResults', 'workbenchData.suggestions', 'secret')
            ->assertForbidden();
    }

    public function test_new_stage_identifiers_follow_the_report_compiler_contract(): void
    {
        $repeaters = collect(app(WorkbenchForms::class)->schema('stage', []))
            ->filter(fn ($component) => $component instanceof Repeater)
            ->keyBy(fn ($component) => $component->getName());
        foreach (['joins', 'metrics', 'expressions'] as $name) {
            $identifier = $repeaters[$name]->getChildComponents()[0];
            $this->assertMatchesRegularExpression('/^[a-z][a-z0-9_]{0,40}$/', $identifier->getDefaultState());
        }
    }
}
