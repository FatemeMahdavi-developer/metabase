<?php

namespace Database\Seeders;

use App\Domain\Analytics\DashboardStore;
use App\Domain\Analytics\Drivers\ConnectionManager;
use App\Domain\Analytics\ReportRunner;
use App\Models\AnalyticsConnection;
use App\Models\AnalyticsDashboard;
use App\Models\AnalyticsFolder;
use App\Models\AnalyticsReport;
use App\Models\User;
use Filament\Facades\Filament;
use Illuminate\Database\Connection;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Validator;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

/** Creates local analytics definitions; the external ClickHouse database is read-only. */
class AnalyticsClickHouseSeeder extends Seeder
{
    // The owner is a Filament user in PostgreSQL, independent of external Metabase.
    // Both connection profiles already live in config/database.php; no credentials here.
    public array $options = [
        // CLI fallback: a web request uses the authenticated user's own connection.
        'owner_connection' => 'pgsql',
        'owner_email' => null,
        'connection_id' => null,
        'laravel_connection' => 'clickhouse',
        'source' => 'incidents',
        'date_field' => 'event_time',
        'category_field' => null,
        'value_field' => null,
        'dashboard_name' => 'نمای کلی ClickHouse',
    ];

    public function run(): void
    {
        $options = $this->options;
        $user = $this->owner($options);
        $connection = $this->connection($user, $options);
        $manager = app(ConnectionManager::class);

        // Catalog reads every table/view, including tables without any Eloquent model.
        // Do network IO before opening a transaction on the application's database.
        $catalog = $manager->catalog($connection);
        $source = trim((string) ($options['source'] ?? ''));
        if (! str_contains($source, '.')) {
            $source = $connection->configuration['database'].'.'.$source;
        }
        $table = collect($catalog)->firstWhere('key', $source);
        if (! $table) {
            $this->invalid('source', 'جدول یا View انتخاب‌شده در ClickHouse یافت نشد. گزینهٔ source ابتدای AnalyticsClickHouseSeeder و نام دیتابیس را بررسی کنید.');
        }

        $fields = collect($table['fields'])->keyBy('key')->all();
        $date = $this->field($fields, $options['date_field'] ?? null, 'date_field', ['date']);
        $category = $this->field($fields, $options['category_field'] ?? null, 'category_field', ['text', 'number', 'boolean']);
        $value = $this->field($fields, $options['value_field'] ?? null, 'value_field', ['number']);
        $dashboardName = trim((string) ($options['dashboard_name'] ?? 'نمای کلی ClickHouse'));
        Validator::make(['name' => $dashboardName], ['name' => 'required|string|max:150'])->validate();

        $dashboard = DB::transaction(function () use ($user, $connection, $catalog, $source, $date, $category, $value, $dashboardName) {
            $connection->fill(['catalog' => $catalog, 'synced_at' => now()])->save();
            $marker = ['connection_id' => (int) $connection->id, 'source' => $source];
            // Keep the durable reference outside editable dashboard settings. The UI
            // may legitimately replace its settings or rename/move the dashboard.
            $seededId = $connection->metadata['_clickhouse_seed_dashboards'][$source] ?? null;
            $existing = $seededId ? AnalyticsDashboard::where('owner_id', $user->id)->find($seededId) : null;
            $existing ??= AnalyticsDashboard::where('owner_id', $user->id)->get()
                ->first(fn ($dashboard) => (int) ($dashboard->settings['clickhouse_seed']['connection_id'] ?? 0) === $marker['connection_id']
                    && ($dashboard->settings['clickhouse_seed']['source'] ?? null) === $source);
            if ($existing) {
                // A rerun refreshes the source list, preserving saved names, layouts and reports.
                $metadata = $connection->metadata ?? [];
                $metadata['_clickhouse_seed_dashboards'][$source] = $existing->id;
                $connection->update(['metadata' => $metadata]);

                return $existing;
            }

            $base = [
                'connection_id' => $connection->id, 'source' => $source,
                'mode' => 'aggregate', 'metrics' => [], 'dimensions' => [],
                'filters' => [], 'sort' => [], 'joins' => [], 'limit' => 100,
            ];
            $count = [['key' => 'records', 'function' => 'count', 'field' => null]];
            $definitions = [
                'count' => ['name' => 'تعداد رکوردها', 'display' => 'number', 'query' => [...$base, 'metrics' => $count]],
            ];
            if ($value) {
                $definitions['sum'] = ['name' => 'مجموع '.$value, 'display' => 'number', 'query' => [...$base, 'metrics' => [['key' => 'total', 'function' => 'sum', 'field' => $value]]]];
            }
            if ($date) {
                $definitions['trend'] = ['name' => 'روند روزانه', 'display' => 'area', 'query' => [...$base, 'metrics' => $count, 'dimensions' => [['field' => $date, 'grain' => 'day']], 'sort' => [['key' => $date, 'direction' => 'asc']]]];
            }
            if ($category) {
                $definitions['distribution'] = ['name' => 'توزیع بر اساس '.$category, 'display' => 'doughnut', 'query' => [...$base, 'metrics' => $count, 'dimensions' => [['field' => $category, 'grain' => null]], 'sort' => [['key' => 'records', 'direction' => 'desc']]]];
            }
            $definitions['records'] = ['name' => 'جزئیات رکوردها', 'display' => 'table', 'query' => [...$base, 'mode' => 'rows', 'sort' => $date ? [['key' => $date, 'direction' => 'desc']] : []]];

            $runner = app(ReportRunner::class);
            foreach ($definitions as &$definition) {
                $definition['query'] = $runner->validate($definition['query'], $user->id);
            }
            unset($definition);

            $folderName = Str::limit('ClickHouse • '.$connection->name, 100, '');
            $folderId = AnalyticsFolder::firstOrCreate(['owner_id' => $user->id, 'name' => $folderName])->id;
            $widgets = [];
            $chartCount = (int) (bool) $date + (int) (bool) $category;
            $chartIndex = 0;
            foreach ($definitions as $key => $definition) {
                $report = AnalyticsReport::create([
                    'owner_id' => $user->id, 'folder_id' => $folderId,
                    'name' => Str::limit($definition['name'].' • '.$source, 150, ''),
                    'description' => 'گزارش از داده‌های موجود ClickHouse؛ '.$source,
                    'query_definition' => $definition['query'], 'display' => $definition['display'],
                    'visualization_settings' => ['legend' => true, 'decimals' => 0],
                ]);
                [$x, $y, $w, $h] = match ($key) {
                    'count' => [0, 0, $value ? 12 : 24, 4],
                    'sum' => [12, 0, 12, 4],
                    'records' => [0, $chartCount ? 12 : 4, 24, 10],
                    default => [$chartIndex++ * 12, 4, $chartCount === 1 ? 24 : 12, 8],
                };
                $widgets[] = ['key' => 'clickhouse-'.$key, 'type' => 'report', 'report_id' => $report->id, 'tab_key' => 'overview', 'x' => $x, 'y' => $y, 'w' => $w, 'h' => $h, 'settings' => [], 'click_behavior' => ['type' => 'details']];
            }
            $filters = $date ? [[
                'key' => 'period', 'label' => 'بازهٔ زمانی', 'type' => 'date', 'required' => false,
                'default_value' => null, 'settings' => ['operator' => 'between'],
                'bindings' => array_map(fn ($widget) => ['widget_key' => $widget['key'], 'target' => $date, 'operator' => 'between'], $widgets),
            ]] : [];
            $dashboard = AnalyticsDashboard::create(['owner_id' => $user->id, 'name' => $dashboardName, 'folder_id' => $folderId, 'version' => 0, 'settings' => []]);
            app(DashboardStore::class)->save($dashboard, [
                'name' => $dashboardName, 'description' => 'تحلیل داده‌های '.$source.' در ClickHouse',
                'folder_id' => $folderId, 'version' => 0,
                'settings' => ['auto_apply' => true, 'refresh_interval' => 0, 'width' => 'wide', 'clickhouse_seed' => $marker],
                'tabs' => [['key' => 'overview', 'name' => 'نمای کلی']], 'widgets' => $widgets, 'filters' => $filters,
            ], $user->id);

            $metadata = $connection->metadata ?? [];
            $metadata['_clickhouse_seed_dashboards'][$source] = $dashboard->id;
            $connection->update(['metadata' => $metadata]);

            return $dashboard;
        });

        $this->command?->info('ClickHouse dashboard ready: '.$dashboard->id.'; source: '.$source.'; tables/views: '.count($catalog));
    }

