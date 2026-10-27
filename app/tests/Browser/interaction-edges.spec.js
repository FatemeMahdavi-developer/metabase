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
    const reportIds = [], dashboardIds = [];
    const sample = (await api(page, 'library')).connections.find(connection => connection.driver === 'sqlite' && connection.name === 'فروشگاه نمونه • SQLite' && connection.catalog?.some(table => table.key === 'orders'));
    expect(sample).toBeTruthy();
    const prefix = 'Browser interaction edges ' + Date.now();
    return {
        async report(label, query = {}, display = 'table', visualization_settings = {}) {
            const report = await api(page, 'reports', 'POST', { name: prefix + ' ' + label, description: null, folder_id: null, query_definition: definition(sample.id, query), display, visualization_settings });
            reportIds.push(report.id); return report;
        },
        async dashboard(label, widgets, filters = []) {
            const board = await api(page, 'dashboards', 'POST', { name: prefix + ' ' + label, description: null, folder_id: null });
            dashboardIds.push(board.id);
            return api(page, `dashboards/${board.id}`, 'PUT', { ...board, widgets, filters });
        },
        async native(sql) {
            return api(page, 'reports/preview', 'POST', { query_definition: definition(sample.id, { mode: 'native', sql, parameters: [], columns: undefined }) });
        },
        async cleanup() {
            for (const id of dashboardIds.reverse()) await api(page, `dashboards/${id}`, 'DELETE');
            for (const id of reportIds.reverse()) await api(page, `reports/${id}`, 'DELETE');
        },
    };
}

function widget(key, report, y = 0, click_behavior = { type: 'details' }) {
    return { key, report_id: report.id, tab_key: 'main', type: 'report', x: 0, y, w: 24, h: 9, settings: {}, content: null, click_behavior };
}

function filter(key, label, type, widgetKey, target, operator) {
    return { key, label, type, required: false, default_value: null, settings: {}, bindings: [{ widget_key: widgetKey, target, operator }] };
}

async function openDashboard(page, id) {
    await page.goto('/admin/analytics/dashboards/' + id);
    await expect.poll(() => page.evaluate(() => window.analyticsStudio.dashboard?.id)).toBe(id);
    await expect(page.locator('.mb-card').first()).toBeVisible();
    await expect(page.locator('.mb-card .mb-loading')).toHaveCount(0);
    await expect(page.locator('.mb-card .mb-error')).toHaveCount(0);
}

const card = (page, key) => page.locator(`[data-widget="${key}"]`);
const byId = rows => [...rows].sort((left, right) => left.id - right.id);

