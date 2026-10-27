<?php

namespace Tests\Feature;

use App\Domain\Analytics\Drivers\ConnectionManager;
use App\Models\AnalyticsConnection;
use App\Models\User;
use Database\Seeders\AnalyticsPostgresSeeder;
use Filament\Facades\Filament;
use Filament\Panel;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;
use Mockery\MockInterface;
use Tests\TestCase;

class AnalyticsPostgresSeederTest extends TestCase
{
    use RefreshDatabase;

    private User $owner;

    private array $options = [];

    private array $profile = [
        'driver' => 'pgsql',
        'host' => 'db',
        'port' => 5432,
        'database' => 'soar_app',
        'username' => 'soar-reader',
        'password' => 'seed-only-secret',
        'charset' => 'utf8',
        'prefix' => '',
        'search_path' => 'public',
        'sslmode' => 'prefer',
    ];

    private array $catalog = [[
        'key' => 'public.incidents',
        'name' => 'incidents',
        'schema' => 'public',
        'kind' => 'table',
        'fields' => [
            ['key' => 'id', 'name' => 'id', 'type' => 'number', 'raw_type' => 'bigint', 'primary' => true],
            ['key' => 'severity', 'name' => 'severity', 'type' => 'text', 'raw_type' => 'text'],
        ],
    ]];

    protected function setUp(): void
    {
        parent::setUp();

        Filament::setCurrentPanel(null);
        $this->owner = User::factory()->create();
        $this->setProfile($this->profile);
    }

    private function setProfile(array $profile): void
    {
        DB::purge('pgsql');
        config()->set('database.connections.pgsql', $profile);
    }

    private function manager(): MockInterface
    {
        return $this->mock(ConnectionManager::class);
    }

    private function runSeeder(): void
    {
        $seeder = $this->app->make(AnalyticsPostgresSeeder::class);
        $seeder->options = array_replace($seeder->options, $this->options);
        $seeder->run();
    }

    private function invalidSeeder(): ValidationException
    {
        try {
            $this->runSeeder();
        } catch (ValidationException $exception) {
            $this->assertNotEmpty($exception->errors());
            $this->assertStringNotContainsString('seed-only-secret', $exception->getMessage());
            $this->assertStringNotContainsString('url-only-secret', $exception->getMessage());

            return $exception;
        }

        $this->fail('The invalid PostgreSQL source or owner was accepted.');
    }

    private function assertOnlyConnectionArtifacts(int $count): void
    {
        $this->assertDatabaseCount('analytics_connections', $count);
        foreach (['analytics_folders', 'analytics_reports', 'analytics_dashboards', 'analytics_dashboard_widgets', 'analytics_dashboard_revisions'] as $table) {
            $this->assertDatabaseCount($table, 0);
        }
    }

    public function test_default_profile_creates_an_encrypted_source_and_syncs_before_the_write_transaction(): void
    {
        $transactionLevel = DB::connection()->transactionLevel();
        $this->manager()->shouldReceive('catalog')->once()->withArgs(function (AnalyticsConnection $connection) use ($transactionLevel) {
            $this->assertFalse($connection->exists);
            $this->assertSame($this->owner->id, $connection->owner_id);
            $this->assertSame('pgsql', $connection->driver);
            $this->assertSame('db', $connection->configuration['host']);
            $this->assertSame('soar_app', $connection->configuration['database']);
            $this->assertSame('seed-only-secret', $connection->configuration['password']);
            $this->assertSame($transactionLevel, DB::connection()->transactionLevel());

            return true;
        })->andReturn($this->catalog);

        $this->runSeeder();

        $connection = AnalyticsConnection::sole();
        $this->assertSame('unisq', $connection->name);
        $this->assertSame('pgsql', $connection->driver);
        $this->assertSame('pgsql', $connection->metadata['_postgres_seed_profile']);
        $this->assertSame($this->catalog, $connection->catalog);
        $this->assertNotNull($connection->synced_at);
        $this->assertSame('prefer', $connection->configuration['sslmode']);
        $this->assertSame(5432, (int) $connection->configuration['port']);
        $this->assertStringNotContainsString('seed-only-secret', $connection->getRawOriginal('configuration'));
        $this->assertStringNotContainsString('seed-only-secret', json_encode($connection->publicData()));
        $this->assertInstanceOf(\Closure::class, DB::connection('pgsql')->getRawPdo(), 'Reading Laravel configuration must not open a PostgreSQL PDO.');
        $this->assertSame('sqlite', DB::getDefaultConnection());
        $this->assertDatabaseCount('users', 1);
        $this->assertOnlyConnectionArtifacts(1);
    }

