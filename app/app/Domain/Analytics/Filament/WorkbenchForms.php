<?php

namespace App\Domain\Analytics\Filament;

use App\Domain\Analytics\DashboardStore;
use App\Domain\Analytics\FilterValueService;
use App\Enums\AnalyticsDashboardRole;
use App\Enums\AnalyticsDisplay;
use App\Enums\AnalyticsFieldType;
use App\Enums\AnalyticsFilterOperator;
use App\Enums\AnalyticsJoinType;
use App\Enums\AnalyticsMetric;
use App\Enums\AnalyticsTimeGrain;
use App\Models\AnalyticsDashboard;
use App\Models\AnalyticsFolder;
use Filament\Facades\Filament;
use Filament\Forms\Components\Actions;
use Filament\Forms\Components\Actions\Action;
use Filament\Forms\Components\CheckboxList;
use Filament\Forms\Components\ColorPicker;
use Filament\Forms\Components\DatePicker;
use Filament\Forms\Components\Grid;
use Filament\Forms\Components\Hidden;
use Filament\Forms\Components\Placeholder;
use Filament\Forms\Components\Repeater;
use Filament\Forms\Components\Section;
use Filament\Forms\Components\Select;
use Filament\Forms\Components\Tabs;
use Filament\Forms\Components\Textarea;
use Filament\Forms\Components\TextInput;
use Filament\Forms\Components\Toggle;
use Filament\Forms\Components\ViewField;
use Filament\Forms\Get;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;

/** PHP owns every field, visibility rule, validation rule and label in these forms.
 * Context contains transient notebook column choices, never a database query or HTML.
 */
class WorkbenchForms
{
    /** Keys stay public because Livewire uses this allow-list before building a form. */
    public const TITLES = [
        'report' => 'report', 'dashboard' => 'dashboard', 'folder' => 'folder', 'tab' => 'tab',
        'text' => 'text', 'link' => 'link', 'share' => 'share', 'copy' => 'copy',
        'columns' => 'columns', 'metric' => 'metric', 'dimension' => 'dimension', 'sort' => 'sort',
        'limit' => 'limit', 'join' => 'join', 'filter' => 'filter', 'expression' => 'expression',
        'parameters' => 'parameters', 'display' => 'display', 'visualization' => 'visualization',
        'metadata' => 'metadata', 'source' => 'source', 'report_card' => 'report_card',
        'dashboard_picker' => 'dashboard_picker', 'card' => 'card', 'dashboard_filter' => 'dashboard_filter',
        'filter_value' => 'filter_value', 'click' => 'click', 'stage' => 'stage', 'confirm' => 'confirm', 'sql' => 'sql',
    ];

    public static function title(string $kind): string
    {
        return __('analytics.forms.titles.'.self::TITLES[$kind]);
    }

