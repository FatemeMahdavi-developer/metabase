<?php

use App\Models\AnalyticsConnection;
use App\Models\User;
use Illuminate\Contracts\Console\Kernel;

require dirname(__DIR__, 3).'/vendor/autoload.php';
$app = require dirname(__DIR__, 3).'/bootstrap/app.php';
$app->make(Kernel::class)->bootstrap();
abort_unless(app()->environment('local', 'testing'), 403);
$credentials = json_decode(ltrim(file_get_contents(dirname(__DIR__, 4).'/.tools/admin.json'), "\xEF\xBB\xBF"), true);
$user = User::where('email', getenv('ANALYTICS_EMAIL') ?: $credentials['email'])->firstOrFail();
$stamp = $argv[1];
$fields = [
    ['key' => 'id', 'label' => 'id', 'type' => 'number', 'raw_type' => 'integer', 'primary' => true, 'nullable' => false],
    ['key' => 'amount', 'label' => 'amount', 'type' => 'number', 'raw_type' => 'numeric', 'nullable' => false],
    ['key' => 'status', 'label' => 'status', 'type' => 'text', 'raw_type' => 'text', 'nullable' => false],
];
$connection = AnalyticsConnection::create([
    'owner_id' => $user->id, 'name' => 'Native Forms Browser '.$stamp, 'driver' => 'pgsql',
    'configuration' => ['host' => 'browser_'.$stamp, 'port' => 5432, 'database' => 'browser_'.$stamp, 'username' => 'fixture', 'sslmode' => 'disable'],
    'catalog' => [
        ['key' => 'public.orders', 'label' => 'orders', 'kind' => 'table', 'fields' => $fields],
        ['key' => 'public.customers', 'label' => 'customers', 'kind' => 'table', 'fields' => $fields],
    ],
]);
echo json_encode(['id' => $connection->id]);
