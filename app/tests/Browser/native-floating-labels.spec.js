import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { build } from 'esbuild';
import { panelFontCss, awaitPanelFonts } from './helpers/panel-fonts.js';

let markup, script, styles;
test.beforeAll(async () => {
    markup = execFileSync(path.resolve('../.tools/php/php.exe'), ['tests/Browser/helpers/export-floating-fields.php'], { encoding: 'utf8', timeout: 60000 });
    const bundle = await build({
        stdin: { contents: [
            'import { Livewire, Alpine } from "./vendor/livewire/livewire/dist/livewire.esm.js";',
            'import select from "./public/js/filament/forms/components/select.js";',
            'import { soarFloatingField } from "./resources/js/filament-forms.js";',
            'window.Livewire = Livewire; window.Alpine = Alpine;',
            'Alpine.data("selectFormComponent", select);',
            'Alpine.data("soarFloatingField", soarFloatingField);',
            'document.querySelectorAll("[x-load]").forEach(node => { node.removeAttribute("x-load"); node.removeAttribute("x-load-src"); });',
            'Livewire.start();',
            'window.dispatchEvent(new CustomEvent("open-modal", { detail:{id:"analytics-native-form"} }));',
        ].join('\n'), resolveDir: process.cwd() },
        bundle: true, write: false, format: 'iife',
    });
    script = bundle.outputFiles[0].text;
    const built = path.resolve('public/build'), manifest = JSON.parse(fs.readFileSync(path.join(built, 'manifest.json'), 'utf8'));
    styles = ['../css/filament/support/support.css', '../css/filament/forms/forms.css', '../css/filament/filament/app.css',
        manifest['resources/css/panel-theme.css'].file, ...manifest['resources/js/analytics.js'].css]
        .map(file => process.env.ANALYTICS_SOURCE_PANEL_CSS && file === manifest['resources/css/panel-theme.css'].file
            ? fs.readFileSync('resources/css/panel-theme.css','utf8')
            : fs.readFileSync(path.join(built,file),'utf8')).join('\n');
});

// Return a renderless Livewire acknowledgement while preserving real client state.
// Choices, entanglement, wire:model and the shared label factory all run unchanged.
function responseFor(payload) {
    const options = [{ value:'books', label:'Books', disabled:false }, { value:'clothing', label:'Clothing', disabled:false }, { value:'long', label:'A long category name that needs wrapping inside the field', disabled:false }];
    return { components: payload.components.map(component => {
        const snapshot = JSON.parse(component.snapshot);
        for (const [key, value] of Object.entries(component.updates)) {
            let data = snapshot.data;
            const keys = key.split('.');
            for (const part of keys.slice(0, -1)) {
                if (Array.isArray(data) && data[1]?.s) data = data[0];
                data = data[part];
            }
            if (Array.isArray(data) && data[1]?.s) data = data[0];
            data[keys.at(-1)] = value;
        }
        return {
            snapshot: JSON.stringify(snapshot),
            effects: { returns: component.calls.map(call => {
                if (call.method === 'getFormSelectOptions') return options;
                if (call.method === 'getFormSelectSearchResults') return options.filter(item => item.label.toLowerCase().includes(String(call.params[1] ?? '').toLowerCase()));
                if (call.method === 'getFormSelectOptionLabels') return options;
                if (call.method === 'getFormSelectOptionLabel') return 'Books';
                return null;
            }) },
        };
    }), assets: [] };
}

