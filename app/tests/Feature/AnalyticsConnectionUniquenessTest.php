<?php

namespace Tests\Feature;

use App\Domain\Analytics\ConnectionUniqueness;
use App\Domain\Analytics\Drivers\ConnectionManager;
use App\Filament\Resources\AnalyticsConnectionResource\Pages\ListAnalyticsConnections;
use App\Models\AnalyticsConnection;
use App\Models\User;
use Filament\Facades\Filament;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;
use Livewire\Livewire;
use Tests\TestCase;

class AnalyticsConnectionUniquenessTest extends TestCase
{
    use RefreshDatabase;

    private User $owner;

    protected function setUp(): void
    {
        parent::setUp();
        config(['analytics.connection_drivers' => ['pgsql', 'clickhouse'], 'app.env' => 'local']);
        $this->owner = User::factory()->create();
        $this->actingAs($this->owner);
    }

    private function payload(string $name = 'Production', array $configuration = [], string $driver = 'pgsql'): array
    {
        return [
            'name' => $name,
            'driver' => $driver,
            'configuration' => array_replace([
                'host' => 'db.internal', 'port' => $driver === 'pgsql' ? 5432 : 8123,
                'database' => 'unisq', 'username' => 'analytics_reader',
                'password' => 'private-uniqueness-test-secret',
                ...($driver === 'pgsql' ? ['sslmode' => 'prefer'] : ['ssl' => false]),
            ], $configuration),
            'test_first' => false,
        ];
    }

    private function source(string $name = 'Production', array $configuration = [], string $driver = 'pgsql', ?User $owner = null): AnalyticsConnection
    {
        $payload = $this->payload($name, $configuration, $driver);

        return AnalyticsConnection::create([
            'owner_id' => ($owner ?? $this->owner)->id,
            ...array_intersect_key($payload, array_flip(['name', 'driver', 'configuration'])),
        ]);
    }

    public function test_fingerprints_normalize_display_names_and_endpoint_aliases_but_keep_database_identity(): void
    {
        $this->assertSame(ConnectionUniqueness::nameFingerprint(' Production '), ConnectionUniqueness::nameFingerprint('production'));

        $configuration = $this->payload()['configuration'];
        $endpoint = ConnectionUniqueness::endpointFingerprint('pgsql', $configuration);
        $this->assertNotNull($endpoint);
        $this->assertSame($endpoint, ConnectionUniqueness::endpointFingerprint('pgsql', [
            ...$configuration, 'host' => 'DB.INTERNAL.', 'port' => '5432',
            'username' => 'different_reader', 'password' => 'different-secret', 'sslmode' => 'require',
        ]));
        $withoutPort = $configuration;
        unset($withoutPort['port']);
        $this->assertSame($endpoint, ConnectionUniqueness::endpointFingerprint('pgsql', $withoutPort));
        $this->assertSame(
            ConnectionUniqueness::endpointFingerprint('pgsql', [...$configuration, 'host' => '[2001:DB8::1]']),
            ConnectionUniqueness::endpointFingerprint('pgsql', [...$configuration, 'host' => '2001:db8::1']),
        );
        foreach ([['host' => 'replica.internal'], ['port' => 5433], ['database' => 'Unisq']] as $change) {
            $this->assertNotSame($endpoint, ConnectionUniqueness::endpointFingerprint('pgsql', [...$configuration, ...$change]));
        }
        $this->assertNotSame($endpoint, ConnectionUniqueness::endpointFingerprint('clickhouse', $configuration));
        $this->assertNull(ConnectionUniqueness::endpointFingerprint('sqlite', ['path' => '/legacy.sqlite']));
    }

    public function test_api_rejects_a_case_and_whitespace_duplicate_name_before_testing_the_server(): void
    {
        $record = $this->source();
        $before = $record->fresh()->getRawOriginal();
        $this->mock(ConnectionManager::class)->shouldNotReceive('catalog');

        $this->postJson('/analytics/api/connections', [
            ...$this->payload('  pRoDuCtIoN  ', ['host' => 'different.internal']), 'test_first' => true,
        ])->assertUnprocessable()->assertJsonValidationErrors('name');

        $this->assertDatabaseCount('analytics_connections', 1);
        $this->assertSame($before, $record->refresh()->getRawOriginal());
    }

