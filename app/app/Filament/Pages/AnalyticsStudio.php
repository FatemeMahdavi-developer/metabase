<?php

namespace App\Filament\Pages;

use App\Filament\Resources\AnalyticsDashboardResource;
use Filament\Pages\Page;

class AnalyticsStudio extends Page
{
    protected static bool $shouldRegisterNavigation = false;

    protected static ?string $navigationLabel = 'داشبوردساز';

    protected static ?string $title = 'تحلیل داده';

    protected static ?string $slug = 'analytics';

    protected static ?int $navigationSort = -10;

    protected static string $view = 'filament.pages.analytics-redirect';

    public function mount(): void
    {
        $this->redirect(AnalyticsDashboardResource::getUrl());
    }
}
