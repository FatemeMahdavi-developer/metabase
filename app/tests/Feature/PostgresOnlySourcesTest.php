<?php

namespace Tests\Feature;

use App\Domain\Analytics\Drivers\ConnectionManager;
use App\Models\AnalyticsConnection;
use App\Models\User;
use Filament\Facades\Filament;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class PostgresOnlySourcesTest extends TestCase
{
    use RefreshDatabase;

    public function test_retired_sqlite_source_is_hidden_and_rejected_without_erasing_saved_data(): void
    {
        // Exercise production's policy, not the SQLite query fixture opt-in.
        config(['analytics.connection_drivers' => ['pgsql', 'clickhouse'], 'app.env' => 'local']);
        $owner = User::factory()->create();
        $this->actingAs($owner);
        Filament::setCurrentPanel(Filament::getPanel('admin'));
        $this->mock(ConnectionManager::class)->shouldNotReceive('catalog');
        $legacy = AnalyticsConnection::create([
            'owner_id' => $owner->id, 'name' => 'Retired source', 'driver' => 'sqlite',
            'configuration' => ['path' => '/not-read/legacy.sqlite'],
            'catalog' => [['key' => 'orders', 'label' => 'Orders', 'fields' => []]],
        ]);
        $before = $legacy->fresh()->getRawOriginal();

        $this->getJson('/analytics/api/library')->assertOk()->assertJsonCount(0, 'connections');
        $this->get('/admin/analytics/databases/'.$legacy->id)->assertNotFound();
        $this->postJson('/analytics/api/connections/'.$legacy->id.'/sync')->assertNotFound();
        $this->putJson('/analytics/api/connections/'.$legacy->id.'/metadata', ['table' => 'orders', 'description' => 'Changed'])->assertNotFound();
        $this->postJson('/analytics/api/reports/preview', ['query_definition' => [
            'connection_id' => $legacy->id, 'source' => 'orders', 'mode' => 'rows',
            'metrics' => [], 'dimensions' => [], 'filters' => [], 'sort' => [], 'joins' => [], 'expressions' => [], 'limit' => 10,
        ]])->assertUnprocessable()->assertJsonValidationErrors('connection_id');

        $this->assertSame($before, $legacy->refresh()->getRawOriginal());
    }
}
