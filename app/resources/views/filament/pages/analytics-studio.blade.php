<x-filament-panels::page>
    {!! app(\App\Support\AnalyticsAssets::class)->tags(['resources/js/analytics.js']) !!}
    <div id="analytics-studio" wire:ignore.self data-form-components='@json($analyticsFormComponents)' data-api="{{ url('/analytics/api') }}" data-user="{{ auth()->id() }}" data-csrf="{{ csrf_token() }}" data-preview-row-limit="{{ config('analytics.preview_row_limit') }}" data-preview-aggregate-limit="{{ config('analytics.preview_aggregate_limit') }}" data-section="{{ $analyticsSection }}" data-record="{{ $analyticsRecord }}" data-read-only="{{ $analyticsReadOnly ? 'true' : 'false' }}" data-routes='@json($analyticsRoutes)' data-initial='@json($analyticsInitial)'>
        <div data-analytics-content wire:ignore>
            <div class="mb-loading">در حال آماده‌سازی فضای تحلیل…</div>
        </div>
        <div wire:ignore>@include('filament.partials.analytics-modal')</div>
        @include('filament.partials.analytics-native-form')
    </div>
</x-filament-panels::page>