    public function schema(string $kind, array $context): array
    {
        $fields = $context['fields'] ?? [];
        $folders = fn () => AnalyticsFolder::where('owner_id', Filament::auth()->id())->orderBy('name')->pluck('name', 'id')->all();
        $name = fn (string $label = 'analytics.forms.fields.name', int $max = 150) => TextInput::make('name')->label(__($label))->required()->maxLength($max);
        $description = fn () => Textarea::make('description')->label(__('analytics.forms.fields.description'))->rows(3)->maxLength(3000);

        return match ($kind) {
            'report' => [$name(), $description(), Select::make('folder_id')->label(__('analytics.forms.fields.folder'))->options($folders)->searchable()->nullable()->rule(Rule::exists(AnalyticsFolder::class, 'id')->where('owner_id', Filament::auth()->id())), Toggle::make('add_to_dashboard')->label(__('analytics.forms.fields.add_to_dashboard'))],
            'dashboard' => [$name(), $description(), Select::make('folder_id')->label(__('analytics.forms.fields.folder'))->options($folders)->disabled(! ($context['is_owner'] ?? false)), Select::make('width')->label(__('analytics.forms.fields.width'))->options(['wide' => __('analytics.forms.options.wide'), 'fixed' => __('analytics.forms.options.fixed')])->required(), Select::make('refresh_interval')->label(__('analytics.forms.fields.refresh_interval'))->options([0 => __('analytics.forms.options.off'), 30 => __('analytics.forms.options.seconds_30'), 60 => __('analytics.forms.options.minute_1'), 300 => __('analytics.forms.options.minutes_5')])->required(), Toggle::make('auto_apply')->label(__('analytics.forms.fields.auto_apply'))],
            'folder' => [$name('analytics.forms.fields.folder_name', 100)],
            'tab' => [$name('analytics.forms.fields.tab_name', 100)],
            'text', 'link' => [TextInput::make('title')->label(__('analytics.forms.fields.card_title'))->maxLength(150), $kind === 'link' ? TextInput::make('content')->label(__('analytics.forms.fields.address'))->url()->required()->startsWith(['http://', 'https://'])->maxLength(20000)->extraInputAttributes(['dir' => 'ltr']) : Textarea::make('content')->label(__('analytics.forms.fields.markdown'))->rows(10)->maxLength(20000)->helperText(__('analytics.forms.helpers.markdown'))],
            'share' => [TextInput::make('email')->label(__('analytics.forms.fields.user_email'))->email()->required()->maxLength(255), Select::make('role')->label(__('analytics.forms.fields.access'))->options(AnalyticsDashboardRole::options())->required()],
            'copy' => [Toggle::make('copy_reports')->label(__('analytics.forms.fields.copy_reports'))],
            'columns' => [CheckboxList::make('columns')->label(__('analytics.forms.fields.visible_columns'))->options($this->options($fields))->searchable()->bulkToggleable()->required()->minItems(1)->maxItems(50)->columns(2)],
            'metric' => $this->metric($fields),
            'dimension' => [$this->select('field', __('analytics.forms.fields.column'), $fields)->required()->live(), Select::make('grain')->label(__('analytics.forms.fields.time_grain'))->options(AnalyticsTimeGrain::options())->nullable()->visible(fn (Get $get) => $this->fieldType($fields, $get('field')) === 'date')],
            'sort' => [$this->select('key', __('analytics.forms.fields.column'), $fields)->required(), Select::make('direction')->label(__('analytics.forms.fields.order'))->options(['asc' => __('analytics.forms.options.ascending'), 'desc' => __('analytics.forms.options.descending')])->required()],
            'limit' => [$this->limit()],
            'join' => $this->join($context),
            'filter' => $this->filter($fields),
            'expression' => $this->expression($context),
            'parameters' => [Repeater::make('parameters')->label(__('analytics.forms.fields.sql_variables'))->schema([TextInput::make('key')->label(__('analytics.forms.fields.variable'))->readOnly()->required(), Select::make('type')->label(__('analytics.forms.fields.type'))->options(array_intersect_key(AnalyticsFieldType::options(), array_flip(['text', 'number', 'date'])))->required(), TextInput::make('default')->label(__('analytics.forms.fields.default_value')), Toggle::make('required')->label(__('analytics.forms.fields.required_value'))])->addable(false)->deletable(false)->reorderable(false)->columns(2)],
            'sql' => [Textarea::make('sql')->label('SQL')->rows(18)->required()->maxLength(50000)->extraInputAttributes(['dir' => 'ltr', 'spellcheck' => 'false'])->helperText(__('analytics.forms.helpers.sql'))],
            'display' => [Select::make('display')->label(__('analytics.forms.fields.display_type'))->options(AnalyticsDisplay::options())->required()],
            'visualization' => $this->visualization($context),
            'metadata' => [TextInput::make('original')->label(__('analytics.forms.fields.original_name'))->readOnly()->dehydrated(false), TextInput::make('label_fa')->label(__('analytics.forms.fields.persian_label'))->maxLength(150)->helperText(__('analytics.forms.helpers.original_fallback')), TextInput::make('label_en')->label(__('analytics.forms.fields.english_label'))->maxLength(150), $description(), Select::make('semantic_type')->label(__('analytics.forms.fields.semantic_type'))->options(__('analytics.semantic_types'))->visible($context['column'] ?? false), Toggle::make('hidden')->label(__('analytics.forms.fields.hidden_column'))->visible($context['column'] ?? false)],
            'source' => [$this->select('connection_id', __('analytics.forms.fields.database'), $context['connections'] ?? [])->required()->live()->afterStateUpdated(fn ($set) => $set('source', null)), Select::make('source')->label(__('analytics.forms.fields.table_or_view'))->options(fn (Get $get) => $this->options(collect($context['connections'] ?? [])->firstWhere('key', $get('connection_id'))['catalog'] ?? []))->searchable()->required()],
            'report_card' => [$this->select('report_id', __('analytics.forms.fields.report'), $context['reports'] ?? [])->required()],
            'dashboard_picker' => [$this->select('dashboard_id', __('analytics.forms.fields.dashboard'), $context['dashboards'] ?? [])->required()],
            'card' => [TextInput::make('title')->label(__('analytics.forms.fields.card_title'))->maxLength(150)],
            'dashboard_filter' => $this->dashboardFilter($context),
            'filter_value' => $this->filterValue($context),
            'click' => $this->click($context),
            'stage' => $this->stage($context),
            'confirm' => [Placeholder::make('message')->label('')->content($context['message'] ?? '')],
            default => throw new \InvalidArgumentException('Unknown analytics form'),
        };
    }

    private function options(array $rows): array
    {
        return collect($rows)->mapWithKeys(fn ($row) => [(string) $row['key'] => (string) ($row['label'] ?? $row['name'] ?? $row['key'])])->all();
    }

