<?php

namespace App\Enums;

use App\Enums\Concerns\HasTranslatedLabel;

enum AnalyticsTimeGrain: string
{
    use HasTranslatedLabel;

    case DAY = 'day';
    case WEEK = 'week';
    case MONTH = 'month';
    case QUARTER = 'quarter';
    case YEAR = 'year';
}
