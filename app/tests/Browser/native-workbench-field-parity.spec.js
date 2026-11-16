import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { build } from 'esbuild';
import { panelFontCss, awaitPanelFonts } from './helpers/panel-fonts.js';

let fixture, styles, component;
test.use({ trace: 'off' });
test.beforeAll(async () => {
    fixture = JSON.parse(execFileSync(path.resolve('../.tools/php/php.exe'), ['tests/Browser/helpers/export-workbench-fields.php'], { encoding: 'utf8', timeout: 60000, maxBuffer: 2 * 1024 * 1024 }).replace(/^\uFEFF/, ''));
    const bundle = await build({
        stdin: { contents: [
            'import { Alpine } from "./vendor/livewire/livewire/dist/livewire.esm.js";',
            'import select from "./public/js/filament/forms/components/select.js";',
            'import textarea from "./public/js/filament/forms/components/textarea.js";',
            'export { searchField } from "./resources/js/analytics/ui.js";',
            'import { soarFloatingField } from "./resources/js/filament-forms.js";',
            'import { expressionEditorMethods } from "./resources/js/analytics/expression-editor.js";',
            'import { nativeFormMethods } from "./resources/js/analytics/native-forms.js";',
            'window.Alpine = Alpine;',
            'Alpine.data("soarFloatingField", soarFloatingField);',
            'const fieldState = Alpine.reactive({ name:"Sample", connection_id:"1", source:"public.demo", copy_reports:false, content:"Sample text", direction:"asc", limit:100, label:"Calculated value", expression:"[" });',
            'Alpine.data("selectFormComponent", select);',
            'Alpine.data("textareaFormComponent", textarea);',
            // Exercise Vendor Alpine/Choices locally; server validation is covered by Livewire feature tests.
            'Alpine.magic("wire", () => ({',
            '$get(path) { return fieldState[path.split(".").pop()]; },',
            '$entangle(path) { const key = path.split(".").pop(); const value = ({connection_id:"1",source:"public.demo",copy_reports:false,content:"Sample text"})[key]; return Alpine.interceptor(() => value, object => Object.defineProperty(object,"live",{get(){return object}}))(); },',
            'getFormSelectOptions: async () => [{value:"public.demo",label:"نمونه",disabled:false}],',
            'getFormSelectOptionLabel: async () => "نمونه",',
            'getFormSelectOptionLabels: async () => [],',
            'getFormSelectSearchResults: async () => [],',
            '}));',
            'Alpine.start();',
            'window.expressionFixture = Object.assign({ root:document.querySelector("#analytics-studio"),nativeFormPending:{kind:"expression"},expressionEditorContext:{fields:[{key:"revenue",label:"Revenue",type:"number"},{key:"cost",label:"Cost",type:"number"}]},expressionSuggestionIndex:0 },expressionEditorMethods,{expressionEditorTextarea:nativeFormMethods.expressionEditorTextarea,expressionEditorKeydown:nativeFormMethods.expressionEditorKeydown});',
            'document.querySelector("#expression-fields").addEventListener("keydown",event=>window.expressionFixture.expressionEditorKeydown(event));',
            'document.querySelector("[data-expression-suggestions]").addEventListener("click",event=>{const target=event.target.closest("[data-action=acceptExpressionSuggestion]");if(target)window.expressionFixture.acceptExpressionSuggestion(target);});',
        ].join('\n'), resolveDir: process.cwd() },
        bundle: true, write: false, format: 'iife', globalName: 'NativeFields',
    });
    component = bundle.outputFiles[0].text;
    const built = path.resolve('public/build'), manifest = JSON.parse(fs.readFileSync(path.join(built, 'manifest.json'), 'utf8'));
    console.log('Shared options assets: ' + manifest['resources/css/panel-theme.css'].file + ' / ' + manifest['resources/js/analytics.js'].css.join(','));
    styles = ['../css/filament/support/support.css', '../css/filament/forms/forms.css', '../css/filament/filament/app.css',
        manifest['resources/css/panel-theme.css'].file, ...manifest['resources/js/analytics.js'].css]
        .map(file => fs.readFileSync(path.join(built, file), 'utf8')).join('\n');
});

