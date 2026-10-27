import { test, expect } from '@playwright/test';
import path from 'node:path';
import { api, login, sampleConnection } from './helpers/native-analytics';

test('dashboard charts initialize while an unrelated panel font remains pending', async ({ page }) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await login(page);
    const connection = await sampleConnection(page);
    let report, dashboard, releaseFont;
    const fontGate = new Promise(resolve => { releaseFont = resolve; });
    let fontRequests = 0;
    const fontHandlers = new Set();
    const pendingFont = '**/fonts/analytics-isolation-unrelated.woff2';
    const holdFont = async route => {
        fontRequests++;
        const handling = fontGate.then(() => route.fulfill({ path: path.resolve('public/fonts/vazir/Vazir-Regular.woff2'), contentType: 'font/woff2' }));
        fontHandlers.add(handling);
        try { await handling; } finally { fontHandlers.delete(handling); }
    };
    let documentRoute, injectUnrelatedFont;
    try {
        report = await api(page, 'reports', 'POST', {
            name: 'Browser font isolation ' + Date.now(), description: null, folder_id: null,
            display: 'bar', visualization_settings: {},
            query_definition: {
                connection_id: connection.id, source: 'orders', mode: 'aggregate',
                dimensions: [{ field: 'status', grain: null }],
                metrics: [{ key: 'orders', label: 'سفارش‌ها', function: 'count', field: null }],
                filters: [], joins: [], expressions: [], sort: [], limit: null,
            },
        });
        dashboard = await api(page, 'dashboards', 'POST', {
            name: 'Browser isolated dashboard ' + Date.now(), description: null, folder_id: null,
        });
        dashboard = await api(page, `dashboards/${dashboard.id}`, 'PUT', {
            ...dashboard, filters: [], widgets: [{
                key: 'font-isolation', type: 'report', report_id: report.id, tab_key: 'main',
                x: 0, y: 0, w: 12, h: 10, settings: {}, content: null, click_behavior: { type: 'menu' },
            }],
        });

        // A real panel can include a font from another module whose host is
        // unreachable inside the network. Keep that font request open while
        // leaving analytics' own self-hosted Vazir files and API untouched.
        await page.route(pendingFont, holdFont);
        documentRoute = '**/admin/analytics/dashboards/' + dashboard.id;
        injectUnrelatedFont = async route => {
            const response = await route.fetch();
            const html = (await response.text()).replace(/<body\b[^>]*>/i, body => body + `
                <style>
                    @font-face { font-family: AnalyticsIsolationPendingFont; src: url('/fonts/analytics-isolation-unrelated.woff2') format('woff2'); font-display: swap; }
                    #analytics-isolation-font { position: fixed; left: -10000px; font: 16px AnalyticsIsolationPendingFont; }
                </style>
                <span id="analytics-isolation-font" aria-hidden="true">Unrelated panel module</span>
                <script>document.getElementById('analytics-isolation-font').getBoundingClientRect();</script>
            `);
            await route.fulfill({ response, body: html });
        };
        await page.route(documentRoute, injectUnrelatedFont);
        await page.goto('/admin/analytics/dashboards/' + dashboard.id, { waitUntil: 'domcontentloaded' });
        await expect.poll(() => fontRequests).toBe(1);
        expect(await page.evaluate(() => document.fonts.status)).toBe('loading');

        // An unbounded document.fonts.ready wait would leave the workbench
        // blank here even though its own fonts and real query have completed.
        await expect.poll(() => page.evaluate(() => window.analyticsStudio?.dashboard?.id)).toBe(dashboard.id);
        await expect(page.locator('[data-widget="font-isolation"] canvas')).toBeVisible();
        await expect(page.locator('[data-widget="font-isolation"] .mb-loading')).toHaveCount(0);
        const state = await page.evaluate(() => ({
            fontSet: document.fonts.status,
            pending: [...document.fonts].find(face => face.family === 'AnalyticsIsolationPendingFont')?.status,
            ownFonts: [400, 500, 700, 900].every(weight => document.fonts.check(`${weight} 12px Vazir`, 'فروش Sales ۱۲۳')),
            rows: window.analyticsStudio.results.get('font-isolation')?.rows?.length,
        }));
        expect(state).toMatchObject({ fontSet: 'loading', pending: 'loading', ownFonts: true });
        expect(state.rows).toBeGreaterThan(0);
        expect(errors).toEqual([]);
    } finally {
        releaseFont();
        // Finish the held handler before removing its interception; unroute
        // may otherwise handle the same request while fulfill is pending.
        await Promise.all([...fontHandlers]);
        if (injectUnrelatedFont) await page.unroute(documentRoute, injectUnrelatedFont);
        await page.unroute(pendingFont, holdFont);
        if (dashboard) await api(page, `dashboards/${dashboard.id}`, 'DELETE');
        if (report) await api(page, `reports/${report.id}`, 'DELETE');
    }
});
