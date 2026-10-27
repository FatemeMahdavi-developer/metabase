<?php

namespace App\Filament\Resources;

use App\Domain\Analytics\Filament\PanelActions;
use App\Filament\Pages\AnalyticsDashboardEditor;
use App\Filament\Resources\AnalyticsDashboardResource\Pages;
use App\Filament\Resources\Concerns\AnalyticsResourceHelpers;
use App\Models\AnalyticsDashboard;
use App\Models\AnalyticsDashboardMember;
use App\Models\AnalyticsFolder;
use Filament\Forms\Components\Toggle;
use Filament\Forms\Form;
use Filament\Resources\Resource;
use Filament\Tables;
use Filament\Tables\Columns\TextColumn;
use Filament\Tables\Table;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;

class AnalyticsDashboardResource extends Resource
{
    use AnalyticsResourceHelpers;

    protected static ?string $model = AnalyticsDashboard::class;

    protected static ?string $slug = 'analytics/dashboards';

    protected static ?string $navigationIcon = null;

    public static function getNavigationGroup(): ?string
    {
        return __('analytics.navigation.group');
    }

    public static function getNavigationLabel(): string
    {
        return __('analytics.navigation.dashboards');
    }

    public static function getModelLabel(): string
    {
        return __('analytics.navigation.dashboard');
    }

    public static function getPluralModelLabel(): string
    {
        return __('analytics.navigation.dashboards');
    }

    protected static ?string $recordTitleAttribute = 'name';

    protected static ?int $navigationSort = 10;

    protected static string $editorRoute = 'analytics.dashboard-editor';

    public static function getEloquentQuery(): Builder
    {
        $owner = static::ownerId();

        return parent::getEloquentQuery()->where(fn (Builder $query) => $query->where('owner_id', $owner)
            ->orWhereIn('id', AnalyticsDashboardMember::query()->where('user_id', $owner)->select('dashboard_id')));
    }

    public static function canDelete(Model $record): bool
    {
        return $record->owner_id === static::ownerId();
    }

    public static function form(Form $form): Form
    {
        return $form->schema(static::metadataSchema());
    }

    public static function table(Table $table): Table
    {
        return $table
            ->columns([
                Tables\Columns\ToggleColumn::make('is_active')->label('فعال')
                    ->disabled(fn (AnalyticsDashboard $record) => ! $record->canEdit(static::ownerId()))
                    ->beforeStateUpdated(function (AnalyticsDashboard $record): void {
                        abort_unless($record->canEdit(static::ownerId()), 403);
                    })
                    ->afterStateUpdated(fn ($livewire) => $livewire->redirect(static::getUrl())),
                TextColumn::make('name')->label(__('analytics.resources.columns.dashboard_name'))->searchable()->sortable()->icon('heroicon-o-squares-2x2')->description(fn (AnalyticsDashboard $record) => $record->description)->wrap(),
                TextColumn::make('folder_id')->label(__('analytics.resources.fields.folder'))->formatStateUsing(fn ($state) => AnalyticsFolder::query()->where('id', $state)->value('name') ?? __('analytics.resources.fields.no_folder'))->placeholder(__('analytics.resources.fields.no_folder'))->toggleable(),
                TextColumn::make('access')->label(__('analytics.resources.columns.access'))->getStateUsing(fn (AnalyticsDashboard $record) => $record->owner_id === static::ownerId() ? __('analytics.resources.roles.owner') : ($record->canEdit(static::ownerId()) ? __('analytics.resources.roles.editor') : __('analytics.resources.roles.viewer')))->badge(),
                TextColumn::make('updated_at')->label(__('analytics.resources.columns.updated_at'))->since()->sortable(),
            ])
            ->filters([static::folderFilter()])
            ->recordUrl(fn (AnalyticsDashboard $record) => AnalyticsDashboardEditor::getUrl(['record' => $record->id]))
            ->actions([
                Tables\Actions\Action::make('open')->label(__('analytics.resources.actions.open'))->icon('heroicon-o-arrow-top-right-on-square')->url(fn (AnalyticsDashboard $record) => AnalyticsDashboardEditor::getUrl(['record' => $record->id])),
                Tables\Actions\Action::make('copy')->label(__('analytics.resources.actions.copy'))->icon('heroicon-o-document-duplicate')->visible(fn (AnalyticsDashboard $record) => $record->owner_id === static::ownerId())
                    ->form([Toggle::make('copy_reports')->label(__('analytics.resources.actions.copy_dashboard_reports'))->default(false)])
                    ->action(function (AnalyticsDashboard $record, array $data, $livewire): void {
                        $copy = app(PanelActions::class)->copyDashboard($record, $data['copy_reports']);
                        $livewire->redirect(AnalyticsDashboardEditor::getUrl(['record' => $copy->id]));
                    }),
                Tables\Actions\DeleteAction::make()->label(__('analytics.resources.actions.delete'))->using(fn (AnalyticsDashboard $record) => app(PanelActions::class)->withoutForm(fn () => app(PanelActions::class)->deleteDashboard($record))),
            ])
            ->reorderable('sort_order')
            ->reorderRecordsTriggerAction(fn (Tables\Actions\Action $action) => $action->button()->label('تغییر ترتیب داشبوردها'))
            ->defaultSort('sort_order')
            ->emptyStateHeading(__('analytics.resources.empty.dashboards_heading'))->emptyStateDescription(__('analytics.resources.empty.dashboards_description'));
    }

    public static function getPages(): array
    {
        return ['index' => Pages\ListAnalyticsDashboards::route('/')];
    }
}
