<?php

namespace App\Filament\Pages;

use App\Domain\Analytics\Filament\WorkbenchForms;
use App\Filament\Resources\AnalyticsConnectionResource;
use App\Filament\Resources\AnalyticsDashboardResource;
use App\Filament\Resources\AnalyticsReportResource;
use Filament\Facades\Filament;
use Filament\Forms\Form;
use Filament\Pages\Page;
use Filament\Support\Enums\MaxWidth;
use Filament\Support\Facades\FilamentAsset;
use Illuminate\Support\Str;
use Livewire\Attributes\Locked;

abstract class AnalyticsWorkbench extends Page
{
    protected static bool $shouldRegisterNavigation = false;

    protected static string $view = 'filament.pages.analytics-studio';

    protected bool $analyticsReadOnly = false;

    #[Locked]
    public string $section = '';

    #[Locked]
    public string $recordId = '';

    public ?array $workbenchData = [];

    #[Locked]
    public string $workbenchKind = 'confirm';

    #[Locked]
    public array $workbenchContext = [];

    #[Locked]
    public string $workbenchRequest = '';

    public string $workbenchError = '';

    protected function getForms(): array
    {
        return [...parent::getForms(), 'workbenchForm'];
    }

    public function workbenchForm(Form $form): Form
    {
        return $form->schema(app(WorkbenchForms::class)->schema($this->workbenchKind, $this->workbenchContext))->statePath('workbenchData');
    }

    public function openWorkbenchForm(string $kind, array $data, array $context, string $requestId): void
    {
        abort_unless(Filament::auth()->check(), 403);
        abort_unless(isset(WorkbenchForms::TITLES[$kind]), 422);
        abort_if(strlen(json_encode([$data, $context])) > 2_000_000 || strlen($requestId) > 80, 422);
        $this->workbenchKind = $kind;
        $this->workbenchContext = $context;
        $this->workbenchRequest = $requestId;
        $this->workbenchError = '';
        $this->resetValidation();
        $this->cacheForm('workbenchForm', $this->workbenchForm($this->makeForm()));
        $this->workbenchForm->fill($data);
        $this->dispatch('open-modal', id: 'analytics-native-form');
    }

    public function submitWorkbenchForm(): void
    {
        abort_unless(Filament::auth()->check(), 403);
        $data = $this->workbenchForm->getState();
        $this->workbenchError = '';
        $this->dispatch('analytics-form-submitted', requestId: $this->workbenchRequest, data: $data, command: 'submit');
    }

    public function workbenchCommand(string $command): void
    {
        $allowed = ['tab' => ['delete', 'copy'], 'card' => ['visualization', 'click'], 'dashboard_filter' => ['delete'], 'filter_value' => ['clear'], 'click' => ['scope'], 'dashboard_picker' => ['create']];
        abort_unless(in_array($command, $allowed[$this->workbenchKind] ?? [], true), 422);
        $this->dispatch('analytics-form-submitted', requestId: $this->workbenchRequest, data: $this->workbenchData ?? [], command: $command);
    }

    public function workbenchFailed(string $requestId, string $message): void
    {
        if ($requestId === $this->workbenchRequest) {
            $this->workbenchError = mb_substr($message, 0, 3000);
        }
    }

    public function getHeading(): string
    {
        return '';
    }

    public function getMaxContentWidth(): MaxWidth
    {
        return MaxWidth::Full;
    }

    public function getAnalyticsRoutes(): array
    {
        return [
            'dashboards' => AnalyticsDashboardResource::getUrl(),
            'reports' => AnalyticsReportResource::getUrl(),
            'connections' => AnalyticsConnectionResource::getUrl(),
            'dashboard' => AnalyticsDashboardEditor::getUrl(['record' => '__record__']),
            'report' => AnalyticsReportEditor::getUrl(['record' => '__record__']),
            'browser' => AnalyticsDatabaseBrowser::getUrl(['record' => '__record__']),
        ];
    }

    public function getAnalyticsInitial(): array
    {
        return request()->only(['mode', 'connection', 'table', 'add_report', 'edit', 'intent', 'filters']);
    }

    protected function getViewData(): array
    {
        return [
            'analyticsSection' => $this->section,
            'analyticsRecord' => $this->recordId,
            'analyticsReadOnly' => $this->analyticsReadOnly,
            'analyticsRoutes' => $this->getAnalyticsRoutes(),
            'analyticsInitial' => $this->getAnalyticsInitial(),
            'analyticsFormComponents' => collect(['textarea', 'select', 'color-picker'])->mapWithKeys(fn ($name) => [
                Str::camel($name).'FormComponent' => FilamentAsset::getAlpineComponentSrc($name, 'filament/forms'),
            ])->all(),
        ];
    }
}