    private function owner(array $options): User
    {
        // Use the panel's own guard; another Laravel guard may represent a
        // different user. Outside a panel, use Laravel's default auth guard.
        $authenticated = Filament::getCurrentPanel() ? Filament::auth()->user() : Auth::user();
        if ($authenticated !== null) {
            if (! $authenticated instanceof User || ! $authenticated->exists || $authenticated->getKey() === null) {
                $this->invalid('owner_email', 'کاربر احرازهویت‌شده باید یک کاربر ذخیره‌شده از مدل User پنل Filament باشد.');
            }
            $this->assertOwnerDatabase($authenticated->getConnection());
            if (! empty($options['owner_email']) && strcasecmp(trim($options['owner_email']), $authenticated->email) !== 0) {
                $this->invalid('owner_email', 'ایمیل مالک با کاربر واردشده به Filament متفاوت است. برای ساخت داشبورد کاربر جاری، owner_email را خالی بگذارید یا ایمیل همان کاربر را قرار دهید.');
            }
            $user = $authenticated->newQuery()->whereKey($authenticated->getKey())->where('email', $authenticated->email)->first();
            if (! $user) {
                $this->invalid('owner_email', 'کاربر واردشده دیگر در جدول کاربران پنل وجود ندارد. دوباره وارد پنل شوید.');
            }

            return $user;
        }
        if (! app()->runningInConsole()) {
            $this->invalid('owner_email', 'برای ساخت داشبورد وارد پنل Filament شوید.');
        }

        // Artisan has no browser login session. Resolve an existing Filament user
        // through Eloquent only when the seeder runs without an authenticated user.
        $model = new User;
        $name = $options['owner_connection'] ?? $model->getConnectionName() ?? config('database.default');
        if (! is_string($name) || $name === '' || ! is_array(config('database.connections.'.$name))) {
            $this->invalid('owner_connection', 'اتصال کاربران پنل Filament تعریف نشده است. گزینهٔ owner_connection ابتدای Seeder باید نام اتصال PostgreSQL کاربران در config/database.php باشد.');
        }
        $database = DB::connection($name);
        $this->assertOwnerDatabase($database);
        $query = User::on($name);
        if (! empty($options['owner_email'])) {
            $user = $query->where('email', trim($options['owner_email']))->first();
        } else {
            $users = $query->orderBy('id')->limit(2)->get();
            $user = $users->count() === 1 ? $users->first() : null;
        }
        if (! $user) {
            $this->invalid('owner_email', 'اجرای Artisan نشست ورود مرورگر ندارد. ایمیل کاربر Filament موجود در PostgreSQL را در owner_email ابتدای AnalyticsClickHouseSeeder قرار دهید؛ ایمیل حساب Metabase جداگانه قابل استفاده نیست.');
        }

        return $user;
    }

