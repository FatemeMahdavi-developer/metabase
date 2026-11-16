<?php

function analyticsFixturePanelPalette(): string
{
    $manager = app(\Filament\Support\Colors\ColorManager::class);
    $manager->register(\Filament\Facades\Filament::getPanel('admin')->getColors());
    $css = ':root{';
    foreach ($manager->getColors() as $name => $shades) foreach ($shades as $shade => $rgb) $css .= '--'.$name.'-'.$shade.':'.$rgb.';';
    return $css.'}';
}