import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const credentials = process.env.ANALYTICS_PASSWORD
    ? { email: process.env.ANALYTICS_EMAIL || 'admin@example.com', password: process.env.ANALYTICS_PASSWORD }
    : JSON.parse(fs.readFileSync(path.resolve('../.tools/admin.json'), 'utf8').replace(/^\uFEFF/, ''));
test.setTimeout(360000);
const weights = [100, 300, 400, 500, 700, 900];
const vazir = /^Vazir(?:[\s-]|$)/i;
const themeNames = { light: 'حالت روشن', dark: 'حالت تیره' };

async function api(page, route, method = 'GET', payload) {
    return page.evaluate(async ({ route, method, payload }) => {
        const response = await fetch('/analytics/api/' + route, { method, headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-CSRF-TOKEN': document.querySelector('meta[name="csrf-token"]').content }, ...(payload ? { body: JSON.stringify(payload) } : {}) });
        const result = await response.json(); if (!response.ok) throw new Error(JSON.stringify(result)); return result;
    }, { route, method, payload });
}

async function login(page) {
    page.on('dialog', async dialog => { if (dialog.type() === 'beforeunload') await dialog.accept(); else { await dialog.dismiss(); throw new Error('Unexpected browser dialog: ' + dialog.message()); } });
    await page.goto('/admin/login');
    await page.locator('input[type=email]').fill(credentials.email); await page.locator('input[type=password]').fill(credentials.password);
    await page.locator('button[type=submit]').click(); await expect(page).not.toHaveURL(/login/);
    await page.goto('/admin/analytics/dashboards'); await expect(page.locator('.fi-ta-table')).toBeVisible();
}

async function closeNativeDrawerIfOpen(page) {
    if (page.viewportSize().width >= 1024) return;
    const overlay = page.locator('.fi-sidebar-close-overlay');
    if (await overlay.isVisible()) await overlay.click({ position: { x: 16, y: 200 } });
    await expect(overlay).not.toBeVisible();
    await expect(page.locator('.fi-topbar-close-sidebar-btn')).not.toBeVisible();
}

async function nativeTheme(page, mode) {
    await closeNativeDrawerIfOpen(page);
    if (!await page.locator('.fi-theme-switcher').isVisible()) await page.getByRole('button', { name: 'منوی کاربر', exact: true }).click();
    await expect(page.locator('.fi-theme-switcher')).toBeVisible();
    await expect(page.locator('.fi-theme-switcher')).toHaveCount(1); await expect(page.locator('.fi-theme-switcher button')).toHaveCount(3);
    await page.locator('.fi-theme-switcher').getByRole('button', { name: themeNames[mode], exact: true }).click();
    await expect(page.locator('.fi-theme-switcher')).not.toBeVisible();
    await expect.poll(() => page.evaluate(() => document.documentElement.classList.contains('dark'))).toBe(mode === 'dark');
}

async function renderedFonts(page, cdp, selector) {
    await expect(page.locator(selector)).toBeVisible();
    const documentNode = (await cdp.send('DOM.getDocument')).root;
    const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: documentNode.nodeId, selector });
    expect(nodeId).toBeGreaterThan(0);
    const { fonts } = await cdp.send('CSS.getPlatformFontsForNode', { nodeId });
    expect(fonts.some(font => font.isCustomFont && vazir.test(font.familyName) && font.glyphCount > 0)).toBe(true);
    expect(fonts.some(font => /Vazirmatn/i.test(font.familyName))).toBe(false);
    return fonts;
}

async function fixture(page) {
    const connection = (await api(page, 'library')).connections.find(row => row.driver === 'sqlite' && row.name === 'فروشگاه نمونه • SQLite' && row.catalog?.some(table => table.key === 'orders'));
    expect(connection).toBeTruthy();
    const reports = [], dashboards = [];
    const base = { connection_id: connection.id, source: 'orders', mode: 'aggregate', expressions: [], joins: [], filters: [], dimensions: [{ field: 'ordered_at', grain: 'month' }, { field: 'status', grain: null }], metrics: [{ key: 'revenue', label: 'فروش آزمون وزیر', function: 'sum', field: 'total' }], sort: [{ key: 'ordered_at', direction: 'asc' }, { key: 'status', direction: 'asc' }], limit: null };
    return {
        async report(label, query = {}, display = 'line', settings = {}) {
            const report = await api(page, 'reports', 'POST', { name: `Browser font loading ${Date.now()} ${label}`, description: null, folder_id: null, display, visualization_settings: settings, query_definition: { ...base, ...query } }); reports.push(report.id); return report;
        },
        async dashboard(widgets) {
            const board = await api(page, 'dashboards', 'POST', { name: `Browser font loading ${Date.now()} نمودارهای وزیر`, description: null, folder_id: null }); dashboards.push(board.id);
            return api(page, `dashboards/${board.id}`, 'PUT', { ...board, widgets, filters: [] });
        },
        async cleanup() { for (const id of dashboards.reverse()) await api(page, `dashboards/${id}`, 'DELETE'); for (const id of reports.reverse()) await api(page, `reports/${id}`, 'DELETE'); },
    };
}

