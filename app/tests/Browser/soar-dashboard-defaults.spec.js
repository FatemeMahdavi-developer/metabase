import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';

let component, styles;
test.beforeAll(async () => {
    const bundle = await build({
        stdin: { contents: 'export * from "./resources/js/analytics/ui.js"; export * from "./resources/js/analytics/chart-style.js"; export * from "./resources/js/analytics/drill-presentation.js"; export * from "./resources/js/analytics/native-forms.js";', resolveDir: process.cwd() },
        bundle: true, write: false, format: 'iife', globalName: 'SoarFixture',
    });
    component = bundle.outputFiles[0].text;
    const directory = path.resolve('public/build');
    const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'manifest.json'), 'utf8'));
    styles = [...manifest['resources/js/analytics.js'].css, manifest['resources/css/panel-theme.css'].file]
        .map(file => fs.readFileSync(path.join(directory, file), 'utf8')).join('\n');
});
test.beforeEach(async ({ page }) => {
    await page.setContent('<html lang="fa" dir="rtl"><body><main class="fi-page"><div id="analytics-studio" data-read-only="true"><div class="reference-gallery"></div></div></main></body></html>');
    await page.addStyleTag({ content: styles });
    await page.addStyleTag({ content: 'body{margin:0;padding:24px;background:var(--soar-page-bg)}.reference-gallery{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:18px}.reference-gallery .mb-card{position:relative;height:280px;min-width:0}.reference-gallery .mb-card.wide{grid-column:span 2}@media(max-width:600px){body{padding:12px}.reference-gallery{grid-template-columns:minmax(0,1fr)}.reference-gallery .mb-card.wide{grid-column:auto}}' });
    await page.addScriptTag({ content: component });
    await page.evaluate(() => {
        window.gallery = {};
        window.barData = { columns: [{ key: 'severity', label: 'سطح هشدار', type: 'text' }, { key: 'value', label: 'تعداد', type: 'number' }],
            rows: ['Low', 'Medium', 'High', 'Critical'].map((severity, i) => ({ severity, value: [312, 478, 285, 209][i] })), meta: {} };
        window.makeReferenceCard = (key, title, display, result = window.barData, settings = {}) => {
            const card = document.createElement('article');
            card.className = 'mb-card'; card.dataset.reference = key;
            card.innerHTML = '<header class="mb-card-header"><span class="mb-card-title"></span></header><div class="mb-card-body"></div>';
            card.querySelector('.mb-card-title').textContent = title;
            document.querySelector('.reference-gallery').append(card);
            const body = card.querySelector('.mb-card-body');
            const chart = window.SoarFixture.visualize(body, result, display, settings);
            window.gallery[key] = { card, body, chart, settings };
            return window.gallery[key];
        };
        window.applyReferenceTheme = theme => {
            document.documentElement.classList.toggle('dark', theme === 'dark');
            document.querySelector('#analytics-studio').dataset.analyticsTheme = theme;
            Object.values(window.gallery).forEach(item => item.chart?.$analyticsTheme?.());
        };
    });
});