test('date clicks use the final month grain after a day-grain aggregate stage', async ({ page }) => {
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await login(page); const data = await fixtures(page);
    try {
        const monthly = await data.report('day then month', {
            mode: 'aggregate', columns: undefined,
            dimensions: [{ field: 'ordered_at', grain: 'day' }],
            metrics: [{ key: 'daily_revenue', function: 'sum', field: 'total' }],
            stages: [{ mode: 'aggregate', dimensions: [{ field: 'ordered_at', grain: 'month' }], metrics: [{ key: 'monthly_revenue', function: 'sum', field: 'daily_revenue' }], filters: [], sort: [{ key: 'ordered_at', direction: 'asc' }], joins: [], expressions: [], limit: null }],
        });
        const rows = await data.report('month clicked records', { sort: [{ key: 'id', direction: 'asc' }] });
        const board = await data.dashboard('final grain click', [
            widget('monthly', monthly, 0, { type: 'menu', columns: { ordered_at: { type: 'filter', mappings: [{ target: 'period', source: 'column', key: 'ordered_at' }] } } }),
            widget('rows', rows, 9),
        ], [filter('period', 'ماه انتخابی', 'date', 'rows', 'ordered_at', 'between')]);
        await openDashboard(page, board.id);
        const result = await page.evaluate(() => window.analyticsStudio.results.get('monthly'));
        expect(result.columns.find(column => column.key === 'ordered_at').grain).toBe('month');
        expect(monthly.query_definition.dimensions[0].grain).toBe('day');
        expect(monthly.query_definition.stages[0].dimensions[0].grain).toBe('month');
        const start = result.rows[0].ordered_at;
        const end = new Date(start + 'T00:00:00Z'); end.setUTCMonth(end.getUTCMonth() + 1, 0);
        const range = [start, end.toISOString().slice(0, 10)];
        const oracle = await data.native(`SELECT id, customer_id, ordered_at, status, total FROM orders WHERE ordered_at BETWEEN '${range[0]}' AND '${range[1]}' ORDER BY id ASC`);
        expect(oracle.rows.length).toBeGreaterThan(1);
        expect(new Set(oracle.rows.map(row => row.ordered_at)).size).toBeGreaterThan(1);
        await card(page, 'monthly').locator('[data-table-cell][data-column=ordered_at]').first().click();
        await expect.poll(() => page.evaluate(() => window.analyticsStudio.appliedValues.period)).toEqual(range);
        await expect.poll(() => page.evaluate(() => window.analyticsStudio.results.get('rows')?.rows)).toEqual(oracle.rows);
        await expect(page.locator('[data-drill-menu]')).toHaveCount(0);
        expect((await api(page, 'library')).reports.find(report => report.id === monthly.id).query_definition).toEqual(monthly.query_definition);
        await page.screenshot({ path: 'tests/Browser/artifacts/interaction-final-stage-date-grain.png', fullPage: true });
        expect(errors).toEqual([]);
    } finally { await data.cleanup(); }
});

