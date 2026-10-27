<?php

namespace Tests\Feature;

use Illuminate\Bus\BatchFactory;
use Illuminate\Bus\DatabaseBatchRepository;
use Illuminate\Bus\PendingBatch;
use Illuminate\Cache\DatabaseStore;
use Illuminate\Database\PostgresConnection;
use Illuminate\Database\SQLiteConnection;
use Illuminate\Support\Facades\DB;
use PDO;
use Tests\TestCase;

class AnalyticsDatabaseTransferTest extends TestCase
{
    private array $files = [];

    private TransferPostgresRecordingConnection $target;

    protected function setUp(): void
    {
        parent::setUp();

        foreach (['transfer_source', 'transfer_target'] as $name) {
            $path = tempnam(sys_get_temp_dir(), 'analytics-transfer-');
            $this->files[] = $path;
            config()->set('database.connections.'.$name, [
                'driver' => $name === 'transfer_source' ? 'sqlite' : 'pgsql',
                'database' => $path,
                'prefix' => '',
                'foreign_key_constraints' => true,
            ]);
        }

        // Real SQLite storage/constraints/transactions; only PostgreSQL-specific
        // introspection, locks and sequence DDL are recorded. No live PG is claimed.
        DB::extend('transfer_target', function (array $config, string $name): TransferPostgresRecordingConnection {
            $config['name'] = $name;
            $pdo = new PDO('sqlite:'.$config['database']);
            $pdo->exec('PRAGMA foreign_keys = ON');

            return $this->target = new TransferPostgresRecordingConnection($pdo, $config['database'], '', $config);
        });

        foreach (['transfer_source', 'transfer_target'] as $name) {
            $this->artisan('migrate', ['--database' => $name, '--force' => true])->assertSuccessful();
        }
    }

    protected function tearDown(): void
    {
        foreach (['transfer_source', 'transfer_target'] as $name) {
            DB::purge($name);
        }

        foreach ($this->files as $file) {
            if (is_file($file)) {
                unlink($file);
            }
        }

        parent::tearDown();
    }

    private function transferOptions(array $overrides = []): array
    {
        return array_replace(['--source' => 'transfer_source', '--target' => 'transfer_target'], $overrides);
    }

    private function seedSource(): array
    {
        $source = DB::connection('transfer_source');
        $ciphertext = encrypt(['host' => 'source_db', 'password' => 'keep-this-encrypted']);
        $source->table('users')->insert([
            'id' => 71, 'name' => 'Dashboard owner', 'email' => 'transfer@example.test',
            'password' => 'existing-password-hash', 'created_at' => '2026-10-11 12:13:14',
        ]);
        $source->table('analytics_folders')->insert(['id' => 91, 'owner_id' => 71, 'name' => 'Existing reports']);
        $source->table('analytics_connections')->insert([
            'id' => 103, 'owner_id' => 71, 'name' => 'Private PostgreSQL', 'driver' => 'pgsql',
            'configuration' => $ciphertext,
            'catalog' => '[{"key":"public.events","fields":[{"key":"event_id"}]}]',
            'metadata' => '{"tables":{"public.events":{"name":{"fa":"رخدادها"}}}}',
        ]);
        $source->table('analytics_reports')->insert([
            'id' => 121, 'owner_id' => 71, 'folder_id' => 91, 'name' => 'Stored report',
            'query_definition' => '{"source":{"connection_id":103,"table":"public.events"}}',
            'display' => 'donut', 'visualization_settings' => '{"colors":["#6248FF"]}',
        ]);
        $source->table('analytics_dashboards')->insert([
            'id' => 144, 'owner_id' => 71, 'folder_id' => 91, 'name' => 'Stored dashboard', 'settings' => '{}',
        ]);
        $source->table('analytics_dashboard_tabs')->insert(['id' => 155, 'dashboard_id' => 144, 'key' => 'main', 'name' => 'Main', 'position' => 0]);
        $source->table('analytics_dashboard_widgets')->insert([
            'id' => 166, 'dashboard_id' => 144, 'report_id' => 121, 'key' => 'widget-1',
            'tab_key' => 'main', 'type' => 'report', 'x' => 0, 'y' => 0, 'w' => 6, 'h' => 4,
            'settings' => '{}', 'click_behavior' => '{"type":"drill"}',
        ]);
        $source->table('analytics_dashboard_filters')->insert([
            'id' => 177, 'dashboard_id' => 144, 'key' => 'category', 'label' => 'Category',
            'type' => 'text', 'required' => 1, 'position' => 0, 'settings' => '{}',
        ]);
        $source->table('analytics_filter_bindings')->insert(['id' => 188, 'filter_id' => 177, 'widget_id' => 166, 'target' => 'category', 'operator' => '=']);
        $source->table('sessions')->insert(['id' => 'existing-session', 'user_id' => 71, 'payload' => 'unchanged-session', 'last_activity' => 1234]);
        $source->table('cache')->insert(['key' => 'cached-key', 'value' => 'serialized-value', 'expiration' => 9876]);
        $source->table('jobs')->insert(['id' => 201, 'queue' => 'default', 'payload' => '{}', 'attempts' => 0, 'available_at' => 1, 'created_at' => 1]);

        return ['ciphertext' => $ciphertext, 'hash' => hash_file('sha256', $this->files[0])];
    }

