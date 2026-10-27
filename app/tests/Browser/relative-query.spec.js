import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const credentials = process.env.ANALYTICS_PASSWORD
    ? { email: process.env.ANALYTICS_EMAIL || 'admin@example.com', password: process.env.ANALYTICS_PASSWORD }
    : JSON.parse(fs.readFileSync(path.resolve('../.tools/admin.json'), 'utf8').replace(/^\uFEFF/, ''));

test.setTimeout(240000);

async function api(page, route, method = 'GET', payload) {
    return page.evaluate(async ({ route, method, payload }) => {
        const response = await fetch('/analytics/api/' + route, {
            method, headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-CSRF-TOKEN': document.querySelector('meta[name="csrf-token"]').content },
            ...(payload ? { body: JSON.stringify(payload) } : {}),
        });
        const body = await response.json();
        if (!response.ok) throw new Error(JSON.stringify(body));
        return body;
    }, { route, method, payload });
}

async function openReport(page, id) {
    await page.goto('/admin/analytics/reports/' + id);
    await expect(page.locator('.mb-preview-body .mb-table')).toBeVisible();
    await expect.poll(() => page.evaluate(() => window.analyticsStudio.report?.id)).toBe(id);
}

async function runRows(page, rows) {
    await page.getByRole('button', { name: 'نمایش نتیجه', exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.analyticsStudio.previewResult?.rows)).toEqual(rows);
}

