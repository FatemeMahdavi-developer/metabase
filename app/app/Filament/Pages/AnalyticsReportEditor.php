<?php

namespace App\Filament\Pages;

use App\Models\AnalyticsReport;
use Filament\Facades\Filament;

class AnalyticsReportEditor extends AnalyticsWorkbench
{
    protected static ?string $slug = 'analytics/reports/{record}';

    protected static ?string $title = 'ویرایشگر گزارش';

    public static function getRelativeRouteName(): string
    {
        return 'analytics.report-editor';
    }

    public function mount(string $record): void
    {
        if ($record !== 'new') {
            abort_unless(ctype_digit($record), 404);
            AnalyticsReport::where('owner_id', Filament::auth()->id())->findOrFail($record);
        }
        $this->section = 'report';
        $this->recordId = $record;
    }
}
