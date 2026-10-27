<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class AnalyticsFilterBinding extends Model
{
    protected $table = 'analytics_filter_bindings';

    protected $guarded = ['id'];

    public $timestamps = false;
}
