import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { build } from 'esbuild';

let component, styles, buttons;
test.beforeAll(async () => {
    const bundle = await build({
        stdin: { contents: 'export { dashboardMethods } from "./resources/js/analytics/dashboards.js"; export { filterEnhancements } from "./resources/js/analytics/filter-enhancements.js"; export { GridStack } from "gridstack";', resolveDir: process.cwd() },
        bundle: true, write: false, format: 'iife', globalName: 'DashboardControls',
    });
    component = bundle.outputFiles[0].text;
    const localPhp = path.resolve('../.tools/php/php.exe');
    buttons = execFileSync(process.env.ANALYTICS_PHP || (fs.existsSync(localPhp) ? localPhp : 'php'),
        ['tests/Browser/helpers/export-dashboard-buttons.php'], { encoding: 'utf8', timeout: 60000 });
    const directory = path.resolve('public/build');
    const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'manifest.json'), 'utf8'));
    styles = ['../css/filament/support/support.css', '../css/filament/filament/app.css',
        manifest['resources/css/panel-theme.css'].file, ...manifest['resources/js/analytics.js'].css]
        .map(file => fs.readFileSync(path.join(directory, file), 'utf8')).join('\n');
});

test('dashboard View keeps its title and card names, with reset on the left and filters on the right', async ({ page }, testInfo) => {
    await page.setContent('<html lang="fa" dir="rtl"><body><main class="fi-page"><div id="analytics-studio" data-read-only="true"></div></main></body></html>');
    await page.addStyleTag({ content: styles });
    await page.addStyleTag({ content: 'body{margin:0;padding:24px;background:var(--soar-page-bg)}@media(max-width:600px){body{padding:12px}}' });
    await page.locator('body').evaluate((body, markup) => body.insertAdjacentHTML('beforeend', markup), buttons);
    await page.addScriptTag({ content: component });
    await page.evaluate(() => {
        const { dashboardMethods, filterEnhancements, GridStack } = window.DashboardControls;
        const root = document.querySelector('#analytics-studio');
        const context = {
            ...dashboardMethods, ...filterEnhancements,
            dashboardReadOnly: true, editing: false, activeTab: 'overview', library: { reports: [] },
            dashboard: {
                id: 125, name: 'داشبورد جامع فروش', description: 'نمای کلی فروش و گزارش‌ها',
                can_edit: true, is_owner: true, settings: { auto_apply: true, width: 'wide' },
                tabs: [{ key: 'overview', name: 'نمای کلی فروش' }],
                reports: [{ id: 1, name: 'کل فروش', query_definition: { mode: 'rows' } }, { id: 2, name: 'جزئیات سفارش‌ها', query_definition: { mode: 'rows' } }],
                filters: [
                    { key: 'period', label: 'بازه زمانی', type: 'date', default_value: null, settings: {}, bindings: [] },
                    { key: 'city', label: 'شهر', type: 'text', default_value: null, settings: {}, bindings: [] },
                    { key: 'category', label: 'دسته‌بندی', type: 'text', default_value: null, settings: {}, bindings: [] },
                ],
                widgets: [
                    { key: 'sales', type: 'report', report_id: 1, tab_key: 'overview', x: 0, y: 0, w: 12, h: 4, settings: {} },
                    { key: 'orders', type: 'report', report_id: 2, tab_key: 'overview', x: 12, y: 0, w: 12, h: 4, settings: { title: 'عنوان اختصاصی سفارش‌ها' } },
                ],
            },
            filterValues: { period: null, city: 'تهران', category: null },
            appliedValues: { period: null, city: 'تهران', category: null },
            render() {
                this.grid?.destroy(false);
                root.dataset.readOnly = String(this.dashboardReadOnly);
                root.innerHTML = this.dashboardHtml();
                this.grid = GridStack.init({ column: 24, cellHeight: 36, margin: 7, rtl: true, staticGrid: true,
                    columnOpts: { columnMax: 24, breakpointForWindow: true, breakpoints: [{ w: 767, c: 1 }] } }, root.querySelector('.grid-stack'));
            },
        };
        window.dashboardControls = context;
        root.addEventListener('click', event => {
            const control = event.target.closest('[data-action]');
            if (control && ['resetFilters', 'applyFilters'].includes(control.dataset.action)) context[control.dataset.action](control);
        });
        context.render();
    });

    await expect(page.getByRole('heading', { name: 'داشبورد جامع فروش', exact: true })).toBeVisible();
    await expect(page.locator('.mb-card-title')).toHaveText(['کل فروش', 'عنوان اختصاصی سفارش‌ها']);
    await expect(page.locator('[data-action=editDashboard], [data-action=shareDashboard], [data-action=copyDashboard]')).toHaveCount(0);
    await expect(page.locator('[data-action=resetFilters]')).toHaveClass(/fi-btn/);
    await page.getByRole('button', { name: 'بازنشانی', exact: true }).click();
    expect(await page.evaluate(() => window.dashboardControls.appliedValues)).toEqual({ period: null, city: null, category: null });

    for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: 900 });
        for (const theme of ['light', 'dark']) {
            await page.locator('html').evaluate((html, theme) => html.classList.toggle('dark', theme === 'dark'), theme);
            const layout = await page.locator('.mb-filterbar').evaluate(bar => {
                const bounds = bar.getBoundingClientRect(), style = getComputedStyle(bar);
                return {
                    resetLeft: bar.querySelector('[data-action=resetFilters]').getBoundingClientRect().left,
                    firstFilterRight: bar.querySelector('.mb-filter').getBoundingClientRect().right,
                    leftEdge: bounds.left + parseFloat(style.paddingLeft),
                    rightEdge: bounds.right - parseFloat(style.paddingRight),
                    overflows: document.documentElement.scrollWidth > innerWidth,
                };
            });
            expect(layout.resetLeft).toBeCloseTo(layout.leftEdge, 0);
            expect(layout.firstFilterRight).toBeCloseTo(layout.rightEdge, 0);
            expect(layout.overflows).toBe(false);
            await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
            await page.screenshot({ path: testInfo.outputPath('dashboard-view-' + theme + '-' + width + '.png'), fullPage: true });
        }
    }

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.evaluate(() => { window.dashboardControls.dashboard.settings.auto_apply = false; window.dashboardControls.render(); });
    const apply = page.locator('[data-action=applyFilters]');
    await expect(apply).toBeVisible();
    expect((await apply.boundingBox()).x).toBeGreaterThan((await page.locator('[data-action=resetFilters]').boundingBox()).x);

    await page.evaluate(() => { window.dashboardControls.dashboardReadOnly = false; window.dashboardControls.render(); });
    await expect(page.locator('[data-action=editDashboard]')).toBeVisible();
    await expect(page.locator('[data-action=shareDashboard]')).toBeVisible();
    await page.evaluate(() => { window.dashboardControls.dashboardReadOnly = true; window.dashboardControls.dashboard.filters = []; window.dashboardControls.render(); });
    await expect(page.getByRole('heading', { name: 'داشبورد جامع فروش', exact: true })).toBeVisible();
    await expect(page.locator('.mb-filterbar')).toHaveCount(0);
});