    public function test_api_rejects_duplicate_database_endpoint_even_with_different_name_and_credentials(): void
    {
        $this->source();
        $this->mock(ConnectionManager::class)->shouldNotReceive('catalog');

        $this->postJson('/analytics/api/connections', [
            ...$this->payload('Another connection', [
                'host' => 'DB.INTERNAL.', 'username' => 'second_reader', 'password' => 'another-private-secret',
            ]), 'test_first' => true,
        ])->assertUnprocessable()->assertJsonValidationErrors('configuration.database');

        $this->assertDatabaseCount('analytics_connections', 1);
    }

    public function test_same_database_name_is_allowed_on_different_servers_ports_and_drivers(): void
    {
        $this->source();
        $this->mock(ConnectionManager::class)->shouldNotReceive('catalog');

        $this->postJson('/analytics/api/connections', $this->payload('Replica', ['host' => 'replica.internal']))->assertOk();
        $this->postJson('/analytics/api/connections', $this->payload('Other port', ['port' => 5433]))->assertOk();
        $this->postJson('/analytics/api/connections', $this->payload('ClickHouse', ['port' => 5432], 'clickhouse'))->assertOk();
        $this->postJson('/analytics/api/connections', $this->payload('Quoted uppercase database', ['database' => 'Unisq']))->assertOk();

        $this->assertDatabaseCount('analytics_connections', 5);
    }

    public function test_uniqueness_is_scoped_to_the_owner(): void
    {
        $first = $this->source();
        $other = User::factory()->create();
        $this->actingAs($other);

        $this->postJson('/analytics/api/connections', $this->payload())->assertOk()->assertJsonPath('owner_id', $other->id);

        $this->assertDatabaseCount('analytics_connections', 2);
        $this->assertDatabaseHas('analytics_connections', ['id' => $first->id, 'owner_id' => $this->owner->id]);
    }

    public function test_edit_excludes_its_own_record_and_keeps_the_existing_password(): void
    {
        $record = $this->source();
        $payload = $this->payload('PRODUCTION', ['host' => 'DB.INTERNAL.', 'username' => 'changed_reader']);
        unset($payload['configuration']['password']);
        $this->mock(ConnectionManager::class)->shouldNotReceive('catalog');

        $this->putJson('/analytics/api/connections/'.$record->id, $payload)->assertOk()->assertJsonPath('id', $record->id);

        $this->assertDatabaseCount('analytics_connections', 1);
        $this->assertSame('private-uniqueness-test-secret', $record->refresh()->configuration['password']);
        $this->assertSame('changed_reader', $record->configuration['username']);
    }

    public function test_edit_cannot_take_another_records_name_or_endpoint_and_leaves_saved_data_unchanged(): void
    {
        $this->source();
        $record = $this->source('Replica', ['host' => 'replica.internal']);
        $before = $record->fresh()->getRawOriginal();
        $this->mock(ConnectionManager::class)->shouldNotReceive('catalog');

        $this->putJson('/analytics/api/connections/'.$record->id, [
            ...$this->payload('Production', ['host' => 'replica.internal']), 'test_first' => true,
        ])->assertUnprocessable()->assertJsonValidationErrors('name');
        $this->assertSame($before, $record->refresh()->getRawOriginal());

        $this->putJson('/analytics/api/connections/'.$record->id, [
            ...$this->payload('Replica'), 'test_first' => true,
        ])->assertUnprocessable()->assertJsonValidationErrors('configuration.database');
        $this->assertSame($before, $record->refresh()->getRawOriginal());
    }

    public function test_direct_model_saves_also_validate_duplicates_for_seeders(): void
    {
        $this->source();

        foreach ([
            ['production', ['host' => 'another.internal'], 'name'],
            ['Another source', [], 'configuration.database'],
        ] as [$name, $configuration, $field]) {
            try {
                $this->source($name, $configuration);
                $this->fail('A duplicate connection was accepted by a direct model save.');
            } catch (ValidationException $exception) {
                $this->assertArrayHasKey($field, $exception->errors());
            }
        }

        $this->assertDatabaseCount('analytics_connections', 1);
    }

