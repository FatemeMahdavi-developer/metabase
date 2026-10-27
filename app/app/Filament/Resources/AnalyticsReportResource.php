<?php

namespace App\Filament\Resources;

use App\Domain\Analytics\Filament\PanelActions;
use App\Enums\AnalyticsDisplay;
use App\Filament\Pages\AnalyticsReportEditor;
use App\Filament\Resources\AnalyticsReportResource\Pages;
use App\Filament\Resources\Concerns\AnalyticsResourceHelpers;
use App\Models\AnalyticsFolder;
use App\Models\AnalyticsReport;
use Filament\Forms\Components\Hidden;
use Filament\Forms\Form;
use Filament\Notifications\Notification;
use Filament\Resources\Resource;
use Filament\Tables;
use Filament\Tables\Columns\TextColumn;
use Filament\Tables\Table;
use Illuminate\Database\Eloquent\Builder;

class AnalyticsReportResource extends Resource
{
    use AnalyticsResourceHelpers;

    protected static ?string $model = AnalyticsReport::class;

    protected static ?string $slug = 'analytics/reports';

    protected static ?string $navigationIcon = null;

    public static function getNavigationGroup(): ?string
    {
        return __('analytics.navigation.group');
    }

    public static function getNavigationLabel(): string
    {
        return __('analytics.navigation.reports');
    }

    public static function getModelLabel(): string
    {
        return __('analytics.navigation.report');
    }

    public static function getPluralModelLabel(): string
    {
        return __('analytics.navigation.reports');
    }

    protected static ?string $recordTitleAttribute = 'name';

    protected static ?int $navigationSort = 20;

    protected static string $editorRoute = 'analytics.report-editor';

    public static function getEloquentQuery(): Builder
    {
        return parent::getEloquentQuery()->where('owner_id', static::ownerId());
    }

    public static function form(Form $form): Form
    {
        return $form->schema([...static::metadataSchema(), Hidden::make('version')->required()->rule('integer')]);
    }

    public static function table(Table $table): Table
    {
        $displays = collect(config('analytics.displays'))->mapWithKeys(fn (string $display) => [$display => AnalyticsDisplay::tryFrom($display)?->label() ?? $display])->all();

        return $table
            ->columns([
                TextColumn::make('name')->label(__('analytics.resources.columns.report_name'))->searchable()->sortable()->description(fn (AnalyticsReport $record) => $record->description)->wrap(),
                TextColumn::make('display')->label(__('analytics.resources.columns.display'))->formatStateUsing(fn (string $state) => $displays[$state] ?? $state)->badge(),
                TextColumn::make('folder_id')->label(__('analytics.resources.fields.folder'))->formatStateUsing(fn ($state) => AnalyticsFolder::query()->where('id', $state)->value('name') ?? __('analytics.resources.fields.no_folder'))->placeholder(__('analytics.resources.fields.no_folder'))->toggleable(),
                TextColumn::make('updated_at')->label(__('analytics.resources.columns.updated_at'))->since()->sortable(),
            ])
            ->filters([static::folderFilter(), Tables\Filters\SelectFilter::make('display')->label(__('analytics.forms.fields.display_type'))->options($displays)])
            ->recordUrl(fn (AnalyticsReport $record) => AnalyticsReportEditor::getUrl(['record' => $record->id]))
            ->actions([
                Tables\Actions\Action::make('open')->label(__('analytics.resources.actions.open'))->icon('heroicon-o-pencil-square')->url(fn (AnalyticsReport $record) => AnalyticsReportEditor::getUrl(['record' => $record->id])),
                Tables\Actions\EditAction::make()->label(__('analytics.resources.actions.details'))->modalHeading(__('analytics.resources.actions.edit_report'))
                    ->using(fn (AnalyticsReport $record, array $data, $livewire) => app(PanelActions::class)->withForm($livewire->getMountedTableActionForm(), fn () => app(PanelActions::class)->updateReportMetadata($record, $data))),
                Tables\Actions\Action::make('copy')->label(__('analytics.resources.actions.copy_report'))->icon('heroicon-o-document-duplicate')
                    ->visible(fn (AnalyticsReport $record) => $record->owner_id === static::ownerId())
                    ->modalHeading(__('analytics.resources.actions.copy_report'))->modalSubmitActionLabel(__('analytics.resources.actions.create_copy'))
                    ->form(static::metadataSchema())
                    ->fillForm(fn (AnalyticsReport $record) => [...$record->only(['description', 'folder_id']), 'name' => mb_substr($record->name, 0, 144).' — '.__('analytics.resources.copy_suffix')])
                    ->action(function (AnalyticsReport $record, array $data, $livewire): void {
                        $actions = app(PanelActions::class);
                        $copy = $actions->withForm($livewire->getMountedTableActionForm(), fn () => $actions->copyReport($record, $data));
                        Notification::make()->title(__('analytics.resources.notifications.report_copied'))->success()->send();
                        $livewire->redirect(AnalyticsReportEditor::getUrl(['record' => $copy->id]));
                    }),
                Tables\Actions\DeleteAction::make()->label(__('analytics.resources.actions.delete'))->using(fn (AnalyticsReport $record) => app(PanelActions::class)->withoutForm(fn () => app(PanelActions::class)->deleteReport($record))),
            ])
            ->defaultSort('updated_at', 'desc')
            ->emptyStateHeading(__('analytics.resources.empty.reports_heading'))->emptyStateDescription(__('analytics.resources.empty.reports_description'));
    }

    public static function getPages(): array
    {
        return ['index' => Pages\ListAnalyticsReports::route('/')];
    }
}
