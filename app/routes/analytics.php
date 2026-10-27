<?php

use App\Http\Controllers\AnalyticsController;
use Illuminate\Support\Facades\Route;

Route::prefix('analytics/api')->middleware(['auth', 'throttle:180,1'])->group(function () {
    Route::get('library', [AnalyticsController::class, 'index']);
    Route::post('connections/test', [AnalyticsController::class, 'connectionTest'])->middleware('throttle:20,1');
    Route::post('connections', [AnalyticsController::class, 'connectionSave']);
    Route::put('connections/{connection}', [AnalyticsController::class, 'connectionSave']);
    Route::post('connections/{connection}/sync', [AnalyticsController::class, 'connectionSync']);
    Route::put('connections/{connection}/metadata', [AnalyticsController::class, 'connectionMetadata']);
    Route::delete('connections/{connection}', [AnalyticsController::class, 'connectionDelete']);
    Route::post('folders', [AnalyticsController::class, 'folderSave']);
    Route::post('reports/preview', [AnalyticsController::class, 'preview']);
    Route::post('reports/validate', [AnalyticsController::class, 'validateDefinition']);
    Route::post('reports/expression/validate', [AnalyticsController::class, 'validateExpression']);
    Route::post('reports/interactions/options', [AnalyticsController::class, 'reportInteraction']);
    Route::post('reports/interactions/apply', [AnalyticsController::class, 'reportInteraction']);
    Route::post('reports', [AnalyticsController::class, 'reportSave']);
    Route::get('reports/{report}', [AnalyticsController::class, 'reportShow']);
    Route::put('reports/{report}', [AnalyticsController::class, 'reportSave']);
    Route::post('reports/{report}/query', [AnalyticsController::class, 'reportQuery']);
    Route::delete('reports/{report}', [AnalyticsController::class, 'reportDelete']);
    Route::post('dashboards', [AnalyticsController::class, 'dashboardCreate']);
    Route::get('dashboards/{dashboard}', [AnalyticsController::class, 'dashboardShow']);
    Route::put('dashboards/{dashboard}', [AnalyticsController::class, 'dashboardSave']);
    Route::delete('dashboards/{dashboard}', [AnalyticsController::class, 'dashboardDelete']);
    Route::post('dashboards/{dashboard}/copy', [AnalyticsController::class, 'dashboardCopy']);
    Route::post('dashboards/{dashboard}/widgets/{widget}/query', [AnalyticsController::class, 'widgetQuery']);
    Route::post('dashboards/{dashboard}/widgets/{widget}/interactions/options', [AnalyticsController::class, 'widgetInteraction']);
    Route::post('dashboards/{dashboard}/widgets/{widget}/interactions/apply', [AnalyticsController::class, 'widgetInteraction']);
    Route::post('dashboards/{dashboard}/widgets/{widget}/click-report', [AnalyticsController::class, 'widgetClickReport']);
    Route::post('dashboards/{dashboard}/widgets/{widget}/preview', [AnalyticsController::class, 'dashboardPreview']);
    Route::post('dashboards/{dashboard}/filters/{filter}/options', [AnalyticsController::class, 'filterOptions']);
    Route::get('dashboards/{dashboard}/revisions', [AnalyticsController::class, 'revisions']);
    Route::post('dashboards/{dashboard}/revisions/{revision}/restore', [AnalyticsController::class, 'restore']);
    Route::post('dashboards/{dashboard}/share', [AnalyticsController::class, 'share']);
});
