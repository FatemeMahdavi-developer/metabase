<?php

namespace Tests\Fixtures;

use App\Domain\Analytics\Filament\WorkbenchForms;
use App\Filament\Resources\AnalyticsConnectionResource;
use App\Filament\Resources\AnalyticsReportResource;
use App\Models\AnalyticsConnection;
use Filament\Actions;
use Filament\Actions\Concerns\InteractsWithActions;
use Filament\Actions\Contracts\HasActions;
use Filament\Forms\Components\Select;
use Filament\Forms\Concerns\InteractsWithForms;
use Filament\Forms\Contracts\HasForms;
use Filament\Forms\Form;
use Illuminate\Validation\ValidationException;
use Livewire\Component;

class AnalyticsModalAuditFixture extends Component implements HasForms
{
    use InteractsWithForms;

    public string $scenario = 'columns';
    public array $workbenchData = [];
    public string $workbenchKind = 'columns';
    public string $workbenchRequest = 'modal-audit';
    public string $workbenchError = '';
    public array $workbenchContext = [];

    public static function cases(): array
    {
        $fields = [
            ['key' => 'id', 'label' => 'شناسه سفارش', 'type' => 'number'],
            ['key' => 'name', 'label' => 'نام مشتری و دسته‌بندی سفارش', 'type' => 'text'],
            ['key' => 'amount', 'label' => 'مبلغ سفارش', 'type' => 'number'],
            ['key' => 'ordered_at', 'label' => 'تاریخ سفارش', 'type' => 'date', 'is_dimension' => true],
            ['key' => 'active', 'label' => 'فعال', 'type' => 'boolean'],
        ];
        $context = [
            'fields' => $fields, 'is_owner' => true,
            'tables' => [['key' => 'public.customers', 'label' => 'مشتریان', 'fields' => $fields]],
            'connections' => [['key' => '1', 'label' => 'پایگاه نمونه', 'catalog' => [['key' => 'public.customers', 'label' => 'مشتریان']]]],
            'reports' => [['key' => '1', 'label' => 'گزارش سفارش‌ها']], 'dashboards' => [['key' => '1', 'label' => 'داشبورد نمونه']],
            'functions' => [['key' => 'sum', 'signature' => 'sum([amount])', 'description' => 'جمع مبلغ']],
            'widgets' => [['key' => 'orders', 'label' => 'سفارش‌ها', 'fields' => $fields]],
            'parents' => [], 'parameters' => [['key' => 'city', 'label' => 'شهر', 'type' => 'text']],
            'report_targets' => ['1' => [['key' => 'city', 'label' => 'شهر', 'type' => 'text']]],
            'type' => 'text', 'column' => true, 'message' => 'عملیات انتخاب شده تأیید شود؟',
            'colors' => [['key' => 'books', 'label' => 'کتاب']],
            'suggestions' => [['key' => 'books', 'label' => 'کتاب'], ['key' => 'clothing', 'label' => 'پوشاک']],
        ];
        $base = ['name' => 'نمونه داشبورد', 'description' => 'توضیحات نمونه', 'title' => 'عنوان نمونه', 'content' => 'متن نمونه',
            'type' => 'text', 'value_mode' => 'specific', 'value' => 'نمونه', 'suggestions' => [], 'field' => 'amount',
            'function' => 'sum', 'label' => 'مجموع مبلغ', 'key' => 'amount', 'direction' => 'asc', 'limit' => 100,
            'columns' => array_column($fields, 'key'), 'display' => 'bar', 'width' => 'wide', 'refresh_interval' => 0,
            'connection_id' => '1', 'source' => 'public.customers', 'report_id' => '1', 'dashboard_id' => null,
            'email' => 'viewer@example.test', 'role' => 'viewer', 'x' => 'name', 'y' => 'amount', 'split' => 'ordered_at',
            'visible_columns' => array_column($fields, 'key'), 'page_size' => 25, 'decimals' => 0,
            'original' => 'orders', 'label_fa' => 'سفارش‌ها', 'label_en' => 'Orders', 'semantic_type' => 'category',
            'operator' => 'eq', 'widget_type' => 'dropdown', 'bindings' => [], 'scope' => '*', 'mappings' => [],
            'mode' => 'aggregate', 'joins' => [], 'expressions' => [], 'filters' => [],
            'metrics' => [['key' => 'total', 'function' => 'sum', 'field' => 'amount', 'label' => 'مبلغ']],
            'dimensions' => [['field' => 'ordered_at', 'grain' => 'month']], 'sort' => [],
            'parameters' => [['key' => 'city', 'type' => 'text', 'default' => '', 'required' => false]],
            'expression' => '[amount] + 1', 'sql' => "SELECT name, amount, ordered_at\nFROM public.orders\nWHERE amount > 0",
            'series_colors' => [['key' => 'books', 'label' => 'کتاب', 'color' => '#ff8000']],
            'color' => '#ff8000', 'target' => 100, 'grain' => 'month', 'percent_visibility' => 'tooltip',
            'center_mode' => 'percentage', 'ring_thickness' => 24, 'gauge_style' => 'semi',
            'relative_amount' => 7, 'relative_unit' => 'day', 'relative_direction' => 'past', 'from' => '2026-11-01', 'to' => '2026-11-15',
            'date_part' => 'month', 'part_values' => '1,2', 'copy_reports' => false, 'auto_apply' => true,
        ];
        $cases = [];
        foreach (array_keys(WorkbenchForms::TITLES) as $kind) $cases[$kind] = ['kind' => $kind, 'data' => $base, 'context' => $context];
        $cases['filter_value']['data']['suggestions'] = ['books', 'clothing'];
        $cases['link']['data']['content'] = 'https://example.test/orders';
        $cases['dimension']['data']['field'] = 'ordered_at';
        $cases['join']['data'] = [...$base, 'type' => 'left', 'conditions' => [['left' => 'id', 'right' => 'id', 'operator' => 'eq']]];
        $cases['filter']['data'] = [...$base, 'field' => 'name', 'operator' => 'contains'];
        $cases['click']['data'] = [...$base, 'type' => 'url', 'url' => 'https://example.test/orders'];
        $cases['dashboard_filter']['data'] = [...$base, 'bindings' => [['widget_key' => 'orders', 'target' => 'name']]];
        foreach (['tab', 'dashboard_filter'] as $kind) $cases[$kind.'-existing'] = [...$cases[$kind], 'context' => [...$context, 'existing' => true]];
        $cases['stage-rows'] = [...$cases['stage'], 'data' => [...$base, 'mode' => 'rows']];
        foreach (['range', 'relative', 'parts', 'presence', 'null'] as $mode) $cases['filter-value-date-'.$mode] = [
            'kind' => 'filter_value', 'context' => [...$context, 'type' => 'date'], 'data' => [...$base, 'value_mode' => $mode],
        ];
        foreach (['number', 'boolean', 'time_grain'] as $type) $cases['filter-value-'.$type] = [
            'kind' => 'filter_value', 'context' => [...$context, 'type' => $type], 'data' => [...$base, 'value_mode' => $type === 'number' ? 'range' : 'specific'],
        ];
        $cases['filter-date-relative'] = [...$cases['filter'], 'data' => [...$base, 'field' => 'ordered_at', 'operator' => 'between', 'date_mode' => 'relative']];
        $cases['filter-number-range'] = [...$cases['filter'], 'data' => [...$base, 'field' => 'amount', 'operator' => 'between']];
        $cases['filter-boolean'] = [...$cases['filter'], 'data' => [...$base, 'field' => 'active', 'boolean_value' => 'true']];
        foreach (['table', 'number', 'line', 'area', 'pie', 'doughnut', 'gauge', 'progress', 'pivot', 'scatter', 'funnel'] as $display) {
            $cases['visualization-'.$display] = [...$cases['visualization'], 'data' => [...$base, 'display' => $display]];
        }
        $cases['click-report'] = [...$cases['click'], 'data' => [...$base, 'type' => 'report', 'mappings' => [['target' => 'city', 'source' => 'column', 'key' => 'name']]]];
        $cases['click-dashboard'] = [...$cases['click'], 'data' => [...$base, 'type' => 'dashboard', 'dashboard_id' => null]];
        return $cases;
    }

