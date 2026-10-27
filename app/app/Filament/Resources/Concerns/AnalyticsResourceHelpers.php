<?php

namespace App\Filament\Resources\Concerns;

use App\Domain\Analytics\Filament\PanelActions;
use App\Models\AnalyticsFolder;
use Filament\Actions\Action;
use Filament\Facades\Filament;
use Filament\Forms\Components\Select;
use Filament\Forms\Components\Textarea;
use Filament\Forms\Components\TextInput;
use Filament\Forms\Form;
use Filament\Notifications\Notification;
use Filament\Tables\Filters\SelectFilter;

trait AnalyticsResourceHelpers
{
    public static function getNavigationItems(): array
    {
        return array_map(fn ($item) => $item->isActiveWhen(fn () => request()->routeIs(
            static::getRouteBaseName().'.*',
            'filament.'.Filament::getCurrentPanel()->getId().'.pages.'.static::$editorRoute,
        )), parent::getNavigationItems());
    }

    public static function ownerId(): int
    {
        return (int) Filament::auth()->id();
    }

    public static function folders(): array
    {
        return AnalyticsFolder::query()->where('owner_id', static::ownerId())->orderBy('name')->pluck('name', 'id')->all();
    }

    public static function metadataSchema(): array
    {
        return [
            TextInput::make('name')->label(__('analytics.resources.fields.name'))->required()->maxLength(150)->autofocus(),
            Textarea::make('description')->label(__('analytics.resources.fields.description'))->maxLength(3000)->rows(3),
            Select::make('folder_id')->label(__('analytics.resources.fields.folder'))->options(fn () => static::folders())->placeholder(__('analytics.resources.fields.no_folder'))->nullable()->searchable(),
        ];
    }

    public static function folderFilter(): SelectFilter
    {
        return SelectFilter::make('folder_id')->label(__('analytics.resources.fields.folder'))->options(fn () => static::folders());
    }

    public static function createFolderAction(): Action
    {
        return Action::make('createFolder')
            ->label(__('analytics.resources.actions.new_folder'))->icon('heroicon-o-folder-plus')->color('gray')
            ->modalHeading(__('analytics.resources.actions.create_folder'))->modalSubmitActionLabel(__('analytics.resources.actions.create'))
            ->form([TextInput::make('name')->label(__('analytics.resources.actions.folder_name'))->required()->maxLength(100)])
            ->action(function (array $data, Form $form): void {
                $actions = app(PanelActions::class);
                $actions->withForm($form, fn () => $actions->createFolder($data));
                Notification::make()->title(__('analytics.resources.notifications.folder_created'))->success()->send();
            });
    }
}
