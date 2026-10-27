import { test, expect } from '@playwright/test';
import { login } from './helpers/native-analytics.js';

const sidebarGroup = (page, label) => page.locator('.fi-sidebar-group').filter({
    has: page.locator('.fi-sidebar-group-label', { hasText: label }),
});

async function firstCollapsibleLabel(page) {
    return page.locator('.fi-sidebar-group').evaluateAll(groups => groups
        .find(group => group.querySelector('.fi-sidebar-group-collapse-button'))?.dataset.groupLabel);
}

async function sidebarNavigate(page, path) {
    const link = page.locator(`.fi-sidebar-nav a[href$="${path}"]:visible`).first();
    const spa = await link.evaluate(anchor => anchor.hasAttribute('wire:navigate'));
    const marker = await page.evaluate(() => (window.__sidebarNavigationMarker = Math.random()));
    await link.click();
    await expect(page).toHaveURL(new RegExp(path + '$'));
    await expect(page.locator('aside.fi-sidebar')).toBeVisible();
    if (spa) expect(await page.evaluate(() => window.__sidebarNavigationMarker)).toBe(marker);
}

test('native sidebar preserves normal collapsed groups and expands them across panel navigation', async ({ page }) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await login(page);
    const label = await firstCollapsibleLabel(page);
    expect(label, 'The native panel fixture needs a collapsible group').toBeTruthy();
    await page.evaluate(label => localStorage.setItem('collapsedGroups', JSON.stringify([label])), label);
    await page.reload();

    const group = sidebarGroup(page, label);
    await expect(group.locator('.fi-sidebar-group-items')).toBeHidden();
    await expect(group.locator('.fi-sidebar-group-collapse-button')).toHaveClass(/-rotate-180/);
    await group.locator('.fi-sidebar-group-collapse-button').click();
    await expect(group.locator('.fi-sidebar-group-items')).toBeVisible();
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('collapsedGroups')))).toEqual([]);

    await sidebarNavigate(page, '/admin/analytics/reports');
    await expect(sidebarGroup(page, label).locator('.fi-sidebar-group-items')).toBeVisible();
    await expect(page.locator('.fi-ta')).toBeVisible();
    expect(errors).toEqual([]);
});

test('malformed or non-array sidebar storage recovers before native Alpine controls initialize', async ({ page }) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await login(page);

    for (const value of ['{invalid json', '{"unexpected":true}', 'null', '"null"', '[null,12,{},[],""]']) {
        await page.evaluate(value => localStorage.setItem('collapsedGroups', value), value);
        await page.reload();
        await expect(page.locator('aside.fi-sidebar')).toBeVisible();
        await expect(page.locator('.fi-ta')).toBeVisible();
        const state = await page.evaluate(() => ({
            stored: JSON.parse(localStorage.getItem('collapsedGroups')),
            live: [...window.Alpine.store('sidebar').collapsedGroups],
        }));
        expect(Array.isArray(state.stored)).toBe(true);
        expect(state.stored.every(label => typeof label === 'string' && label.length > 0)).toBe(true);
        expect(state.live).toEqual(state.stored);
    }

    expect(errors).toEqual([]);
});

test('stale collapsed entries never hide fixed native groups or crash Livewire navigation', async ({ page }) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await login(page);
    // Native panels include an unnamed home group; the intranet regression
    // fixture may additionally include named groups with collapsible(false).
    const fixedLabels = await page.locator('.fi-sidebar-group').evaluateAll(groups => groups
        .filter(group => !group.querySelector('.fi-sidebar-group-collapse-button'))
        .map(group => group.dataset.groupLabel));
    expect(fixedLabels.length).toBeGreaterThan(0);
    const otherPanelLabel = 'Stored preference for another panel';
    await page.evaluate(({ fixedLabels, otherPanelLabel }) => localStorage.setItem(
        'collapsedGroups', JSON.stringify([...fixedLabels, otherPanelLabel]),
    ), { fixedLabels, otherPanelLabel });
    await page.reload();

    for (const label of fixedLabels) {
        const visible = await page.locator('.fi-sidebar-group').evaluateAll((groups, label) => {
            const items = groups.find(group => group.dataset.groupLabel === label)?.querySelector('.fi-sidebar-group-items');
            return Boolean(items && getComputedStyle(items).display !== 'none');
        }, label);
        expect(visible).toBe(true);
    }
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('collapsedGroups')))).toEqual([otherPanelLabel]);

    // SPA keeps Alpine alive. Reintroduce a stale live preference, then use the
    // standard home link so the next page must reconcile the existing store.
    await page.evaluate(({ fixedLabels, otherPanelLabel }) => {
        window.Alpine.store('sidebar').collapsedGroups = [...fixedLabels, otherPanelLabel];
    }, { fixedLabels, otherPanelLabel });
    await sidebarNavigate(page, '/admin');
    expect(await page.evaluate(() => [...window.Alpine.store('sidebar').collapsedGroups])).toEqual([otherPanelLabel]);
    expect(errors).toEqual([]);
});