test('merged pivot cells map the displayed sum and drill both NULL and literal dash buckets without narrowing the third breakout', async ({ page }) => {
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await login(page); const data = await fixtures(page);
    try {
        // The two display-identical buckets are distinct values: literal "—" and SQL NULL.
        const grouped = await data.report('three-breakout pivot', {
            mode: 'aggregate', columns: undefined,
            expressions: [{ key: 'half', label: 'بخش سفارش', expression: 'case([id] <= 300, "—")' }],
            dimensions: [{ field: 'status', grain: null }, { field: 'half', grain: null }, { field: 'customer_id', grain: null }],
            metrics: [{ key: 'order_count', label: 'تعداد سفارش', function: 'count', field: null }],
        }, 'pivot', { x: 'status', split: 'half', y: 'order_count' });
        const raw = await data.report('displayed count mapping', { sort: [{ key: 'id', direction: 'asc' }] });
        const board = await data.dashboard('merged pivot interactions', [
            widget('mapped', grouped, 0, { type: 'menu', columns: { order_count: { type: 'filter', mappings: [{ target: 'selected_count', source: 'column', key: 'order_count' }] } } }),
            widget('explore', grouped, 9),
            widget('rows', raw, 18),
        ], [filter('selected_count', 'تعداد نمایش‌داده‌شده', 'number', 'rows', 'id', 'eq')]);
        await openDashboard(page, board.id);
        const buckets = await page.evaluate(() => {
            const result = window.analyticsStudio.results.get('mapped');
            const unique = values => [...new Map(values.map(value => [JSON.stringify(value), value])).values()];
            const statuses = unique(result.rows.map(row => row.status));
            const halves = unique(result.rows.map(row => row.half));
            const rowIndex = statuses.findIndex(status => halves.every(half => result.rows.filter(row => row.status === status && row.half === half).length > 1));
            return halves.map((half, columnIndex) => {
                const matches = result.rows.filter(row => row.status === statuses[rowIndex] && row.half === half);
                return { rowIndex, columnIndex, status: statuses[rowIndex], half, sum: matches.reduce((sum, row) => sum + row.order_count, 0), matchingRows: matches.length, thirdCategories: unique(matches.map(row => row.customer_id)) };
            });
        });
        expect(buckets).toHaveLength(2);
        expect(buckets.map(bucket => bucket.half)).toEqual(expect.arrayContaining([null, '—']));
        for (const bucket of buckets) {
            expect(bucket.rowIndex).toBeGreaterThanOrEqual(0);
            expect(bucket.matchingRows).toBeGreaterThan(1);
            expect(bucket.thirdCategories.length).toBeGreaterThan(1);
        }
        const pivotCell = (key, bucket) => card(page, key).locator(`[data-pivot-cell][data-pivot-row-index="${bucket.rowIndex}"][data-pivot-column-index="${bucket.columnIndex}"]`);
        const mappedBucket = buckets.find(bucket => bucket.half === null);
        await expect(pivotCell('mapped', mappedBucket)).toHaveText(new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 0 }).format(mappedBucket.sum));
        const mappedOracle = await data.native(`SELECT id, customer_id, ordered_at, status, total FROM orders WHERE id=${mappedBucket.sum} ORDER BY id ASC`);
        expect(mappedOracle.rows).toHaveLength(1);
        await pivotCell('mapped', mappedBucket).click();
        await expect.poll(() => page.evaluate(() => window.analyticsStudio.appliedValues.selected_count)).toBe(mappedBucket.sum);
        await expect.poll(() => page.evaluate(() => window.analyticsStudio.results.get('rows')?.rows)).toEqual(mappedOracle.rows);

        for (const bucket of buckets) {
            const escapedStatus = bucket.status.replaceAll("'", "''");
            const halfPredicate = bucket.half === null ? 'id > 300' : 'id <= 300';
            const oracle = await data.native(`SELECT id, customer_id, ordered_at, status, total FROM orders WHERE status='${escapedStatus}' AND ${halfPredicate} ORDER BY id ASC`);
            expect(oracle.rows).toHaveLength(bucket.sum);
            const expectedCategories = [...new Set(oracle.rows.map(row => row.customer_id))].sort((left, right) => left - right);
            expect(expectedCategories).toEqual([...bucket.thirdCategories].sort((left, right) => left - right));
            await pivotCell('explore', bucket).click();
            await expect(page.locator('[data-drill-menu] [data-drill-action=underlying]')).toBeVisible();
            const context = await page.evaluate(() => window.analyticsStudio.drillMenuData.response.context);
            expect(context.kind).toBe('total');
            expect(context.scope_fields).toEqual(['status', 'half']);
            expect(context.value).toBe(bucket.sum);
            await page.locator('[data-drill-menu] [data-drill-action=underlying]').click();
            await expect(page.locator('.mb-drill-view')).toBeVisible();
            await expect.poll(() => page.evaluate(() => window.analyticsStudio.previewResult?.rows.map(row => row.id).sort((left, right) => left - right))).toEqual(byId(oracle.rows).map(row => row.id));
            const drill = await page.evaluate(() => ({ query: window.analyticsStudio.report.query_definition, rows: window.analyticsStudio.previewResult.rows }));
            expect(new Set(drill.rows.map(row => row.customer_id))).toEqual(new Set(expectedCategories));
            expect(drill.query.filters.map(row => row.field)).toEqual(expect.arrayContaining(['status', 'half']));
            expect(drill.query.filters.some(row => row.field === 'customer_id')).toBe(false);
            await page.locator('[data-action=returnFromDrill]').click();
            await expect(card(page, 'explore').locator('.mb-pivot')).toBeVisible();
            await expect.poll(() => page.evaluate(() => window.analyticsStudio.appliedValues.selected_count)).toBe(mappedBucket.sum);
        }
        expect((await api(page, 'library')).reports.find(report => report.id === grouped.id).query_definition).toEqual(grouped.query_definition);
        await page.screenshot({ path: 'tests/Browser/artifacts/interaction-merged-pivot-cells.png', fullPage: true });
        expect(errors).toEqual([]);
    } finally { await data.cleanup(); }
});
