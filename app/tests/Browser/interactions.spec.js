import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const credentials = process.env.ANALYTICS_PASSWORD
    ? { email: process.env.ANALYTICS_EMAIL || 'admin@example.com', password: process.env.ANALYTICS_PASSWORD }
    : JSON.parse(fs.readFileSync(path.resolve('../.tools/admin.json'), 'utf8').replace(/^\uFEFF/, ''));

test.setTimeout(240000);

async function login(page) {
    page.on('dialog', async dialog => {
        if (dialog.type() === 'beforeunload') await dialog.accept();
        else { await dialog.dismiss(); throw new Error('Unexpected browser dialog: ' + dialog.message()); }
    });
    await page.goto('/admin/login');
    await page.locator('input[type=email]').fill(credentials.email);
    await page.locator('input[type=password]').fill(credentials.password);
    await page.locator('button[type=submit]').click();
    await expect(page).not.toHaveURL(/login/);
    await page.goto('/admin/analytics/dashboards');
    await expect(page.locator('.fi-ta-table')).toBeVisible();
}

async function api(page, route, method = 'GET', payload) {
    return page.evaluate(async ({ route, method, payload }) => {
        const response = await fetch('/analytics/api/' + route, {
            method,
            headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-CSRF-TOKEN': document.querySelector('meta[name="csrf-token"]').content },
            ...(payload ? { body: JSON.stringify(payload) } : {}),
        });
        const body = await response.json();
        if (!response.ok) throw new Error(JSON.stringify(body));
        return body;
    }, { route, method, payload });
}

function definition(connectionId, overrides = {}) {
    return { connection_id: connectionId, source: 'orders', mode: 'rows', metrics: [], dimensions: [], filters: [], sort: [], joins: [], expressions: [], limit: null, columns: ['id', 'customer_id', 'ordered_at', 'status', 'total'], ...overrides };
}

async function fixtures(page) {
    const reports = [], dashboards = [];
    const sample = (await api(page, 'library')).connections.find(connection => connection.driver === 'sqlite' && connection.name === 'فروشگاه نمونه • SQLite' && connection.catalog?.some(table => table.key === 'orders'));
    expect(sample).toBeTruthy();
    const prefix = 'Browser interactions ' + Date.now();
    return {
        connectionId: sample.id,
        async report(label, query = {}, display = 'table', visualization_settings = {}) {
            const report = await api(page, 'reports', 'POST', { name: prefix + ' ' + label, description: null, folder_id: null, query_definition: definition(sample.id, query), display, visualization_settings });
            reports.push(report.id); return report;
        },
        async dashboard(label, widgets, filters = [], settings = {}) {
            const board = await api(page, 'dashboards', 'POST', { name: prefix + ' ' + label, description: null, folder_id: null });
            dashboards.push(board.id);
            return api(page, `dashboards/${board.id}`, 'PUT', { ...board, settings: { ...board.settings, ...settings }, widgets, filters });
        },
        async native(sql) {
            return api(page, 'reports/preview', 'POST', { query_definition: definition(sample.id, { mode: 'native', sql, parameters: [], columns: undefined }) });
        },
        async cleanup() {
            for (const id of dashboards.reverse()) await api(page, `dashboards/${id}`, 'DELETE');
            for (const id of reports.reverse()) await api(page, `reports/${id}`, 'DELETE');
        },
    };
}

function widget(key, report, options = {}) {
    return { key, report_id: report.id, tab_key: 'main', type: 'report', x: 0, y: 0, w: 24, h: 10, settings: {}, content: null, click_behavior: { type: 'details' }, ...options };
}

function filter(key, label, type, target, operator = 'eq', settings = {}, default_value = null, widget_key = 'rows') {
    return { key, label, type, required: false, default_value, settings, bindings: [{ widget_key, target, operator }] };
}

async function openDashboard(page, id) {
    await page.goto('/admin/analytics/dashboards/' + id);
    await expect.poll(() => page.evaluate(() => window.analyticsStudio.dashboard?.id)).toBe(id);
    await expect(page.locator('.mb-card').first()).toBeVisible();
    await expect(page.locator('.mb-card .mb-loading')).toHaveCount(0);
    await expect(page.locator('.mb-card .mb-error')).toHaveCount(0);
}

async function openReport(page, id) {
    await page.goto('/admin/analytics/reports/' + id);
    await expect(page.locator('.mb-preview-body .mb-table')).toBeVisible();
}

