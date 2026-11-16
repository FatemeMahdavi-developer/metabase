<x-filament::modal id="analytics-native-form" width="4xl" class="soar-form-modal" sticky-header sticky-footer>
    <x-slot name="heading">
        <span wire:key="analytics-native-form-heading-{{ $this->workbenchKind }}-{{ $this->workbenchRequest }}">{{ \App\Domain\Analytics\Filament\WorkbenchForms::title($this->workbenchKind) }}</span>
    </x-slot>
    <form wire:key="analytics-native-form-{{ $this->workbenchRequest }}" wire:submit="submitWorkbenchForm" id="analytics-native-form-body" data-analytics-native-form class="space-y-6" novalidate>
        <fieldset wire:loading.attr="disabled" wire:target="submitWorkbenchForm,workbenchCommand" class="space-y-6">
        {{ $this->workbenchForm }}
        @if ($workbenchError)
            <p role="alert" class="text-sm text-danger-600 dark:text-danger-400">{{ $workbenchError }}</p>
        @endif
        <div class="fi-modal-footer-actions">
            <x-filament::button type="submit" wire:loading.attr="disabled" wire:target="submitWorkbenchForm">اعمال</x-filament::button>
            <x-filament::button color="gray" x-on:click="$dispatch('close-modal', { id: 'analytics-native-form' })">انصراف</x-filament::button>
            @if ($this->workbenchKind === 'tab' && ($this->workbenchContext['existing'] ?? false))
                <x-filament::button color="gray" wire:click="workbenchCommand('copy')">کپی تب</x-filament::button>
                <x-filament::button color="danger" wire:click="workbenchCommand('delete')">حذف تب</x-filament::button>
            @endif
            @if ($this->workbenchKind === 'card')
                <x-filament::button color="gray" wire:click="workbenchCommand('visualization')">تنظیم نمایش</x-filament::button>
                <x-filament::button color="gray" wire:click="workbenchCommand('click')">رفتار کلیک</x-filament::button>
            @endif
            @if ($this->workbenchKind === 'click')
                <x-filament::button color="gray" wire:click="workbenchCommand('scope')">تنظیم ستون انتخاب‌شده</x-filament::button>
            @endif
            @if ($this->workbenchKind === 'filter_value')
                <x-filament::button color="gray" wire:click="workbenchCommand('clear')">پاک کردن</x-filament::button>
            @endif
            @if ($this->workbenchKind === 'dashboard_filter' && ($this->workbenchContext['existing'] ?? false))
                <x-filament::button color="danger" wire:click="workbenchCommand('delete')">حذف فیلتر</x-filament::button>
            @endif
            @if ($this->workbenchKind === 'dashboard_picker')
                <x-filament::button color="gray" wire:click="workbenchCommand('create')">داشبورد جدید</x-filament::button>
            @endif
        </div>
        </fieldset>
    </form>
</x-filament::modal>
