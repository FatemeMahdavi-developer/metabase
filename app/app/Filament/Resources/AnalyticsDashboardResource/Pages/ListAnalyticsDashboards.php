<?php

namespace App\Filament\Resources\AnalyticsDashboardResource\Pages;

use App\Domain\Analytics\Filament\PanelActions;
use App\Filament\Pages\AnalyticsDashboardEditor;
use App\Filament\Resources\AnalyticsDashboardResource;
use App\Models\AnalyticsDashboard;
use Filament\Actions;
use Filament\Resources\Pages\ListRecords;
use Livewire\Attributes\Url;

class ListAnalyticsDashboards extends ListRecords
{
    protected static string $resource = AnalyticsDashboardResource::class;

    #[Url]
    public ?int $add_report = null;

    public function reorderTable(array $order): void
    {
        if (! $this->getTable()->isReorderable()) {
            return;
        }

        if (validator(['order' => $order], ['order' => ['array'], 'order.*' => ['required', 'integer', 'min:1']])->fails()) {
            return;
        }
        // Repeated row keys must not cause an authorized reorder to fail the count check.
        $order = array_values(array_unique(array_map('strval', $order)));
        if ($order === []) {
            return;
        }

        $records = (clone $this->getTable()->getQuery())->whereIn('id', $order)->get();
        // An interrupted drop can contain temporary DOM keys or stale rows.
        // Ignore the entire order instead of saving part of it or showing an authorization error.
        if ($records->count() !== count($order)) {
            return;
        }
        foreach ($records as $record) {
            abort_unless($record->canEdit(AnalyticsDashboardResource::ownerId()), 403);
        }

        $visibleKeys = $this->getFilteredTableQuery()->pluck('id')->map(fn ($id) => (string) $id)->all();
        if (count($visibleKeys) !== count($order) || array_diff($visibleKeys, $order)) {
            return;
        }

        parent::reorderTable($order);
    }

    protected function getHeaderActions(): array
    {
        return [
            AnalyticsDashboardResource::createFolderAction(),
            Actions\CreateAction::make()->label(__('analytics.resources.actions.new_dashboard'))->modalHeading(__('analytics.resources.actions.create_dashboard'))->modalSubmitActionLabel(__('analytics.resources.actions.create'))->createAnother(false)
                ->using(fn (array $data, $livewire) => app(PanelActions::class)->withForm($livewire->getMountedActionForm(), fn () => app(PanelActions::class)->createDashboard($data)))
                ->successRedirectUrl(fn (AnalyticsDashboard $record) => AnalyticsDashboardEditor::getUrl(array_filter(['record' => $record->id, 'add_report' => $this->add_report]))),
        ];
    }
}