const card = (page, key) => page.locator(`[data-widget="${key}"]`);
const option = (page, value) => page.locator('.mb-dialog .mb-value-option').filter({ hasText: new RegExp('^' + String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$') }).locator('input[name=values]');

async function searchValues(page, value) {
    const pending = page.waitForResponse(response => response.url().includes('/filters/') && response.url().endsWith('/options') && response.request().postDataJSON()?.search === value);
    await page.locator('.mb-dialog [data-value-search]').fill(value);
    const response = await pending;
    expect(response.status()).toBe(200);
    return response.json();
}

async function resultRows(page, key = 'rows') {
    return page.evaluate(key => window.analyticsStudio.results.get(key).rows, key);
}

async function snapshot(page, name) {
    const overlay = page.locator('.mb-dialog[open], [data-drill-menu]');
    const overlays = await overlay.count();
    if (!overlays) await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: 'tests/Browser/artifacts/' + name, fullPage: !overlays });
    if (overlays) await expect(overlay).toHaveCount(overlays);
}

async function cell(page, container, field, row = 0) {
    const target = container.locator(`tbody [data-table-cell][data-column="${field}"]`).nth(row);
    await target.click();
    await expect(page.locator('[data-drill-menu]')).toBeVisible();
    return target;
}

async function header(page, container, field) {
    await container.locator(`[data-table-sort="${field}"]`).click();
    await expect(page.locator('[data-drill-menu]')).toBeVisible();
}

async function drill(page, action) {
    await page.locator(`[data-drill-menu] [data-action=applyDrill][data-drill-action="${action}"]`).click();
    await expect(page.locator('[data-drill-menu]')).toHaveCount(0);
    await expect(page.locator('.mb-drill-view')).toBeVisible();
    await expect.poll(() => page.evaluate(() => window.analyticsStudio.previewResult?.rows?.length ?? 0)).toBeGreaterThan(0);
    return page.evaluate(() => ({ result: window.analyticsStudio.previewResult, definition: window.analyticsStudio.report.query_definition }));
}

async function chartPoint(page, widgetKey, seriesLabel) {
    const canvas = card(page, widgetKey).locator('canvas');
    await expect(canvas).toBeVisible();
    await canvas.scrollIntoViewIfNeeded();
    await expect.poll(() => page.evaluate(({ widgetKey, seriesLabel }) => {
        const chart = window.analyticsStudio.charts.find(chart => chart.canvas.closest('[data-widget]')?.dataset.widget === widgetKey);
        const series = chart?.data.datasets.findIndex(dataset => dataset.label === seriesLabel);
        return series >= 0 && chart.getDatasetMeta(series).data.length > 0;
    }, { widgetKey, seriesLabel })).toBe(true);
    const point = await page.evaluate(({ widgetKey, seriesLabel }) => {
        const chart = window.analyticsStudio.charts.find(chart => chart.canvas.closest('[data-widget]')?.dataset.widget === widgetKey);
        const series = chart.data.datasets.findIndex(dataset => dataset.label === seriesLabel);
        const index = chart.data.datasets[series].data.findIndex(value => Number(value) > 0);
        const element = chart.getDatasetMeta(series).data[index];
        const center = element.getCenterPoint();
        const bounds = chart.canvas.getBoundingClientRect();
        return { x: bounds.left + center.x, y: bounds.top + center.y, bucket: chart.data.labels[index], series: chart.data.datasets[series].label };
    }, { widgetKey, seriesLabel });
    await page.mouse.click(point.x, point.y);
    await expect(page.locator('[data-drill-menu]')).toBeVisible();
    return point;
}

test('cell and header menus filter and sort typed values while saved reports remain unchanged', async ({ page }) => {
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await login(page); const data = await fixtures(page);
    try {
        const raw = await data.report('cell and header', { sort: [{ key: 'ordered_at', direction: 'asc' }], limit: 40, limit_explicit: true });
        await openReport(page, raw.id);
        const original = structuredClone(raw.query_definition);
        const selected = await page.evaluate(() => window.analyticsStudio.previewResult?.rows[0]);
        await cell(page, page.locator('.mb-preview-body'), 'total');
        await expect(page.locator('[data-drill-menu] [data-drill-action="filter:gt"]')).toBeVisible();
        await expect(page.locator('[data-drill-menu] [data-drill-action="filter:lt"]')).toBeVisible();
        await expect(page.locator('[data-drill-menu] [data-drill-action="filter:gt"]')).toHaveText('>');
        await expect(page.locator('[data-drill-menu] [data-drill-action="filter:lt"]')).toHaveText('<');
        const filtered = await drill(page, 'filter:eq');
        expect(filtered.definition.filters).toContainEqual(expect.objectContaining({ field: 'total', operator: 'eq', value: selected.total }));
        const sameValue = await data.native(`SELECT id, customer_id, ordered_at, status, total FROM orders WHERE total=${selected.total} ORDER BY ordered_at ASC LIMIT 40`);
        expect(filtered.result.rows).toEqual(sameValue.rows);
        expect((await api(page, 'library')).reports.find(report => report.id === raw.id).query_definition).toEqual(original);
        await page.locator('[data-action=returnFromDrill]').click();
        await expect(page.locator('.mb-drill-view')).toHaveCount(0);
        await header(page, page.locator('.mb-preview-body'), 'total');
        const sorted = await drill(page, 'sort:desc');
        expect(sorted.definition.sort).toEqual([{ key: 'total', direction: 'desc' }]);
        expect(sorted.result.rows).toEqual((await data.native('SELECT id, customer_id, ordered_at, status, total FROM orders ORDER BY total DESC LIMIT 40')).rows);
        await page.locator('[data-action=returnFromDrill]').click();
        await header(page, page.locator('.mb-preview-body'), 'total');
        const overTime = await drill(page, 'summarize:sum_by_time');
        expect(overTime.definition.mode).toBe('aggregate');
        expect(overTime.definition.dimensions).toEqual([{ field: 'ordered_at', grain: 'month' }]);
        expect(overTime.result.rows).toEqual((await data.native("SELECT strftime('%Y-%m-01', ordered_at) AS ordered_at, SUM(total) AS drill_value FROM orders GROUP BY strftime('%Y-%m-01', ordered_at)")).rows);
        await page.locator('[data-action=returnFromDrill]').click();
        await cell(page, page.locator('.mb-preview-body'), 'status');
        await page.locator('[data-drill-menu] [data-drill-action="filter:contains"]').click();
        await expect(page.locator('.mb-dialog [name=operator]')).toBeVisible();
        await page.locator('.mb-dialog [name=operator]').selectOption('ends_with');
        await page.locator('.mb-dialog [name=value]').fill('تکمیل');
        await page.locator('.mb-dialog [data-action=saveDrillFilter]').click();
        await expect(page.locator('.mb-drill-view')).toBeVisible();
        await expect.poll(() => page.evaluate(() => window.analyticsStudio.previewResult?.rows)).toEqual([]);
        expect(await page.evaluate(() => window.analyticsStudio.report.query_definition.filters)).toContainEqual(expect.objectContaining({ field: 'status', operator: 'ends_with', value: 'تکمیل' }));

        const optional = await data.report('empty value', { columns: ['id', 'optional_status'], expressions: [{ key: 'optional_status', label: 'وضعیت اختیاری', expression: 'case([id] = 2, "", [id] > 2, [status])' }] });
        await openReport(page, optional.id);
        await cell(page, page.locator('.mb-preview-body'), 'optional_status');
        await expect(page.locator('[data-drill-menu] [data-drill-action^="filter:"]')).toHaveCount(2);
        const empty = await drill(page, 'filter:is_empty');
        expect(empty.result.rows.map(row => row.id)).toEqual([1, 2]);
        expect(empty.definition.filters).toContainEqual(expect.objectContaining({ field: 'optional_status', operator: 'is_empty' }));

        const grouped = await data.report('category output filter', { mode: 'aggregate', columns: undefined, dimensions: [{ field: 'status', grain: null }], metrics: [{ key: 'revenue', label: 'فروش', function: 'sum', field: 'total' }] });
        await openReport(page, grouped.id);
        await page.locator('select[data-metadata-language]:visible').selectOption('fa');
        const category = await page.evaluate(() => window.analyticsStudio.previewResult?.rows[0].status);
        await cell(page, page.locator('.mb-preview-body'), 'status');
        await page.locator('[data-drill-menu] [data-action=showDrillBreakouts]').click();
        await page.locator('[data-drill-menu] [data-drill-action-search]').fill('وضعیت');
        await expect(page.locator('[data-drill-menu] [data-drill-action="breakout:status"]')).toBeVisible();
        await expect(page.locator('[data-drill-menu] [data-drill-action="breakout:ordered_at"]')).toBeHidden();
        await snapshot(page, 'interaction-breakout-column-search.png');
        await page.locator('[data-drill-menu] [data-action=returnDrillMenu]').click();
        await expect(page.locator('[data-drill-menu] [data-drill-action="filter:eq"]')).toBeVisible();
        const selectedGroup = await drill(page, 'filter:eq');
        expect(selectedGroup.definition.mode).toBe('aggregate');
        expect(selectedGroup.definition.dimensions).toEqual(grouped.query_definition.dimensions);
        expect(selectedGroup.definition.filters).toEqual([]);
        expect(selectedGroup.definition.stages).toHaveLength(1);
        expect(selectedGroup.definition.stages[0].filters).toContainEqual(expect.objectContaining({ field: 'status', operator: 'eq', value: category }));
        const escaped = category.replaceAll("'", "''");
        expect(selectedGroup.result.rows).toEqual((await data.native(`SELECT status, SUM(total) AS revenue FROM orders GROUP BY status HAVING status='${escaped}'`)).rows);
        expect((await api(page, 'library')).reports.find(report => report.id === grouped.id).query_definition).toEqual(grouped.query_definition);
        await snapshot(page, 'interaction-cell-header-output-filter.png');
        expect(errors).toEqual([]);
    } finally { await data.cleanup(); }
});

test('real chart points open underlying records and time zoom with source and dashboard filters preserved', async ({ page }) => {
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await login(page); const data = await fixtures(page);
    try {
        const report = await data.report('monthly category drill', {
            mode: 'aggregate', columns: undefined,
            dimensions: [{ field: 'ordered_at', grain: 'month' }, { field: 'status', grain: null }],
            metrics: [{ key: 'revenue', label: 'فروش', function: 'sum', field: 'total' }],
            filters: [{ field: 'total', operator: 'gte', value: 250000 }],
            sort: [{ key: 'ordered_at', direction: 'asc' }],
        }, 'bar', { x: 'ordered_at', y: 'revenue', split: 'status' });
        const period = ['2026-02-01', '2026-08-31'];
        const statuses = ['تکمیل‌شده', 'لغوشده'];
        const board = await data.dashboard('chart drill', [widget('trend', report)], [
            filter('period', 'دوره سفارش', 'date', 'ordered_at', 'between', {}, period, 'trend'),
            filter('statuses', 'وضعیت سفارش', 'text', 'status', 'in', {}, statuses, 'trend'),
        ]);
        await openDashboard(page, board.id);
        const point = await chartPoint(page, 'trend', 'تکمیل‌شده');
        await expect(page.locator('[data-drill-menu] [data-drill-action="underlying"]')).toBeVisible();
        await expect(page.locator('[data-drill-menu] [data-drill-action="zoom:week"]')).toBeVisible();
        await page.screenshot({ path: 'tests/Browser/artifacts/interaction-chart-click-menu.png' });
        await expect(page.locator('[data-drill-menu] [data-drill-action="underlying"]')).toBeVisible();
        const underlying = await drill(page, 'underlying');
        const month = point.bucket.slice(0, 7);
        const where = `total >= 250000 AND ordered_at BETWEEN '${period[0]}' AND '${period[1]}' AND strftime('%Y-%m', ordered_at)='${month}' AND status='تکمیل‌شده'`;
        const oracle = await data.native(`SELECT id, customer_id, ordered_at, status, total FROM orders WHERE ${where}`);
        const byId = rows => [...rows].sort((left, right) => left.id - right.id);
        expect(byId(underlying.result.rows)).toEqual(byId(oracle.rows));
        expect(underlying.definition.mode).toBe('rows');
        expect(underlying.definition.metrics).toEqual([]);
        expect(underlying.definition.dimensions).toEqual([]);
        expect(underlying.definition.limit).toBeNull();
        await expect(page.locator('[data-drill-breadcrumb]')).toBeVisible();
        await page.locator('[data-action=returnFromDrill]').click();
        await expect(card(page, 'trend').locator('canvas')).toBeVisible();
        expect(await page.evaluate(() => window.analyticsStudio.appliedValues)).toEqual({ period, statuses });
        const again = await chartPoint(page, 'trend', 'تکمیل‌شده');
        expect(again.bucket).toBe(point.bucket);
        const zoomed = await drill(page, 'zoom:week');
        expect(zoomed.definition.dimensions).toContainEqual({ field: 'ordered_at', grain: 'week' });
        expect(zoomed.definition.dimensions).toContainEqual({ field: 'status', grain: null });
        const zoomWhere = `total >= 250000 AND ordered_at BETWEEN '${period[0]}' AND '${period[1]}' AND strftime('%Y-%m', ordered_at)='${month}' AND status IN ('تکمیل‌شده', 'لغوشده')`;
        const weekOracle = await data.native(`SELECT date(ordered_at, '-6 days', 'weekday 1') AS ordered_at, status, SUM(total) AS revenue FROM orders WHERE ${zoomWhere} GROUP BY date(ordered_at, '-6 days', 'weekday 1'), status ORDER BY ordered_at ASC`);
        expect(zoomed.result.rows).toEqual(weekOracle.rows);
        expect(new Set(zoomed.result.rows.map(row => row.status))).toEqual(new Set(statuses));
        expect((await api(page, 'library')).reports.find(saved => saved.id === report.id).query_definition).toEqual(report.query_definition);
        await snapshot(page, 'interaction-date-zoom.png');
        expect(errors).toEqual([]);
    } finally { await data.cleanup(); }
});

test('primary and foreign-key cells expose record details and related rows', async ({ page }) => {
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await login(page); const data = await fixtures(page);
    try {
        const report = await data.report('record relationships');
        await openReport(page, report.id);
        const first = await page.evaluate(() => window.analyticsStudio.previewResult?.rows[0]);
        await cell(page, page.locator('.mb-preview-body'), 'id');
        await expect(page.locator('[data-drill-menu] [data-drill-action^="filter:"]')).toHaveCount(0);
        await page.locator('[data-drill-menu] [data-drill-action=object_details]').click();
        const details = page.locator('.mb-dialog[data-object-detail]');
        await expect(details).toBeVisible();
        await expect(details).toContainText(first.ordered_at);
        await expect(details).toContainText(first.status);
        await expect(details.locator('[data-drill-action="related:order_items:order_id"]')).toBeVisible();
        await snapshot(page, 'interaction-record-details.png');
        await details.getByRole('button', { name: 'بستن', exact: true }).click();

        await cell(page, page.locator('.mb-preview-body'), 'customer_id');
        await expect(page.locator('[data-drill-menu] [data-drill-action^="filter:"]')).toHaveCount(0);
        const relatedOracle = await data.native(`SELECT id, customer_id, ordered_at, status, total FROM orders WHERE customer_id=${first.customer_id}`);
        const sameForeignKey = await drill(page, 'foreign_filter');
        expect(sameForeignKey.definition.source).toBe('orders');
        expect(sameForeignKey.result.rows).toEqual(relatedOracle.rows);
        await cell(page, page.locator('.mb-preview-body'), 'id');
        await page.locator('[data-drill-menu] [data-drill-action=object_details]').click();
        await expect(details).toBeVisible();
        await details.getByRole('button', { name: 'بستن', exact: true }).click();
        await cell(page, page.locator('.mb-preview-body'), 'customer_id');
        const afterClosingDetails = await drill(page, 'foreign_filter');
        expect(afterClosingDetails.result.rows).toEqual(relatedOracle.rows);
        await page.locator('[data-action=returnFromDrill]').click();
        await cell(page, page.locator('.mb-preview-body'), 'customer_id');
        await page.locator('[data-drill-menu] [data-drill-action=foreign_details]').click();
        await expect(details).toBeVisible();
        const customer = (await data.native(`SELECT id, name, city, joined_at FROM customers WHERE id=${first.customer_id}`)).rows[0];
        await expect(details).toContainText(customer.name);
        await expect(details).toContainText(customer.city);
        await details.locator('[data-action=applyDrill][data-drill-action="related:orders:customer_id"]').click();
        await expect(page.locator('.mb-drill-view')).toBeVisible();
        await expect.poll(() => page.evaluate(() => window.analyticsStudio.previewResult?.rows)).toEqual(relatedOracle.rows);
        expect(await page.evaluate(() => window.analyticsStudio.report.query_definition.source)).toBe('orders');
        expect((await api(page, 'library')).reports.find(saved => saved.id === report.id).query_definition).toEqual(report.query_definition);
        await snapshot(page, 'interaction-related-records.png');
        expect(errors).toEqual([]);
    } finally { await data.cleanup(); }
});

test('column click settings persist crossfilters, encoded links and mapped dashboard or question destinations', async ({ page }) => {
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => { window.__openedLinks = []; window.open = (url, target, features) => { window.__openedLinks.push({ url, target, features }); return null; }; });
    await login(page); const data = await fixtures(page);
    try {
        const rows = await data.report('custom click rows');
        const destinationReport = await data.report('question destination', { filters: [{ field: 'total', operator: 'gte', value: 500000 }] });
        const destination = await data.dashboard('dashboard destination', [widget('rows', rows)], [
            filter('status', 'وضعیت مقصد', 'text', 'status', 'eq', {}, 'لغوشده'),
            filter('period', 'دوره مقصد', 'date', 'ordered_at', 'between', {}, ['2026-02-01', '2026-08-31']),
            filter('floor', 'حداقل فروش', 'number', 'total', 'gte', {}, 600000),
        ]);
        const period = ['2026-01-01', '2026-10-31'];
        const source = await data.dashboard('configured click source', [widget('rows', rows)], [
            filter('status', 'وضعیت', 'text', 'status'),
            filter('ids', 'شناسه', 'number', 'id', 'eq', { parent_key: 'status' }),
            filter('period', 'دوره', 'date', 'ordered_at', 'between', {}, period),
        ]);
        await openDashboard(page, source.id);
        await page.locator('[data-action=editDashboard]').click();
        await card(page, 'rows').locator('[data-action=cardSettings]').click();
        await page.locator('.mb-dialog [data-action=editCardClickBehavior]').click();
        await expect(page.locator('[data-click-behavior-editor]')).toBeVisible();
        await page.locator('.mb-dialog [name=click_scope]').selectOption('status');
        await page.locator('.mb-dialog [data-action=chooseClickBehavior][data-type=filter]').click();
        await page.locator('.mb-dialog [name=mapping_source_status]').selectOption('column:status');
        await page.locator('.mb-dialog [name=mapping_source_ids]').selectOption('column:id');
        expect(await page.locator('.mb-dialog [name=mapping_source_status] option[value^="parameter:"]').count()).toBe(0);
        await page.locator('.mb-dialog [name=click_scope]').selectOption('total');
        await page.locator('.mb-dialog [data-action=chooseClickBehavior][data-type=url]').click();
        const url = 'https://example.com/orders/{{column:id}}?status={{column:status}}&period={{parameter:period}}&value={{value}}';
        await page.locator('.mb-dialog [name=url]').fill(url);
        await page.locator('.mb-dialog [name=link_text]').fill('سفارش {{column:id}}');
        await page.locator('.mb-dialog [name=click_scope]').selectOption('id');
        await page.locator('.mb-dialog [data-action=chooseClickBehavior][data-type=dashboard]').click();
        await page.locator('.mb-dialog [name=dashboard_id]').selectOption(String(destination.id));
        await expect(page.locator('.mb-dialog [name=mapping_source_status]')).toBeVisible();
        await page.locator('.mb-dialog [name=mapping_source_status]').selectOption('column:status');
        await page.locator('.mb-dialog [name=mapping_source_period]').selectOption('parameter:period');
        await page.locator('.mb-dialog [name=click_scope]').selectOption('customer_id');
        await page.locator('.mb-dialog [data-action=chooseClickBehavior][data-type=report]').click();
        await page.locator('.mb-dialog [name=report_id]').selectOption(String(destinationReport.id));
        await expect(page.locator('.mb-dialog [name=mapping_source_status]')).toBeVisible();
        await page.locator('.mb-dialog [name=mapping_source_status]').selectOption('column:status');
        await snapshot(page, 'interaction-click-behavior-editor.png');
        await page.locator('.mb-dialog [data-action=saveCardClickBehavior]').click();
        await expect(page.locator('.mb-dialog[data-card-settings]')).toBeVisible();
        await page.locator('.mb-dialog [data-action=saveCardSettings]').click();
        await page.locator('[data-action=saveDashboard]').click();
        await expect(page.locator('.mb-editbar')).toHaveCount(0);
        const saved = (await api(page, `dashboards/${source.id}`)).widgets[0].click_behavior;
        expect(saved.type).toBe('menu');
        expect(saved.columns.status.type).toBe('filter');
        expect(saved.columns.status.mappings).toEqual([{ target: 'status', source: 'column', key: 'status' }, { target: 'ids', source: 'column', key: 'id' }]);
        expect(saved.columns.total.url).toBe(url);
        expect(saved.columns.id.mappings).toEqual([{ target: 'status', source: 'column', key: 'status' }, { target: 'period', source: 'parameter', key: 'period' }]);

        await openDashboard(page, source.id);
        const first = (await resultRows(page))[0];
        await card(page, 'rows').locator('[data-table-cell][data-column=status]').first().click();
        await expect.poll(() => page.evaluate(() => ({ status: window.analyticsStudio.appliedValues.status, ids: Number(window.analyticsStudio.appliedValues.ids) }))).toEqual({ status: first.status, ids: first.id });
        await expect.poll(() => resultRows(page)).toEqual([first]);
        await card(page, 'rows').locator('[data-table-cell][data-column=total]').first().click();
        const expectedUrl = `https://example.com/orders/${first.id}?status=${encodeURIComponent(first.status)}&period=${encodeURIComponent(period.join(','))}&value=${first.total}`;
        await expect.poll(() => page.evaluate(() => window.__openedLinks.at(-1)?.url)).toBe(expectedUrl);
        expect((await page.evaluate(() => window.__openedLinks.at(-1))).features).toContain('noopener');

        await card(page, 'rows').locator('[data-table-cell][data-column=id]').first().click();
        await expect.poll(() => page.evaluate(() => window.analyticsStudio.dashboard.id)).toBe(destination.id);
        await expect.poll(() => page.evaluate(() => window.analyticsStudio.appliedValues)).toEqual({ status: first.status, period, floor: 600000 });
        const escaped = first.status.replaceAll("'", "''");
        const destinationOracle = await data.native(`SELECT id, customer_id, ordered_at, status, total FROM orders WHERE status='${escaped}' AND ordered_at BETWEEN '${period[0]}' AND '${period[1]}' AND total >= 600000`);
        await expect.poll(async () => (await resultRows(page)).sort((left, right) => left.id - right.id)).toEqual([...destinationOracle.rows].sort((left, right) => left.id - right.id));

        await openDashboard(page, source.id);
        await card(page, 'rows').locator('[data-table-cell][data-column=customer_id]').first().click();
        await expect(page.locator('.mb-preview-body .mb-table')).toBeVisible();
        const questionOracle = await data.native(`SELECT id, customer_id, ordered_at, status, total FROM orders WHERE total >= 500000 AND status='${escaped}'`);
        await expect.poll(() => page.evaluate(() => window.analyticsStudio.previewResult?.rows)).toEqual(questionOracle.rows);
        expect((await api(page, 'library')).reports.find(report => report.id === destinationReport.id).query_definition).toEqual(destinationReport.query_definition);

        await openDashboard(page, source.id);
        await page.locator('[data-action=editDashboard]').click();
        await page.locator('[data-action=editDashboardFilter][data-key=period]').click();
        await page.locator('.mb-dialog [data-action=removeDashboardFilter]').click();
        await page.locator('[data-action=editDashboardFilter][data-key=status]').click();
        await page.locator('.mb-dialog [data-action=removeDashboardFilter]').click();
        await page.locator('[data-action=saveDashboard]').click();
        await expect(page.locator('.mb-editbar')).toHaveCount(0);
        const cleaned = (await api(page, `dashboards/${source.id}`)).widgets[0].click_behavior;
        expect(cleaned.columns.status.type).toBe('filter');
        expect(cleaned.columns.status.mappings).toEqual([{ target: 'ids', source: 'column', key: 'id' }]);
        expect(cleaned.columns.total).toEqual({ type: 'none' });
        expect(cleaned.columns.id.mappings).toEqual([{ target: 'status', source: 'column', key: 'status' }]);
        expect(errors).toEqual([]);
    } finally { await data.cleanup(); }
});

