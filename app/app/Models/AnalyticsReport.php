<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class AnalyticsReport extends Model
{
    protected $guarded = ['id'];

    protected function casts(): array
    {
        return ['query_definition' => 'array', 'visualization_settings' => 'array'];
    }
}
