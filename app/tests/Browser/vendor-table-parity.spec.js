import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { build } from 'esbuild';

test('report table search and pagination match the complete Vendor components', async ({ page }, testInfo) => {
    const markup = execFileSync(path.resolve('../.tools/php/php.exe'), ['tests/Browser/helpers/export-native-table.php', '--with-reference'], { encoding: 'utf8', timeout: 60000 });
    const bundle = await build({ entryPoints: ['resources/js/analytics/ui.js'], bundle: true, write: false, format: 'iife', globalName: 'VendorParity' });
    const built = path.resolve('public/build'), manifest = JSON.parse(fs.readFileSync(path.join(built, 'manifest.json'), 'utf8'));
    const styles = ['../css/filament/support/support.css', '../css/filament/forms/forms.css', '../css/filament/filament/app.css',
        manifest['resources/css/panel-theme.css'].file, ...manifest['resources/js/analytics.js'].css]
        .map(file => fs.readFileSync(path.join(built, file), 'utf8')).join('\n');
    await page.setContent('<html lang="fa" dir="rtl"><body><main class="fi-main-ctn fi-page"><div id="analytics-studio"><div id="result"></div></div><div id="reference-holder" class="fi-resource-list-records-page"></div></main></body></html>');
    await page.addStyleTag({ content: styles });
    await page.addStyleTag({ content: 'body{margin:0;padding:24px;background:var(--soar-page-bg)}.fi-main-ctn{padding:0!important;min-height:0}#analytics-studio{min-height:0}.fi-ta-ctn{max-width:1200px!important;margin:24px auto}:root{--primary-600:58,77,233;--primary-400:129,140,248;--gray-200:229,231,235;--gray-400:156,163,175;--gray-500:107,114,128;--gray-700:55,65,81;--gray-950:3,7,18}@media(max-width:600px){body{padding:12px}}' });
    await page.locator('#reference-holder').evaluate((el, html) => el.innerHTML = html, markup);
    // Livewire hides loading-only icons before displaying a resource table.
    await page.locator('#vendor-reference').evaluate(root => {
        root.querySelectorAll('.fi-pagination-records-per-page-select select').forEach(select => select.value = '25');
        root.querySelectorAll('.animate-spin').forEach(node => {
            if ([...node.attributes].some(attr => attr.name.startsWith('wire:loading'))) node.style.display = 'none';
        });
    });
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.evaluate(() => window.VendorParity.mountTable(document.getElementById('result'), {
        columns: [{ key: 'id', label: 'ID', type: 'number' }, { key: 'name', label: 'Name', type: 'text' }],
        rows: Array.from({ length: 100 }, (_, i) => ({ id: i + 1, name: 'Record ' + (i + 1) })), meta: {},
    }, { page_size: 25 }));
    for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: 1100 });
        for (const mode of ['light', 'dark']) {
            await page.locator('html').evaluate((el, mode) => el.classList.toggle('dark', mode === 'dark'), mode);
            await expect.poll(() => page.evaluate(() => {
                const collect = root => {
                    const paint = selector => {
                        const el = root.querySelector(selector), s = getComputedStyle(el);
                        return { color: s.color, background: s.backgroundColor, radius: s.borderRadius, border: s.borderTopColor, shadow: s.boxShadow, font: s.font, padding: s.padding, height: el.getBoundingClientRect().height };
                    };
                    const footer = root.querySelector('.fi-pagination'), origin = footer.getBoundingClientRect();
                    const position = selector => [...footer.querySelectorAll(selector)].filter(el => el.getClientRects().length).map(el => {
                        const r = el.getBoundingClientRect(); return { left: Math.round(r.left - origin.left), right: Math.round(r.right - origin.left), top: Math.round(r.top - origin.top) };
                    });
                    return {
                        search: paint('.fi-ta-search-field .fi-input-wrp'),
                        input: paint('.fi-ta-search-field .fi-input'),
                        footer: paint('.fi-pagination'),
                        active: paint('.fi-pagination-item.fi-active .fi-pagination-item-label'),
                        overview: paint('.fi-pagination-overview'),
                        overviewText: footer.querySelector('.fi-pagination-overview').textContent.trim(),
                        pages: [...footer.querySelectorAll('.fi-pagination-item-label')].map(el => el.textContent.trim()),
                        sizes: [...footer.querySelectorAll('select')].map(el => el.value),
                        positions: { overview: position('.fi-pagination-overview'), selector: position('.fi-pagination-records-per-page-select'), pages: position('.fi-pagination-items'), compact: position('.fi-pagination-next-btn') },
                    };
                };
                const actual = collect(document.querySelector('#result .fi-ta-ctn')), reference = collect(document.querySelector('#vendor-reference'));
                return Object.fromEntries(Object.keys(actual).filter(key => JSON.stringify(actual[key]) !== JSON.stringify(reference[key])).map(key => [key, { actual: actual[key], reference: reference[key] }]));
            }), { timeout: 10000 }).toEqual({});
            await page.screenshot({ path: testInfo.outputPath('vendor-parity-' + mode + '-' + width + '.png'), fullPage: true });
        }
    }
    await expect(page.locator('#result .soar-pagination')).toHaveCount(0);
    await expect(page.locator('#result .fi-pagination-records-per-page-select')).toHaveCount(2);
});
