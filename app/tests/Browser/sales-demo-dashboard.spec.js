import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { build } from 'esbuild';

let seeded, component, styles;
test.beforeAll(async () => {
    const localPhp = path.resolve('../.tools/php/php.exe');
    const php = process.env.ANALYTICS_PHP || (fs.existsSync(localPhp) ? localPhp : 'php');
    seeded = JSON.parse(execFileSync(php, ['tests/Browser/helpers/export-sales-demo.php'], {
        encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, timeout: 120000,
        env: { ...process.env, PGCONNECT_TIMEOUT: '5', PGGSSENCMODE: 'disable' },
    }));
    const bundle = await build({
        stdin: { contents: 'export { visualize } from "./resources/js/analytics/ui.js"; export { dashboardMethods } from "./resources/js/analytics/dashboards.js"; export { GridStack } from "gridstack";', resolveDir: process.cwd() },
        bundle: true, write: false, format: 'iife', globalName: 'SalesDemoFixture',
    });
    component = bundle.outputFiles[0].text;
    const directory = path.resolve('public/build');
    const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'manifest.json'), 'utf8'));
    styles = ['../css/filament/support/support.css', '../css/filament/forms/forms.css', '../css/filament/filament/app.css', manifest['resources/css/panel-theme.css'].file, ...manifest['resources/js/analytics.js'].css]
        .map(file => fs.readFileSync(path.join(directory, file), 'utf8')).join('\n');
});