test('SOAR reference defaults follow light/dark mode for cards, bars, areas, doughnuts and gauges', async ({ page }) => {
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.evaluate(() => {
        const one = { columns: [{ key: 'value', label: 'درصد', type: 'number' }], rows: [{ value: 58 }], meta: {} };
        const series = { columns: [{ key: 'time', label: 'زمان', type: 'text' }, { key: 'value', label: 'روند', type: 'number' }],
            rows: [12, 31, 22, 10, 25, 23, 29, 17].map((value, i) => ({ time: String(i + 10) + ':00', value })), meta: {} };
        window.makeReferenceCard('gauge', 'مصرف حافظه', 'gauge', one, { suffix: '%' });
        window.makeReferenceCard('area', 'روند هشدار', 'area', series);
        window.makeReferenceCard('line', 'پینگ سرور', 'line', series);
        window.makeReferenceCard('bars', 'سطح هشدار', 'bar');
        window.makeReferenceCard('donut', 'وضعیت هشدار', 'doughnut', {
            columns: window.barData.columns, rows: [{ severity: 'پردازش شده', value: 73 }, { severity: 'در انتظار', value: 17 }, { severity: 'ناموفق', value: 10 }], meta: {},
        }, { center_mode: 'percentage' });
        window.makeReferenceCard('ring', 'Disk Usage', 'gauge', { ...one, rows: [{ value: 48 }] }, { gauge_style: 'ring', suffix: '%' });
        window.makeReferenceCard('horizontal', 'کتاب‌های اجرایی پرکاربرد', 'bar', window.barData, { horizontal: true });
        window.makeReferenceCard('custom', 'رنگ انتخاب‌شده کاربر', 'bar', window.barData, { series_colors: { [JSON.stringify(['category', 'severity', 'Low'])]: '#e84d8a' } });
        window.makeReferenceCard('points', 'نمایش نقاط به انتخاب کاربر', 'line', series, { points: true, color: '#e84d8a', color_custom: true });
    });
    const expected = {
        light: { page: 'rgb(218, 219, 239)', card: 'rgb(255, 255, 255)', text: 'rgb(17, 24, 39)', border: 'rgb(229, 233, 241)', bars: ['#e9ecf3', '#bfc5f5', '#8c99ff', '#5c6efe'], track: 'rgb(234, 236, 251)' },
        dark: { page: 'rgb(56, 56, 56)', card: 'rgb(0, 0, 0)', text: 'rgb(248, 250, 252)', border: 'rgb(39, 52, 73)', bars: ['#680dc9', '#af65ff', '#ca98ff', '#675cfd'], track: 'rgb(40, 0, 80)' },
    };
    for (const mode of ['light', 'dark', 'light']) {
        await page.evaluate(mode => window.applyReferenceTheme(mode), mode);
        const actual = await page.evaluate(() => {
            const { bars, line, area, donut, gauge, ring, custom, horizontal, points } = window.gallery;
            const colors = item => item.chart.getDatasetMeta(0).data.map(element => element.options.backgroundColor);
            return {
                page: getComputedStyle(document.body).backgroundColor,
                card: getComputedStyle(bars.card).backgroundColor,
                text: getComputedStyle(bars.card.querySelector('.mb-card-title')).color,
                radius: getComputedStyle(bars.card).borderRadius,
                border: getComputedStyle(bars.card).borderTopColor,
                bars: colors(bars), custom: colors(custom)[0],
                line: line.chart.data.datasets[0].borderColor,
                points: line.chart.data.datasets[0].pointRadius,
                chosenPoints: points.chart.data.datasets[0].pointRadius,
                chosenColor: points.chart.data.datasets[0].borderColor,
                gradient: area.chart.getDatasetMeta(0).dataset.options.backgroundColor instanceof CanvasGradient,
                donut: colors(donut), center: donut.body.querySelector('.mb-donut-center strong').textContent,
                track: getComputedStyle(gauge.body.querySelector('.mb-gauge-track')).stroke,
                ringGradient: ring.body.querySelector('linearGradient').getAttribute('gradientUnits'),
                horizontal: { reverse: horizontal.chart.options.scales.x.reverse, side: horizontal.chart.options.scales.y.position, thickness: horizontal.chart.data.datasets[0].maxBarThickness },
            };
        });
        expect(actual).toMatchObject({ ...expected[mode], radius: '16px', custom: '#e84d8a', line: '#314cff', points: 0, chosenPoints: 2, chosenColor: '#e84d8a', gradient: true, ringGradient: 'userSpaceOnUse', donut: ['#5947f9', '#af65ff', '#ca98ff'], center: '۷۳%', horizontal: { reverse: true, side: 'right', thickness: 6 } });
        if (mode !== 'light' || !(await page.locator('[data-reference=bars]').getAttribute('data-captured'))) {
            await page.screenshot({ path: '../.tools/soar-reference-' + mode + '.png', fullPage: true });
            await page.locator('[data-reference=bars]').evaluate(card => card.dataset.captured = 'true');
        }
    }
    await page.setViewportSize({ width: 390, height: 1000 });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(page.locator('[data-reference=ring] svg')).toBeVisible();
    expect(errors).toEqual([]);
});

