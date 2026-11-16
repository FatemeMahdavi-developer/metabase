<?php

require dirname(__DIR__, 3).'/vendor/autoload.php';
$app = require dirname(__DIR__, 3).'/bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
$app->setLocale('fa');
view()->share('errors', new \Illuminate\Support\ViewErrorBag);
require_once __DIR__.'/panel-palette.php';

// Render the production fields without signing in or changing application data.
$component = new class extends \Livewire\Component implements \Filament\Forms\Contracts\HasForms, \Filament\Tables\Contracts\HasTable {
    use \Filament\Forms\Concerns\InteractsWithForms;
    use \Filament\Tables\Concerns\InteractsWithTable;

    public ?array $data = [];
    public ?array $filterData = [];
};
$component->setId('filter-select-appearance');
// Enhanced Vendor Select reads the current Livewire component while Blade renders.
$blade = app(\Livewire\Mechanisms\ExtendBlade\ExtendBlade::class);
$blade->startLivewireRendering($component);
ob_start();
$form = \Filament\Forms\Form::make($component)
    ->schema(app(\App\Domain\Analytics\Filament\WorkbenchForms::class)->schema('filter_value', ['type' => 'date']))
    ->statePath('data');
$form->fill(['value_mode' => 'none']);
$options = $form->getComponents()[0]->getOptionsForJs();
echo '<div id="analytics-studio"><div class="fi-modal"><section class="fi-modal-window"><form id="dashboard-filter">';
echo $form->getComponents()[0]->toHtml();
echo '</form></section></div></div>';

$table = \App\Filament\Resources\AnalyticsConnectionResource::table(\Filament\Tables\Table::make($component));
$driverFilter = $table->getFilters()['driver'];
$filters = \Filament\Forms\Form::make($component)->schema($driverFilter->getFormSchema())->statePath('filterData');
$filters->fill([]);
echo '<section class="fi-ta"><div class="fi-dropdown-panel"><form id="database-filter">';
echo $filters->getComponents()[0]->toHtml();
echo '</form></div></section>';

$blade->endLivewireRendering();
echo json_encode(['markup' => ob_get_clean(), 'options' => $options, 'palette' => analyticsFixturePanelPalette(), 'livewireStyles' => (string) \Livewire\Mechanisms\FrontendAssets\FrontendAssets::styles()], JSON_THROW_ON_ERROR);
