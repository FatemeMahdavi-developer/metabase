<?php

namespace Tests\Fixtures;

use App\Domain\Analytics\Filament\WorkbenchForms;
use Filament\Forms\Components\Field;
use Filament\Forms\Concerns\InteractsWithForms;
use Filament\Forms\Contracts\HasForms;
use Filament\Forms\Form;
use Livewire\Component;

class AnalyticsReactiveFilterFixture extends Component implements HasForms
{
    use InteractsWithForms;

    public array $workbenchData = [];
    public string $workbenchKind = 'filter';
    public string $workbenchRequest = 'reactive-filter-fixture';
    public string $workbenchError = '';
    public array $workbenchContext = ['fields' => [
        ['key' => 'name', 'label' => 'Name', 'type' => 'text'],
        ['key' => 'amount', 'label' => 'Amount', 'type' => 'number'],
        ['key' => 'active', 'label' => 'Active', 'type' => 'boolean'],
    ]];

    public function mount(): void
    {
        $this->workbenchForm->fill(['field' => 'name', 'operator' => 'eq', 'value' => 'Sample']);
    }

    protected function getForms(): array
    {
        return ['workbenchForm'];
    }

    public function workbenchForm(Form $form): Form
    {
        $schema = app(WorkbenchForms::class)->schema($this->workbenchKind, $this->workbenchContext);
        $mark = function (array $components) use (&$mark): void {
            foreach ($components as $component) {
                if ($component instanceof Field) {
                    $component->extraFieldWrapperAttributes(['data-fixture-filter-field' => $component->getName()], merge: true);
                }
                $mark($component->getChildComponents());
            }
        };
        $mark($schema);

        return $form->schema($schema)->statePath('workbenchData');
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
