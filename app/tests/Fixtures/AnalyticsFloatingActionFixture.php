<?php

namespace Tests\Fixtures;

use App\Filament\Resources\AnalyticsReportResource;
use Filament\Actions\Action;
use Filament\Actions\Concerns\InteractsWithActions;
use Filament\Actions\Contracts\HasActions;
use Filament\Forms\Concerns\InteractsWithForms;
use Filament\Forms\Contracts\HasForms;
use Illuminate\Validation\ValidationException;
use Livewire\Component;

class AnalyticsFloatingActionFixture extends Component implements HasActions, HasForms
{
    use InteractsWithActions;
    use InteractsWithForms;

    public function mount(bool $invalid = false): void
    {
        $this->mountAction('createFolder');
        if ($invalid) {
            try {
                $this->getMountedActionForm()->getState();
            } catch (ValidationException $exception) {
                $this->setErrorBag($exception->validator->errors());
            }
        }
    }

    public function createFolderAction(): Action
    {
        return AnalyticsReportResource::createFolderAction();
    }

    public function render(): string
    {
        return <<<'BLADE'
<div id="floating-action-fixture">
    <x-filament-actions::modals />
</div>
BLADE;
    }
}
