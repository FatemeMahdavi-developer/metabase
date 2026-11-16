import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { build } from 'esbuild';
import { panelFontCss, awaitPanelFonts } from './helpers/panel-fonts.js';

let fixture, scripts, styles;
test.use({ trace: 'off' });
test.beforeAll(async () => {
    const exported = execFileSync(path.resolve('../.tools/php/php.exe'), ['tests/Browser/helpers/export-generated-sql-modal.php'], { encoding: 'utf8', timeout: 60000, maxBuffer: 1024 * 1024 });
    fixture = JSON.parse(exported.replace(/^\uFEFF/, ''));
    const lifecycle = await build({ stdin: { resolveDir: process.cwd(), contents: 'import { Livewire, Alpine } from "./vendor/livewire/livewire/dist/livewire.esm.js"; window.Livewire=Livewire;window.Alpine=Alpine;Livewire.start();' }, bundle: true, write: false, format: 'iife' });
    const application = await build({ entryPoints: ['resources/js/analytics.js'], bundle: true, write: false, format: 'iife', loader: { '.css': 'empty' } });
    scripts = [fs.readFileSync('vendor/filament/support/dist/index.js', 'utf8'), lifecycle.outputFiles[0].text, application.outputFiles[0].text];
    const built = path.resolve('public/build'), manifest = JSON.parse(fs.readFileSync(path.join(built, 'manifest.json'), 'utf8'));
    console.log('Generated SQL assets: ' + manifest['resources/css/panel-theme.css'].file + ' / ' + manifest['resources/js/analytics.js'].css.join(','));
    styles = ['../css/filament/support/support.css', '../css/filament/forms/forms.css', '../css/filament/filament/app.css', manifest['resources/css/panel-theme.css'].file, ...manifest['resources/js/analytics.js'].css].map(file => fs.readFileSync(path.join(built, file), 'utf8')).join('\n');
});

const label = '\u0633\u0641\u0627\u0631\u062a\u200c\u0647\u0627 \u{1F680}';
const single = "SELECT '" + ('metric_' + label + ', ').repeat(800) + "' AS \"long value\" FROM public.orders WHERE note = 'O''Reilly <em>& value';";
const multiline = ["SELECT '" + label + ' ' + 'wide-column,'.repeat(650) + "' AS label,", ...Array.from({ length: 150 }, (_, index) => '    ' + index + ' AS metric_' + index + ', -- ' + label), '', "    '<script data-test=\"sql-text\">&</script>' AS literal", 'FROM public.orders', 'WHERE amount > 0;', ''].join('\r\n');

