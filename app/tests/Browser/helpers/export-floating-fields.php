<?php

require dirname(__DIR__, 3).'/vendor/autoload.php';
$app = require dirname(__DIR__, 3).'/bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
$app->setLocale('fa');

require_once dirname(__DIR__, 2).'/Fixtures/AnalyticsFloatingFieldFixture.php';

echo \Livewire\Livewire::mount(\Tests\Fixtures\AnalyticsFloatingFieldFixture::class);
