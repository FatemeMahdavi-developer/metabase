import { test, expect } from '@playwright/test';
import { login } from './helpers/native-analytics.js';

test('PostgreSQL table prefixes render in source and SQL pickers while SQL keeps schema identifiers', async ({ page }) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await login(page);
    // UI contract fixture: PHP integration tests cover projection of real saved catalogs.
    // This test exercises the live panel without a reachable PostgreSQL server.
    const fixtureId = 987654321;
    const field = { key: 'id', label: 'id', type: 'number', primary: true, original_name: 'id', label_kind: 'physical', display_names: { original: 'id', fa: 'شناسه', en: 'ID' } };
    const table = (key, original, fa, en) => ({ key, label: key, kind: 'table', fields: [field], original_name: key, label_kind: 'physical', display_names: { original, fa, en } });
    await page.route('**/analytics/api/library', route => route.fulfill({ json: {
        folders: [], reports: [], dashboards: [], connections: [{
            id: fixtureId, name: 'unisq', driver: 'pgsql', configuration: { database: 'unisq' },
            catalog: [table('public.orders', 'unisq.orders', 'unisq.سفارش‌ها', 'unisq.Orders'), table('audit.orders', 'unisq.audit.orders', 'unisq.audit.بایگانی', 'unisq.audit.Archive')],
        }],
    } }));
    await page.goto(`/admin/analytics/reports/new?connection=${fixtureId}&table=public.orders`);
    const source = page.locator('.mb-notebook [data-action=changeSource]');
    await expect(source).toContainText('unisq.orders');
    await source.click();
    const modal = page.locator('#analytics-native-form-body:visible');
    const sourceOptions = () => modal.locator('.fi-fo-field-wrp').filter({ has: page.locator('[id="workbenchData.source"]') }).first().locator('.choices__list--dropdown');
    await expect(sourceOptions()).toContainText('unisq.orders');
    await expect(sourceOptions()).toContainText('unisq.audit.orders');
    await modal.getByRole('button', { name: 'انصراف', exact: true }).click();
    await page.locator('select[data-metadata-language]').selectOption('en');
    await source.click();
    await expect(sourceOptions()).toContainText('unisq.Orders');
    await modal.getByRole('button', { name: 'انصراف', exact: true }).click();
    await page.locator('select[data-metadata-language]').selectOption('fa');
    await source.click();
    await expect(sourceOptions()).toContainText('unisq.سفارش‌ها');
    await expect(sourceOptions()).toContainText('unisq.audit.بایگانی');
    const picker = modal.locator('.fi-fo-field-wrp').filter({ has: page.locator('[id="workbenchData.source"]') }).first();
    await picker.locator('.choices__inner').click();
    await picker.locator('.choices__input--cloned').fill('unisq.سفارش‌ها');
    await picker.locator('.choices__item--choice').filter({ hasText: 'unisq.سفارش‌ها' }).first().click();
    await modal.getByRole('button', { name: 'اعمال', exact: true }).click();
    await expect(source).toContainText('unisq.سفارش‌ها');
    expect(await page.evaluate(() => window.analyticsStudio.report.query_definition.source)).toBe('public.orders');
    await page.goto(`/admin/analytics/reports/new?connection=${fixtureId}&table=public.orders&mode=native`);
    await expect(page.locator('[data-sql-preview]')).toContainText('SELECT * FROM "public"."orders"');
    await page.locator('[data-action=editNativeSql]').click();
    await expect(modal.locator('[id="workbenchData.sql"]')).toHaveValue('SELECT * FROM "public"."orders"');
    await modal.locator('[id="workbenchData.sql"]').fill('SELECT id FROM "public"."orders"');
    await modal.getByRole('button', { name: 'اعمال', exact: true }).click();
    await expect(page.locator('[data-sql-preview]')).toContainText('SELECT id FROM "public"."orders"');
    await page.getByRole('button', { name: 'ساختار داده‌ها', exact: true }).click();
    await expect(page.locator('.mb-sql-schema summary').first()).toContainText('unisq.سفارش‌ها');
    await page.locator('.mb-sql-schema summary').first().click();
    await expect(page.locator('.mb-sql-schema [data-action=insertSqlField]').first()).toContainText('شناسه');
    expect(errors).toEqual([]);
});
