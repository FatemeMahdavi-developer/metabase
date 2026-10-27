<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('analytics_folders', function (Blueprint $table) {
            $table->id();
            $table->foreignId('owner_id')->constrained('users')->cascadeOnDelete();
            $table->string('name');
            $table->timestamps();
        });
        Schema::create('analytics_records', function (Blueprint $table) {
            $table->id();
            $table->foreignId('owner_id')->constrained('users')->cascadeOnDelete();
            $table->date('ordered_at');
            $table->string('category');
            $table->string('city');
            $table->string('status');
            $table->decimal('amount', 16, 2);
            $table->unsignedInteger('quantity');
            $table->string('customer');
            $table->timestamps();
            $table->index(['owner_id', 'ordered_at']);
        });
        Schema::create('analytics_reports', function (Blueprint $table) {
            $table->id();
            $table->foreignId('owner_id')->constrained('users')->cascadeOnDelete();
            $table->foreignId('folder_id')->nullable()->constrained('analytics_folders')->nullOnDelete();
            $table->string('name');
            $table->text('description')->nullable();
            $table->json('query_definition');
            $table->string('display')->default('bar');
            $table->json('visualization_settings');
            $table->unsignedInteger('version')->default(1);
            $table->timestamps();
        });
        Schema::create('analytics_dashboards', function (Blueprint $table) {
            $table->id();
            $table->foreignId('owner_id')->constrained('users')->cascadeOnDelete();
            $table->foreignId('folder_id')->nullable()->constrained('analytics_folders')->nullOnDelete();
            $table->string('name');
            $table->text('description')->nullable();
            $table->json('settings');
            $table->unsignedInteger('version')->default(1);
            $table->timestamps();
        });
        Schema::create('analytics_dashboard_tabs', function (Blueprint $table) {
            $table->id();
            $table->foreignId('dashboard_id')->constrained('analytics_dashboards')->cascadeOnDelete();
            $table->string('key', 80);
            $table->string('name');
            $table->unsignedInteger('position');
            $table->unique(['dashboard_id', 'key']);
        });
        Schema::create('analytics_dashboard_widgets', function (Blueprint $table) {
            $table->id();
            $table->foreignId('dashboard_id')->constrained('analytics_dashboards')->cascadeOnDelete();
            $table->foreignId('report_id')->nullable()->constrained('analytics_reports')->restrictOnDelete();
            $table->string('key', 80);
            $table->string('tab_key', 80);
            $table->string('type');
            $table->unsignedInteger('x');
            $table->unsignedInteger('y');
            $table->unsignedInteger('w');
            $table->unsignedInteger('h');
            $table->json('settings');
            $table->text('content')->nullable();
            $table->json('click_behavior')->nullable();
            $table->unique(['dashboard_id', 'key']);
        });
        Schema::create('analytics_dashboard_filters', function (Blueprint $table) {
            $table->id();
            $table->foreignId('dashboard_id')->constrained('analytics_dashboards')->cascadeOnDelete();
            $table->string('key', 80);
            $table->string('label');
            $table->string('type');
            $table->json('default_value')->nullable();
            $table->boolean('required')->default(false);
            $table->unsignedInteger('position');
            $table->json('settings');
            $table->unique(['dashboard_id', 'key']);
        });
        Schema::create('analytics_filter_bindings', function (Blueprint $table) {
            $table->id();
            $table->foreignId('filter_id')->constrained('analytics_dashboard_filters')->cascadeOnDelete();
            $table->foreignId('widget_id')->constrained('analytics_dashboard_widgets')->cascadeOnDelete();
            $table->string('target');
            $table->string('operator');
            $table->unique(['filter_id', 'widget_id']);
        });
        Schema::create('analytics_dashboard_revisions', function (Blueprint $table) {
            $table->id();
            $table->foreignId('dashboard_id')->constrained('analytics_dashboards')->cascadeOnDelete();
            $table->foreignId('created_by')->constrained('users');
            $table->unsignedInteger('version');
            $table->json('snapshot');
            $table->timestamp('created_at');
            $table->unique(['dashboard_id', 'version']);
        });
        Schema::create('analytics_dashboard_members', function (Blueprint $table) {
            $table->id();
            $table->foreignId('dashboard_id')->constrained('analytics_dashboards')->cascadeOnDelete();
            $table->foreignId('user_id')->constrained('users')->cascadeOnDelete();
            $table->string('role');
            $table->unique(['dashboard_id', 'user_id']);
        });
    }

    public function down(): void
    {
        foreach (['analytics_dashboard_members', 'analytics_dashboard_revisions', 'analytics_filter_bindings', 'analytics_dashboard_filters', 'analytics_dashboard_widgets', 'analytics_dashboard_tabs', 'analytics_dashboards', 'analytics_reports', 'analytics_records', 'analytics_folders'] as $table) {
            Schema::dropIfExists($table);
        }
    }
};
