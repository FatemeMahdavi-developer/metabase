import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const credentials = process.env.ANALYTICS_PASSWORD
    ? { email: process.env.ANALYTICS_EMAIL || 'admin@example.com', password: process.env.ANALYTICS_PASSWORD }
    : JSON.parse(fs.readFileSync(path.resolve('../.tools/admin.json'), 'utf8').replace(/^\uFEFF/, ''));
const uuidV4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const modal = page => page.locator('#analytics-studio .fi-modal-window.mb-dialog[open]');

async function api(page, route, method = 'GET', payload) {
    return page.evaluate(async ({ route, method, payload }) => {
        const response = await fetch('/analytics/api/' + route, {
            method,
            headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-CSRF-TOKEN': document.querySelector('meta[name="csrf-token"]')?.content || document.querySelector('#analytics-studio')?.dataset.csrf },
            ...(payload ? { body: JSON.stringify(payload) } : {}),
        });
        const body = await response.json();
        if (!response.ok) throw new Error(JSON.stringify(body));
        return body;
    }, { route, method, payload });
}

async function formIds(page) {
    await expect(modal(page)).toBeVisible();
    await expect(modal(page).locator('.fi-input-wrp').first()).toBeVisible();
    const fields = await modal(page).locator('.mb-form-field > label[for]').evaluateAll(labels => labels.map(label => {
        const id = label.htmlFor;
        const control = document.getElementById(id);
        return { id, associated: Boolean(control && label.closest('.mb-form-field').contains(control)) };
    }));
    expect(fields.length).toBeGreaterThan(0);
    expect(new Set(fields.map(field => field.id)).size).toBe(fields.length);
    for (const field of fields) {
        expect(field.associated).toBe(true);
        expect(field.id.replace(/^mb-field-/, '')).toMatch(uuidV4);
    }
    return fields.map(field => field.id);
}

test('intranet browsers without crypto.randomUUID can edit forms and persist unique dashboard keys', async ({ page }) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('dialog', async dialog => dialog.type() === 'beforeunload' ? dialog.accept() : dialog.dismiss());
    await page.addInitScript(() => {
        // The API is missing on ordinary intranet HTTP origins even when getRandomValues exists.
        Object.defineProperty(globalThis.crypto, 'randomUUID', { value: undefined, configurable: true });
        const randomValues = globalThis.crypto.getRandomValues.bind(globalThis.crypto);
        globalThis.__intranetRandomValuesCalls = 0;
        Object.defineProperty(globalThis.crypto, 'getRandomValues', {
            configurable: true,
            value(array) { globalThis.__intranetRandomValuesCalls++; return randomValues(array); },
        });
    });
    await page.goto('/admin/login');
    await page.locator('input[type=email]').fill(credentials.email);
    await page.locator('input[type=password]').fill(credentials.password);
    await page.locator('button[type=submit]').click();
    await expect(page).not.toHaveURL(/login/);
    await page.goto('/admin/analytics');
    await expect(page).toHaveURL(/\/admin\/analytics\/dashboards$/);
    await expect(page.locator('.fi-ta')).toBeVisible();
    await expect(page.locator('#analytics-studio')).toHaveCount(0);
    expect(await page.evaluate(() => typeof crypto.randomUUID)).toBe('undefined');

    const name = 'Browser intranet compatibility ' + Date.now();
    const dashboard = await api(page, 'dashboards', 'POST', { name, description: null, folder_id: null });
    try {
        // The resource list has no analytics JavaScript; the editor loads on its own native Filament page.
        await page.goto('/admin/analytics/dashboards/' + dashboard.id);
        await expect.poll(() => page.evaluate(() => window.analyticsStudio?.dashboard?.id)).toBe(dashboard.id);
        await expect(page.locator('aside.fi-sidebar')).toBeVisible();
        await expect(page.locator('.mb-sidebar')).toHaveCount(0);
        await page.locator('[data-action=editDashboard]').click();
        await page.locator('[data-action=addTab]').click();
        await formIds(page);
        await modal(page).locator('[name=name]').fill('Intranet tab');
        await modal(page).locator('[data-action=saveTab]').click();
        await expect(page.locator('.mb-tab.active')).toContainText('Intranet tab');

        await page.locator('[data-action=addTextCard]').click();
        await formIds(page);
        await modal(page).locator('[name=title]').fill('Intranet widget');
        await modal(page).locator('[name=content]').fill('Persisted without the secure-context UUID API.');
        await modal(page).locator('[data-action=saveTextCard]').click();
        await expect(page.locator('.mb-card')).toHaveCount(1);
        await page.locator('[data-action=duplicateCard]').click();
        await expect(page.locator('.mb-card')).toHaveCount(2);

        await page.locator('[data-action=addDashboardFilter]').click();
        await modal(page).locator('[data-action=chooseDashboardFilter][data-type=date]').click();
        await formIds(page);
        const filterKey = await page.evaluate(() => window.analyticsStudio.filterDraft.key);
        expect(filterKey).toMatch(uuidV4);
        // No report data is needed for this compatibility check; leave the unbound filter unsaved.
        await modal(page).locator('.fi-modal-close-btn').click();

        const generated = await page.evaluate(() => ({
            tab: window.analyticsStudio.activeTab,
            widgets: window.analyticsStudio.dashboard.widgets.map(widget => ({ key: widget.key, tab: widget.tab_key })),
            calls: globalThis.__intranetRandomValuesCalls,
        }));
        const keys = [generated.tab, ...generated.widgets.map(widget => widget.key), filterKey];
        expect(new Set(keys).size).toBe(keys.length);
        keys.forEach(key => expect(key).toMatch(uuidV4));
        generated.widgets.forEach(widget => expect(widget.tab).toBe(generated.tab));
        expect(generated.calls).toBeGreaterThan(0);
        await page.locator('[data-action=saveDashboard]').click();
        await expect.poll(() => page.evaluate(() => window.analyticsStudio.editing)).toBe(false);
        await expect(page).toHaveURL(new RegExp('/admin/analytics/dashboards/' + dashboard.id + '$'));

        const saved = await api(page, 'dashboards/' + dashboard.id);
        expect(saved.tabs.find(tab => tab.key === generated.tab)?.name).toBe('Intranet tab');
        expect(saved.widgets.map(widget => widget.key).sort()).toEqual(generated.widgets.map(widget => widget.key).sort());
        await page.reload();
        await expect.poll(() => page.evaluate(() => window.analyticsStudio?.dashboard?.id)).toBe(dashboard.id);
        await page.locator(`[data-action=switchTab][data-key="${generated.tab}"]`).click();
        await expect(page.locator('.mb-card')).toHaveCount(2);
        await expect(page.locator('.mb-card').first()).toContainText('Persisted without the secure-context UUID API.');
        expect(await page.evaluate(() => typeof crypto.randomUUID)).toBe('undefined');
        expect(errors).toEqual([]);
    } finally {
        await api(page, 'dashboards/' + dashboard.id, 'DELETE');
    }
});
