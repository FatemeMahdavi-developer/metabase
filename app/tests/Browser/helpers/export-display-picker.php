<?php

require dirname(__DIR__, 3).'/vendor/autoload.php';
$app = require dirname(__DIR__, 3).'/bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
$app->setLocale('fa');
view()->share('errors', new \Illuminate\Support\ViewErrorBag);

// Render the production Filament field without HTTP or a database connection.
$component = new class extends \Livewire\Component implements \Filament\Forms\Contracts\HasForms {
    use \Filament\Forms\Concerns\InteractsWithForms;

    public ?array $data = [];
};
$form = \Filament\Forms\Form::make($component)
    ->schema(app(\App\Domain\Analytics\Filament\WorkbenchForms::class)->schema('display', []))
    ->statePath('data');
$form->fill(['display' => 'bar']);
echo $form->getComponents()[0]->toHtml();
