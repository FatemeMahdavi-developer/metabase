<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

class AnalyticsDashboard extends Model
{
    protected $guarded = ['id'];

    protected function casts(): array
    {
        return ['settings' => 'array', 'is_active' => 'boolean', 'sort_order' => 'integer'];
    }

    protected static function booted(): void
    {
        static::creating(function (self $dashboard): void {
            $dashboard->sort_order ??= ((int) static::where('owner_id', $dashboard->owner_id)->max('sort_order')) + 1;
        });
    }

    public function canRead(int $userId): bool
    {
        return $this->owner_id === $userId || $this->members()->where('user_id', $userId)->exists();
    }

    public function canEdit(int $userId): bool
    {
        return $this->owner_id === $userId || $this->members()->where('user_id', $userId)->where('role', 'editor')->exists();
    }

    public function members(): HasMany
    {
        return $this->hasMany(AnalyticsDashboardMember::class, 'dashboard_id');
    }

    public function widgets(): HasMany
    {
        return $this->hasMany(AnalyticsDashboardWidget::class, 'dashboard_id');
    }

    public function filters(): HasMany
    {
        return $this->hasMany(AnalyticsDashboardFilter::class, 'dashboard_id');
    }

    public function tabs(): HasMany
    {
        return $this->hasMany(AnalyticsDashboardTab::class, 'dashboard_id');
    }
}
