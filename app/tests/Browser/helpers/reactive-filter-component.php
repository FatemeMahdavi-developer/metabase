<?php

// A local, in-memory Livewire transport: production hydration, callbacks and HTML morphs,
// with no HTTP login, persistent user, report or database mutation.
require dirname(__DIR__, 3).'/vendor/autoload.php';
$app = require dirname(__DIR__, 3).'/bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
$app->setLocale('fa');
require_once dirname(__DIR__, 2).'/Fixtures/AnalyticsReactiveFilterFixture.php';
require_once dirname(__DIR__, 2).'/Fixtures/AnalyticsDateFilterFixture.php';
require_once __DIR__.'/panel-palette.php';
\Livewire\Livewire::component('analytics-reactive-filter-fixture', \Tests\Fixtures\AnalyticsReactiveFilterFixture::class);
\Livewire\Livewire::component('analytics-date-filter-fixture', \Tests\Fixtures\AnalyticsDateFilterFixture::class);

while (($line = fgets(STDIN)) !== false) {
    ob_start();
    try {
        $message = json_decode($line, true, 512, JSON_THROW_ON_ERROR);
        if (($message['command'] ?? '') === 'initial') {
            $markup = ($message['fixture'] ?? '') === 'date'
                ? (string) \Livewire\Livewire::mount('analytics-date-filter-fixture', ['scenario' => $message['scenario'] ?? 'dashboard-date'])
                : (string) \Livewire\Livewire::mount('analytics-reactive-filter-fixture');
            $result = [
                'markup' => $markup,
                'palette' => analyticsFixturePanelPalette(),
                'livewireStyles' => (string) \Livewire\Mechanisms\FrontendAssets\FrontendAssets::styles(),
            ];
        } else {
            $responses = [];
            foreach ($message['components'] as $component) {
                [$snapshot, $effects] = app('livewire')->update(
                    json_decode($component['snapshot'], true, 512, JSON_THROW_ON_ERROR),
                    $component['updates'],
                    $component['calls'],
                );
                $responses[] = ['snapshot' => json_encode($snapshot, JSON_THROW_ON_ERROR), 'effects' => $effects];
            }
            $result = ['components' => $responses, 'assets' => []];
        }
        \Livewire\Livewire::flushState();
        ob_end_clean();
        echo json_encode($result, JSON_THROW_ON_ERROR).PHP_EOL;
    } catch (\Throwable $error) {
        ob_end_clean();
        echo json_encode(['fixtureError' => get_class($error).': '.$error->getMessage()], JSON_THROW_ON_ERROR).PHP_EOL;
    }
    fflush(STDOUT);
}