async function mount(page, mode, width) {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setViewportSize({ width, height: 1100 });
    await page.route('http://floating-fixture.test/**', async route => {
        if (route.request().method() === 'POST') return route.fulfill({ json: responseFor(route.request().postDataJSON()) });
        return route.fulfill({
            contentType: 'text/html; charset=utf-8',
            body: '<html lang="fa" dir="rtl" class="fi ' + (mode === 'dark' ? 'dark' : '') + '"><head><meta charset="utf-8"><script>window.livewireScriptConfig={uri:"/livewire/update",csrf:"fixture",nonce:"",progressBar:true};</script></head><body><main class="fi-main-ctn fi-page">' + markup + '</main></body></html>',
        });
    });
    await page.goto('http://floating-fixture.test/');
    await page.addStyleTag({ content: styles });
    await page.addStyleTag({ content: ':root{--primary-50:239,246,255;--primary-600:58,77,233;--primary-400:129,140,248;--gray-200:229,231,235;--gray-400:156,163,175;--gray-500:107,114,128;--gray-700:55,65,81;--gray-950:3,7,18}body{margin:0;background:var(--soar-page-bg)}#analytics-studio{min-height:0}' });
    await page.addStyleTag({content:panelFontCss()});
    await awaitPanelFonts(page);
    await page.addScriptTag({ content: script });
    const form = page.locator('#analytics-native-form-body');
    await expect(form).toBeVisible();
    await expect(form.locator('.choices')).toHaveCount(4);
    await expect(form.locator('[data-fixture-field="text"] input')).toBeFocused();
    await page.evaluate(() => document.activeElement?.blur());
    return { form, errors };
}

const field = (form, name) => form.locator('[data-fixture-field="' + name + '"]');
const blur = page => page.evaluate(() => document.activeElement?.blur());
async function offset(wrapper) {
    return wrapper.evaluate(node => {
        const label = node.querySelector('.fi-fo-field-wrp-label').getBoundingClientRect();
        const control = (node.querySelector('.fi-input-wrp') || node.querySelector('textarea')).getBoundingClientRect();
        return { center: label.top + label.height / 2 - control.top, height: control.height };
    });
}
async function floating(wrapper) {
    await expect.poll(async () => Math.abs((await offset(wrapper)).center)).toBeLessThan(2);
}
async function resting(wrapper) {
    await expect.poll(async () => {
        const { center, height } = await offset(wrapper);
        return Math.abs(center - Math.min(height, 40) / 2);
    }).toBeLessThan(2);
}

