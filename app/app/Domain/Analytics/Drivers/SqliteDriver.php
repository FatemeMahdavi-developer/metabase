<?php

namespace App\Domain\Analytics\Drivers;

use PDO;
use RuntimeException;

class SqliteDriver implements DatabaseDriver
{
    private PDO $pdo;

    public function __construct(array $configuration)
    {
        $path = realpath($configuration['path'] ?? '');
        if (! $path || ! is_file($path) || ! is_readable($path)) {
            throw new RuntimeException('فایل SQLite پیدا نشد یا قابل خواندن نیست.');
        }
        $applicationDatabase = realpath(config('database.connections.sqlite.database'));
        if ($applicationDatabase && (DIRECTORY_SEPARATOR === '\\' ? strcasecmp($path, $applicationDatabase) === 0 : $path === $applicationDatabase)) {
            throw new RuntimeException('دیتابیس داخلی برنامه نمی‌تواند منبع تحلیل باشد. یک دیتابیس مستقل انتخاب کنید.');
        }
        $handle = fopen($path, 'rb');
        $header = fread($handle, 16);
        fclose($handle);
        if ($header !== "SQLite format 3\0") {
            throw new RuntimeException('فایل انتخاب‌شده یک دیتابیس SQLite معتبر نیست.');
        }
        $this->pdo = new PDO('sqlite:'.$path, null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]);
        $this->pdo->exec('PRAGMA query_only = ON');
        $this->pdo->exec('PRAGMA busy_timeout = 5000');
    }

    public function catalog(): array
    {
        $tables = $this->select("SELECT name, type FROM sqlite_master WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%' ORDER BY name");

        return array_map(function ($table) {
            $name = $table['name'];
            $quoted = '"'.str_replace('"', '""', $name).'"';
            $relations = $this->select('PRAGMA foreign_key_list('.$quoted.')');
            $fields = array_map(function ($column) use ($relations) {
                $relation = collect($relations)->firstWhere('from', $column['name']);

                $target = $relation ? ['table' => $relation['table'], 'field' => $relation['to']] : null;
                if ($relation && collect($relations)->where('id', $relation['id'])->count() > 1) {
                    $target['composite'] = true;
                }

                return ['key' => $column['name'], 'label' => $column['name'], 'raw_type' => $column['type'], 'type' => ConnectionManager::fieldType($column['type']), 'nullable' => ! $column['notnull'] && ! $column['pk'], 'primary' => (bool) $column['pk'], 'relation' => $target];
            }, $this->select('PRAGMA table_info('.$quoted.')'));

            return ['key' => $name, 'label' => $name, 'schema' => 'main', 'kind' => $table['type'], 'fields' => $fields];
        }, $tables);
    }

    public function select(string $sql, array $bindings = []): array
    {
        $statement = $this->pdo->prepare($sql);
        foreach ($bindings as $key => $value) {
            $type = match (true) {
                $value === null => PDO::PARAM_NULL,
                is_int($value), is_bool($value) => PDO::PARAM_INT,
                default => PDO::PARAM_STR,
            };
            $statement->bindValue(is_int($key) ? $key + 1 : ':'.ltrim($key, ':'), is_bool($value) ? (int) $value : $value, $type);
        }
        $statement->execute();

        return $statement->fetchAll();
    }
}
