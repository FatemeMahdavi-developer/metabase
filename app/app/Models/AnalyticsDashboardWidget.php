<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class AnalyticsDashboardWidget extends Model
{
    protected $table = 'analytics_dashboard_widgets';

    protected $guarded = ['id'];

    public $timestamps = false;

    protected function casts(): array
    {
        return ['settings' => 'array', 'click_behavior' => 'array'];
    }

    public function report(): BelongsTo
    {
        return $this->belongsTo(AnalyticsReport::class, 'report_id');
    }

    public function dashboard(): BelongsTo
    {
        return $this->belongsTo(AnalyticsDashboard::class, 'dashboard_id');
    }
}
