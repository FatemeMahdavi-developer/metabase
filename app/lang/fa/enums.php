<?php

use App\Enums\AnalyticsDashboardRole;
use App\Enums\AnalyticsDatabaseDriver;
use App\Enums\AnalyticsDisplay;
use App\Enums\AnalyticsFieldType;
use App\Enums\AnalyticsFilterOperator;
use App\Enums\AnalyticsJoinType;
use App\Enums\AnalyticsMetric;
use App\Enums\AnalyticsSslMode;
use App\Enums\AnalyticsTimeGrain;

return [
    AnalyticsDatabaseDriver::class => [
        AnalyticsDatabaseDriver::POSTGRESQL->name => 'PostgreSQL',
        AnalyticsDatabaseDriver::CLICKHOUSE->name => 'ClickHouse',
    ],
    AnalyticsSslMode::class => [
        AnalyticsSslMode::DISABLE->name => 'غیرفعال',
        AnalyticsSslMode::PREFER->name => 'ترجیح اتصال امن',
        AnalyticsSslMode::REQUIRE->name => 'الزام اتصال امن',
        AnalyticsSslMode::VERIFY_FULL->name => 'بررسی کامل گواهی',
    ],
    AnalyticsDashboardRole::class => [
        AnalyticsDashboardRole::VIEWER->name => 'مشاهده',
        AnalyticsDashboardRole::EDITOR->name => 'ویرایش',
        AnalyticsDashboardRole::REMOVE->name => 'حذف دسترسی',
    ],
    AnalyticsMetric::class => [
        AnalyticsMetric::COUNT->name => 'تعداد ردیف‌ها',
        AnalyticsMetric::SUM->name => 'مجموع',
        AnalyticsMetric::AVERAGE->name => 'میانگین',
        AnalyticsMetric::MINIMUM->name => 'کمینه',
        AnalyticsMetric::MAXIMUM->name => 'بیشینه',
        AnalyticsMetric::COUNT_DISTINCT->name => 'تعداد مقادیر یکتا',
    ],
    AnalyticsTimeGrain::class => [
        AnalyticsTimeGrain::DAY->name => 'روز',
        AnalyticsTimeGrain::WEEK->name => 'هفته',
        AnalyticsTimeGrain::MONTH->name => 'ماه',
        AnalyticsTimeGrain::QUARTER->name => 'فصل',
        AnalyticsTimeGrain::YEAR->name => 'سال',
    ],
    AnalyticsFieldType::class => [
        AnalyticsFieldType::TEXT->name => 'متن یا دسته‌بندی',
        AnalyticsFieldType::NUMBER->name => 'عدد',
        AnalyticsFieldType::DATE->name => 'تاریخ',
        AnalyticsFieldType::BOOLEAN->name => 'بله / خیر',
        AnalyticsFieldType::TIME_GRAIN->name => 'گروه‌بندی زمانی',
    ],
    AnalyticsFilterOperator::class => [
        AnalyticsFilterOperator::EQUAL->name => 'برابر با',
        AnalyticsFilterOperator::NOT_EQUAL->name => 'نابرابر با',
        AnalyticsFilterOperator::IN->name => 'یکی از مقادیر',
        AnalyticsFilterOperator::NOT_IN->name => 'به‌جز مقادیر',
        AnalyticsFilterOperator::GREATER_THAN->name => 'بزرگ‌تر از',
        AnalyticsFilterOperator::GREATER_THAN_OR_EQUAL->name => 'بزرگ‌تر یا مساوی',
        AnalyticsFilterOperator::LESS_THAN->name => 'کوچک‌تر از',
        AnalyticsFilterOperator::LESS_THAN_OR_EQUAL->name => 'کوچک‌تر یا مساوی',
        AnalyticsFilterOperator::BETWEEN->name => 'بین',
        AnalyticsFilterOperator::NOT_BETWEEN->name => 'خارج از بازه',
        AnalyticsFilterOperator::CONTAINS->name => 'شامل',
        AnalyticsFilterOperator::NOT_CONTAINS->name => 'شامل نباشد',
        AnalyticsFilterOperator::STARTS_WITH->name => 'شروع شود با',
        AnalyticsFilterOperator::ENDS_WITH->name => 'پایان یابد با',
        AnalyticsFilterOperator::IS_NULL->name => 'تهی باشد',
        AnalyticsFilterOperator::NOT_NULL->name => 'تهی نباشد',
        AnalyticsFilterOperator::IS_EMPTY->name => 'خالی باشد',
        AnalyticsFilterOperator::NOT_EMPTY->name => 'خالی نباشد',
        AnalyticsFilterOperator::GRAIN->name => 'گروه‌بندی زمانی',
    ],
    AnalyticsDisplay::class => [
        AnalyticsDisplay::TABLE->name => 'جدول',
        AnalyticsDisplay::BAR->name => 'میله‌ای',
        AnalyticsDisplay::LINE->name => 'خطی',
        AnalyticsDisplay::AREA->name => 'ناحیه‌ای',
        AnalyticsDisplay::PIE->name => 'دایره‌ای',
        AnalyticsDisplay::DOUGHNUT->name => 'دونات',
        AnalyticsDisplay::NUMBER->name => 'عدد',
        AnalyticsDisplay::PROGRESS->name => 'پیشرفت',
        AnalyticsDisplay::GAUGE->name => 'گیج',
        AnalyticsDisplay::SCATTER->name => 'پراکندگی',
        AnalyticsDisplay::FUNNEL->name => 'قیفی',
        AnalyticsDisplay::PIVOT->name => 'جدول محوری',
    ],
    AnalyticsJoinType::class => [
        AnalyticsJoinType::LEFT->name => 'LEFT JOIN — همهٔ ردیف‌های چپ',
        AnalyticsJoinType::INNER->name => 'INNER JOIN — ردیف‌های منطبق',
        AnalyticsJoinType::RIGHT->name => 'RIGHT JOIN — همهٔ ردیف‌های راست',
        AnalyticsJoinType::FULL->name => 'FULL JOIN — همهٔ ردیف‌ها',
    ],
];