    public function test_laravel_database_url_is_normalized_before_mapping_source_fields(): void
    {
        $this->setProfile(array_replace($this->profile, [
            'url' => 'postgresql://url-reader:url-only-secret@source_db:5544/soar_app?sslmode=require',
            'host' => 'obsolete.test', 'database' => 'obsolete', 'username' => 'obsolete',
        ]));
        $this->options['sync'] = false;
        $this->manager()->shouldNotReceive('catalog');

        $this->runSeeder();

        $configuration = AnalyticsConnection::sole()->configuration;
        $this->assertSame('source_db', $configuration['host']);
        $this->assertSame('soar_app', $configuration['database']);
        $this->assertSame('url-reader', $configuration['username']);
        $this->assertSame('url-only-secret', $configuration['password']);
        $this->assertSame(5544, (int) $configuration['port']);
        $this->assertSame('require', $configuration['sslmode']);
        $this->assertArrayNotHasKey('url', $configuration);
        $this->assertNull(AnalyticsConnection::sole()->catalog);
        $this->assertNull(AnalyticsConnection::sole()->synced_at);
        $this->assertInstanceOf(\Closure::class, DB::connection('pgsql')->getRawPdo());
        $this->assertOnlyConnectionArtifacts(1);
    }

    public function test_rerun_preserves_edited_credentials_names_and_metadata_and_refreshes_catalog(): void
    {
        $this->manager()->shouldReceive('catalog')->twice()->andReturn($this->catalog, [...$this->catalog, [
            'key' => 'public.audit_log', 'name' => 'audit_log', 'schema' => 'public', 'kind' => 'view', 'fields' => [],
        ]]);
        $this->runSeeder();
        $connection = AnalyticsConnection::sole();
        $id = $connection->id;
        $customConfiguration = array_replace($connection->configuration, [
            'host' => 'edited-db', 'username' => 'edited-reader', 'password' => 'user-edited-secret',
        ]);
        $connection->update([
            'name' => 'My renamed production source',
            'configuration' => $customConfiguration,
            'metadata' => [...$connection->metadata, 'custom' => ['keep' => true]],
        ]);
        $this->setProfile(array_replace($this->profile, ['password' => 'rotated-profile-secret']));
        $firstSync = $connection->refresh()->synced_at;
        $this->travel(1)->minute();

        $this->runSeeder();

        $connection = AnalyticsConnection::sole();
        $this->assertSame($id, $connection->id);
        $this->assertSame('My renamed production source', $connection->name);
        $this->assertSame($customConfiguration, $connection->configuration);
        $this->assertSame(['keep' => true], $connection->metadata['custom']);
        $this->assertCount(2, $connection->catalog);
        $this->assertTrue($connection->synced_at->greaterThan($firstSync));
        $this->assertOnlyConnectionArtifacts(1);
    }

    public function test_matching_existing_source_is_linked_without_overwriting_its_configuration(): void
    {
        $existingConfiguration = array_diff_key($this->profile, array_flip(['driver', 'prefix', 'charset', 'search_path']));
        $existingConfiguration['password'] = 'existing-form-password';
        $connection = AnalyticsConnection::create([
            'owner_id' => $this->owner->id, 'name' => 'Existing form source', 'driver' => 'pgsql',
            'configuration' => $existingConfiguration, 'metadata' => ['custom' => 'preserved'],
        ]);
        $this->options['sync'] = false;
        $this->manager()->shouldNotReceive('catalog');

        $this->runSeeder();

        $connection->refresh();
        $this->assertSame($connection->id, AnalyticsConnection::sole()->id);
        $this->assertSame('Existing form source', $connection->name);
        $this->assertSame($existingConfiguration, $connection->configuration);
        $this->assertSame('preserved', $connection->metadata['custom']);
        $this->assertSame('pgsql', $connection->metadata['_postgres_seed_profile']);
        $this->assertOnlyConnectionArtifacts(1);
    }

    public function test_sync_false_preserves_existing_catalog_and_last_sync_without_network_io(): void
    {
        $this->manager()->shouldReceive('catalog')->once()->andReturn($this->catalog);
        $this->runSeeder();
        $connection = AnalyticsConnection::sole();
        $firstSync = $connection->synced_at;
        $this->options['sync'] = false;
        $this->travel(1)->minute();

        $this->runSeeder();

        $this->assertSame($this->catalog, $connection->refresh()->catalog);
        $this->assertTrue($connection->synced_at->equalTo($firstSync));
        $this->assertOnlyConnectionArtifacts(1);
    }