    private function assertOwnerDatabase(Connection $database): void
    {
        // Foreign keys and HTTP access checks use the Filament user's identity.
        // Matching an unrelated database's numeric user ID would assign the wrong owner.
        foreach ([(new User)->getConnection(), DB::connection()] as $identityDatabase) {
            if (! $this->sameDatabase($database, $identityDatabase)) {
                $this->invalid('owner_connection', 'اتصال مالک باید همان دیتابیس کاربران پنل Filament و جدول‌های analytics_* باشد. اتصال PostgreSQL مدل User و دیتابیس اصلی برنامه را بررسی کنید؛ حساب Metabase جداگانه مالک این داشبورد نیست.');
            }
        }
    }

    private function sameDatabase(Connection $left, Connection $right): bool
    {
        if ($left === $right) {
            return true;
        }
        if ($left->getDriverName() !== $right->getDriverName() || $left->getTablePrefix() !== $right->getTablePrefix()) {
            return false;
        }
        if ($left->getDriverName() === 'sqlite') {
            if (in_array($left->getDatabaseName(), ['', ':memory:'], true) || in_array($right->getDatabaseName(), ['', ':memory:'], true)) {
                return $left->getPdo() === $right->getPdo();
            }

            return (realpath($left->getDatabaseName()) ?: $left->getDatabaseName()) === (realpath($right->getDatabaseName()) ?: $right->getDatabaseName())
                && $left->getTablePrefix() === $right->getTablePrefix();
        }
        $identity = fn (Connection $connection) => [
            'driver' => $connection->getDriverName(),
            'host' => $connection->getConfig('host'),
            'port' => (int) ($connection->getConfig('port') ?? match ($connection->getDriverName()) {
                'pgsql' => 5432, 'mysql', 'mariadb' => 3306, 'sqlsrv' => 1433, default => 0,
            }),
            'database' => $connection->getDatabaseName(),
            'prefix' => $connection->getTablePrefix(),
            'schema' => $connection->getConfig('search_path') ?? $connection->getConfig('schema'),
            'socket' => $connection->getConfig('unix_socket'),
            // PostgreSQL roles may have different default schemas or row visibility.
            'role' => $connection->getDriverName() === 'pgsql' ? $connection->getConfig('username') : null,
        ];

        return $identity($left) === $identity($right);
    }

