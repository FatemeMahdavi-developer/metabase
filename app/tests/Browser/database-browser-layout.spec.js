import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { build } from 'esbuild';

test('database browser contains long table names and keeps native action icons beside their labels', async ({ page }, testInfo) => {
    const php = path.resolve('../.tools/php/php.exe');
    const options = { encoding: 'utf8', timeout: 60000, maxBuffer: 2 * 1024 * 1024 };
    const buttons = execFileSync(php, ['tests/Browser/helpers/export-dashboard-buttons.php'], options);
    const controls = execFileSync(php, ['-r', "require 'vendor/autoload.php'; $app = require 'bootstrap/app.php'; $app->make(Illuminate\\Contracts\\Console\\Kernel::class)->bootstrap(); echo view('filament.partials.analytics-native-controls')->render();"], options);
    const bundle = await build({
        stdin: { contents: 'export {connectionMethods} from "./resources/js/analytics/connections.js"; export {button,icon} from "./resources/js/analytics/ui.js";', resolveDir: process.cwd() },
        bundle: true, write: false, format: 'iife', globalName: 'DatabaseBrowserFixture',
    });
    const built = path.resolve('public/build'), manifest = JSON.parse(fs.readFileSync(path.join(built, 'manifest.json'), 'utf8'));
    const styles = ['../css/filament/support/support.css', '../css/filament/forms/forms.css', '../css/filament/filament/app.css',
        manifest['resources/css/panel-theme.css'].file, ...manifest['resources/js/analytics.js'].css]
        .map(file => fs.readFileSync(path.join(built, file), 'utf8')).join('\n');
    await page.setContent('<html lang="fa" dir="rtl"><body><main class="fi-main-ctn fi-page"><div id="analytics-studio"><div id="browser"></div><div id="icon-only"></div></div></main></body></html>');
    await page.addStyleTag({ content: styles });
    // Emulate the page's available content area without changing component styles.
    await page.addStyleTag({ content: 'body{margin:0;padding:24px;background:var(--soar-page-bg)}.fi-main-ctn{padding:0!important;min-height:0}#analytics-studio{min-height:0}:root{--primary-600:58,77,233;--primary-400:129,140,248;--gray-200:229,231,235;--gray-400:156,163,175;--gray-500:107,114,128;--gray-700:55,65,81;--gray-950:3,7,18}@media(max-width:600px){body{padding:12px}}' });
    await page.locator('body').evaluate((body, html) => body.insertAdjacentHTML('beforeend', html), buttons + controls);
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.evaluate(() => {
        const english = 'public.analytics_dashboard_revisions_with_a_very_long_identifier_that_must_stay_inside_the_sidebar';
        const persian = 'جدول اطلاعات سفارش‌ها و وضعیت پردازش‌های طولانی مربوط به همه کاربران سامانه';
        const labels = [english, persian, '<img src=x onerror="window.labelExecuted=true"> Literal table', ...Array.from({ length: 9 }, (_, i) => 'public.example_table_' + i)];
        const connection = { id: 9, name: 'unisq', catalog: labels.map((label, i) => ({
            key: i === 0 ? english : 'public.table_' + i, label, description: '', kind: i === 1 ? 'view' : 'table', fields: [],
        })) };
        window.browserContext = {
            ...window.DatabaseBrowserFixture.connectionMethods,
            browserConnection: connection, browserTable: connection.catalog[0].key, browserMode: 'data',
            render() { document.getElementById('browser').innerHTML = this.browserHtml(); },
        };
        window.browserContext.render();
        document.getElementById('browser').addEventListener('click', event => {
            const target = event.target.closest('[data-action="selectTable"]');
            if (target) window.browserContext.selectTable(target);
        });
        document.getElementById('icon-only').innerHTML = window.DatabaseBrowserFixture.button(
            window.DatabaseBrowserFixture.icon('settings'), 'iconOnly', '', 'aria-label="تنظیم ستون"');
    });
    await expect(page.locator('.mb-schema-tables [data-action="selectTable"]')).toHaveCount(12);
    await expect(page.locator('.mb-schema-tables img')).toHaveCount(0);
    expect(await page.evaluate(() => window.labelExecuted)).toBeUndefined();
    await expect(page.locator('#icon-only button')).toHaveAccessibleName('تنظیم ستون');
    await expect(page.locator('#icon-only button > .fi-btn-icon')).toHaveCount(1);
    await expect(page.locator('#icon-only .fi-btn-label')).toHaveCount(0);
    await expect(page.locator('[data-schema-search]')).toHaveCount(1);

    for (const width of [1440, 900, 390]) {
        await page.setViewportSize({ width, height: 1050 });
        for (const mode of ['light', 'dark']) {
            await page.locator('html').evaluate((html, mode) => html.classList.toggle('dark', mode === 'dark'), mode);
            const metrics = await page.evaluate(() => {
                const nav = document.querySelector('.mb-schema-tables'), box = nav.getBoundingClientRect();
                const tables = [...nav.querySelectorAll('[data-action="selectTable"]')];
                const labels = tables.map(button => {
                    const name = button.querySelector('.mb-schema-table-name'), style = getComputedStyle(name), r = button.getBoundingClientRect();
                    return { bounded: r.left >= box.left - 1 && r.right <= box.right + 1, font: parseFloat(style.fontSize),
                        ellipsis: style.textOverflow, clipped: name.scrollWidth > name.clientWidth, title: button.title === name.textContent,
                        nameFits: name.clientWidth <= box.width, searchable: !!button.dataset.searchText, key: button.dataset.key };
                });
                const actions = [...document.querySelectorAll('.mb-database-toolbar .mb-actions > button, .mb-schema-details > .mb-actions > button')].map(button => {
                    const icon = button.querySelector(':scope > .fi-btn-icon'), label = button.querySelector('.fi-btn-label');
                    const r = button.getBoundingClientRect(), p = button.parentElement.getBoundingClientRect(), l = label.getBoundingClientRect();
                    return { fits: r.left >= p.left - 1 && r.right <= p.right + 1,
                        nowrap: getComputedStyle(label).whiteSpace === 'nowrap' || getComputedStyle(button).whiteSpace === 'nowrap',
                        sameLine: !icon || Math.abs((icon.getBoundingClientRect().top + icon.getBoundingClientRect().bottom) / 2 - (l.top + l.bottom) / 2) <= 2 };
                });
                const h2 = document.querySelector('.mb-schema-heading h2');
                return { labels, actions, keysPreserved: tables.every((button, i) => button.dataset.key === window.browserContext.browserConnection.catalog[i].key), documentFits: document.documentElement.scrollWidth <= innerWidth + 1,
                    mobileScroll: box.height <= 240 + 1 && nav.scrollHeight > nav.clientHeight,
                    headingFits: h2.scrollWidth <= h2.clientWidth + 1 };
            });
            expect(metrics.keysPreserved).toBe(true);
            expect(metrics.documentFits, mode + ' ' + width + ' document overflow').toBe(true);
            expect(metrics.headingFits).toBe(true);
            for (const label of metrics.labels) {
                expect(label).toMatchObject({ bounded: true, ellipsis: 'ellipsis', title: true, nameFits: true, searchable: true });
                expect(label.font).toBeLessThanOrEqual(12);
            }
            if (width > 760) expect(metrics.labels[0].clipped).toBe(true);
            expect(metrics.actions).toHaveLength(5);
            for (const action of metrics.actions) expect(action).toEqual({ fits: true, nowrap: true, sameLine: true });
            if (width === 390) expect(metrics.mobileScroll).toBe(true);
            await page.screenshot({ path: testInfo.outputPath('database-browser-' + mode + '-' + width + '.png'), fullPage: true });
        }
    }
    const table = page.locator('.mb-schema-tables [data-action="selectTable"]').nth(1);
    const key = await table.getAttribute('data-key');
    await table.click();
    expect(await page.evaluate(() => window.browserContext.browserTable)).toBe(key);
    await expect(page.locator('.mb-schema-tables button.active')).toHaveAttribute('data-key', key);
    await expect(page.locator('.mb-schema-tables button').nth(1).locator('small')).toHaveText('View');
});
