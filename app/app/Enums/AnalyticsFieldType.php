<?php

namespace App\Enums;

use App\Enums\Concerns\HasTranslatedLabel;

enum AnalyticsFieldType: string
{
    use HasTranslatedLabel;

    case TEXT = 'text';
    case NUMBER = 'number';
    case DATE = 'date';
    case BOOLEAN = 'boolean';
    case TIME_GRAIN = 'time_grain';
}
