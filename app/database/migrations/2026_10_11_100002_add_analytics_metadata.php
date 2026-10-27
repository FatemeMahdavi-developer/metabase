<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('analytics_connections', function (Blueprint $table) {
            $table->json('metadata')->nullable();
        });
    }

    public function down(): void
    {
        Schema::table('analytics_connections', function (Blueprint $table) {
            $table->dropColumn('metadata');
        });
    }
};