test('Notebook filters expose typed operators, text case sensitivity and zero-valued ranges in every stage', async ({ page }) => {
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await login(page); const data = await fixtures(page);
    try {
        const report = await data.report('Notebook typed filters', { columns: ['id', 'code', 'flag', 'total'], expressions: [
            { key: 'code', label: 'کد سفارش', expression: 'case([id] <= 300, "Order-A", "Order-B")' },
            { key: 'flag', label: 'پس از ۳۰۰', expression: '[id] > 300' },
        ] });
        await openReport(page, report.id);
        await page.locator('[data-action=toggleNotebook]').click();
        await page.locator('[data-action=addReportFilter]').click();
        await page.locator('.mb-dialog [name=field]').selectOption('code');
        expect(await page.locator('.mb-dialog [name=operator] option[value=gt]').count()).toBe(0);
        expect(await page.locator('.mb-dialog [name=operator] option[value=is_empty]').count()).toBe(1);
        await page.locator('.mb-dialog [name=operator]').selectOption('contains');
        await page.locator('.mb-dialog [name=value]').fill('ORDER-');
        await page.locator('.mb-dialog [name=case_sensitive]').check();
        await page.locator('.mb-dialog [data-action=saveReportFilter]').click();
        await expect(page.locator('.mb-dialog')).toHaveCount(0);
        expect(await page.evaluate(() => window.analyticsStudio.report.query_definition.filters[0].case_sensitive)).toBe(true);
        await page.getByRole('button', { name: 'نمایش نتیجه', exact: true }).click();
        await expect.poll(() => page.evaluate(() => window.analyticsStudio.previewResult?.rows)).toEqual([]);
        await page.locator('[data-action=toggleNotebook]').click();
        const firstFilter = page.locator('[data-notebook-step=filter][data-stage="0"] [data-action=editNotebookClause][data-list=filters][data-index="0"]');
        await firstFilter.click();
        await expect(page.locator('.mb-dialog [name=value]')).toHaveValue('ORDER-');
        await expect(page.locator('.mb-dialog [name=case_sensitive]')).toBeChecked();
        await page.locator('.mb-dialog [name=operator]').selectOption('ends_with');
        await page.locator('.mb-dialog [name=value]').fill('A');
        await page.locator('.mb-dialog [name=case_sensitive]').uncheck();
        await page.locator('.mb-dialog [data-action=saveReportFilter]').click();
        await expect(page.locator('.mb-dialog')).toHaveCount(0);
        await page.locator('[data-action=addReportFilter]').click();
        await page.locator('.mb-dialog [name=field]').selectOption('total');
        expect(await page.locator('.mb-dialog [name=operator] option[value=ends_with]').count()).toBe(0);
        await page.locator('.mb-dialog [name=operator]').selectOption('not_between');
        await page.locator('.mb-dialog [name=from]').fill('0');
        await page.locator('.mb-dialog [name=to]').fill('500000');
        await page.locator('.mb-dialog [data-action=saveReportFilter]').click();
        await expect(page.locator('.mb-dialog')).toHaveCount(0);
        expect(await page.evaluate(() => window.analyticsStudio.report.query_definition.filters[1].value)).toEqual([0, 500000]);
        await page.getByRole('button', { name: 'نمایش نتیجه', exact: true }).click();
        const expected = await data.native("SELECT id, CASE WHEN id <= 300 THEN 'Order-A' ELSE 'Order-B' END AS code, id > 300 AS flag, total FROM orders WHERE id <= 300 AND total NOT BETWEEN 0 AND 500000");
        await expect.poll(() => page.evaluate(() => window.analyticsStudio.previewResult?.rows)).toEqual(expected.rows);

        const grouped = await data.report('Notebook boolean output', { mode: 'aggregate', columns: undefined, expressions: [{ key: 'flag', label: 'پس از ۳۰۰', expression: '[id] > 300' }], dimensions: [{ field: 'flag', grain: null }], metrics: [{ key: 'revenue', function: 'sum', field: 'total' }] });
        await openReport(page, grouped.id);
        await page.locator('[data-action=toggleNotebook]').click();
        await page.locator('[data-action=openNotebookStep][data-kind=filter][data-stage="1"]').click();
        await page.locator('.mb-dialog [name=field]').selectOption('flag');
        expect(await page.locator('.mb-dialog [name=operator] option[value=gt]').count()).toBe(0);
        await page.locator('.mb-dialog [name=operator]').selectOption('not_in');
        await page.locator('.mb-dialog [name=value][value="0"]').check();
        await snapshot(page, 'interaction-notebook-filter-boolean.png');
        await page.locator('.mb-dialog [data-action=saveNotebookFilter]').click();
        await expect(page.locator('.mb-dialog')).toHaveCount(0);
        expect(await page.evaluate(() => window.analyticsStudio.report.query_definition.stages[0].filters[0].value)).toEqual([0]);
        await page.getByRole('button', { name: 'نمایش نتیجه', exact: true }).click();
        const trueGroup = await data.native('SELECT id > 300 AS flag, SUM(total) AS revenue FROM orders GROUP BY id > 300 HAVING id > 300');
        await expect.poll(() => page.evaluate(() => window.analyticsStudio.previewResult?.rows)).toEqual(trueGroup.rows);
        expect(errors).toEqual([]);
    } finally { await data.cleanup(); }
});

