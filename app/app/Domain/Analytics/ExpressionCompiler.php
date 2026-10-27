<?php

namespace App\Domain\Analytics;

use Illuminate\Validation\ValidationException;

/** A small expression grammar; user input is never inserted as SQL syntax. */
class ExpressionCompiler
{
    private const NUMBER = '(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+\-]?\d+)?';

    private array $tokens = [];

    private array $tokenSpans = [];

    private int $position = 0;

    private array $fields = [];

    private string $driver;

    public function compile(string $expression, array $fields, string $driver): array
    {
        if (mb_strlen($expression) > 2000 || trim($expression) === '') {
            $this->invalid('فرمول را وارد کنید؛ طول آن باید حداکثر ۲۰۰۰ نویسه باشد.');
        }
        $this->fields = $fields;
        $this->driver = $driver;
        $this->tokens = [];
        $this->tokenSpans = [];
        $this->position = 0;
        $offset = 0;
        while ($offset < strlen($expression)) {
            if (! preg_match('/\G\s*(\[[^\]\r\n]+\]|'.self::NUMBER.'|"(?:""|[^"\r\n])*"|[a-zA-Z_][a-zA-Z_0-9]*|>=|<=|!=|[=<>()+*\/,\-])/', $expression, $match, 0, $offset)) {
                if (trim(substr($expression, $offset)) === '') {
                    break;
                }
                $this->invalid();
            }
            $this->tokens[] = $match[1];
            $this->tokenSpans[] = ['offset' => $offset + strlen($match[0]) - strlen($match[1]), 'length' => strlen($match[1])];
            $offset += strlen($match[0]);
            if (count($this->tokens) > 200) {
                $this->invalid();
            }
        }
        $result = $this->expression();
        if ($this->position !== count($this->tokens)) {
            $this->invalid();
        }

        $canonical = '';
        $offset = 0;
        foreach ($this->tokenSpans as $index => $span) {
            $canonical .= substr($expression, $offset, $span['offset'] - $offset).$this->tokens[$index];
            $offset = $span['offset'] + $span['length'];
        }

        return [...$result, 'expression' => $canonical.substr($expression, $offset)];
    }