test('automatic theme colors stay automatic after filtering and save while chosen and inherited colors remain fixed', async ({ page }) => {
    const result = await page.evaluate(() => {
        const fixture = window.SoarFixture;
        const key = JSON.stringify(['category', 'severity', 'Low']);
        const normal = window.makeReferenceCard('normal', 'پیش‌فرض', 'bar');
        const savedDefault = fixture.persistedPresentationSettings(normal.settings);
        const custom = window.makeReferenceCard('custom', 'انتخاب کاربر', 'bar', window.barData, { series_colors: { [key]: '#e84d8a' } });
        const savedCustom = fixture.persistedPresentationSettings(custom.settings);
        const filtered = window.makeReferenceCard('filtered', 'فیلترشده', 'bar', { ...window.barData, rows: [window.barData.rows[2]] },
            { _series_colors: { ...normal.settings._series_colors }, _series_color_indexes: { ...normal.settings._series_color_indexes } });
        const legacy = window.makeReferenceCard('legacy', 'رنگ قدیمی انتخاب‌شده', 'bar', window.barData, { color: '#e84d8a' });
        const defaultColor = window.makeReferenceCard('false-flag', 'رنگ پیش‌فرض ذخیره‌شده', 'bar', window.barData, { color: '#e9ecf3', color_custom: false });
        const inherited = fixture.captureDrillPresentation({ display: 'bar', settings: normal.settings }, { series_key: key, color: '#e84d8a', series_colors: { [key]: '#e84d8a' } });
        window.applyReferenceTheme('dark');
        const reopened = window.makeReferenceCard('reopened', 'بازگشایی', 'bar', window.barData, { ...savedDefault });
        const picker = fixture.nativeFormMethods.visualizationPanel.call({ vizDraft: { color: '#e9ecf3', color_custom: false }, vizDisplay: 'bar', vizResult: window.barData, vizColumns: window.barData.columns, root: document.querySelector('#analytics-studio'), nativeForm: (_kind, data) => data });
        const first = card => card.chart.getDatasetMeta(0).data[0].options.backgroundColor;
        return { savedDefault, savedCustom, picker: picker.color, filtered: first(filtered), legacy: first(legacy), automatic: first(defaultColor), reopened: first(reopened),
            inherited: fixture.persistedPresentationSettings(inherited.settings).series_colors[key] };
    });
    expect(result.savedDefault).not.toHaveProperty('series_colors');
    expect(result.savedDefault).not.toHaveProperty('_series_color_indexes');
    expect(result.savedCustom.series_colors).toEqual({ [JSON.stringify(['category', 'severity', 'Low'])]: '#e84d8a' });
    expect(result).toMatchObject({ filtered: '#ca98ff', legacy: '#e84d8a', automatic: '#680dc9', reopened: '#680dc9', inherited: '#e84d8a', picker: '#680dc9' });
});


test('clickable number cards keep the card surface on hover and keyboard focus', async ({ page }) => {
    await page.evaluate(() => {
        const result = { columns: [{ key: 'amount', label: 'Amount', type: 'number' }], rows: [{ amount: 3212691 }], meta: {} };
        const item = window.makeReferenceCard('number-hover', 'Average order value', 'number', result);
        window.numberDrills = [];
        window.SoarFixture.visualize(item.body, result, 'number', {}, (row, context) => window.numberDrills.push({ value: row.amount, column: context.column_key }));
    });
    const stat = page.locator('[data-reference="number-hover"] .mb-stat');
    for (const mode of ['light', 'dark']) {
        await page.evaluate(mode => window.applyReferenceTheme(mode), mode);
        await stat.hover();
        await expect(stat).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
        await stat.focus();
        await expect(stat).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
        await expect(stat).toHaveCSS('outline-style', 'solid');
        await page.keyboard.press('Enter');
    }
    expect(await page.evaluate(() => window.numberDrills)).toEqual([
        { value: 3212691, column: 'amount' }, { value: 3212691, column: 'amount' },
    ]);
});