test('server-search finds values beyond the first page and preserves multiselect across searches', async ({ page }) => {
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await login(page); const data = await fixtures(page);
    try {
        const report = await data.report('search IDs');
        const board = await data.dashboard('search IDs', [widget('rows', report)], [filter('ids', 'شناسه‌های سفارش', 'number', 'id', 'in')]);
        await openDashboard(page, board.id);
        await page.locator('[data-action=editFilterValue][data-key=ids]').click();
        await expect(page.locator('.mb-dialog [data-value-search]')).toBeVisible();
        await expect(option(page, 600)).toHaveCount(0);
        await page.locator('.mb-dialog [data-action=loadMoreFilterValues]').click();
        await expect.poll(() => page.locator('.mb-dialog .mb-value-option').count()).toBeGreaterThan(50);
        const last = await searchValues(page, '600');
        expect(last.values).toContain(600);
        await option(page, 600).check();
        const previous = await searchValues(page, '599');
        expect(previous.values).toContain(599);
        await option(page, 599).check();
        await expect(page.locator('.mb-filter-selected-values')).toContainText('600');
        await expect(page.locator('.mb-filter-selected-values')).toContainText('599');
        await snapshot(page, 'interaction-filter-server-search.png');
        await page.locator('.mb-dialog [data-action=saveFilterValue]').click();
        await expect.poll(() => page.evaluate(() => window.analyticsStudio.appliedValues.ids.map(Number).sort((a, b) => a - b))).toEqual([599, 600]);
        await expect.poll(() => resultRows(page)).toEqual((await data.native('SELECT id, customer_id, ordered_at, status, total FROM orders WHERE id IN (599, 600)')).rows);

        await page.locator('[data-action=editFilterValue][data-key=ids]').click();
        await searchValues(page, 'no-such-order');
        await expect(page.locator('.mb-dialog .mb-filter-value-list')).toContainText('یافت نشد');
        await expect(page.locator('.mb-filter-selected-values')).toContainText('600');
        await searchValues(page, '59');
        await page.locator('.mb-dialog [data-action=toggleAllFilterValues]').click();
        await page.locator('.mb-dialog [data-action=saveFilterValue]').click();
        const selectedOracle = await data.native("SELECT id, customer_id, ordered_at, status, total FROM orders WHERE CAST(id AS TEXT) LIKE '%59%' OR id=600");
        await expect.poll(() => resultRows(page)).toEqual(selectedOracle.rows);
        expect(errors).toEqual([]);
    } finally { await data.cleanup(); }
});