    private function select(string $name, string $label, array $rows): Select
    {
        return Select::make($name)->label($label)->options($this->options($rows))->searchable()->in(array_keys($this->options($rows)));
    }

    private function fieldType(array $fields, mixed $key): string
    {
        return collect($fields)->firstWhere('key', $key)['type'] ?? 'text';
    }

    private function limit(): TextInput
    {
        return TextInput::make('limit')->label(__('analytics.forms.fields.maximum_rows'))->integer()->minValue(1)->maxValue(1000000)->nullable()->placeholder(__('analytics.forms.placeholders.unlimited'));
    }

    private function metric(array $fields): array
    {
        return [Select::make('function')->label(__('analytics.forms.fields.calculation'))->options(AnalyticsMetric::options())->required()->live()->afterStateUpdated(fn ($set) => $set('field', null)), Select::make('field')->label(__('analytics.forms.fields.column'))->key(fn (Get $get, Select $component) => $component->getStatePath().'-'.$get('function'))->options(fn (Get $get) => $this->options(array_values(array_filter($fields, fn ($field) => ! in_array($get('function'), ['sum', 'avg']) || $field['type'] === 'number'))))->searchable()->live()->required(fn (Get $get) => $get('function') !== 'count')->visible(fn (Get $get) => $get('function') !== 'count'), TextInput::make('label')->label(__('analytics.forms.fields.display_name'))->maxLength(150)];
    }

    private function join(array $context): array
    {
        return [Select::make('type')->label(__('analytics.forms.fields.join_type'))->options(AnalyticsJoinType::options())->required(), $this->select('source', __('analytics.forms.fields.right_table'), $context['tables'] ?? [])->required()->live()->afterStateUpdated(fn ($set) => $set('conditions', [['left' => null, 'right' => null, 'operator' => 'eq']])), Repeater::make('conditions')->label(__('analytics.forms.fields.join_conditions'))->schema([$this->select('left', __('analytics.forms.fields.left_column'), $context['fields'] ?? [])->required(), Select::make('operator')->label(__('analytics.forms.fields.operator'))->options(['eq' => '=', 'neq' => '≠', 'gt' => '>', 'gte' => '≥', 'lt' => '<', 'lte' => '≤'])->required(), Select::make('right')->label(__('analytics.forms.fields.right_column'))->options(fn (Get $get) => $this->options(collect($context['tables'] ?? [])->firstWhere('key', $get('../../source'))['fields'] ?? []))->searchable()->required()])->minItems(1)->maxItems(5)->columns(3)->addActionLabel(__('analytics.forms.actions.add_condition'))->reorderable(false)];
    }

    private function filter(array $fields): array
    {
        $type = fn (Get $get) => $this->fieldType($fields, $get('field'));
        $empty = fn (Get $get) => in_array($get('operator'), ['is_null', 'not_null', 'is_empty', 'not_empty']);
        $range = fn (Get $get) => in_array($get('operator'), ['between', 'not_between']);
        $multiple = fn (Get $get) => in_array($get('operator'), ['in', 'not_in']);

        return [
            $this->select('field', __('analytics.forms.fields.column'), $fields)->required()->live()->afterStateUpdated(function ($set) {
                $set('operator', 'eq');
                $set('value', null);
                $set('date_part', null);
            }),
            Select::make('operator')->label(__('analytics.forms.fields.condition'))->options(fn (Get $get) => $this->operators($type($get)))->required()->live(),
            Select::make('date_mode')->label(__('analytics.forms.fields.date_type'))->options(['specific' => __('analytics.forms.options.specific_date'), 'relative' => __('analytics.forms.options.relative_range')])->live()->visible(fn (Get $get) => $type($get) === 'date' && $range($get)),
            Select::make('date_part')->label(__('analytics.forms.fields.date_part'))->options(['day_of_week' => __('analytics.forms.options.day_of_week'), 'month' => __('analytics.forms.options.month'), 'quarter' => __('analytics.forms.options.quarter'), 'hour' => __('analytics.forms.options.hour')])->nullable()->live()->visible(fn (Get $get) => $type($get) === 'date' && $multiple($get)),
            TextInput::make('value')->label(__('analytics.forms.fields.value'))->maxLength(4000)->visible(fn (Get $get) => ! $empty($get) && ! $range($get) && ($type($get) !== 'date' || $multiple($get)) && $type($get) !== 'boolean')->helperText(__('analytics.forms.helpers.multi_value')),
            Select::make('boolean_value')->label(__('analytics.forms.fields.value'))->options(['true' => __('analytics.forms.options.yes'), 'false' => __('analytics.forms.options.no')])->visible(fn (Get $get) => $type($get) === 'boolean' && ! $empty($get)),
            DatePicker::make('date_value')->label(__('analytics.forms.fields.date'))->native()->visible(fn (Get $get) => $type($get) === 'date' && ! $empty($get) && ! $range($get) && ! $multiple($get) && $get('date_mode') !== 'relative'),
            Grid::make(2)->schema([TextInput::make('from')->label(__('analytics.forms.fields.from'))->maxLength(500), TextInput::make('to')->label(__('analytics.forms.fields.to'))->maxLength(500)])->visible(fn (Get $get) => $range($get) && ($type($get) !== 'date' || $get('date_mode') !== 'relative')),
            Grid::make(3)->schema([TextInput::make('relative_amount')->label(__('analytics.forms.fields.amount'))->integer()->minValue(1)->maxValue(365)->required(), Select::make('relative_unit')->label(__('analytics.forms.fields.unit'))->options(AnalyticsTimeGrain::options())->required(), Select::make('relative_direction')->label(__('analytics.forms.fields.direction'))->options(['past' => __('analytics.forms.options.past'), 'current' => __('analytics.forms.options.current'), 'future' => __('analytics.forms.options.future')])->required(), Toggle::make('include_current')->label(__('analytics.forms.fields.include_current'))])->visible(fn (Get $get) => $type($get) === 'date' && $get('date_mode') === 'relative' && ! $empty($get) && ! $multiple($get)),
            Toggle::make('case_sensitive')->label(__('analytics.forms.fields.case_sensitive'))->visible(fn (Get $get) => $type($get) === 'text' && in_array($get('operator'), ['contains', 'not_contains', 'starts_with', 'ends_with'])),
        ];
    }

