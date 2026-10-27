<?php

namespace Tests\Feature;

use App\Domain\Analytics\Drivers\ConnectionManager;
use App\Domain\Analytics\Drivers\DatabaseDriver;
use App\Domain\Analytics\MetadataLabels;
use App\Domain\Analytics\ReportRunner;
use App\Models\AnalyticsConnection;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Mockery;
use Tests\TestCase;

class PostgresTableNamesTest extends TestCase
{
    use RefreshDatabase;

    private function source(): AnalyticsConnection
    {
        $owner = User::factory()->create();
        $this->actingAs($owner);

        return AnalyticsConnection::create([
            'owner_id' => $owner->id, 'name' => 'Reporting source', 'driver' => 'pgsql',
            'configuration' => ['host' => 'db', 'port' => 5432, 'database' => 'unisq', 'username' => 'reader', 'password' => 'fixture-only'],
            'catalog' => [
                ['key' => 'public.users', 'schema' => 'public', 'label' => 'users', 'fields' => [
                    ['key' => 'id', 'label' => 'id', 'type' => 'number', 'primary' => true],
                    ['key' => 'full_name', 'label' => 'full_name', 'type' => 'text'],
                ]],
                ['key' => 'audit.users', 'schema' => 'audit', 'label' => 'users', 'fields' => [
                    ['key' => 'id', 'label' => 'id', 'type' => 'number'],
                ]],
                ['key' => 'public.orders', 'label' => 'orders', 'fields' => [
                    ['key' => 'id', 'label' => 'id', 'type' => 'number', 'primary' => true],
                    ['key' => 'customer_id', 'label' => 'customer_id', 'type' => 'number', 'relation' => ['table' => 'public.users', 'field' => 'id']],
                ]],
            ],
            'metadata' => ['public.users' => ['labels' => ['fa' => 'کاربران', 'en' => 'Users'], 'fields' => [
                'full_name' => ['labels' => ['fa' => 'نام', 'en' => 'Name']],
            ]]],
        ]);
    }

    public function test_old_catalogs_display_database_names_without_sync_or_changing_physical_identifiers(): void
    {
        $connection = $this->source();
        $before = $connection->fresh()->getRawOriginal();
        $this->mock(ConnectionManager::class)->shouldNotReceive('driver');

        $data = $this->getJson('/analytics/api/library')->assertOk()->json('connections.0');
        $users = $data['catalog'][0];
        $this->assertSame('public.users', $users['key']);
        $this->assertSame('public.users', $users['original_name']);
        $this->assertSame(['original' => 'unisq.users', 'fa' => 'unisq.کاربران', 'en' => 'unisq.Users'], $users['display_names']);
        $this->assertSame('unisq.audit.users', $data['catalog'][1]['display_names']['original']);
        $this->assertSame('unisq.orders', $data['catalog'][2]['display_names']['original']);
        $this->assertSame('full_name', $users['fields'][1]['display_names']['original']);
        $this->assertSame('public.users', $data['catalog'][2]['fields'][1]['relation']['table']);
        $this->assertSame($before, $connection->refresh()->getRawOriginal());
    }

    public function test_reprojection_metadata_edits_and_database_changes_do_not_repeat_or_keep_stale_prefixes(): void
    {
        $connection = $this->source();
        $catalog = $connection->displayCatalog();
        $connection->catalog = $catalog;
        $this->assertSame($catalog, $connection->displayCatalog());
        $connection->save();

        $this->putJson('/analytics/api/connections/'.$connection->id.'/metadata', [
            'table' => 'public.users', 'labels' => ['en' => 'Customers'],
        ])->assertOk()->assertJsonPath('catalog.0.display_names.en', 'unisq.Customers');
        $connection->refresh();
        $connection->configuration = [...$connection->configuration, 'database' => 'archive'];
        $connection->save();
        $renamed = $connection->displayCatalog();
        $this->assertSame(['original' => 'archive.users', 'fa' => 'archive.کاربران', 'en' => 'archive.Customers'], $renamed[0]['display_names']);
        $this->assertSame('archive.audit.users', $renamed[1]['display_names']['original']);
        $this->assertSame('public.users', $renamed[0]['key']);

        // Fresh sync can recover untranslated tables from a previous projection.
        $withoutOverrides = MetadataLabels::catalog($catalog, [], 'archive');
        $this->assertSame('archive.کاربران', $withoutOverrides[0]['display_names']['fa']);
        $this->assertSame('archive.Users', $withoutOverrides[0]['display_names']['en']);
    }

    public function test_queries_and_joins_use_schema_names_while_translated_context_uses_database_names(): void
    {
        $connection = $this->source();
        $runner = app(ReportRunner::class);
        $query = $runner->validate([
            'connection_id' => $connection->id, 'source' => 'public.orders', 'mode' => 'rows',
            'columns' => ['id', 'customer.full_name'], 'metrics' => [], 'dimensions' => [],
            'filters' => [], 'sort' => [], 'expressions' => [], 'limit' => 10,
            'joins' => [['source' => 'public.users', 'alias' => 'customer', 'type' => 'left',
                'conditions' => [['left' => 'customer_id', 'right' => 'id', 'operator' => 'eq']],
            ]],
        ], $connection->owner_id);
        $compiled = $runner->compile($query, $connection);
        $this->assertStringContainsString('FROM "public"."orders"', $compiled['sql']);
        $this->assertStringContainsString('LEFT JOIN "public"."users"', $compiled['sql']);
        $this->assertStringNotContainsString('unisq', $compiled['sql']);
        $joined = $compiled['columns'][1];
        $this->assertSame('customer.full_name', $joined['key']);
        $this->assertSame('public.users', $joined['source_table']);
        $this->assertSame('unisq.کاربران → نام', $joined['display_names']['fa']);
        $this->assertSame('unisq.Users → Name', $joined['display_names']['en']);
    }

    public function test_new_syncs_use_the_same_display_format_without_opening_a_postgres_server(): void
    {
        $connection = $this->source();
        $driver = Mockery::mock(DatabaseDriver::class);
        $driver->shouldReceive('catalog')->once()->andReturn($connection->catalog);
        $manager = Mockery::mock(ConnectionManager::class)->makePartial();
        $manager->shouldReceive('driver')->with($connection)->once()->andReturn($driver);
        $synced = $manager->sync($connection)->publicData();
        $this->assertSame('unisq.users', $synced['catalog'][0]['display_names']['original']);
        $this->assertSame('unisq.Users', $synced['catalog'][0]['display_names']['en']);
        $this->assertSame('unisq.audit.users', $synced['catalog'][1]['display_names']['original']);
        $this->assertSame('public.users', $synced['catalog'][0]['key']);
        $this->assertNotNull($synced['synced_at']);
    }
}