    public function test_transfers_related_application_rows_preserving_ids_ciphertext_json_and_migration_history(): void
    {
        $before = $this->seedSource();
        $this->target->table('migrations')->update(['batch' => 42]);
        $migrationHistory = $this->target->table('migrations')->get()->map(fn (object $row): array => (array) $row)->all();
        $defaultConnection = DB::getDefaultConnection();

        $this->artisan('analytics:transfer-database', $this->transferOptions())->assertSuccessful();

        foreach (DB::connection('transfer_source')->getSchemaBuilder()->getTableListing('main', false) as $table) {
            if ($table === 'migrations' || str_starts_with($table, 'sqlite_')) {
                continue;
            }

            $this->assertEquals(
                DB::connection('transfer_source')->table($table)->get()->toArray(),
                $this->target->table($table)->get()->toArray(),
                'Raw stored rows changed during transfer: '.$table,
            );
        }

        $this->assertSame($before['ciphertext'], $this->target->table('analytics_connections')->value('configuration'));
        $this->assertSame('keep-this-encrypted', decrypt($this->target->table('analytics_connections')->value('configuration'))['password']);
        $this->assertSame($migrationHistory, $this->target->table('migrations')->get()->map(fn (object $row): array => (array) $row)->all());
        $this->assertSame($before['hash'], hash_file('sha256', $this->files[0]));
        $this->assertSame($defaultConnection, DB::getDefaultConnection());
        $this->assertContains('alter sequence "main"."users_id_seq" restart with 72', $this->target->postgresStatements);
        $this->assertContains('alter sequence "main"."jobs_id_seq" restart with 202', $this->target->postgresStatements);
        $this->assertContains('alter sequence "main"."analytics_reports_id_seq" restart with 122', $this->target->postgresStatements);
        $this->assertContains('alter sequence "main"."analytics_records_id_seq" restart with 1', $this->target->postgresStatements);
        $this->assertContains(['"main"."analytics_reports"', 'id'], $this->target->sequenceBindings);
        $this->assertTrue(collect($this->target->postgresStatements)->contains(fn (string $sql): bool => str_starts_with($sql, 'lock table ') && str_ends_with($sql, ' in access exclusive mode')));
        $this->assertSame(0, DB::connection('transfer_source')->transactionLevel());
        $this->assertSame(0, $this->target->transactionLevel());
    }

    public function test_dry_run_validates_and_counts_without_inserting_or_resetting_sequences(): void
    {
        $before = $this->seedSource();

        $this->artisan('analytics:transfer-database', $this->transferOptions(['--dry-run' => true]))
            ->expectsOutputToContain('Dry run completed')
            ->assertSuccessful();

        $this->assertSame(0, $this->target->table('users')->count());
        $this->assertSame(0, $this->target->table('analytics_reports')->count());
        $this->assertSame([], $this->target->postgresStatements);
        $this->assertSame([], $this->target->sequenceBindings);
        $this->assertSame($before['hash'], hash_file('sha256', $this->files[0]));
    }

    public function test_nonempty_destination_is_rejected_before_any_rows_are_copied_and_reruns_are_safe(): void
    {
        $this->seedSource();
        $this->target->table('cache')->insert(['key' => 'production-data', 'value' => 'keep', 'expiration' => 999]);

        $this->artisan('analytics:transfer-database', $this->transferOptions())
            ->expectsOutputToContain('not empty')
            ->assertFailed();

        $this->assertSame('keep', $this->target->table('cache')->value('value'));
        $this->assertSame(0, $this->target->table('users')->count());
        $this->assertSame([], $this->target->postgresStatements);
    }