    private function expression(int $minimum = 0, int $depth = 0): array
    {
        if ($depth > 25) {
            $this->invalid();
        }
        $token = $this->tokens[$this->position++] ?? '';
        if ($token === '(') {
            $left = $this->expression(0, $depth + 1);
            $this->consume(')');
        } elseif (in_array($token, ['-', '+'])) {
            $left = $this->expression(30, $depth + 1);
            $this->numeric($left);
            $left['sql'] = '('.$token.$left['sql'].')';
        } elseif (str_starts_with($token, '[')) {
            $name = substr($token, 1, -1);
            $key = $name;
            $field = $this->fields[$key] ?? null;
            if (! $field) {
                $matches = array_filter($this->fields, fn ($column) => ($column['label'] ?? null) === $name || in_array($name, $column['display_names'] ?? [], true));
                if (count($matches) > 1) {
                    $this->invalid('نام نمایشی '.$name.' مبهم است؛ ستون موردنظر را از پیشنهادها انتخاب کنید.');
                }
                $key = array_key_first($matches);
                $field = $key === null ? null : $matches[$key];
            }
            if (! $field) {
                $this->invalid('ستون '.$name.' در این مرحله موجود نیست. ستون را از پیشنهادها انتخاب کنید.');
            }
            $this->tokens[$this->position - 1] = '['.$key.']';
            $left = ['sql' => $field['sql'], 'type' => $field['type']];
        } elseif (preg_match('/^'.self::NUMBER.'$/D', $token)) {
            if (! is_finite((float) $token)) {
                $this->invalid('عدد واردشده از محدودهٔ قابل محاسبه بزرگ‌تر است.');
            }
            $left = ['sql' => $token, 'type' => 'number'];
        } elseif (str_starts_with($token, '"')) {
            $value = str_replace('""', '"', substr($token, 1, -1));
            if ($this->driver === 'clickhouse') {
                $value = str_replace('\\', '\\\\', $value);
            }
            $left = ['sql' => "'".str_replace("'", "''", $value)."'", 'type' => 'text'];
        } elseif (in_array(strtolower($token), ['true', 'false'], true)) {
            $left = ['sql' => $this->driver === 'pgsql' ? strtoupper($token) : (strtolower($token) === 'true' ? '1' : '0'), 'type' => 'boolean'];
        } else {
            $name = strtolower($token);
            if (! in_array($name, ['abs', 'round', 'ceil', 'floor', 'coalesce', 'upper', 'lower', 'length', 'concat', 'if', 'case', 'trim', 'ltrim', 'rtrim', 'substring', 'replace', 'contains', 'startswith', 'endswith', 'isnull', 'notnull', 'not', 'between'], true)) {
                $this->invalid('تابع '.($token ?: 'نامشخص').' پشتیبانی نمی‌شود. تابع را از فهرست توابع انتخاب کنید.');
            }
            $this->consume('(');
            $arguments = [$this->expression(0, $depth + 1)];
            while (($this->tokens[$this->position] ?? null) === ',') {
                $this->position++;
                $arguments[] = $this->expression(0, $depth + 1);
            }
            $this->consume(')');
            $count = count($arguments);
            if ($count > 10 || (in_array($name, ['abs', 'ceil', 'floor', 'upper', 'lower', 'length', 'trim', 'ltrim', 'rtrim', 'isnull', 'notnull', 'not']) && $count !== 1) || ($name === 'round' && $count > 2) || (in_array($name, ['coalesce', 'concat']) && $count < 2) || (in_array($name, ['contains', 'startswith', 'endswith']) && $count !== 2) || (in_array($name, ['replace', 'between']) && $count !== 3) || ($name === 'substring' && ! in_array($count, [2, 3]))) {
                $this->invalid('تعداد آرگومان‌های تابع '.$token.' درست نیست. الگوی تابع را در راهنما بررسی کنید.');
            }
            if (in_array($name, ['if', 'case'])) {
                if (($name === 'if' && $count !== 3) || ($name === 'case' && $count < 2)) {
                    $this->invalid('تابع شرطی به یک شرط و نتیجه نیاز دارد. برای if نتیجهٔ جایگزین را هم وارد کنید.');
                }
                $resultType = $arguments[1]['type'];
                for ($index = 0; $index + 1 < $count; $index += 2) {
                    if ($arguments[$index]['type'] !== 'boolean' || $arguments[$index + 1]['type'] !== $resultType) {
                        $this->invalid('در تابع شرطی، شرط‌ها باید بله/خیر و همهٔ نتیجه‌ها باید هم‌نوع باشند.');
                    }
                }
                if ($count % 2 && $arguments[$count - 1]['type'] !== $resultType) {
                    $this->invalid('نتیجهٔ جایگزین تابع شرطی باید با سایر نتیجه‌ها هم‌نوع باشد.');
                }
            } elseif (in_array($name, ['abs', 'round', 'ceil', 'floor'])) {
                foreach ($arguments as $argument) {
                    $this->numeric($argument);
                }
            } elseif ($name === 'substring') {
                if ($arguments[0]['type'] !== 'text') {
                    $this->invalid('آرگومان اول substring باید متن باشد.');
                }
                foreach (array_slice($arguments, 1) as $argument) {
                    $this->numeric($argument);
                }
            } elseif ($name === 'not') {
                if ($arguments[0]['type'] !== 'boolean') {
                    $this->invalid('تابع not به یک شرط بله/خیر نیاز دارد.');
                }
            } elseif (in_array($name, ['isnull', 'notnull'])) {
                // NULL checks accept every field type.
            } elseif ($name === 'between') {
                if (count(array_unique(array_column($arguments, 'type'))) !== 1 || $arguments[0]['type'] === 'boolean') {
                    $this->invalid('آرگومان‌های between باید هم‌نوع و عدد، متن یا تاریخ باشند.');
                }
            } elseif ($name !== 'coalesce') {
                foreach ($arguments as $argument) {
                    if ($argument['type'] !== 'text') {
                        $this->invalid();
                    }
                }
            } elseif (count(array_unique(array_column($arguments, 'type'))) !== 1) {
                $this->invalid();
            }
            $type = match ($name) {
                'upper', 'lower', 'concat', 'trim', 'ltrim', 'rtrim', 'substring', 'replace' => 'text',
                'contains', 'startswith', 'endswith', 'isnull', 'notnull', 'not', 'between' => 'boolean',
                'coalesce' => $arguments[0]['type'], 'if', 'case' => $arguments[1]['type'], default => 'number',
            };
            $sqlArguments = array_column($arguments, 'sql');
            $sqlName = $this->driver === 'clickhouse' ? ['upper' => 'upperUTF8', 'lower' => 'lowerUTF8', 'length' => 'lengthUTF8', 'coalesce' => 'coalesce'][$name] ?? $name : strtoupper($name);
            $sql = $name === 'concat' && $this->driver === 'sqlite' ? '('.implode(' || ', $sqlArguments).')' : $sqlName.'('.implode(', ', $sqlArguments).')';
            if (in_array($name, ['if', 'case'])) {
                $sql = '(CASE';
                for ($index = 0; $index + 1 < $count; $index += 2) {
                    $sql .= ' WHEN '.$sqlArguments[$index].' THEN '.$sqlArguments[$index + 1];
                }
                $sql .= ' ELSE '.($count % 2 ? $sqlArguments[$count - 1] : 'NULL').' END)';
            }
            if ($name === 'substring') {
                $sql = ($this->driver === 'clickhouse' ? 'substringUTF8' : 'SUBSTR').'('.implode(', ', $sqlArguments).')';
            }
            if ($this->driver === 'clickhouse' && in_array($name, ['trim', 'ltrim', 'rtrim', 'replace'])) {
                $sqlName = ['trim' => 'trimBoth', 'ltrim' => 'trimLeft', 'rtrim' => 'trimRight', 'replace' => 'replaceAll'][$name];
                $sql = $sqlName.'('.implode(', ', $sqlArguments).')';
            }
            if (in_array($name, ['contains', 'startswith', 'endswith'])) {
                [$haystack, $needle] = $sqlArguments;
                if ($this->driver === 'clickhouse') {
                    $sql = $name === 'contains' ? '(positionUTF8('.$haystack.', '.$needle.') > 0)' : ($name === 'startswith' ? 'startsWith' : 'endsWith').'('.$haystack.', '.$needle.')';
                } elseif ($name === 'contains') {
                    $sql = $this->driver === 'pgsql' ? '(POSITION('.$needle.' IN '.$haystack.') > 0)' : '(INSTR('.$haystack.', '.$needle.') > 0)';
                } elseif ($name === 'startswith') {
                    $sql = '(SUBSTR('.$haystack.', 1, LENGTH('.$needle.')) = '.$needle.')';
                } else {
                    $sql = '(LENGTH('.$needle.') = 0 OR SUBSTR('.$haystack.', LENGTH('.$haystack.') - LENGTH('.$needle.') + 1) = '.$needle.')';
                }
            }
            if (in_array($name, ['isnull', 'notnull'])) {
                $sql = '('.$sqlArguments[0].' IS '.($name === 'notnull' ? 'NOT ' : '').'NULL)';
            }
            if ($name === 'not') {
                $sql = '(NOT '.$sqlArguments[0].')';
            }
            if ($name === 'between') {
                $sql = '('.$sqlArguments[0].' BETWEEN '.$sqlArguments[1].' AND '.$sqlArguments[2].')';
            }
            if ($this->driver === 'sqlite' && in_array($name, ['ceil', 'floor'])) {
                $argument = $sqlArguments[0];
                $comparison = $name === 'ceil' ? '>' : '<';
                $sql = '(CAST('.$argument.' AS INTEGER) + CASE WHEN '.$argument.' '.$comparison.' CAST('.$argument.' AS INTEGER) THEN '.($name === 'ceil' ? '1' : '-1').' ELSE 0 END)';
            }
            $left = ['sql' => $sql, 'type' => $type];
        }
        while (true) {
            $operator = strtolower($this->tokens[$this->position] ?? '');
            $priority = ['or' => 1, 'and' => 2, '=' => 5, '!=' => 5, '>' => 5, '>=' => 5, '<' => 5, '<=' => 5, '+' => 10, '-' => 10, '*' => 20, '/' => 20][$operator] ?? -1;
            if ($priority < $minimum) {
                break;
            }
            $this->position++;
            $right = $this->expression($priority + 1, $depth + 1);
            $type = 'number';
            if ($priority <= 5) {
                if ($left['type'] !== $right['type'] || ($priority <= 2 && $left['type'] !== 'boolean')) {
                    $this->invalid();
                }
                $type = 'boolean';
            } else {
                $this->numeric($left);
                $this->numeric($right);
            }
            $sql = $operator === '/' ? '('.$left['sql'].' * 1.0 / NULLIF('.$right['sql'].', 0))' : '('.$left['sql'].' '.strtoupper($operator).' '.$right['sql'].')';
            $left = ['sql' => $sql, 'type' => $type];
        }

        return $left;
    }

    private function consume(string $expected): void
    {
        if (($this->tokens[$this->position++] ?? null) !== $expected) {
            $this->invalid();
        }
    }

    private function numeric(array $value): void
    {
        if ($value['type'] !== 'number') {
            $this->invalid();
        }
    }

    private function invalid(?string $message = null): never
    {
        throw ValidationException::withMessages(['expressions' => $message ?? 'فرمول معتبر نیست؛ نام ستون را داخل [ ] بنویسید و از عملگرها یا توابع پشتیبانی‌شده استفاده کنید.']);
    }
}
