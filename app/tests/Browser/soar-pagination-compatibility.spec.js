import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';
import { nativeTableTemplates } from './helpers/native-table-templates.js';

for (const variant of ['soar', 'without-overview', 'without-forwarded-attributes']) {
    for (const mode of ['light', 'dark']) {
        test(`dashboard tables support ${variant} host pagination in ${mode} mode`, async ({ page }, testInfo) => {
            const errors = [];
            page.on('pageerror', error => errors.push(error.message));
            const bundle = await build({ entryPoints: ['resources/js/analytics/ui.js'], bundle: true, write: false, format: 'iife', globalName: 'HostTable' });
            const built = path.resolve('public/build'), manifest = JSON.parse(fs.readFileSync(path.join(built, 'manifest.json'), 'utf8'));
            const styles = ['../css/filament/support/support.css', '../css/filament/forms/forms.css', '../css/filament/filament/app.css', manifest['resources/css/panel-theme.css'].file, ...manifest['resources/js/analytics.js'].css]
                .map(file => fs.readFileSync(path.join(built, file), 'utf8')).join('\n');
            await page.setContent('<html lang="fa" dir="rtl"><body><main id="analytics-studio">' +
                ['first', 'second'].map(id => '<article class="mb-card" style="position:relative;height:460px;margin-bottom:20px"><header class="mb-card-header">' + id + '</header><div id="' + id + '" class="mb-card-body"></div></article>').join('') +
                '</main></body></html>');
            await page.locator('html').evaluate((html, mode) => html.classList.toggle('dark', mode === 'dark'), mode);
            await page.addStyleTag({ content: styles });
            await page.locator('body').evaluate((body, markup) => body.insertAdjacentHTML('beforeend', markup), nativeTableTemplates());
            await page.evaluate(variant => {
                const footer = document.getElementById('analytics-native-table-pagination').content.firstElementChild;
                footer.classList.replace('fi-pagination', 'soar-pagination');
                const overview = footer.querySelector('.fi-pagination-overview');
                if (variant === 'without-overview') overview.remove();
                else overview.className = 'soar-pagination-overview';
                footer.querySelector('.fi-pagination-items').className = 'soar-pagination-items';
                footer.querySelectorAll('.fi-pagination-records-per-page-select').forEach(node => {
                    if (node.classList.contains('fi-compact')) { node.remove(); return; }
                    const wrapper = document.createElement('div');
                    wrapper.className = 'soar-pagination-select';
                    wrapper.replaceChildren(...node.childNodes);
                    node.replaceWith(wrapper);
                });
                footer.querySelectorAll('.fi-pagination-previous-btn, .fi-pagination-next-btn').forEach(node => node.remove());
                if (variant === 'without-forwarded-attributes') {
                    for (const key of Object.keys(footer.dataset)) delete footer.dataset[key];
                }
            }, variant);
            await page.addScriptTag({ content: bundle.outputFiles[0].text });
            await page.evaluate(() => {
                const result = {
                    columns: [{ key: 'id', label: 'ID', type: 'number' }, { key: 'name', label: 'Name', type: 'text' }],
                    rows: Array.from({ length: 60 }, (_, i) => ({ id: i + 1, name: 'Record ' + (i + 1) })),
                    meta: {},
                };
                for (const id of ['first', 'second']) window.HostTable.mountTable(document.getElementById(id), result);
            });
            const first = page.locator('#first'), second = page.locator('#second');
            await expect(first.locator('tbody tr')).toHaveCount(25);
            await expect(second.locator('tbody tr')).toHaveCount(25);
            const overview = first.locator('.soar-pagination-overview');
            if (variant !== 'without-overview') await expect(overview).toContainText('60');
            await first.locator('[data-page="next"]').click();
            await expect(first.locator('tbody tr').first()).toContainText('Record 26');
            if (variant !== 'without-overview') await expect(overview).toContainText('26');
            const pageSize = first.locator('[data-table-page-size]');
            await pageSize.selectOption('10');
            await expect(pageSize).toBeFocused();
            await expect(first.locator('tbody tr')).toHaveCount(10);
            await expect(second.locator('tbody tr')).toHaveCount(25);
            await first.locator('[data-result-search]').fill('Record 60');
            await expect(first.locator('tbody tr')).toHaveCount(1);
            if (variant !== 'without-overview') {
                await expect(overview).toContainText('1');
                expect(await pageSize.getAttribute('aria-label')).toBeTruthy();
                expect(await first.locator('.mb-table-pagination').getAttribute('data-overview-template')).toContain('{total}');
            }
            await first.locator('[data-result-search]').fill('no matching records');
            await expect(first.locator('tbody tr')).toHaveCount(0);
            await expect(first.locator('.fi-ta-empty-state')).toBeVisible();
            if (variant !== 'without-overview') {
                await expect(overview).toContainText('0');
                await expect(overview).toHaveCSS('color', mode === 'dark' ? 'rgb(255, 255, 255)' : 'rgb(0, 0, 0)');
            } else await expect(first.locator('.fi-pagination-overview, .soar-pagination-overview')).toHaveCount(0);
            await page.screenshot({ path: testInfo.outputPath('soar-pagination.png'), fullPage: true });
            expect(errors).toEqual([]);
        });
    }
}
