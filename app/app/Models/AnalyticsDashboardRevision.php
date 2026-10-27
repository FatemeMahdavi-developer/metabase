<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class AnalyticsDashboardRevision extends Model
{
    protected $table = 'analytics_dashboard_revisions';

    protected $guarded = ['id'];

    public $timestamps = false;

    protected function casts(): array
    {
        return ['snapshot' => 'array', 'created_at' => 'datetime'];
    }
}