    public function operators(string $type): array
    {
        $keys = match ($type) {
            'time_grain' => ['grain'],
            'boolean' => ['eq', 'neq', 'is_null', 'not_null'],
            'text' => ['eq', 'neq', 'in', 'not_in', 'contains', 'not_contains', 'starts_with', 'ends_with', 'is_null', 'not_null', 'is_empty', 'not_empty'],
            default => ['eq', 'neq', 'in', 'not_in', 'between', 'not_between', 'gt', 'gte', 'lt', 'lte', 'is_null', 'not_null'],
        };

        return array_intersect_key(AnalyticsFilterOperator::options(), array_flip($keys));
    }

    private function dashboardFilter(array $context): array
    {
        return [
            TextInput::make('label')->label(__('analytics.forms.fields.filter_title'))->required()->maxLength(100),
            Select::make('type')->label(__('analytics.forms.fields.type'))->options(AnalyticsFieldType::options())->required()->live()->afterStateUpdated(function ($set) {
                $set('operator', null);
                $set('bindings', []);
                $set('default_value', null);
            }),
            Select::make('operator')->label(__('analytics.forms.fields.condition'))->options(fn (Get $get) => $this->operators($get('type') ?? 'text'))->required()->live(),
            Toggle::make('required')->label(__('analytics.forms.fields.required_selection')),
            Select::make('widget_type')->label(__('analytics.forms.fields.value_input'))->options(['dropdown' => __('analytics.forms.options.dropdown'), 'search' => __('analytics.forms.options.search'), 'input' => __('analytics.forms.options.input')])->required()->live(),
            TextInput::make('values')->label(__('analytics.forms.fields.custom_values'))->helperText(__('analytics.forms.helpers.custom_values'))->maxLength(50000)->live(onBlur: true),
            Toggle::make('case_sensitive')->label(__('analytics.forms.fields.case_sensitive')),
            $this->select('parent_key', __('analytics.forms.fields.dependent_filter'), $context['parents'] ?? [])->disabled(fn (Get $get) => $get('widget_type') === 'input' || filled($get('values'))),
            Section::make(__('analytics.forms.fields.filter_default'))->schema($this->dateValueFields()),
            Repeater::make('bindings')->label(__('analytics.forms.fields.card_bindings'))->schema([
                $this->select('widget_key', __('analytics.forms.fields.card'), $context['widgets'] ?? [])->required()->live()->afterStateUpdated(fn ($set) => $set('target', null)),
                Select::make('target')->label(__('analytics.forms.fields.target_column'))->options(fn (Get $get) => $this->options(array_values(array_filter(collect($context['widgets'] ?? [])->firstWhere('key', $get('widget_key'))['fields'] ?? [], fn ($field) => $get('../../type') === 'time_grain' ? $field['type'] === 'date' && ! empty($field['is_dimension']) : $field['type'] === $get('../../type')))))->searchable()->required(),
            ])->maxItems(60)->columns(2)->addActionLabel(__('analytics.forms.actions.bind_card'))->reorderable(false),
        ];
    }