const widget = (key, report, x, y) => ({ key, type: 'report', report_id: report.id, tab_key: 'main', x, y, w: 12, h: 11, settings: {}, content: null, click_behavior: { type: 'menu' } });

async function assertChartFontsAndGeometry(page) {
    await expect.poll(() => page.evaluate(() => window.analyticsStudio.charts.every(chart => Math.abs(chart.width - chart.canvas.getBoundingClientRect().width) <= 1))).toBe(true);
    const state = await page.evaluate(() => window.analyticsStudio.charts.map(chart => {
        const scales = Object.values(chart.scales);
        const fontStrings = scales.flatMap(scale => scale.getLabelItems().map(item => item.font.string));
        const cachedWidths = scales.flatMap(scale => Object.entries(scale._longestTextCache || {}).flatMap(([font, cache]) => Object.entries(cache.data || {}).map(([text, width]) => {
            chart.ctx.save(); chart.ctx.font = font; const measured = chart.ctx.measureText(text).width; chart.ctx.restore();
            return { font, error: Math.abs(width - measured) };
        })));
        return { key: chart.canvas.closest('[data-widget]').dataset.widget, fontStrings, cachedWidths, legendFont: chart.options.plugins.legend.labels.font.family, titleFont: chart.options.plugins.tooltip.titleFont.family, bodyFont: chart.options.plugins.tooltip.bodyFont.family, width: chart.width, renderedWidth: chart.canvas.getBoundingClientRect().width };
    }));
    expect(state.map(chart => chart.key).sort()).toEqual(['area', 'donut', 'horizontal', 'line']);
    for (const chart of state) {
        expect(String(chart.legendFont)).toMatch(/\bVazir\b/); expect(String(chart.titleFont)).toMatch(/\bVazir\b/); expect(String(chart.bodyFont)).toMatch(/\bVazir\b/);
        expect(chart.fontStrings.every(font => /\bVazir\b/.test(font))).toBe(true);
        expect(chart.cachedWidths.every(item => /\bVazir\b/.test(item.font) && item.error < 0.25)).toBe(true);
        expect(Math.abs(chart.width - chart.renderedWidth)).toBeLessThanOrEqual(1);
    }
    const horizontal = await page.evaluate(() => {
        const chart = window.analyticsStudio.charts.find(chart => chart.canvas.closest('[data-widget]')?.dataset.widget === 'horizontal');
        const axis = chart.scales.x;
        const labels = axis.getLabelItems().map(item => {
            chart.ctx.save(); chart.ctx.font = item.font.string;
            const width = Math.max(...(Array.isArray(item.label) ? item.label : [item.label]).map(label => chart.ctx.measureText(String(label)).width)); chart.ctx.restore();
            const x = item.options.translation[0], align = item.options.textAlign;
            const left = ['left', 'start'].includes(align) ? x : ['right', 'end'].includes(align) ? x - width : x - width / 2;
            return { left, right: left + width };
        }).sort((a, b) => a.left - b.left);
        return { rotation: axis.labelRotation, labels };
    });
    expect(horizontal.rotation).toBe(0); expect(horizontal.labels.length).toBeGreaterThanOrEqual(2);
    for (let index = 1; index < horizontal.labels.length; index++) expect(horizontal.labels[index].left).toBeGreaterThanOrEqual(horizontal.labels[index - 1].right - 1);
}

