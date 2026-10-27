<?php

namespace App\Enums;

use App\Enums\Concerns\HasTranslatedLabel;

enum AnalyticsMetric: string
{
    use HasTranslatedLabel;

    case COUNT = 'count';
    case SUM = 'sum';
    case AVERAGE = 'avg';
    case MINIMUM = 'min';
    case MAXIMUM = 'max';
    case COUNT_DISTINCT = 'count_distinct';
}
