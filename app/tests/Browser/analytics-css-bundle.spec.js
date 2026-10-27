import { test, expect } from '@playwright/test';
import { api, createDashboard, login } from './helpers/native-analytics.js';

test('analytics loads one stylesheet bundle and keeps light and dark surfaces readable', async ({ page }) => {
    await login(page);
    const dashboardId = await createDashboard(page, `CSS bundle ${Date.now()}`);

    try {
        const analyticsStylesheets = page.locator('link[rel="stylesheet"][href*="/assets/analytics-"]');
        await expect(analyticsStylesheets).toHaveCount(1);

        const root = page.locator('#analytics-studio');
        await expect(root).toBeVisible();
        await expect(root).toHaveCSS('direction', 'rtl');

        const lightSurface = await root.evaluate(element => getComputedStyle(element).getPropertyValue('--mb-surface').trim());
        expect(lightSurface).not.toBe('');

        await page.evaluate(() => document.documentElement.classList.add('dark'));
        await expect(page.locator('html')).toHaveClass(/dark/);
        const darkSurface = await root.evaluate(element => getComputedStyle(element).getPropertyValue('--mb-surface').trim());
        expect(darkSurface).not.toBe('');
        expect(darkSurface).not.toBe(lightSurface);
    } finally {
        await api(page, `dashboards/${dashboardId}`, 'DELETE').catch(() => {});
    }
});