test('self-hosted Vazir renders real panel glyphs and every chart label after a cold font load in both themes and on mobile', async ({ page }) => {
    const errors = [], requests = [], failed = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => { if (request.resourceType() === 'font' || /fonts\.(googleapis|gstatic|bunny)\./i.test(request.url())) requests.push({ type: request.resourceType(), url: request.url() }); });
    page.on('response', response => { if (response.status() >= 400 && ['font', 'stylesheet', 'script', 'document'].includes(response.request().resourceType())) failed.push(response.status() + ' ' + response.url()); });
    await page.addInitScript(() => {
        window.__qaFontDraws = [];
        const draw = CanvasRenderingContext2D.prototype.fillText;
        CanvasRenderingContext2D.prototype.fillText = function (text, ...args) {
            const key = this.canvas.closest?.('[data-widget]')?.dataset.widget;
            if (key && window.__qaFontDraws.length < 20000) {
                const familyLoaded = [...document.fonts].some(face => face.family.replace(/["']/g, '') === 'Vazir' && face.status === 'loaded');
                window.__qaFontDraws.push({ key, text: String(text), font: this.font, loaded: familyLoaded && document.fonts.check(this.font, String(text)) });
            }
            return draw.call(this, text, ...args);
        };
    });
    await login(page);
    const cdp = await page.context().newCDPSession(page); await cdp.send('DOM.enable'); await cdp.send('CSS.enable'); await cdp.send('Network.enable');
    let data;
    try {
        await page.goto('/admin'); await page.evaluate(() => document.fonts.ready);
        for (const mode of ['light', 'dark']) {
            await nativeTheme(page, mode); await renderedFonts(page, cdp, '.fi-header-heading');
            await renderedFonts(page, cdp, '.fi-wi-widget h2');
            await page.screenshot({ path: `tests/Browser/artifacts/vazir-native-${mode}.png`, fullPage: true });
        }
        await page.goto('/admin/analytics/dashboards'); await expect(page.locator('.fi-ta-table')).toBeVisible();
        data = await fixture(page);
        const line = await data.report('خطی', {}, 'line', { legend: true, x_label: 'ماه سفارش', y_label: 'مبلغ فروش' });
        const horizontal = await data.report('میله‌ای افقی', { dimensions: [{ field: 'status', grain: null }], sort: [{ key: 'status', direction: 'asc' }] }, 'bar', { horizontal: true, x_label: 'مبلغ فروش', y_label: 'وضعیت سفارش' });
        const donut = await data.report('حلقه‌ای', { dimensions: [{ field: 'status', grain: null }], sort: [{ key: 'status', direction: 'asc' }] }, 'doughnut', { legend: true, percent_visibility: 'both', center_mode: 'percentage' });
        const area = await data.report('مساحتی', { dimensions: [{ field: 'ordered_at', grain: 'month' }], sort: [{ key: 'ordered_at', direction: 'asc' }] }, 'area', { x_label: 'ماه سفارش', y_label: 'مبلغ فروش' });
        const dashboard = await data.dashboard([widget('line', line, 0, 0), widget('horizontal', horizontal, 12, 0), widget('donut', donut, 0, 11), widget('area', area, 12, 11)]);
        // Leave the panel before clearing the cache so this is a genuine cold navigation.
        await page.goto('about:blank');
        await cdp.send('Network.setCacheDisabled', { cacheDisabled: true }); await cdp.send('Network.clearBrowserCache');
        let release; const fontGate = new Promise(resolve => { release = resolve; }); let heldFonts = 0;
        const holdFont = async route => { heldFonts++; await fontGate; await route.continue(); };
        await page.route('**/fonts/vazir/*.woff2', holdFont);
        try {
            await page.goto('/admin/analytics/dashboards/' + dashboard.id, { waitUntil: 'domcontentloaded' });
            await expect.poll(() => heldFonts).toBeGreaterThan(0);
            expect(await page.evaluate(() => document.fonts.status)).toBe('loading');
            await expect(page.locator('#analytics-studio [data-widget] canvas')).toHaveCount(0);
            release();
            await expect.poll(() => page.evaluate(() => window.analyticsStudio?.dashboard?.id)).toBe(dashboard.id);
            await expect(page.locator('#analytics-studio [data-widget] canvas')).toHaveCount(4);
            await expect(page.locator('.mb-card .mb-loading')).toHaveCount(0);
        } finally { release(); await page.unroute('**/fonts/vazir/*.woff2', holdFont); }
        const loaded = await page.evaluate(async weights => {
            await Promise.all(weights.map(weight => document.fonts.load(weight + ' 24px Vazir', 'آزمون تحلیل سفارش‌ها ۱۲۳۴۵۶۷۸۹۰'))); await document.fonts.ready;
            return [...document.fonts].filter(face => face.family.replace(/["']/g, '') === 'Vazir' && face.status === 'loaded').map(face => Number(face.weight)).sort((a, b) => a - b);
        }, weights);
        expect(loaded).toEqual(weights);
        const firstDraws = await page.evaluate(() => window.__qaFontDraws);
        expect(firstDraws.length).toBeGreaterThan(20);
        expect(firstDraws.every(draw => /\bVazir\b/.test(draw.font) && draw.loaded)).toBe(true);
        expect(firstDraws.some(draw => draw.key === 'line' && /تکمیل|انتظار|لغو/.test(draw.text))).toBe(true);
        expect(firstDraws.some(draw => draw.key === 'donut' && /%|٪/.test(draw.text))).toBe(true);
        await assertChartFontsAndGeometry(page); await renderedFonts(page, cdp, '.mb-toolbar h1');
        const rows = await page.evaluate(() => Object.fromEntries([...window.analyticsStudio.results].map(([key, result]) => [key, result.rows])));
        for (const mode of ['light', 'dark']) {
            await nativeTheme(page, mode); await expect(page.locator('#analytics-studio')).toHaveAttribute('data-analytics-theme', mode);
            await assertChartFontsAndGeometry(page);
            expect(await page.evaluate(() => Object.fromEntries([...window.analyticsStudio.results].map(([key, result]) => [key, result.rows])))).toEqual(rows);
            const fill = await page.evaluate(() => {
                const chart = window.analyticsStudio.charts.find(chart => chart.canvas.closest('[data-widget]')?.dataset.widget === 'area');
                const normalize = color => { chart.ctx.save(); chart.ctx.fillStyle = color; const result = chart.ctx.fillStyle; chart.ctx.restore(); return result; };
                return { actual: normalize(chart.data.datasets[0].backgroundColor), expected: normalize(window.analyticsStudio.analyticsPalette().fill) };
            });
            expect(fill.actual).toBe(fill.expected);
            await page.screenshot({ path: `tests/Browser/artifacts/vazir-chart-dashboard-${mode}.png`, fullPage: true });
        }
        // Hover a real point: built-in canvas tooltip title/body must actually paint with the loaded face.
        const point = await page.evaluate(() => {
            window.__qaFontDraws = [];
            const chart = window.analyticsStudio.charts.find(chart => chart.canvas.closest('[data-widget]')?.dataset.widget === 'line');
            const index = chart.data.datasets[0].data.findIndex(value => Number(value) > 0), position = chart.getDatasetMeta(0).data[index].getCenterPoint(), bounds = chart.canvas.getBoundingClientRect();
            return { x: bounds.left + position.x * bounds.width / chart.width, y: bounds.top + position.y * bounds.height / chart.height };
        });
        await page.mouse.move(point.x, point.y);
        await expect.poll(() => page.evaluate(() => window.analyticsStudio.charts.find(chart => chart.canvas.closest('[data-widget]')?.dataset.widget === 'line').tooltip.opacity)).toBeGreaterThan(0);
        const tooltip = await page.evaluate(() => {
            const model = window.analyticsStudio.charts.find(chart => chart.canvas.closest('[data-widget]')?.dataset.widget === 'line').tooltip;
            return { lines: [...model.title, ...model.body.flatMap(body => [...body.before, ...body.lines, ...body.after])], draws: window.__qaFontDraws.filter(draw => draw.key === 'line') };
        });
        expect(tooltip.lines.length).toBeGreaterThan(1);
        for (const line of tooltip.lines) expect(tooltip.draws.some(draw => draw.text === line && /\bVazir\b/.test(draw.font) && draw.loaded)).toBe(true);
        await page.screenshot({ path: 'tests/Browser/artifacts/vazir-canvas-tooltip.png', fullPage: true });
        await page.mouse.move(1, 1); await page.setViewportSize({ width: 390, height: 844 });
        await expect.poll(() => page.evaluate(() => window.analyticsStudio.grid.getColumn())).toBe(1);
        await expect(page.locator('[data-widget] canvas')).toHaveCount(4); await assertChartFontsAndGeometry(page);
        await expect(page.locator('[data-analytics-theme-controls], [data-action=setAnalyticsTheme]')).toHaveCount(0);
        expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
        await page.screenshot({ path: 'tests/Browser/artifacts/vazir-chart-mobile-dark.png', fullPage: true });
        await nativeTheme(page, 'light'); await assertChartFontsAndGeometry(page);
        await page.screenshot({ path: 'tests/Browser/artifacts/vazir-chart-mobile-light.png', fullPage: true });
        const origin = new URL(page.url()).origin;
        expect(requests.filter(request => request.type === 'font').length).toBeGreaterThanOrEqual(6);
        expect(requests.every(request => new URL(request.url).origin === origin && /^\/fonts\/vazir\//.test(new URL(request.url).pathname))).toBe(true);
        expect(errors).toEqual([]); expect(failed).toEqual([]);
    } finally { if (data) await data.cleanup(); await cdp.detach(); }
});
