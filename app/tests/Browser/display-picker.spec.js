import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

let markup, styles;
test.beforeAll(() => {
    const localPhp = path.resolve('../.tools/php/php.exe');
    const php = process.env.ANALYTICS_PHP || (fs.existsSync(localPhp) ? localPhp : 'php');
    markup = execFileSync(php, ['tests/Browser/helpers/export-display-picker.php'], { encoding: 'utf8', timeout: 60000 });
    const built = path.resolve('public/build');
    const manifest = JSON.parse(fs.readFileSync(path.join(built, 'manifest.json'), 'utf8'));
    styles = ['../css/filament/support/support.css', '../css/filament/forms/forms.css',
        '../css/filament/filament/app.css', manifest['resources/css/panel-theme.css'].file,
        ...manifest['resources/js/analytics.js'].css]
        .map(file => fs.readFileSync(path.join(built, file), 'utf8')).join('\n');
});

test('visual display picker renders every type, selects with mouse and keyboard, and fits light/dark mobile layouts', async ({ page }, testInfo) => {
    await page.setContent('<html lang="fa" dir="rtl"><body><main id="analytics-studio"><section class="picker-modal"><h2>نوع نمایش</h2>' + markup + '</section></main></body></html>');
    await page.addStyleTag({ content: styles });
    await page.addStyleTag({ content: 'body{margin:0;background:#ededf6;padding:24px}.picker-modal{max-width:896px;margin:auto;padding:24px;background:#fff;border-radius:22px}.picker-modal h2{margin:0 0 20px;font-size:20px}.dark body{background:#252530}.dark .picker-modal{background:#111118} @media(max-width:540px){body{padding:12px}.picker-modal{padding:16px}}' });
    const choices = page.locator('.analytics-display-option');
    const radios = page.getByRole('radio');
    await expect(choices).toHaveCount(12);
    await expect(radios).toHaveCount(12);
    await expect(page.locator('svg[data-display-preview]')).toHaveCount(12);
    await expect(page.getByRole('radio', { name: 'میله‌ای', exact: true })).toBeChecked();
    const previews = await page.locator('svg[data-display-preview]').evaluateAll(nodes => nodes.map(node => node.innerHTML.trim()));
    expect(new Set(previews).size).toBe(12);
    for (const type of ['table','bar','line','area','pie','doughnut','number','progress','gauge','scatter','funnel','pivot']) {
        const choice = page.locator('[data-display-option="' + type + '"]');
        await expect(choice.locator('.analytics-display-option-description')).not.toBeEmpty();
        await expect(choice.locator('svg')).toBeVisible();
    }

    const funnel = page.getByRole('radio', { name: 'قیفی', exact: true });
    await page.locator('[data-display-option=funnel] svg').click();
    await expect(funnel).toBeChecked();
    await expect(page.locator('input:checked')).toHaveCount(1);
    await expect(page.getByRole('radio', { name: 'میله‌ای', exact: true })).not.toBeChecked();
    await funnel.focus();
    await page.keyboard.press('ArrowDown');
    await expect(page.getByRole('radio', { name: 'جدول محوری', exact: true })).toBeChecked();
    await page.keyboard.press('ArrowUp');
    await expect(funnel).toBeChecked();
    expect(await page.locator('[data-display-option=funnel]').evaluate(el => getComputedStyle(el).outlineStyle)).toBe('solid');

    for (const theme of ['light', 'dark']) {
        await page.locator('html').evaluate((el, theme) => el.classList.toggle('dark', theme === 'dark'), theme);
        const colors = await page.locator('[data-display-option=funnel]').evaluate(el => ({
            selected: getComputedStyle(el).backgroundColor,
            plain: getComputedStyle(document.querySelector('[data-display-option=table]')).backgroundColor,
            text: getComputedStyle(el).color,
        }));
        expect(colors.selected).not.toBe(colors.plain);
        expect(colors.text).toBe(theme === 'dark' ? 'rgb(248, 250, 252)' : 'rgb(17, 24, 39)');
        await page.screenshot({ path: testInfo.outputPath('display-picker-' + theme + '.png'), fullPage: true });
        for (const width of [390, 320]) {
            await page.setViewportSize({ width, height: 844 });
            expect(await page.locator('.analytics-display-options').evaluate(el => getComputedStyle(el).gridTemplateColumns.split(' ').length)).toBe(2);
            expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
            await funnel.scrollIntoViewIfNeeded();
            await expect(funnel).toBeChecked();
            const bounds = await page.locator('[data-display-option=funnel] svg').boundingBox();
            expect(bounds.width).toBeGreaterThan(75);
        }
        await page.setViewportSize({ width: 1440, height: 1050 });
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: testInfo.outputPath('display-picker-mobile.png'), fullPage: true });
});