test('all seeded report models render with real PostgreSQL results in light, dark and mobile layouts', async ({ page }) => {
    test.setTimeout(180000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setViewportSize({ width: 1600, height: 1100 });
    await page.setContent('<html lang="fa" dir="rtl"><body><main class="fi-page"><div id="analytics-studio" data-read-only="true"><nav class="mb-tabs"></nav><div class="mb-canvas"><div class="grid-stack"></div></div></div></main></body></html>');
    await page.addStyleTag({ content: styles });
    await page.addStyleTag({ content: 'body{margin:0;padding:24px;background:var(--soar-page-bg)}#analytics-studio{min-width:0}@media(max-width:767px){body{padding:12px}}' });
    await page.locator('body').evaluate((body, markup) => body.insertAdjacentHTML('beforeend', markup), seeded.native_table_templates);
    await page.addScriptTag({ content: component });
    await page.evaluate(seeded => {
        const fixture = window.SalesDemoFixture;
        const root = document.querySelector('#analytics-studio');
        window.seededDemo = seeded;
        window.demoCharts = [];
        window.renderSeededTab = key => {
            window.demoCharts.forEach(chart => chart.destroy());
            window.demoCharts = [];
            window.demoGrid?.destroy(false);
            const context = { editing: false, dashboardReport: id => seeded.reports.find(report => report.id === id) };
            const widgets = seeded.dashboard.widgets.filter(widget => widget.tab_key === key);
            document.querySelector('.mb-tabs').innerHTML = seeded.dashboard.tabs.map(tab => '<div class="mb-tab ' + (tab.key === key ? 'active' : '') + '"><button data-tab="' + tab.key + '">' + tab.name + '</button></div>').join('');
            document.querySelectorAll('[data-tab]').forEach(button => button.onclick = () => window.renderSeededTab(button.dataset.tab));
            const grid = document.querySelector('.grid-stack');
            grid.innerHTML = widgets.map(widget => fixture.dashboardMethods.cardHtml.call(context, widget)).join('');
            window.demoGrid = fixture.GridStack.init({
                column: 24, cellHeight: 36, margin: 7, mode: 'float', rtl: true, staticGrid: true,
                columnOpts: { columnMax: 24, breakpointForWindow: true, breakpoints: [{ w: 767, c: 1 }] },
            }, grid);
            for (const widget of widgets) {
                const report = context.dashboardReport(widget.report_id);
                const settings = { ...report.visualization_settings, ...widget.settings,
                    _dimension_keys: report.query_definition.dimensions.map(dimension => dimension.field) };
                const body = root.querySelector('[data-widget="' + widget.key + '"] .mb-card-body');
                const chart = fixture.visualize(body, seeded.results[widget.key], report.display, settings);
                if (chart) window.demoCharts.push(chart);
            }
        };
        window.renderSeededTab('overview');
    }, seeded);
    const displays = new Set();
    const checkTab = async (key, count) => {
        await page.locator('[data-tab="' + key + '"]').click();
        await expect(page.locator('.mb-card')).toHaveCount(count);
        await expect(page.locator('.mb-card .mb-error, .mb-card .mb-empty, .mb-card .mb-loading')).toHaveCount(0);
        const actual = await page.locator('.mb-card-body').evaluateAll(bodies => bodies.map(body => body.dataset.visualization));
        actual.forEach(display => displays.add(display));
    };
    expect(seeded.dashboard.widgets).toHaveLength(28);
    expect(seeded.dashboard.tabs.map(tab => tab.key)).toEqual(['overview', 'soar', 'report-types']);
    for (const result of Object.values(seeded.results)) expect(result.rows.length).toBeGreaterThan(0);
    await checkTab('overview', 9);
    await expect(page.locator('[data-widget=sales-details] .fi-ta-table')).toBeVisible();
    await expect(page.locator('[data-widget=sales-details] .fi-ta-table tbody tr')).toHaveCount(25);
    await checkTab('soar', 14);
    await expect(page.locator('.mb-gauge')).toHaveCount(5);
    await expect(page.locator('.mb-card canvas')).toHaveCount(9);
    for (const face of await page.locator('.mb-gauge-ring-face').all()) expect((await face.boundingBox()).width).toBeGreaterThanOrEqual(110);
    await expect(page.locator('.mb-donut-center strong')).toHaveText(['۷۳%', '۷۳%']);
    expect(Number(seeded.results['soar-memory'].rows[0].value)).toBe(58);
    expect(Number(seeded.results['soar-load'].rows[0].value)).toBe(1.45);
    expect(seeded.results['soar-alert-trend'].rows).toHaveLength(24);
    expect(seeded.results['soar-top-playbooks'].rows).toHaveLength(10);
    const variants = await page.evaluate(() => {
        const chart = key => window.demoCharts.find(chart => chart.canvas.closest('[data-widget]').dataset.widget === key);
        return { stacked: chart('soar-executions').options.scales.x.stacked,
            datasets: chart('soar-executions').data.datasets.length, horizontal: chart('soar-top-playbooks').options.indexAxis };
    });
    expect(variants).toEqual({ stacked: true, datasets: 2, horizontal: 'y' });
    for (const mode of ['light', 'dark']) {
        await page.evaluate(mode => {
            document.documentElement.classList.toggle('dark', mode === 'dark');
            document.querySelector('#analytics-studio').dataset.analyticsTheme = mode;
            window.demoCharts.forEach(chart => chart.$analyticsTheme?.());
        }, mode);
        await page.screenshot({ path: '../.tools/soar-seeded-' + mode + '.png', fullPage: true });
    }
    await checkTab('report-types', 5);
    await expect(page.locator('.mb-pivot tbody tr')).toHaveCount(7);
    await expect(page.locator('.mb-funnel [data-funnel-row]')).toHaveCount(4);
    const funnelFits = await page.locator('[data-widget=types-funnel] .mb-card-body').evaluate(body => body.scrollHeight <= body.clientHeight + 1);
    expect(funnelFits).toBe(true);
    await expect(page.locator('.mb-progress-stat')).toBeVisible();
    await expect(page.locator('[data-widget=types-scatter] canvas')).toBeVisible();
    // A user may have changed the saved pie report's display. Exercise that
    // renderer in a browser-only card using the real dataset; keep saved reports intact.
    if (!displays.has('pie')) {
        await page.evaluate(seeded => {
            const widget = seeded.dashboard.widgets.find(widget => widget.key === 'types-pie');
            const report = seeded.reports.find(report => report.id === widget.report_id);
            const card = document.createElement('article');
            card.className = 'mb-card';
            card.dataset.widget = 'pie-render-probe';
            card.style.cssText = 'position:relative;height:280px;width:100%;margin-top:20px';
            card.innerHTML = '<div class="mb-card-body"></div>';
            document.querySelector('#analytics-studio').append(card);
            const chart = window.SalesDemoFixture.visualize(card.firstElementChild, seeded.results[widget.key], 'pie', report.visualization_settings);
            if (chart) window.demoCharts.push(chart);
        }, seeded);
        await expect(page.locator('[data-widget=pie-render-probe] canvas')).toBeVisible();
        displays.add(await page.locator('[data-widget=pie-render-probe] .mb-card-body').getAttribute('data-visualization'));
    }
    expect([...displays].sort()).toEqual(['number', 'bar', 'line', 'area', 'pie', 'doughnut', 'scatter', 'table', 'pivot', 'funnel', 'progress', 'gauge'].sort());
    await page.screenshot({ path: '../.tools/soar-seeded-report-types.png', fullPage: true });
    await page.setViewportSize({ width: 390, height: 1000 });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect.poll(() => page.evaluate(() => window.demoGrid.getColumn())).toBe(1);
    expect(errors).toEqual([]);
});
