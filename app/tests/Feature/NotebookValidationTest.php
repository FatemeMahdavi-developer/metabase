<?php

namespace Tests\Feature;

use App\Models\AnalyticsConnection;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class NotebookValidationTest extends TestCase
{
    use RefreshDatabase;

    private User $owner;

    private AnalyticsConnection $connection;

    private string $missingPath;

    protected function setUp(): void
    {
        parent::setUp();
        $this->owner = User::factory()->create();
        $this->actingAs($this->owner);
        $this->missingPath = storage_path('framework/notebook-validation-missing-'.bin2hex(random_bytes(6)).'.sqlite');
        $this->connection = AnalyticsConnection::create([
            'owner_id' => $this->owner->id, 'name' => 'Offline catalog', 'driver' => 'sqlite',
            'configuration' => ['path' => $this->missingPath],
            'catalog' => [['key' => 'orders', 'label' => 'سفارش‌ها', 'fields' => [
                ['key' => 'id', 'label' => 'شناسه', 'type' => 'number'],
                ['key' => 'customer_id', 'label' => 'مشتری', 'type' => 'number'],
                ['key' => 'total', 'label' => 'مبلغ', 'type' => 'number'],
                ['key' => 'status', 'label' => 'وضعیت', 'type' => 'text'],
                ['key' => 'completed', 'label' => 'تکمیل شده', 'type' => 'boolean'],
            ]]],
        ]);
    }

    private function query(array $changes = []): array
    {
        return array_replace([
            'connection_id' => $this->connection->id, 'source' => 'orders', 'mode' => 'rows',
            'metrics' => [], 'dimensions' => [], 'filters' => [], 'sort' => [], 'joins' => [],
            'limit' => null, 'limit_explicit' => false,
        ], $changes);
    }

    public function test_query_validation_uses_cached_catalog_without_opening_an_unavailable_source(): void
    {
        $this->assertFileDoesNotExist($this->missingPath);
        $query = $this->query(['sort' => [['key' => 'total', 'direction' => 'desc']], 'limit' => 3000, 'limit_explicit' => true]);
        $result = $this->postJson('/analytics/api/reports/validate', ['query_definition' => $query])->assertOk();
        $result->assertJsonPath('query_definition.limit', 3000)->assertJsonPath('query_definition.limit_explicit', true);
        $this->assertArrayHasKey('columns', $result->json('query_definition'));
        $this->assertArrayNotHasKey('rows', $result->json());
        $this->assertArrayNotHasKey('sql', $result->json());
        // The execution endpoint cannot open this connection; validation still succeeds.
        $this->postJson('/analytics/api/reports/preview', ['query_definition' => $query])->assertUnprocessable();
        $this->assertFileDoesNotExist($this->missingPath);
    }

    public function test_expression_validation_infers_types_and_canonicalizes_display_labels(): void
    {
        foreach ([
            ['expression' => '[مبلغ] * 0.9', 'canonical' => '[total] * 0.9', 'type' => 'number'],
            ['expression' => 'concat(upper([وضعیت]), "!")', 'canonical' => 'concat(upper([status]), "!")', 'type' => 'text'],
            ['expression' => 'contains([وضعیت], "paid") AND [تکمیل شده]', 'canonical' => 'contains([status], "paid") AND [completed]', 'type' => 'boolean'],
        ] as $case) {
            $query = $this->query(['expressions' => [['key' => 'custom', 'label' => 'ستون سفارشی', 'expression' => $case['expression'], 'type' => 'date']]]);
            $this->postJson('/analytics/api/reports/expression/validate', ['query_definition' => $query, 'expression_key' => 'custom'])
                ->assertOk()->assertJsonPath('type', $case['type'])
                ->assertJsonPath('query_definition.expressions.0.type', $case['type'])
                ->assertJsonPath('query_definition.expressions.0.expression', $case['canonical']);
        }
        $this->assertFileDoesNotExist($this->missingPath);
    }

    public function test_later_stage_expression_uses_previous_summary_columns_and_labels(): void
    {
        $stage = ['mode' => 'rows', 'metrics' => [], 'dimensions' => [], 'filters' => [], 'sort' => [], 'limit' => null, 'limit_explicit' => false,
            'expressions' => [['key' => 'net', 'label' => 'خالص فروش', 'expression' => '[مجموع فروش] * 0.9']]];
        $query = $this->query(['mode' => 'aggregate', 'metrics' => [['key' => 'sales', 'label' => 'مجموع فروش', 'function' => 'sum', 'field' => 'total']], 'dimensions' => [['field' => 'customer_id']], 'stages' => [$stage]]);
        $this->postJson('/analytics/api/reports/expression/validate', ['query_definition' => $query, 'expression_key' => 'net', 'stage_index' => 0])
            ->assertOk()->assertJsonPath('type', 'number')->assertJsonPath('query_definition.stages.0.expressions.0.expression', '[sales] * 0.9')
            ->assertJsonPath('query_definition.stages.0.field_labels.sales', 'مجموع فروش')
            ->assertJsonPath('query_definition.stages.0.field_labels.net', 'خالص فروش');
        $query['stages'][0]['expressions'][0]['expression'] = '[total] * 0.9';
        $this->postJson('/analytics/api/reports/expression/validate', ['query_definition' => $query, 'expression_key' => 'net', 'stage_index' => 0])->assertUnprocessable();
        $this->assertFileDoesNotExist($this->missingPath);
    }

    public function test_both_validation_endpoints_preserve_connection_ownership(): void
    {
        $query = $this->query(['expressions' => [['key' => 'custom', 'label' => 'Custom', 'expression' => '[total] * 2']]]);
        $this->actingAs(User::factory()->create());
        $this->postJson('/analytics/api/reports/validate', ['query_definition' => $query])->assertNotFound();
        $this->postJson('/analytics/api/reports/expression/validate', ['query_definition' => $query, 'expression_key' => 'custom'])->assertNotFound();
        $this->actingAs($this->owner);
        $query['connection_id'] = $this->connection->id + 10000;
        $this->postJson('/analytics/api/reports/validate', ['query_definition' => $query])->assertNotFound();
        $this->postJson('/analytics/api/reports/expression/validate', ['query_definition' => $query, 'expression_key' => 'custom'])->assertNotFound();
    }

    public function test_unsafe_expressions_and_invalid_expression_targets_are_rejected_without_execution(): void
    {
        foreach (['[total]; DROP TABLE orders', 'pg_read_file("/etc/passwd")', '[unknown] + 1', '[status] * 2'] as $expression) {
            $query = $this->query(['expressions' => [['key' => 'custom', 'label' => 'Custom', 'expression' => $expression]]]);
            $this->postJson('/analytics/api/reports/validate', ['query_definition' => $query])->assertUnprocessable();
            $this->postJson('/analytics/api/reports/expression/validate', ['query_definition' => $query, 'expression_key' => 'custom'])->assertUnprocessable();
        }
        $query = $this->query(['expressions' => [['key' => 'custom', 'label' => 'Custom', 'expression' => '[total] + 1']]]);
        $this->postJson('/analytics/api/reports/expression/validate', ['query_definition' => $query, 'expression_key' => 'missing'])->assertUnprocessable();
        $this->postJson('/analytics/api/reports/expression/validate', ['query_definition' => $query, 'expression_key' => 'custom', 'stage_index' => 0])->assertUnprocessable();
        $this->postJson('/analytics/api/reports/expression/validate', ['query_definition' => $query, 'expression_key' => 'custom', 'stage_index' => -1])->assertUnprocessable();
        $this->assertFileDoesNotExist($this->missingPath);
    }
}
