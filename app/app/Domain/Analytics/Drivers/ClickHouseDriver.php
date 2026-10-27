<?php

namespace App\Domain\Analytics\Drivers;

use Illuminate\Support\Facades\Http;
use RuntimeException;

class ClickHouseDriver implements DatabaseDriver
{
    public function __construct(private array $configuration) {}

    public function catalog(): array
    {
        $tables = $this->query('SELECT database, name, engine FROM system.tables WHERE database = :database ORDER BY name', ['database' => $this->configuration['database']], metadata: true);

        return array_map(function ($table) {
            $fields = $this->query('SELECT name, type, is_in_primary_key FROM system.columns WHERE database=:database AND table=:table ORDER BY position', ['database' => $table['database'], 'table' => $table['name']], metadata: true);

            return ['key' => $table['database'].'.'.$table['name'], 'label' => $table['name'], 'schema' => $table['database'], 'kind' => str_ends_with(strtolower($table['engine']), 'view') ? 'view' : 'table', 'engine' => $table['engine'], 'fields' => array_map(fn ($field) => ['key' => $field['name'], 'label' => $field['name'], 'raw_type' => $field['type'], 'type' => ConnectionManager::fieldType($field['type']), 'nullable' => str_contains($field['type'], 'Nullable'), 'primary' => (bool) $field['is_in_primary_key'], 'relation' => null], $fields)];
        }, $tables);
    }

    public function select(string $sql, array $bindings = []): array
    {
        return $this->query($sql, $bindings);
    }

    private function query(string $sql, array $bindings, bool $metadata = false): array
    {
        $resultLimit = max((int) config('analytics.preview_row_limit', 2000), (int) config('analytics.preview_aggregate_limit', 10000)) + 1;
        // A preview may be truncated; the schema must be complete or fail sync.
        $params = ['database' => $this->configuration['database'], 'readonly' => 2, 'max_execution_time' => 10, 'max_result_rows' => $metadata ? 0 : $resultLimit, 'result_overflow_mode' => $metadata ? 'throw' : 'break', 'max_memory_usage' => 100000000, 'default_format' => 'JSON', 'wait_end_of_query' => 1];
        $tokens = <<<'REGEX'
~'(?:''|\\.|[^'\\])*'|"(?:""|\\.|[^"\\])*"|`(?:``|\\.|[^`\\])*`|--[^\r\n]*|/\*.*?\*/|(?<!:):(?P<parameter>[a-zA-Z_][a-zA-Z0-9_]*)~s
REGEX;
        $sql = preg_replace_callback($tokens, function ($match) use ($bindings, &$params) {
            $key = $match['parameter'] ?? null;
            if ($key === null) {
                return $match[0];
            }
            if (! array_key_exists($key, $bindings)) {
                throw new RuntimeException('پارامتر Query یافت نشد.');
            }
            $value = $bindings[$key];
            $type = is_int($value) ? 'Int64' : (is_float($value) ? 'Float64' : 'String');
            $params['param_'.$key] = (string) $value;

            return '{'.$key.':'.$type.'}';
        }, $sql);
        $scheme = ! empty($this->configuration['ssl']) ? 'https' : 'http';
        $host = $this->configuration['host'];
        if (! preg_match('/^[a-zA-Z0-9_.\-:\[\]]+$/', $host)) {
            throw new RuntimeException('نام میزبان معتبر نیست.');
        }
        $port = (int) ($this->configuration['port'] ?? 8123);
        $response = Http::connectTimeout(5)->timeout(15)->withoutRedirecting()->withBasicAuth($this->configuration['username'] ?? 'default', $this->configuration['password'] ?? '')->withBody($sql, 'text/plain')->post("$scheme://$host:$port/?".http_build_query($params));
        if (! $response->successful() || ! is_array($response->json('data')) || ! empty($response->json('exception'))) {
            throw new RuntimeException('ClickHouse پاسخ معتبر نداد؛ اتصال، مجوز فقط‌خواندنی و Query را بررسی کنید.');
        }

        return $response->json('data');
    }
}
