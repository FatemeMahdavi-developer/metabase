{{-- Filament owns the markup; the workbench binds its external query results to these templates. --}}
<template id="analytics-native-table-shell">
    <x-filament-tables::container class="fi-ta mb-native-table">
        <div class="fi-ta-header-toolbar mb-native-table-toolbar flex items-center justify-between gap-x-4 px-4 py-3 sm:px-6">
            <div class="flex shrink-0 items-center gap-x-4"></div>
            <div class="ms-auto flex items-center gap-x-4">
                <x-filament-tables::search-field />
            </div>
        </div>
        <div class="fi-ta-content mb-table-wrap">
            <x-filament-tables::table class="mb-table">
                <x-slot name="header">
                    <x-filament-tables::header-cell name="placeholder" :sort-direction="null"> </x-filament-tables::header-cell>
                </x-slot>
            </x-filament-tables::table>
            <x-filament-tables::empty-state
                class="mb-table-empty"
                heading="مقداری با این جست‌وجو پیدا نشد."
                icon="heroicon-o-table-cells"
            />
        </div>
    </x-filament-tables::container>
</template>

@foreach (['none', 'asc', 'desc'] as $direction)
    <template id="analytics-native-table-header-{{ $direction }}">
        <x-filament-tables::header-cell
            name="result"
            :actively-sorted="$direction !== 'none'"
            :sort-direction="$direction === 'none' ? null : $direction"
        >
            <button type="button" data-table-sort class="fi-ta-header-cell-sort-btn flex w-full items-center justify-center gap-x-1">
                <span data-native-header-label></span>
                <x-filament::icon
                    :icon="$direction === 'asc' ? 'heroicon-m-chevron-up' : 'heroicon-m-chevron-down'"
                    :alias="$direction === 'asc' ? 'tables::header-cell.sort-asc-button' : 'tables::header-cell.sort-desc-button'"
                    class="fi-ta-header-cell-sort-icon h-5 w-5 shrink-0"
                />
            </button>
        </x-filament-tables::header-cell>
    </template>
@endforeach

<template id="analytics-native-table-row">
    <x-filament-tables::row> </x-filament-tables::row>
</template>

<template id="analytics-native-table-cell">
    <x-filament-tables::cell data-table-cell>
        <div class="fi-ta-col-wrp">
            <div class="fi-ta-text">
                <span class="fi-ta-text-item-label" data-native-cell-label></span>
            </div>
        </div>
    </x-filament-tables::cell>
</template>

@php
    // The inert prototype exposes all controls; the client supplies the result counts.
    $paginationPrototype = (new \Illuminate\Pagination\LengthAwarePaginator(range(1, 25), 200, 25, 2))->onEachSide(0);
@endphp
<template id="analytics-native-table-pagination">
    <x-filament::pagination
        :paginator="$paginationPrototype"
        :page-options="[10, 25, 50, 100]"
        class="fi-ta-pagination mb-table-pagination px-3 py-3 sm:px-6"
        :data-overview-template="trans_choice('filament::components/pagination.overview', 2, ['first' => '{first}', 'last' => '{last}', 'total' => '{total}'])"
        :data-number-locale="\Illuminate\Support\Number::defaultLocale()"
        :data-page-size-label="__('filament::components/pagination.fields.records_per_page.label')"
    />
</template>

@foreach (['page', 'active', 'ellipsis', 'previous', 'previous-disabled', 'next', 'next-disabled'] as $item)
    <template id="analytics-native-table-pagination-{{ $item }}">
        <x-filament::pagination.item
            :active="$item === 'active'"
            :disabled="$item === 'ellipsis' || str_ends_with($item, '-disabled')"
            :icon="str_starts_with($item, 'previous') ? (__('filament-panels::layout.direction') === 'rtl' ? 'heroicon-m-chevron-right' : 'heroicon-m-chevron-left') : (str_starts_with($item, 'next') ? (__('filament-panels::layout.direction') === 'rtl' ? 'heroicon-m-chevron-left' : 'heroicon-m-chevron-right') : null)"
            :label="in_array($item, ['page', 'active', 'ellipsis']) ? '0' : null"
        />
    </template>
@endforeach
