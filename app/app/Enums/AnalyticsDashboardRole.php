<?php

namespace App\Enums;

use App\Enums\Concerns\HasTranslatedLabel;

enum AnalyticsDashboardRole: string
{
    use HasTranslatedLabel;

    case VIEWER = 'viewer';
    case EDITOR = 'editor';
    case REMOVE = 'remove';
}
