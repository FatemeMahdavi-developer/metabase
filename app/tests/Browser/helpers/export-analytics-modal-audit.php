<?php
require dirname(__DIR__, 3).'/vendor/autoload.php';
$app = require dirname(__DIR__, 3).'/bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
$app->setLocale('fa');
require_once dirname(__DIR__, 2).'/Fixtures/AnalyticsModalAuditFixture.php';

$manager = app(\Filament\Support\Colors\ColorManager::class);
$manager->register(\Filament\Facades\Filament::getPanel('admin')->getColors());
$palette = ':root{';
foreach ($manager->getColors() as $name => $shades) foreach ($shades as $shade => $rgb) $palette .= '--'.$name.'-'.$shade.':'.$rgb.';';
$palette .= '}';

$cases = [];
foreach (\Tests\Fixtures\AnalyticsModalAuditFixture::cases() as $scenario => $case) {
    $html = (string) \Livewire\Livewire::mount(\Tests\Fixtures\AnalyticsModalAuditFixture::class, compact('scenario'));
    $cases[$scenario] = ['kind' => $case['kind'], 'html' => str_replace('data-analytics-audit-'.$scenario, 'data-analytics-native-form', str_replace('analytics-native-form', 'analytics-audit-'.$scenario, $html))];
}
$references = [];
foreach (['create', 'edit', 'delete', 'createFolder'] as $scenario) {
    $html = (string) \Livewire\Livewire::mount(\Tests\Fixtures\AnalyticsModalReferenceFixture::class, compact('scenario'));
    // Retain mounted Action state and real Vendor markup, but open one modal at a time in the browser.
    $references[$scenario] = preg_replace_callback('/wire:effects="([^"]*)"/', function (array $match): string {
        $effects = json_decode(html_entity_decode($match[1], ENT_QUOTES | ENT_HTML5, 'UTF-8'), true, 512, JSON_THROW_ON_ERROR);
        $effects['dispatches'] = array_values(array_filter($effects['dispatches'] ?? [], fn (array $event): bool => $event['name'] !== 'open-modal'));
        return 'wire:effects="'.htmlspecialchars(json_encode($effects, JSON_THROW_ON_ERROR), ENT_QUOTES, 'UTF-8').'"';
    }, $html);
}
$baselines = [];
foreach (['create', 'edit'] as $scenario) {
    $html = (string) \Livewire\Livewire::mount(\Tests\Fixtures\AnalyticsModalReferenceFixture::class, compact('scenario'));
    $baselines[$scenario] = str_replace('data-modal-audit-reference=', 'data-modal-audit-baseline=', preg_replace_callback('/wire:effects="([^"]*)"/', function (array $match): string {
        $effects = json_decode(html_entity_decode($match[1], ENT_QUOTES | ENT_HTML5, 'UTF-8'), true, 512, JSON_THROW_ON_ERROR);
        $effects['dispatches'] = array_values(array_filter($effects['dispatches'] ?? [], fn (array $event): bool => $event['name'] !== 'open-modal'));
        return 'wire:effects="'.htmlspecialchars(json_encode($effects, JSON_THROW_ON_ERROR), ENT_QUOTES, 'UTF-8').'"';
    }, $html));
}
$nativeBaselines = [];
foreach (['source', 'filter_value'] as $scenario) {
    $nativeBaseline = (string) \Livewire\Livewire::mount(\Tests\Fixtures\AnalyticsModalAuditFixture::class, compact('scenario'));
    $nativeBaselines[$scenario] = str_replace('data-modal-audit-case=', 'data-modal-audit-baseline-native=', str_replace('data-analytics-audit-baseline-'.$scenario, 'data-analytics-native-form', str_replace('analytics-native-form', 'analytics-audit-baseline-'.$scenario, $nativeBaseline)));
}
$pageForm = (string) \Livewire\Livewire::mount(\Tests\Fixtures\AnalyticsModalPageFormFixture::class);
$invalid = (string) \Livewire\Livewire::mount(\Tests\Fixtures\AnalyticsModalAuditFixture::class, ['scenario' => 'columns', 'invalid' => true]);
echo json_encode(['pageForm' => $pageForm, 'baselines' => $baselines, 'nativeBaselines' => $nativeBaselines, 'cases' => $cases, 'references' => $references, 'invalidColumns' => str_replace('data-analytics-audit-columns', 'data-analytics-native-form', str_replace('analytics-native-form', 'analytics-audit-columns', $invalid)), 'generic' => view('filament.partials.analytics-modal')->render(), 'palette' => $palette, 'livewireStyles' => (string) \Livewire\Mechanisms\FrontendAssets\FrontendAssets::styles()], JSON_THROW_ON_ERROR);