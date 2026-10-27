<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

class AnalyticsDashboardFilter extends Model
{
    protected $table = 'analytics_dashboard_filters';

    protected $guarded = ['id'];

    public $timestamps = false;

    protected function casts(): array
    {
        return ['settings' => 'array', 'default_value' => 'json', 'required' => 'boolean'];
    }

    public function bindings(): HasMany
    {
        return $this->hasMany(AnalyticsFilterBinding::class, 'filter_id');
    }
}
