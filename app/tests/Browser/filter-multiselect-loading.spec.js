import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { build } from 'esbuild';

let markup, script, styles;
test.beforeAll(async () => {
    markup = execFileSync(path.resolve('../.tools/php/php.exe'), ['tests/Browser/helpers/export-filter-loading.php'], { encoding: 'utf8', timeout: 60000 });
    const bundle = await build({
        stdin: { contents: [
            'import { Livewire, Alpine } from "./vendor/livewire/livewire/dist/livewire.esm.js";',
            'import select from "./public/js/filament/forms/components/select.js";',
            'import "./resources/js/filament-forms.js";',
            'window.Livewire = Livewire; window.Alpine = Alpine;',
            'Alpine.data("selectFormComponent", select);',
            // The component is already bundled locally; preserve all production wire directives.
            'document.querySelectorAll("[x-load]").forEach(node => { node.removeAttribute("x-load"); node.removeAttribute("x-load-src"); });',
            'window.fixtureCompleted = 0; Livewire.hook("commit", ({succeed}) => succeed(() => { window.fixtureCompleted++; }));',
            'Livewire.start();',
            'window.dispatchEvent(new CustomEvent("open-modal", {detail:{id:"analytics-native-form"}}));',
        ].join('\n'), resolveDir: process.cwd() },
        bundle: true, write: false, format: 'iife',
    });
    script = bundle.outputFiles[0].text;
    const built = path.resolve('public/build'), manifest = JSON.parse(fs.readFileSync(path.join(built, 'manifest.json'), 'utf8'));
    styles = ['../css/filament/support/support.css', '../css/filament/forms/forms.css', '../css/filament/filament/app.css',
        manifest['resources/css/panel-theme.css'].file, ...manifest['resources/js/analytics.js'].css]
        .map(file => fs.readFileSync(path.join(built, file), 'utf8')).join('\n');
});

function responseFor(payload) {
    return { components: payload.components.map(component => {
        const snapshot = JSON.parse(component.snapshot);
        // Keep the response state aligned with the real client commit, without a server/account.
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
        return { snapshot: JSON.stringify(snapshot), effects: { returns: component.calls.map(() => null) } };
    }), assets: [] };
}

async function fixture(page, previousTarget = false) {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const requests = [];
    await page.route('http://filter-fixture.test/**', async route => {
        if (route.request().method() !== 'POST') {
            const html = previousTarget
                ? markup.replace('wire:target="submitWorkbenchForm,workbenchCommand"', 'wire:target="workbenchData,submitWorkbenchForm,workbenchCommand"')
                : markup;
            await route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<html lang="fa" dir="rtl" class="dark"><head><meta charset="utf-8"><script>window.livewireScriptConfig={uri:"/livewire/update",csrf:"fixture",nonce:"",progressBar:true};</script></head><body><main class="fi-main-ctn fi-page">' + html + '</main></body></html>' });
            return;
        }
        const payload = route.request().postDataJSON();
        let release;
        const wait = new Promise(resolve => { release = resolve; });
        requests.push({ payload, release });
        await wait;
        await route.fulfill({ json: responseFor(payload) });
    });
    await page.goto('http://filter-fixture.test/');
    await page.addStyleTag({ content: styles });
    await page.addScriptTag({ content: script });
    const form = page.locator('#analytics-native-form-body');
    await expect(form).toBeVisible();
    await expect(form.locator('.choices')).toHaveCount(2, {timeout:10000});
    return { form, requests, errors };
}

async function choose(form, label) {
    const choices = form.locator('.choices[data-type="select-multiple"]');
    if (!await choices.locator('.choices__item--choice:visible').count()) {
        await choices.locator('.choices__inner').click();
    }
    await choices.locator('.choices__item--choice:visible').filter({ hasText: label }).click();
}

async function nextRequest(requests, count) {
    await expect.poll(() => requests.length).toBe(count);
    return requests[count - 1];
}

test('the previous broad loading target reproduces disabled filter fields on multi-select change', async ({ page }) => {
    const { form, requests, errors } = await fixture(page, true);
    await choose(form, 'Books');
    const request = await nextRequest(requests, 1);
    expect(Object.keys(request.payload.components[0].updates).some(key => key.startsWith('workbenchData.suggestions'))).toBe(true);
    await expect(form.locator('fieldset')).toHaveAttribute('disabled');
    await expect(form.locator('select[id$=".value_mode"]')).toBeDisabled();
    await expect(form.locator('input.fi-input')).toBeDisabled();
    request.release();
    await expect(form.locator('fieldset')).not.toHaveAttribute('disabled');
    expect(errors).toEqual([]);
});

test('multi-select keeps upper fields editable while pending, and submit/clear retain their loading lock', async ({ page }) => {
    const { form, requests, errors } = await fixture(page);
    const fieldset = form.locator('fieldset');
    const mode = form.locator('select[id$=".value_mode"]');
    const value = form.locator('input.fi-input');
    for (const label of ['Books', 'Clothing']) {
        const expectedRequest = requests.length + 1;
        await choose(form, label);
        const request = await nextRequest(requests, expectedRequest);
        expect(request.payload.components[0].calls).toEqual([]);
        await expect(fieldset).not.toHaveAttribute('disabled');
        await expect(mode).toBeEnabled();
        await expect(value).toBeEnabled();
        await value.fill('typed while loading');
        await expect(value).toHaveValue('typed while loading');
        request.release();
        await expect.poll(() => page.evaluate(() => window.fixtureCompleted)).toBe(expectedRequest);
    }
    const count = requests.length;
    await form.getByRole('button', { name: 'اعمال', exact: true }).click();
    const submit = await nextRequest(requests, count + 1);
    expect(submit.payload.components[0].calls.some(call => call.method === 'submitWorkbenchForm')).toBe(true);
    await expect(fieldset).toHaveAttribute('disabled');
    submit.release();
    await expect(fieldset).not.toHaveAttribute('disabled');
    await form.getByRole('button', { name: 'پاک کردن', exact: true }).click();
    const clear = await nextRequest(requests, count + 2);
    expect(clear.payload.components[0].calls.some(call => call.method === 'workbenchCommand')).toBe(true);
    await expect(fieldset).toHaveAttribute('disabled');
    clear.release();
    await expect(fieldset).not.toHaveAttribute('disabled');
    await expect(mode).toBeEnabled();
    await expect(value).toBeEnabled();
    expect(errors).toEqual([]);
});
