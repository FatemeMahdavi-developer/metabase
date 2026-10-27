import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const credentials = process.env.ANALYTICS_PASSWORD
    ? { email: process.env.ANALYTICS_EMAIL || 'admin@example.com', password: process.env.ANALYTICS_PASSWORD }
    : JSON.parse(fs.readFileSync(path.resolve('../.tools/admin.json'), 'utf8').replace(/^\uFEFF/, ''));

test.setTimeout(300000);
const customColor = '#e84d8a';
// Reference PNG slice colors, measured independently of the renderer's tokens.
const referencePieColors = ['#5947f9', '#af65ff', '#ca98ff', '#ff9e69', '#fdd0a6', '#3a4de9'];
const bucketExpression = 'case([id] <= 100, "null", [id] <= 200, "—", [id] <= 300, "", [id] <= 400, "Premium")';
const bucketSql = "CASE WHEN id <= 100 THEN 'null' WHEN id <= 200 THEN '—' WHEN id <= 300 THEN '' WHEN id <= 400 THEN 'Premium' END";

async function api(page, route, method = 'GET', payload) {
    return page.evaluate(async ({ route, method, payload }) => {
        const response = await fetch('/analytics/api/' + route, { method, headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-CSRF-TOKEN': document.querySelector('meta[name="csrf-token"]').content }, ...(payload ? { body: JSON.stringify(payload) } : {}) });
        const body = await response.json(); if (!response.ok) throw new Error(JSON.stringify(body)); return body;
    }, { route, method, payload });
}

async function login(page) {
    page.on('dialog', async dialog => { if (dialog.type() === 'beforeunload') await dialog.accept(); else { await dialog.dismiss(); throw new Error('Unexpected browser dialog: ' + dialog.message()); } });
    await page.goto('/admin/login');
    await page.locator('input[type=email]').fill(credentials.email);
    await page.locator('input[type=password]').fill(credentials.password);
    await page.locator('button[type=submit]').click();
    await expect(page).not.toHaveURL(/login/);
    await page.goto('/admin/analytics/dashboards');
    await expect(page.locator('.fi-ta-table')).toBeVisible();
    await setNativeTheme(page, 'light');
}

async function fixtures(page) {
    const reports = [], boards = [];
    const connection = (await api(page, 'library')).connections.find(row => row.driver === 'sqlite' && row.name === 'فروشگاه نمونه • SQLite' && row.catalog?.some(table => table.key === 'orders'));
    expect(connection).toBeTruthy();
    const base = { connection_id: connection.id, source: 'orders', mode: 'rows', columns: ['id', 'ordered_at', 'status', 'total'], expressions: [], filters: [], joins: [], metrics: [], dimensions: [], sort: [], limit: null };
    return {
        connection,
        async report(label, query = {}, display = 'table', visualization_settings = {}) {
            const report = await api(page, 'reports', 'POST', { name: `Browser widget style ${Date.now()} ${label}`, description: null, folder_id: null, display, visualization_settings, query_definition: { ...base, ...query } }); reports.push(report.id); return report;
        },
        async dashboard(label, widgets, filters = []) {
            const board = await api(page, 'dashboards', 'POST', { name: `Browser widget style ${Date.now()} ${label}`, description: null, folder_id: null }); boards.push(board.id);
            return api(page, `dashboards/${board.id}`, 'PUT', { ...board, widgets, filters });
        },
        native: sql => api(page, 'reports/preview', 'POST', { query_definition: { ...base, mode: 'native', sql, parameters: [], columns: undefined } }),
        async cleanup() { for (const id of boards.reverse()) await api(page, `dashboards/${id}`, 'DELETE'); for (const id of reports.reverse()) await api(page, `reports/${id}`, 'DELETE'); },
    };
}

function widget(key, report, x = 0, y = 0, w = 12, h = 9, settings = {}) { return { key, report_id: report.id, type: 'report', tab_key: 'main', x, y, w, h, settings, content: null, click_behavior: { type: 'menu' } }; }
const chartContainer = (page, key) => key ? page.locator(`[data-widget="${key}"]`) : page.locator('.mb-preview-body');
const nativeThemeLabels = { light: 'حالت روشن', dark: 'حالت تیره', system: 'حالت سیستم' };
const nativeThemeButton = (page, mode) => page.locator('.fi-theme-switcher').getByRole('button', { name: nativeThemeLabels[mode], exact: true });

async function closeNativeDrawerIfOpen(page) {
    if (page.viewportSize().width >= 1024) return;
    const overlay = page.locator('.fi-sidebar-close-overlay');
    if (await overlay.isVisible()) await overlay.click({ position: { x: 16, y: 200 } });
    await expect(overlay).not.toBeVisible();
    await expect(page.locator('.fi-topbar-close-sidebar-btn')).not.toBeVisible();
}

async function assertSingleThemeSource(page) {
    await expect(page.locator('#analytics-studio [data-analytics-theme-controls], #analytics-studio [data-action=setAnalyticsTheme], #analytics-studio .mb-appearance-bar')).toHaveCount(0);
    await expect(page.locator('#analytics-studio .mb-sidebar')).toHaveCount(0);
    await expect(page.locator('.fi-topbar-open-sidebar-btn:visible, .fi-topbar-close-sidebar-btn:visible')).toHaveCount(page.viewportSize().width < 1024 ? 1 : 0);
    await expect(page.locator('.fi-theme-switcher')).toHaveCount(1);
    await expect(page.locator('.fi-theme-switcher button')).toHaveCount(3);
}

async function openNativeThemeMenu(page) {
    await assertSingleThemeSource(page);
    await closeNativeDrawerIfOpen(page);
    if (!await page.locator('.fi-theme-switcher').isVisible()) await page.getByRole('button', { name: 'منوی کاربر', exact: true }).click();
    await expect(page.locator('.fi-theme-switcher')).toBeVisible();
}

async function setNativeTheme(page, mode) {
    await openNativeThemeMenu(page);
    await nativeThemeButton(page, mode).click();
    await expect(page.locator('.fi-theme-switcher')).not.toBeVisible();
    if (await page.locator('#analytics-studio').count()) {
        await expect(page.locator('#analytics-studio')).toHaveAttribute('data-analytics-theme-mode', mode);
        if (mode !== 'system') await expect(page.locator('#analytics-studio')).toHaveAttribute('data-analytics-theme', mode);
    }
    expect(await page.evaluate(() => localStorage.getItem('theme'))).toBe(mode);
    expect(await page.evaluate(() => localStorage.getItem('analytics-theme'))).toBeNull();
}

async function openReportWorkspace(page, id) {
    await page.goto('/admin/analytics/reports/' + id);
    await expect.poll(() => page.evaluate(() => window.analyticsStudio.report?.id)).toBe(id);
    await expect(page.locator('.mb-preview-body')).toBeVisible();
}

async function openReport(page, id) {
    await openReportWorkspace(page, id);
    await expect(chartContainer(page).locator('canvas')).toBeVisible();
}

async function openDashboard(page, id) {
    await page.goto('/admin/analytics/dashboards/' + id);
    await expect.poll(() => page.evaluate(() => window.analyticsStudio.dashboard?.id)).toBe(id);
    await expect(page.locator('.mb-card').first()).toBeVisible(); await expect(page.locator('.mb-card .mb-loading')).toHaveCount(0); await expect(page.locator('.mb-card .mb-error')).toHaveCount(0);
}

async function chartState(page, key = null, category = 'bucket') {
    return page.evaluate(({ key, category }) => {
        const app = window.analyticsStudio;
        const chart = app.charts.find(chart => key ? chart.canvas.closest('[data-widget]')?.dataset.widget === key : chart.canvas.closest('.mb-preview-body'));
        if (!chart) return null;
        const result = key ? app.results.get(key) : app.previewResult;
        const normalize = color => { const context = document.createElement('canvas').getContext('2d'); context.fillStyle = color; return context.fillStyle.toLowerCase(); };
        return {
            type: chart.config.type,
            innerRatio: ['pie', 'doughnut'].includes(chart.config.type) ? chart.getDatasetMeta(0).data[0]?.innerRadius / chart.getDatasetMeta(0).data[0]?.outerRadius : null,
            labels: chart.data.labels,
            slices: ['pie', 'doughnut'].includes(chart.config.type) ? result.rows.map((row, index) => ({ raw: row[category], label: chart.data.labels[index], value: row.revenue, color: normalize(chart.getDatasetMeta(0).data[index]?.options.backgroundColor || chart.data.datasets[0].backgroundColor[index]) })) : [],
            series: chart.data.datasets.map((dataset, index) => ({ key: JSON.stringify(dataset._seriesValue), label: dataset.label, color: normalize((Array.isArray(dataset.borderColor) ? dataset.borderColor[0] : dataset.borderColor) || chart.getDatasetMeta(index).data[0]?.options.backgroundColor), values: dataset.data })),
        };
    }, { key, category });
}

async function assertHorizontalValueLabels(page) {
    await expect.poll(() => page.evaluate(() => {
        const chart = window.analyticsStudio.charts.find(chart => chart.canvas.closest('[data-widget]')?.dataset.widget === 'horizontal');
        return Math.abs(chart.width - chart.canvas.getBoundingClientRect().width);
    })).toBeLessThanOrEqual(1);
    const axis = await page.evaluate(() => {
        const chart = window.analyticsStudio.charts.find(chart => chart.canvas.closest('[data-widget]')?.dataset.widget === 'horizontal');
        const scale = chart.scales.x;
        const labels = scale.getLabelItems().map(item => {
            chart.ctx.save(); chart.ctx.font = item.font.string;
            const width = Math.max(...(Array.isArray(item.label) ? item.label : [item.label]).map(line => chart.ctx.measureText(String(line)).width)); chart.ctx.restore();
            const x = item.options.translation[0], alignment = item.options.textAlign;
            const left = alignment === 'left' || alignment === 'start' ? x : alignment === 'right' || alignment === 'end' ? x - width : x - width / 2;
            return { left, right: left + width, label: item.label };
        }).sort((left, right) => left.left - right.left);
        return { rotation: scale.labelRotation, labels };
    });
    expect(axis.rotation).toBe(0); expect(axis.labels.length).toBeGreaterThanOrEqual(2);
    for (let index = 1; index < axis.labels.length; index++) expect(axis.labels[index].left).toBeGreaterThanOrEqual(axis.labels[index - 1].right - 1);
}

async function slicePoint(page, value, key = null) {
    const canvas = chartContainer(page, key).locator('canvas'); await expect(canvas).toBeVisible(); await canvas.scrollIntoViewIfNeeded();
    const point = await page.evaluate(({ value, key }) => {
        const app = window.analyticsStudio; const result = key ? app.results.get(key) : app.previewResult;
        const index = result.rows.findIndex(row => JSON.stringify(row.bucket) === JSON.stringify(value));
        const chart = app.charts.find(chart => key ? chart.canvas.closest('[data-widget]')?.dataset.widget === key : chart.canvas.closest('.mb-preview-body'));
        const element = chart.getDatasetMeta(0).data[index]; const center = element.getCenterPoint(); const rect = chart.canvas.getBoundingClientRect();
        return { x: rect.left + center.x * rect.width / chart.width, y: rect.top + center.y * rect.height / chart.height, index, color: element.options.backgroundColor, metric: result.rows[index].revenue, label: chart.data.labels[index] };
    }, { value, key });
    await page.mouse.move(point.x, point.y); return point;
}

async function clickSlice(page, value, key = null) {
    const point = await slicePoint(page, value, key); await page.mouse.click(point.x, point.y);
    await expect(page.locator('[data-drill-menu]')).toBeVisible(); await expect(page.locator('[data-drill-menu] [data-drill-action="filter:eq"]')).toBeVisible();
    const presentation = await page.evaluate(() => { const context = window.analyticsStudio.drillMenuAnchorContext; return { color: context.color, series_key: context.series_key, series_label: context.series_label, percentage: context.percentage }; });
    return { ...point, presentation };
}

async function normalized(page, color) { return page.evaluate(color => { const context = document.createElement('canvas').getContext('2d'); context.fillStyle = color; return context.fillStyle.toLowerCase(); }, color); }
async function markerColor(page, locator) { return normalized(page, await locator.evaluate(node => getComputedStyle(node).backgroundColor)); }
const sliceColors = state => Object.fromEntries(state.slices.map(slice => [JSON.stringify(slice.raw), slice.color]));

async function saveReport(page) { await page.locator('[data-action=reportSaveDialog]').click(); await page.locator('.mb-dialog [data-action=saveReport]').click(); await expect(page.locator('.mb-dialog')).toHaveCount(0); }

test('donut drill keeps keyed category colors, typed NULL identity and source settings through sorting and reload', async ({ page }) => {
    const errors = []; page.on('pageerror', error => errors.push(error.message)); await login(page); const data = await fixtures(page);
    try {
        const query = { mode: 'aggregate', columns: undefined, expressions: [{ key: 'bucket', label: 'گروه', expression: bucketExpression }], dimensions: [{ field: 'bucket', grain: null }], metrics: [{ key: 'revenue', label: 'وزن سفارش‌ها', function: 'sum', field: 'id' }], sort: [{ key: 'bucket', direction: 'asc' }] };
        const line = await data.report('default palette transition', query, 'line', { x: 'bucket', y: 'revenue', legend: true });
        await openReport(page, line.id); expect((await chartState(page)).series[0].color).toBe('#314cff');
        await page.locator('[data-action=reportVisualization]').click(); await page.locator('.mb-dialog [data-action=visualizationTab][data-tab=display]').click();
        await expect(page.locator('.mb-dialog [data-base-chart-color]')).toHaveValue('#314cff');
        await page.locator('.mb-dialog [data-action=visualizationTab][data-tab=data]').click();
        expect(await page.evaluate(() => window.analyticsStudio.vizDraft.color)).toBe(line.visualization_settings.color);
        await page.locator('.mb-dialog [name=display]').selectOption('doughnut'); await page.locator('.mb-dialog [data-action=saveVisualization]').click(); await expect(page.locator('.mb-dialog')).toHaveCount(0);
        expect((await chartState(page)).slices.map(slice => slice.color)).toEqual(referencePieColors.slice(0, 5));
        expect(await page.evaluate(() => window.analyticsStudio.report.visualization_settings.color)).toBe(line.visualization_settings.color);
        expect(await page.evaluate(() => !!window.analyticsStudio.report.visualization_settings.color_custom)).toBe(false);
        await openReport(page, line.id); expect((await chartState(page)).series[0].color).toBe('#314cff');
        await page.locator('[data-action=displayPicker]').click(); await page.locator('.mb-dialog [data-display=doughnut]').click(); await expect(page.locator('.mb-dialog')).toHaveCount(0);
        expect((await chartState(page)).slices.map(slice => slice.color)).toEqual(referencePieColors.slice(0, 5));
        const report = await data.report('typed donut', query, 'doughnut', { x: 'bucket', y: 'revenue', legend: true });
        await openReport(page, report.id);
        expect((await chartState(page)).slices.map(slice => slice.color)).toEqual(referencePieColors.slice(0, 5));
        const premium = await clickSlice(page, 'Premium');
        expect(premium.presentation.series_key).toBeTruthy();
        await page.locator('[data-drill-menu] [data-action=closeDrillMenu]').click();
        await page.locator('[data-action=reportVisualization]').click(); await page.locator('.mb-dialog [data-action=visualizationTab][data-tab=display]').click();
        const colorControls = page.locator('.mb-dialog [data-series-color]');
        const colorIndex = await colorControls.evaluateAll((nodes, key) => nodes.findIndex(node => node.dataset.seriesColor === key), premium.presentation.series_key);
        expect(colorIndex).toBeGreaterThanOrEqual(0); await colorControls.nth(colorIndex).fill(customColor);
        await page.locator('.mb-dialog [name=center_mode]').selectOption('percentage'); await page.locator('.mb-dialog [name=ring_thickness]').fill('32'); await page.locator('.mb-dialog [name=percent_visibility]').selectOption('both');
        await page.locator('.mb-dialog [data-action=saveVisualization]').click(); await expect(page.locator('.mb-dialog')).toHaveCount(0); await saveReport(page);
        const saved = (await api(page, 'library')).reports.find(row => row.id === report.id);
        expect(saved.visualization_settings.series_colors[premium.presentation.series_key]).toBe(customColor);
        const original = await chartState(page); expect(original.type).toBe('doughnut'); expect(original.slices).toHaveLength(5);
        expect(saved.visualization_settings).toMatchObject({ center_mode: 'percentage', ring_thickness: 32, percent_visibility: 'both' }); expect(original.innerRatio).toBeCloseTo(.68, 2);
        await expect(page.locator('[data-donut-center]')).toContainText(/%|٪/);
        expect(original.slices.find(slice => slice.raw === null).label).toBe('خالی'); expect(original.slices.find(slice => slice.raw === '').label).toBe('متن تهی'); expect(original.slices.find(slice => slice.raw === 'null').label).toBe('null'); expect(original.slices.find(slice => slice.raw === '—').label).toBe('—');
        expect(original.slices.find(slice => slice.raw === 'Premium').color).toBe(customColor);
        const originalColors = sliceColors(original);
        await page.locator('[data-action=displayPicker]').click(); await page.locator('.mb-dialog [data-display=line]').click(); await expect(page.locator('.mb-dialog')).toHaveCount(0);
        expect(await page.evaluate(key => window.analyticsStudio.report.visualization_settings.series_colors[key], premium.presentation.series_key)).toBe(customColor);
        await page.locator('[data-action=reportVisualization]').click(); await page.locator('.mb-dialog [name=display]').selectOption('doughnut'); await page.locator('.mb-dialog [data-action=saveVisualization]').click(); await expect(page.locator('.mb-dialog')).toHaveCount(0);
        expect(sliceColors(await chartState(page))).toEqual(originalColors);
        for (const value of ['null', null, '—']) {
            const clicked = await clickSlice(page, value);
            expect(await normalized(page, clicked.presentation.color)).toBe(originalColors[JSON.stringify(value)]);
            expect(await markerColor(page, page.locator('[data-drill-menu] [data-drill-color]').first())).toBe(originalColors[JSON.stringify(value)]);
            await expect(page.locator('[data-drill-menu]')).toContainText(clicked.presentation.series_label);
            await page.locator('[data-drill-menu] [data-drill-action="filter:eq"]').click();
            await expect(page.locator('.mb-drill-view')).toBeVisible(); await expect(chartContainer(page).locator('canvas')).toBeVisible();
            await expect.poll(() => page.evaluate(() => window.analyticsStudio.previewResult?.rows.length)).toBe(1);
            const filtered = await chartState(page); expect(filtered.type).toBe('doughnut'); expect(filtered.slices[0]).toMatchObject({ raw: value, label: clicked.label, color: originalColors[JSON.stringify(value)] });
            const oracle = await data.native(`SELECT ${bucketSql} AS bucket, SUM(id) AS revenue FROM orders GROUP BY ${bucketSql} HAVING SUM(id)=${clicked.metric}`);
            expect(await page.evaluate(() => window.analyticsStudio.previewResult.rows)).toEqual(oracle.rows);
            expect(await markerColor(page, page.locator('[data-drill-breadcrumb] [data-drill-color]').first())).toBe(originalColors[JSON.stringify(value)]);
            await page.locator('[data-action=returnFromDrill]').click(); await expect.poll(async () => sliceColors(await chartState(page))).toEqual(originalColors);
            const unchanged = (await api(page, 'library')).reports.find(row => row.id === report.id); expect(unchanged.query_definition).toEqual(saved.query_definition); expect(unchanged.visualization_settings).toEqual(saved.visualization_settings);
        }
        await clickSlice(page, null); await page.locator('[data-drill-menu] [data-drill-action=underlying]').click();
        await expect(page.locator('.mb-drill-view .mb-table')).toBeVisible();
        await expect.poll(() => page.evaluate(() => window.analyticsStudio.previewResult?.rows.map(row => row.id).sort((left, right) => left - right))).toEqual((await data.native('SELECT id FROM orders WHERE id > 400 ORDER BY id ASC')).rows.map(row => row.id));
        expect(await markerColor(page, page.locator('[data-drill-breadcrumb] [data-drill-color]').first())).toBe(originalColors.null);
        await page.locator('[data-action=returnFromDrill]').click();
        await page.locator('[data-action=toggleNotebook]').click();
        await page.locator('[data-notebook-step=sort][data-stage="0"] [data-action=editNotebookClause][data-index="0"]').click();
        await page.locator('.mb-dialog [name=direction]').selectOption('desc'); await page.locator('.mb-dialog [data-action=saveSort]').click(); await expect(page.locator('.mb-dialog')).toHaveCount(0);
        await page.getByRole('button', { name: 'نمایش نتیجه', exact: true }).click();
        await expect.poll(async () => { const state = await chartState(page); return state && sliceColors(state); }).toEqual(originalColors);
        expect((await chartState(page)).slices.map(slice => slice.raw)).not.toEqual(original.slices.map(slice => slice.raw));
        await saveReport(page); await openReport(page, report.id); expect(sliceColors(await chartState(page))).toEqual(originalColors);
        await page.screenshot({ path: 'tests/Browser/artifacts/widget-donut-keyed-colors.png' });
        const widgetColor = '#22b483';
        const board = await data.dashboard('widget override', [widget('donut', report, 0, 0, 24, 9, { series_colors: { [premium.presentation.series_key]: widgetColor } })]);
        await openDashboard(page, board.id); expect((await chartState(page, 'donut')).slices.find(slice => slice.raw === 'Premium').color).toBe(widgetColor);
        await clickSlice(page, 'Premium', 'donut'); expect(await markerColor(page, page.locator('[data-drill-menu] [data-drill-color]').first())).toBe(widgetColor);
        await page.locator('[data-drill-menu] [data-drill-action="filter:eq"]').click(); await expect(page.locator('.mb-drill-view')).toBeVisible();
        await expect.poll(() => page.evaluate(() => window.analyticsStudio.previewResult?.rows.length)).toBe(1);
        expect((await chartState(page)).slices[0]).toMatchObject({ raw: 'Premium', color: widgetColor }); expect((await chartState(page)).type).toBe('doughnut');
        await page.screenshot({ path: 'tests/Browser/artifacts/widget-donut-origin-color-drill.png' });
        await page.locator('[data-action=returnFromDrill]').click(); expect((await chartState(page, 'donut')).slices.find(slice => slice.raw === 'Premium').color).toBe(widgetColor);
        expect((await api(page, 'library')).reports.find(row => row.id === report.id).visualization_settings.series_colors[premium.presentation.series_key]).toBe(customColor);
        expect((await api(page, `dashboards/${board.id}`)).widgets[0].settings.series_colors[premium.presentation.series_key]).toBe(widgetColor); expect(errors).toEqual([]);
    } finally { await data.cleanup(); }
});

test('donut tooltip, theme toggles and Filament preferences preserve a live clicked slice and open settings', async ({ page }) => {
    const errors = []; page.on('pageerror', error => errors.push(error.message)); await page.emulateMedia({ colorScheme: 'light' }); await login(page); const data = await fixtures(page);
    try {
        const report = await data.report('theme donut', { mode: 'aggregate', columns: undefined, expressions: [{ key: 'bucket', label: 'گروه', expression: bucketExpression }], dimensions: [{ field: 'bucket', grain: null }], metrics: [{ key: 'revenue', function: 'sum', field: 'id' }], sort: [{ key: 'bucket', direction: 'asc' }] }, 'doughnut', { x: 'bucket', y: 'revenue', legend: true });
        await openReport(page, report.id); const before = await chartState(page); const point = await slicePoint(page, 'Premium');
        expect(before.slices.map(slice => slice.color)).toEqual(referencePieColors.slice(0, 5));
        const tooltip = page.locator('[data-chart-tooltip]'); await expect(tooltip).toBeVisible(); await expect(tooltip.locator('[data-chart-tooltip-row]')).toHaveCount(5); await expect(tooltip).toContainText(/%|٪/);
        const tooltipColors = await tooltip.locator('[data-chart-color]').evaluateAll(nodes => nodes.map(node => getComputedStyle(node).backgroundColor));
        expect((await Promise.all(tooltipColors.map(color => normalized(page, color)))).sort()).toEqual(before.slices.map(slice => slice.color).sort());
        await page.mouse.click(point.x, point.y); await expect(page.locator('[data-drill-menu]')).toBeVisible();
        await page.evaluate(() => { window.__widgetStyleMenu = document.querySelector('[data-drill-menu]'); });
        const selectedColor = await markerColor(page, page.locator('[data-drill-menu] [data-drill-color]').first());
        await openNativeThemeMenu(page); await page.keyboard.press('Escape');
        await expect(page.locator('.fi-theme-switcher')).not.toBeVisible(); await expect(page.locator('[data-drill-menu]')).toBeVisible();
        await setNativeTheme(page, 'dark');
        expect(await page.evaluate(() => document.querySelector('[data-drill-menu]') === window.__widgetStyleMenu)).toBe(true);
        expect(await markerColor(page, page.locator('[data-drill-menu] [data-drill-color]').first())).toBe(selectedColor);
        expect(sliceColors(await chartState(page))).toEqual(sliceColors(before));
        expect(await page.evaluate(() => ({ filament: localStorage.getItem('theme'), analytics: localStorage.getItem('analytics-theme'), dark: document.documentElement.classList.contains('dark') }))).toEqual({ filament: 'dark', analytics: null, dark: true });
        await page.screenshot({ path: 'tests/Browser/artifacts/widget-donut-dark-drill-menu.png' }); await expect(page.locator('[data-drill-menu] [data-drill-action="filter:eq"]')).toBeVisible();
        await page.locator('[data-drill-menu] [data-action=closeDrillMenu]').click();
        await setNativeTheme(page, 'system'); await expect(page.locator('#analytics-studio')).toHaveAttribute('data-analytics-theme', 'light');
        await page.locator('[data-action=reportVisualization]').click();
        await page.emulateMedia({ colorScheme: 'dark' });
        await expect(page.locator('#analytics-studio')).toHaveAttribute('data-analytics-theme', 'dark'); await expect(page.locator('.mb-dialog [data-action=saveVisualization]')).toBeVisible();
        await assertSingleThemeSource(page);
        await page.locator('.mb-dialog').getByRole('button', { name: 'بستن', exact: true }).click();
        await setNativeTheme(page, 'dark');
        await page.reload(); await expect(page.locator('#analytics-studio')).toHaveAttribute('data-analytics-theme', 'dark');
        await openNativeThemeMenu(page); await expect(nativeThemeButton(page, 'dark')).toHaveClass(/fi-active/);
        await nativeThemeButton(page, 'dark').click();
        await page.emulateMedia({ colorScheme: 'light' });
        await setNativeTheme(page, 'system'); await expect(page.locator('#analytics-studio')).toHaveAttribute('data-analytics-theme', 'light');
        await page.emulateMedia({ colorScheme: 'dark' }); await expect(page.locator('#analytics-studio')).toHaveAttribute('data-analytics-theme', 'dark'); expect(errors).toEqual([]);
    } finally { await data.cleanup(); }
});

test('line, bar and area widgets keep series colors after filtering and remain readable in both themes and on mobile', async ({ page }) => {
    const errors = []; page.on('pageerror', error => errors.push(error.message)); await login(page); const data = await fixtures(page);
    try {
        const query = { mode: 'aggregate', columns: undefined, dimensions: [{ field: 'ordered_at', grain: 'month' }, { field: 'status', grain: null }], metrics: [{ key: 'revenue', function: 'sum', field: 'total' }], sort: [{ key: 'ordered_at', direction: 'asc' }, { key: 'status', direction: 'asc' }] };
        const reports = []; for (const display of ['line', 'bar', 'area']) reports.push(await data.report(display, query, display, { x: 'ordered_at', y: 'revenue', split: 'status', legend: true }));
        const count = await data.report('count', { mode: 'aggregate', columns: undefined, metrics: [{ key: 'count', function: 'count' }] }, 'number', { caption: 'سفارش‌ها' });
        const gauge = await data.report('gauge', { mode: 'aggregate', columns: undefined, metrics: [{ key: 'count', function: 'count' }] }, 'gauge', { target: 1000, caption: 'ظرفیت', color: '#5b4bff' });
        const progress = await data.report('progress', { mode: 'aggregate', columns: undefined, metrics: [{ key: 'count', function: 'count' }] }, 'progress', { target: 1000, caption: 'پیشرفت' });
        const donut = await data.report('donut', { ...query, dimensions: [{ field: 'status', grain: null }], sort: [{ key: 'status', direction: 'asc' }] }, 'doughnut', { x: 'status', y: 'revenue', legend: true, center_mode: 'percentage', percent_visibility: 'legend', caption: 'وضعیت سفارش‌ها' });
        const horizontal = await data.report('horizontal categories', { ...query, dimensions: [{ field: 'status', grain: null }], sort: [{ key: 'status', direction: 'asc' }] }, 'bar', { x: 'status', y: 'revenue', horizontal: true, color_by_category: true, legend: false });
        const ring = await data.report('ring gauge', { mode: 'aggregate', columns: undefined, metrics: [{ key: 'count', function: 'count' }] }, 'gauge', { target: 1000, gauge_style: 'ring', caption: 'ظرفیت حلقه‌ای' });
        const keys = ['line', 'bar', 'area'];
        const board = await data.dashboard('Figma widgets', [widget('line', reports[0], 0, 0), widget('bar', reports[1], 12, 0), widget('area', reports[2], 0, 9), widget('donut', donut, 12, 9), widget('gauge', gauge, 0, 18), widget('count', count, 12, 18, 12, 5), widget('progress', progress, 12, 23, 12, 5), widget('horizontal', horizontal, 0, 28), widget('ring', ring, 12, 28)], [{ key: 'status', label: 'وضعیت', type: 'text', required: false, default_value: null, settings: {}, bindings: keys.map(widget_key => ({ widget_key, target: 'status', operator: 'eq' })) }]);
        await openDashboard(page, board.id);
        const categoriesOracle = await data.native('SELECT status, SUM(total) AS revenue FROM orders GROUP BY status ORDER BY status ASC');
        expect(await page.evaluate(() => window.analyticsStudio.results.get('horizontal').rows)).toEqual(categoriesOracle.rows);
        const horizontalColors = await page.evaluate(() => { const chart = window.analyticsStudio.charts.find(chart => chart.canvas.closest('[data-widget]')?.dataset.widget === 'horizontal'); return chart.getDatasetMeta(0).data.map(bar => bar.options.backgroundColor); });
        expect(new Set(horizontalColors).size).toBe(3);
        await assertHorizontalValueLabels(page);
        const ringFace = chartContainer(page, 'ring').locator('svg.mb-gauge-ring'); await expect(ringFace).toBeVisible(); await expect(ringFace.locator('linearGradient')).toHaveCount(1);
        await expect(ringFace.locator('path[stroke^="url("]')).toHaveAttribute('stroke-dasharray', '60 100'); await expect(chartContainer(page, 'ring').locator('.mb-stat-caption')).toContainText('ظرفیت حلقه‌ای');
        const originals = {}; for (const key of keys) originals[key] = await chartState(page, key, 'status');
        await page.screenshot({ path: 'tests/Browser/artifacts/widget-dashboard-light.png', fullPage: true });
        await page.locator('[data-action=editFilterValue][data-key=status]').click(); await page.locator('.mb-dialog .mb-value-option').filter({ hasText: /^لغوشده$/ }).locator('input[name=values]').check(); await page.locator('.mb-dialog [data-action=saveFilterValue]').click();
        await expect(page.locator('.mb-card .mb-loading')).toHaveCount(0);
        const oracle = await data.native("SELECT strftime('%Y-%m-01', ordered_at) AS ordered_at, status, SUM(total) AS revenue FROM orders WHERE status='لغوشده' GROUP BY strftime('%Y-%m-01', ordered_at), status ORDER BY ordered_at ASC, status ASC");
        for (const key of keys) {
            await expect.poll(() => page.evaluate(key => window.analyticsStudio.results.get(key)?.rows, key)).toEqual(oracle.rows);
            const filtered = await chartState(page, key, 'status'); expect(filtered.series).toHaveLength(1); expect(filtered.series[0].color).toBe(originals[key].series.find(series => series.key === JSON.stringify('لغوشده')).color);
        }
        await setNativeTheme(page, 'dark');
        for (const key of keys) expect((await chartState(page, key, 'status')).series[0].color).toBe(originals[key].series.find(series => series.key === JSON.stringify('لغوشده')).color);
        expect(await page.evaluate(() => { const chart = window.analyticsStudio.charts.find(chart => chart.canvas.closest('[data-widget]')?.dataset.widget === 'horizontal'); return chart.getDatasetMeta(0).data.map(bar => bar.options.backgroundColor); })).toEqual(horizontalColors);
        const contrasts = await page.evaluate(() => {
            const pixel = color => { const context = document.createElement('canvas').getContext('2d'); context.fillStyle = color; context.fillRect(0, 0, 1, 1); return [...context.getImageData(0, 0, 1, 1).data]; };
            const luminance = color => pixel(color).slice(0, 3).map(channel => channel / 255).map(channel => channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4).reduce((total, channel, index) => total + channel * [.2126, .7152, .0722][index], 0);
            const ratio = (a, b) => { const first = luminance(a), second = luminance(b); return (Math.max(first, second) + .05) / (Math.min(first, second) + .05); };
            const surface = node => { for (let parent = node; parent; parent = parent.parentElement) { const color = getComputedStyle(parent).backgroundColor; if (pixel(color)[3] > 240) return color; } return 'white'; };
            return window.analyticsStudio.charts.filter(chart => chart.canvas.closest('[data-widget]')).map(chart => ({ tick: chart.options.scales?.x?.ticks?.color ? ratio(chart.options.scales.x.ticks.color, surface(chart.canvas)) : null, legend: ratio(chart.options.plugins.legend.labels.color, surface(chart.canvas)) }));
        });
        expect(contrasts.every(contrast => (contrast.tick === null || contrast.tick >= 3) && contrast.legend >= 3)).toBe(true);
        await page.screenshot({ path: 'tests/Browser/artifacts/widget-dashboard-dark.png', fullPage: true });
        await page.setViewportSize({ width: 390, height: 844 }); await expect(page.locator('.mb-card .mb-loading')).toHaveCount(0);
        await assertSingleThemeSource(page);
        await assertHorizontalValueLabels(page);
        await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2)).toBe(true);
        for (const key of keys) { await expect(chartContainer(page, key).locator('canvas')).toBeVisible(); expect((await chartState(page, key, 'status')).series[0].color).toBe(originals[key].series.find(series => series.key === JSON.stringify('لغوشده')).color); }
        await page.screenshot({ path: 'tests/Browser/artifacts/widget-dashboard-mobile-dark.png', fullPage: true });
        await setNativeTheme(page, 'light'); await page.screenshot({ path: 'tests/Browser/artifacts/widget-dashboard-mobile-light.png', fullPage: true }); expect(errors).toEqual([]);
    } finally { await data.cleanup(); }
});

