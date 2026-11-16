<?php

require dirname(__DIR__, 3).'/vendor/autoload.php';
$app = require dirname(__DIR__, 3).'/bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();

require_once dirname(__DIR__, 2).'/Fixtures/NativeAnalyticsTableFixture.php';
echo \Livewire\Livewire::mount(\Tests\Fixtures\NativeAnalyticsTableFixture::class, ['reference' => in_array('--with-reference', $argv, true)]);
