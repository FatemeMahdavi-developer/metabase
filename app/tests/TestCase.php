<?php

namespace Tests;

use Illuminate\Foundation\Testing\TestCase as BaseTestCase;

abstract class TestCase extends BaseTestCase
{
    protected function setUp(): void
    {
        parent::setUp();

        // Query regressions use real isolated SQLite fixtures without external
        // servers. Production config and all panel choices remain Pg/ClickHouse.
        config(['analytics.connection_drivers' => [...config('analytics.connection_drivers'), 'sqlite']]);
    }
}
