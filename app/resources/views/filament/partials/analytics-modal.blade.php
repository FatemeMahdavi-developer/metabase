{{-- Keep the native Alpine modal lifecycle outside the JavaScript workbench renderer. --}}
<div data-analytics-modal-host>
    @foreach (['dialog' => false, 'slide-over' => true] as $variant => $slideOver)
        <x-filament::modal
            :id="'analytics-'.$variant"
            :slide-over="$slideOver"
            :width="$slideOver ? 'xl' : '3xl'"
            :sticky-header="true"
            :sticky-footer="true"
            :close-by-clicking-away="true"
            :extra-modal-window-attribute-bag="new \Illuminate\View\ComponentAttributeBag(['data-analytics-modal-window' => $variant])"
            :aria-labelledby="'analytics-'.$variant.'-heading'"
        >
            <x-slot name="heading">
                <span id="analytics-{{ $variant }}-heading" data-analytics-modal-title></span>
            </x-slot>

            <div class="analytics-workbench-form">
                <div class="mb-dialog-body" data-analytics-modal-body></div>
                <div class="mb-dialog-error" role="alert" aria-live="polite"></div>
            </div>

            <x-slot name="footer">
                <div class="fi-modal-footer-actions mb-dialog-footer" data-analytics-modal-footer></div>
            </x-slot>
        </x-filament::modal>
    @endforeach
</div>

{{-- Native button markup for interactive chart and notebook navigation; fields live in PHP Forms. --}}
@foreach (['primary', 'gray', 'danger', 'success'] as $color)
    <template id="analytics-native-button-{{ $color }}">
        <x-filament::button :color="$color" :loading-indicator="false"> </x-filament::button>
    </template>
@endforeach