test('workbench fields use the same panel rules as Vendor resource forms', async ({ page }, testInfo) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setContent('<html lang="fa" dir="rtl"><head>' + fixture.livewireStyles + '</head><body><main class="fi-main-ctn fi-page">' + fixture.markup + '</main></body></html>');
    await page.addStyleTag({ content: styles });
    await page.addStyleTag({ content: fixture.palette + panelFontCss() + 'body{margin:0;padding:24px;background:var(--soar-page-bg)}.fi-main-ctn{padding:0!important}.fixture-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:24px}.fixture-grid .fi-modal-window:has(>form){position:relative!important;width:100%!important;max-height:none!important;height:auto!important;padding:24px!important;overflow:visible!important}.soar-form-modal{min-width:0}#analytics-studio{min-height:0}@media(max-width:700px){body{padding:12px}.fixture-grid{grid-template-columns:minmax(0,1fr)}}' });
    await awaitPanelFonts(page);
    await page.addScriptTag({ content: component });
    await expect(page.locator('#workbench-fields .choices')).toHaveCount(3);
    await expect(page.locator('#reference-fields .choices')).toHaveCount(3);
    await expect(page.locator('#workbench-fields .choices__list--single').first()).toContainText('unisq');
    const diff = () => page.evaluate(() => {
        const collect = id => {
            const root = document.getElementById(id);
            const paint = selector => {
                const el = root.querySelector(selector), s = getComputedStyle(el);
                return Object.fromEntries(['backgroundColor','borderRadius','borderTopColor','borderTopWidth','boxShadow','font','padding','height'].map(key => [key,s[key]]));
            };
            return {
                name: paint('.fi-fo-text-input'), input: paint('.fi-fo-text-input input'),
                select: paint('.fi-fo-select'), choices: paint('.choices__inner'),
                textarea: paint('textarea'), nonsearchable: paint('.fi-fo-select:has(select[id$=".direction"]) .choices__inner'),
                label: paint('.fi-fo-field-wrp-label'),
            };
        };
        const actual = collect('workbench-fields'), reference = collect('reference-fields');
        return Object.fromEntries(Object.keys(actual).filter(key => JSON.stringify(actual[key]) !== JSON.stringify(reference[key])).map(key => [key,{actual:actual[key],reference:reference[key]}]));
    });
    const optionPaint = () => page.locator('#workbench-fields').evaluate(root => {
        const probe = document.createElement('i');
        probe.style.cssText = 'position:fixed;visibility:hidden;background:var(--soar-select-option-highlight-bg);color:var(--soar-select-option-highlight-text)';
        root.append(probe);
        const highlight = { background:getComputedStyle(probe).backgroundColor, color:getComputedStyle(probe).color };
        probe.style.background = 'var(--soar-select-option-selected-bg)';
        probe.style.color = document.documentElement.classList.contains('dark') ? 'var(--cm-text)' : 'rgb(var(--gray-950))';
        const selected = { background:getComputedStyle(probe).backgroundColor, color:getComputedStyle(probe).color };
        probe.remove();
        return { highlight, selected };
    });
    const assertChoicesOptionColors = async (formId, screenshot) => {
        const expected = await optionPaint();
        const choices = page.locator('#' + formId + ' .choices').first();
        await choices.click();
        const search = choices.locator('.choices__input--cloned');
        const selected = choices.locator('.choices__item--choice.is-selected');
        const alternative = choices.locator('.choices__item--choice').filter({ hasText: 'warehouse' });
        await expect(search).toBeVisible();
        await expect(selected).toHaveText('unisq');

        // Pointer and keyboard navigation must consume the same shared panel rules.
        await alternative.hover();
        await expect(alternative).toHaveClass(/is-highlighted/);
        await expect(alternative).toHaveCSS('background-color', expected.highlight.background);
        await expect(alternative).toHaveCSS('color', expected.highlight.color);
        await expect(selected).toHaveCSS('background-color', expected.selected.background);
        await expect(selected).toHaveCSS('color', expected.selected.color);

        await page.mouse.move(0, 0);
        await search.press('ArrowUp');
        await expect(selected).toHaveClass(/is-highlighted/);
        await expect(selected).toHaveCSS('background-color', expected.highlight.background);
        await expect(selected).toHaveCSS('color', expected.highlight.color);
        await search.press('ArrowDown');
        await expect(alternative).toHaveClass(/is-highlighted/);
        await expect(alternative).toHaveCSS('background-color', expected.highlight.background);
        await expect(selected).toHaveCSS('background-color', expected.selected.background);
        if (screenshot) await choices.locator('.choices__list--dropdown').screenshot({path:testInfo.outputPath(screenshot)});
        await search.press('Escape');
        await expect(choices.locator('.choices__list--dropdown')).not.toBeVisible();
    };
    const resetExpression = () => page.evaluate(() => {
        const editor = window.expressionFixture.expressionEditorTextarea();
        editor.value = '[';
        editor.focus();
        editor.setSelectionRange(1,1);
        window.expressionFixture.expressionSuggestionIndex = 0;
        window.expressionFixture.updateExpressionSuggestions();
    });
    const assertExpressionOptionColors = async () => {
        const expected = await optionPaint();
        const editor = page.locator('[data-expression-editor]');
        const options = page.locator('[data-expression-suggestions] > [role="option"]');
        await resetExpression();
        await expect(options).toHaveCount(2);
        await expect(options.nth(0)).toHaveAttribute('aria-selected','true');
        await expect(options.nth(0)).toHaveCSS('background-color',expected.highlight.background);
        await options.nth(1).hover();
        await expect(options.nth(1)).toHaveCSS('background-color',expected.highlight.background);
        await expect(options.nth(1)).toHaveCSS('color',expected.highlight.color);
        await page.mouse.move(0,0);
        await editor.press('ArrowDown');
        await expect(options.nth(1)).toHaveAttribute('aria-selected','true');
        await expect(options.nth(1)).toHaveCSS('background-color',expected.highlight.background);
        await expect(options.nth(1)).toHaveCSS('color',expected.highlight.color);
        await editor.press('Enter');
        await expect(editor).toHaveValue('[Cost]');
        await expect(page.locator('[data-expression-suggestions]')).toBeHidden();
        await resetExpression();
        await editor.press('Escape');
        await expect(page.locator('[data-expression-suggestions]')).toBeHidden();
        await resetExpression();
        await options.nth(0).click();
        await expect(editor).toHaveValue('[Revenue]');
        await expect(page.locator('[data-expression-suggestions]')).toBeHidden();
    };
    for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: 1100 });
        for (const mode of ['light', 'dark']) {
            await page.locator('html').evaluate((el, mode) => el.classList.toggle('dark', mode === 'dark'), mode);
            await page.mouse.move(0, 0);
            await page.evaluate(() => document.activeElement?.blur());
            await expect.poll(diff).toEqual({});
            await assertChoicesOptionColors('workbench-fields', 'options-' + mode + '-' + width + '.png');
            await assertChoicesOptionColors('reference-fields');
            await assertExpressionOptionColors();
            console.log('Shared options ' + mode + '/' + width + ': ' + JSON.stringify(await optionPaint()));
            const name = page.locator('#workbench-fields input').first();
            await name.fill('نام داشبورد');
            await expect(name).toHaveValue('نام داشبورد');
            await page.locator('#workbench-fields textarea').fill('Sample dashboard text');
            await expect(page.locator('#workbench-fields textarea')).toHaveValue('Sample dashboard text');
            await name.focus();
            await expect(name).toHaveCSS('outline-style', 'none');
            const choices = page.locator('#workbench-fields .choices').first();
            await choices.click();
            const search = choices.locator('.choices__input--cloned');
            await expect(search).toBeVisible();
            await search.fill('');
            await search.pressSequentially('warehouse');
            await expect(choices.locator('.choices__item--choice:visible')).toHaveText(['warehouse']);
            await search.press('Enter');
            await expect(choices.locator('.choices__list--single')).toContainText('warehouse');
            await page.locator('#workbench-fields [role="switch"]').click();
            await expect(page.locator('#workbench-fields [role="switch"]')).toHaveAttribute('aria-checked', 'true');
            await page.locator('#workbench-fields [role="switch"]').click();
            await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
            await page.screenshot({ path: testInfo.outputPath('native-fields-' + mode + '-' + width + '.png'), fullPage: true });
            // Restore the same choice for the next responsive comparison.
            await choices.click();
            await search.fill('');
            await search.pressSequentially('unisq');
            await search.press('Enter');
        }
    }
    // Mutate the existing shared rule in-place, with Analytics CSS still later in the cascade.
    // Appending a new override would hide the duplicate-rule regression this checks.
    const sharedRuleCount = await page.evaluate(() => {
        const found = [];
        const visit = rules => [...rules].forEach(rule => {
            if (rule.cssRules) visit(rule.cssRules);
            if (rule.selectorText?.includes('.choices__item--choice.is-highlighted') && rule.selectorText.includes('[role=')) found.push(rule);
        });
        [...document.styleSheets].forEach(sheet => visit(sheet.cssRules));
        window.originalSharedOptionRules = found.map(rule => ({rule,css:rule.style.cssText}));
        found.forEach(rule => {rule.style.setProperty('background','rgb(12, 84, 62)','important');rule.style.setProperty('color','rgb(255, 246, 211)','important');});
        return found.length;
    });
    expect(sharedRuleCount).toBe(1);
    for (const formId of ['workbench-fields','reference-fields']) {
        const choices = page.locator('#' + formId + ' .choices').first();
        await choices.click();
        const option = choices.locator('.choices__item--choice').filter({hasText:'warehouse'});
        await option.hover();
        await expect(option).toHaveCSS('background-color','rgb(12, 84, 62)');
        await expect(option).toHaveCSS('color','rgb(255, 246, 211)');
        await choices.locator('.choices__input--cloned').press('Escape');
    }
    await resetExpression();
    const expressionOption = page.locator('[data-expression-suggestions] > [aria-selected="true"]');
    await expect(expressionOption).toHaveCSS('background-color','rgb(12, 84, 62)');
    await expect(expressionOption).toHaveCSS('color','rgb(255, 246, 211)');
    await page.evaluate(() => window.originalSharedOptionRules.forEach(({rule,css}) => {rule.style.cssText=css;}));
    // Root token updates also reach both genuine Choices and custom completion options.
    await page.evaluate(() => {
        document.documentElement.style.setProperty('--soar-select-option-highlight-bg','rgb(79, 48, 25)');
        document.documentElement.style.setProperty('--soar-select-option-highlight-text','rgb(250, 229, 199)');
    });
    await assertChoicesOptionColors('workbench-fields');
    await assertChoicesOptionColors('reference-fields');
    await assertExpressionOptionColors();
    await page.evaluate(() => {
        document.documentElement.style.removeProperty('--soar-select-option-highlight-bg');
        document.documentElement.style.removeProperty('--soar-select-option-highlight-text');
    });
    await page.evaluate(() => {
        const update = rules => [...rules].forEach(rule => {
            if (rule.cssRules) update(rule.cssRules);
            if (rule.selectorText?.includes('.soar-form-modal') && rule.style.getPropertyValue('border-radius') === '17px') {
                rule.style.setProperty('border-radius', '18px', 'important');
            }
        });
        [...document.styleSheets].forEach(sheet => update(sheet.cssRules));
    });
    await expect(page.locator('#workbench-fields .fi-fo-text-input').first()).toHaveCSS('border-radius', '18px');
    await expect(page.locator('#reference-fields .fi-fo-text-input').first()).toHaveCSS('border-radius', '18px');
    await page.evaluate(() => {
        const host = document.getElementById('client-searches');
        host.innerHTML = NativeFields.searchField('data-search','جست‌وجو','"><script>unsafe</script>');
        window.lastSearch = null;
        host.addEventListener('input', event => window.lastSearch = event.target.value);
    });
    await expect(page.locator('#client-searches .fi-input-wrp')).toHaveCount(1);
    await expect(page.locator('#client-searches input.fi-input')).toHaveValue('"><script>unsafe</script>');
    await expect(page.locator('#client-searches script')).toHaveCount(0);
    await page.locator('#client-searches input').fill('نمونه');
    expect(await page.evaluate(() => window.lastSearch)).toBe('نمونه');
    expect(errors).toEqual([]);
});