    private function dateValueFields(?string $fixedType = null): array
    {
        return [
            Select::make('value_mode')->label(__('analytics.forms.fields.value_type'))->options(function (Get $get) use ($fixedType) {
                $type = $fixedType ?? $get('type') ?? 'text';

                return ['none' => __('analytics.forms.options.none_value'), 'specific' => __('analytics.forms.options.specific_value')]
                    + (in_array($type, ['number', 'date']) ? ['range' => __('analytics.forms.options.range')] : [])
                    + ($type === 'date' ? ['relative' => __('analytics.forms.options.relative_date'), 'parts' => __('analytics.forms.options.date_parts'), 'presence' => __('analytics.forms.options.date_presence')] : [])
                    + ($type !== 'time_grain' ? ['null' => __('analytics.forms.options.null')] : [])
                    + ($type === 'text' ? ['empty' => __('analytics.forms.options.empty')] : []);
            })->live()->required(),
            TextInput::make('value')->label(__('analytics.forms.fields.comma_values'))->maxLength(50000)->visible(fn (Get $get) => $get('value_mode') === 'specific'),
            Grid::make(2)->schema([TextInput::make('from')->label(__('analytics.forms.fields.from'))->required(), TextInput::make('to')->label(__('analytics.forms.fields.to'))->required()])->visible(fn (Get $get) => $get('value_mode') === 'range'),
            Grid::make(3)->schema([TextInput::make('relative_amount')->label(__('analytics.forms.fields.amount'))->integer()->minValue(1)->maxValue(365)->required(), Select::make('relative_unit')->label(__('analytics.forms.fields.unit'))->options(AnalyticsTimeGrain::options())->required(), Select::make('relative_direction')->label(__('analytics.forms.fields.direction'))->options(['past' => __('analytics.forms.options.past'), 'current' => __('analytics.forms.options.current'), 'future' => __('analytics.forms.options.future')])->required(), Toggle::make('include_current')->label(__('analytics.forms.fields.include_current'))])->visible(fn (Get $get) => $get('value_mode') === 'relative'),
            Select::make('date_part')->label(__('analytics.forms.fields.date_part'))->options(['day_of_week' => __('analytics.forms.options.day_of_week_range'), 'month' => __('analytics.forms.options.month_range'), 'quarter' => __('analytics.forms.options.quarter_range'), 'hour' => __('analytics.forms.options.hour_range')])->visible(fn (Get $get) => $get('value_mode') === 'parts')->required(),
            TextInput::make('part_values')->label(__('analytics.forms.fields.date_part_values'))->helperText(__('analytics.forms.helpers.date_parts'))->visible(fn (Get $get) => $get('value_mode') === 'parts')->required(),
            Toggle::make('presence_empty')->label(__('analytics.forms.fields.presence_empty'))->visible(fn (Get $get) => $get('value_mode') === 'presence'),
            Toggle::make('exclude')->label(__('analytics.forms.fields.exclude'))->visible(fn (Get $get) => in_array($get('value_mode'), ['range', 'relative', 'parts'])),
        ];
    }

    private function filterValue(array $context): array
    {
        if (($context['type'] ?? '') === 'time_grain') {
            return [Select::make('value')->label(__('analytics.forms.fields.period'))->options(AnalyticsTimeGrain::options())->nullable()];
        }

        return [
            ...$this->dateValueFields($context['type'] ?? 'text'),
            Select::make('suggestions')->label(__('analytics.forms.fields.database_values'))->multiple()->searchable()->options($this->options($context['suggestions'] ?? []))->getSearchResultsUsing(fn (string $search) => $this->filterSearch($context, $search))->getOptionLabelsUsing(fn (array $values) => collect($values)->mapWithKeys(fn ($value) => [(string) $value => (string) $value])->all())->live()->afterStateUpdated(fn ($set) => $set('value_mode', 'specific'))->visible(in_array($context['type'] ?? '', ['text', 'number', 'boolean']))->helperText(__('analytics.forms.helpers.suggestions')),
        ];
    }

