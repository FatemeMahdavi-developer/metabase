<?php

namespace App\Filament\Resources;

use App\Domain\Analytics\Filament\PanelActions;
use App\Enums\AnalyticsDatabaseDriver;
use App\Enums\AnalyticsSslMode;
use App\Filament\Pages\AnalyticsDatabaseBrowser;
use App\Filament\Resources\AnalyticsConnectionResource\Pages;
use App\Filament\Resources\Concerns\AnalyticsResourceHelpers;
use App\Models\AnalyticsConnection;
use Filament\Forms\Components\Section;
use Filament\Forms\Components\Select;
use Filament\Forms\Components\TextInput;
use Filament\Forms\Components\Toggle;
use Filament\Forms\Form;
use Filament\Forms\Get;
use Filament\Forms\Set;
use Filament\Notifications\Notification;
use Filament\Resources\Resource;
use Filament\Tables;
use Filament\Tables\Columns\TextColumn;
use Filament\Tables\Table;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Validation\ValidationException;

class AnalyticsConnectionResource extends Resource
{
    use AnalyticsResourceHelpers;

    protected static ?string $model = AnalyticsConnection::class;

    protected static ?string $slug = 'analytics/databases';

    protected static ?string $navigationIcon = null;

    public static function getNavigationGroup(): ?string
    {
        return __('analytics.navigation.group');
    }

    public static function getNavigationLabel(): string
    {
        return __('analytics.navigation.databases');
    }

    public static function getModelLabel(): string
    {
        return __('analytics.navigation.database');
    }

    public static function getPluralModelLabel(): string
    {
        return __('analytics.navigation.databases');
    }

    protected static ?string $recordTitleAttribute = 'name';

    protected static ?int $navigationSort = 30;

    protected static string $editorRoute = 'analytics.database-browser';

    public static function getEloquentQuery(): Builder
    {
        return parent::getEloquentQuery()->where('owner_id', static::ownerId())->whereIn('driver', ['pgsql', 'clickhouse']);
    }

    public static function form(Form $form): Form
    {
        return $form->schema([
            TextInput::make('name')->label(__('analytics.connections.fields.name'))->required()->maxLength(150)->autofocus()->helperText(__('analytics.connections.helpers.unique_name')),
            Select::make('driver')->label(__('analytics.connections.fields.driver'))->options(AnalyticsDatabaseDriver::options())->required()->default(AnalyticsDatabaseDriver::POSTGRESQL->value)->native()->live()
                ->afterStateUpdated(function (string $state, Set $set): void {
                    $set('configuration', ['host' => 'localhost', 'port' => $state === 'pgsql' ? 5432 : 8123, 'database' => $state === 'pgsql' ? 'unisq' : '', 'username' => $state === 'pgsql' ? 'postgres' : 'default', 'ssl' => false, 'sslmode' => 'prefer']);
                }),
            Section::make(__('analytics.connections.fields.details'))->schema([
                TextInput::make('configuration.host')->label(__('analytics.connections.fields.host'))->default('localhost')->required()->maxLength(200)->extraInputAttributes(['dir' => 'ltr'])->helperText(__('analytics.connections.helpers.host')),
                TextInput::make('configuration.port')->label(__('analytics.connections.fields.port'))->default(fn (Get $get) => $get('driver') === AnalyticsDatabaseDriver::CLICKHOUSE->value ? 8123 : 5432)->required()->integer()->minValue(1)->maxValue(65535)->dehydrateStateUsing(fn ($state) => (int) $state)->extraInputAttributes(['dir' => 'ltr']),
                TextInput::make('configuration.database')->label(__('analytics.connections.fields.database'))->default(fn (Get $get) => $get('driver') === AnalyticsDatabaseDriver::POSTGRESQL->value ? 'unisq' : '')->required()->maxLength(150)->extraInputAttributes(['dir' => 'ltr'])->helperText(__('analytics.connections.helpers.unique_endpoint')),
                TextInput::make('configuration.username')->label(__('analytics.connections.fields.username'))->default(fn (Get $get) => $get('driver') === AnalyticsDatabaseDriver::CLICKHOUSE->value ? 'default' : 'postgres')->required()->maxLength(150)->extraInputAttributes(['dir' => 'ltr']),
                TextInput::make('configuration.password')->label(__('analytics.connections.fields.password'))->password()->revealable()->maxLength(500)->autocomplete('new-password')->dehydrated(fn ($state) => filled($state))->helperText(__('analytics.connections.helpers.password')),
                Toggle::make('configuration.ssl')->label(__('analytics.connections.fields.https'))->default(false)->visible(fn (Get $get) => $get('driver') === AnalyticsDatabaseDriver::CLICKHOUSE->value),
                Select::make('configuration.sslmode')->label(__('analytics.connections.fields.ssl_mode'))->options(AnalyticsSslMode::options())->default(AnalyticsSslMode::PREFER->value)->visible(fn (Get $get) => $get('driver') === AnalyticsDatabaseDriver::POSTGRESQL->value),
            ])->columns(2),
            Toggle::make('test_first')->label(__('analytics.connections.fields.test_first'))->default(false)->helperText(__('analytics.connections.helpers.test_first')),
        ]);
    }

