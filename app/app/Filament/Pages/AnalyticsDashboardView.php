<?php

namespace App\Filament\Pages;

class AnalyticsDashboardView extends AnalyticsDashboardEditor
{
    protected static ?string $slug = 'analytics/dashboards/{record}/view';

    protected bool $analyticsReadOnly = true;

    public static function getRelativeRouteName(): string
    {
        return 'analytics.dashboard-view';
    }

    public function getAnalyticsRoutes(): array
    {
        return [
            ...parent::getAnalyticsRoutes(),
            'dashboard' => static::getUrl(['record' => '__record__']),
        ];
    }
}
