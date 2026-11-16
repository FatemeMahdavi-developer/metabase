<?php

namespace Tests\Fixtures;

class AnalyticsDateFilterFixture extends AnalyticsReactiveFilterFixture
{
    public function mount(string $scenario = 'dashboard-date'): void
    {
        $this->workbenchRequest = 'date-filter-fixture-'.$scenario;
        if ($scenario === 'report-date') {
            $this->workbenchKind = 'filter';
            $this->workbenchContext = ['fields' => [['key' => 'created_at', 'label' => 'Created at', 'type' => 'date']]];
            $state = ['field' => 'created_at', 'operator' => 'eq', 'date_mode' => 'specific', 'date_value' => '2026-11-15'];
        } else {
            $this->workbenchKind = 'filter_value';
            $this->workbenchContext = ['type' => $scenario === 'dashboard-number' ? 'number' : 'date'];
            $state = ['value_mode' => 'range', 'date_value' => '2026-11-15', 'presence_empty' => false];
        }
        $this->workbenchForm->fill($state + [
            'date_from' => '2026-11-01', 'date_to' => '2026-11-30',
            'from' => $scenario === 'dashboard-number' ? '1.5' : null,
            'to' => $scenario === 'dashboard-number' ? '10.5' : null,
            'relative_amount' => 7, 'relative_unit' => 'day', 'relative_direction' => 'past',
            'include_current' => false, 'date_part' => 'month', 'part_values' => '1,2', 'exclude' => false,
        ]);
    }

    public function submitWorkbenchForm(): void
    {
        // The production submit contract, using the genuine schema validation/dehydration.
        // This fixture bypasses only the unrelated panel authentication gate.
        $data = $this->workbenchForm->getState();
        $this->workbenchError = '';
        $this->dispatch('analytics-form-submitted', requestId: $this->workbenchRequest, data: $data, command: 'submit');
    }
}
