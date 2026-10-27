<?php

namespace App\Enums;

use App\Enums\Concerns\HasTranslatedLabel;

enum AnalyticsJoinType: string
{
    use HasTranslatedLabel;

    case LEFT = 'left';
    case INNER = 'inner';
    case RIGHT = 'right';
    case FULL = 'full';
}
