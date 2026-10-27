<?php

namespace App\Enums;

use App\Enums\Concerns\HasTranslatedLabel;

enum AnalyticsFilterOperator: string
{
    use HasTranslatedLabel;

    case EQUAL = 'eq';
    case NOT_EQUAL = 'neq';
    case IN = 'in';
    case NOT_IN = 'not_in';
    case GREATER_THAN = 'gt';
    case GREATER_THAN_OR_EQUAL = 'gte';
    case LESS_THAN = 'lt';
    case LESS_THAN_OR_EQUAL = 'lte';
    case BETWEEN = 'between';
    case NOT_BETWEEN = 'not_between';
    case CONTAINS = 'contains';
    case NOT_CONTAINS = 'not_contains';
    case STARTS_WITH = 'starts_with';
    case ENDS_WITH = 'ends_with';
    case IS_NULL = 'is_null';
    case NOT_NULL = 'not_null';
    case IS_EMPTY = 'is_empty';
    case NOT_EMPTY = 'not_empty';
    case GRAIN = 'grain';
}
