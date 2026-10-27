<?php

namespace App\Filament\Resources\AnalyticsReportResource\Pages;

use App\Filament\Pages\AnalyticsReportEditor;
use App\Filament\Resources\AnalyticsReportResource;
use Filament\Actions\Action;
use Filament\Resources\Pages\ListRecords;

class ListAnalyticsReports extends ListRecords
{
    protected static string $resource = AnalyticsReportResource::class;

    protected function getHeaderActions(): array
    {
        return [
            AnalyticsReportResource::createFolderAction(),
            Action::make('newSqlReport')->label(__('analytics.resources.actions.sql_query'))->icon('heroicon-o-code-bracket')->color('gray')->url(AnalyticsReportEditor::getUrl(['record' => 'new', 'mode' => 'native'])),
            Action::make('newReport')->label(__('analytics.resources.actions.new_report'))->icon('heroicon-o-plus')->url(AnalyticsReportEditor::getUrl(['record' => 'new'])),
        ];
    }
}
