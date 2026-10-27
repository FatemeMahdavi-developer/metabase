<?php

namespace Tests\Unit;

use App\Domain\Analytics\Filament\WorkbenchForms;
use App\Enums\AnalyticsDatabaseDriver;
use App\Enums\AnalyticsDisplay;
use App\Enums\AnalyticsFilterOperator;
use App\Enums\AnalyticsJoinType;
use App\Enums\AnalyticsSslMode;
use Tests\TestCase;

class AnalyticsTranslationsTest extends TestCase
{
    public function test_enum_values_keep_the_persisted_contract_and_labels_come_from_lang(): void
    {
        app()->setLocale('fa');

        $this->assertSame(['pgsql', 'clickhouse'], array_column(AnalyticsDatabaseDriver::cases(), 'value'));
        $this->assertSame('PostgreSQL', AnalyticsDatabaseDriver::POSTGRESQL->label());
        $this->assertSame('بررسی کامل گواهی', AnalyticsSslMode::VERIFY_FULL->label());
        $this->assertSame('دونات', AnalyticsDisplay::DOUGHNUT->label());
        $this->assertSame('خارج از بازه', AnalyticsFilterOperator::NOT_BETWEEN->label());
        $this->assertSame('INNER JOIN — ردیف‌های منطبق', AnalyticsJoinType::INNER->label());
    }

    public function test_workbench_titles_are_resolved_from_the_analytics_language_file(): void
    {
        app()->setLocale('fa');

        $this->assertSame('ذخیرهٔ گزارش', WorkbenchForms::title('report'));
        $this->assertSame('رفتار کلیک', WorkbenchForms::title('click'));
        $this->assertSame('نام', __('analytics.forms.fields.name'));
    }
}
