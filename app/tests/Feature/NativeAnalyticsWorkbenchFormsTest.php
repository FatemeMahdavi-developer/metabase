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

    public function test_filter_dropdowns_share_filament_rendering_and_preserve_live_operator_state(): void
    {
        $component = Livewire::test(AnalyticsReportEditor::class, ['record' => 'new'])
            ->call('openWorkbenchForm', 'filter', ['field' => 'amount', 'operator' => 'gt', 'value' => '5'], [
                'fields' => [
                    ['key' => 'amount', 'label' => 'Amount', 'type' => 'number'],
                    ['key' => 'name', 'label' => 'Name', 'type' => 'text'],
                ],
            ], 'filter-dropdowns');

        $document = new \DOMDocument;
        $document->loadHTML($component->html(), LIBXML_NOERROR | LIBXML_NOWARNING);
        $xpath = new \DOMXPath($document);
        $this->assertCount(0, $xpath->query('//*[@data-analytics-native-form]//select[contains(@class, "fi-select-input")]'));
        $this->assertCount(2, $xpath->query('//*[@data-analytics-native-form]//*[@x-data and contains(@x-data, "selectFormComponent")]'));

        $fields = $component->instance()->workbenchForm->getFlatFields(withHidden: true);
        $this->assertTrue($fields['field']->isSearchable());
        $this->assertFalse($fields['operator']->isSearchable());

        $component->set('workbenchData.operator', 'between')
            ->assertFormFieldIsVisible('from', 'workbenchForm')
            ->assertFormFieldIsVisible('to', 'workbenchForm')
            ->assertFormFieldIsHidden('value', 'workbenchForm')
            ->fillForm(['from' => '10', 'to' => '20'], 'workbenchForm')
            ->call('submitWorkbenchForm')
            ->assertHasNoFormErrors()
            ->assertDispatched('analytics-form-submitted', fn ($event, $data) =>
                $data['data']['operator'] === 'between'
                && $data['data']['from'] === '10'
                && $data['data']['to'] === '20'
                && ! array_key_exists('value', $data['data'])
            );

        $component->set('workbenchData.field', 'name')
            ->assertSet('workbenchData.operator', 'eq')
            ->assertSet('workbenchData.value', null)
            ->assertFormFieldIsVisible('value', 'workbenchForm')
            ->assertFormFieldIsHidden('from', 'workbenchForm')
            ->assertFormFieldIsHidden('to', 'workbenchForm');
        $operators = $component->instance()->workbenchForm->getFlatFields(withHidden: true)['operator']->getOptions();
        $this->assertArrayHasKey('contains', $operators);
        $this->assertArrayNotHasKey('between', $operators);

        $component->set('workbenchData.operator', 'is_null')
            ->assertFormFieldIsHidden('value', 'workbenchForm')
            ->call('submitWorkbenchForm')
            ->assertHasNoFormErrors()
            ->assertDispatched('analytics-form-submitted', fn ($event, $data) =>
                $data['data']['operator'] === 'is_null'
                && ! array_key_exists('value', $data['data'])
                && ! array_key_exists('from', $data['data'])
                && ! array_key_exists('to', $data['data'])
            );
    }

    public function test_dashboard_date_calendars_validate_locally_and_emit_canonical_range_dates(): void
    {
        $component = Livewire::test(AnalyticsReportEditor::class, ['record' => 'new'])
            ->call('openWorkbenchForm', 'filter_value', [
                'value_mode' => 'range', 'date_from' => 'garbage', 'date_to' => 'also-invalid',
            ], ['type' => 'date', 'operator' => 'between'], 'date-range')
            ->assertSee('dateTimePickerFormComponent', false)
            ->call('submitWorkbenchForm')
            ->assertHasFormErrors(['date_from' => 'required', 'date_to' => 'required'], 'workbenchForm')
            ->assertNotDispatched('analytics-form-submitted')
            ->set('workbenchData.date_from', 'not-a-date')
            ->set('workbenchData.date_to', '2026-11-15')
            ->call('submitWorkbenchForm')
            ->assertHasFormErrors(['date_from' => 'date'], 'workbenchForm')
            ->assertNotDispatched('analytics-form-submitted')
            ->fillForm(['date_from' => '2026-11-15', 'date_to' => '2026-11-01'], 'workbenchForm')
            ->call('submitWorkbenchForm')
            ->assertHasFormErrors(['date_to' => 'after_or_equal'], 'workbenchForm')
            ->assertNotDispatched('analytics-form-submitted')
            ->fillForm(['date_from' => '2026-11-01 00:00:00', 'date_to' => '2026-11-15 00:00:00', 'exclude' => true], 'workbenchForm')
            ->call('submitWorkbenchForm')
            ->assertHasNoFormErrors()
            ->assertDispatched('analytics-form-submitted', fn ($event, $data) =>
                $data['data']['date_from'] === '2026-11-01'
                && $data['data']['date_to'] === '2026-11-15'
                && $data['data']['exclude']
                && ! array_key_exists('from', $data['data'])
                && ! array_key_exists('to', $data['data'])
            );
    }

    public function test_date_calendar_modes_preserve_scalar_list_numeric_and_relative_values(): void
    {
        $cases = [
            ['date', 'eq', ['value_mode' => 'specific', 'date_value' => '2028-02-29'], ['date_value' => '2028-02-29']],
            ['date', 'in', ['value_mode' => 'specific', 'value' => '2026-11-01, 2026-11-15'], ['value' => '2026-11-01, 2026-11-15']],
            ['number', 'between', ['value_mode' => 'range', 'from' => '0', 'to' => '10'], ['from' => '0', 'to' => '10']],
            ['text', 'eq', ['value_mode' => 'specific', 'value' => 'not-a-date'], ['value' => 'not-a-date']],
            ['date', 'between', ['value_mode' => 'relative', 'relative_amount' => 2, 'relative_unit' => 'month', 'relative_direction' => 'past'], ['relative_amount' => 2, 'relative_unit' => 'month']],
            ['date', 'between', ['value_mode' => 'parts', 'date_part' => 'month', 'part_values' => '1, 2'], ['part_values' => '1, 2']],
            ['date', 'between', ['value_mode' => 'none'], ['value_mode' => 'none']],
        ];
        foreach ($cases as $index => [$type, $operator, $draft, $expected]) {
            Livewire::test(AnalyticsReportEditor::class, ['record' => 'new'])
                ->call('openWorkbenchForm', 'filter_value', $draft, ['type' => $type, 'operator' => $operator], 'date-mode-'.$index)
                ->call('submitWorkbenchForm')
                ->assertHasNoFormErrors()
                ->assertDispatched('analytics-form-submitted', fn ($event, $data) =>
                    array_intersect_key($data['data'], $expected) === $expected
                );
        }
        Livewire::test(AnalyticsReportEditor::class, ['record' => 'new'])
            ->call('openWorkbenchForm', 'filter_value', ['value_mode' => 'specific', 'value' => '2026-11-01, bad-date'], ['type' => 'date', 'operator' => 'in'], 'date-list')
            ->call('submitWorkbenchForm')
            ->assertHasFormErrors(['value'], 'workbenchForm')
            ->assertNotDispatched('analytics-form-submitted');
    }

    public function test_report_date_filters_use_calendars_and_keep_date_parts_as_lists(): void
    {
        $context = ['fields' => [['key' => 'ordered_at', 'label' => 'Order date', 'type' => 'date']]];
        $component = Livewire::test(AnalyticsReportEditor::class, ['record' => 'new'])
            ->call('openWorkbenchForm', 'filter', ['field' => 'ordered_at', 'operator' => 'eq', 'date_mode' => 'relative', 'date_value' => '2026-11-01'], $context, 'report-date')
            ->assertFormFieldIsVisible('date_value', 'workbenchForm')
            ->assertFormFieldIsHidden('relative_amount', 'workbenchForm')
            ->call('submitWorkbenchForm')
            ->assertHasNoFormErrors()
            ->assertDispatched('analytics-form-submitted', fn ($event, $data) => $data['data']['date_value'] === '2026-11-01');
        $component->call('openWorkbenchForm', 'filter', ['field' => 'ordered_at', 'operator' => 'between', 'date_from' => '2026-11-01', 'date_to' => '2026-11-15'], $context, 'report-date-range')
            ->assertFormFieldIsVisible('date_from', 'workbenchForm')
            ->assertFormFieldIsVisible('date_to', 'workbenchForm')
            ->call('submitWorkbenchForm')
            ->assertHasNoFormErrors()
            ->assertDispatched('analytics-form-submitted', fn ($event, $data) => $data['data']['date_from'] === '2026-11-01' && $data['data']['date_to'] === '2026-11-15');
        $component->call('openWorkbenchForm', 'filter', ['field' => 'ordered_at', 'operator' => 'in', 'date_part' => 'month', 'value' => '1, 2'], $context, 'report-date-parts')
            ->call('submitWorkbenchForm')
            ->assertHasNoFormErrors()
            ->assertDispatched('analytics-form-submitted', fn ($event, $data) => $data['data']['value'] === '1, 2');
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

    public function test_filter_heading_changes_after_the_initial_confirmation_form(): void
    {
        app()->setLocale('en');

        Livewire::test(AnalyticsReportEditor::class, ['record' => 'new'])
            ->assertSee('تأیید عملیات')
            ->call('openWorkbenchForm', 'filter_value', ['value_mode' => 'none'], ['type' => 'text'], 'filter-heading-1')
            ->assertSuccessful()
            ->assertSee('مقدار فیلتر')
            ->assertDontSee('تأیید عملیات')
            ->assertSee('analytics-native-form-heading-filter_value-filter-heading-1', false)
            ->call('openWorkbenchForm', 'confirm', [], ['message' => 'ادامه؟'], 'confirm-heading-2')
            ->assertSuccessful()
            ->assertSee('تأیید عملیات')
            ->assertSee('analytics-native-form-heading-confirm-confirm-heading-2', false);
    }

    public function test_multiple_filter_values_preserve_the_other_fields_and_submit_all_selections(): void
    {
        $selected = ['clothing', 'electronics', 'books'];

        Livewire::test(AnalyticsReportEditor::class, ['record' => 'new'])
            ->call('openWorkbenchForm', 'filter_value', ['value_mode' => 'none', 'value' => 'manual'], [
                'type' => 'text',
                'suggestions' => array_map(fn ($value) => ['key' => $value, 'label' => $value], $selected),
            ], 'multiple-values')
            ->set('workbenchData.suggestions', $selected)
            ->assertSet('workbenchData.value_mode', 'specific')
            ->assertSet('workbenchData.value', 'manual')
            ->assertFormFieldIsEnabled('value_mode', 'workbenchForm')
            ->assertFormFieldIsEnabled('value', 'workbenchForm')
            ->call('submitWorkbenchForm')
            ->assertHasNoFormErrors()
            ->assertDispatched('analytics-form-submitted', fn ($event, $data) =>
                $data['requestId'] === 'multiple-values'
                && $data['data']['suggestions'] === $selected
                && $data['data']['value_mode'] === 'specific'
                && $data['data']['value'] === 'manual'
            );
    }

    public function test_workbench_fields_use_shared_floating_labels_and_preserve_expression_hooks(): void
    {
        $component = Livewire::test(AnalyticsReportEditor::class, ['record' => 'new'])
            ->call('openWorkbenchForm', 'report', ['name' => 'Report', 'add_to_dashboard' => false], [], 'floating-report')
            ->assertSee('x-data="soarFloatingField(', false);
        $fields = $component->instance()->workbenchForm->getFlatFields(withHidden: true);

        foreach (['name', 'description', 'folder_id'] as $name) {
            $attributes = $fields[$name]->getExtraFieldWrapperAttributes();
            $this->assertStringContainsString('soar-floating-field', $attributes['class']);
            $this->assertSame("soarFloatingField('workbenchData.{$name}')", (string) $attributes['x-data']);
            $this->assertSame("{ 'soar-floating-has-value': hasValue }", (string) $attributes['x-bind:class']);
        }
        $document = new \DOMDocument;
        $document->loadHTML($component->html(), LIBXML_NOERROR | LIBXML_NOWARNING);
        $wrappers = (new \DOMXPath($document))->query('//*[@data-field-wrapper and contains(@x-data, "soarFloatingField")]');
        $this->assertCount(3, $wrappers);
        foreach ($wrappers as $wrapper) {
            $this->assertStringNotContainsString('&#039;', $wrapper->getAttribute('x-data'));
            $this->assertSame("{ 'soar-floating-has-value': hasValue }", $wrapper->getAttribute('x-bind:class'));
        }

        $this->assertStringContainsString('soar-floating-select', $fields['folder_id']->getExtraFieldWrapperAttributes()['class']);
        $this->assertArrayNotHasKey('x-data', $fields['add_to_dashboard']->getExtraFieldWrapperAttributes());

        $component->call('openWorkbenchForm', 'columns', ['columns' => ['amount']], [
            'fields' => [['key' => 'amount', 'label' => 'Amount', 'type' => 'number']],
        ], 'floating-columns');
        $this->assertArrayNotHasKey('x-data', $component->instance()->workbenchForm->getFlatFields(withHidden: true)['columns']->getExtraFieldWrapperAttributes());

        $component->call('openWorkbenchForm', 'expression', ['label' => 'Amount', 'expression' => ''], [
            'fields' => [['key' => 'amount', 'label' => 'Amount', 'type' => 'number']],
        ], 'floating-expression');
        $fields = $component->instance()->workbenchForm->getFlatFields(withHidden: true);
        $this->assertSame('label', $fields['label']->getExtraInputAttributes()['name']);
        $this->assertArrayHasKey('data-expression-name', $fields['label']->getExtraInputAttributes());
        $this->assertSame('ltr', $fields['expression']->getExtraInputAttributes()['dir']);
        $this->assertSame('false', $fields['expression']->getExtraInputAttributes()['spellcheck']);
        $this->assertArrayHasKey('data-expression-editor', $fields['expression']->getExtraInputAttributes());

        $component->set('workbenchData.insert_field', 'amount')
            ->assertSet('workbenchData.expression', '[amount]')
            ->assertSet('workbenchData.insert_field', null)
            ->call('submitWorkbenchForm')
            ->assertHasNoFormErrors()
            ->assertDispatched('analytics-form-submitted', fn ($event, $data) =>
                $data['requestId'] === 'floating-expression'
                && $data['data']['expression'] === '[amount]'
                && ! isset($data['data']['insert_field'])
            );
    }

    public function test_floating_labels_cover_empty_repeater_templates_and_new_items(): void
    {
        $component = Livewire::test(AnalyticsReportEditor::class, ['record' => 'new'])
            ->call('openWorkbenchForm', 'stage', ['mode' => 'rows', 'expressions' => []], [
                'fields' => [['key' => 'amount', 'label' => 'Amount', 'type' => 'number']],
            ], 'floating-repeater');
        $repeater = $component->instance()->workbenchForm->getFlatFields(withHidden: true)['expressions'];
        $this->assertSame([], $repeater->getState());
        $templateFields = $repeater->getChildComponentContainer()->getFlatFields(withHidden: true);

        foreach (['label', 'expression'] as $name) {
            $this->assertStringContainsString('soar-floating-field', $templateFields[$name]->getExtraFieldWrapperAttributes()['class']);
        }
        $this->assertArrayNotHasKey('x-data', $templateFields['key']->getExtraFieldWrapperAttributes());

        $component->fillForm([
            'expressions' => [['key' => 'custom_amount', 'label' => 'Amount', 'expression' => '[amount]']],
        ], 'workbenchForm');

        $document = new \DOMDocument;
        $document->loadHTML($component->html(), LIBXML_NOERROR | LIBXML_NOWARNING);
        $wrappers = (new \DOMXPath($document))->query('//*[@data-field-wrapper and contains(@x-data, ".expressions.")]');
        $this->assertCount(2, $wrappers);
        foreach ($wrappers as $wrapper) {
            $this->assertStringContainsString('soar-floating-field', $wrapper->getAttribute('class'));
            $this->assertSame("{ 'soar-floating-has-value': hasValue }", $wrapper->getAttribute('x-bind:class'));
        }

        $component->call('submitWorkbenchForm')
            ->assertHasNoFormErrors()
            ->assertDispatched('analytics-form-submitted', fn ($event, $data) =>
                $data['requestId'] === 'floating-repeater'
                && array_values($data['data']['expressions'])[0]['key'] === 'custom_amount'
                && array_values($data['data']['expressions'])[0]['expression'] === '[amount]'
            );
    }
}