test('linked filter options follow their parent and changing or clearing it resets descendants', async ({ page }) => {
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await login(page); const data = await fixtures(page);
    try {
        const report = await data.report('dependent IDs');
        const board = await data.dashboard('dependent IDs', [widget('rows', report)], [
            filter('status', 'وضعیت سفارش', 'text', 'status'),
            filter('ids', 'شناسه سفارش', 'number', 'id', 'in', { parent_key: 'status' }),
            filter('customers', 'مشتری سفارش', 'number', 'customer_id', 'in', { parent_key: 'ids' }),
        ]);
        await openDashboard(page, board.id);
        await expect(page.locator('[data-action=editFilterValue][data-key=ids]')).toBeDisabled();
        await expect(page.locator('[data-action=editFilterValue][data-key=customers]')).toBeDisabled();
        await page.locator('[data-action=editFilterValue][data-key=status]').click();
        await option(page, 'تکمیل‌شده').check();
        await page.locator('.mb-dialog [data-action=saveFilterValue]').click();
        await expect(page.locator('[data-action=editFilterValue][data-key=ids]')).toBeEnabled();
        const expected = (await data.native("SELECT id FROM orders WHERE status='تکمیل‌شده' ORDER BY id LIMIT 50")).rows.map(row => row.id);
        await page.locator('[data-action=editFilterValue][data-key=ids]').click();
        await expect.poll(async () => (await page.locator('.mb-dialog .mb-value-option span').allTextContents()).map(Number)).toEqual(expected);
        await option(page, expected[0]).check();
        await page.locator('.mb-dialog [data-action=saveFilterValue]').click();
        await expect(page.locator('[data-action=editFilterValue][data-key=customers]')).toBeEnabled();
        const order = (await data.native(`SELECT customer_id FROM orders WHERE id=${expected[0]}`)).rows[0];
        await page.locator('[data-action=editFilterValue][data-key=customers]').click();
        await option(page, order.customer_id).check();
        await page.locator('.mb-dialog [data-action=saveFilterValue]').click();
        await expect.poll(() => resultRows(page)).toHaveLength(1);

        await page.locator('[data-action=editFilterValue][data-key=status]').click();
        await option(page, 'لغوشده').check();
        await page.locator('.mb-dialog [data-action=saveFilterValue]').click();
        await expect.poll(() => page.evaluate(() => [window.analyticsStudio.filterValues.ids, window.analyticsStudio.filterValues.customers])).toEqual([null, null]);
        await expect(page.locator('[data-action=editFilterValue][data-key=customers]')).toBeDisabled();
        await page.locator('[data-action=editFilterValue][data-key=ids]').click();
        const cancelled = (await data.native("SELECT id FROM orders WHERE status='لغوشده' ORDER BY id LIMIT 50")).rows.map(row => row.id);
        await expect.poll(async () => (await page.locator('.mb-dialog .mb-value-option span').allTextContents()).map(Number)).toEqual(cancelled);
        await page.locator('.mb-dialog').getByRole('button', { name: 'بستن', exact: true }).click();
        await page.locator('[data-action=editFilterValue][data-key=status]').click();
        await page.locator('.mb-dialog [data-action=clearFilterValue]').click();
        await expect.poll(() => page.evaluate(() => [window.analyticsStudio.appliedValues.status, window.analyticsStudio.appliedValues.ids, window.analyticsStudio.appliedValues.customers])).toEqual([null, null, null]);
        await expect(page.locator('[data-action=editFilterValue][data-key=ids]')).toBeDisabled();
        await expect.poll(() => resultRows(page)).toHaveLength(600);
        await snapshot(page, 'interaction-linked-filters.png');
        expect(errors).toEqual([]);
    } finally { await data.cleanup(); }
});

