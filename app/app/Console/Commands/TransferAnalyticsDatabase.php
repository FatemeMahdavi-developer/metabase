<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Database\Connection;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use RuntimeException;
use Throwable;

class TransferAnalyticsDatabase extends Command
{
    protected $signature = 'analytics:transfer-database
        {--source=legacy_sqlite : Configured read-only SQLite source connection}
        {--target=pgsql : Configured PostgreSQL destination connection}
        {--dry-run : Check the migrated, empty destination and show row counts without copying}';

    protected $description = 'Copy an existing SQLite application database into an empty, migrated PostgreSQL schema without changing the source';

    public function handle(): int
    {
        try {
            [$source, $target] = $this->connections();

            $source->transaction(function () use ($source, $target): void {
                $plan = $this->plan($source, $target);

                $this->table(['Table', 'Rows'], array_map(
                    fn (string $table): array => [$table, $plan['tables'][$table]['count']],
                    $plan['order'],
                ));

                if (isset($plan['tables']['analytics_connections']) &&
                    $source->table('analytics_connections')->where('driver', 'sqlite')->exists()) {
                    $this->warn('Legacy SQLite analytics connections are preserved unchanged. They are hidden from new-source selectors; create a PostgreSQL replacement for reports that still use them. External SQLite files are not copied.');
                }

                if ($this->option('dry-run')) {
                    foreach ($plan['order'] as $table) {
                        foreach ($source->table($table)->select($plan['tables'][$table]['columns'])->cursor() as $row) {
                            $this->prepareRow($table, $row);
                        }
                    }

                    $this->info('Dry run completed. No rows or sequences were changed.');

                    return;
                }

                $target->transaction(function () use ($source, $target, $plan): void {
                    // Also prevent a concurrent request/worker from filling a checked-empty table.
                    $target->statement("set local lock_timeout = '5s'");
                    $target->statement('lock table '.implode(', ', array_map(
                        fn (string $table): string => $this->qualified($plan['schema'], $table),
                        $plan['target_tables'],
                    )).' in access exclusive mode');
                    $this->assertEmpty($target, $plan['schema'], $plan['target_tables']);

                    foreach ($plan['order'] as $table) {
                        $columns = $plan['tables'][$table]['columns'];
                        $batch = [];
                        $batchSize = min(200, max(1, intdiv(60000, count($columns))));

                        foreach ($source->table($table)->select($columns)->orderBy($columns[0])->cursor() as $row) {
                            $batch[] = $this->prepareRow($table, $row);

                            if (count($batch) === $batchSize) {
                                $target->table($plan['schema'].'.'.$table)->insert($batch);
                                $batch = [];
                            }
                        }

                        if ($batch !== []) {
                            $target->table($plan['schema'].'.'.$table)->insert($batch);
                        }

                        if ($target->table($plan['schema'].'.'.$table)->count() !== $plan['tables'][$table]['count']) {
                            throw new RuntimeException("Row-count verification failed for table [{$table}].");
                        }
                    }

                    foreach ($plan['order'] as $table) {
                        $this->restartSequences($target, $plan['schema'], $table, $plan['tables'][$table]['columns']);
                    }
                });
            });

            if (! $this->option('dry-run')) {
                $this->info('Transfer completed. IDs, stored configuration and migration history were preserved. Keep the original APP_KEY to decrypt existing connections.');
            }

            return self::SUCCESS;
        } catch (RuntimeException $exception) {
            // PDO/QueryException messages can contain SQL, bound secrets or connection details.
            if ($exception instanceof \PDOException || $exception instanceof QueryException) {
                $this->error('Transfer failed. Destination row changes were rolled back. Check connectivity, destination permissions, column types and PostgreSQL server logs.');
            } else {
                $this->error($exception->getMessage());
            }

            return self::FAILURE;
        } catch (Throwable) {
            $this->error('Transfer failed. Destination row changes were rolled back. Check the source file, migrated destination schema and connection configuration.');

            return self::FAILURE;
        }
    }

    private function connections(): array
    {
        $sourceName = (string) $this->option('source');
        $targetName = (string) $this->option('target');

        foreach ([$sourceName, $targetName] as $name) {
            if ($name === '' || ! is_array(config('database.connections.'.$name))) {
                throw new RuntimeException('Both source and target must be configured Laravel database connections.');
            }
        }

        $source = DB::connection($sourceName);
        $target = DB::connection($targetName);

        if ($source->getDriverName() !== 'sqlite' || $target->getDriverName() !== 'pgsql') {
            throw new RuntimeException('The source must use SQLite and the target must use PostgreSQL.');
        }

        $sourceFile = $source->getDatabaseName();

        if ($sourceFile === ':memory:' || ! is_file($sourceFile) || ! is_readable($sourceFile)) {
            throw new RuntimeException('The source must be an existing, readable SQLite file. Set LEGACY_SQLITE_DATABASE to its absolute path.');
        }

        if ($source->getTablePrefix() !== '' || $target->getTablePrefix() !== '') {
            throw new RuntimeException('This transfer requires connections without table prefixes.');
        }

        return [$source, $target];
    }

