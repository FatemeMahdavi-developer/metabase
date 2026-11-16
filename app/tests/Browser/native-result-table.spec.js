import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';
import { nativeTableTemplates } from './helpers/native-table-templates.js';

test('native Filament result tables preserve typed sorting, escaping, column settings and drill context', async ({ page }) => {
    const bundle = await build({ entryPoints: ['resources/js/analytics/ui.js'], bundle: true, write: false, format: 'iife', globalName: 'NativeResultTable' });
    const built = path.resolve('public/build');
    const manifest = JSON.parse(fs.readFileSync(path.join(built, 'manifest.json'), 'utf8'));
    const styles = ['../css/filament/support/support.css', '../css/filament/forms/forms.css', '../css/filament/filament/app.css', manifest['resources/css/panel-theme.css'].file, ...manifest['resources/js/analytics.js'].css]
        .map(file => fs.readFileSync(path.join(built, file), 'utf8')).join('\n');
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setContent('<html lang="fa" dir="rtl"><body><main class="fi-page"><div id="analytics-studio"><div id="sorted"></div><div id="drill"></div><div id="static"></div><div id="empty"></div></div></main></body></html>');
    await page.addStyleTag({ content: styles });
    await page.locator('body').evaluate((body, markup) => body.insertAdjacentHTML('beforeend', markup), nativeTableTemplates());
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.evaluate(() => {
        window.tableClicks = [];
        const result = {
            columns: [{ key: 'id', label: 'شناسه', type: 'number' }, { key: 'amount', label: 'مبلغ', type: 'number' }, { key: 'customer.name', label: 'مشتری', type: 'text' }, { key: 'private', label: 'پنهان', type: 'text' }],
            rows: [null, '100', '9', '2.50', '-4'].map((amount, i) => ({ id: 1000 + i, amount, 'customer.name': i === 1 ? '<img src=x onerror="window.tableInjected=true">' : 'مشتری ' + i, private: 'hidden' })),
            meta: { result_signature: 'native-result-signed', truncated: true },
        };
        const settings = { visible_columns: ['id', 'amount', 'customer.name'], decimals: 2, _field_metadata: { id: { primary: true } } };
        window.NativeResultTable.mountTable(document.querySelector('#sorted'), result, settings);
        window.NativeResultTable.mountTable(document.querySelector('#drill'), result, { ...settings, table_search: false,
            _can_click_column: key => key !== 'id', _cell_labels: (row, key) => key === 'customer.name' ? 'برچسب ' + row.id : null,
            _cell_title: key => key === 'customer.name' ? 'مشتری مرتبط' : '',
        }, (row, context) => window.tableClicks.push({ row: row?.id ?? null, index: context.row_index, column: context.column_key, kind: context.kind, signature: context.result_signature }));
        document.querySelector('#static').innerHTML = window.NativeResultTable.tableHtml(result);
        window.NativeResultTable.mountTable(document.querySelector('#empty'), { columns: result.columns, rows: [], meta: {} });
    });
    const sorted = page.locator('#sorted');
    await expect(sorted.locator('.fi-ta-table')).toHaveCount(1);
    await expect(sorted.locator('.fi-ta-cell')).toHaveCount(15);
    await expect(sorted.locator('th')).toHaveCount(3);
    await expect(sorted.locator('[data-column=id]').first()).toHaveText('۱۰۰۰');
    await expect(sorted.locator('img')).toHaveCount(0);
    await expect(sorted.locator('[data-column="customer.name"]').nth(1)).toContainText('<img src=x');
    expect(await page.evaluate(() => window.tableInjected)).toBeUndefined();
    await sorted.locator('[data-table-sort=amount]').click();
    await expect(sorted.locator('th[aria-sort=ascending]')).toHaveCount(1);
    await expect(sorted.locator('[data-column=id]')).toHaveText(['۱۰۰۰', '۱۰۰۴', '۱۰۰۳', '۱۰۰۲', '۱۰۰۱']);
    await sorted.locator('[data-table-sort=amount]').click();
    await expect(sorted.locator('th[aria-sort=descending]')).toHaveCount(1);
    await expect(sorted.locator('[data-column=id]')).toHaveText(['۱۰۰۱', '۱۰۰۲', '۱۰۰۳', '۱۰۰۴', '۱۰۰۰']);
    const drill = page.locator('#drill');
    await expect(drill.locator('[data-result-search]')).toHaveCount(0);
    await expect(drill.locator('[data-column=id][role=button]')).toHaveCount(0);
    const cell = drill.locator('[data-column="customer.name"]').nth(2);
    await expect(cell).toHaveText('برچسب 1002');
    await expect(cell).toHaveAttribute('title', 'مشتری مرتبط');
    await cell.focus();
    await page.keyboard.press('Enter');
    await drill.locator('[data-table-sort=amount]').click();
    expect(await page.evaluate(() => window.tableClicks)).toEqual([
        { row: 1002, index: 2, column: 'customer.name', kind: 'cell', signature: 'native-result-signed' },
        { row: null, index: null, column: 'amount', kind: 'header', signature: 'native-result-signed' },
    ]);
    await expect(page.locator('#static .fi-ta-table')).toHaveCount(1);
    await expect(page.locator('#static [data-table-sort], #static .fi-pagination, #static [data-result-search]')).toHaveCount(0);
    await expect(page.locator('#empty .fi-ta-empty-state')).toBeVisible();
    await expect(page.locator('#empty tbody tr')).toHaveCount(0);
    expect(await sorted.evaluate(el => [...el.querySelectorAll('*')].some(node => [...node.attributes].some(attr => attr.name.startsWith('wire:'))))).toBe(false);
    expect(errors).toEqual([]);
});

