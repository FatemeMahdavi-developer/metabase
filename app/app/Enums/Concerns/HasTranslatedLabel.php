<?php

namespace App\Enums\Concerns;

use Illuminate\Support\Facades\Lang;

trait HasTranslatedLabel
{
    public function label(): string
    {
        return Lang::get('enums.'.static::class.'.'.$this->name);
    }

    public static function options(): array
    {
        return collect(static::cases())
            ->mapWithKeys(fn (self $case): array => [$case->value => $case->label()])
            ->all();
    }
}
