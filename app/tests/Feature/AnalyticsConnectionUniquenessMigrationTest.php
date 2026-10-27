<?php

namespace Tests\Feature;

use App\Domain\Analytics\ConnectionUniqueness;
use App\Models\AnalyticsConnection;
use App\Models\User;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

class AnalyticsConnectionUniquenessMigrationTest extends TestCase
{
    use RefreshDatabase;

    private function migration(): Migration
    {
        return require database_path('migrations/2026_10_19_180000_add_analytics_connection_uniqueness.php');
    }

    private function legacyConnection(int $ownerId, string $name, array $configuration, array $changes = []): int
    {
        $model = new AnalyticsConnection(['configuration' => $configuration]);

        return DB::table('analytics_connections')->insertGetId([
            'owner_id' => $ownerId, 'name' => $name, 'driver' => 'pgsql',
            'configuration' => $model->getAttributes()['configuration'],
            'catalog' => '[{"key":"public.events","fields":[]}]',
            'metadata' => '{"preserved":true}',
            'created_at' => '2026-10-19 10:00:00', 'updated_at' => '2026-10-19 11:00:00',
            ...$changes,
        ]);
    }

    public function test_backfill_retains_duplicate_rows_report_references_and_original_encrypted_settings(): void
    {
        $this->migration()->down();
        $owner = User::factory()->create();
        $other = User::factory()->create();
        $configuration = ['host' => 'DB.', 'database' => 'unisq', 'username' => 'reader', 'password' => 'fixture-only'];
        $first = $this->legacyConnection($owner->id, ' SOAR ', $configuration);
        $duplicate = $this->legacyConnection($owner->id, 'soar', [...$configuration, 'host' => 'db', 'port' => 5432, 'username' => 'other-role']);
        $nameDuplicate = $this->legacyConnection($owner->id, 'Soar', [...$configuration, 'database' => 'archive']);
        $endpointDuplicate = $this->legacyConnection($owner->id, 'Other source', $configuration);
        $otherOwner = $this->legacyConnection($other->id, 'soar', $configuration);
        DB::table('analytics_reports')->insert([
            'owner_id' => $owner->id, 'name' => 'Legacy report',
            'query_definition' => json_encode(['connection_id' => $duplicate, 'source' => 'public.events']),
            'visualization_settings' => '{}',
        ]);
        $before = DB::table('analytics_connections')->orderBy('id')->get()->map(fn ($row) => (array) $row)->all();
        $report = (array) DB::table('analytics_reports')->sole();

        $this->migration()->up();

        $after = DB::table('analytics_connections')->orderBy('id')->get()->keyBy('id');
        $this->assertCount(5, $after);
        foreach ($before as $row) {
            $this->assertSame($row, collect((array) $after[$row['id']])->except(['name_fingerprint', 'endpoint_fingerprint'])->all());
        }
        $name = ConnectionUniqueness::nameFingerprint('soar');
        $endpoint = ConnectionUniqueness::endpointFingerprint('pgsql', $configuration);
        $this->assertSame($name, $after[$first]->name_fingerprint);
        $this->assertSame($endpoint, $after[$first]->endpoint_fingerprint);
        $this->assertNull($after[$duplicate]->name_fingerprint);
        $this->assertNull($after[$duplicate]->endpoint_fingerprint);
        $this->assertNull($after[$nameDuplicate]->name_fingerprint);
        $this->assertNotNull($after[$nameDuplicate]->endpoint_fingerprint);
        $this->assertNotNull($after[$endpointDuplicate]->name_fingerprint);
        $this->assertNull($after[$endpointDuplicate]->endpoint_fingerprint);
        $this->assertSame($name, $after[$otherOwner]->name_fingerprint);
        $this->assertSame($endpoint, $after[$otherOwner]->endpoint_fingerprint);
        $this->assertSame($report, (array) DB::table('analytics_reports')->sole());

        $this->migration()->down();
        $this->assertFalse(Schema::hasColumn('analytics_connections', 'name_fingerprint'));
        $this->assertFalse(Schema::hasColumn('analytics_connections', 'endpoint_fingerprint'));
        $this->assertSame($before, DB::table('analytics_connections')->orderBy('id')->get()->map(fn ($row) => (array) $row)->all());
        $this->migration()->up();
    }

    public function test_unreadable_legacy_ciphertext_reserves_its_name_without_losing_original_data(): void
    {
        $this->migration()->down();
        $owner = User::factory()->create();
        $id = $this->legacyConnection($owner->id, 'Unreadable source', [], ['configuration' => 'legacy-unreadable-ciphertext']);

        $this->migration()->up();

        $row = DB::table('analytics_connections')->find($id);
        $this->assertSame('legacy-unreadable-ciphertext', $row->configuration);
        $this->assertSame(ConnectionUniqueness::nameFingerprint('Unreadable source'), $row->name_fingerprint);
        $this->assertNull($row->endpoint_fingerprint);
    }

    public function test_indexes_prevent_duplicate_non_null_fingerprints_for_the_same_owner(): void
    {
        $owner = User::factory()->create();
        $configuration = ['host' => 'db', 'port' => 5432, 'database' => 'unisq'];
        $id = $this->legacyConnection($owner->id, 'One source', $configuration, [
            'name_fingerprint' => ConnectionUniqueness::nameFingerprint('One source'),
            'endpoint_fingerprint' => ConnectionUniqueness::endpointFingerprint('pgsql', $configuration),
        ]);
        $original = collect((array) DB::table('analytics_connections')->find($id))->except('id')->all();
        foreach (['name_fingerprint', 'endpoint_fingerprint'] as $column) {
            $other = $column === 'name_fingerprint' ? 'endpoint_fingerprint' : 'name_fingerprint';
            try {
                DB::transaction(fn () => DB::table('analytics_connections')->insert([...$original, $other => null]));
                $this->fail('A duplicate '.$column.' was accepted.');
            } catch (UniqueConstraintViolationException) {
                $this->assertSame(1, DB::table('analytics_connections')->count());
            }
        }
    }
}
