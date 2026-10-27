<?php

namespace App\Filament\Pages;

use App\Filament\Resources\AnalyticsDashboardResource;
use App\Models\AnalyticsDashboard;
use Filament\Navigation\NavigationItem;

class Dashboard extends \Filament\Pages\Dashboard
{
    public static function getNavigationItems(): array
    {
        return AnalyticsDashboardResource::getEloquentQuery()
            ->where('is_active', true)
            ->orderBy('sort_order')->orderBy('id')
            ->get(['id', 'name'])
            ->map(fn (AnalyticsDashboard $dashboard) => NavigationItem::make($dashboard->name)
                ->group(static::getNavigationLabel())
                ->url(AnalyticsDashboardView::getUrl(['record' => $dashboard->id]))
                ->isActiveWhen(fn () => request()->routeIs('filament.'.filament()->getCurrentPanel()->getId().'.pages.analytics.dashboard-view')
                    && (string) request()->route('record') === (string) $dashboard->id))
            ->all();
    }
}
