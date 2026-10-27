<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class AnalyticsDashboardTab extends Model
{
    protected $table = 'analytics_dashboard_tabs';

    protected $guarded = ['id'];

    public $timestamps = false;
}
