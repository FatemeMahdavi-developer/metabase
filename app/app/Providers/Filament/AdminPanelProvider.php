<?php

namespace App\Providers\Filament;

use App\Filament\Pages\Dashboard;
use App\Filament\Pages\AnalyticsDashboardView;
use App\Filament\Resources\AnalyticsDashboardResource;
use App\Models\AnalyticsDashboard;
use Filament\Facades\Filament;
use Filament\FontProviders\LocalFontProvider;
use Filament\Http\Middleware\Authenticate;
use Filament\Http\Middleware\AuthenticateSession;
use Filament\Http\Middleware\DisableBladeIconComponents;
use Filament\Http\Middleware\DispatchServingFilamentEvent;
use Filament\Navigation\NavigationGroup;
use Filament\Navigation\NavigationItem;
use Filament\Panel;
use Filament\PanelProvider;
use Filament\Support\Colors\Color;
use Filament\View\PanelsRenderHook;
use Filament\Widgets;
use Illuminate\Cookie\Middleware\AddQueuedCookiesToResponse;
use Illuminate\Cookie\Middleware\EncryptCookies;
use Illuminate\Foundation\Http\Middleware\VerifyCsrfToken;
use Illuminate\Routing\Middleware\SubstituteBindings;
use Illuminate\Session\Middleware\StartSession;
use Illuminate\View\Middleware\ShareErrorsFromSession;

class AdminPanelProvider extends PanelProvider
{
    public function panel(Panel $panel): Panel
    {
        return $panel
            ->default()
            ->id('admin')
            ->path('admin')
            ->login()
            ->colors([
                'primary' => Color::Blue,
            ])
            ->brandName('فضای تحلیل')
            ->font('Vazir', url: asset('fonts/vazir/font-face.css'), provider: LocalFontProvider::class)
            ->sidebarCollapsibleOnDesktop()
            ->darkMode()
            ->renderHook(PanelsRenderHook::STYLES_AFTER, fn () => view('filament.partials.panel-theme'))
            ->navigationGroups([
                NavigationGroup::make('نمای کلی داشبورد')
                    ->icon('heroicon-o-home')
                    ->collapsible()
                    ->collapsed(),
                NavigationGroup::make('داشبوردساز')
                ->icon('heroicon-o-squares-2x2'),
            ])
            ->discoverResources(in: app_path('Filament/Resources'), for: 'App\\Filament\\Resources')
            ->discoverPages(in: app_path('Filament/Pages'), for: 'App\\Filament\\Pages')
            ->pages([
                Dashboard::class,
            ])
            ->discoverWidgets(in: app_path('Filament/Widgets'), for: 'App\\Filament\\Widgets')
            ->widgets([
                Widgets\AccountWidget::class,
                Widgets\FilamentInfoWidget::class,
            ])
            ->middleware([
                EncryptCookies::class,
                AddQueuedCookiesToResponse::class,
                StartSession::class,
                AuthenticateSession::class,
                ShareErrorsFromSession::class,
                VerifyCsrfToken::class,
                SubstituteBindings::class,
                DisableBladeIconComponents::class,
                DispatchServingFilamentEvent::class,
            ])
            ->authMiddleware([
                Authenticate::class,
            ]);
    }

    public function getNavigationItems(): array
    {
        return AnalyticsDashboardResource::getEloquentQuery()
            ->where('is_active', true)
            ->orderBy('sort_order')->orderBy('id')
            ->get(['id', 'name'])
            ->map(fn (AnalyticsDashboard $dashboard) => NavigationItem::make($dashboard->name)
                ->group('نمای کلی داشبورد')
                ->url(AnalyticsDashboardView::getUrl(['record' => $dashboard->id]))
                ->isActiveWhen(fn () => request()->routeIs('filament.admin.pages.analytics.dashboard-view')
                    && (string) request()->route('record') === (string) $dashboard->id))
            ->all();
    }
}
