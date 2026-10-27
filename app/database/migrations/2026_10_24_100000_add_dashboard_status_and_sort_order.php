<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('analytics_dashboards', function (Blueprint $table) {
            $table->boolean('is_active')->default(true);
            $table->unsignedInteger('sort_order')->default(0)->index();
        });

        $position = 0;
        DB::table('analytics_dashboards')->orderByDesc('updated_at')->orderByDesc('id')->get(['id'])->each(function ($dashboard) use (&$position) {
            DB::table('analytics_dashboards')->where('id', $dashboard->id)->update(['sort_order' => ++$position]);
        });
    }

    public function down(): void
    {
        Schema::table('analytics_dashboards', function (Blueprint $table) {
            $table->dropIndex(['sort_order']);
            $table->dropColumn(['is_active', 'sort_order']);
        });
    }
};
