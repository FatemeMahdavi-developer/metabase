<?php

namespace Database\Seeders;

use App\Domain\Analytics\ConnectionUniqueness;
use App\Domain\Analytics\Drivers\ConnectionManager;
use App\Models\AnalyticsConnection;
use App\Models\User;
use Filament\Facades\Filament;
use Illuminate\Database\Connection;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\ValidationException;
use Throwable;

/** Registers an existing Laravel PostgreSQL profile; never creates external data. */
class AnalyticsPostgresSeeder extends Seeder
{
    public array $options = [
        'laravel_connection' => 'pgsql',
        'connection_name' => 'unisq',
        'owner_email' => null,
        'sync' => true,
    ];

    public function run(): void
    {
        $user = $this->owner();
        $profile = (string) $this->options['laravel_connection'];
        try {
            // Laravel resolves DB_URL here, without opening the source PDO.
            $configuration = DB::connection($profile)->getConfig();
        } catch (Throwable) {
            $this->invalid('laravel_connection', 'پروفایل PostgreSQL در config/database.php تعریف نشده یا معتبر نیست.');
        }
        if (($configuration['driver'] ?? null) !== 'pgsql') {
            $this->invalid('laravel_connection', 'درایور پروفایل انتخاب‌شده باید pgsql باشد.');
        }
        $mapped = [
            'host' => $configuration['host'] ?? '', 'port' => $configuration['port'] ?? 5432,
            'database' => $configuration['database'] ?? '', 'username' => $configuration['username'] ?? '',
            'password' => $configuration['password'] ?? '', 'sslmode' => $configuration['sslmode'] ?? 'prefer',
        ];
        Validator::make($mapped, [
            'host' => 'required|string|max:200|regex:/^[a-zA-Z0-9_.\-:\[\]]+$/',
            'port' => 'required|integer|min:1|max:65535', 'database' => 'required|string|max:150',
            'username' => 'required|string|max:150', 'password' => 'nullable|string',
            'sslmode' => 'required|in:disable,prefer,require,verify-full',
        ])->validate();
        $mapped['port'] = (int) $mapped['port'];
        Validator::make($this->options, ['connection_name' => 'required|string|max:150', 'sync' => 'required|boolean'])->validate();

        $sources = AnalyticsConnection::where('owner_id', $user->id)->where('driver', 'pgsql')->get();
        $connection = $sources->first(fn ($source) => ($source->metadata['_postgres_seed_profile'] ?? null) === $profile);
        $connection ??= $sources->first(fn ($source) => $this->endpoint($source->configuration) === $this->endpoint($mapped));
        $connection ??= new AnalyticsConnection([
            'owner_id' => $user->id, 'name' => $this->options['connection_name'],
            'driver' => 'pgsql', 'configuration' => $mapped,
        ]);
        ConnectionUniqueness::validate($connection);
        // Refresh schema before writing, and retain edits made in the panel.
        $catalog = $this->options['sync'] ? app(ConnectionManager::class)->catalog($connection) : null;
        DB::transaction(function () use ($connection, $catalog, $profile): void {
            $connection->metadata = [...($connection->metadata ?? []), '_postgres_seed_profile' => $profile];
            if ($this->options['sync']) {
                $connection->catalog = $catalog;
                $connection->synced_at = now();
            }
            $connection->save();
        });
        $this->command?->info('PostgreSQL source ready: '.$connection->id);
    }

    private function owner(): User
    {
        $email = trim((string) ($this->options['owner_email'] ?? ''));
        $authenticated = Filament::getCurrentPanel() ? Filament::auth()->user() : Auth::user();
        if ($authenticated !== null) {
            if (! $authenticated instanceof User || ! $authenticated->exists || $authenticated->getKey() === null) {
                $this->invalid('owner_email', 'مالک باید کاربر ذخیره‌شدهٔ پنل Filament باشد.');
            }
            if ($email !== '' && strcasecmp($email, $authenticated->email) !== 0) {
                $this->invalid('owner_email', 'ایمیل مالک باید متعلق به کاربر واردشده به پنل باشد.');
            }
            $this->assertOwnerDatabase($authenticated->getConnection());
            $user = $authenticated->newQuery()->whereKey($authenticated->getKey())->where('email', $authenticated->email)->first();
        } else {
            if (! app()->runningInConsole()) {
                $this->invalid('owner_email', 'برای ثبت اتصال وارد پنل Filament شوید.');
            }
            $model = new User;
            $this->assertOwnerDatabase($model->getConnection());
            $users = $email !== '' ? $model->newQuery()->where('email', $email)->limit(1)->get() : $model->newQuery()->orderBy('id')->limit(2)->get();
            $user = $users->count() === 1 ? $users->first() : null;
        }
        if (! $user) {
            $this->invalid('owner_email', 'Artisan نشست ورود مرورگر ندارد؛ ایمیل یک کاربر موجود پنل را در owner_email مشخص کنید.');
        }

        return $user;
    }

    private function assertOwnerDatabase(Connection $connection): void
    {
        $target = (new AnalyticsConnection)->getConnection();
        if ($connection === $target) {
            return;
        }
        if ($connection->getDriverName() === 'sqlite' && $target->getDriverName() === 'sqlite') {
            $same = in_array($connection->getDatabaseName(), ['', ':memory:'], true)
                ? $connection->getPdo() === $target->getPdo()
                : realpath($connection->getDatabaseName()) === realpath($target->getDatabaseName());
        } else {
            $identity = fn (Connection $database) => [
                $database->getDriverName(), $database->getConfig('host'), (int) $database->getConfig('port'),
                $database->getDatabaseName(), $database->getTablePrefix(), $database->getConfig('search_path'), $database->getConfig('username'),
            ];
            $same = $identity($connection) === $identity($target);
        }
        if (! $same) {
            $this->invalid('owner_email', 'کاربر مالک و جدول‌های analytics باید در دیتابیس یکسان پنل باشند.');
        }
    }

    private function endpoint(array $configuration): ?string
    {
        return ConnectionUniqueness::endpointFingerprint('pgsql', $configuration);
    }

    private function invalid(string $key, string $message): never
    {
        throw ValidationException::withMessages([$key => $message]);
    }
}