    private function visualization(array $context): array
    {
        $columns = $context['fields'] ?? [];
        $number = array_values(array_filter($columns, fn ($field) => $field['type'] === 'number'));

        return [Tabs::make('visualization')->tabs([
            Tabs\Tab::make(__('analytics.forms.sections.data'))->schema([Select::make('display')->label(__('analytics.forms.fields.display_type'))->options(AnalyticsDisplay::options())->required()->live(), $this->select('x', __('analytics.forms.fields.horizontal_axis'), $columns)->visible(fn (Get $get) => ! in_array($get('display'), ['table', 'number', 'progress', 'gauge'])), $this->select('y', __('analytics.forms.fields.numeric_value'), $number)->visible(fn (Get $get) => $get('display') !== 'table'), $this->select('split', __('analytics.forms.fields.pivot_columns'), $columns)->visible(fn (Get $get) => $get('display') === 'pivot'), CheckboxList::make('visible_columns')->label(__('analytics.forms.fields.table_columns'))->options($this->options($columns))->searchable()->columns(2)->visible(fn (Get $get) => $get('display') === 'table'), Select::make('page_size')->label(__('analytics.forms.fields.page_size'))->options([10 => 10, 25 => 25, 50 => 50, 100 => 100])->visible(fn (Get $get) => $get('display') === 'table')]),
            Tabs\Tab::make(__('analytics.forms.sections.display'))->schema([
                TextInput::make('caption')->label(__('analytics.forms.fields.caption'))->maxLength(150), ColorPicker::make('color')->label(__('analytics.forms.fields.primary_color'))->hex(),
                TextInput::make('target')->label(__('analytics.forms.fields.target'))->numeric()->minValue(0.000001)->visible(fn (Get $get) => in_array($get('display'), ['progress', 'gauge'])),
                ...collect(['legend', 'stacked', 'horizontal', 'points', 'smooth', 'color_by_category', 'show_total'])->map(fn ($key) => Toggle::make($key)->label(__('analytics.forms.fields.'.$key))->visible(fn (Get $get) => in_array($get('display'), match ($key) {
                    'legend' => ['bar', 'line', 'area', 'pie', 'doughnut'],
                    'stacked' => ['bar', 'area'],
                    'horizontal', 'color_by_category' => ['bar'],
                    'points', 'smooth' => ['line', 'area'],
                    default => ['doughnut'],
                })))->values()->all(),
                Select::make('gauge_style')->label(__('analytics.forms.fields.gauge_style'))->options(['semi' => __('analytics.forms.options.semi'), 'ring' => __('analytics.forms.options.ring')])->visible(fn (Get $get) => $get('display') === 'gauge'),
                Select::make('center_mode')->label(__('analytics.forms.fields.center_value'))->options(['total' => __('analytics.forms.options.total'), 'percentage' => __('analytics.forms.options.percentage'), 'none' => __('analytics.forms.options.hidden')])->visible(fn (Get $get) => $get('display') === 'doughnut'),
                Select::make('percent_visibility')->label(__('analytics.forms.fields.percent_visibility'))->options(['off' => __('analytics.forms.options.hidden'), 'tooltip' => __('analytics.forms.options.tooltip'), 'legend' => __('analytics.forms.options.legend'), 'inside' => __('analytics.forms.options.inside'), 'both' => __('analytics.forms.options.both')])->visible(fn (Get $get) => in_array($get('display'), ['pie', 'doughnut'])),
                TextInput::make('ring_thickness')->label(__('analytics.forms.fields.ring_thickness'))->integer()->minValue(10)->maxValue(45)->visible(fn (Get $get) => $get('display') === 'doughnut'),
                $this->select('center_key', __('analytics.forms.fields.center_category'), $context['colors'] ?? [])->visible(fn (Get $get) => $get('display') === 'doughnut'),
                Repeater::make('series_colors')->label(__('analytics.forms.fields.series_colors'))->schema([TextInput::make('key')->label(__('analytics.forms.fields.identifier'))->readOnly()->required(), TextInput::make('label')->label(__('analytics.forms.fields.category'))->readOnly()->dehydrated(false), ColorPicker::make('color')->label(__('analytics.forms.fields.color'))->hex()->required()])->addable(false)->deletable(false)->reorderable(false)->columns(3),
                Toggle::make('reset_colors')->label(__('analytics.forms.fields.reset_colors')),
            ]),
            Tabs\Tab::make(__('analytics.forms.sections.axes'))->visible(fn (Get $get) => in_array($get('display'), ['bar', 'line', 'area', 'scatter']))->schema([Toggle::make('show_x')->label(__('analytics.forms.fields.show_x')), TextInput::make('x_label')->label(__('analytics.forms.fields.x_label'))->maxLength(150), Toggle::make('show_y')->label(__('analytics.forms.fields.show_y')), TextInput::make('y_label')->label(__('analytics.forms.fields.y_label'))->maxLength(150), TextInput::make('y_min')->label(__('analytics.forms.fields.minimum'))->numeric(), TextInput::make('y_max')->label(__('analytics.forms.fields.maximum'))->numeric()]),
            Tabs\Tab::make(__('analytics.forms.sections.formatting'))->schema([TextInput::make('decimals')->label(__('analytics.forms.fields.decimals'))->integer()->minValue(0)->maxValue(6), TextInput::make('prefix')->label(__('analytics.forms.fields.prefix'))->maxLength(150), TextInput::make('suffix')->label(__('analytics.forms.fields.suffix'))->maxLength(150)]),
        ])];
    }