    public function test_failed_first_sync_does_not_leave_a_partial_source_or_dashboard(): void
    {
        $this->manager()->shouldReceive('catalog')->once()->andThrow(ValidationException::withMessages([
            'connection' => 'The source schema could not be read.',
        ]));

        $exception = $this->invalidSeeder();

        $this->assertArrayHasKey('connection', $exception->errors());
        $this->assertOnlyConnectionArtifacts(0);
        $this->assertDatabaseCount('users', 1);
    }

    public function test_cli_with_multiple_users_requires_an_existing_owner_email(): void
    {
        $other = User::factory()->create();
        $this->options['sync'] = false;
        $this->manager()->shouldNotReceive('catalog');

        $exception = $this->invalidSeeder();

        $this->assertArrayHasKey('owner_email', $exception->errors());
        $this->assertDatabaseCount('analytics_connections', 0);
        $this->options['owner_email'] = ' '.$other->email.' ';
        $this->runSeeder();
        $this->assertSame($other->id, AnalyticsConnection::sole()->owner_id);
        $this->assertDatabaseCount('users', 2);
    }

    public function test_current_filament_guard_has_priority_over_default_laravel_guard(): void
    {
        $other = User::factory()->create();
        config()->set('auth.guards.analytics_filament', ['driver' => 'session', 'provider' => 'users']);
        Filament::setCurrentPanel(Panel::make()->id('postgres-seeder-test')->authGuard('analytics_filament'));
        $this->actingAs($other, 'web');
        Auth::guard('analytics_filament')->setUser($this->owner);
        $this->options['sync'] = false;
        $this->manager()->shouldNotReceive('catalog');

        $this->runSeeder();

        $this->assertSame($this->owner->id, AnalyticsConnection::sole()->owner_id);
        $this->assertSame($other->id, Auth::user()->id);
    }

    public function test_authenticated_owner_cannot_be_reassigned_to_another_email(): void
    {
        $other = User::factory()->create();
        $this->actingAs($this->owner);
        $this->options = ['owner_email' => $other->email, 'sync' => false];
        $this->manager()->shouldNotReceive('catalog');

        $exception = $this->invalidSeeder();

        $this->assertArrayHasKey('owner_email', $exception->errors());
        $this->assertOnlyConnectionArtifacts(0);
    }

    public function test_guest_web_request_cannot_claim_the_only_existing_user(): void
    {
        (new \ReflectionProperty($this->app, 'isRunningInConsole'))->setValue($this->app, false);
        $this->options = ['owner_email' => $this->owner->email, 'sync' => false];
        $this->manager()->shouldNotReceive('catalog');

        $exception = $this->invalidSeeder();

        $this->assertArrayHasKey('owner_email', $exception->errors());
        $this->assertOnlyConnectionArtifacts(0);
    }

    public function test_missing_or_non_postgresql_laravel_profile_is_rejected_without_source_io(): void
    {
        $this->setProfile(array_replace($this->profile, ['driver' => 'clickhouse']));
        $this->manager()->shouldNotReceive('catalog');

        $exception = $this->invalidSeeder();

        $this->assertArrayHasKey('laravel_connection', $exception->errors());
        $this->assertOnlyConnectionArtifacts(0);
    }

    public function test_sources_owned_by_other_users_are_never_reused(): void
    {
        $other = User::factory()->create();
        $this->actingAs($this->owner);
        $otherConnection = AnalyticsConnection::create([
            'owner_id' => $other->id, 'name' => 'Other user source', 'driver' => 'pgsql',
            'configuration' => $this->profile, 'metadata' => ['_postgres_seed_profile' => 'pgsql'],
        ]);
        $this->options['sync'] = false;
        $this->manager()->shouldNotReceive('catalog');

        $this->runSeeder();

        $this->assertDatabaseCount('analytics_connections', 2);
        $this->assertSame($other->id, $otherConnection->refresh()->owner_id);
        $ownConnection = AnalyticsConnection::where('owner_id', $this->owner->id)->sole();
        $this->assertNotSame($otherConnection->id, $ownConnection->id);
        $this->assertSame('pgsql', $ownConnection->metadata['_postgres_seed_profile']);
    }
}