test('native Filament appearance controls stay unique across libraries, databases, report editors and dashboard forms', async ({ page }) => {
    const errors = []; page.on('pageerror', error => errors.push(error.message)); await login(page); const data = await fixtures(page);
    const oneAction = async (scope, action) => expect(scope.locator(`[data-action="${action}"]:visible`)).toHaveCount(1);
    const reportNavigation = async () => {
        await expect(page.locator('[data-action=cancelReport]:visible')).toHaveCount(1);
        await expect(page.locator('.mb-workbench-tools a')).toHaveCount(0);
        await expect(page.locator('aside.fi-sidebar')).toBeVisible();
        await expect(page.locator('aside.fi-sidebar a[href$="/admin/analytics/reports"]')).toHaveCount(1);
    };
    const closeDialog = async () => { await page.locator('.mb-dialog').getByRole('button', { name: 'بستن', exact: true }).click(); await expect(page.locator('.mb-dialog')).toHaveCount(0); };
    const surface = async mode => {
        await assertSingleThemeSource(page);
        if (await page.locator('#analytics-studio').count()) await expect(page.locator('#analytics-studio')).toHaveAttribute('data-analytics-theme', mode);
        expect(await page.evaluate(() => document.documentElement.classList.contains('dark'))).toBe(mode === 'dark');
        await expect(page.locator('#analytics-studio .mb-error:visible')).toHaveCount(0);
    };
    try {
        const query = { mode: 'aggregate', columns: undefined, dimensions: [{ field: 'status', grain: null }], metrics: [{ key: 'revenue', function: 'sum', field: 'total' }], sort: [{ key: 'status', direction: 'asc' }] };
        const report = await data.report('UI audit summary', query);
        const native = await data.report('UI audit SQL', { mode: 'native', columns: undefined, sql: 'SELECT status, SUM(total) AS revenue FROM orders GROUP BY status ORDER BY status ASC', parameters: [] });
        const board = await data.dashboard('UI audit dashboard', [widget('summary', report, 0, 0, 24, 9)], [{ key: 'status', label: 'وضعیت', type: 'text', required: false, default_value: null, settings: {}, bindings: [{ widget_key: 'summary', target: 'status', operator: 'eq' }] }]);
        const oracle = (await data.native('SELECT status, SUM(total) AS revenue FROM orders GROUP BY status ORDER BY status ASC')).rows;
        for (const mode of ['light', 'dark']) {
            await setNativeTheme(page, mode);
            for (const [section, label, record] of [['dashboards', 'داشبوردها', board], ['reports', 'گزارش‌ها', report], ['databases', 'پایگاه‌های داده', data.connection]]) {
                await page.locator('aside.fi-sidebar').getByRole('link', { name: label, exact: true }).click();
                await expect(page).toHaveURL(new RegExp('/admin/analytics/' + section + '$'));
                await expect(page.locator('.fi-ta-table')).toBeVisible();
                await expect(page.locator('#analytics-studio')).toHaveCount(0);
                await expect(page.locator('.mb-sidebar')).toHaveCount(0);
                await expect(page.locator('.fi-ta-table')).toContainText(record.name);
                await surface(mode);
                if (section === 'dashboards') {
                    const create = page.getByRole('button', { name: 'داشبورد جدید', exact: true });
                    await expect(create).toHaveCount(1); await create.click();
                    const modal = page.locator('.fi-modal-window:visible');
                    await expect(modal.locator('.fi-modal-heading')).toHaveText('ایجاد داشبورد');
                    await expect(modal.locator('.fi-input-wrp [id$=".name"]')).toBeVisible();
                    await expect(modal.getByRole('button', { name: 'ایجاد', exact: true })).toHaveCount(1);
                    await expect(modal.getByRole('button', { name: 'لغو', exact: true })).toHaveCount(1);
                    await modal.locator('.fi-modal-close-btn').click(); await expect(modal).toHaveCount(0);
                } else if (section === 'reports') {
                    for (const createLabel of ['گزارش جدید', 'پرس‌وجوی SQL']) {
                        const create = page.getByRole('link', { name: createLabel, exact: true });
                        await expect(create).toHaveCount(1); await create.click();
                        await expect(page).toHaveURL(/\/analytics\/reports\/new(?:\?.*)?$/);
                        await expect(page.locator('.fi-modal-window.mb-dialog .mb-data-picker')).toBeVisible();
                        await expect(page.locator('.mb-dialog .fi-modal-close-btn')).toHaveCount(1);
                        await surface(mode); await closeDialog();
                        await page.locator('.mb-workbench-tools a').click();
                        await expect(page).toHaveURL(/\/analytics\/reports$/);
                    }
                } else {
                    const create = page.getByRole('button', { name: 'پایگاه داده جدید', exact: true });
                    await expect(create).toHaveCount(1); await create.click();
                    const modal = page.locator('.fi-modal-window:visible');
                    await expect(modal.locator('.fi-modal-heading')).toHaveText('افزودن پایگاه داده');
                    await expect(modal.getByRole('button', { name: 'ذخیره', exact: true })).toHaveCount(1);
                    for (const driver of ['sqlite', 'pgsql', 'clickhouse']) {
                        await modal.locator('[id$=".driver"]').selectOption(driver); await surface(mode);
                        if (driver === 'sqlite') await expect(modal.locator('[id$=".configuration.path"]')).toBeVisible();
                        else {
                            await expect(modal.locator('[id$=".configuration.port"]')).toHaveValue(driver === 'pgsql' ? '5432' : '8123');
                            await expect(modal.locator('[id$=".configuration.password"]')).toHaveAttribute('type', 'password');
                            await expect(modal.locator(driver === 'pgsql' ? '[id$=".configuration.sslmode"]' : '[id$=".configuration.ssl"]')).toBeVisible();
                        }
                        await expect(modal.getByRole('button', { name: 'ذخیره', exact: true })).toHaveCount(1);
                    }
                    await page.screenshot({ path: `tests/Browser/artifacts/ui-audit-connection-${mode}.png`, fullPage: true });
                    await modal.locator('.fi-modal-close-btn').click(); await expect(modal).toHaveCount(0);
                }
            }
            const connectionRow = page.locator('.fi-ta-table tbody tr').filter({ hasText: data.connection.name });
            await expect(connectionRow).toHaveCount(1);
            await expect(connectionRow.getByRole('link', { name: 'مشاهده جدول‌ها', exact: true })).toHaveCount(1);
            await connectionRow.getByRole('link', { name: 'مشاهده جدول‌ها', exact: true }).click();
            await expect(page).toHaveURL(new RegExp('/admin/analytics/databases/' + data.connection.id + '$'));
            await expect(page.locator('.mb-browser-preview .mb-table')).toBeVisible();
            await page.locator('[data-action=selectTable][data-key=orders]').click(); await expect(page.locator('.mb-schema-details')).toContainText('customers.id'); await surface(mode);
            await oneAction(page.locator('.mb-toolbar'), 'reportFromTable');
            await page.locator('.mb-schema-heading [data-action=editDataMetadata]').click(); await expect(page.locator('.mb-dialog')).toBeVisible(); await surface(mode); await closeDialog();
            await openReportWorkspace(page, report.id); await expect(page.locator('.mb-preview-body .mb-table')).toBeVisible(); await surface(mode);
            await reportNavigation();
            await oneAction(page.locator('.mb-question-header'), 'reportSaveDialog'); await oneAction(page.locator('.mb-question-header'), 'toggleNotebook');
            await expect(page.locator('#analytics-studio [data-action=runReport]:visible')).toHaveCount(1);
            await page.locator('.mb-question-header [data-action=toggleNotebook]').click(); await expect(page.locator('.mb-notebook-open')).toBeVisible();
            await surface(mode); await expect(page.locator('#analytics-studio [data-action=runReport]:visible')).toHaveCount(1);
            await expect(page.locator('[data-notebook-step=data][data-stage="0"] [data-action=addJoin]')).toHaveCount(0);
            await expect(page.locator('[data-notebook-step=data][data-stage="0"] [data-action=openNotebookStep][data-kind=join]')).toHaveCount(0);
            await expect(page.locator('[data-action=openNotebookStep][data-kind=join][data-stage="0"]')).toHaveCount(1);
            await page.locator('[data-action=openNotebookStep][data-kind=join][data-stage="0"]').click();
            for (const type of ['left', 'inner', 'right', 'full']) await expect(page.locator(`.mb-dialog [data-action=chooseJoinType][data-type="${type}"]`)).toBeVisible();
            for (const name of ['source', 'left_0', 'operator_0', 'right_0']) await expect(page.locator(`.mb-dialog select[name="${name}"]`)).toBeVisible();
            await oneAction(page.locator('.mb-dialog'), 'saveJoin'); await surface(mode); await closeDialog();
            await page.locator('[data-notebook-step=filter][data-stage="0"] [data-action=addReportFilter]').click();
            await expect(page.locator('.mb-dialog [data-action=saveReportFilter]')).toBeVisible(); await oneAction(page.locator('.mb-dialog'), 'saveReportFilter'); await surface(mode); await closeDialog();
            await page.locator('[data-notebook-step=sort][data-stage="0"] [data-action=editNotebookClause][data-index="0"]').click();
            await expect(page.locator('.mb-dialog select[name=key]:visible')).toHaveCount(0); await expect(page.locator('.mb-dialog input[name=key]')).toHaveAttribute('type', 'hidden');
            await expect(page.locator('.mb-dialog .mb-notebook-field-options')).toHaveCount(1);
            const statusSort = page.locator('.mb-dialog [data-action=chooseSortColumn][data-key=status]');
            await page.locator('.mb-dialog [data-notebook-sort-search]').fill((await statusSort.innerText()).trim()); await expect(statusSort).toBeVisible();
            await page.locator('.mb-dialog [name=direction]').selectOption('asc'); await statusSort.click(); await expect(page.locator('.mb-dialog')).toHaveCount(0);
            await expect.poll(() => page.evaluate(() => window.analyticsStudio.report.query_definition.sort)).toEqual(report.query_definition.sort); await surface(mode);
            await page.screenshot({ path: `tests/Browser/artifacts/ui-audit-notebook-${mode}.png`, fullPage: true });
            await page.locator('.mb-question-header [data-action=toggleNotebook]').click(); await page.locator('.mb-question-header [data-action=showSql]').click();
            await expect(page.locator('.mb-dialog pre.mb-sql')).toContainText('SUM'); await surface(mode); await closeDialog();
            await page.locator('[data-action=reportVisualization]').click(); await oneAction(page.locator('.mb-dialog'), 'saveVisualization'); await surface(mode); await closeDialog();

            await openReportWorkspace(page, native.id); await expect(page.locator('.mb-native-editor [data-sql]')).toHaveValue(native.query_definition.sql);
            await reportNavigation();
            await expect.poll(() => page.evaluate(() => window.analyticsStudio.previewResult?.rows)).toEqual(oracle);
            await surface(mode); await expect(page.locator('#analytics-studio [data-action=runReport]:visible')).toHaveCount(1);
            await expect(page.locator('.mb-question-header [data-action=showSql]')).toHaveCount(0);
            await page.screenshot({ path: `tests/Browser/artifacts/ui-audit-sql-${mode}.png`, fullPage: true });

            await openDashboard(page, board.id); await surface(mode); await oneAction(page.locator('.mb-toolbar'), 'editDashboard');
            await page.locator('[data-action=editFilterValue][data-key=status]').click(); await expect(page.locator('.mb-dialog .mb-value-option')).toHaveCount(3); await oneAction(page.locator('.mb-dialog'), 'saveFilterValue'); await surface(mode);
            await page.screenshot({ path: `tests/Browser/artifacts/ui-audit-filter-${mode}.png` }); await closeDialog();
            await page.locator('[data-widget=summary] [data-table-cell][data-column=status]').first().click(); await expect(page.locator('[data-drill-menu]')).toBeVisible(); await surface(mode);
            await page.locator('[data-drill-menu] [data-action=closeDrillMenu]').click(); await page.locator('.mb-toolbar [data-action=editDashboard]').click();
            for (const action of ['addReportCard', 'addDashboardFilter', 'dashboardSettings', 'cancelDashboard', 'saveDashboard']) await oneAction(page.locator('.mb-editbar'), action);
            await surface(mode); await page.screenshot({ path: `tests/Browser/artifacts/ui-audit-dashboard-editor-${mode}.png`, fullPage: true });
            await page.locator('[data-widget=summary] [data-action=cardSettings]').click(); await oneAction(page.locator('.mb-dialog'), 'saveCardSettings'); await oneAction(page.locator('.mb-dialog'), 'editCardClickBehavior'); await surface(mode);
            await page.locator('.mb-dialog [data-action=editCardClickBehavior]').click(); await expect(page.locator('.mb-dialog [name=click_scope]')).toBeVisible();
            for (const type of ['menu', 'filter', 'dashboard', 'report', 'url', 'none']) await expect(page.locator(`.mb-dialog [data-action=chooseClickBehavior][data-type="${type}"]`)).toHaveCount(1);
            await oneAction(page.locator('.mb-dialog'), 'saveCardClickBehavior'); await surface(mode); await page.screenshot({ path: `tests/Browser/artifacts/ui-audit-click-settings-${mode}.png` }); await closeDialog();
            await page.locator('[data-action=editDashboardFilter][data-key=status]').click(); await expect(page.locator('.mb-dialog [name=label]')).toHaveValue('وضعیت'); await oneAction(page.locator('.mb-dialog'), 'mapDashboardFilter'); await surface(mode); await closeDialog();
            await page.locator('.mb-editbar [data-action=cancelDashboard]').click(); await expect(page.locator('.mb-editbar')).toHaveCount(0);
        }
        expect((await api(page, 'library')).reports.find(row => row.id === report.id).query_definition).toEqual(report.query_definition);
        expect((await api(page, `dashboards/${board.id}`)).widgets).toEqual(board.widgets);
        expect(errors).toEqual([]);
    } finally { await data.cleanup(); }
});
