<?php

namespace Tests\Unit;

use App\Domain\Analytics\ExpressionCompiler;
use App\Domain\Analytics\ReportRunner;
use App\Models\AnalyticsConnection;
use Illuminate\Validation\ValidationException;
use PDO;
use Tests\TestCase;

class ExpressionCompilerTest extends TestCase
{
    private function fields(): array
    {
        return [
            'total' => ['sql' => '"total"', 'type' => 'number', 'label' => 'مبلغ'],
            'name' => ['sql' => '"name"', 'type' => 'text', 'label' => 'نام'],
            'status' => ['sql' => '"status"', 'type' => 'text', 'label' => 'وضعیت'],
            'flag' => ['sql' => '"flag"', 'type' => 'boolean', 'label' => 'فعال'],
        ];
    }

    private function compile(string $source, string $driver = 'sqlite'): array
    {
        return (new ExpressionCompiler)->compile($source, $this->fields(), $driver);
    }

    public function test_function_browser_expressions_run_on_sqlite_with_correct_types(): void
    {
        $pdo = new PDO('sqlite::memory:');
        $pdo->exec('CREATE TABLE fixture (total INTEGER, name TEXT, status TEXT, flag INTEGER);');
        $statement = $pdo->prepare('INSERT INTO fixture VALUES (?, ?, ?, ?)');
        $statement->execute([180, ' سلام ', null, 1]);
        $examples = [
            ['abs(-10)', 10, 'number'],
            ['+.5 + 1.5e1', 15.5, 'number'],
            ['1E-2 * 100', 1, 'number'],
            ['round([total] * 0.09, 2)', 16.2, 'number'],
            ['ceil(-1.2)', -1, 'number'],
            ['floor(-1.2)', -2, 'number'],
            ['upper("hello")', 'HELLO', 'text'],
            ['lower("HELLO")', 'hello', 'text'],
            ['length("سلام")', 4, 'number'],
            ['trim([name])', 'سلام', 'text'],
            ['ltrim(" hello ")', 'hello ', 'text'],
            ['rtrim(" hello ")', ' hello', 'text'],
            ['substring(trim([name]), 2, 2)', 'لا', 'text'],
            ['substring("Metabase", 5)', 'base', 'text'],
            ['replace("2026-10", "-", "/")', '2026/10', 'text'],
            ['concat("a", "b", "c")', 'abc', 'text'],
            ['contains("Metabase", "base")', 1, 'boolean'],
            ['startsWith("Metabase", "Meta")', 1, 'boolean'],
            ['startsWith("Metabase", "meta")', 0, 'boolean'],
            ['endsWith("report.csv", ".csv")', 1, 'boolean'],
            ['endsWith("report.csv", "")', 1, 'boolean'],
            ['between([total], 180, 500)', 1, 'boolean'],
            ['not([total] >= 200 OR isNull([name]))', 1, 'boolean'],
            ['coalesce([status], "pending")', 'pending', 'text'],
            ['isNull([status])', 1, 'boolean'],
            ['notNull([status])', 0, 'boolean'],
            ['if([flag], "yes", "no")', 'yes', 'text'],
            ['case([total] > 500, "high", [total] > 100, "medium", "low")', 'medium', 'text'],
            ['case([total] > 500, "high", [total] > 100, "medium")', 'medium', 'text'],
            ['case([total] > 500, "high")', null, 'text'],
            ['[total] / 0', null, 'number'],
        ];
        foreach ($examples as [$source, $expected, $type]) {
            $compiled = $this->compile($source);
            $this->assertSame($type, $compiled['type'], $source);
            $this->assertEquals($expected, $pdo->query('SELECT '.$compiled['sql'].' FROM fixture')->fetchColumn(), $source);
        }
    }

    public function test_expression_literals_are_quoted_and_do_not_execute_sql(): void
    {
        $source = 'concat("O\'Reilly", """ quoted", "\'); DROP TABLE fixture; --")';
        $compiled = $this->compile($source);
        $pdo = new PDO('sqlite::memory:');
        $pdo->exec('CREATE TABLE fixture (id INTEGER)');
        $value = $pdo->query('SELECT '.$compiled['sql'])->fetchColumn();
        $this->assertSame('O\'Reilly" quoted\'); DROP TABLE fixture; --', $value);
        $this->assertSame('fixture', $pdo->query("SELECT name FROM sqlite_master WHERE name = 'fixture'")->fetchColumn());
    }

    public function test_display_name_references_become_stable_keys_without_rewriting_string_literals(): void
    {
        $compiled = $this->compile(' if([مبلغ] > 10, concat("[نام]", [نام]), "کم") ');
        $this->assertSame(' if([total] > 10, concat("[نام]", [name]), "کم") ', $compiled['expression']);
        $this->assertSame('text', $compiled['type']);
        $this->assertStringContainsString('"total" > 10', $compiled['sql']);
        $this->assertStringContainsString("'[نام]'", $compiled['sql']);
        $this->assertSame('[total] + 1', $this->compile('[total] + 1')['expression']);
    }

    public function test_ambiguous_display_names_require_explicit_field_keys(): void
    {
        $fields = $this->fields();
        $fields['other'] = ['sql' => '"other"', 'type' => 'number', 'label' => 'مبلغ'];
        $this->assertSame('[total] + [other]', (new ExpressionCompiler)->compile('[total] + [other]', $fields, 'sqlite')['expression']);
        $this->expectException(ValidationException::class);
        (new ExpressionCompiler)->compile('[مبلغ] + 1', $fields, 'sqlite');
    }

