<?php

namespace App\Domain\Analytics;

use App\Models\AnalyticsConnection;
use Illuminate\Contracts\Encryption\DecryptException;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Validation\ValidationException;

/** Stable identities exclude credentials and remain independent of display metadata. */
class ConnectionUniqueness
{
    public static function nameFingerprint(string $name): string
    {
        return hash('sha256', mb_strtolower(trim($name), 'UTF-8'));
    }

    public static function endpointFingerprint(string $driver, array $configuration): ?string
    {
        if (! in_array($driver, ['pgsql', 'clickhouse'], true)) {
            return null;
        }

        $host = strtolower(rtrim(trim((string) ($configuration['host'] ?? '')), '.'));
        $host = trim($host, '[]');
        $database = trim((string) ($configuration['database'] ?? ''));
        if ($host === '' || $database === '') {
            return null;
        }

        return hash('sha256', json_encode([
            $driver, $host, (int) ($configuration['port'] ?? ($driver === 'pgsql' ? 5432 : 8123)), $database,
        ], JSON_THROW_ON_ERROR));
    }

    public static function validate(AnalyticsConnection $connection): void
    {
        $nameChanged = self::nameChanged($connection);
        $endpointChanged = self::endpointChanged($connection);
        if (! $nameChanged && ! $endpointChanged) {
            return;
        }

        $name = self::nameFingerprint($connection->name);
        $endpoint = self::endpointFingerprint($connection->driver, $connection->configuration ?? []);
        $errors = [];
        $query = $connection->newQuery()->where('owner_id', $connection->owner_id);
        if ($connection->exists) {
            $query->where($connection->getKeyName(), '<>', $connection->getKey());
        }
        foreach ($query->get() as $existing) {
            if ($nameChanged && self::nameFingerprint($existing->name) === $name) {
                $errors['name'] = self::nameMessage();
            }
            if ($endpointChanged && $endpoint !== null) {
                $existingEndpoint = $existing->endpoint_fingerprint;
                if ($existingEndpoint === null) {
                    try {
                        $existingEndpoint = self::endpointFingerprint($existing->driver, $existing->configuration ?? []);
                    } catch (DecryptException) {
                        // A legacy row with an unreadable configuration still reserves its name.
                        $existingEndpoint = null;
                    }
                }
                if ($existingEndpoint === $endpoint) {
                    $errors['configuration.database'] = self::endpointMessage();
                }
            }
        }
        if ($errors !== []) {
            throw ValidationException::withMessages($errors);
        }
    }

    public static function assignFingerprints(AnalyticsConnection $connection): void
    {
        if (self::nameChanged($connection)) {
            $connection->name_fingerprint = self::nameFingerprint($connection->name);
        }
        if (self::endpointChanged($connection)) {
            $connection->endpoint_fingerprint = self::endpointFingerprint($connection->driver, $connection->configuration ?? []);
        }
    }

    public static function nameChanged(AnalyticsConnection $connection): bool
    {
        return self::ownerChanged($connection)
            || self::nameFingerprint($connection->name) !== self::nameFingerprint((string) $connection->getOriginal('name'));
    }

    public static function endpointChanged(AnalyticsConnection $connection): bool
    {
        return self::ownerChanged($connection)
            || self::endpointFingerprint($connection->driver, $connection->configuration ?? []) !== self::endpointFingerprint(
                (string) $connection->getOriginal('driver'), (array) $connection->getOriginal('configuration'),
            );
    }

    private static function ownerChanged(AnalyticsConnection $connection): bool
    {
        return ! $connection->exists || (string) $connection->owner_id !== (string) $connection->getOriginal('owner_id');
    }

    public static function constraintFailure(UniqueConstraintViolationException $exception): ?ValidationException
    {
        // Recognize only our indexes; never expose the SQL/bindings in a DB exception.
        $message = $exception->getMessage();
        if (str_contains($message, 'analytics_connections_owner_name_unique')
            || str_contains($message, 'analytics_connections.owner_id, analytics_connections.name_fingerprint')) {
            return ValidationException::withMessages(['name' => self::nameMessage()]);
        }
        if (str_contains($message, 'analytics_connections_owner_endpoint_unique')
            || str_contains($message, 'analytics_connections.owner_id, analytics_connections.endpoint_fingerprint')) {
            return ValidationException::withMessages(['configuration.database' => self::endpointMessage()]);
        }

        return null;
    }

    private static function nameMessage(): string
    {
        return 'اتصالی با این نام از قبل برای شما ثبت شده است؛ نام دیگری انتخاب کنید.';
    }

    private static function endpointMessage(): string
    {
        return 'این پایگاه داده با همین نوع اتصال، میزبان و پورت قبلاً برای شما ثبت شده است؛ اتصال موجود را ویرایش کنید.';
    }
}