    public function test_database_unique_indexes_protect_both_fingerprints_when_model_events_are_bypassed(): void
    {
        $record = $this->source();
        $attributes = $record->fresh()->getRawOriginal();
        unset($attributes['id']);
        $this->assertNotEmpty($attributes['name_fingerprint']);
        $this->assertNotEmpty($attributes['endpoint_fingerprint']);

        foreach (['name_fingerprint', 'endpoint_fingerprint'] as $field) {
            $otherField = $field === 'name_fingerprint' ? 'endpoint_fingerprint' : 'name_fingerprint';
            try {
                DB::table('analytics_connections')->insert([...$attributes, $otherField => null]);
                $this->fail('The database accepted a duplicate '.$field.'.');
            } catch (QueryException $exception) {
                $this->assertStringContainsString('UNIQUE constraint failed', $exception->getMessage());
                $validation = ConnectionUniqueness::constraintFailure($exception);
                $this->assertInstanceOf(ValidationException::class, $validation);
                $this->assertArrayHasKey($field === 'name_fingerprint' ? 'name' : 'configuration.database', $validation->errors());
                $this->assertStringNotContainsString('private-uniqueness-test-secret', $validation->getMessage());
            }
        }

        $this->assertDatabaseCount('analytics_connections', 1);
    }

    public function test_api_maps_a_database_race_to_a_safe_field_error(): void
    {
        $raced = false;
        AnalyticsConnection::creating(function (AnalyticsConnection $record) use (&$raced): void {
            if ($raced || $record->name !== 'Race request') {
                return;
            }
            $raced = true;
            // Another request commits this endpoint after application validation.
            DB::table('analytics_connections')->insert([
                ...$record->getAttributes(),
                'name' => 'Concurrent source',
                'name_fingerprint' => ConnectionUniqueness::nameFingerprint('Concurrent source'),
            ]);
        });

        $response = $this->postJson('/analytics/api/connections', $this->payload('Race request'));
        $response->assertUnprocessable()->assertJsonValidationErrors('configuration.database');
        $this->assertTrue($raced);
        $this->assertStringNotContainsString('private-uniqueness-test-secret', $response->getContent());
        $this->assertStringNotContainsString('insert into', strtolower($response->getContent()));
        $this->assertDatabaseCount('analytics_connections', 1);
        $this->assertDatabaseHas('analytics_connections', ['name' => 'Concurrent source']);
    }

    public function test_existing_duplicate_rows_remain_usable_for_metadata_and_sync_but_block_new_duplicates(): void
    {
        $catalog = [['key' => 'public.events', 'label' => 'events', 'fields' => [
            ['key' => 'id', 'label' => 'id', 'type' => 'number'],
        ]]];
        $payload = $this->payload('Legacy');
        $legacy = new AnalyticsConnection([
            'owner_id' => $this->owner->id,
            ...array_intersect_key($payload, array_flip(['name', 'driver', 'configuration'])),
            'catalog' => $catalog,
        ]);
        // Raw insertion represents existing rows from before the fingerprint migration.
        $raw = [...$legacy->getAttributes(), 'name_fingerprint' => null, 'endpoint_fingerprint' => null, 'created_at' => now(), 'updated_at' => now()];
        $id = DB::table('analytics_connections')->insertGetId($raw);
        DB::table('analytics_connections')->insert($raw);

        $this->postJson('/analytics/api/connections', $this->payload('Fresh name'))->assertUnprocessable()->assertJsonValidationErrors('configuration.database');
        $this->postJson('/analytics/api/connections', $this->payload('legacy', ['host' => 'other.internal']))->assertUnprocessable()->assertJsonValidationErrors('name');

        $this->putJson('/analytics/api/connections/'.$id.'/metadata', [
            'table' => 'public.events', 'field' => 'id', 'label' => 'Event identifier',
        ])->assertOk();
        $record = AnalyticsConnection::findOrFail($id);
        $this->assertSame('Event identifier', $record->metadata['public.events']['fields']['id']['label']);

        $this->partialMock(ConnectionManager::class)->shouldReceive('catalog')->once()->andReturn($catalog);
        $this->postJson('/analytics/api/connections/'.$id.'/sync')->assertOk();
        $record->refresh();
        $this->assertNotNull($record->synced_at);
        $this->assertNull($record->getRawOriginal('name_fingerprint'));
        $this->assertNull($record->getRawOriginal('endpoint_fingerprint'));
        $this->assertDatabaseCount('analytics_connections', 2);
    }

    public function test_native_filament_modal_maps_duplicate_endpoint_errors_to_the_database_input(): void
    {
        $this->source();
        Filament::setCurrentPanel(Filament::getPanel('admin'));
        Filament::bootCurrentPanel();
        $this->mock(ConnectionManager::class)->shouldNotReceive('catalog');

        Livewire::test(ListAnalyticsConnections::class)
            ->callAction('create', data: $this->payload('Duplicate database'))
            ->assertHasActionErrors(['configuration.database']);

        $this->assertDatabaseCount('analytics_connections', 1);
    }
}
