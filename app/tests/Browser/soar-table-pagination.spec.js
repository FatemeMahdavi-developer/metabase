import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';
import { nativeTableTemplates } from './helpers/native-table-templates.js';

test('Vendor table pagination keeps navigation, sizes and search independent and fits small cards', async ({ page }) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const bundle = await build({ entryPoints: ['resources/js/analytics/ui.js'], bundle: true, write: false, format: 'iife', globalName: 'TableFixture' });
    const built = path.resolve('public/build');
    const manifest = JSON.parse(fs.readFileSync(path.join(built, 'manifest.json'), 'utf8'));
    const styles = ['../css/filament/support/support.css', '../css/filament/forms/forms.css', '../css/filament/filament/app.css', manifest['resources/css/panel-theme.css'].file, ...manifest['resources/js/analytics.js'].css]
        .map(file => fs.readFileSync(path.join(built, file), 'utf8')).join('\n');
    await page.setContent('<html lang="fa" dir="rtl"><head></head><body style="margin:0;padding:16px;box-sizing:border-box"><main class="fi-page"><div id="analytics-studio"></div></main></body></html>');
    await page.addStyleTag({ content: styles });
    await page.locator('body').evaluate((body, markup) => body.insertAdjacentHTML('beforeend', markup), nativeTableTemplates());
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.evaluate(() => {
        const result = {
            columns: [{ key: 'id', label: 'شناسه', type: 'number' }, { key: 'customer', label: 'مشتری', type: 'text' }, { key: 'city', label: 'شهر', type: 'text' }],
            rows: Array.from({ length: 600 }, (_, i) => ({ id: i + 1, customer: 'مشتری ' + (i + 1), city: 'نام شهر نمونه با عنوان بلند' })),
            meta: { truncated: true },
        };
        for (const name of ['first', 'second']) {
            const card = document.createElement('article');
            card.id = 'pagination-probe-' + name;
            card.className = 'mb-card';
            card.style.cssText = 'position:relative;height:450px;width:100%;margin-top:16px';
            card.innerHTML = '<header class="mb-card-header">جدول آزمایش صفحه‌بندی</header><div class="mb-card-body"></div>';
            document.querySelector('#analytics-studio').append(card);
            window.TableFixture.mountTable(card.querySelector('.mb-card-body'), result, { page_size: 25 });
        }
    });
    const card = page.locator('#pagination-probe-first');
    const other = page.locator('#pagination-probe-second');
    await expect(card.locator('.fi-ta-ctn .fi-ta-table')).toHaveCount(1);
    await expect(card.locator('.fi-ta-search-field .fi-input')).toHaveCount(1);
    const active = card.locator('[aria-current="page"]');
    const cells = card.locator('tbody tr');
    await expect(cells).toHaveCount(25);
    await expect(card.locator('[data-page=previous]:visible')).toHaveCount(0);
    await expect(card.locator('.fi-pagination-overview')).toContainText('600');
    await expect(card.locator('.fi-pagination-overview')).toContainText('نتیجه محدود شده');
    await card.locator('[data-page="1"]').click();
    await expect(active).toHaveAttribute('data-page', '1');
    await expect(cells.first().locator('[data-column=id]')).toHaveText('۲۶');
    await card.locator('[data-page=next]:visible').click();
    await expect(cells.first().locator('[data-column=id]')).toHaveText('۵۱');
    await card.locator('[data-page=previous]:visible').click();
    await expect(cells.first().locator('[data-column=id]')).toHaveText('۲۶');
    await card.locator('[data-table-page-size]:visible').selectOption('10');
    await expect(cells).toHaveCount(10);
    await expect(active).toHaveAttribute('data-page', '0');
    await expect(other.locator('tbody tr')).toHaveCount(25);
    await expect(other.locator('[aria-current=page]')).toHaveAttribute('data-page', '0');
    await card.locator('[data-page="59"]').click();
    await expect(cells.first().locator('[data-column=id]')).toHaveText('۵۹۱');
    await expect(card.locator('[data-page=next]:visible')).toHaveCount(0);
    await expect(card.locator('.fi-pagination-items')).toContainText('…');
    await card.locator('[data-table-page-size]:visible').selectOption('100');
    await expect(cells).toHaveCount(100);
    await card.locator('[data-result-search]').fill('مشتری 599');
    await expect(cells).toHaveCount(1);
    await expect(cells.first().locator('[data-column=id]')).toHaveText('۵۹۹');
    await expect(card.locator('[data-page=next]:visible')).toHaveCount(0);
    await card.locator('[data-result-search]').fill('بدون نتیجه آزمایش');
    await expect(cells).toHaveCount(0);
    await expect(card.locator('.fi-pagination-overview')).toContainText('0 به 0 از 0');
    await expect(card.locator('[data-page=previous]:visible')).toHaveCount(0);
    await expect(card.locator('[data-page=next]:visible')).toHaveCount(0);
    await card.locator('[data-result-search]').fill('');
    await card.locator('[data-table-page-size]:visible').selectOption('10');
    await card.locator('[data-page="1"]').focus();
    await page.keyboard.press('Enter');
    await expect(active).toHaveAttribute('data-page', '1');
    await expect(active).toBeFocused();

    for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: 1050 });
        for (const theme of ['light', 'dark']) {
            await page.evaluate(theme => {
                document.documentElement.classList.toggle('dark', theme === 'dark');
                document.querySelector('#analytics-studio').dataset.analyticsTheme = theme;
            }, theme);
            const metrics = await card.evaluate(card => {
                const body = card.querySelector('.mb-card-body');
                const footer = card.querySelector('.fi-pagination');
                const root = card.getBoundingClientRect();
                const children = [...footer.querySelectorAll('button, select')].filter(el => el.getClientRects().length).map(el => el.getBoundingClientRect());
                return {
                    bodyOverflow: body.scrollHeight > body.clientHeight + 1,
                    controlsFit: children.every(r => r.left >= root.left && r.right <= root.right && r.bottom <= root.bottom),
                    pageOverflow: document.documentElement.scrollWidth > innerWidth,
                };
            });
            expect(metrics).toEqual({ bodyOverflow: false, controlsFit: true, pageOverflow: false });
        }
    }
    expect(errors).toEqual([]);
});
