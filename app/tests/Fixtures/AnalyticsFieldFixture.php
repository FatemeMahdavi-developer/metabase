<?php

namespace Tests\Fixtures;

use App\Domain\Analytics\Filament\WorkbenchForms;
use App\Filament\Resources\AnalyticsConnectionResource;
use Filament\Forms\Concerns\InteractsWithForms;
use Filament\Forms\Contracts\HasForms;
use Filament\Forms\Form;
use Livewire\Component;

class AnalyticsFieldFixture extends Component implements HasForms
{
    use InteractsWithForms;

    public array $workbenchData = [];
    public array $referenceData = [];
    public array $expressionData = [];

    public function mount(): void
    {
        $state = ['name' => 'نمونه', 'connection_id' => '1', 'source' => 'public.demo', 'content' => 'متن نمونه', 'direction' => 'asc', 'copy_reports' => false, 'limit' => 100];
        $this->workbenchForm->fill($state);
        $this->referenceForm->fill($state);
        $this->expressionForm->fill(['label' => 'Calculated value', 'expression' => '[']);
    }

    protected function getForms(): array
    {
        return ['workbenchForm', 'referenceForm', 'expressionForm'];
    }

    private function fields(): array
    {
        $builder = app(WorkbenchForms::class);
        $connections = [['key' => '1', 'label' => 'unisq', 'catalog' => [['key' => 'public.demo', 'label' => 'نمونه']]], ['key' => '2', 'label' => 'warehouse', 'catalog' => []]];

        return [
            ...$builder->schema('folder', []),
            ...$builder->schema('source', ['connections' => $connections]),
            $builder->schema('text', [])[1],
            ...$builder->schema('copy', []),
            $builder->schema('sort', ['fields' => []])[1],
            ...$builder->schema('limit', []),
        ];
    }

    public function workbenchForm(Form $form): Form
    {
        return $form->schema($this->fields())->statePath('workbenchData');
    }

    public function expressionForm(Form $form): Form
    {
        // Use the production editor fields and assistance partial without unrelated insert selectors.
        return $form->schema(array_slice(app(WorkbenchForms::class)->schema('expression', []), 0, 3))->statePath('expressionData');
    }

    public function referenceForm(Form $form): Form
    {
        $fields = $this->fields();
        $fields[0] = AnalyticsConnectionResource::form(Form::make($this))->getComponents()[0];
        $fields[0]->placeholder(" ")->extraFieldWrapperAttributes(fn ($component) => [
            "class" => "soar-floating-field",
            "x-data" => new \Illuminate\Support\HtmlString("soarFloatingField(".\Illuminate\Support\Js::from($component->getStatePath())->toHtml().")"),
            "x-bind:class" => new \Illuminate\Support\HtmlString("{ 'soar-floating-has-value': hasValue }"),
        ], merge: true);

        return $form->schema($fields)->statePath('referenceData');
    }

    public function render(): string
    {
        return <<<'BLADE'
<div class="fixture-grid">
    <div id="analytics-studio">
        <div class="soar-form-modal">
            <section class="fi-modal-window">
                <form id="workbench-fields">{{ $this->workbenchForm }}</form>
            </section>
        </div>
        <div class="soar-form-modal">
            <section class="fi-modal-window">
                <form id="expression-fields" data-analytics-native-form>{{ $this->expressionForm }}</form>
            </section>
        </div>
        <div id="client-searches"></div>
        @include('filament.partials.analytics-native-controls')
    </div>
    <div wire:key="fixture.actions.create.modal">
        <section class="fi-modal-window">
            <form id="reference-fields">{{ $this->referenceForm }}</form>
        </section>
    </div>
</div>
BLADE;
    }
}
