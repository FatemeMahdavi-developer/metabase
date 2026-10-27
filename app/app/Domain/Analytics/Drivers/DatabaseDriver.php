<?php

namespace App\Domain\Analytics\Drivers;

interface DatabaseDriver
{
    public function catalog(): array;

    public function select(string $sql, array $bindings = []): array;
}
