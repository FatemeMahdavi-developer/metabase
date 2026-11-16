import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { build } from 'esbuild';

let markup, styles, scripts;
test.beforeAll(async () => {
    markup = JSON.parse(execFileSync(path.resolve('../.tools/php/php.exe'), ['tests/Browser/helpers/export-floating-action.php'], { encoding: 'utf8', timeout: 60000 }));
    markup.invalidId = markup.invalid.match(/wire:id="([^"]+)"/)[1];
    expect(markup.initial).not.toContain('soar-form-modal');
    expect(markup.invalid).toContain('fi-fo-field-wrp-error-message');
    styles = [
        'public/css/filament/support/support.css',
        'public/css/filament/forms/forms.css',
        'public/css/filament/filament/app.css',
        'resources/css/panel-theme.css',
    ].map(file => fs.readFileSync(file, 'utf8')).join('\n');
    scripts = {};
    for (const timing of ['init-event', 'existing-livewire']) {
        const result = await build({
            stdin: { resolveDir: process.cwd(), contents: [
                'import { Livewire, Alpine } from "./vendor/livewire/livewire/dist/livewire.esm.js";',
                '(async () => {',
                'const originalHook = Livewire.hook;',
                // Disable only the new hook to reproduce the former first-mount-only behavior.
                'if (window.fixtureLegacyTheme) Livewire.hook = (name, ...args) => name === "morph.updated" ? () => {} : originalHook(name, ...args);',
                timing === 'init-event' ? 'delete window.Livewire; delete window.Alpine;' : '',
                'await import("./resources/js/filament-forms.js");',
                'window.Livewire = Livewire; window.Alpine = Alpine;',
                'window.fixtureMorphs = 0; Livewire.hook("morphed", () => { window.fixtureMorphs++; });',
                'Livewire.start();',
                'Livewire.hook = originalHook;',
                'window.dispatchEvent(new CustomEvent("open-modal", {detail:{id:document.querySelector(".fi-modal").dataset.fiModalId}}));',
                'window.fixtureLivewireReady = true;',
                '})();',
            ].join('\n') },
            bundle: true, write: false, format: 'iife',
        });
        scripts[timing] = result.outputFiles[0].text;
    }
});

async function fixture(page, timing, legacy = false) {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('http://floating-action-fixture.test/**', route => route.fulfill({
        contentType: 'text/html; charset=utf-8',
        body: '<!doctype html><html lang="fa" dir="rtl"><head><meta charset="utf-8"><script>window.livewireScriptConfig={uri:"/livewire/update",csrf:"fixture",nonce:"",progressBar:true};</script></head><body><main class="fi-main fi-main-ctn fi-page">' + markup.initial + '</main></body></html>',
    }));
    await page.goto('http://floating-action-fixture.test/');
    await page.addStyleTag({ content: styles });
    await page.evaluate(({ legacy, invalid, invalidId }) => {
        window.fixtureLegacyTheme = legacy;
        const root = document.getElementById('floating-action-fixture');
        window.fixtureValidationHtml = invalid.replaceAll(invalidId, root.getAttribute('wire:id'));
    }, { legacy, invalid: markup.invalid, invalidId: markup.invalidId });
    await page.addScriptTag({ content: scripts[timing] });
    await expect.poll(() => page.evaluate(() => window.fixtureLivewireReady)).toBe(true);
    const modal = page.locator('.fi-modal-window').filter({ has: page.locator('.soar-floating-field') });
    await expect(modal).toBeVisible();
    const container = modal.locator('..');
    await expect(container).toHaveClass(/soar-form-modal/);
    await page.evaluate(() => { window.initialFloatingField = document.querySelector('.soar-floating-field'); });
    return { modal, container, errors };
}

async function validate(page, modal, round) {
    // Use Livewire's real effect/morph pipeline with the server-rendered failed-validation form.
    await page.evaluate(() => {
        window.Livewire.all()[0].processEffects({ html: window.fixtureValidationHtml });
    });
    await expect.poll(() => page.evaluate(() => window.fixtureMorphs)).toBe(round);
    await expect(modal.locator('.fi-fo-field-wrp-error-message')).toBeVisible();
    expect(await page.evaluate(() => window.initialFloatingField === document.querySelector('.soar-floating-field'))).toBe(true);
}

test('first-mount-only styling loses the custom folder modal theme after a real Livewire validation morph', async ({ page }) => {
    const { modal, container, errors } = await fixture(page, 'init-event', true);
    await validate(page, modal, 1);
    await expect(container).not.toHaveClass(/soar-form-modal/);
    expect(errors).toEqual([]);
});

for (const timing of ['init-event', 'existing-livewire']) {
    test('custom folder modal preserves shared field styling across repeated Livewire validation morphs: ' + timing, async ({ page }) => {
        const { modal, container, errors } = await fixture(page, timing);
        const paint = () => modal.locator('.fi-input-wrp').evaluate(el => {
            const style = getComputedStyle(el);
            return { background: style.backgroundColor, radius: style.borderRadius, font: style.fontFamily };
        });
        const initial = await paint();
        for (const round of [1, 2]) {
            await validate(page, modal, round);
            await expect(container).toHaveClass(/soar-form-modal/);
            expect(await paint()).toEqual(initial);
        }
        expect(errors).toEqual([]);
    });
}