for (const section of ['thead', 'thead tr', 'tbody', 'thead, tbody']) {
    test(`Vendor result tables render when the host omits empty ${section} sections`, async ({ page }) => {
        const bundle = await build({ entryPoints: ['resources/js/analytics/ui.js'], bundle: true, write: false, format: 'iife', globalName: 'NativeTableCompatibility' });
        await page.setContent('<main id="result"></main>');
        await page.locator('body').evaluate((body, markup) => body.insertAdjacentHTML('beforeend', markup), nativeTableTemplates());
        await page.evaluate(section => {
            const shell = document.getElementById('analytics-native-table-shell').content;
            shell.querySelectorAll(section).forEach(node => node.remove());
        }, section);
        await page.addScriptTag({ content: bundle.outputFiles[0].text });
        await page.evaluate(() => window.NativeTableCompatibility.mountTable(document.getElementById('result'), {
            columns: [{ key: 'id', label: 'ID', type: 'number' }],
            rows: Array.from({ length: 30 }, (_, i) => ({ id: i + 1 })), meta: {},
        }));
        await expect(page.locator('#result thead th')).toHaveCount(1);
        await expect(page.locator('#result tbody tr')).toHaveCount(25);
        await page.locator('#result [data-page="1"]').click();
        await expect(page.locator('#result tbody tr')).toHaveCount(5);
        await expect(page.locator('#result tbody tr').first()).toContainText('26'.replace(/\d/g, d => String.fromCharCode(1776 + Number(d))));
    });
}

test('host pagination class changes and absent compact controls keep numbered navigation working', async ({ page }) => {
    const bundle = await build({ entryPoints: ['resources/js/analytics/ui.js'], bundle: true, write: false, format: 'iife', globalName: 'HostPagination' });
    await page.setContent('<main id="result"></main>');
    await page.locator('body').evaluate((body, markup) => body.insertAdjacentHTML('beforeend', markup), nativeTableTemplates());
    await page.evaluate(() => {
        const pagination = document.getElementById('analytics-native-table-pagination').content;
        pagination.querySelector('.fi-pagination-items').className = 'host-pagination-items';
        pagination.querySelectorAll('.fi-pagination-previous-btn, .fi-pagination-next-btn').forEach(node => node.remove());
    });
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.evaluate(() => window.HostPagination.mountTable(document.getElementById('result'), {
        columns: [{ key: 'id', label: 'ID', type: 'number' }],
        rows: Array.from({ length: 30 }, (_, i) => ({ id: i + 1 })), meta: {},
    }));
    await expect(page.locator('#result tbody tr')).toHaveCount(25);
    await page.locator('#result [data-page="next"]').click();
    await expect(page.locator('#result tbody tr')).toHaveCount(5);
    await page.locator('#result [data-page="previous"]').click();
    await expect(page.locator('#result tbody tr')).toHaveCount(25);
});

test('incompatible host templates identify the missing part without a null-property error', async ({ page }) => {
    const bundle = await build({ entryPoints: ['resources/js/analytics/ui.js'], bundle: true, write: false, format: 'iife', globalName: 'IncompleteTable' });
    await page.setContent('<main id="result"></main>');
    await page.locator('body').evaluate((body, markup) => body.insertAdjacentHTML('beforeend', markup), nativeTableTemplates());
    await page.evaluate(() => document.getElementById('analytics-native-table-pagination').content.querySelector('.fi-pagination-items').remove());
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    const error = await page.evaluate(() => {
        try { window.IncompleteTable.mountTable(document.getElementById('result'), { columns: [], rows: [], meta: {} }); }
        catch (error) { return error.message; }
    });
    expect(error).toContain('pagination/items');
    expect(error).not.toContain('replaceChildren');
});
