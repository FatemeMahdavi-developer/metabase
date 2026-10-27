<?php

namespace App\Enums;

use App\Enums\Concerns\HasTranslatedLabel;

enum AnalyticsDisplay: string
{
    use HasTranslatedLabel;

    case TABLE = 'table';
    case BAR = 'bar';
    case LINE = 'line';
    case AREA = 'area';
    case PIE = 'pie';
    case DOUGHNUT = 'doughnut';
    case NUMBER = 'number';
    case PROGRESS = 'progress';
    case GAUGE = 'gauge';
    case SCATTER = 'scatter';
    case FUNNEL = 'funnel';
    case PIVOT = 'pivot';
}
