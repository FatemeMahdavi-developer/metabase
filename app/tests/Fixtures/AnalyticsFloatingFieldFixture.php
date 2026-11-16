<?php

namespace Tests\Fixtures;

use App\Domain\Analytics\Filament\WorkbenchForms;
use Filament\Forms\Concerns\InteractsWithForms;
use Filament\Forms\Contracts\HasForms;
use Filament\Forms\Form;
use Livewire\Component;

class AnalyticsFloatingFieldFixture extends Component implements HasForms
{
    use InteractsWithForms;

    public array $workbenchData = [];
    public string $workbenchKind = 'folder';
    public string $workbenchRequest = 'floating-fields-fixture';
    public string $workbenchError = '';
    public array $workbenchContext = [];

    public function mount(): void
    {
        $this->workbenchForm->fill([
            'name' => '', 'direction' => null, 'report_id' => null, 'suggestions' => [],
            'content' => '', 'limit' => 0, 'copy_reports' => false,
            'parameters' => [['key' => 'token', 'type' => 'text', 'default' => '', 'required' => false]],
        ]);
    }

    protected function getForms(): array
    {
        return ['workbenchForm'];
    }

    public function workbenchForm(Form $form): Form
    {
        $builder = app(WorkbenchForms::class);
        $options = [['key' => 'books', 'label' => 'Books'], ['key' => 'clothing', 'label' => 'Clothing'], ['key' => 'long', 'label' => 'A long category name that needs wrapping inside the field']];
        $filter = $builder->schema('filter_value', ['type' => 'text', 'suggestions' => $options]);
        $fields = [
            'text' => $builder->schema('folder', [])[0],
            'native' => $builder->schema('sort', ['fields' => []])[1],
            'choices' => $builder->schema('report_card', ['reports' => $options])[0],
            'multiple' => $filter[array_key_last($filter)],
            'textarea' => $builder->schema('text', [])[1],
            'zero' => $builder->schema('limit', [])[0],
            'toggle' => $builder->schema('copy', [])[0],
            'nested' => $builder->schema('parameters', [])[0],
        ];
        foreach ($fields as $key => $field) {
            $field->extraFieldWrapperAttributes(['data-fixture-field' => $key], merge: true);
        }

        return $form->schema(array_values($fields))->statePath('workbenchData');
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
