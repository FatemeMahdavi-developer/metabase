<?php

namespace App\Domain\Analytics\Filament;

use Filament\Forms\Components\Component;
use Filament\Forms\Components\DatePicker;
use Filament\Forms\Components\Select;
use Filament\Forms\Components\Textarea;
use Filament\Forms\Components\TextInput;
use Illuminate\Support\HtmlString;
use Illuminate\Support\Js;

/** Share panel field styling and Filament dropdowns across analytics forms. */
final class PanelFormFields
{
    /**
     * @param  array<Component>  $components
     * @return array<Component>
     */
    public static function floating(array $components): array
    {
        foreach ($components as $component) {
            if ($component instanceof Select) {
                // Browser option menus cannot inherit the shared panel hover styles.
                $component->native(false);
            }

            if ($component instanceof TextInput || $component instanceof Select || $component instanceof Textarea || $component instanceof DatePicker) {
                $component->extraFieldWrapperAttributes(fn ($component): array => [
                    'class' => 'soar-floating-field'.($component instanceof Select ? ' soar-floating-select' : ''),
                    'x-data' => new HtmlString('soarFloatingField('.Js::from($component->getStatePath())->toHtml().')'),
                    'x-bind:class' => new HtmlString("{ 'soar-floating-has-value': hasValue }"),
                ], merge: true);
            }

            self::floating($component->getChildComponents());
        }

        return $components;
    }
}
