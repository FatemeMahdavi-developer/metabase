<?php

namespace App\Domain\Analytics\Drivers;

use PDO;
use RuntimeException;

class PostgresDriver implements DatabaseDriver
{
    private PDO $pdo;

    public function __construct(array $configuration)
    {
        if (! in_array('pgsql', PDO::getAvailableDrivers())) {
            throw new RuntimeException('افزونهٔ pdo_pgsql در PHP فعال نیست.');
        }
        foreach (['host', 'database', 'username'] as $key) {
            if (preg_match('/[;\r\n\x00]/', $configuration[$key] ?? '')) {
                throw new RuntimeException('تنظیمات اتصال معتبر نیست.');
            }
        }
        $port = (int) ($configuration['port'] ?? 5432);
        $ssl = $configuration['sslmode'] ?? 'prefer';
        if (! in_array($ssl, ['disable', 'prefer', 'require', 'verify-full'])) {
            throw new RuntimeException('حالت SSL معتبر نیست.');
        }
        $dsn = "pgsql:host={$configuration['host']};port=$port;dbname={$configuration['database']};sslmode=$ssl;connect_timeout=5";
        $this->pdo = new PDO($dsn, $configuration['username'], $configuration['password'] ?? '', [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC, PDO::ATTR_EMULATE_PREPARES => false]);
        $this->pdo->exec('SET default_transaction_read_only = on');
        $this->pdo->exec('SET statement_timeout = 10000');
    }

    public function catalog(): array
    {
        $tables = $this->select("SELECT table_schema, table_name, table_type FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog', 'information_schema') ORDER BY table_schema, table_name");

        return array_map(function ($table) {
            $fields = $this->select('SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_schema = :schema AND table_name = :table ORDER BY ordinal_position', ['schema' => $table['table_schema'], 'table' => $table['table_name']]);
            $keys = $this->select('SELECT a.attname AS column_name FROM pg_index i JOIN pg_class c ON c.oid=i.indrelid JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum=ANY(i.indkey) WHERE i.indisprimary AND n.nspname=:schema AND c.relname=:table', ['schema' => $table['table_schema'], 'table' => $table['table_name']]);
            // pg_catalog also exposes FK metadata to accounts with SELECT-only access.
            $relations = $this->select("SELECT c.oid AS constraint_id, a.attname AS column_name, rn.nspname AS target_schema, r.relname AS target_table, ra.attname AS target_column
                FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace
                JOIN pg_class r ON r.oid=c.confrelid JOIN pg_namespace rn ON rn.oid=r.relnamespace
                JOIN LATERAL unnest(c.conkey) WITH ORDINALITY AS k(attnum, ordinality) ON TRUE
                JOIN LATERAL unnest(c.confkey) WITH ORDINALITY AS rk(attnum, ordinality) ON rk.ordinality=k.ordinality
                JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum=k.attnum
                JOIN pg_attribute ra ON ra.attrelid=r.oid AND ra.attnum=rk.attnum
                WHERE c.contype='f' AND n.nspname=:schema AND t.relname=:table", ['schema' => $table['table_schema'], 'table' => $table['table_name']]);

            return ['key' => $table['table_schema'].'.'.$table['table_name'], 'label' => $table['table_name'], 'schema' => $table['table_schema'], 'kind' => strtolower($table['table_type']), 'fields' => array_map(function ($field) use ($keys, $relations) {
                $relation = collect($relations)->firstWhere('column_name', $field['column_name']);

                $target = $relation ? ['table' => $relation['target_schema'].'.'.$relation['target_table'], 'field' => $relation['target_column']] : null;
                if ($relation && collect($relations)->where('constraint_id', $relation['constraint_id'])->count() > 1) {
                    $target['composite'] = true;
                }

                return ['key' => $field['column_name'], 'label' => $field['column_name'], 'raw_type' => $field['data_type'], 'type' => ConnectionManager::fieldType($field['data_type']), 'nullable' => $field['is_nullable'] === 'YES', 'primary' => in_array($field['column_name'], array_column($keys, 'column_name')), 'relation' => $target];
            }, $fields)];
        }, $tables);
    }

    public function select(string $sql, array $bindings = []): array
    {
        $statement = $this->pdo->prepare($sql);
        foreach ($bindings as $key => $value) {
            $type = match (true) {
                $value === null => PDO::PARAM_NULL,
                is_bool($value) => PDO::PARAM_BOOL,
                is_int($value) => PDO::PARAM_INT,
                default => PDO::PARAM_STR,
            };
            $statement->bindValue(is_int($key) ? $key + 1 : ':'.ltrim($key, ':'), $value, $type);
        }
        $statement->execute();

        return $statement->fetchAll();
    }
}