    private function connection(User $user, array $options): AnalyticsConnection
    {
        $connections = AnalyticsConnection::where('owner_id', $user->id)->where('driver', 'clickhouse');
        if (! empty($options['connection_id'])) {
            $connection = $connections->whereKey($options['connection_id'])->first();
            if (! $connection) {
                $this->invalid('connection_id', 'اتصال ClickHouse با این شناسه برای کاربر انتخاب‌شده وجود ندارد.');
            }

            return $connection;
        }
        $existing = $connections->limit(2)->get();
        if ($existing->count() === 1) {
            return $existing->first();
        }
        if ($existing->count() > 1) {
            $this->invalid('connection_id', 'چند اتصال ClickHouse وجود دارد؛ گزینهٔ connection_id ابتدای AnalyticsClickHouseSeeder را مشخص کنید.');
        }

        // Import configuration only. Do not instantiate a PDO or third-party Laravel driver.
        $name = (string) ($options['laravel_connection'] ?? 'clickhouse');
        $profile = config('database.connections.'.$name);
        if (! is_array($profile) || ($profile['driver'] ?? null) !== 'clickhouse') {
            $this->invalid('laravel_connection', 'ابتدا اتصال ClickHouse را در صفحهٔ پایگاه‌های داده بسازید، یا تنظیمات اتصال clickhouse را در config/database.php تعریف کنید.');
        }
        $port = $profile['http_port'] ?? $profile['port'] ?? 8123;
        if (in_array((int) $port, [9000, 9440], true)) {
            $this->invalid('http_port', 'این اتصال از HTTP استفاده می‌کند. پورت HTTP سرور را در http_port همان اتصال در config/database.php مشخص کنید؛ پورت Native قابل استفاده نیست.');
        }
        $configuration = [
            'host' => $profile['host'] ?? null, 'port' => $port, 'database' => $profile['database'] ?? null,
            'username' => $profile['username'] ?? $profile['user'] ?? 'default', 'password' => $profile['password'] ?? '',
            'ssl' => filter_var($profile['ssl'] ?? $profile['https'] ?? (($profile['protocol'] ?? '') === 'https'), FILTER_VALIDATE_BOOLEAN),
        ];
        $configuration = Validator::make($configuration, [
            'host' => 'required|string|max:200|regex:/^[a-zA-Z0-9.\-:\[\]]+$/', 'port' => 'required|integer|min:1|max:65535',
            'database' => 'required|string|max:150', 'username' => 'required|string|max:150',
            'password' => 'nullable|string|max:500', 'ssl' => 'required|boolean',
        ])->validate();

        return new AnalyticsConnection(['owner_id' => $user->id, 'name' => Str::limit('ClickHouse • '.$name, 150, ''), 'driver' => 'clickhouse', 'configuration' => $configuration]);
    }

    private function field(array $fields, mixed $key, string $option, array $types): ?string
    {
        if ($key === null || $key === '') {
            return null;
        }
        $field = is_string($key) ? ($fields[$key] ?? null) : null;
        // A ClickHouse Array/Map/AggregateFunction is not a scalar, even when its type
        // contains a numeric/date name. Nullable/LowCardinality scalar wrappers are fine.
        if (! $field || ! empty($field['hidden']) || ! in_array($field['type'], $types, true)
            || preg_match('/\b(Array|Map|Tuple|Nested|AggregateFunction|SimpleAggregateFunction)\s*\(/i', $field['raw_type'] ?? '')) {
            $this->invalid($option, 'ستون '.$key.' وجود ندارد، مخفی است یا نوع مناسبی ندارد. گزینهٔ '.$option.' را در ابتدای AnalyticsClickHouseSeeder بررسی کنید.');
        }

        return $key;
    }

    private function invalid(string $field, string $message): never
    {
        throw ValidationException::withMessages([$field => $message]);
    }
}
