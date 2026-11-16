<?php

require dirname(__DIR__, 3).'/vendor/autoload.php';
$app = require dirname(__DIR__, 3).'/bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();

$html = view('filament.partials.analytics-modal')->render();
preg_match_all('~<template id="analytics-native-button-[^"]+">.*?</template>~s', $html, $matches);
echo implode("\n", $matches[0]);
