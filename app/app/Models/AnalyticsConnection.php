<?php

namespace App\Models;

use App\Domain\Analytics\ConnectionUniqueness;
use App\Domain\Analytics\MetadataLabels;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\UniqueConstraintViolationException;

class AnalyticsConnection extends Model
{
    protected $guarded = ['id'];

    protected $hidden = ['configuration', 'name_fingerprint', 'endpoint_fingerprint'];

    protected static function booted(): void
    {
        static::saving(function (self $connection): void {
            ConnectionUniqueness::validate($connection);
            ConnectionUniqueness::assignFingerprints($connection);
        });
    }

    public function save(array $options = [])
    {
        try {
            return parent::save($options);
        } catch (UniqueConstraintViolationException $exception) {
            throw ConnectionUniqueness::constraintFailure($exception) ?? $exception;
        }
    }

    public function isSupported(): bool
    {
        return in_array($this->driver, config('analytics.connection_drivers'), true);
    }

    protected function casts(): array
    {
        return ['configuration' => 'encrypted:array', 'catalog' => 'array', 'metadata' => 'array', 'synced_at' => 'datetime'];
    }

    public function displayCatalog(?array $catalog = null): array
    {
        return MetadataLabels::catalog(
            $catalog ?? $this->catalog ?? [],
            $this->metadata ?? [],
            $this->driver === 'pgsql' ? ($this->configuration['database'] ?? null) : null,
        );
    }

    public function publicData(): array
    {
        $configuration = $this->configuration;
        unset($configuration['password']);

        $data = $this->toArray();
        if (is_array($data['catalog'] ?? null)) {
            $data['catalog'] = $this->displayCatalog($data['catalog']);
        }

        return [...$data, 'configuration' => $configuration, 'has_password' => ! empty($this->configuration['password'])];
    }
}
