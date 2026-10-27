<?php

namespace App\Filament\Resources\AnalyticsConnectionResource\Pages;

use App\Domain\Analytics\Filament\PanelActions;
use App\Filament\Resources\AnalyticsConnectionResource;
use Filament\Actions\CreateAction;
use Filament\Resources\Pages\ListRecords;

class ListAnalyticsConnections extends ListRecords
{
    protected static string $resource = AnalyticsConnectionResource::class;

    protected function getHeaderActions(): array
    {
        return [
            CreateAction::make()->label(__('analytics.resources.actions.new_database'))->modalHeading(__('analytics.resources.actions.create_database'))->modalSubmitActionLabel(__('analytics.resources.actions.save'))->createAnother(false)
                ->using(fn (array $data, $livewire) => app(PanelActions::class)->withForm($livewire->getMountedActionForm(), fn () => app(PanelActions::class)->saveConnection($data))),
        ];
    }
}