    public function test_report_validation_canonicalizes_dependencies_before_metadata_names_change(): void
    {
        $connection = new AnalyticsConnection;
        $connection->forceFill(['id' => 17, 'owner_id' => 1, 'driver' => 'sqlite', 'catalog' => [
            ['key' => 'orders', 'fields' => [['key' => 'total', 'label' => 'مبلغ', 'type' => 'number']]],
        ]]);
        $query = [
            'connection_id' => 17, 'source' => 'orders', 'mode' => 'rows', 'columns' => ['gross'],
            'metrics' => [], 'dimensions' => [], 'filters' => [], 'sort' => [], 'joins' => [], 'limit' => 100,
            'expressions' => [
                ['key' => 'tax', 'label' => 'مالیات', 'expression' => '[مبلغ] * 0.1'],
                ['key' => 'gross', 'label' => 'قیمت نهایی', 'expression' => '[مبلغ] + [مالیات]'],
            ],
        ];
        $runner = app(ReportRunner::class);
        $canonical = $runner->validate($query, 1, $connection);
        $this->assertSame('[total] * 0.1', $canonical['expressions'][0]['expression']);
        $this->assertSame('[total] + [tax]', $canonical['expressions'][1]['expression']);
        $this->assertSame('number', $canonical['expressions'][1]['type']);
        $before = $runner->compile($canonical, $connection)['sql'];
        $connection->catalog = [['key' => 'orders', 'fields' => [['key' => 'total', 'label' => 'مبلغ سفارش', 'type' => 'number']]]];
        $canonical['expressions'][0]['label'] = 'مالیات سفارش';
        $after = $runner->validate($canonical, 1, $connection);
        $this->assertSame('[total] + [tax]', $after['expressions'][1]['expression']);
        $this->assertSame($before, $runner->compile($after, $connection)['sql']);
    }

    public function test_supported_functions_compile_to_driver_specific_sql_without_a_server(): void
    {
        $this->assertSame('trimBoth(\' text \')', $this->compile('trim(" text ")', 'clickhouse')['sql']);
        $this->assertSame('trimLeft(\' text\')', $this->compile('ltrim(" text")', 'clickhouse')['sql']);
        $this->assertSame('trimRight(\'text \')', $this->compile('rtrim("text ")', 'clickhouse')['sql']);
        $this->assertSame('substringUTF8(\'سلام\', 1, 2)', $this->compile('substring("سلام", 1, 2)', 'clickhouse')['sql']);
        $this->assertSame('replaceAll(\'a-b\', \'-\', \'/\')', $this->compile('replace("a-b", "-", "/")', 'clickhouse')['sql']);
        $this->assertSame('(positionUTF8(\'abc\', \'b\') > 0)', $this->compile('contains("abc", "b")', 'clickhouse')['sql']);
        $this->assertSame('startsWith(\'abc\', \'a\')', $this->compile('startsWith("abc", "a")', 'clickhouse')['sql']);
        $this->assertSame('endsWith(\'abc\', \'c\')', $this->compile('endsWith("abc", "c")', 'clickhouse')['sql']);
        $this->assertSame('(POSITION(\'b\' IN \'abc\') > 0)', $this->compile('contains("abc", "b")', 'pgsql')['sql']);
        $this->assertSame('SUBSTR(\'abc\', 1, 2)', $this->compile('substring("abc", 1, 2)', 'pgsql')['sql']);
        $this->assertSame('(TRUE IS NOT NULL)', $this->compile('notNull(true)', 'pgsql')['sql']);
        $this->assertStringContainsString('ELSE NULL END)', $this->compile('case(true, 1, false, 2)', 'pgsql')['sql']);
    }

    public function test_function_types_and_argument_counts_are_checked_before_sql_execution(): void
    {
        foreach ([
            'substring([total], 1)', 'substring("hello", "start")', 'substring("hello")',
            'replace("a", "b")', 'replace("a", "b", 1)', 'trim([total])',
            'contains([total], "1")', 'startsWith("text")', 'not([total])',
            'between([total], "a", "z")', 'coalesce([total], "zero")',
            'case(true, 1, false, "two")', 'case(true, 1, "fallback")', 'if(true, 1)',
            'isNull([total], 0)', 'unknown("value")', '[future] + 1',
            'load_extension("evil")', '1; SELECT 2', '"unterminated', '1e999', '1e',
        ] as $source) {
            try {
                $this->compile($source);
                $this->fail('Accepted invalid expression: '.$source);
            } catch (ValidationException $exception) {
                $this->assertArrayHasKey('expressions', $exception->errors(), $source);
            }
        }
    }

    public function test_empty_overlong_and_excessively_nested_expressions_are_rejected(): void
    {
        foreach (['', str_repeat('1+', 1001).'1', str_repeat('(', 30).'1'.str_repeat(')', 30)] as $source) {
            try {
                $this->compile($source);
                $this->fail('Accepted an invalid expression length or depth.');
            } catch (ValidationException $exception) {
                $this->assertArrayHasKey('expressions', $exception->errors());
            }
        }
    }
}
