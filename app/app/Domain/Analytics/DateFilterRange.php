<?php

namespace App\Domain\Analytics;

use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\Validator;

class DateFilterRange
{
    public function validateRelative(array $value): array
    {
        $data = Validator::make(['relative_date' => $value], [
            'relative_date' => 'required|array:unit,amount,direction,include_current',
            'relative_date.unit' => 'required|in:day,week,month,quarter,year',
            'relative_date.amount' => 'required|integer|min:1|max:365',
            'relative_date.direction' => 'required|in:past,future,current',
            'relative_date.include_current' => 'sometimes|boolean',
        ])->validate()['relative_date'];

        return ['unit' => $data['unit'], 'amount' => (int) $data['amount'], 'direction' => $data['direction'], 'include_current' => (bool) ($data['include_current'] ?? false)];
    }

    public function relativeRange(array $value): array
    {
        $data = $this->validateRelative($value);
        $today = CarbonImmutable::today(config('app.timezone'));
        $start = match ($data['unit']) {
            'day' => $today, 'week' => $today->startOfWeek(), 'month' => $today->startOfMonth(),
            'quarter' => $today->firstOfQuarter(), 'year' => $today->startOfYear(),
        };
        $shift = fn ($date, $amount) => match ($data['unit']) {
            'day' => $date->addDays($amount), 'week' => $date->addWeeks($amount),
            'month' => $date->addMonthsNoOverflow($amount), 'quarter' => $date->addMonthsNoOverflow($amount * 3), 'year' => $date->addYearsNoOverflow($amount),
        };
        [$from, $to] = match ($data['direction']) {
            'current' => [$start, $shift($start, 1)->subDay()],
            'past' => [$shift($start, -$data['amount']), $data['include_current'] ? $shift($start, 1)->subDay() : $start->subDay()],
            'future' => [$data['include_current'] ? $start : $shift($start, 1), $shift($start, $data['amount'] + 1)->subDay()],
        };

        return [$from->format('Y-m-d'), $to->format('Y-m-d')];
    }

    public function parameterRange(array $value): array
    {
        if (($value['kind'] ?? '') === 'date_range') {
            $data = Validator::make($value, ['from' => 'required|date_format:Y-m-d', 'to' => 'required|date_format:Y-m-d|after_or_equal:from', 'exclude' => 'sometimes|boolean'])->validate();

            return [$data['from'], $data['to'], (bool) ($data['exclude'] ?? false)];
        }
        $data = Validator::make($value, ['kind' => 'required|in:relative_date', 'unit' => 'required|in:day,week,month,quarter,year', 'amount' => 'required|integer|min:1|max:365', 'direction' => 'required|in:past,future,current', 'include_current' => 'sometimes|boolean', 'exclude' => 'sometimes|boolean'])->validate();
        [$from, $to] = $this->relativeRange(array_intersect_key($data, array_flip(['unit', 'amount', 'direction', 'include_current'])));

        return [$from, $to, (bool) ($data['exclude'] ?? false)];
    }
}
