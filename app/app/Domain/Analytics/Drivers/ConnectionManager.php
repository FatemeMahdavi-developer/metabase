<?php

namespace App\Domain\Analytics\Drivers;

use App\Domain\Analytics\MetadataLabels;
use App\Models\AnalyticsConnection;
use Illuminate\Validation\ValidationException;
use Throwable;

class ConnectionManager
{
    public function driver(AnalyticsConnection $connection): DatabaseDriver
    {
        try {
            if (! $connection->isSupported()) {
                throw new \RuntimeException('این نوع اتصال دیگر پشتیبانی نمی‌شود؛ PostgreSQL یا ClickHouse انتخاب کنید.');
            }

            return match ($connection->driver) {
                'sqlite' => new SqliteDriver($connection->configuration),
                'pgsql' => new PostgresDriver($connection->configuration),
                'clickhouse' => new ClickHouseDriver($connection->configuration),
                default => throw new \RuntimeException('درایور پشتیبانی نمی‌شود.'),
            };
        } catch (Throwable $exception) {
            $message = $exception instanceof \PDOException ? 'اتصال به دیتابیس برقرار نشد؛ میزبان، نام دیتابیس، نام کاربری و رمز را بررسی کنید.' : $exception->getMessage();
            throw ValidationException::withMessages(['connection' => $message]);
        }
    }

    public function catalog(AnalyticsConnection $connection): array
    {
        try {
            $catalog = $this->driver($connection)->catalog();
        } catch (ValidationException $exception) {
            throw $exception;
        } catch (Throwable) {
            throw ValidationException::withMessages(['connection' => 'خواندن ساختار دیتابیس ناموفق بود. دسترسی به جدول‌ها را بررسی کنید.']);
        }

        return $connection->displayCatalog($catalog);
    }

    public function applyMetadata(array $catalog, array $metadata): array
    {
        return MetadataLabels::catalog($catalog, $metadata);
    }

    public function sync(AnalyticsConnection $connection): AnalyticsConnection
    {
        $catalog = $this->catalog($connection);
        $connection->update(['catalog' => $catalog, 'synced_at' => now()]);

        return $connection->refresh();
    }

    public static function fieldType(string $type): string
    {
        $type = strtolower($type);

        return match (true) {
            str_contains($type, 'bool') => 'boolean',
            str_contains($type, 'date') || str_contains($type, 'timestamp') => 'date',
            (bool) preg_match('/int|decimal|numeric|real|float|double|money/', $type) => 'number',
            default => 'text',
        };
    }
}