    public function test_missing_destination_table_aborts_before_writes(): void
    {
        $this->seedSource();
        $this->target->getSchemaBuilder()->drop('analytics_connections');

        $this->artisan('analytics:transfer-database', $this->transferOptions())
            ->expectsOutputToContain('Destination table [analytics_connections] is missing')
            ->assertFailed();

        $this->assertSame(0, $this->target->table('users')->count());
        $this->assertSame([], $this->target->postgresStatements);
    }

    public function test_different_columns_are_reported_before_writes(): void
    {
        $this->seedSource();
        $this->target->getSchemaBuilder()->table('users', fn ($table) => $table->string('extra_column')->nullable());

        $this->artisan('analytics:transfer-database', $this->transferOptions())
            ->expectsOutputToContain('columns differ for table [users]')
            ->assertFailed();

        $this->assertSame(0, $this->target->table('users')->count());
        $this->assertSame([], $this->target->postgresStatements);
    }

    public function test_constraint_failure_rolls_back_previously_copied_tables_and_hides_payloads(): void
    {
        $before = $this->seedSource();
        $source = DB::connection('transfer_source');
        $source->statement('PRAGMA foreign_keys = OFF');
        $source->table('analytics_reports')->update(['owner_id' => 9999]);
        $source->statement('PRAGMA foreign_keys = ON');
        $this->target->enableQueryLog();

        $this->artisan('analytics:transfer-database', $this->transferOptions())
            ->expectsOutputToContain('Destination row changes were rolled back')
            ->doesntExpectOutputToContain('keep-this-encrypted')
            ->doesntExpectOutputToContain($before['ciphertext'])
            ->assertFailed();

        $this->assertTrue(collect($this->target->getQueryLog())->contains(fn (array $query): bool => str_starts_with($query['query'], 'insert into "main"."users"')));
        $this->assertSame(0, $this->target->table('users')->count());
        $this->assertSame(0, $this->target->table('analytics_folders')->count());
        $this->assertSame(0, $this->target->table('analytics_connections')->count());
        $this->assertSame(71, $source->table('users')->value('id'));
        $this->assertSame(9999, $source->table('analytics_reports')->value('owner_id'));
        $this->assertFalse(collect($this->target->postgresStatements)->contains(fn (string $sql): bool => str_starts_with($sql, 'alter sequence ')));
    }

    public function test_wrong_connection_types_unknown_connections_and_missing_source_file_are_rejected(): void
    {
        $this->artisan('analytics:transfer-database', $this->transferOptions(['--target' => 'transfer_source']))
            ->expectsOutputToContain('target must use PostgreSQL')->assertFailed();
        $this->artisan('analytics:transfer-database', $this->transferOptions(['--source' => 'unknown_source']))
            ->expectsOutputToContain('configured Laravel database connections')->assertFailed();
        $missing = sys_get_temp_dir().'/analytics-missing-'.bin2hex(random_bytes(8)).'.sqlite';
        config()->set('database.connections.missing_legacy', ['driver' => 'sqlite', 'database' => $missing, 'prefix' => '']);

        $this->artisan('analytics:transfer-database', $this->transferOptions(['--source' => 'missing_legacy']))
            ->expectsOutputToContain('existing, readable SQLite file')->assertFailed();

        $this->assertFileDoesNotExist($missing);
        $this->assertSame([], $this->target->postgresStatements);
        DB::purge('missing_legacy');
    }

    public function test_legacy_sqlite_sources_are_preserved_with_an_explicit_warning(): void
    {
        $this->seedSource();
        $source = DB::connection('transfer_source');
        $source->table('analytics_connections')->update(['driver' => 'sqlite']);

        $this->artisan('analytics:transfer-database', $this->transferOptions())
            ->expectsOutputToContain('Legacy SQLite analytics connections are preserved unchanged. They are hidden from new-source selectors; create a PostgreSQL replacement for reports that still use them. External SQLite files are not copied.')
            ->assertSuccessful();

        $this->assertSame('sqlite', $this->target->table('analytics_connections')->value('driver'));
        $this->assertSame($source->table('analytics_connections')->value('configuration'), $this->target->table('analytics_connections')->value('configuration'));
    }