async function mount(page, secure) {
    const origin = (secure ? 'https://sql-modal-fixture.test' : 'http://sql-lan-fixture.test');
    const html = '<!doctype html><html lang="fa" dir="rtl" class="fi"><head><meta charset="utf-8">' + fixture.livewireStyles + '<script>window.livewireScriptConfig={uri:"/livewire/update",csrf:"fixture",nonce:"",progressBar:true};</script></head><body class="fi-body"><main class="fi-main"><section class="fi-page"><div id="analytics-studio" data-api="/analytics/api" data-section="report" data-record="new" data-routes="{&quot;connections&quot;:&quot;/admin/analytics/databases&quot;,&quot;report&quot;:&quot;/admin/analytics/reports/__record__&quot;}"><div data-analytics-content></div>' + fixture.markup + '</div></section></main></body></html>';
    await page.route(origin + '/**', route => {
        const endpoint = new URL(route.request().url()).pathname;
        if (endpoint.endsWith('/library')) return route.fulfill({ json: { connections: [], reports: [], dashboards: [], folders: [] } });
        if (endpoint.endsWith('/reports/preview')) return route.fulfill({ json: { sql: route.request().postDataJSON().query_definition.sql, columns: [], rows: [], meta: {} } });
        return route.fulfill({ contentType: 'text/html; charset=utf-8', body: html });
    });
    await page.goto(origin + '/');
    await page.addStyleTag({ content: styles + '\n' + fixture.palette + '\n' + panelFontCss() });
    await awaitPanelFonts(page);
    // Install spies before loading production modules, including any cached API references.
    await page.evaluate(secure => {
        window.sqlCopyStrategy = secure ? 'success' : 'absent';
        window.sqlCopyCalls = { api: [], fallback: [] };
        window.sqlClipboardSpy = { writeText: async text => {
            window.sqlCopyCalls.api.push(text);
            if (window.sqlCopyStrategy === 'reject') throw new DOMException('Blocked clipboard permission', 'NotAllowedError');
        } };
        Object.defineProperty(navigator, 'clipboard', { configurable: true, value: secure ? window.sqlClipboardSpy : undefined });
        document.execCommand = command => {
            const active = document.activeElement;
            const selected = active instanceof HTMLTextAreaElement || active instanceof HTMLInputElement ? active.value.slice(active.selectionStart, active.selectionEnd) : window.getSelection().toString();
            const data = new DataTransfer();
            const event = new ClipboardEvent('copy', { bubbles: true, cancelable: true, clipboardData: data });
            (active || document).dispatchEvent(event);
            window.sqlCopyCalls.fallback.push({ command, selected, clipboard: data.getData('text/plain'), prevented: event.defaultPrevented });
            return true;
        };
    }, secure);
    for (const content of scripts) await page.addScriptTag({ content });
    await expect(page.locator('[data-analytics-content] .mb-empty')).toBeVisible();
    expect(await page.evaluate(() => window.isSecureContext)).toBe(secure);
}

async function openSql(page, sql, uncached) {
    await page.evaluate(async ({ sql, uncached }) => {
        const app = window.analyticsStudio;
        app.report = { query_definition: { mode: 'native', connection_id: 1, sql } };
        app.previewResult = uncached ? null : { sql };
        await app.showSql();
    }, { sql, uncached });
    const modal = page.locator('.fi-modal-window.mb-dialog[open]');
    await expect(modal).toBeVisible();
    const code = modal.locator('[data-generated-sql]');
    await expect(code).toBeVisible();
    expect(await code.textContent()).toBe(sql);
    await expect(code).toHaveCSS('direction', 'ltr');
    await expect(code).toHaveCSS('white-space', 'pre');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(modal.locator('script[data-test="sql-text"]')).toHaveCount(0);
    const copy = modal.locator('button.fi-btn[data-action="copyGeneratedSql"]');
    await expect(copy).toBeVisible();
    await expect(copy).toBeInViewport();
    await expect(modal.locator('.fi-modal-heading')).toBeInViewport();
    await expect(copy.locator('.fi-btn-label')).not.toBeEmpty();
    return { modal, code, copy };
}

