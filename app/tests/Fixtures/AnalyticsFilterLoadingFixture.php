<?php

namespace Tests\Fixtures;

use App\Domain\Analytics\Filament\WorkbenchForms;
use Filament\Forms\Concerns\InteractsWithForms;
use Filament\Forms\Contracts\HasForms;
use Filament\Forms\Form;
use Livewire\Component;

class AnalyticsFilterLoadingFixture extends Component implements HasForms
{
    use InteractsWithForms;

    public array $workbenchData = [];
    public string $workbenchKind = 'filter_value';
    public string $workbenchRequest = 'filter-loading-fixture';
    public string $workbenchError = '';
    public array $workbenchContext = [
        'type' => 'text',
        'suggestions' => [
            ['key' => 'books', 'label' => 'Books'],
            ['key' => 'clothing', 'label' => 'Clothing'],
            ['key' => 'electronics', 'label' => 'Electronics'],
        ],
    ];

    public function mount(): void
    {
        $this->workbenchForm->fill(['value_mode' => 'specific', 'value' => '', 'suggestions' => []]);
    }

    protected function getForms(): array
    {
        return ['workbenchForm'];
    }

    public function workbenchForm(Form $form): Form
    {
        return $form
            ->schema(app(WorkbenchForms::class)->schema($this->workbenchKind, $this->workbenchContext))
            ->statePath('workbenchData');
    }

    public function submitWorkbenchForm(): void {}

    public function workbenchCommand(string $command): void {}

    public function render(): string
    {
        return <<<'BLADE'
<div id="analytics-studio">
    @include('filament.partials.analytics-native-form')
</div>
BLADE;
    }
}
