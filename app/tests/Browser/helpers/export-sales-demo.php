<?php

// Read the seeded reports through the real query runner without HTTP/session overhead.
require dirname(__DIR__, 3).'/vendor/autoload.php';
$app = require dirname(__DIR__, 3).'/bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
require_once dirname(__DIR__, 2).'/Fixtures/NativeAnalyticsTableFixture.php';

$connection = App\Models\AnalyticsConnection::where('driver', 'pgsql')->get()
    ->first(fn ($source) => isset($source->metadata['_sales_demo_dashboard']));
throw_unless($connection, RuntimeException::class, 'Run AnalyticsSalesDemoSeeder first.');
$dashboard = App\Models\AnalyticsDashboard::findOrFail($connection->metadata['_sales_demo_dashboard']);
$snapshot = app(App\Domain\Analytics\DashboardStore::class)->snapshot($dashboard);
$reports = App\Models\AnalyticsReport::whereIn('id', array_column($snapshot['widgets'], 'report_id'))->get();
$runner = app(App\Domain\Analytics\ReportRunner::class);
$results = [];
foreach ($snapshot['widgets'] as $widget) {
    $report = $reports->firstWhere('id', $widget['report_id']);
    if (! $report) {
        continue;
    }
    $definition = $runner->validate($report->query_definition, $dashboard->owner_id);
    $results[$widget['key']] = $runner->run($definition, $dashboard->owner_id, [], true);
}
echo json_encode([
    'native_table_templates' => \Livewire\Livewire::mount(\Tests\Fixtures\NativeAnalyticsTableFixture::class),
    'dashboard' => $snapshot,
    'reports' => $reports->map(fn ($report) => $report->only(['id', 'name', 'display', 'visualization_settings', 'query_definition']))->values()->all(),
    'results' => $results,
], JSON_THROW_ON_ERROR);