test('rolling date and excluded ranges keep their descriptors while false and zero remain selected values', async ({ page }) => {
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await login(page); const data = await fixtures(page);
    try {
        const report = await data.report('typed date filters', { columns: ['id', 'ordered_at', 'above300'], expressions: [{ key: 'above300', label: 'پس از شناسهٔ ۳۰۰', expression: '[id] > 300' }] });
        const relative = { kind: 'relative_date', unit: 'month', amount: 1, direction: 'past', include_current: false, exclude: false };
        const board = await data.dashboard('relative and false', [widget('rows', report)], [
            filter('period', 'دورهٔ پویا', 'date', 'ordered_at', 'between', {}, relative),
            filter('flag', 'پس از ۳۰۰؟', 'boolean', 'above300'),
            filter('zero', 'شناسهٔ دقیق', 'number', 'id'),
        ]);
        await openDashboard(page, board.id);
        expect(await page.evaluate(() => window.analyticsStudio.appliedValues.period)).toEqual(relative);
        const previousMonth = (await data.native("SELECT id, ordered_at, id > 300 AS above300 FROM orders WHERE ordered_at >= date('now', 'start of month', '-1 month') AND ordered_at < date('now', 'start of month')")).rows;
        await expect.poll(() => resultRows(page)).toEqual(previousMonth);
        await page.locator('[data-action=editFilterValue][data-key=period]').click();
        await expect(page.locator('.mb-dialog [name=relative_unit]')).toHaveValue('month');
        await page.locator('.mb-dialog [name=relative_amount]').fill('1');
        await page.locator('.mb-dialog [name=relative_direction]').selectOption('past');
        await page.locator('.mb-dialog [name=include_current]').uncheck();
        await page.locator('.mb-dialog [name=exclude]').uncheck();
        await page.locator('.mb-dialog [data-action=saveFilterValue]').click();
        expect(await page.evaluate(() => window.analyticsStudio.appliedValues.period)).toEqual(relative);
        expect((await api(page, `dashboards/${board.id}`)).filters.find(row => row.key === 'period').default_value).toEqual(relative);

        await page.locator('[data-action=editFilterValue][data-key=flag]').click();
        await option(page, 'خیر').check();
        await page.locator('.mb-dialog [data-action=saveFilterValue]').click();
        await expect.poll(() => page.evaluate(() => window.analyticsStudio.appliedValues.flag)).toBe(false);
        await expect.poll(() => resultRows(page)).toEqual(previousMonth.filter(row => row.id <= 300));
        await expect(page.locator('[data-action=editFilterValue][data-key=flag]')).toContainText('خیر');
        await page.locator('[data-action=editFilterValue][data-key=period]').click();
        await page.locator('.mb-dialog [data-action=changeFilterDateTab][data-tab=specific]').click();
        await page.locator('.mb-dialog [name=from]').fill('2026-02-01');
        await page.locator('.mb-dialog [name=to]').fill('2026-02-28');
        await page.locator('.mb-dialog [name=exclude]').check();
        await snapshot(page, 'interaction-relative-exclude-date.png');
        await page.locator('.mb-dialog [data-action=saveFilterValue]').click();
        await expect.poll(() => page.evaluate(() => window.analyticsStudio.appliedValues.period)).toEqual({ kind: 'date_range', from: '2026-02-01', to: '2026-02-28', exclude: true });
        const excluded = await data.native("SELECT id, ordered_at, id > 300 AS above300 FROM orders WHERE id <= 300 AND ordered_at NOT BETWEEN '2026-02-01' AND '2026-02-28'");
        await expect.poll(async () => (await resultRows(page)).sort((left, right) => left.id - right.id)).toEqual([...excluded.rows].sort((left, right) => left.id - right.id));

        await page.locator('[data-action=editFilterValue][data-key=zero]').click();
        await page.locator('.mb-dialog [name=value]').fill('0');
        await page.locator('.mb-dialog [data-action=saveFilterValue]').click();
        await expect.poll(() => page.evaluate(() => window.analyticsStudio.appliedValues.zero)).toBe(0);
        await expect(page.locator('[data-action=editFilterValue][data-key=zero]')).toContainText('0');
        await expect.poll(() => resultRows(page)).toEqual([]);
        expect(errors).toEqual([]);
    } finally { await data.cleanup(); }
});