test('saved question rolling dates persist symbolic ranges in source and aggregate-output filters', async ({ page }) => {
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    page.on('dialog', async dialog => { if (dialog.type() === 'beforeunload') await dialog.accept(); else { await dialog.dismiss(); throw new Error('Unexpected browser dialog: ' + dialog.message()); } });
    await page.goto('/admin/login');
    await page.locator('input[type=email]').fill(credentials.email);
    await page.locator('input[type=password]').fill(credentials.password);
    await page.locator('button[type=submit]').click();
    await expect(page).not.toHaveURL(/login/);
    await page.goto('/admin/analytics/dashboards');
    await expect(page.locator('.fi-ta-table')).toBeVisible();
    const sample = (await api(page, 'library')).connections.find(connection => connection.driver === 'sqlite' && connection.name === 'فروشگاه نمونه • SQLite' && connection.catalog?.some(table => table.key === 'orders'));
    expect(sample).toBeTruthy();
    const reports = [];
    const definition = { connection_id: sample.id, source: 'orders', mode: 'rows', columns: ['id', 'ordered_at', 'total'], metrics: [], dimensions: [], expressions: [], filters: [], joins: [], sort: [{ key: 'id', direction: 'asc' }], limit: null };
    const native = sql => api(page, 'reports/preview', 'POST', { query_definition: { ...definition, mode: 'native', sql, columns: undefined, sort: [], parameters: [] } });
    const create = async (name, query = {}) => { const report = await api(page, 'reports', 'POST', { name: `Browser relative query ${Date.now()} ${name}`, folder_id: null, description: null, display: 'table', visualization_settings: {}, query_definition: { ...definition, ...query } }); reports.push(report.id); return report; };
    const relative = { unit: 'month', amount: 1, direction: 'past', include_current: false };
    try {
        const report = await create('source');
        await openReport(page, report.id);
        await page.locator('[data-action=toggleNotebook]').click();
        await page.locator('[data-action=addReportFilter]').click();
        await page.locator('.mb-dialog [name=field]').selectOption('ordered_at');
        await page.locator('.mb-dialog [name=operator]').selectOption('between');
        await page.locator('.mb-dialog [name=date_mode]').selectOption('relative');
        await page.locator('.mb-dialog [name=relative_amount]').fill('1');
        await page.locator('.mb-dialog [name=relative_unit]').selectOption('month');
        await page.locator('.mb-dialog [name=relative_direction]').selectOption('past');
        await page.locator('.mb-dialog [name=include_current]').uncheck();
        await page.screenshot({ path: 'tests/Browser/artifacts/interaction-question-relative-date.png' });
        await expect(page.locator('.mb-dialog [data-action=saveReportFilter]')).toBeVisible();
        await page.locator('.mb-dialog [data-action=saveReportFilter]').click();
        await expect(page.locator('.mb-dialog')).toHaveCount(0);
        expect(await page.evaluate(() => window.analyticsStudio.report.query_definition.filters[0])).toEqual({ field: 'ordered_at', operator: 'between', value: null, relative_date: relative });
        const previous = await native("SELECT id, ordered_at, total FROM orders WHERE ordered_at >= date('now', 'start of month', '-1 month') AND ordered_at < date('now', 'start of month') ORDER BY id ASC");
        expect(previous.rows.length).toBeGreaterThan(0);
        await runRows(page, previous.rows);
        await page.locator('[data-action=reportSaveDialog]').click();
        await page.locator('.mb-dialog [data-action=saveReport]').click();
        await expect(page.locator('.mb-dialog')).toHaveCount(0);
        expect((await api(page, 'library')).reports.find(row => row.id === report.id).query_definition.filters[0]).toEqual({ field: 'ordered_at', operator: 'between', value: null, relative_date: relative });
        await openReport(page, report.id);
        expect(await page.evaluate(() => window.analyticsStudio.previewResult?.rows)).toEqual(previous.rows);
        await page.locator('.mb-preview-body [data-table-sort=ordered_at]').click();
        await expect(page.locator('[data-drill-menu] [data-drill-action="filter:custom"]')).toBeVisible();
        await page.locator('[data-drill-menu] [data-drill-action="filter:custom"]').click();
        await page.locator('.mb-dialog [name=operator]').selectOption('between');
        await page.locator('.mb-dialog [name=date_mode]').selectOption('relative');
        await page.locator('.mb-dialog [name=relative_amount]').fill('1');
        await page.locator('.mb-dialog [name=relative_unit]').selectOption('month');
        await page.locator('.mb-dialog [name=relative_direction]').selectOption('past');
        await page.locator('.mb-dialog [name=include_current]').uncheck();
        await page.locator('.mb-dialog [data-action=saveDrillFilter]').click();
        await expect(page.locator('.mb-drill-view')).toBeVisible();
        await expect.poll(() => page.evaluate(() => window.analyticsStudio.previewResult?.rows)).toEqual(previous.rows);
        const drilledFilters = await page.evaluate(() => window.analyticsStudio.report.query_definition.filters);
        expect(drilledFilters).toHaveLength(2);
        expect(drilledFilters.at(-1)).toEqual({ field: 'ordered_at', operator: 'between', value: null, relative_date: relative });
        expect((await api(page, 'library')).reports.find(row => row.id === report.id).query_definition.filters).toEqual([{ field: 'ordered_at', operator: 'between', value: null, relative_date: relative }]);
        await page.locator('[data-action=returnFromDrill]').click();
        await expect(page.locator('.mb-drill-view')).toHaveCount(0);
        await page.locator('[data-action=toggleNotebook]').click();
        await page.locator('[data-notebook-step=filter][data-stage="0"] [data-action=editNotebookClause][data-index="0"]').click();
        await expect(page.locator('.mb-dialog [name=date_mode]')).toHaveValue('relative');
        await expect(page.locator('.mb-dialog [name=relative_unit]')).toHaveValue('month');
        await expect(page.locator('.mb-dialog [name=relative_amount]')).toHaveValue('1');
        await page.locator('.mb-dialog [name=include_current]').check();
        await page.locator('.mb-dialog [name=operator]').selectOption('not_between');
        await expect(page.locator('.mb-dialog [name=include_current]')).toBeChecked();
        await page.locator('.mb-dialog [data-action=saveReportFilter]').click();
        await expect(page.locator('.mb-dialog')).toHaveCount(0);
        expect(await page.evaluate(() => window.analyticsStudio.report.query_definition.filters[0])).toEqual({ field: 'ordered_at', operator: 'not_between', value: null, relative_date: { ...relative, include_current: true } });
        const excluded = await native("SELECT id, ordered_at, total FROM orders WHERE NOT (ordered_at >= date('now', 'start of month', '-1 month') AND ordered_at < date('now', 'start of month', '+1 month')) ORDER BY id ASC");
        await runRows(page, excluded.rows);
        await page.locator('[data-action=toggleNotebook]').click();
        await page.locator('[data-notebook-step=filter][data-stage="0"] [data-action=editNotebookClause][data-index="0"]').click();
        await page.locator('.mb-dialog [name=date_mode]').selectOption('specific');
        await page.locator('.mb-dialog [name=operator]').selectOption('between');
        await page.locator('.mb-dialog [name=from]').fill('2026-01-01');
        await page.locator('.mb-dialog [name=to]').fill('2026-01-31');
        await page.locator('.mb-dialog [data-action=saveReportFilter]').click();
        await expect(page.locator('.mb-dialog')).toHaveCount(0);
        expect(await page.evaluate(() => window.analyticsStudio.report.query_definition.filters[0])).toEqual({ field: 'ordered_at', operator: 'between', value: ['2026-01-01', '2026-01-31'] });
        await runRows(page, (await native("SELECT id, ordered_at, total FROM orders WHERE ordered_at BETWEEN '2026-01-01' AND '2026-01-31' ORDER BY id ASC")).rows);

        const grouped = await create('aggregate output', { mode: 'aggregate', columns: undefined, dimensions: [{ field: 'ordered_at', grain: 'month' }], metrics: [{ key: 'revenue', function: 'sum', field: 'total' }], sort: [{ key: 'ordered_at', direction: 'asc' }] });
        await openReport(page, grouped.id);
        await page.locator('[data-action=toggleNotebook]').click();
        await page.locator('[data-action=openNotebookStep][data-kind=filter][data-stage="1"]').click();
        await page.locator('.mb-dialog [name=field]').selectOption('ordered_at');
        await page.locator('.mb-dialog [name=operator]').selectOption('between');
        await page.locator('.mb-dialog [name=date_mode]').selectOption('relative');
        await page.locator('.mb-dialog [name=relative_unit]').selectOption('month');
        await page.locator('.mb-dialog [data-action=saveNotebookFilter]').click();
        await expect(page.locator('.mb-dialog')).toHaveCount(0);
        expect(await page.evaluate(() => window.analyticsStudio.report.query_definition.stages[0].filters[0])).toEqual({ field: 'ordered_at', operator: 'between', value: null, relative_date: relative });
        const groupedOracle = await native("SELECT strftime('%Y-%m-01', ordered_at) AS ordered_at, SUM(total) AS revenue FROM orders GROUP BY strftime('%Y-%m-01', ordered_at) HAVING strftime('%Y-%m-01', ordered_at) >= date('now', 'start of month', '-1 month') AND strftime('%Y-%m-01', ordered_at) < date('now', 'start of month') ORDER BY ordered_at ASC");
        await runRows(page, groupedOracle.rows);
        await page.locator('[data-action=reportSaveDialog]').click();
        await page.locator('.mb-dialog [data-action=saveReport]').click();
        await expect(page.locator('.mb-dialog')).toHaveCount(0);
        await openReport(page, grouped.id);
        expect(await page.evaluate(() => window.analyticsStudio.report.query_definition.stages[0].filters[0].relative_date)).toEqual(relative);
        expect(await page.evaluate(() => window.analyticsStudio.previewResult?.rows)).toEqual(groupedOracle.rows);
        expect(errors).toEqual([]);
    } finally { for (const id of reports.reverse()) await api(page, `reports/${id}`, 'DELETE'); }
});
