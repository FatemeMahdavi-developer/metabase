<?php

require dirname(__DIR__, 3).'/vendor/autoload.php';
$app = require dirname(__DIR__, 3).'/bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
$app->setLocale('fa');

require_once dirname(__DIR__, 2).'/Fixtures/AnalyticsFieldFixture.php';

require_once __DIR__.'/panel-palette.php';
echo json_encode([
    'markup' => (string) \Livewire\Livewire::mount(\Tests\Fixtures\AnalyticsFieldFixture::class),
    'palette' => analyticsFixturePanelPalette(),
    'livewireStyles' => (string) \Livewire\Mechanisms\FrontendAssets\FrontendAssets::styles(),
], JSON_THROW_ON_ERROR);
