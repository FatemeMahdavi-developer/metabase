import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { login, api, createDashboard } from './helpers/native-analytics.js';

const modal = page => page.locator('#analytics-native-form-body:visible');
const field = (page, key) => modal(page).locator('[id="workbenchData.' + key + '"]');
async function select(page, key, text) {
    const wrapper = modal(page).locator('.fi-fo-field-wrp').filter({ has: page.locator('[id="workbenchData.' + key + '"]') }).last();
    await expect(wrapper).toBeVisible();
    const native = wrapper.locator('select');
    const response = (['field', 'operator', 'source', 'function', 'type', 'display', 'connection_id'].includes(key) || key.endsWith('.widget_key'))
        ? page.waitForResponse(response => response.url().includes('/livewire/update') && response.request().method() === 'POST')
        : Promise.resolve();
    if (await native.isVisible()) { await native.selectOption({ label: text }); await response; await expect(modal(page).locator('fieldset')).toBeEnabled(); return; }
    await expect(wrapper.locator('.choices')).not.toHaveClass(/is-disabled/);
    const search = wrapper.locator('.choices__input--cloned');
    await expect(async () => {
        if (!await search.isVisible()) await wrapper.locator('.choices__inner').click();
        await expect(search).toBeVisible({ timeout: 1000 });
    }).toPass({ timeout: 10000 });
    await search.fill(text);
    await wrapper.locator('.choices__item--choice').filter({ hasText: text }).first().click();
    await response; await expect(modal(page).locator('fieldset')).toBeEnabled();
}
async function apply(page) { await modal(page).getByRole('button', { name: 'اعمال', exact: true }).click(); }
async function closed(page) { await expect(modal(page)).toHaveCount(0); }

test('dashboard draft uses native validated forms, survives light/dark modes and persists with Eloquent', async ({ page }) => {
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await login(page);
    const id = await createDashboard(page, 'Native Forms Dashboard ' + Date.now());
    try {
        await page.locator('[data-action=addTextCard]').click();
        await expect(modal(page).locator('.fi-fo-textarea')).toBeVisible();
        await field(page, 'title').fill('توضیح آزمایش');
        await field(page, 'content').fill('**متن بومی فیلامنت**');
        await apply(page); await closed(page);
        await expect(page.locator('.grid-stack')).toContainText('متن بومی فیلامنت');
        await page.locator('[data-action=addTab]').click();
        await apply(page);
        await expect(modal(page).locator('.fi-fo-field-wrp-error-message')).toBeVisible();
        await field(page, 'name').fill('تب آزمایش');
        await apply(page); await closed(page);
        await expect(page.locator('.mb-tabs')).toContainText('تب آزمایش');
        await page.locator('[data-action=dashboardSettings]').click();
        await field(page, 'name').fill('داشبورد با فرم فیلامنت');
        await select(page, 'width', 'ثابت');
        await page.evaluate(() => document.documentElement.classList.add('dark'));
        await expect(modal(page).locator('.fi-input').first()).toBeVisible();
        const nativeInput = await field(page, 'name').evaluate(node => node.classList.contains('fi-input') && !node.classList.contains('mb-input'));
        expect(nativeInput).toBe(true);
        await page.screenshot({ path: '../.tools/native-dashboard-form-dark.png' });
        await apply(page); await closed(page);
        await page.evaluate(() => document.documentElement.classList.remove('dark'));
        await page.locator('[data-action=saveDashboard]').click();
        await expect(page.locator('[data-action=editDashboard]')).toBeVisible();
        const saved = await api(page, 'dashboards/' + id);
        expect(saved.name).toBe('داشبورد با فرم فیلامنت');
        expect(saved.settings.width).toBe('fixed');
        expect(saved.tabs.some(tab => tab.name === 'تب آزمایش')).toBe(true);
        expect(saved.widgets.some(widget => widget.content === '**متن بومی فیلامنت**')).toBe(true);
        await page.reload();
        await expect(page.locator('.mb-toolbar')).toContainText(saved.name);
        expect(errors).toEqual([]);
    } finally { await api(page, 'dashboards/' + id, 'DELETE'); }
});

