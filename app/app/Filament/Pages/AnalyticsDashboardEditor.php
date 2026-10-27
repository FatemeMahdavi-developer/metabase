<?php

namespace App\Filament\Pages;

use App\Models\AnalyticsDashboard;
use Filament\Facades\Filament;

class AnalyticsDashboardEditor extends AnalyticsWorkbench
{
    protected static ?string $slug = 'analytics/dashboards/{record}';

    protected static ?string $title = 'داشبورد';

    public static function getRelativeRouteName(): string
    {
        return 'analytics.dashboard-editor';
    }

    public function mount(string $record): void
    {
        abort_unless(ctype_digit($record), 404);
        $dashboard = AnalyticsDashboard::findOrFail($record);
        abort_unless($dashboard->canRead((int) Filament::auth()->id()), 403);
        $this->section = 'dashboard';
        $this->recordId = (string) $dashboard->id;
    }
}