test('date-part checklists persist in questions and dashboard exclusions use ISO weekdays', async ({ page }) => {
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await login(page); const data = await fixtures(page);
    try {
        const report = await data.report('date part question');
        await openReport(page, report.id);
        await page.locator('[data-action=toggleNotebook]').click();
        await page.locator('[data-action=addReportFilter]').click();
        await page.locator('.mb-dialog [name=field]').selectOption('ordered_at');
        await page.locator('.mb-dialog [name=operator]').selectOption('not_in');
        await page.locator('.mb-dialog [name=date_part]').selectOption('day_of_week');
        await page.locator('.mb-dialog [name=value][value="5"]').check();
        await page.locator('.mb-dialog [name=value][value="6"]').check();
        await snapshot(page, 'interaction-notebook-date-parts.png');
        await page.locator('.mb-dialog [data-action=saveReportFilter]').click();
        await expect(page.locator('.mb-dialog')).toHaveCount(0);
        expect(await page.evaluate(() => window.analyticsStudio.report.query_definition.filters[0])).toEqual({ field: 'ordered_at', operator: 'not_in', date_part: 'day_of_week', value: [5, 6] });
        const weekdays = await data.native("SELECT id, customer_id, ordered_at, status, total FROM orders WHERE ((CAST(strftime('%w', ordered_at) AS INTEGER) + 6) % 7) + 1 NOT IN (5,6)");
        await page.getByRole('button', { name: 'نمایش نتیجه', exact: true }).click();
        await expect.poll(() => page.evaluate(() => window.analyticsStudio.previewResult?.rows)).toEqual(weekdays.rows);
        await page.locator('[data-action=toggleNotebook]').click();

        await page.locator('[data-notebook-step=filter][data-stage="0"] [data-action=editNotebookClause][data-list=filters][data-index="0"]').click();
        await expect(page.locator('.mb-dialog [name=date_part]')).toHaveValue('day_of_week');
        await expect(page.locator('.mb-dialog [name=value][value="5"]')).toBeChecked();
        await page.locator('.mb-dialog [name=operator]').selectOption('in');
        await page.locator('.mb-dialog [name=date_part]').selectOption('month');
        for (const choice of await page.locator('.mb-dialog [name=value]').all()) await choice.uncheck();
        await page.locator('.mb-dialog [name=value][value="1"]').check();
        await page.locator('.mb-dialog [name=value][value="2"]').check();
        await page.locator('.mb-dialog [data-action=saveReportFilter]').click();
        await expect(page.locator('.mb-dialog')).toHaveCount(0);
        const earlyMonths = await data.native("SELECT id, customer_id, ordered_at, status, total FROM orders WHERE CAST(strftime('%m', ordered_at) AS INTEGER) IN (1,2)");
        await page.getByRole('button', { name: 'نمایش نتیجه', exact: true }).click();
        await expect.poll(() => page.evaluate(() => window.analyticsStudio.previewResult?.rows)).toEqual(earlyMonths.rows);
        await page.locator('[data-action=reportSaveDialog]').click();
        await page.locator('.mb-dialog [data-action=saveReport]').click();
        await expect(page.locator('.mb-dialog')).toHaveCount(0);
        await openReport(page, report.id);
        expect(await page.evaluate(() => window.analyticsStudio.report.query_definition.filters[0])).toEqual({ field: 'ordered_at', operator: 'in', date_part: 'month', value: [1, 2] });
        expect(await page.evaluate(() => window.analyticsStudio.previewResult?.rows)).toEqual(earlyMonths.rows);

        const raw = await data.report('date part dashboard');
        const board = await data.dashboard('ISO weekday exclusion', [widget('rows', raw)], [filter('period', 'روزهای سفارش', 'date', 'ordered_at', 'between')]);
        await openDashboard(page, board.id);
        await page.locator('[data-action=editFilterValue][data-key=period]').click();
        await page.locator('.mb-dialog [data-action=changeFilterDateTab][data-tab=exclude]').click();
        await page.locator('.mb-dialog [name=date_exclude_mode]').selectOption('day_of_week');
        await page.locator('.mb-dialog [name=date_exclude_values][value="5"]').check();
        await page.locator('.mb-dialog [name=date_exclude_values][value="6"]').check();
        await snapshot(page, 'interaction-dashboard-date-parts.png');
        await page.locator('.mb-dialog [data-action=saveFilterValue]').click();
        await expect.poll(() => page.evaluate(() => window.analyticsStudio.appliedValues.period)).toEqual({ kind: 'date_parts', part: 'day_of_week', values: [5, 6], exclude: true });
        await expect.poll(() => resultRows(page)).toEqual(weekdays.rows);
        await page.locator('[data-action=editFilterValue][data-key=period]').click();
        await page.locator('.mb-dialog [name=date_exclude_mode]').selectOption('empty');
        await page.locator('.mb-dialog [data-action=saveFilterValue]').click();
        await expect.poll(() => page.evaluate(() => window.analyticsStudio.appliedValues.period)).toEqual({ kind: 'presence', empty: false });
        await expect.poll(() => resultRows(page)).toHaveLength(600);
        expect(errors).toEqual([]);
    } finally { await data.cleanup(); }
});