test('report filter, metric, joins, expression and visualization use actual Filament fields', async ({ page }) => {
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await login(page);
    const stamp = Date.now().toString();
    const source = JSON.parse(execFileSync('../.tools/php/php.exe', ['-d', 'opcache.enable_cli=0', 'tests/Browser/fixtures/create-workbench-source.php', stamp], { encoding: 'utf8' }));
    let reportId;
    let dashboardId;
    // There is no PostgreSQL server here. Only external preview execution is stubbed;
    // source catalog, Filament/Livewire forms and report persistence use the real app.
    await page.route('**/analytics/api/reports/preview', async route => {
        const definition = route.request().postDataJSON().query_definition;
        const columns = definition.mode === 'aggregate' ? [{ key: definition.metrics[0]?.key || 'count', label: definition.metrics[0]?.label || 'Count', type: 'number' }] : [{ key: 'id', label: 'id', type: 'number' }, { key: 'amount', label: 'amount', type: 'number' }, { key: 'status', label: 'status', type: 'text' }];
        await route.fulfill({ json: { query_definition: definition, columns, rows: [{ id: 1, amount: 20, status: 'ok' }], meta: { duration_ms: 1 }, sql: 'SELECT ...' } });
    });
    await page.route('**/analytics/api/dashboards/*/widgets/*/*', route => route.fulfill({ json: {
        columns: [{ key: 'amount', label: 'amount', type: 'number' }, { key: 'status', label: 'status', type: 'text' }],
        rows: [{ amount: 20, status: 'ok' }], meta: { duration_ms: 1 },
    } }));
    try {
        await page.goto('/admin/analytics/reports/new?connection=' + source.id + '&table=public.orders');
        await expect(page.locator('.mb-notebook')).toBeVisible();
        await page.locator('[data-action=addReportFilter]').click();
        await select(page, 'field', 'amount');
        await select(page, 'operator', 'بزرگ‌تر از');
        await field(page, 'value').fill('10');
        await apply(page); await closed(page);
        expect(await page.evaluate(() => window.analyticsStudio.report.query_definition.filters[0].value)).toBe(10);

        await page.evaluate(() => window.analyticsStudio.addJoin());
        await expect(modal(page).locator('.fi-fo-repeater')).toBeVisible();
        await apply(page); await closed(page);
        expect(await page.evaluate(() => window.analyticsStudio.report.query_definition.joins.length)).toBe(1);

        await page.evaluate(() => window.analyticsStudio.editNotebookLimit({ dataset: { stage: 0 } }));
        await field(page, 'limit').fill('20');
        await apply(page); await closed(page);
        expect(await page.evaluate(() => window.analyticsStudio.report.query_definition.limit)).toBe(20);

        await page.evaluate(() => window.analyticsStudio.addExpression());
        await field(page, 'label').fill('دو برابر مبلغ');
        await field(page, 'expression').fill('[amount] * 2');
        await apply(page); await closed(page);
        expect(await page.evaluate(() => window.analyticsStudio.report.query_definition.expressions[0].label)).toBe('دو برابر مبلغ');

        await page.evaluate(() => window.analyticsStudio.addMetric());
        await select(page, 'function', 'مجموع');
        await select(page, 'field', 'amount');
        await field(page, 'label').fill('مجموع مبلغ');
        await apply(page); await closed(page);
        expect(await page.evaluate(() => window.analyticsStudio.report.query_definition.metrics[0].function)).toBe('sum');

        await page.evaluate(() => window.analyticsStudio.reportVisualization());
        await expect(modal(page).locator('.fi-fo-tabs')).toBeVisible();
        await page.screenshot({ path: '../.tools/native-visualization-form-light.png' });
        await apply(page); await closed(page);
        await page.evaluate(() => window.analyticsStudio.reportSaveDialog());
        await field(page, 'name').fill('Native Forms Report ' + stamp);
        await apply(page); await closed(page);
        reportId = await page.evaluate(() => window.analyticsStudio.report.id);
        expect(reportId).toBeTruthy();
        const library = await api(page, 'library');
        const saved = library.reports.find(row => row.id === reportId);
        expect(saved.query_definition.filters[0].value).toBe(10);
        expect(saved.query_definition.joins).toHaveLength(1);
        expect(saved.query_definition.limit).toBe(20);

        dashboardId = await createDashboard(page, 'Native report dashboard ' + stamp);
        await page.locator('[data-action=addReportCard]').click();
        await select(page, 'report_id', saved.name);
        await apply(page); await closed(page);
        await expect(page.locator('[data-action=cardSettings]')).toBeVisible();
        await page.locator('[data-action=cardSettings]').click();
        await modal(page).getByRole('button', { name: 'رفتار کلیک', exact: true }).click();
        await select(page, 'type', 'رفتن به لینک');
        await field(page, 'url').fill('https://example.test/item/{{value}}');
        await apply(page); await closed(page);

        await page.locator('[data-action=addDashboardFilter]').click();
        await field(page, 'label').fill('وضعیت');
        await field(page, 'values').fill('ok, failed');
        await modal(page).getByRole('button', { name: 'اتصال به کارت', exact: true }).click();
        const widgetPath = (await modal(page).locator('[id$=".widget_key"]').getAttribute('id')).replace('workbenchData.', '');
        await select(page, widgetPath, saved.name);
        const targetPath = (await modal(page).locator('[id$=".target"]').getAttribute('id')).replace('workbenchData.', '');
        await select(page, targetPath, 'status');
        await apply(page); await closed(page);
        await page.locator('[data-action=saveDashboard]').click();
        await expect(page.locator('[data-action=editDashboard]')).toBeVisible();
        const dashboard = await api(page, 'dashboards/' + dashboardId);
        expect(dashboard.widgets[0].click_behavior.type).toBe('url');
        expect(dashboard.filters[0].bindings[0].target).toBe('status');
        await page.locator('[data-action=editFilterValue]').click();
        await select(page, 'value_mode', 'مقدار مشخص');
        await field(page, 'value').fill('ok');
        await apply(page); await closed(page);
        expect(await page.evaluate(() => Object.values(window.analyticsStudio.filterValues)[0])).toBe('ok');
        expect(errors).toEqual([]);
    } finally {
        if (dashboardId) await api(page, 'dashboards/' + dashboardId, 'DELETE');
        if (reportId) await api(page, 'reports/' + reportId, 'DELETE');
        await api(page, 'connections/' + source.id, 'DELETE');
    }
});