async function scrollSql(page, modal, code, multiline) {
    const state = await code.evaluate((node, multiline) => {
        const style = getComputedStyle(node);
        node.scrollLeft = 220;
        node.scrollTop = 180;
        const rect = node.getBoundingClientRect(), windowRect = node.closest('.fi-modal-window').getBoundingClientRect();
        return { x: node.scrollLeft, y: node.scrollTop, overflowX: style.overflowX, overflowY: style.overflowY, horizontal: node.scrollWidth > node.clientWidth, vertical: node.scrollHeight > node.clientHeight, contained: rect.left >= windowRect.left && rect.right <= windowRect.right + 1, height: rect.height };
    }, multiline);
    expect(state.horizontal).toBe(true);
    expect(state.x).toBeGreaterThan(0);
    expect(['auto', 'scroll']).toContain(state.overflowX);
    expect(['auto', 'scroll']).toContain(state.overflowY);
    if (multiline) { expect(state.vertical).toBe(true); expect(state.y).toBeGreaterThan(0); }
    expect(state.contained).toBe(true);
    const button = modal.locator('[data-action="copyGeneratedSql"]');
    await expect(button).toBeInViewport();
    await button.scrollIntoViewIfNeeded();
    await expect(button).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    expect(await modal.evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
    return state;
}

async function verifyCopy(page, sql, strategy) {
    await page.evaluate(strategy => {
        window.sqlCopyCalls = { api: [], fallback: [] };
        window.sqlCopyStrategy = strategy;
        Object.defineProperty(navigator, 'clipboard', { configurable: true, value: strategy === 'absent' ? undefined : window.sqlClipboardSpy });
    }, strategy);
    const copy = page.locator('.mb-dialog[open] button.fi-btn[data-action="copyGeneratedSql"]');
    const position = await page.locator('[data-generated-sql]').evaluate(node => ({ x: node.scrollLeft, y: node.scrollTop }));
    await copy.click();
    await expect(copy).toBeEnabled();
    const expected = { apiCount: strategy === 'absent' ? 0 : 1, fallbackCount: strategy === 'success' ? 0 : 1, exactApi: true, fullFallback: true };
    await expect.poll(() => page.evaluate(sql => ({
        apiCount: window.sqlCopyCalls.api.length,
        fallbackCount: window.sqlCopyCalls.fallback.length,
        exactApi: window.sqlCopyCalls.api.every(text => text === sql),
        fullFallback: window.sqlCopyCalls.fallback.every(call => call.command === 'copy' && call.selected.replace(/\r\n?/g, '\n') === sql.replace(/\r\n?/g, '\n') && call.clipboard === sql && call.prevented),
    }), sql)).toEqual(expected);
    await expect(page.locator('.mb-dialog[open]')).toBeVisible();
    await expect(page.locator('.mb-dialog[open] .mb-dialog-error')).toBeEmpty();
    await expect(page.locator('textarea')).toHaveCount(0);
    expect(await page.locator('[data-generated-sql]').evaluate(node => ({ x: node.scrollLeft, y: node.scrollTop }))).toEqual(position);
}

test('generated SQL uses contained native modal scrolling and exact clipboard copies with LAN fallback', async ({ page, context }, testInfo) => {
    test.setTimeout(180000);
    const lan = await context.newPage(), errors = [], checks = [];
    for (const current of [page, lan]) current.on('pageerror', error => errors.push(error.message));
    await mount(page, true);
    await mount(lan, false);
    for (const mode of ['light', 'dark']) for (const width of [1440, 390]) {
        for (const current of [page, lan]) {
            await current.setViewportSize({ width, height: 900 });
            await current.locator('html').evaluate((node, dark) => node.classList.toggle('dark', dark), mode === 'dark');
        }
        for (const [kind, sql] of [['single', single], ['multiline', multiline]]) {
            const { modal, code } = await openSql(page, sql, kind === 'multiline');
            await expect(modal).toHaveCSS('background-color', mode === 'dark' ? 'rgb(0, 0, 0)' : 'rgb(255, 255, 255)');
            const secureScroll = await scrollSql(page, modal, code, kind === 'multiline');
            await verifyCopy(page, sql, 'success');
            await verifyCopy(page, sql, 'reject');
            if (kind === 'multiline') await page.screenshot({ path: testInfo.outputPath('sql-' + mode + '-' + width + '.png') });
            await page.evaluate(() => window.analyticsStudio.closeModal());
            await expect(modal).toBeHidden();
            const { modal: lanModal, code: lanCode } = await openSql(lan, sql, kind === 'multiline');
            const lanScroll = await scrollSql(lan, lanModal, lanCode, kind === 'multiline');
            await verifyCopy(lan, sql, 'absent');
            await lan.evaluate(() => window.analyticsStudio.closeModal());
            await expect(lanModal).toBeHidden();
            checks.push({ mode, width, kind, secureScroll, lanScroll });
        }
        console.log('Generated SQL: ' + mode + ' ' + width + ' passed secure clipboard + rejected/missing fallback');
    }
    expect(errors).toEqual([]);
    for (const current of [page, lan]) await current.evaluate(() => window.analyticsStudio.destroy());
    await lan.close();
    await testInfo.attach('sql-modal-scroll-and-copy', { body: JSON.stringify(checks, null, 2), contentType: 'application/json' });
});