    private function plan(Connection $source, Connection $target): array
    {
        $schema = $target->selectOne('select current_schema() as name')?->name;

        if (! is_string($schema) || $schema === '') {
            throw new RuntimeException('The PostgreSQL search_path must resolve to an existing writable schema.');
        }

        $this->assertIdentifier($schema);
        $migrationTable = config('database.migrations.table', 'migrations');
        $sourceSchema = $source->getSchemaBuilder();
        $targetSchema = $target->getSchemaBuilder();
        $sourceTables = array_column($sourceSchema->getTables('main'), 'name');
        $targetTables = array_column($targetSchema->getTables($schema), 'name');

        if (! in_array($migrationTable, $targetTables, true)) {
            throw new RuntimeException('Run php artisan migrate --database='.$this->option('target').' before transferring data.');
        }

        $sourceTables = array_values(array_filter($sourceTables, fn (string $table): bool => $table !== $migrationTable && ! str_starts_with($table, 'sqlite_')));
        $targetTables = array_values(array_filter($targetTables, fn (string $table): bool => $table !== $migrationTable));
        sort($sourceTables);
        sort($targetTables);

        if ($sourceTables === []) {
            throw new RuntimeException('The SQLite source has no application tables to transfer.');
        }

        foreach (array_merge($sourceTables, $targetTables) as $table) {
            $this->assertIdentifier($table);
        }

        $this->assertEmpty($target, $schema, $targetTables);
        $tables = [];
        $dependencies = [];

        foreach ($sourceTables as $table) {
            if (! in_array($table, $targetTables, true)) {
                throw new RuntimeException("Destination table [{$table}] is missing. Run the matching application migrations first.");
            }

            $sourceColumns = $sourceSchema->getColumnListing($table);
            $targetColumns = $targetSchema->getColumns($schema.'.'.$table);
            $targetNames = array_column($targetColumns, 'name');
            sort($sourceColumns);
            sort($targetNames);

            if ($sourceColumns !== $targetNames) {
                throw new RuntimeException("Source and destination columns differ for table [{$table}]. No rows were copied.");
            }

            $columns = array_values(array_map(
                fn (array $column): string => $column['name'],
                array_filter($targetColumns, fn (array $column): bool => empty($column['generation'])),
            ));

            if ($columns === []) {
                throw new RuntimeException("Table [{$table}] has no insertable columns.");
            }

            foreach ($columns as $column) {
                $this->assertIdentifier($column);
            }

            $tables[$table] = ['columns' => $columns, 'count' => $source->table($table)->count()];
            $dependencies[$table] = [];

            foreach ($targetSchema->getForeignKeys($schema.'.'.$table) as $foreignKey) {
                if (($foreignKey['foreign_schema'] ?? $schema) !== $schema) {
                    throw new RuntimeException("Cross-schema foreign keys are not supported by this transfer: [{$table}].");
                }

                if (in_array($foreignKey['foreign_table'], $sourceTables, true) && $tables[$table]['count'] > 0) {
                    $dependencies[$table][] = $foreignKey['foreign_table'];
                }
            }
        }

        $order = [];

        while ($dependencies !== []) {
            $ready = array_keys(array_filter($dependencies, fn (array $parents): bool => array_diff($parents, $order) === []));

            if ($ready === []) {
                throw new RuntimeException('The source contains cyclic or self-referencing foreign keys. No rows were copied; this schema needs a dedicated migration.');
            }

            foreach ($ready as $table) {
                $order[] = $table;
                unset($dependencies[$table]);
            }
        }

        return ['schema' => $schema, 'tables' => $tables, 'order' => $order, 'target_tables' => $targetTables];
    }

    private function assertEmpty(Connection $target, string $schema, array $tables): void
    {
        foreach ($tables as $table) {
            if ($target->table($schema.'.'.$table)->exists()) {
                throw new RuntimeException("Destination table [{$table}] is not empty. Existing data will not be overwritten or merged.");
            }
        }
    }

    private function prepareRow(string $table, object $row): array
    {
        $values = (array) $row;

        // Laravel stores SQLite batch options as raw PHP serialization, but its
        // PostgreSQL repository uses base64 to protect embedded NUL/binary bytes.
        // Preserve the serialization without instantiating any serialized objects.
        if ($table === config('queue.batching.table', 'job_batches') && is_string($values['options'] ?? null)) {
            $values['options'] = base64_encode($values['options']);
        }

        foreach ($values as $column => $value) {
            if (is_string($value) && str_contains($value, "\0")) {
                throw new RuntimeException("Unsupported NUL byte in [{$table}.{$column}]. Destination row changes were rolled back. This field requires a dedicated PostgreSQL-safe conversion.");
            }
        }

        return $values;
    }

    private function restartSequences(Connection $target, string $schema, string $table, array $columns): void
    {
        foreach ($columns as $column) {
            $sequence = $target->selectOne(
                'select n.nspname as schema_name, c.relname as sequence_name from pg_class c join pg_namespace n on n.oid = c.relnamespace where c.oid = pg_get_serial_sequence(?, ?)::regclass',
                [$this->qualified($schema, $table), $column],
            );

            if ($sequence === null) {
                continue;
            }

            $maximum = $target->table($schema.'.'.$table)->max($column);

            if ($maximum !== null && (! is_numeric($maximum) || $maximum >= PHP_INT_MAX)) {
                throw new RuntimeException("Sequence limit exceeded for table [{$table}].");
            }

            $next = max(1, (int) $maximum + 1);
            // PostgreSQL RESTART is transactional; setval() would survive a rollback.
            $target->statement('alter sequence '.$this->qualified($sequence->schema_name, $sequence->sequence_name).' restart with '.$next);
        }
    }

    private function assertIdentifier(string $identifier): void
    {
        if (! preg_match('/\A[A-Za-z_][A-Za-z0-9_]*\z/D', $identifier)) {
            throw new RuntimeException('This application-data transfer supports simple schema, table and column identifiers only.');
        }
    }

    private function qualified(string $schema, string $name): string
    {
        return '"'.str_replace('"', '""', $schema).'"."'.str_replace('"', '""', $name).'"';
    }
}