    private function click(array $context): array
    {
        return [
            $this->select('scope', __('analytics.forms.fields.click_scope'), [['key' => '*', 'label' => __('analytics.forms.options.default_card')], ...($context['fields'] ?? [])])->required(),
            Select::make('type')->label(__('analytics.forms.fields.on_click'))->options(['menu' => __('analytics.forms.options.click_menu'), 'none' => __('analytics.forms.options.no_action'), 'filter' => __('analytics.forms.options.change_filters'), 'dashboard' => __('analytics.forms.options.go_dashboard'), 'report' => __('analytics.forms.options.go_report'), 'url' => __('analytics.forms.options.go_url')])->required()->live(),
            $this->select('dashboard_id', __('analytics.forms.fields.destination_dashboard'), $context['dashboards'] ?? [])->visible(fn (Get $get) => $get('type') === 'dashboard')->required()->live()->afterStateUpdated(fn ($set) => $set('mappings', [])),
            $this->select('report_id', __('analytics.forms.fields.destination_report'), $context['reports'] ?? [])->visible(fn (Get $get) => $get('type') === 'report')->required()->live()->afterStateUpdated(fn ($set) => $set('mappings', [])),
            TextInput::make('url')->label(__('analytics.forms.fields.destination_url'))->maxLength(4000)->startsWith(['http://', 'https://'])->required()->visible(fn (Get $get) => $get('type') === 'url')->helperText(__('analytics.forms.helpers.url_variables')),
            TextInput::make('link_text')->label(__('analytics.forms.fields.link_text'))->maxLength(500)->visible(fn (Get $get) => $get('type') === 'url'),
            Repeater::make('mappings')->label(__('analytics.forms.fields.mappings'))->schema([
                Select::make('target')->label(__('analytics.forms.fields.destination_field'))->options(fn (Get $get) => $this->options($this->clickTargets($context, $get('../../type'), $get('../../dashboard_id'), $get('../../report_id'))))->required()->searchable()->live()->afterStateUpdated(fn ($set) => $set('key', null)),
                Select::make('source')->label(__('analytics.forms.fields.source_type'))->options(fn (Get $get) => $get('../../type') === 'filter' ? ['column' => __('analytics.forms.options.result_column')] : ['column' => __('analytics.forms.options.result_column'), 'parameter' => __('analytics.forms.options.dashboard_filter')])->required()->live(),
                Select::make('key')->label(__('analytics.forms.fields.source_value'))->options(function (Get $get) use ($context) {
                    $target = collect($this->clickTargets($context, $get('../../type'), $get('../../dashboard_id'), $get('../../report_id')))->firstWhere('key', $get('target'));
                    $sources = $get('source') === 'parameter' ? ($context['parameters'] ?? []) : ($context['fields'] ?? []);

                    return $this->options(array_values(array_filter($sources, fn ($source) => ! isset($target['type'], $source['type']) || $target['type'] === $source['type'] || ($target['type'] === 'time_grain' && $source['type'] === 'date'))));
                })->required()->searchable(),
            ])->visible(fn (Get $get) => in_array($get('type'), ['filter', 'dashboard', 'report']))->maxItems(20)->columns(3),
            Placeholder::make('targets')->label(__('analytics.forms.fields.destination_targets'))->content($context['target_help'] ?? ''),
            Toggle::make('inherit')->label(__('analytics.forms.fields.inherit')),
        ];
    }

    private function stage(array $context): array
    {
        $fields = $context['fields'] ?? [];

        return [Select::make('mode')->label(__('analytics.forms.fields.stage_type'))->options(['rows' => __('analytics.forms.options.rows'), 'aggregate' => __('analytics.forms.options.aggregate')])->required()->live(),
            Repeater::make('joins')->label(__('analytics.forms.fields.joins'))->schema([Hidden::make('alias')->default(fn () => 'join_'.Str::lower(Str::random(8))), ...$this->join($context)])->maxItems(5),
            Repeater::make('expressions')->label(__('analytics.forms.fields.expressions'))->schema([Hidden::make('key')->default(fn () => 'custom_'.Str::lower(Str::random(8))), TextInput::make('label')->label(__('analytics.forms.fields.column_name'))->required()->maxLength(150), Textarea::make('expression')->label(__('analytics.forms.fields.formula'))->required()->maxLength(2000)->rows(3)->extraInputAttributes(['dir' => 'ltr'])])->maxItems(10),
            Repeater::make('filters')->label(__('analytics.forms.fields.filters'))->schema($this->filter($fields))->maxItems(30),
            Repeater::make('metrics')->label(__('analytics.forms.fields.metrics'))->schema([Hidden::make('key')->default(fn () => 'metric_'.Str::lower(Str::random(8))), ...$this->metric($fields)])->maxItems(10)->visible(fn (Get $get) => $get('mode') === 'aggregate'),
            Repeater::make('dimensions')->label(__('analytics.forms.fields.dimensions'))->schema([$this->select('field', __('analytics.forms.fields.column'), $fields)->required(), Select::make('grain')->label(__('analytics.forms.fields.time_grain'))->options(AnalyticsTimeGrain::options())->nullable()])->maxItems(6)->visible(fn (Get $get) => $get('mode') === 'aggregate'),
            CheckboxList::make('columns')->label(__('analytics.forms.fields.columns'))->options($this->options($fields))->searchable()->columns(2)->maxItems(50)->visible(fn (Get $get) => $get('mode') === 'rows'),
            Repeater::make('sort')->label(__('analytics.forms.fields.sorting'))->schema([$this->select('key', __('analytics.forms.fields.column'), [...$fields, ...($context['output'] ?? [])])->required(), Select::make('direction')->label(__('analytics.forms.fields.order'))->options(['asc' => __('analytics.forms.options.ascending'), 'desc' => __('analytics.forms.options.descending')])->required()])->maxItems(6),
            $this->limit(),
        ];
    }

