<?php
namespace Tests\Fixtures;
use Livewire\Component;

class NativeAnalyticsTableFixture extends Component
{
    public bool $reference = false;
    public int $tableRecordsPerPage = 25;
    public function render(): string
    {
        return <<<'BLADE'
<div wire:ignore>
    @include('filament.partials.analytics-native-table')
    @if ($reference)
        @php
            $records = (new \Illuminate\Pagination\LengthAwarePaginator(range(1, 25), 100, 25, 1))->onEachSide(0);
        @endphp
        <x-filament-tables::container id="vendor-reference" class="fi-ta">
            <div class="fi-ta-header-toolbar flex items-center justify-between gap-x-4 px-4 py-3 sm:px-6">
                <div class="flex shrink-0 items-center gap-x-4"></div>
                <div class="ms-auto flex items-center gap-x-4">
                    <x-filament-tables::search-field />
                </div>
            </div>
            <x-filament::pagination :paginator="$records" :page-options="[10, 25, 50, 100]" class="fi-ta-pagination px-3 py-3 sm:px-6" />
        </x-filament-tables::container>
    @endif
</div>
BLADE;
    }
}
