<?php

namespace App\Enums;

use App\Enums\Concerns\HasTranslatedLabel;

enum AnalyticsSslMode: string
{
    use HasTranslatedLabel;

    case DISABLE = 'disable';
    case PREFER = 'prefer';
    case REQUIRE = 'require';
    case VERIFY_FULL = 'verify-full';
}