for (const mode of ['light', 'dark']) for (const width of [1440, 390]) {
    test('Vendor floating labels follow empty, focused and selected state: ' + mode + ' ' + width, async ({ page }, testInfo) => {
        const { form, errors } = await mount(page, mode, width);
        const text = field(form, 'text'), native = field(form, 'native'), single = field(form, 'choices'), multiple = field(form, 'multiple');
        const textarea = field(form, 'textarea'), zero = field(form, 'zero');

        for (const wrapper of [text, native, single, multiple, textarea]) {
            await expect(wrapper).toHaveClass(/soar-floating-field/);
            await expect(wrapper).not.toHaveClass(/soar-floating-has-value/);
            await resting(wrapper);
        }
        await expect(field(form, 'toggle')).not.toHaveClass(/soar-floating-field/);
        await expect(zero.locator('input')).toHaveValue('0');
        await expect(zero).toHaveClass(/soar-floating-has-value/);
        await floating(zero);

        for (const [wrapper, input] of [[text, text.locator('input')], [textarea, textarea.locator('textarea')]]) {
            await input.focus();
            await floating(wrapper);
            await input.fill('Dashboard label');
            await blur(page);
            await expect(wrapper).toHaveClass(/soar-floating-has-value/);
            await floating(wrapper);
            await input.fill('');
            await blur(page);
            await expect(wrapper).not.toHaveClass(/soar-floating-has-value/);
            await resting(wrapper);
        }

        const nativeChoice = native.locator('.choices');
        await nativeChoice.locator('.choices__inner').click();
        await floating(native);
        await nativeChoice.locator('.choices__item--choice[data-value="asc"]').click();
        await blur(page);
        await expect(native).toHaveClass(/soar-floating-has-value/);
        await floating(native);
        await page.evaluate(() => window.Livewire.find(document.querySelector('[wire\\:id]').getAttribute('wire:id')).$set('workbenchData.direction',null,false));
        await blur(page);
        await expect(native).not.toHaveClass(/soar-floating-has-value/);
        await resting(native);

        await single.locator('.choices__inner').click();
        await floating(single);
        const search = single.locator('.choices__input--cloned');
        await search.fill('Books');
        await search.press('Enter');
        await expect(single.locator('.choices__list--single')).toContainText('Books');
        await blur(page);
        await expect(single).toHaveClass(/soar-floating-has-value/);
        await floating(single);
        // Required select has no clear button; reset through Livewire as a source change does.
        await page.evaluate(() => window.Livewire.find(document.querySelector('[wire\\:id]').getAttribute('wire:id')).$set('workbenchData.report_id', null, false));
        await blur(page);
        await expect(single).not.toHaveClass(/soar-floating-has-value/);
        await resting(single);

        for (const label of ['Books', 'Clothing']) {
            await multiple.locator('.choices__inner').click();
            const search = multiple.locator('.choices__input--cloned');
            await search.fill(label);
            await expect(multiple.locator('.choices__item--choice:visible').filter({ hasText:label })).toHaveCount(1);
            await search.press('Enter');
        }
        await expect(multiple.locator('.choices__list--multiple > .choices__item')).toHaveCount(2);
        await blur(page);
        await expect(multiple).toHaveClass(/soar-floating-has-value/);
        await floating(multiple);
        const geometry = await multiple.evaluate(wrapper => {
            const inner = wrapper.querySelector('.choices__inner'), list = wrapper.querySelector('.choices__list--multiple');
            const search = wrapper.querySelector('.choices__input--cloned'), label = wrapper.querySelector('.fi-fo-field-wrp-label');
            const box = inner.getBoundingClientRect(), input = search.getBoundingClientRect();
            const range = document.createRange(); range.selectNodeContents(label.querySelector('span'));
            const title = range.getBoundingClientRect();
            const overlaps = r => Math.min(r.right,title.right)-Math.max(r.left,title.left)>1 && Math.min(r.bottom,title.bottom)-Math.max(r.top,title.top)>1;
            const style = node => {
                const s = getComputedStyle(node);
                return {display:s.display,width:s.width,minWidth:s.minWidth,height:s.height,minHeight:s.minHeight,padding:s.padding,font:s.font,flex:s.flex,flexWrap:s.flexWrap,background:s.backgroundColor,color:s.color};
            };
            const chips = [...list.children].map(node => {
                const r = node.getBoundingClientRect();
                return {top:r.top,bottom:r.bottom,left:r.left,right:r.right,...style(node)};
            });
            return {inner:style(inner),list:style(list),input:style(search),chips,
                sameRow:Math.abs(chips[0].top-chips[1].top)<2,
                searchSameRow:Math.abs((input.top+input.bottom)/2-(chips[0].top+chips[0].bottom)/2)<5,
                chipsFit:chips.every(r => r.left >= box.left-1 && r.right <= box.right+1 && r.bottom <= box.bottom+1),
                inputFits:input.left >= box.left-1 && input.right <= box.right+1 && input.bottom <= box.bottom+1,
                labelClear:!chips.some(overlaps),
                labelBox:{top:title.top,bottom:title.bottom,left:title.left,right:title.right},
                innerBox:{top:box.top,bottom:box.bottom,height:box.height},
                inputBox:{top:input.top,bottom:input.bottom,left:input.left,right:input.right},
            };
        });
        if (process.env.ANALYTICS_CAPTURE_CHIP_BASELINE) console.log('MULTISELECT_BASELINE ' + JSON.stringify(geometry));
        await testInfo.attach('multiselect-geometry',{body:JSON.stringify(geometry,null,2),contentType:'application/json'});
        expect(geometry.chipsFit).toBe(true);
        expect(geometry.inputFits).toBe(true);
        expect(geometry.labelClear).toBe(true);
        if (width === 1440) {
            expect(geometry.sameRow).toBe(true);
            expect(geometry.searchSameRow).toBe(true);
        }
        for (const chip of geometry.chips) {
            const rgb = chip.color.match(/[\d.]+/g).map(Number);
            expect(rgb[2] - rgb[0], 'Vendor chips use the blue panel primary instead of a purple pill override').toBeGreaterThan(20);
            expect(chip.background).not.toBe('rgb(173, 107, 250)');
        }
        // A long selected category must wrap inside the same control on narrow screens.
        await page.evaluate(() => window.Livewire.find(document.querySelector('[wire\\:id]').getAttribute('wire:id'))
            .$set('workbenchData.suggestions',['books','clothing','long'],false));
        await expect(multiple.locator('.choices__list--multiple > .choices__item')).toHaveCount(3);
        await expect(multiple.locator('.choices__list--multiple')).toContainText('A long category name that needs wrapping inside the field');
        await expect.poll(() => multiple.evaluate(wrapper => {
            const box = wrapper.querySelector('.choices__inner').getBoundingClientRect();
            return [...wrapper.querySelectorAll('.choices__list--multiple > .choices__item')].every(node => {
                const r = node.getBoundingClientRect();
                return r.left >= box.left-1 && r.right <= box.right+1 && r.bottom <= box.bottom+1;
            });
        })).toBe(true);
        await multiple.scrollIntoViewIfNeeded();
        // Use the Vendor outer scroll container; a fixture height cap would let
        // the form paint past the modal border instead of testing real behavior.
        await expect.poll(() => form.evaluate(node => {
            const window = node.closest('.fi-modal-window').getBoundingClientRect();
            const content = node.getBoundingClientRect();
            return content.top >= window.top - 1 && content.bottom <= window.bottom + 1;
        })).toBe(true);
        await page.screenshot({path:testInfo.outputPath('multiselect-selected-' + mode + '-' + width + '.png'),fullPage:true});

        while (await multiple.locator('.choices__list--multiple button').count()) {
            await multiple.locator('.choices__list--multiple button').first().click();
        }
        await blur(page);
        await expect(multiple).not.toHaveClass(/soar-floating-has-value/);
        await resting(multiple);

        const nestedInput = field(form, 'nested').locator('input[wire\\:model$=".default"]');
        const nested = nestedInput.locator('xpath=ancestor::*[@data-field-wrapper][1]');
        await expect(nested).toHaveClass(/soar-floating-field/);
        const requiredInput = field(form,'nested').locator('input[wire\\:model$=".key"]');
        await expect(requiredInput.locator('xpath=ancestor::*[contains(concat(" ",normalize-space(@class)," ")," fi-input-wrp ")][1]')).toHaveCSS('border-inline-start-width','2px');
        await expect(nestedInput.locator('xpath=ancestor::*[contains(concat(" ",normalize-space(@class)," ")," fi-input-wrp ")][1]')).not.toHaveCSS('border-inline-start-width','2px');
        await resting(nested);
        await nestedInput.fill('Nested value');
        await blur(page);
        await expect(nested).toHaveClass(/soar-floating-has-value/);
        await floating(nested);

        await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await text.scrollIntoViewIfNeeded();
        await page.screenshot({ path:testInfo.outputPath('floating-fields-' + mode + '-' + width + '.png'), fullPage:true });

        // The shared panel rule remains the single source of input radius.
        await page.evaluate(() => {
            const update = rules => [...rules].forEach(rule => {
                if (rule.cssRules) update(rule.cssRules);
                if (rule.selectorText?.includes('.soar-form-modal') && rule.style.getPropertyValue('border-radius') === '17px') rule.style.setProperty('border-radius', '18px', 'important');
            });
            [...document.styleSheets].forEach(sheet => update(sheet.cssRules));
        });
        await expect(text.locator('.fi-input-wrp')).toHaveCSS('border-radius', '18px');
        expect(errors).toEqual([]);
    });
}