    private function filterSearch(array $context, string $search): array
    {
        $dashboard = AnalyticsDashboard::findOrFail($context['dashboard_id'] ?? 0);
        abort_unless($dashboard->canRead((int) Filament::auth()->id()), 403);
        $response = app(FilterValueService::class)->options($dashboard, app(DashboardStore::class)->snapshot($dashboard), $context['filter_key'], $context['parameters'] ?? [], ['search' => mb_substr($search, 0, 200), 'limit' => 100]);

        return collect($response['values'])->filter(fn ($value) => is_scalar($value))->mapWithKeys(fn ($value) => [(string) $value => (string) $value])->all();
    }

    private function clickTargets(array $context, ?string $type, mixed $dashboardId, mixed $reportId): array
    {
        if ($type === 'filter') {
            return $context['parameters'] ?? [];
        }
        if ($type === 'report') {
            return $context['report_targets'][$reportId] ?? [];
        }
        if ($type !== 'dashboard' || ! $dashboardId) {
            return [];
        }
        $dashboard = AnalyticsDashboard::find($dashboardId);
        if (! $dashboard || ! $dashboard->canRead((int) Filament::auth()->id())) {
            return [];
        }

        return $dashboard->filters()->get(['key', 'label', 'type'])->toArray();
    }

    private function expression(array $context): array
    {
        $fields = $context['fields'] ?? [];
        $append = function ($set, Get $get, $state) {
            $set('expression', ($get('expression') ?? '').$state);
        };

        return [
            TextInput::make('label')->label(__('analytics.forms.fields.column_name'))->required()->maxLength(150)->extraInputAttributes(['name' => 'label', 'data-expression-name' => '']),
            Textarea::make('expression')->label(__('analytics.forms.fields.formula'))->required()->maxLength(2000)->rows(8)->extraInputAttributes(['name' => 'expression', 'data-expression-editor' => '', 'dir' => 'ltr', 'spellcheck' => 'false']),
            ViewField::make('expression_assistance')->view('filament.partials.analytics-expression-assistance')->dehydrated(false),
            Grid::make(2)->schema([
                $this->select('insert_field', __('analytics.forms.fields.insert_column'), $fields)->live()->dehydrated(false)->afterStateUpdated(function ($set, Get $get, $state) use ($append) {
                    if ($state) {
                        $append($set, $get, '['.$state.']');
                    } $set('insert_field', null);
                }),
                Select::make('insert_function')->label(__('analytics.forms.fields.insert_function'))->options(collect($context['functions'] ?? [])->mapWithKeys(fn ($function) => [$function['key'] => $function['signature'].' — '.$function['description']])->all())->searchable()->live()->dehydrated(false)->afterStateUpdated(function ($set, Get $get, $state) use ($append) {
                    if ($state) {
                        $append($set, $get, $state.'()');
                    } $set('insert_function', null);
                }),
            ]),
            Section::make(__('analytics.forms.sections.combine_text'))->collapsed()->schema([
                $this->select('combine_first', __('analytics.forms.fields.first_column'), array_values(array_filter($fields, fn ($field) => $field['type'] === 'text')))->dehydrated(false),
                TextInput::make('combine_separator')->label(__('analytics.forms.fields.separator'))->default(' — ')->dehydrated(false),
                $this->select('combine_second', __('analytics.forms.fields.second_column'), array_values(array_filter($fields, fn ($field) => $field['type'] === 'text')))->dehydrated(false),
                Actions::make([Action::make('combine')->label(__('analytics.forms.actions.use_formula'))->action(function ($set, Get $get) {
                    if (! $get('combine_first') || ! $get('combine_second')) {
                        return;
                    }
                    $separator = str_replace('"', '""', $get('combine_separator') ?? '');
                    $set('expression', 'concat(coalesce(['.$get('combine_first').'], ""), "'.$separator.'", coalesce(['.$get('combine_second').'], ""))');
                })]),
            ]),
        ];
    }
}
