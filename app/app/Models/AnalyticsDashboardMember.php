<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class AnalyticsDashboardMember extends Model
{
    protected $table = 'analytics_dashboard_members';

    protected $guarded = ['id'];

    public $timestamps = false;
}
