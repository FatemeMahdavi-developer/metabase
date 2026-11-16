<?php

// Render the same Vendor controls mounted by the real analytics page; no account or database writes.
require dirname(__DIR__, 3).'/vendor/autoload.php';
$app = require dirname(__DIR__, 3).'/bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
$app->setLocale('fa');
$html = view('filament.partials.analytics-modal')->render();
preg_match_all('~<template id="analytics-native-button-[^"]+">.*?</template>~s', $html, $matches);
echo implode("\n", $matches[0]);
echo view('filament.partials.analytics-native-controls')->render();

require_once __DIR__.'/panel-palette.php';
echo '<style data-fixture-panel-palette>'.analyticsFixturePanelPalette().'</style>';
