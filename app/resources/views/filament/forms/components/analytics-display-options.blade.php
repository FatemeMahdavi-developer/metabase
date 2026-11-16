@php
    $id = $getId();
    $statePath = $getStatePath();
@endphp

<x-dynamic-component :component="$getFieldWrapperView()" :field="$field">
    <div
        role="radiogroup"
        aria-label="{{ $getLabel() }}"
        {{ $attributes->merge($getExtraAttributes(), escape: false)->class(['analytics-display-options fi-fo-radio']) }}
    >
        @foreach ($getOptions() as $value => $label)
            <label class="analytics-display-option" data-display-option="{{ $value }}">
                <x-filament::input.radio
                    :valid="! $errors->has($statePath)"
                    :attributes="\Filament\Support\prepare_inherited_attributes($getExtraInputAttributeBag())
                        ->merge([
                            'autofocus' => $loop->first && $isAutofocused(),
                            'disabled' => $isDisabled() || $isOptionDisabled($value, $label),
                            'id' => $id . '-' . $value,
                            'name' => $id,
                            'value' => $value,
                            'checked' => (string) $getState() === (string) $value,
                            'aria-labelledby' => $id . '-' . $value . '-label',
                            'aria-describedby' => $hasDescription($value) ? $id . '-' . $value . '-description' : null,
                            $applyStateBindingModifiers('wire:model') => $statePath,
                        ], escape: false)"
                />
                <span class="analytics-display-option-preview">
                    @include('filament.forms.components.analytics-display-preview', ['display' => $value])
                </span>
                <span class="analytics-display-option-label" id="{{ $id }}-{{ $value }}-label">{{ $label }}</span>
                @if ($hasDescription($value))
                    <span class="analytics-display-option-description" id="{{ $id }}-{{ $value }}-description">{{ $getDescription($value) }}</span>
                @endif
            </label>
        @endforeach
    </div>
</x-dynamic-component>
