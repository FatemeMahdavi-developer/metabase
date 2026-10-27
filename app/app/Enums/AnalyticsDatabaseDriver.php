<?php

namespace App\Enums;

use App\Enums\Concerns\HasTranslatedLabel;

enum AnalyticsDatabaseDriver: string
{
    use HasTranslatedLabel;

    case POSTGRESQL = 'pgsql';
    case CLICKHOUSE = 'clickhouse';
}