    public static function table(Table $table): Table
    {
        return $table
            ->columns([
                TextColumn::make('name')->label(__('analytics.connections.table.name'))->searchable()->sortable()->icon('heroicon-o-circle-stack'),
                TextColumn::make('driver')->label(__('analytics.connections.table.engine'))->formatStateUsing(fn (string $state) => AnalyticsDatabaseDriver::tryFrom($state)?->label() ?? $state)->badge(),
                TextColumn::make('status')->label(__('analytics.connections.table.status'))->getStateUsing(fn (AnalyticsConnection $record) => $record->synced_at ? __('analytics.connections.table.synced') : __('analytics.connections.table.needs_sync'))->badge()->color(fn (AnalyticsConnection $record) => $record->synced_at ? 'success' : 'warning'),
                TextColumn::make('table_count')->label(__('analytics.connections.table.tables'))->getStateUsing(fn (AnalyticsConnection $record) => count($record->catalog ?? [])),
                TextColumn::make('synced_at')->label(__('analytics.connections.table.last_sync'))->since()->placeholder(__('analytics.connections.table.never'))->sortable(),
            ])
            ->filters([Tables\Filters\SelectFilter::make('driver')->label(__('analytics.connections.table.engine'))->options(AnalyticsDatabaseDriver::options())])
            ->recordUrl(fn (AnalyticsConnection $record) => AnalyticsDatabaseBrowser::getUrl(['record' => $record->id]))
            ->actions([
                Tables\Actions\Action::make('browse')->label(__('analytics.connections.actions.browse'))->icon('heroicon-o-table-cells')->url(fn (AnalyticsConnection $record) => AnalyticsDatabaseBrowser::getUrl(['record' => $record->id])),
                Tables\Actions\EditAction::make()->label(__('analytics.connections.actions.edit'))->modalHeading(__('analytics.connections.actions.edit_heading'))->fillForm(fn (AnalyticsConnection $record) => app(PanelActions::class)->connectionFormData($record))
                    ->using(fn (AnalyticsConnection $record, array $data, $livewire) => app(PanelActions::class)->withForm($livewire->getMountedTableActionForm(), fn () => app(PanelActions::class)->saveConnection($data, $record))),
                Tables\Actions\Action::make('test')->label(__('analytics.connections.actions.test'))->icon('heroicon-o-signal')->action(function (AnalyticsConnection $record): void {
                    static::connectionOperation(fn () => app(PanelActions::class)->testConnection($record), __('analytics.connections.notifications.connected'));
                }),
                Tables\Actions\Action::make('sync')->label(__('analytics.connections.actions.sync'))->icon('heroicon-o-arrow-path')->action(function (AnalyticsConnection $record): void {
                    static::connectionOperation(fn () => app(PanelActions::class)->syncConnection($record), __('analytics.connections.notifications.synced'));
                }),
                Tables\Actions\DeleteAction::make()->label(__('analytics.connections.actions.delete'))->using(fn (AnalyticsConnection $record) => app(PanelActions::class)->withoutForm(fn () => app(PanelActions::class)->deleteConnection($record))),
            ])
            ->defaultSort('name')->emptyStateHeading(__('analytics.connections.empty.heading'))->emptyStateDescription(__('analytics.connections.empty.description'));
    }

    private static function connectionOperation(callable $operation, string $title): void
    {
        try {
            $operation();
            Notification::make()->title($title)->success()->send();
        } catch (ValidationException $exception) {
            Notification::make()->title(__('analytics.connections.notifications.failed'))->body(collect($exception->errors())->flatten()->first())->danger()->send();
        }
    }

    public static function getPages(): array
    {
        return ['index' => Pages\ListAnalyticsConnections::route('/')];
    }
}