    public function mount(string $scenario = 'columns', bool $invalid = false): void
    {
        $this->scenario = $scenario;
        $case = self::cases()[$scenario];
        $this->workbenchKind = $case['kind'];
        $this->workbenchContext = $case['context'];
        $this->workbenchRequest = 'audit-'.$scenario;
        $this->workbenchForm->fill($invalid ? [...$case['data'], 'columns' => []] : $case['data']);
        if ($invalid) {
            try { $this->workbenchForm->getState(); }
            catch (ValidationException $exception) { $this->setErrorBag($exception->validator->errors()); }
        }
    }

    protected function getForms(): array { return ['workbenchForm']; }

    public function workbenchForm(Form $form): Form
    {
        $fields = app(WorkbenchForms::class)->schema($this->workbenchKind, $this->workbenchContext);
        // Folder choices are external data; leave the real field and its attributes intact.
        foreach ($fields as $field) if ($field instanceof Select && $field->getName() === 'folder_id') $field->options([]);
        return $form->schema($fields)->statePath('workbenchData');
    }

    public function submitWorkbenchForm(): void {}
    public function workbenchCommand(string $command): void {}
    public function render(): string { return '<div data-modal-audit-case="{{ $scenario }}">@include("filament.partials.analytics-native-form")</div>'; }
}

class AnalyticsModalReferenceFixture extends Component implements HasActions, HasForms
{
    use InteractsWithActions;
    use InteractsWithForms;

    public string $scenario = 'create';
    public function mount(string $scenario = 'create'): void { $this->scenario = $scenario; $this->mountAction($scenario); }
    public function createAction(): Actions\CreateAction { return Actions\CreateAction::make()->model(AnalyticsConnection::class)->form(fn (Form $form) => AnalyticsConnectionResource::form($form))->createAnother(false); }
    public function editAction(): Actions\EditAction { return Actions\EditAction::make()->record((new AnalyticsConnection())->forceFill(['id' => 999999, 'name' => 'نمونه', 'driver' => 'pgsql', 'configuration' => []]))->form(fn (Form $form) => AnalyticsConnectionResource::form($form)); }
    public function deleteAction(): Actions\DeleteAction { return Actions\DeleteAction::make()->record((new AnalyticsConnection())->forceFill(['id' => 999999, 'name' => 'نمونه', 'driver' => 'pgsql']))->recordTitle('پایگاه نمونه'); }
    public function createFolderAction(): Actions\Action { return AnalyticsReportResource::createFolderAction(); }
    public function render(): string { return '<div data-modal-audit-reference="{{ $scenario }}"><x-filament-actions::modals /></div>'; }
}

class AnalyticsModalPageFormFixture extends Component implements HasForms
{
    use InteractsWithForms;
    public array $data = [];
    public function mount(): void { $this->form->fill(['name' => '', 'driver' => 'pgsql', 'configuration' => []]); }
    public function form(Form $form): Form { return AnalyticsConnectionResource::form($form)->statePath('data')->model(AnalyticsConnection::class)->operation('create'); }
    public function render(): string { return '<div data-modal-audit-page-form><form>{{ $this->form }}</form></div>'; }
}
