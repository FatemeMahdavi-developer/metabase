import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { build } from 'esbuild';
import { panelFontCss, awaitPanelFonts } from './helpers/panel-fonts.js';

let fixture, styles, component;
test.beforeAll(async () => {
    fixture = JSON.parse(execFileSync(path.resolve('../.tools/php/php.exe'), ['tests/Browser/helpers/export-filter-selects.php'], { encoding: 'utf8', timeout: 60000 }).replace(/^\uFEFF/,''));
    const bundle=await build({stdin:{resolveDir:process.cwd(),contents:[
        'import {Alpine} from "./vendor/livewire/livewire/dist/livewire.esm.js";',
        'import select from "./public/js/filament/forms/components/select.js";',
        'import {soarFloatingField} from "./resources/js/filament-forms.js";',
        'window.Alpine=Alpine;Alpine.data("selectFormComponent",select);Alpine.data("soarFloatingField",soarFloatingField);',
        'Alpine.magic("wire",()=>({getFormSelectOptions:async()=>window.fixtureSelectOptions,getFormSelectOptionLabel:async()=>window.fixtureSelectOptions.find(option=>option.value==="none")?.label,$get:()=>"none",$entangle:()=>Alpine.interceptor(()=>"none",object=>Object.defineProperty(object,"live",{get(){return object;}}))()}));',
        'Alpine.start();',
    ].join('\n')},bundle:true,write:false,format:'iife'});
    component=bundle.outputFiles[0].text;
    const built = path.resolve('public/build');
    const manifest = JSON.parse(fs.readFileSync(path.join(built, 'manifest.json'), 'utf8'));
    styles = ['../css/filament/support/support.css', '../css/filament/forms/forms.css', '../css/filament/filament/app.css',
        manifest['resources/css/panel-theme.css'].file, ...manifest['resources/js/analytics.js'].css]
        .map(file => fs.readFileSync(path.join(built, file), 'utf8')).join('\n');
});

test('Filament dashboard selects and native table filters keep contained rounded focus indicators', async ({ page }, testInfo) => {
    await page.setContent('<html lang="fa" dir="rtl"><head>'+fixture.livewireStyles+'</head><body><main class="fi-main"><div class="fi-page">' + fixture.markup + '</div></main></body></html>');
    await page.addStyleTag({ content: styles });
    await page.addStyleTag({ content: fixture.palette + panelFontCss() + 'body{margin:0;padding:24px;background:var(--soar-page-bg)}.fi-modal-window{position:relative;width:min(100%,56rem);margin:auto;padding:24px;box-sizing:border-box}.fi-dropdown-panel{position:relative;width:min(100%,320px);margin:24px auto;padding:24px;box-sizing:border-box}' });
    await awaitPanelFonts(page);
    await page.evaluate(options=>{window.fixtureSelectOptions=options;},fixture.options);
    await page.addScriptTag({content:component});
    for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: 900 });
        for (const mode of ['light', 'dark']) {
            await page.locator('html').evaluate((el, mode) => el.classList.toggle('dark', mode === 'dark'), mode);
            const dashboard=page.locator('#dashboard-filter'),choices=dashboard.locator('.choices');
            await expect(choices).toHaveCount(1);
            await expect(dashboard.locator('select')).toBeHidden();
            await choices.locator('.choices__inner').click();
            await expect(choices.locator('.choices__list--dropdown')).toBeVisible();
            const enhanced=await choices.evaluate(node=>{
                const inner=node.querySelector('.choices__inner'),control=node.closest('.fi-input-wrp'),box=inner.getBoundingClientRect(),outer=control.getBoundingClientRect(),style=getComputedStyle(control);
                return {rounded:parseFloat(style.borderRadius)>0,contained:box.left>=outer.left-1&&box.right<=outer.right+1};
            });
            expect(enhanced).toEqual({rounded:true,contained:true});
            await choices.locator('.choices__item--choice[data-value="specific"]').click();
            await expect(dashboard.locator('select')).toHaveValue('specific');
            for (const id of ['database-filter']) {
                const select = page.locator('#' + id + ' select.fi-select-input');
                await expect(select).toBeVisible();
                await expect(page.locator('#' + id + ' .choices')).toHaveCount(0);
                await select.focus();
                await expect(select).toBeFocused();
                await expect(select).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
                await expect.poll(() => select.evaluate(el => getComputedStyle(el.closest(".fi-input-wrp")).boxShadow !== "none")).toBe(true);
                const focus = await select.evaluate(el => {
                    const s = getComputedStyle(el), wrapper = el.closest('.fi-input-wrp'), w = getComputedStyle(wrapper);
                    const inner = el.getBoundingClientRect(), outer = wrapper.getBoundingClientRect();
                    return {
                        background: s.backgroundColor, border: s.borderTopWidth, shadow: s.boxShadow, outline: s.outlineStyle,
                        roundedWrapper: parseFloat(w.borderRadius) > 0,
                        wrapperFocused: w.boxShadow !== 'none' || (w.outlineStyle !== 'none' && parseFloat(w.outlineWidth) > 0),
                        fits: inner.left >= outer.left - 1 && inner.right <= outer.right + 1 && inner.top >= outer.top - 1 && inner.bottom <= outer.bottom + 1,
                    };
                });
                expect(focus).toEqual({ background: 'rgba(0, 0, 0, 0)', border: '0px', shadow: 'none', outline: 'none', roundedWrapper: true, wrapperFocused: true, fits: true });
                const value = id === 'dashboard-filter' ? 'specific' : 'pgsql';
                await select.selectOption(value);
                await expect(select).toHaveValue(value);
            }
            await page.screenshot({ path: testInfo.outputPath('select-focus-' + mode + '-' + width + '.png') });
        }
    }
});
