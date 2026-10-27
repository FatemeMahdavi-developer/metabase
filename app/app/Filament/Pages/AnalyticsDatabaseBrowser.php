<?php

namespace App\Filament\Pages;

use App\Models\AnalyticsConnection;
use Filament\Facades\Filament;

class AnalyticsDatabaseBrowser extends AnalyticsWorkbench
{
    protected static ?string $slug = 'analytics/databases/{record}';

    protected static ?string $title = 'مرور پایگاه داده';

    public static function getRelativeRouteName(): string
    {
        return 'analytics.database-browser';
    }

    public function mount(string $record): void
    {
        abort_unless(ctype_digit($record), 404);
        AnalyticsConnection::where('owner_id', Filament::auth()->id())->whereIn('driver', config('analytics.connection_drivers'))->findOrFail($record);
        $this->section = 'browser';
        $this->recordId = $record;
    }
}
