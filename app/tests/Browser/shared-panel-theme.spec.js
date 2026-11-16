import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';
import { nativeTableTemplates } from './helpers/native-table-templates.js';

test('panel widget rules, theme tokens and vendor table styles also control the dashboard builder', async ({ page }) => {
    const built = path.resolve('public/build');
    const manifest = JSON.parse(fs.readFileSync(path.join(built, 'manifest.json'), 'utf8'));
    const css = file => fs.readFileSync(path.join(built, file), 'utf8');
    const bundle = await build({
        stdin: { contents: 'export * from "./resources/js/analytics/ui.js";', resolveDir: process.cwd() },
        bundle: true, write: false, format: 'iife', globalName: 'ThemeFixture',
    });
    await page.setContent('<html lang="fa" dir="rtl"><body><main class="fi-main-ctn"><span data-soar-dashboard-page></span><div class="soar-dashboard-widget"><section id="panel-widget" class="fi-section"><h2 class="fi-section-header-heading">Panel widget</h2></section></div><div class="fi-resource-list-records-page"><div id="panel-table"></div></div><section class="fi-page"><div id="analytics-studio"><article class="mb-card"><header class="mb-card-header"><span class="mb-card-title">Dashboard widget</span></header><div class="mb-card-body"><div id="chart"></div></div></article><div id="report-table"></div></div></section></main></body></html>');
    for (const file of ['../css/filament/support/support.css', '../css/filament/forms/forms.css', '../css/filament/filament/app.css', manifest['resources/css/panel-theme.css'].file]) {
        await page.addStyleTag({ content: css(file) });
    }
    const panelOverrides = await page.addStyleTag({ content: '/* shared panel overrides */' });
    for (const file of manifest['resources/js/analytics.js'].css) await page.addStyleTag({ content: css(file) });
    await page.addStyleTag({ content: '.fi-main-ctn{padding:16px!important}.mb-card{position:relative;height:280px;max-width:600px}#chart{height:180px}' });
    await page.locator('body').evaluate((body, html) => body.insertAdjacentHTML('beforeend', html), nativeTableTemplates());
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.evaluate(() => {
        const data = {
            columns: [{ key: 'category', label: 'Category', type: 'text' }, { key: 'value', label: 'Value', type: 'number' }],
            rows: [{ category: 'One', value: 15 }, { category: 'Two', value: 25 }],
            meta: {},
        };
        for (const id of ['panel-table', 'report-table']) window.ThemeFixture.mountTable(document.getElementById(id), data);
        window.sharedChart = window.ThemeFixture.visualize(document.getElementById('chart'), data, 'bar', {});
    });
    const appearance = () => page.evaluate(() => {
        const paint = selector => {
            const s = getComputedStyle(document.querySelector(selector));
            return { background: s.backgroundColor, color: s.color, border: s.borderTopColor, radius: s.borderRadius, shadow: s.boxShadow };
        };
        const table = id => ({
            header: paint(id + ' thead tr'),
            cell: paint(id + ' .fi-ta-cell'),
            label: paint(id + ' .fi-ta-text-item-label'),
            search: paint(id + ' .fi-input-wrp'),
            active: paint(id + ' .fi-pagination-item-label'),
            headerHeight: document.querySelector(id + ' thead').getBoundingClientRect().height,
        });
        return {
            panel: paint('#panel-widget'), card: paint('#analytics-studio .mb-card'),
            title: getComputedStyle(document.querySelector('.mb-card-title')).color,
            panelTitle: getComputedStyle(document.querySelector('#panel-widget h2')).color,
            native: table('#panel-table'), report: table('#report-table'),
        };
    });
    for (const mode of ['light', 'dark']) {
        await page.locator('html').evaluate((el, mode) => el.classList.toggle('dark', mode === 'dark'), mode);
        const before = await appearance();
        expect(before.card).toEqual(before.panel);
        expect(before.title).toEqual(before.panelTitle);
        expect(before.report).toEqual(before.native);
        expect(before.report.headerHeight).toBe(38);

        // Edit one common panel rule before the analytics stylesheet, as a theme edit would.
        await panelOverrides.evaluate(el => {
            el.textContent = '.dark body:not(:has(.fi-simple-layout)):not(:has(.glass-form)):not(:has([data-soar-auth-page])) .fi-ta-table tbody .fi-ta-cell .fi-ta-text-item-label, body:not(:has(.fi-simple-layout)):not(:has(.glass-form)):not(:has([data-soar-auth-page])) .fi-ta-table tbody .fi-ta-cell .fi-ta-text-item-label{color:rgb(10,120,80)!important}';
        });
        const after = await appearance();
        expect(after.report.label.color).toBe('rgb(10, 120, 80)');
        expect(after.report).toEqual(after.native);
        await panelOverrides.evaluate(el => el.textContent = '');
    }

    // Editing the actual shared widget rule changes both kinds of card.
    await page.evaluate(() => {
        const rules = sheets => [...sheets].flatMap(sheet => {
            try { return [...sheet.cssRules].flatMap(rule => [rule, ...(rule.cssRules?.length ? rules([rule]) : [])]); } catch { return []; }
        });
        const rule = rules(document.styleSheets).find(rule => rule.selectorText?.includes('.soar-dashboard-widget-full .fi-section') && rule.selectorText?.includes('#analytics-studio .mb-card'));
        if (!rule) throw new Error('Shared widget rule not found');
        window.originalWidgetRule = { rule, css: rule.style.cssText };
        rule.style.setProperty('background', 'rgb(90, 65, 125)', 'important');
        rule.style.setProperty('border-radius', '27px', 'important');
    });
    const afterRule = await appearance();
    expect(afterRule.card).toEqual(afterRule.panel);
    expect(afterRule.card.background).toBe('rgb(90, 65, 125)');
    expect(afterRule.card.radius).toBe('27px');
    await page.evaluate(() => window.originalWidgetRule.rule.style.cssText = window.originalWidgetRule.css);

    const changed = await page.evaluate(() => {
        document.documentElement.classList.remove('dark');
        const root = document.documentElement;
        root.style.setProperty('--soar-surface', '#edf8ef');
        root.style.setProperty('--soar-radius-lg', '26px');
        root.style.setProperty('--soar-text', '#123456');
        root.style.setProperty('--soar-chart-bar-1', '#b74283');
        window.sharedChart.$analyticsTheme();
        return window.sharedChart.getDatasetMeta(0).data[0].options.backgroundColor;
    });
    const afterTokens = await appearance();
    expect(afterTokens.card).toEqual(afterTokens.panel);
    expect(afterTokens.card.background).toBe('rgb(237, 248, 239)');
    expect(afterTokens.card.radius).toBe('26px');
    expect(afterTokens.title).toBe('rgb(18, 52, 86)');
    expect(afterTokens.title).toBe(afterTokens.panelTitle);
    expect(changed).toBe('#b74283');
});
