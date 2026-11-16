<?php

require dirname(__DIR__, 3).'/vendor/autoload.php';
$app = require dirname(__DIR__, 3).'/bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
$app->setLocale('fa');

require_once dirname(__DIR__, 2).'/Fixtures/AnalyticsFloatingActionFixture.php';

echo json_encode([
    'initial' => (string) \Livewire\Livewire::mount(\Tests\Fixtures\AnalyticsFloatingActionFixture::class),
    'invalid' => (string) \Livewire\Livewire::mount(\Tests\Fixtures\AnalyticsFloatingActionFixture::class, ['invalid' => true]),
], JSON_THROW_ON_ERROR);