    public function test_rows_larger_than_one_insert_batch_are_all_copied_without_a_default_500_row_report_limit(): void
    {
        $this->seedSource();
        $source = DB::connection('transfer_source');

        foreach (array_chunk(range(1000, 1600), 100) as $ids) {
            $source->table('analytics_records')->insert(array_map(fn (int $id): array => [
                'id' => $id, 'owner_id' => 71, 'ordered_at' => '2026-10-11',
                'category' => 'event-'.$id, 'city' => 'Tehran', 'status' => 'active',
                'amount' => '112.75', 'quantity' => 3, 'customer' => 'Existing customer',
            ], $ids));
        }

        $this->artisan('analytics:transfer-database', $this->transferOptions())->assertSuccessful();

        $this->assertSame(601, $this->target->table('analytics_records')->count());
        $this->assertEquals($source->table('analytics_records')->orderBy('id')->get()->all(), $this->target->table('analytics_records')->orderBy('id')->get()->all());
        $this->assertContains('alter sequence "main"."analytics_records_id_seq" restart with 1601', $this->target->postgresStatements);
    }

    public function test_an_unmigrated_target_is_rejected_even_for_a_dry_run(): void
    {
        $this->seedSource();
        $this->target->getSchemaBuilder()->drop('migrations');

        $this->artisan('analytics:transfer-database', $this->transferOptions(['--dry-run' => true]))
            ->expectsOutputToContain('Run php artisan migrate --database=transfer_target')
            ->assertFailed();

        $this->assertSame(0, $this->target->table('users')->count());
        $this->assertSame([], $this->target->postgresStatements);
    }

    public function test_a_nonempty_destination_is_rejected_during_dry_run_too(): void
    {
        $this->seedSource();
        $this->target->table('cache')->insert(['key' => 'keep-cache', 'value' => 'keep-value', 'expiration' => 2]);

        $this->artisan('analytics:transfer-database', $this->transferOptions(['--dry-run' => true]))
            ->expectsOutputToContain('not empty')
            ->assertFailed();

        $this->assertSame('keep-value', $this->target->table('cache')->value('value'));
        $this->assertSame([], $this->target->postgresStatements);
    }

    public function test_self_referencing_rows_require_a_dedicated_transfer_instead_of_disabling_constraints(): void
    {
        $this->seedSource();

        foreach (['transfer_source', 'transfer_target'] as $name) {
            DB::connection($name)->getSchemaBuilder()->create('custom_tree', function ($table): void {
                $table->id();
                $table->foreignId('parent_id')->nullable()->constrained('custom_tree');
            });
        }

        DB::connection('transfer_source')->table('custom_tree')->insert(['id' => 1, 'parent_id' => null]);

        $this->artisan('analytics:transfer-database', $this->transferOptions())
            ->expectsOutputToContain('cyclic or self-referencing foreign keys')
            ->assertFailed();

        $this->assertSame(0, $this->target->table('users')->count());
        $this->assertSame(0, $this->target->table('custom_tree')->count());
        $this->assertSame([], $this->target->postgresStatements);
    }

    public function test_laravel_batch_options_are_encoded_for_postgres_and_cache_objects_remain_readable(): void
    {
        $this->seedSource();
        $source = DB::connection('transfer_source');
        $factory = $this->app->make(BatchFactory::class);
        $sourceRepository = new DatabaseBatchRepository($factory, $source, 'job_batches');
        $pending = new PendingBatch($this->app, collect());
        $pending->name = 'Existing callback batch';
        $pending->options = ['state' => new TransferBatchOption('protected-property-value'), 'label' => 'retain options'];
        $batch = $sourceRepository->store($pending);
        $rawOptions = $source->table('job_batches')->where('id', $batch->id)->value('options');
        $this->assertStringContainsString("\0", $rawOptions);
        $sourceCache = new DatabaseStore($source, 'cache');
        $sourceCache->put('object-cache', new TransferBatchOption('cached-protected-value'), 3600);
        $rawCache = $source->table('cache')->where('key', 'object-cache')->value('value');
        $this->assertStringNotContainsString("\0", $rawCache);
        $sourceHash = hash_file('sha256', $this->files[0]);

        $this->artisan('analytics:transfer-database', $this->transferOptions(['--dry-run' => true]))->assertSuccessful();
        $this->assertSame(0, $this->target->table('job_batches')->count());
        $this->assertSame($sourceHash, hash_file('sha256', $this->files[0]));
        $this->artisan('analytics:transfer-database', $this->transferOptions())->assertSuccessful();

        $storedOptions = $this->target->table('job_batches')->where('id', $batch->id)->value('options');
        $this->assertSame(base64_encode($rawOptions), $storedOptions);
        $this->assertStringNotContainsString("\0", $storedOptions);
        $this->assertSame($rawCache, $this->target->table('cache')->where('key', 'object-cache')->value('value'));

        // Exercise Laravel's real instanceof PostgresConnection decode branch,
        // using SQLite PDO storage because a live PostgreSQL server is unavailable.
        $postgresReader = new PostgresConnection($this->target->getPdo(), $this->files[1], '', ['driver' => 'pgsql']);

        try {
            $targetRepository = new DatabaseBatchRepository($factory, $postgresReader, 'job_batches');
            $restored = $targetRepository->find($batch->id);
            $this->assertSame('Existing callback batch', $restored->name);
            $this->assertSame('retain options', $restored->options['label']);
            $this->assertInstanceOf(TransferBatchOption::class, $restored->options['state']);
            $this->assertSame('protected-property-value', $restored->options['state']->value());
            $this->assertSame('cached-protected-value', (new DatabaseStore($postgresReader, 'cache'))->get('object-cache')->value());
            $this->assertSame($rawOptions, $source->table('job_batches')->where('id', $batch->id)->value('options'));
            $this->assertSame($sourceHash, hash_file('sha256', $this->files[0]));
        } finally {
            $postgresReader->disconnect();
        }
    }

    public function test_other_embedded_nul_values_abort_in_dry_run_and_roll_back_real_transfer_without_leaking_data(): void
    {
        $this->seedSource();
        $source = DB::connection('transfer_source');
        $secretValue = "private-value\0that-must-not-be-truncated";
        $source->table('users')->update(['name' => $secretValue]);
        $sourceHash = hash_file('sha256', $this->files[0]);
        $this->target->enableQueryLog();

        foreach ([true, false] as $dryRun) {
            $this->artisan('analytics:transfer-database', $this->transferOptions(['--dry-run' => $dryRun]))
                ->expectsOutputToContain('Unsupported NUL byte in [users.name]')
                ->doesntExpectOutputToContain('private-value')
                ->doesntExpectOutputToContain('that-must-not-be-truncated')
                ->assertFailed();

            $this->assertSame(0, $this->target->table('users')->count());
            $this->assertSame(0, $this->target->table('cache')->count());
            $this->assertSame(0, $this->target->table('jobs')->count());
            $this->assertSame($secretValue, $source->table('users')->value('name'));
            $this->assertSame($sourceHash, hash_file('sha256', $this->files[0]));
        }

        // Independent tables were inserted before encountering users, so these
        // empty counts verify a real rollback rather than only an early guard.
        $this->assertTrue(collect($this->target->getQueryLog())->contains(fn (array $query): bool => str_starts_with($query['query'], 'insert into "main"."cache"')));
        $this->assertFalse(collect($this->target->postgresStatements)->contains(fn (string $sql): bool => str_starts_with($sql, 'alter sequence ')));
    }
}

class TransferBatchOption
{
    public function __construct(protected string $storedValue) {}

    public function value(): string
    {
        return $this->storedValue;
    }
}

/** A recording adapter, not a live PostgreSQL integration test. */
class TransferPostgresRecordingConnection extends SQLiteConnection
{
    public array $postgresStatements = [];

    public array $sequenceBindings = [];

    public function selectOne($query, $bindings = [], $useReadPdo = true)
    {
        if ($query === 'select current_schema() as name') {
            return (object) ['name' => 'main'];
        }

        if (str_contains($query, 'pg_get_serial_sequence(?, ?)')) {
            $this->sequenceBindings[] = $bindings;
            $table = str_replace('"', '', $bindings[0]);
            $column = collect($this->getSchemaBuilder()->getColumns($table))->firstWhere('name', $bindings[1]);

            return $column['auto_increment']
                ? (object) ['schema_name' => 'main', 'sequence_name' => substr($table, strlen('main.')).'_'.$bindings[1].'_seq']
                : null;
        }

        return parent::selectOne($query, $bindings, $useReadPdo);
    }

    public function statement($query, $bindings = [])
    {
        if (str_starts_with($query, 'set local ') || str_starts_with($query, 'lock table ') || str_starts_with($query, 'alter sequence ')) {
            $this->postgresStatements[] = $query;

            return true;
        }

        return parent::statement($query, $bindings);
    }
}
